# Synced lyrics (LRC)

The Music page shows each song's lyrics and, if the file is time-synced,
highlights and auto-scrolls the current line as the song plays (karaoke
style). Clicking a line seeks the song to that moment.

## One file per song

The player looks for a file named after the song's slug:

| Song | File |
|------|------|
| Harana Hitha      | `harana-hitha.lrc` |
| Napuru Hitha      | `napuru-hitha.lrc` |
| Suwanda Vitharayi | `suwanda-vitharayi.lrc` |

(The slug is the title, lowercased, with spaces turned into hyphens –
the same rule used for the audio and art filenames.)

## Two kinds of file

**Synced (recommended)** – standard LRC, exactly what Musixmatch exports.
Each line starts with a `[mm:ss.xx]` timestamp:

```
[00:11.20] හාරනා හිත පාරනා වග දැනෙන මුත් මම අහනවා
[00:16.85] කාරණා ගතු වාරණා වන තෙක්ම හිස්තැන් සොයනවා
[00:22.40] රූරනා නෙතු නෑසෙනා තුරු ලඟම හිඳිමින් පිහිනවා
[00:28.10] මගෙ කුමාරිය සසර ඇති තෙක් නුඹට මා පෙම් කරනවා...
```

When timestamps are present the line highlights and scrolls in time with
the music, and lines become clickable to seek.

**Plain (no timing)** – just the lyric lines, one per line, no `[mm:ss]`.
These are shown statically (no highlight/scroll). The three files here
start out this way so lyrics appear right now; replace each with a synced
version whenever you're ready.

## The built-in Time-sync editor

You don't need any other software. Open the site with `#sync` on the end
of the URL, e.g.

```
https://emortia.com/#sync
```

A **Time-sync** drawer opens on the right (only for you – it is hidden
unless `#sync` is in the URL). It loads the song's current timings, so
you can either sync from scratch or fine-tune an existing file.

**Rough pass – tap it in**

1. Go to the Music tab, pick the song, press play.
2. Press **Space** at the moment each line starts. The next line to be
   tapped is outlined, and the live playhead is shown at the top.
3. **Backspace** clears the last tap if you were late.

**Fine pass – nudge it exact**

Each line has its own row:

| Control | What it does |
|---------|--------------|
| `×`     | clear this line's time |
| `«` `‹` | −1s / −0.1s |
| time    | type an exact time (`00:22.29`) |
| `›` `»` | +0.1s / +1s |
| `▶`     | play the song from this line |

`shift all −0.1 / +0.1` moves every line at once – use it when the whole
file is consistently early or late.

The lyrics on the page behind the drawer update **live** as you edit, so
you can watch the highlight land while you tune.

**Saving**

Your edits are kept in this browser as a draft (the header says
"unsaved draft"). Nothing is published until you export:

- **Copy LRC** → paste straight into the file on GitHub, or
- **Download .lrc** → save it over the song's file in this folder.

**Clear all** empties the timings; **Revert to file** throws the draft
away and reloads whatever is committed.

## Notes

- Metadata tags like `[ar:...]`, `[ti:...]`, `[by:...]` are ignored safely.
- Enhanced (word-level) LRC works too – the inline `<mm:ss.xx>` word marks
  are stripped and the line-level timing is used.
- Save the file, commit, and it goes live automatically.
