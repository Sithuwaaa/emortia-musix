# Adding your own tracks

Drop your mp3 files in this folder, then edit the `raw` track list near the
top of the `Component` class in `../Emortia Musix.html` (search for
`class Component extends DCLogic`).

Each entry looks like:

```js
{t:'Static Bloom', a:'Emortia', d:222, tone:'var(--artA)'},
```

- `t` — track title (shown in the UI)
- `a` — artist name (shown in the UI)
- `d` — fallback duration in seconds (used only until the real file loads
  and its actual duration is read automatically)
- `tone` — background color for the track's placeholder art tile

By default the player looks for the file at:

```
audio/<title-slugified>.mp3
```

e.g. a track titled `Static Bloom` expects `audio/static-bloom.mp3`
(lowercase, spaces and punctuation replaced with hyphens).

If you'd rather name your files however you like, add an explicit `src`
field to the entry instead:

```js
{t:'My Real Song', a:'Your Name', d:200, tone:'#3a2414', src:'audio/my-real-song.mp3'},
```

If a file is missing, the dock at the bottom of the page shows
"Audio file not found" instead of silently failing.
