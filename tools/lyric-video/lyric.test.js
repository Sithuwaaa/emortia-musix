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
  is('an untimed line is kept, at the end', t[3], { i:3, t:null, text:'a line with no time' });
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
  is('text sits below the middle in both',
     [tall.centreY / 1920 > 0.5, wide.centreY / 1080 > 0.5], [true, true]);
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
