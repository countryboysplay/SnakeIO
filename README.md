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

- Joystick (bottom-left): steer
- Boost button (bottom-right) or spacebar: speed up, costs length
- Mouse works on desktop too
