# GamesForNorah

Personal web games for Norah. Each game is a standalone static app under its own folder.

## Projects

| Folder | Game | Stack | Default language |
|--------|------|-------|------------------|
| `carrots/` | Catch carrots, dodge horseshoes | Vite + TypeScript + Phaser 3 | Basque (`eu`) |
| `horse-stable/` | Top-down ranch simulator | Vite + TypeScript + Phaser 3 | Spanish (`es`) |

## Prerequisites

Node.js LTS and npm must be on PATH. Install from https://nodejs.org if missing.

---

## Carrots (`carrots/`)

iPad-friendly catch game: slide a horse left/right, collect carrots for treats, avoid horseshoes.

### Commands

```sh
cd carrots
npm install
npm run dev      # local dev server
npm run build    # static dist/
npm run preview  # serve dist/
```

### Architecture

- `src/main.ts` — Phaser boot, 960×640 canvas, Scale.FIT
- `src/scenes/GameScene.ts` — gameplay, spawning, scoring, hearts, overlays, synth audio
- `src/i18n.ts` — Basque (default), German, Spanish
- `src/assets/*.svg` — meadow, horse, carrot, horseshoe, heart
- `vite.config.ts` — `base: "./"` for subdirectory hosting

### Gameplay rules

- Start 3 hearts, max 6; +1 heart every 5 treats
- Horseshoes remove 1 heart; brief invulnerability after hit
- 0 hearts → gentle restart overlay with treat count

### Critical: Vite + Phaser SVG loading

**Do not** pass Vite-inlined `data:image/svg+xml,...` URLs to `this.load.svg()`.

Vite inlines small SVG imports as URL-encoded data URLs. Phaser 3.80+ treats any `data:` URL as base64 and calls `atob()` on the payload. URL-encoded SVG is not valid base64, so asset load fails with:

`Failed to execute 'atob' on 'Window': The string to be decoded is not correctly encoded.`

Symptom: black canvas, no scene content, game appears dead.

**Required pattern:**

1. Import with explicit URL suffix: `import horseUrl from "../assets/horse.svg?url"`
2. Set `build.assetsInlineLimit: 0` in `vite.config.ts` so production emits separate `.svg` files under `dist/assets/`

Alternative: put assets in `public/` and load by path, or generate textures at runtime (see `horse-stable`).

### Manual test checklist

- Landscape and portrait iPad viewports: no page scroll/zoom; touch slides horse
- Carrot scoring, heart every 5 treats, max hearts, horseshoe damage, invulnerability, restart at 0 hearts
- Basque default; DE/ES language buttons
- Mute button; sound after first tap
- `npm run build && npm run preview` — meadow, horse, HUD, and play overlay visible (not black screen)

---

## Horse stable (`horse-stable/`)

Top-down horse ranch simulator: care for horses, day/night cycle, riding lessons, breeding foals, stable expansion.

**Read first:** [`horse-stable/docs/GAME_DESIGN.md`](horse-stable/docs/GAME_DESIGN.md) — vision, loops, economy, tutorial arc, roadmap.

### Commands

```sh
cd horse-stable
npm install
npm run dev      # Vite dev server, --host 0.0.0.0 for iPad on LAN
npm run build    # tsc + vite build → dist/
npm run preview  # serve dist/
```

### File map

| File | Responsibility |
|------|----------------|
| `src/main.ts` | Phaser config: RESIZE scale, full viewport, single `RanchScene` |
| `src/RanchScene.ts` | World draw, horses, HUD, action panel, input, night overlay, kids queue, celebrations (~1100 lines — main UI/render layer) |
| `src/state.ts` | Game state, tick loop, day/night, save/load, breeding, lesson payout, alerts, world constants |
| `src/actions.ts` | Data-driven action definitions + `applyAction()` |
| `src/types.ts` | `GameState`, `Horse`, `ActionDefinition`, `SAVE_VERSION` |
| `src/i18n.ts` | `eu` / `de` / `es` string tables; `t(lang, key, vars)` |
| `src/styles.css` | Page layout (no scroll, full-screen canvas) |
| `index.html` | `lang="es"`, `#game` mount |

| `src/audio/AudioManager.ts` | BGM playlist loop + mute toggles |
| `src/audio/chipSfx.ts` | Procedural SFX |
| `music/` | User MP3 playlist (served via Vite plugin → `dist/music/`) |

### Architecture principles

1. **Logic vs presentation** — Rules live in `state.ts` + `actions.ts`; Phaser scene reads state and renders. Avoid gameplay rules in `RanchScene` except visuals and input routing.
2. **Data-driven actions** — New actions = new entry in `actions[]` + i18n keys + icon in `createTextures()` + SFX hook (when audio lands).
3. **Programmatic art** — Textures generated at runtime in `RanchScene.createTextures()`. No SVG load pitfalls.
4. **Touch-first iPad** — RESIZE canvas, pan map by drag, large horse tap radius (88 px adult).

### Critical: Phaser input on iPad

**Do not use `setInteractive()` on horse containers or action button backgrounds.** Container hitboxes misalign with visuals on touch devices.

All interaction goes through **screen-space hit testing** in `RanchScene.createInput()` on `pointerup`:

```ts
// Pattern: store rects at render time, test pointer x/y at tap time
actionButtonHits: { action, horse, x, y, width, height }[]
languageButtonHits: { language, x, y, width, height }[]
pickHorseAtPointer() // world coords via camera.getWorldPoint, circle hit test
```

When adding new HUD buttons (mute, clock — not interactive), follow the same `*ButtonHits[]` pattern if they must be tappable.

### Game loop

`RanchScene.update()` calls `tickGameState(state, delta)` every frame:

- Decay horse needs (fast hunger until first foal)
- Advance `timeOfDay`; wrap day → daily coins + breeding
- Tutorial skip-to-night when both original horses fed
- Dawn wake when both original horses sleeping at night → first foal
- `refreshAlerts()` on all horses

Actions mutate state via `applyAction()` then `saveGameState()`.

### Save system

- Key: `horse-stable:v3` (`SAVE_KEY` in `state.ts`)
- Version: `SAVE_VERSION = 3` in `types.ts`
- To reset: `localStorage.removeItem('horse-stable:v3')`
- **Migration:** bump `SAVE_VERSION`, extend `loadGameState()` / `normalizeHorse()` for new fields; keep reading old keys if needed

### i18n

- Add keys to **all three** languages in `src/i18n.ts` (`eu`, `de`, `es`).
- Use `{name}`, `{coins}` placeholders; substitute via `t()`.
- Set `document.documentElement.lang` when language changes (`setLanguage()`).

### Adding a new action (checklist)

1. Add `ActionId` to `src/types.ts`
2. Add `ActionDefinition` in `src/actions.ts` (`canUse`, `apply`, costs)
3. Add label/benefit/error strings in `src/i18n.ts` (3 langs)
4. Add icon texture in `RanchScene.createTextures()` + `createIcon('icon-…')`
5. Wire SFX in audio hooks when audio module exists
6. Test: disabled reasons, coin balance, save/load persistence

### Key constants (balance)

Located in `src/state.ts`:

```ts
DAY_MS = 90_000          // full cycle (planned: DAYLIGHT_MS + NIGHT_MS)
NIGHT_START = 0.52       // planned: replace with explicit night duration
ALERT_THRESHOLD = 34     // yellow need alert
FED_FOR_SLEEP = 55
LESSON_QUEUE             // kids waiting for lessons
PADDOCK / WORLD_SIZE     // wander bounds
```

Lesson payout: `calculateLessonPayout()` → 5–20 coins from average care.

### Day / night (current)

- ~47 s day, ~43 s night within 90 s cycle
- Night: blue overlay, stars, kids hidden, sleep enabled
- HUD: day number + `morning` / `night` label only (no clock yet)

### Approved roadmap (implement when asked)

Documented in GDD §14 and Cursor plan `chip_audio_pass_7110c872.plan.md`:

1. **Clock HUD** — sun/moon arc, countdown to night/dawn, lesson timer
2. **10× longer days, 10× shorter nights** — `DAYLIGHT_MS` / `NIGHT_MS` model
3. **Timed riding lessons** — kid mounted on horse, ~25 s, payout at end
4. **Critical alerts** — red bubble when need &lt; 20, urgent SFX
5. **Chip audio** — meadow BGM + procedural SFX, mute toggle, unlock on first tap

Do **not** add `cloc` line-count tooling (explicitly rejected).

### Manual test checklist

- Fresh save: 2 horses, feed both → night skips → sleep both → foal + celebration
- Tap horses on iPad: select/deselect reliable; action buttons fire
- Lesson: daytime only, adults only, coins 5–20, front kid bounces
- Night overlay; kids hidden; sleep blocked when too hungry or daytime
- Language switch updates all HUD/panel strings; persists after refresh
- Pan map without accidental horse select (drag threshold 14 px)
- `npm run build` passes; `dist/` works with relative paths

### Hosting

Both games use `base: "./"` in Vite config. `dist/` can be served from any static host or subdirectory.

---

## Conventions (all projects)

- Keep games independently hostable with relative asset paths
- Touch-first controls for iPad; keyboard helpers OK for desktop testing
- No personal hospital or private details in game content
- Minimize scope; match existing file layout and naming in each project
- Default language varies by game (see table above) — do not assume Basque for horse-stable
- Only commit when the user explicitly asks

## Agent workflow tips

1. Read `horse-stable/docs/GAME_DESIGN.md` before changing gameplay.
2. Prefer editing `state.ts` / `actions.ts` over bloating `RanchScene.ts`.
3. After UI changes, verify touch hit testing still uses screen-space rects, not Phaser interactives.
4. Run `npm run build` in the affected game folder before finishing.
5. For pacing changes, tune cycle length and decay rates together (see GDD §15).
