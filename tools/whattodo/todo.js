/* todo.js - the parts of What To Do worth testing on their own.

   No DOM. The checklist inside a note, and the dates a job carries.

   The note is the checklist. Someone writes a heading in "What needs doing"
   and the actual steps underneath in the notes, then clears the steps one at a
   time - so every line of a note is an item that can be ticked.

   The ticks live in the note text itself, as [x] and [ ] at the front of a
   line. That is deliberate: it needs no column and no migration, it survives
   being edited by hand in the textarea, and it still reads as a list to anyone
   who opens the row in a database viewer. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.TodoCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* A line already carrying its state. The bullet in front is optional because
     people type "- thing" out of habit, and it means the same thing. */
  const MARKED = /^\s*(?:[-*•]\s*)?\[([ xX])\]\s*(.*)$/;
  const BULLET = /^\s*[-*•]\s*/;

  /* Every non-blank line of a note is an item. A note that was typed as plain
     prose before any of this existed still works - each line simply starts
     unticked, which is what it was. */
  function noteItems(note) {
    return String(note == null ? '' : note).split(/\r?\n/)
      .map(l => l.replace(/\s+$/, ''))
      .filter(l => l.trim())
      .map(line => {
        const m = MARKED.exec(line);
        if (m) return { done: m[1].toLowerCase() === 'x', text: m[2].trim() };
        return { done: false, text: line.replace(BULLET, '').trim() };
      })
      .filter(i => i.text);
  }

  /* Back to text, in the shape the box shows and the database keeps. */
  const writeNote = items =>
    (items || []).map(i => '[' + (i.done ? 'x' : ' ') + '] ' + i.text).join('\n');

  /* Ticking one item is a rewrite of the whole note, because the note is the
     only place the state lives. Out-of-range does nothing rather than throw:
     the list can be redrawn by a realtime update between a click and its
     handler, and a stale index should not take the page down. */
  function toggleItem(note, index, want) {
    const items = noteItems(note);
    if (index < 0 || index >= items.length) return note == null ? '' : note;
    items[index].done = want == null ? !items[index].done : !!want;
    return writeNote(items);
  }

  function setAllItems(note, done) {
    const items = noteItems(note);
    if (!items.length) return note == null ? '' : note;
    return writeNote(items.map(i => ({ done: !!done, text: i.text })));
  }

  const itemCount = note => noteItems(note).length;
  const doneCount = note => noteItems(note).filter(i => i.done).length;

  /* A heading is finished when its last step is. This is the whole point of
     the arrangement - clear the steps and the heading goes with them, rather
     than being ticked off separately as an afterthought. An empty note never
     counts as finished, or every job without steps would complete itself. */
  const allItemsDone = note => {
    const items = noteItems(note);
    return items.length > 0 && items.every(i => i.done);
  };

  /* ------------------------------------------------------------- the dates

     A job has two that matter: when it was written down and when it was
     cleared. Both are shown, because "added three weeks ago" is the thing that
     tells you a job is going stale, and it was never on screen before. */
  const asDate = v => {
    if (!v) return null;
    const d = new Date(v);
    return isFinite(d.getTime()) ? d : null;
  };

  const shortDate = v => {
    const d = asDate(v);
    return d ? d.toLocaleDateString([], { day: '2-digit', month: 'short' }) : '';
  };

  /* How long ago, in the roundest words that are still true. */
  function ago(v, now) {
    const d = asDate(v); if (!d) return '';
    const ms = (now == null ? Date.now() : now) - d.getTime();
    if (ms < 0) return 'just now';
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'yesterday';
    if (days < 31) return days + ' days ago';
    const months = Math.floor(days / 30.44);
    if (months < 12) return months + (months === 1 ? ' month ago' : ' months ago');
    const years = Math.floor(days / 365.25);
    return years + (years === 1 ? ' year ago' : ' years ago');
  }

  /* The line under a job. Added always; cleared as well once it has been. */
  function dateLine(t, now) {
    const t0 = t || {};
    const added = t0.created_at || t0.createdAt;
    const cleared = t0.done_at || t0.doneAt;
    const bits = [];
    if (added) bits.push('added ' + shortDate(added) + ' · ' + ago(added, now));
    if (t0.done && cleared) bits.push('cleared ' + shortDate(cleared) + ' · ' + ago(cleared, now));
    return bits.join('   ');
  }

  /* Which day a job belongs to on the calendar. There are no due dates any
     more, so a job sits on the day it was cleared once it has been, and on the
     day it was written down until then - which is where you would look for it
     either way. A job that still carries an old deadline keeps using it. */
  function calendarDate(t) {
    const t0 = t || {};
    if (t0.done && (t0.done_at || t0.doneAt)) return t0.done_at || t0.doneAt;
    if (t0.due) return t0.due;
    return t0.created_at || t0.createdAt || null;
  }

  return {
    noteItems, writeNote, toggleItem, setAllItems,
    itemCount, doneCount, allItemsDone,
    shortDate, ago, dateLine, calendarDate
  };
});
