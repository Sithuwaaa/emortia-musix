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

  /* A word can carry its own time, written in front of it:

       0:29.3 | [0:29.3]තිස්සෙම [0:30.1]දිස්සුන [0:31.4]ලස්සන

     A line spread evenly across its window is only ever approximately sung.
     Tagging the words is what makes it exact, and any word left untagged
     falls back to the spread, so a half-timed line still works. */
  const WORD_TAG = /\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/;
  const secsOf = (m, s) => parseInt(m, 10) * 60 + parseFloat(String(s).replace(':', '.'));

  function readWords(body) {
    const words = [], times = [];
    String(body || '').split(/\s+/).filter(Boolean).forEach(tok => {
      const m = WORD_TAG.exec(tok);
      if (m){
        const w = tok.slice(m[0].length);
        /* a tag on its own belongs to the word after it */
        if (w){ words.push(w); times.push(secsOf(m[1], m[2])); }
        else   { words.push(''); times.push(secsOf(m[1], m[2])); }
      } else { words.push(tok); times.push(null); }
    });
    /* a bare tag followed by a word: fold them together */
    for (let i = words.length - 1; i > 0; i--){
      if (words[i - 1] === '' && times[i] == null){
        words[i - 1] = words[i]; times[i - 1] = times[i - 1];
        words.splice(i, 1); times.splice(i, 1);
      }
    }
    return { words: words.filter((w, i) => w !== '' || times[i] != null),
             times: times.filter((t, i) => words[i] !== '' || t != null) };
  }

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
        const w = readWords(line);
        out.push({ t: null, text: w.words.join(' '), wordTimes: w.times });
        return;
      }
      const secs = secsOf(m[1], m[2]);
      const w = readWords(m[3] || '');
      out.push({ t: isFinite(secs) ? secs : null, text: w.words.join(' '), wordTimes: w.times });
    });
    /* timed lines carry the song; untimed ones keep the order they were in */
    return out.filter(l => l.t != null || l.text)
              .sort((a, b) => (a.t == null ? Infinity : a.t) - (b.t == null ? Infinity : b.t))
              .map((l, i) => Object.assign({ i }, l));
  }

  /* how many words are timed, for showing progress while stamping */
  const timedWords = line => (line && line.wordTimes ? line.wordTimes.filter(t => t != null).length : 0);

  /* back out again, in the shape the editor shows */
  const stamp = s => {
    const t = Math.max(0, Number(s) || 0);
    const m = Math.floor(t / 60);
    const rest = (t - m * 60).toFixed(1).padStart(4, '0');
    return m + ':' + rest;
  };
  const toText = lines => (lines || []).map(l => {
    const head = l.t == null ? '' : stamp(l.t) + ' | ';
    const ws = wordsOf(l.text || '').filter(w => w.trim());
    const ts = l.wordTimes || [];
    /* a stamped word keeps its tag, so the timing survives being read back */
    const body = ts.some(t => t != null)
      ? ws.map((w, i) => (ts[i] == null ? '' : '[' + stamp(ts[i]) + ']') + w).join(' ')
      : (l.text || '');
    return head + body;
  }).join('\n');

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

  /* The moment each word arrives, whether it was stamped or not.

     Working this out once, for the whole line, is what lets a word be animated
     rather than just switched on: knowing when it lands means knowing how far
     into its own fade it is on any given frame. A stamped word arrives on its
     stamp. An unstamped one is spread across whatever gap it sits in - between
     the last stamp and the next, or across the line if there are none. */
  function effectiveTimes(line, span, speed) {
    const words = wordsOf(line.text).filter(w => w.trim());
    const n = words.length;
    if (!n) return [];
    const start = line.t == null ? 0 : line.t;
    const given = line.wordTimes || [];
    const s = Math.max(0.1, Number(speed) || 1);

    if (!given.some(t => t != null))
      /* nothing stamped: the even spread, at the reveal speed */
      return words.map((w, i) => start + span * (i + 1) / (s * n));

    const out = new Array(n).fill(null);
    for (let i = 0; i < n; i++) if (given[i] != null) out[i] = given[i];
    for (let i = 0; i < n; i++){
      if (out[i] != null) continue;
      const before = lastTimeBefore(given, i);
      const after = nextTimedIndex(given, i);
      const anchor = before.t == null ? start : before.t;
      const from = before.i + 1;
      const endT = after.t == null ? start + span : after.t;
      const gap = (after.i < 0 ? n : after.i) - from;
      const per = gap > 0 ? (endT - anchor) / gap : 0;
      out[i] = anchor + per * (i - from + 1);
    }
    return out;
  }

  /* When the words carry their own times, those win: a word lights the moment
     it was stamped and not a fraction earlier. */
  function litFromTimes(line, now, elapsed, span, speed) {
    const ts = effectiveTimes(line, span, speed);
    let lit = 0;
    for (let i = 0; i < ts.length; i++){ if (now >= ts[i]) lit = i + 1; else break; }
    return lit;
  }
  function lastTimeBefore(times, i){
    for (let j = i - 1; j >= 0; j--) if (times[j] != null) return { i: j, t: times[j] };
    return { i: -1, t: null };
  }
  function nextTimedIndex(times, i){
    for (let j = i + 1; j < times.length; j++) if (times[j] != null) return { i: j, t: times[j] };
    return { i: -1, t: null };
  }

  /* ------------------------------------------------------- how a word arrives

     A word switching from white to colour on one frame is a light going on.
     What reads as singing is the word arriving: coming up out of nothing over
     the better part of a second, sharpening as it comes.

     Each style returns the same four things, so the drawing does not care
     which one is picked: how opaque the word is, how blurred, how far below
     its resting place, and how big. p is 0 the instant the word is due and 1
     when it has fully arrived. */
  const REVEALS = [
    { id:'fade',  name:'Fade in',  note:'Out of nothing, blurred to sharp. The quiet one.' },
    { id:'rise',  name:'Rise',     note:'Comes up from below and settles.' },
    { id:'pop',   name:'Pop',      note:'Un-blurs, lifts, overshoots and settles back.' },
    { id:'glow',  name:'Glow',     note:'Holds still and lights up.' },
    { id:'plain', name:'Plain',    note:'Straight to colour, no movement.' }
  ];
  const easeOut = p => 1 - Math.pow(1 - p, 3);
  const clamp01 = p => p < 0 ? 0 : p > 1 ? 1 : p;

  function wordFx(kind, p, size) {
    const u = clamp01(p), e = easeOut(u), px = size || 60;
    switch (kind) {
      /* the design's own: invisible and blurred to full over ~0.85s, with
         only a whisper of movement - no pop, nothing that jumps */
      case 'rise':
        return { alpha:e, blur:0, dy:(1 - e) * px * 0.55, scale:1, glow:0 };
      case 'pop': {
        /* overshoot to 109% and settle - a damped spring, near enough */
        const os = u >= 1 ? 1 : 1 + 0.09 * Math.sin(Math.PI * Math.min(1, u * 1.35)) * (1 - u * 0.35);
        return { alpha:clamp01(0.25 + e * 0.75), blur:(1 - e) * px * 0.13,
                 dy:(1 - e) * px * 0.30, scale:os, glow:e };
      }
      case 'glow':
        return { alpha:clamp01(0.30 + e * 0.70), blur:0, dy:0, scale:1, glow:e };
      case 'plain':
        return { alpha:1, blur:0, dy:0, scale:1, glow:0 };
      default:
        return { alpha:e, blur:(1 - e) * px * 0.16, dy:(1 - e) * px * 0.07, scale:1, glow:0 };
    }
  }

  /* ------------------------------------------------------------- the export

     One knob, four stops. The numbers are bits per pixel per frame: what the
     encoder is given to describe one frame's worth of picture. Text over a
     photograph is the hardest thing to keep clean, so even the low stop is
     generous by the standards of a talking-head video. */
  const QUALITY = [
    { id:'low', name:'Low',    bpp:0.06, fps:24, note:'Small file, for sending around.' },
    { id:'mid', name:'Mid',    bpp:0.11, fps:30, note:'Fine for stories and reels.' },
    { id:'hq',  name:'HQ',     bpp:0.19, fps:30, note:'What to upload. The default.' },
    { id:'max', name:'Master', bpp:0.32, fps:60, note:'Keep this one. Big.' }
  ];
  const qualityById = id => QUALITY.filter(q => q.id === id)[0] || QUALITY[2];
  function bitrateFor(w, h, id) {
    const q = qualityById(id);
    const v = Math.round(Math.min(48e6, Math.max(4e6, w * h * q.fps * q.bpp)));
    return { videoBitsPerSecond: v, audioBitsPerSecond: q.id === 'low' ? 128000 : 192000, fps: q.fps };
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

    /* Each word carries how far into its own arrival it is, so the drawing
       can fade it rather than switch it on. due is when it lands, p runs 0 to
       1 across the fade after that. */
    const due = effectiveTimes(lines[i], revealSpan, speed);
    const fade = o.fade == null ? 0.85 : Math.max(0.01, o.fade);
    const words = wordsOf(lines[i].text).filter(w => w.trim()).map((w, k) => ({
      text: w, due: due[k], p: clamp01((t - due[k]) / fade)
    }));

    return {
      kind: 'line', index: i, text: lines[i].text,
      lit: litFromTimes(lines[i], t, elapsed, revealSpan, speed),
      words,
      alpha,
      prev: i > 0 ? lines[i - 1].text : null,
      next: lines[i + 1] ? lines[i + 1].text : null,
      from: win.from, to: win.to
    };
  }

  return {
    FORMATS, formatById,
    parse, toText, stamp,
    activeAt, windowOf, wordsOf, litCount, litFromTimes, lineAlpha,
    readWords, timedWords, effectiveTimes,
    REVEALS, wordFx, easeOut,
    QUALITY, qualityById, bitrateFor,
    sway, layout, wrap, frameAt
  };
});
