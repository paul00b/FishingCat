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
- **Species** (`SPECIES`): sardine (1), saumon (12), globe (60); gold variants ×100. Plus **5 "difficulty"
  species**, each adding a distinct friction (not just value) — every one keyed to a flag read by the
  physics/scoring code:
  - 🪼 **méduse** (`floaty`+`sting`, 30): buoyant (rises in `beforeUpdate`) and **stings if held >`STING_MS`**
    → `stungBy()` zeroes combo & ejects the drag.
  - 🦀 **crabe** (`flees`, 40): crawls left away from the hole in `beforeUpdate`, fighting the rake.
  - 🐍 **anguille** (`slippery`, 80): random chance each frame to break the drag → `slipsAway()`.
  - 🥾 **botte** (`junk`, 0): worthless; scoring it in `scoreFish()` pays 0 and **resets combo** (early return).
  - 👑 **roi** (`fleeting`, 2500): legendary; `f.fleeUntil = now()+ROI_TTL`, flees (removed) in the main loop if not caught.
  - Spawn is **rare by design** & gated by the hole: rate fns `saumonRate/globeRate/meduseRate/crabeRate/
    botteRate/anguilleRate/coffreRate/roiRate`. `rollSpecies()` subtracts each rate in turn; `avgFishValue()`
    mirrors them but weights by **`autoMul`** (fraction automation/offline actually banks — crabe 0.4, méduse 0.7,
    roi 0.15) so passive income stays honest while manual skill earns full value.
  - Dedicated spawn-% paliers (deliberate money sinks, like `school`/`globebait`): `treasure` (Carte au Trésor →
    coffre, hole≥2) and `royal` (Leurre Royal → roi, hole≥3).
- 🧰 **coffre** (`heavy`, 450): jackpot with ~10× density — nearly unthrowable by hand; needs rake/vortex.
- **Juice:** combos, screen-shake, frenzy mode (×2 when >10 fish/sec), coin bursts, splashes,
  8-bit WebAudio synth (`Sound`, no sound files).
- **Progression — 5 phases** (`SHOP` array, gated skill-tree; future phases shown as blurred "mystery").
  **Prestige is mandatory to finish:** late nodes are gated on `S.prestiges` in `unlocked()` — you *must*
  sacrifice several times to reach the end (locked nodes show a `def.req()` string explaining what's needed).
  1. *Le Manuel* — reel (faster), bait (value), magnet (grab N at once), **rake** (~$100).
  2. *Semi-Automatique* — bigger hole, **school**/**globebait**/**treasure** (raise saumon/globe/coffre spawn %), net skill (fish rain).
  3. *L'Usine* — auto-fisher (spawns only; delivery is manual or via the gull), **autospeed** (machine cadence), frenzy multiplier.
  4. *La Volière* — **wall** (Mur Rebond: physical bouncy wall behind the barrel, `ensureWall`/`drawWall`, redirects overthrows), **gull** (Mouette: a flying helper, **requires prestige≥1**), **gullspeed**/**gullcarry** (its powers), **royal** (roi spawn %, hole≥3).
  5. *Le Vortex* — sucks nearby fish into the hole; **requires prestige≥3 + the gull**, and costs ~60M so permMult from several runs is needed. The true endgame.
- **The Mouette (seagull)** is a runtime state machine (`gull` object, not saved): `away`→`incoming`→`carrying`→
  `leaving`. `updateGull()` (called each loop) flies it in, grabs the top `gullCarry()` catchable dock fish
  (skips junk), carries them over the barrel, and `gullDeliver()` scores them. `gullInterval()`/`gullFlySpeed()`
  scale with `gullspeed`. Drawn procedurally in `drawGull()` (no sprite yet).
- **Side systems (in the shop drawer tabs):** **Quêtes** (`QUESTS`, tiered objective chains → $/🪙, green
  `#quest-dot` when claimable), **Bestiaire** (`BESTIARY` — one card/species, grayscale until `discovered()`;
  catch-count tiers `BEST_TIERS` grant a permanent `bestiaryMult()` income bonus folded into `gainMult()`),
  and **Sacrifice** (`PERM`, 7 permanent upgrades).
- **The rake is a physical object, not a skill button.** Buying it (`ensureRake`/`makeRake`) spawns
  a draggable Matter body (`label:"rake"`, category `CAT_SOLID`) that rests on the dock. Grabbing it
  (proximity check in `onDown`) sets `rakeDrag`; the loop moves it to the pointer with velocity so it
  physically shoves fish toward the barrel. Its dragged position is **clamped above the dock** so it
  can't be pushed under the planks; an off-screen safety + a `#rake-reset` button (`respawnRake()`)
  recover it if it ever gets lost. Now drawn from the `rake` **sprite** in `drawRake()` (was procedural); its
  body is a **tall vertical bar** (`RAKE_HEAD_W`×`RAKE_HEAD_H` = 30×78) so it shoves a whole stack of fish. The net is still a skill button.
- **Bigger fish unlock progressively** with the hole: level 1 → saumon, level 2 → globe (see
  `rollSpecies()` and `avgFishValue()`; the shop desc spells this out).
- **Auto machine timing is independent of the manual reel.** `autoInterval()` starts at 3s and is
  improved *only* by the `autospeed` upgrade — the reel (`fishInterval()`) drives manual fishing only.
- **Future upgrades are hidden as blurred placeholders + 🔒 button.** The `mystery` class (toggled in
  `refreshShop()` for phases beyond `revealLimit()`) is styled in `style.css`.
- **Prestige** (`PERM` array): sacrifice your run for Écailles d'Or 🪙 → permanent multipliers
  (`pmult`), golden-fish chance (`pgold`), starting cash (`pstart`).
- **Persistence:** `localStorage` key `thehole_save`, autosave every 8s + on unload/visibilitychange.
  Offline earnings capped at 8h × 50% efficiency (`applyOffline`). `passivePerSec()` now requires
  **auto + gull** (the Mouette delivers what the Machine spawns — there is no conveyor anymore), rated at
  `min(spawnRate, gullDeliveryRate)`.

## Key constants & helpers (top of `game.js`)
- World is fixed `W=1280 × H=720`, scaled/letterboxed to the canvas.
- Layout x-coords: cat at `CAT_X=400`, barrel/hole at `HOLE_X=1135`, net fish-rain band `CONV_X1..CONV_X2`.
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
- **`permMult` is deliberately weak & ADDITIVE: `1 + pmult*0.02`** (+2% per palier, was the far-too-strong
  `1.45^pmult`). Sacrifices must compound across *many* runs, not trivialize one. `pmult` cost is gentle
  (3·×1.45, max 60) so it stays a long-term sink. If you re-tune prestige power, change this first.
- **The magnet is an expensive luxury** (`base 600·×12`, max 5 → `grabCount` 1/2/3/5/8/12). Grabbing 12 at
  once costs ~12M for the last level on purpose — it's a huge combo enabler.
- **Big-fish spawn rates** (`saumonRate`/`globeRate`) are the main mid-game throttle: tiny base,
  raised by the `school`/`globebait` paliers (deliberate, expensive money sinks).
- **Prestige is intentionally slow:** `prestigeGain = floor(sqrt(earnedThisRun / 4_000_000))`.
- **Late flat phase-gate costs are steep so the end is earned, not stumbled into** (frenzy 750k, wall 1.5M,
  gull 6M, royal 9M, **vortex 400M**). Combined with the weak `permMult`, reaching the Vortex needs several
  prestige runs. Adjust these together if you change `baitMult`/`holeMult`/species values.
- The auto machine is intentionally weak at unlock (3s, no reel benefit); power comes from `autospeed`.
