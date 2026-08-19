/* lyric.test.js - the lyric video's timing and layout.

     node tools/lyric-video/lyric.test.js

   The drawing needs a canvas and is left to the browser. Everything that
   decides what to draw is here, and it is checked against the site's own .lrc
   file where there is one. */

const fs = require('fs');
const path = require('path');
const L = require('./lyric.js');

const LRC = path.resolve(__dirname, '..', '..', 'audio', 'lyrics', 'harana-hitha.lrc');

let pass = 0, fail = 0;
const show = v => typeof v === 'object' ? JSON.stringify(v) : String(v);
function is(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(50) + show(got) + (ok ? '' : '   want ' + show(want)));
}

console.log('\nreading the lines');
{
  const t = L.parse([
    '[00:12.30] first line',
    '0:18.5 | second line',
    '[01:05.00]third line',
    '',
    '[ar:Emortia]',
    'a line with no time'
  ].join('\n'));
  is('four lines survive, the tag does not', t.length, 4);
  is('an .lrc bracket time is read',   t[0].t, 12.3);
  is('a mm:ss.s | text line is read',  t[1].t, 18.5);
  is('minutes carry',                  t[2].t, 65);
  is('an untimed line is kept, at the end',
     [t[3].i, t[3].t, t[3].text], [3, null, 'a line with no time']);
  is('and the words come through',     t[0].text, 'first line');

  is('written back the way the editor shows it',
     L.toText(L.parse('[00:12.30] first line')), '0:12.3 | first line');
  is('a stamp pads the seconds', L.stamp(65.04), '1:05.0');
  is('and zero is zero',         L.stamp(0), '0:00.0');
  is('nothing in, nothing out',  L.parse('').length, 0);
}

console.log('\nagainst the real .lrc on the site');
{
  if (!fs.existsSync(LRC)){ console.log('  (no harana-hitha.lrc to read)'); }
  else {
    const lines = L.parse(fs.readFileSync(LRC, 'utf8'));
    is('it has lines', lines.length > 0, true);
    is('every one has a time', lines.every(l => l.t != null), true);
    is('and they run forwards', lines.every((l, i) => i === 0 || l.t >= lines[i-1].t), true);
    console.log('        (' + lines.length + ' lines, first at ' + L.stamp(lines[0].t) +
                ', last at ' + L.stamp(lines[lines.length-1].t) + ')');
  }
}

console.log('\nwhich line is showing');
{
  const lines = L.parse('0:10 | one\n0:20 | two\n0:30 | three');
  is('before the first',        L.activeAt(lines, 5), -1);
  is('on the first',            L.activeAt(lines, 10), 0);
  is('between one and two',     L.activeAt(lines, 19.9), 0);
  is('exactly on two',          L.activeAt(lines, 20), 1);
  is('past the last',           L.activeAt(lines, 999), 2);

  is('a line runs to the next one', L.windowOf(lines, 0, 60), { from:10, to:20 });
  is('the last runs to the end',    L.windowOf(lines, 2, 60), { from:30, to:60 });
  /* a line must never have a zero-length window, or the reveal divides by it */
  const same = L.parse('0:10 | one\n0:10 | two');
  is('two lines on the same tick still get a window',
     L.windowOf(same, 0, 60).to > L.windowOf(same, 0, 60).from, true);
}

console.log('\nword by word');
{
  const text = 'one two three four';
  is('nothing lit at the start',      L.litCount(text, 0, 10, 1), 0);
  is('half way, at plain speed',      L.litCount(text, 5, 10, 1), 2);
  is('all of it by the end',          L.litCount(text, 10, 10, 1), 4);
  is('never more than there are',     L.litCount(text, 99, 10, 1), 4);
  /* the whole point of the speed tweak: the words land ahead of the window */
  is('at 2.4x they are done early',   L.litCount(text, 5, 10, 2.4), 4);
  /* two seconds into a ten second window: (2/10)*speed of the way through,
     times four words, floored - 0.8, 1.6, 2.4 */
  is('and more of it the faster it runs', [1,2,3].map(s => L.litCount(text, 2, 10, s)), [0,1,2]);
  is('an empty line lights nothing',  L.litCount('', 5, 10, 2.4), 0);
  is('a one-word line still lights',  L.litCount('word', 9, 10, 1), 0);
  is('the words come back split',     L.wordsOf('a  b').filter(w=>w.trim()), ['a','b']);
}

console.log('\nword by word, stamped');
{
  const l = L.parse('0:29.3 | [0:29.3]තිස්සෙම [0:30.1]වගේ [0:31.4]ලස්සන [0:32.6]කෙල්ල');
  is('one line, four words',      [l.length, l[0].text.split(' ').length], [1, 4]);
  is('the tags come off the text', l[0].text, 'තිස්සෙම වගේ ලස්සන කෙල්ල');
  is('and are kept beside it',     l[0].wordTimes, [29.3, 30.1, 31.4, 32.6]);
  is('the line takes the first one', l[0].t, 29.3);
  is('all four are counted',       L.timedWords(l[0]), 4);

  /* the point of stamping: a word lights on its own time, not on a fraction
     of the window - so nothing drifts however long the line is held */
  const lit = t => L.litFromTimes(l[0], t, t - 29.3, 10, 2.4);
  is('nothing before the first word', lit(29.2), 0);
  is('the first word, on its tick',   lit(29.3), 1);
  is('still one just before the next', lit(30.0), 1);
  is('the second, on its tick',        lit(30.1), 2);
  is('the third',                      lit(31.5), 3);
  is('and the last',                   lit(32.6), 4);
  is('never more than there are',      lit(99), 4);

  /* stamping is done live, a word at a time, so a half-stamped line has to
     read properly - the untimed tail carries on at the even rate */
  const half = L.parse('0:10 | [0:10.0]one [0:12.0]two three four')[0];
  is('the stamped ones are exact',
     [L.litFromTimes(half, 10, 0, 8, 1), L.litFromTimes(half, 12, 2, 8, 1)], [1, 2]);
  is('and the rest follow on',
     L.litFromTimes(half, 17.9, 7.9, 8, 1) >= 3, true);
  is('a line with no tags falls back to the spread',
     L.litFromTimes(L.parse('0:10 | one two three four')[0], 15, 5, 10, 1),
     L.litCount('one two three four', 5, 10, 1));

  /* the tags have to survive a round trip, or a stamped song is lost on reload */
  is('written back with the tags on',
     L.toText(l), '0:29.3 | [0:29.3]තිස්සෙම [0:30.1]වගේ [0:31.4]ලස්සන [0:32.6]කෙල්ල');
  is('a half-stamped line keeps only what it has',
     L.toText([half]), '0:10.0 | [0:10.0]one [0:12.0]two three four');
  is('an unstamped line is written plainly',
     L.toText(L.parse('0:10 | one two')), '0:10.0 | one two');
  is('and reading it back gives the same times',
     L.parse(L.toText(l))[0].wordTimes, l[0].wordTimes);

  /* the frame has to use them too, not just the helper */
  const f = L.frameAt(31.5, l, { duration:60, wordSpeed:2.4, hideAfter:1.5 });
  is('the frame lights the stamped words', f.lit, 3);
}

console.log('\nwhen each word is due');
{
  const l = L.parse('0:10 | [0:10.0]one [0:12.0]two three four')[0];
  is('the stamped ones are their stamp', L.effectiveTimes(l, 8, 1).slice(0,2), [10, 12]);
  is('and the rest are spread over what is left',
     L.effectiveTimes(l, 8, 1).slice(2), [15, 18]);
  const plain = L.parse('0:10 | one two three four')[0];
  is('with nothing stamped it is an even spread',
     L.effectiveTimes(plain, 10, 1), [12.5, 15, 17.5, 20]);
  is('and the spread agrees with the old count',
     [0,3,5,7,10].map(e => L.effectiveTimes(plain,10,1).filter(t => t <= 10+e).length),
     [0,3,5,7,10].map(e => L.litCount(plain.text, e, 10, 1)));
  is('an empty line has no times', L.effectiveTimes(L.parse('0:10 | ')[0] || {text:'',t:10}, 10, 1), []);
}

console.log('\nhow a word arrives');
{
  is('five styles', L.REVEALS.length, 5);
  /* the point of the fade: a word is not switched on, it comes up out of
     nothing over the better part of a second */
  const f0 = L.wordFx('fade', 0, 60), f1 = L.wordFx('fade', 1, 60);
  is('at the start it is invisible',  f0.alpha, 0);
  is('and blurred',                   f0.blur > 0, true);
  is('at the end it is solid',        f1.alpha, 1);
  is('and sharp',                     f1.blur, 0);
  is('it never jumps in size',        [f0.scale, L.wordFx('fade',.5,60).scale, f1.scale], [1,1,1]);
  is('and barely moves',              L.wordFx('fade', 0, 60).dy < 60 * 0.1, true);
  is('the fade only ever grows',
     [0,.2,.4,.6,.8,1].every((p,i,a) => i===0 || L.wordFx('fade',p,60).alpha >= L.wordFx('fade',a[i-1],60).alpha), true);

  is('rise comes from below',         L.wordFx('rise', 0, 60).dy > 20, true);
  is('and lands',                     L.wordFx('rise', 1, 60).dy, 0);
  is('pop overshoots',                L.wordFx('pop', 0.5, 60).scale > 1, true);
  is('then settles back',             L.wordFx('pop', 1, 60).scale, 1);
  is('glow holds still',              [L.wordFx('glow',0,60).dy, L.wordFx('glow',1,60).dy], [0,0]);
  is('and lights up',                 L.wordFx('glow', 1, 60).glow, 1);
  is('plain does nothing at all',     L.wordFx('plain', 0, 60), {alpha:1,blur:0,dy:0,scale:1,glow:0});
  is('an unknown style falls back to the fade',
     L.wordFx('nope', 0.4, 60), L.wordFx('fade', 0.4, 60));
  is('progress outside 0..1 is clamped',
     [L.wordFx('fade',-3,60).alpha, L.wordFx('fade',9,60).alpha], [0,1]);
}

console.log('\nthe frame carries the arrivals');
{
  const lines = L.parse('0:10 | [0:10.0]one [0:12.0]two three four');
  const o = { duration:30, wordSpeed:2.4, hideAfter:1.5, fade:0.85 };
  const f = L.frameAt(10.4, lines, o);
  is('every word is described',      f.words.length, 4);
  is('the first is part way in',     f.words[0].p > 0.4 && f.words[0].p < 0.6, true);
  is('the second has not started',   f.words[1].p, 0);
  is('and it knows when it is due',  f.words[1].due, 12);
  is('once past the fade it is done', L.frameAt(11.5, lines, o).words[0].p, 1);
  /* a shorter fade must arrive sooner - this is the knob doing something */
  is('a quick fade is further along at the same moment',
     L.frameAt(10.3, lines, {duration:30, wordSpeed:2.4, fade:0.4}).words[0].p >
     L.frameAt(10.3, lines, {duration:30, wordSpeed:2.4, fade:1.6}).words[0].p, true);
}

console.log('\nexport quality');
{
  is('four stops', L.QUALITY.length, 4);
  is('HQ is the middle default', L.qualityById('nope').id, 'hq');
  const at = id => L.bitrateFor(1080, 1920, id).videoBitsPerSecond;
  is('they climb in order',
     [at('low'), at('mid'), at('hq'), at('max')].every((v,i,a) => i===0 || v > a[i-1]), true);
  is('even the low one is not thin',  at('low') >= 4e6, true);
  is('and the top one is capped',     at('max') <= 48e6, true);
  is('a bigger frame gets more bits',
     L.bitrateFor(1920,1080,'hq').videoBitsPerSecond > L.bitrateFor(1080,1080,'hq').videoBitsPerSecond, true);
  is('master runs at 60fps',          L.bitrateFor(1080,1920,'max').fps, 60);
  is('and low drops to 24',           L.bitrateFor(1080,1920,'low').fps, 24);
}

console.log('\nholding, then going');
{
  is('while it is being sung',        L.lineAlpha(2, 5, 1.5), 1);
  is('the moment it finishes',        L.lineAlpha(5, 5, 1.5), 1);
  is('half way through the hold',     +L.lineAlpha(5.75, 5, 1.5).toFixed(2), 0.5);
  is('gone after it',                 L.lineAlpha(7, 5, 1.5), 0);
  is('no hold set means it stays',    L.lineAlpha(99, 5, 0), 1);
}

console.log('\nthe sway');
{
  const a = L.sway(0, 1), b = L.sway(3.2, 1);
  is('it moves',                 a.x !== b.x || a.y !== b.y, true);
  is('the same time draws the same frame', L.sway(4.5, 1), L.sway(4.5, 1));
  is('it never shrinks past the frame',
     [0, 3, 7, 11, 19, 40, 97].every(t => L.sway(t, 1).scale >= 1), true);
  is('and never blows up',
     [0, 3, 7, 11, 19, 40, 97].every(t => L.sway(t, 1).scale < 1.12), true);
  is('turned off, it sits still', L.sway(9, 0), { scale:1, x:0, y:0, rot:0 });
}

console.log('\nthe frame, whole');
{
  const lines = L.parse('0:10 | first line here\n0:14 | second line\n0:20 | third');
  const opts = { duration: 30, wordSpeed: 2.4, hideAfter: 1.5, leadIn:'Emortia', outro:'thank you' };

  const lead = L.frameAt(2, lines, opts);
  is('before anything, the lead-in card', lead.kind, 'lead');
  is('and it says what was set',          lead.text, 'Emortia');

  const f = L.frameAt(11, lines, opts);
  is('then the line',                f.kind, 'line');
  is('with its own words',           f.text, 'first line here');
  is('nothing above it yet',         f.prev, null);
  is('and the next one waiting',     f.next, 'second line');
  is('some of it lit',               f.lit > 0 && f.lit <= 3, true);

  const g = L.frameAt(15, lines, opts);
  is('further on, the one before shows', g.prev, 'first line here');
  is('and the one after',                g.next, 'third');

  const end = L.frameAt(29.99, lines, opts);
  is('at the very end, the outro',  end.kind, 'outro');
  is('saying what was set',         end.text, 'thank you');

  is('no lyrics at all still gives a frame', L.frameAt(5, [], opts).kind, 'lead');

  /* The last line's window is whatever is left of the song. On a track with a
     long instrumental tail that was forty-five seconds, and its words crawled
     out one every five - so the reveal is capped and the line then waits. */
  const tail = L.parse('0:10 | one two three\n1:06 | four five six seven eight nine');
  const long = { duration: 111, wordSpeed: 2.4, hideAfter: 1.5, maxReveal: 6 };
  is('the last line still has a long window',
     Math.round(L.windowOf(tail, 1, 111).to - L.windowOf(tail, 1, 111).from), 45);
  is('but it is sung at a normal pace',   L.frameAt(66 + 2, tail, long).lit, 4);
  is('and finished soon after',           L.frameAt(66 + 3, tail, long).lit, 6);
  /* a line with a window shorter than the cap is untouched by it - only the
     ones with nothing after them for ages get held back */
  const close = L.parse('0:10 | one two three\n0:14 | four five six');
  const capped   = L.frameAt(12, close, { duration:60, wordSpeed:2.4, hideAfter:1.5, maxReveal:6 });
  const uncapped = L.frameAt(12, close, { duration:60, wordSpeed:2.4, hideAfter:1.5, maxReveal:999 });
  is('a line inside the cap is unaffected', capped.lit, uncapped.lit);
}

console.log('\nthe frame sizes');
{
  is('five to choose from', L.FORMATS.length, 5);
  is('TikTok is 1080x1920', (f => f.w + 'x' + f.h)(L.formatById('tiktok')), '1080x1920');
  is('YouTube is 1920x1080', (f => f.w + 'x' + f.h)(L.formatById('youtube')), '1920x1080');
  is('an unknown id falls back to the first', L.formatById('nope').id, L.FORMATS[0].id);
  is('every one is an even number of pixels',
     L.FORMATS.every(f => f.w % 2 === 0 && f.h % 2 === 0), true);

  const tall = L.layout(1080, 1920), wide = L.layout(1920, 1080);
  is('the tall frame sets its text off the height', tall.activeSize > 0, true);
  is('the wide one is not simply scaled',           tall.activeSize !== wide.activeSize, true);
  /* the words live low and the credits high, so the middle of the frame - and
     whoever is in the picture - is never written over */
  is('the words sit low in both',
     [tall.lyricBase / 1920 > 0.75, wide.lyricBase / 1080 > 0.75], [true, true]);
  is('the credits sit high in both',
     [tall.headY / 1920 < 0.15, wide.headY / 1080 < 0.15], [true, true]);
  is('and the words clear the hairline',
     [tall.lyricBase < tall.ruleY, wide.lyricBase < wide.ruleY], [true, true]);
}

console.log('\nwrapping');
{
  const measure = s => s.length * 10;          // a stand-in for the canvas
  is('a short line stays one row', L.wrap('one two', 1000, measure), ['one two']);
  is('a long one breaks',          L.wrap('aaa bbb ccc ddd', 80, measure).length, 2);
  is('nothing wraps to nothing',   L.wrap('', 100, measure), []);
  is('a single word too wide is still kept',
     L.wrap('supercalifragilistic', 50, measure), ['supercalifragilistic']);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
