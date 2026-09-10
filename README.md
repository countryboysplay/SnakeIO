# Noodle Pit

A worm-arena game for phones. Steer with the joystick, eat pellets and smaller worms, avoid bigger ones, and work through five rounds to take down the Pit King. Unlock skins as you go.

Installable PWA — works offline once opened, no build step, no dependencies.

## Play it

Once GitHub Pages is on, open the site in Safari on your iPhone, tap Share → **Add to Home Screen**, and it launches fullscreen like an app.

## Deploy with GitHub Pages

1. Create a new repository on GitHub (e.g. `noodle-pit`).
2. Upload these files to the root of the repo (or push with git).
3. In the repo go to **Settings → Pages**.
4. Under *Build and deployment*, set **Source** to *Deploy from a branch*, pick `main` and `/ (root)`, and save.
5. After a minute your game is live at `https://<your-username>.github.io/noodle-pit/`.

## Files

- `index.html` — page shell and markup
- `style.css` — all styling
- `game.js` — the game: loop, worms, AI, rounds, skins, input, screens
- `audio.js` — synthesized sound effects and music (`Sound`)
- `fx.js` — particles, screen shake, flashes (`FX`)
- `sw.js` — service worker that caches the game for offline play
- `manifest.webmanifest` — makes it installable (fullscreen, portrait, icon)
- `icon-*.png`, `apple-touch-icon.png` — home-screen icons
- `.nojekyll` — tells Pages to serve files as-is
- `tests/` — `node --test` runs the unit tests (not shipped)

## Shipping an update

After changing any shipped file, bump `CACHE` in `sw.js` (e.g. `noodle-pit-v3`) so installed copies pick up the new version on their next launch.

## Controls

- Joystick (bottom-left): steer — mouse works on desktop
- Boost button (bottom-right) or spacebar: speed up, costs length
- ⏸ / `P` / `Esc`: pause · 🔊 / `M`: mute (remembered between sessions)
- Plays in portrait or landscape — many people find sideways easier

## Food and power-ups

Food comes in tiers: crumbs (1), berries (3), grubs (5) and rare golden apples (15). Rivals go for the rich stuff too.

Power-ups appear one at a time in the pit and only you can use them:

- ⚡ **Speed** — 6 s at boost speed with no length cost
- 🛡 **Shield** — survive one fatal hit (you bounce and lose 10% length)
- 👻 **Ghost** — 5 s passing through other worms (you can't eat them either)
- 🧲 **Magnet** — 8 s pulling nearby food toward you

Active buffs show as draining pills in the HUD.

## Development

No build step. Serve the folder (`python -m http.server 8080`) and open `http://localhost:8080/`.
Unit tests for the service worker, audio, FX and items modules, plus headless smoke runs of the game (portrait and landscape): `node --test`.
Balance: `node tools/balance-sim.mjs 20` prints frames-to-target per round for a greedy autopilot; `PACE` in `game.js` scales round targets, rival sizes and the King (`node tools/balance-sim.mjs 20 20000 1.3` sweeps a value). Tuning notes live in `docs/superpowers/specs/2026-09-10-food-powerups-landscape-design.md`.
