# The Hole — Le Chat Pêcheur

A physics-based **incremental/idle game** (inspired by *Bury Berry Bury*) where a pixel-art
cat fishes on a dock at sunset. Hold-click in the water to fish, then drag-and-fling the
caught fish into a barrel ("the hole") to earn money. Money buys upgrades that progressively
automate the whole loop; a prestige system ("Sacrifice") resets you for permanent boosts.
**UI text is in French.**

## Stack & running
- Vanilla JS + HTML/CSS. No build step.
- [Matter.js](https://brm.io/matter-js/) v0.19 (via CDN) for physics.
- Custom `<canvas>` rendering layered on top of the physics.
- Run locally: `python3 -m http.server 4321` (see `.claude/launch.json`), then open `http://localhost:4321`.

## Files
- **`game.js`** (~1160 lines) — everything: physics, input, rendering, shop, save/load. The whole game.
- **`index.html`** — canvas stage, HUD (money/gold/rate), shop drawer with Boutique + Sacrifice tabs.
- **`style.css`** — sunset theme, skill-tree-style shop, responsive mobile drawer.
- **`assets/art/`** — the **live** PNG sprites (Gemini-generated, hand-detoured).
- **`assets/px/`** — older pixel-art set, **unused**. `assets/*.svg` — cartoon set, **unused**.
  - Note: a `STYLE="px"` flag exists in `game.js` but rendering actually goes direct to `assets/art/`.
- **`tools/`** — Python helpers (`gen_sprites.py`, `process_art.py`) for asset prep.

## Core mechanics (all in `game.js`)
- **Fishing loop:** hold in water → gauge fills (`fishInterval`) → fish spawns behind the cat →
  drag it (mouse velocity = throw force) into the barrel sensor → `scoreFish()` awards money.
- **Species** (`SPECIES`): sardine (1), saumon (12), globe (60); gold variants ×100.
  Big fish are **rare by design**: the hole upgrade only *unlocks* them (saumon at hole≥1, globe at
  hole≥2) at a tiny base rate. Their spawn % is raised by dedicated paliers — `school` (Banc de Saumons)
  and `globebait` (Leurre à Globes). Rates live in `saumonRate()`/`globeRate()`; `rollSpecies()` and
  `avgFishValue()` both read them so income and offline-earnings stay consistent.
- **Juice:** combos, screen-shake, frenzy mode (×2 when >10 fish/sec), coin bursts, splashes,
  8-bit WebAudio synth (`Sound`, no sound files).
- **Progression — 4 phases** (`SHOP` array, gated skill-tree; future phases shown as blurred "mystery"):
  1. *Le Manuel* — reel (faster), bait (value), magnet (grab N at once), **rake** (~$100).
  2. *Semi-Automatique* — bigger hole, **school**/**globebait** (raise saumon/globe spawn %), conveyor belt, net skill (fish rain).
  3. *L'Usine* — auto-fisher, **autospeed** (machine cadence), conveyor motor, frenzy multiplier.
  4. *Le Vortex* — sucks nearby fish into the hole.
- **The rake is a physical object, not a skill button.** Buying it (`ensureRake`/`makeRake`) spawns
  a draggable Matter body (`label:"rake"`, category `CAT_SOLID`) that rests on the dock. Grabbing it
  (proximity check in `onDown`) sets `rakeDrag`; the loop moves it to the pointer with velocity so it
  physically shoves fish toward the barrel. Its dragged position is **clamped above the dock** so it
  can't be pushed under the planks; an off-screen safety + a `#rake-reset` button (`respawnRake()`)
  recover it if it ever gets lost. Drawn procedurally in `drawRake()`. The net is still a skill button.
- **Bigger fish unlock progressively** with the hole: level 1 → saumon, level 2 → globe (see
  `rollSpecies()` and `avgFishValue()`; the shop desc spells this out).
- **Auto machine timing is independent of the manual reel.** `autoInterval()` starts at 3s and is
  improved *only* by the `autospeed` upgrade — the reel (`fishInterval()`) drives manual fishing only.
- **Future upgrades are hidden as blurred placeholders + 🔒 button.** The `mystery` class (toggled in
  `refreshShop()` for phases beyond `revealLimit()`) is styled in `style.css`.
- **Prestige** (`PERM` array): sacrifice your run for Écailles d'Or 🪙 → permanent multipliers
  (`pmult`), golden-fish chance (`pgold`), starting cash (`pstart`).
- **Persistence:** `localStorage` key `thehole_save`, autosave every 8s + on unload/visibilitychange.
  Offline earnings capped at 8h × 50% efficiency (`applyOffline`).

## Key constants & helpers (top of `game.js`)
- World is fixed `W=1280 × H=720`, scaled/letterboxed to the canvas.
- Layout x-coords: cat at `CAT_X=400`, barrel/hole at `HOLE_X=1135`, conveyor `CONV_X1..CONV_X2`.
- `DOCK_Y=472` (dock surface), `WATER_Y=560` (fishing zone top).
- Stat formulas are small pure functions: `fishInterval()`, `baitMult()`, `holeMult()`,
  `grabCount()`, `gainMult()`, `prestigeGain()`, etc.
- Game state lives in the single object `S` (cloned from `DEFAULT_STATE`).

## Balance notes (tuning levers)
The mid/late game was rebalanced to curb the post-`hole` snowball. The key levers:
- **bait** drives repeatable income (`baitMult = 1.5^lvl`). Its *cost* mult (1.6) is kept above the
  value mult (1.5) so each level is progressively less cost-effective — this is the main throttle.
  `max` is capped (45) so it can't run away.
- **holeMult** (`1 + lvl*0.3`) is deliberately gentle — bigger-fish *base values* (saumon 12, globe 60)
  are the real reward for the hole, not a stacked multiplier.
- **goldenChance** = `plvl("pgold") * 0.01` (+1% per palier, max 10%; golden fish are ×100 value).
- **PERM (sacrifice) costs are steep on purpose** — bases/mults raised (pmult 3·×2.8, pgold 5·×3,
  pstart 4·×2.6) so each écaille investment spans multiple prestige runs.
- **Big-fish spawn rates** (`saumonRate`/`globeRate`) are the main mid-game throttle: tiny base,
  raised by the `school`/`globebait` paliers (deliberate, expensive money sinks).
- **Prestige is intentionally slow:** `prestigeGain = floor(sqrt(earnedThisRun / 4_000_000))` and the
  permanent multiplier is `1.45^pmult` (was 1.7 — too strong). Tune these two together.
- Flat phase-gate costs (hole, conveyor, net, auto, frenzy, vortex) are set so payback time keeps
  growing relative to income. Adjust these together if you change `baitMult`/`holeMult`/species values.
- The auto machine is intentionally weak at unlock (3s, no reel benefit); power comes from `autospeed`.
