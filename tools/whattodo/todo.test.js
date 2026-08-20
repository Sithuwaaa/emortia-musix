/* todo.test.js - the checklist in a note, and the dates a job carries.

     node tools/whattodo/todo.test.js
*/

const T = require('./todo.js');

let pass = 0, fail = 0;
const show = v => typeof v === 'object' ? JSON.stringify(v) : String(v);
function is(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(52) + show(got) + (ok ? '' : '   want ' + show(want)));
}

console.log('\nthe note is the checklist');
{
  const n = 'Call the vendor\nSend the drawing\nBook the crane';
  const items = T.noteItems(n);
  is('every line is an item',          items.length, 3);
  is('and none of them start ticked',  items.every(i => !i.done), true);
  is('the words come through',         items[1].text, 'Send the drawing');

  /* the shape it takes once anything has been ticked */
  is('written back with boxes',
     T.writeNote([{done:true,text:'a'},{done:false,text:'b'}]), '[x] a\n[ ] b');
  is('and read back the same',
     T.noteItems('[x] a\n[ ] b'), [{done:true,text:'a'},{done:false,text:'b'}]);

  /* people type bullets out of habit, and mean the same thing */
  is('a dash in front is just a dash',  T.noteItems('- one\n* two\n• three').map(i => i.text),
     ['one','two','three']);
  is('and a bullet on a ticked line too', T.noteItems('- [x] one')[0], {done:true,text:'one'});

  is('blank lines are not items',      T.noteItems('one\n\n\ntwo').length, 2);
  is('nor is a line of only spaces',   T.noteItems('one\n   \ntwo').length, 2);
  is('an empty note has none',         T.noteItems(''), []);
  is('and neither does nothing at all',T.noteItems(null), []);
  is('a box with no words is dropped', T.noteItems('[ ]   \nreal one').length, 1);
}

console.log('\nclearing them one at a time');
{
  const n = 'one\ntwo\nthree';
  is('ticking the first',      T.toggleItem(n, 0), '[x] one\n[ ] two\n[ ] three');
  is('ticking the middle',     T.toggleItem(n, 1), '[ ] one\n[x] two\n[ ] three');
  is('ticking is a toggle',    T.toggleItem(T.toggleItem(n, 0), 0), '[ ] one\n[ ] two\n[ ] three');
  is('or said outright',       T.toggleItem(n, 2, true), '[ ] one\n[ ] two\n[x] three');
  /* the list can be redrawn between a click and its handler, so a stale index
     must do nothing rather than throw and take the page with it */
  is('an index past the end is ignored',  T.toggleItem(n, 9), n);
  is('and so is one before the start',    T.toggleItem(n, -1), n);
  is('all at once',            T.setAllItems(n, true), '[x] one\n[x] two\n[x] three');
  is('and all back again',     T.setAllItems('[x] a\n[x] b', false), '[ ] a\n[ ] b');
  is('nothing to set stays as it was',    T.setAllItems('', true), '');

  is('counting them',          [T.itemCount(n), T.doneCount(n)], [3, 0]);
  is('and counting the ticked',T.doneCount('[x] a\n[ ] b\n[x] c'), 2);
}

console.log('\nthe heading goes when the last step does');
{
  is('not while any are left',   T.allItemsDone('[x] a\n[ ] b'), false);
  is('but yes on the last one',  T.allItemsDone('[x] a\n[x] b'), true);
  /* a job with no steps must never complete itself, or every plain job would
     tick itself off the moment it was added */
  is('an empty note is not finished',   T.allItemsDone(''), false);
  is('nor is no note at all',           T.allItemsDone(null), false);
  is('one step, ticked, is finished',   T.allItemsDone('[x] only'), true);
}

console.log('\nthe dates');
{
  const now = new Date('2026-08-20T12:00:00Z').getTime();
  const at = s => new Date(s).toISOString();
  is('just now',        T.ago(at('2026-08-20T11:59:40Z'), now), 'just now');
  is('minutes',         T.ago(at('2026-08-20T11:30:00Z'), now), '30 minutes ago');
  is('one hour',        T.ago(at('2026-08-20T11:00:00Z'), now), '1 hour ago');
  is('hours',           T.ago(at('2026-08-20T04:00:00Z'), now), '8 hours ago');
  is('yesterday',       T.ago(at('2026-08-19T10:00:00Z'), now), 'yesterday');
  is('days',            T.ago(at('2026-08-05T12:00:00Z'), now), '15 days ago');
  is('months',          T.ago(at('2026-05-20T12:00:00Z'), now), '3 months ago');
  is('a year',          T.ago(at('2025-06-20T12:00:00Z'), now), '1 year ago');
  is('nothing in, nothing out',   T.ago(null, now), '');
  is('rubbish in, nothing out',   T.ago('not a date', now), '');
  /* a clock a little behind the server should not read as the future */
  is('a moment in the future is just now', T.ago(at('2026-08-20T12:00:30Z'), now), 'just now');

  const t = { created_at: at('2026-08-05T12:00:00Z'), done: false };
  is('added shows on a pending job',
     T.dateLine(t, now).indexOf('added') === 0 && /15 days ago/.test(T.dateLine(t, now)), true);
  is('and no cleared date while it is pending',
     /cleared/.test(T.dateLine(t, now)), false);

  const d = { created_at: at('2026-08-05T12:00:00Z'), done: true, done_at: at('2026-08-19T12:00:00Z') };
  is('a cleared job shows both',
     [/added/.test(T.dateLine(d, now)), /cleared/.test(T.dateLine(d, now))], [true, true]);
  is('a job with no dates says nothing', T.dateLine({}, now), '');
}

console.log('\nwhich day it sits on');
{
  const made = '2026-08-05T12:00:00Z', cleared = '2026-08-19T12:00:00Z', due = '2026-08-10T12:00:00Z';
  is('pending: the day it was written down',
     T.calendarDate({ created_at: made }), made);
  is('cleared: the day it was cleared',
     T.calendarDate({ created_at: made, done: true, done_at: cleared }), cleared);
  /* jobs added before the deadline field went keep using it, so nothing that
     is already on the calendar moves */
  is('an old job keeps its deadline',
     T.calendarDate({ created_at: made, due: due }), due);
  is('until it is cleared, and then it does not',
     T.calendarDate({ created_at: made, due: due, done: true, done_at: cleared }), cleared);
  is('nothing at all lands nowhere',  T.calendarDate({}), null);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
