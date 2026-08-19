/* lyric.js - the parts of the lyric video that are worth testing on their own.

   No canvas and no DOM: reading the lines, working out which one is showing,
   how far through its words the song has got, and where the text sits in the
   frame. The drawing is in index.html and reads all of it from here. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.LyricCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------- the sizes

     One frame each for where these actually go. The pixel sizes are the ones
     the platforms want, so what is exported is what is uploaded - no scaling
     afterwards, which is where text goes soft. */
  const FORMATS = [
    { id:'tiktok',  name:'TikTok · Reels · Shorts', w:1080, h:1920, ratio:'9:16' },
    { id:'youtube', name:'YouTube',                 w:1920, h:1080, ratio:'16:9' },
    { id:'square',  name:'Square post',             w:1080, h:1080, ratio:'1:1'  },
    { id:'feed',    name:'Feed portrait',           w:1080, h:1350, ratio:'4:5'  },
    { id:'story',   name:'Story · full bleed',      w:1080, h:1920, ratio:'9:16' }
  ];
  const formatById = id => FORMATS.filter(f => f.id === id)[0] || FORMATS[0];

  /* ------------------------------------------------------------ the lyrics

     Two shapes are read, because both already exist. The site's .lrc files
     write [mm:ss.xx] in front of the words; the editor here writes
     mm:ss.s | words, which is easier to type and to read back. */
  /* The separator is optional, because .lrc files in the wild write
     [01:05.00]words with nothing between the bracket and the first letter.
     Requiring one dropped the time and treated the whole line as untimed. */
  const TIME_RE = /^\s*(?:\[)?(\d{1,2}):(\d{2}(?:[.:]\d{1,3})?)(?:\])?\s*\|?\s*(.*)$/;

  function parse(text) {
    const out = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach(raw => {
      const line = raw.trim();
      if (!line) return;
      /* an .lrc tag line - [ar:...] [ti:...] - is not a lyric */
      if (/^\[[a-z]+:[^\]]*\]$/i.test(line)) return;
      const m = TIME_RE.exec(line);
      if (!m){
        /* a line with no time still belongs, so nothing is silently dropped */
        out.push({ t: null, text: line });
        return;
      }
      const secs = parseInt(m[1], 10) * 60 + parseFloat(String(m[2]).replace(':', '.'));
      out.push({ t: isFinite(secs) ? secs : null, text: (m[3] || '').trim() });
    });
    /* timed lines carry the song; untimed ones keep the order they were in */
    return out.filter(l => l.t != null || l.text)
              .sort((a, b) => (a.t == null ? Infinity : a.t) - (b.t == null ? Infinity : b.t))
              .map((l, i) => Object.assign({ i }, l));
  }

  /* back out again, in the shape the editor shows */
  const stamp = s => {
    const t = Math.max(0, Number(s) || 0);
    const m = Math.floor(t / 60);
    const rest = (t - m * 60).toFixed(1).padStart(4, '0');
    return m + ':' + rest;
  };
  const toText = lines => (lines || [])
    .map(l => (l.t == null ? '' : stamp(l.t) + ' | ') + (l.text || '')).join('\n');

  /* --------------------------------------------------------- what is showing

     The line whose time has passed and whose successor's has not. Before the
     first one there is nothing, which is what the lead-in card is for; after
     the last, the outro. */
  function activeAt(lines, t) {
    if (!lines || !lines.length) return -1;
    let lo = 0, hi = lines.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const at = lines[mid].t;
      if (at == null || at > t) hi = mid - 1;
      else { found = mid; lo = mid + 1; }
    }
    return found;
  }

  /* How long a line has before the next one starts. The last line has no
     successor, so it is given the rest of the song. */
  function windowOf(lines, i, duration) {
    if (i < 0 || !lines[i]) return { from: 0, to: 0 };
    const from = lines[i].t == null ? 0 : lines[i].t;
    let to = duration || from + 4;
    for (let j = i + 1; j < lines.length; j++)
      if (lines[j].t != null) { to = lines[j].t; break; }
    return { from, to: Math.max(to, from + 0.2) };
  }

  /* ------------------------------------------------------ word by word

     A line is revealed across its own window rather than at a fixed rate, so
     it keeps time with the singing whatever the tempo. speed pulls the reveal
     forward - at 2.4x the words land well ahead of the window closing, which
     is what makes it feel sung rather than typed. */
  function wordsOf(text) {
    return String(text || '').split(/(\s+)/).filter(w => w.length);
  }
  function litCount(text, elapsed, span, speed) {
    const words = wordsOf(text).filter(w => w.trim());
    if (!words.length) return 0;
    const s = Math.max(0.1, Number(speed) || 1);
    const through = span > 0 ? (elapsed / span) * s : 1;
    return Math.max(0, Math.min(words.length, Math.floor(through * words.length + 0.0001)));
  }

  /* ---------------------------------------------------------- the fade out

     A line hangs on after its words are done, then goes if the next one is a
     long way off - a held frame with stale words on it looks like a bug. */
  function lineAlpha(elapsed, span, hideAfter) {
    const hold = Number(hideAfter);
    if (!isFinite(hold) || hold <= 0) return 1;
    const over = elapsed - span;
    if (over <= 0) return 1;
    if (over >= hold) return 0;
    return 1 - (over / hold);
  }

  /* ------------------------------------------------------------- the sway

     The picture never sits still: a slow drift and a slower breath, on
     different periods so they do not beat together into a pulse. Pure maths
     of the clock, so a frame drawn at any time looks the same as the frame
     the preview drew - which is what makes an export match what was seen. */
  function sway(t, amount) {
    const a = amount == null ? 1 : amount;
    return {
      scale: 1 + 0.045 * a + 0.035 * a * Math.sin(t / 7.3),
      x: 26 * a * Math.sin(t / 11.1),
      y: 18 * a * Math.cos(t / 9.7),
      rot: 0.55 * a * Math.sin(t / 17.3) * Math.PI / 180
    };
  }

  /* ------------------------------------------------------------ the layout

     Everything is a fraction of the frame height, so one set of numbers holds
     for a tall TikTok frame and a wide YouTube one without a second design. */
  /* The words sit low and to the left, with the song's name and its credits
     up in the opposite corner and the clock across from them - so the middle
     of the frame stays clear and the face in the picture is never written
     over. Everything is a fraction of the frame, so the same numbers hold for
     a tall frame and a wide one. */
  function layout(w, h) {
    const tall = h >= w;
    const unit = tall ? h : h * 1.32;      // a wide frame needs bigger type for its height
    return {
      padX: Math.round(w * (tall ? 0.075 : 0.055)),

      /* top left: a short rule, the name, then who by */
      headY:     Math.round(h * (tall ? 0.052 : 0.070)),
      ruleW:     Math.round(w * (tall ? 0.075 : 0.055)),
      titleSize: Math.round(unit * (tall ? 0.0175 : 0.020)),
      creditSize:Math.round(unit * (tall ? 0.0092 : 0.011)),
      creditGap: Math.round(unit * (tall ? 0.0165 : 0.019)),

      /* top right: the clock */
      timeSize:  Math.round(unit * (tall ? 0.0125 : 0.015)),

      /* bottom left: the words, growing upwards from a fixed floor */
      lyricBase: Math.round(h * (tall ? 0.855 : 0.845)),
      activeSize:Math.round(unit * (tall ? 0.0295 : 0.036)),
      nearSize:  Math.round(unit * (tall ? 0.0175 : 0.021)),
      lineGap:   Math.round(unit * (tall ? 0.011 : 0.013)),
      cardSize:  Math.round(unit * (tall ? 0.0355 : 0.043)),

      /* the hairline the design draws under everything */
      ruleY:     Math.round(h * (tall ? 0.905 : 0.900))
    };
  }

  /* Wrap by measuring, because a Sinhala line and an English one of the same
     character count are nothing like the same width. measure is handed in so
     this file never needs a canvas. */
  function wrap(text, maxWidth, measure) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const rows = [];
    let row = words[0];
    for (let i = 1; i < words.length; i++) {
      const next = row + ' ' + words[i];
      if (measure(next) <= maxWidth) row = next;
      else { rows.push(row); row = words[i]; }
    }
    rows.push(row);
    return rows;
  }

  /* ------------------------------------------------------------- the state

     One call gives the whole frame: which card or line, how far through, what
     is above and below. The drawing does no thinking. */
  function frameAt(t, lines, opts) {
    const o = opts || {};
    const duration = o.duration || 0;
    const speed = o.wordSpeed == null ? 2.4 : o.wordSpeed;
    const hideAfter = o.hideAfter == null ? 1.5 : o.hideAfter;
    const first = lines && lines.length ? lines.find(l => l.t != null) : null;

    if (first && t < first.t)
      return { kind:'lead', text:o.leadIn || '', alpha:1, prev:null, next:lines[0] ? lines[0].text : '' };

    const i = activeAt(lines, t);
    if (i < 0) return { kind:'lead', text:o.leadIn || '', alpha:1, prev:null, next:'' };

    const win = windowOf(lines, i, duration);
    const span = win.to - win.from;
    const elapsed = t - win.from;
    const isLast = !lines.slice(i + 1).some(l => l.t != null);

    /* A line is revealed across its own window, but the last one's window is
       whatever is left of the song - forty-five seconds of instrumental after
       the final line meant its words crawled out one every five seconds, or
       never appeared at all. Nobody sings that slowly, so the reveal is capped
       and the line simply waits once it is done. */
    const revealSpan = Math.min(span, o.maxReveal == null ? 6 : o.maxReveal);
    const alpha = lineAlpha(elapsed, span, isLast ? 0 : hideAfter);

    /* past the end of the last line, the outro takes the frame */
    if (isLast && duration && t > duration - 0.05)
      return { kind:'outro', text:o.outro || '', alpha:1, prev:lines[i].text, next:null };

    return {
      kind: 'line', index: i, text: lines[i].text,
      lit: litCount(lines[i].text, elapsed, revealSpan, speed),
      words: wordsOf(lines[i].text).filter(w => w.trim()),
      alpha,
      prev: i > 0 ? lines[i - 1].text : null,
      next: lines[i + 1] ? lines[i + 1].text : null,
      from: win.from, to: win.to
    };
  }

  return {
    FORMATS, formatById,
    parse, toText, stamp,
    activeAt, windowOf, wordsOf, litCount, lineAlpha,
    sway, layout, wrap, frameAt
  };
});
