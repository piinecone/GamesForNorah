# Audio attribution

## Background music

Tracks live in [`music/`](../music/) at the project root (not committed if large). Drop `.mp3`, `.ogg`, `.wav`, or `.m4a` files there, then run:

```bash
npm run playlist
```

The game loops through them in filename order. Regenerate the playlist after adding or removing files (`npm run dev` / `npm run build` do this automatically).

## SFX

All gameplay sound effects are **procedural 8-bit tones** generated at runtime in `src/audio/chipSfx.ts`. No external samples.

Music and SFX can be toggled independently via sidebar buttons. Preferences persist in `localStorage` (`horse-stable:musicMuted`, `horse-stable:sfxMuted`).
