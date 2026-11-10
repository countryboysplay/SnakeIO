# Noodle Pit

A worm-arena game for phones. Steer with the joystick, eat pellets, bite smaller worms head-on, and trick any worm, however big, into running into your side. Work through five rounds to take down the Pit King, then try the daily challenge and endless mode. Unlock skins, hats, trails and death pops as you go.

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
- `game.js` — the game: loop, worms, AI, rounds, modes, hazards, skins, input, screens
- `rules.js` — pure game rules (`Rules`): contacts, streaks, scoring and medals, rival personalities, hazards, daily seeds, cosmetics
- `sync.js` — party snapshots (`Sync`): packing worms/food for guest phones and rebuilding smooth bodies from them
- `net.js` — party networking (`Net`): a thin wrapper over PeerJS (WebRTC); `vendor/peerjs.min.js` is PeerJS 1.5.5 (MIT), loaded only when someone opens Party
- `audio.js` — synthesized sound effects and the music sequencer (`Sound`)
- `songs.js` — the music as data (`Songs`): three tracks written on a 16th-note grid
- `fx.js` — particles, floating text, banners, screen shake, flashes (`FX`)
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
- ⏸ / `P` / `Esc`: pause · 🔊 / `M`: mute everything · 🎵 / `N`: music on/off (both remembered between sessions)
- Plays in portrait or landscape — many people find sideways easier

## How bites work

- **Head-on** (your head meets another worm's head): the bigger worm eats the smaller one.
- **Side hit** (a head runs into any other part of a body): the worm whose head it was pops, whatever the sizes. A tiny worm can cut in front of a giant and take it down.
- Every popped worm bursts into a trail of food.

## Rivals

Rivals have personalities, and each has a tell:

- **Grazer** (plain): eats and snaps at much smaller heads.
- **Hunter** (angry brows): stalks you and aims where you're going, to cut you off.
- **Coward** (big eyes, sweats when scared): runs away from you.
- **Coiler** (banded body): circles smaller worms so they run into its side.
- **Thief** (bandit mask): goes after death drops and shadows big worms, waiting for them to pop.

Later rounds bring in more hunters, coilers and thieves. The worm that eats you gets a 💢, taunts you, and comes back on your retry: eat it for **REVENGE**.

## Score, streaks and medals

- Eating scores 10 per point of length. Kills score more for bigger victims.
- Kills within 4 s of each other stack a streak (**DOUBLE NOODLE**, **TRIPLE NOODLE**…) for bonus length and a score multiplier.
- Skimming past a body that would have killed you is a **Close!**: +1 length and 50 points.
- Clearing a round fast earns a time bonus and a 🥇/🥈/🥉 medal, shown on the round picker. Replay rounds to improve them.
- Big kills get a beat of slow motion.

## The arena

- **Mud** (from round 2) slows you to about half speed.
- **Spike logs** (Apex and the King) spin slowly and pop anything whose head touches them.
- **The wall closes in** on Apex and the King round.
- **Feeding frenzy**: every 30–45 s a golden zone rains rich food for 10 s. An arrow points to it, and rivals rush it too.

## The Pit King

He has three lives (the boss bar). He bites you head-on if you let him; dodge, and make him run into your side to **bonk** him. Each bonk costs him a life and some length, leaves him dizzy, and makes him angrier:

1. Hunts you.
2. Charges with boosts, drops a bait trail of berries, and calls minions he can eat to grow.
3. Circles you tighter and tighter, then lunges.

## Modes

- **Rounds**: the five-round run.
- **Daily** (📅): a 3-minute run on an arena laid out from the date, so it's the same for everyone that day, with a rotating modifier (Ghost Town, Orchard, Turbo Pit, Land of Giants, Tight Squeeze). Today's best is saved.
- **Endless** (♾, unlocked by beating the King): no target. Rivals that spawn later in the run start bigger. Survive and score.

## Party (phones on the same Wi-Fi)

Up to 8 phones share one pit for a 3-minute free-for-all with the AI rivals. When you're eaten you respawn after 3 s, and the top score wins.

1. One phone: **👥 Party → Host a game**. It shows a 4-letter room code.
2. Everyone else, on the same Wi-Fi: **👥 Party**, type the code, **Join**.
3. The host taps **Start**. **Play again** after the match keeps everyone in the room.

How it works: the host's phone runs the game. Each guest sends only its joystick and boost, and gets back a snapshot of what's around it 15 times a second. Snapshots carry every 4th body point, aligned to the game clock, so guests only slide the head between them and bodies stay smooth. Phones find each other through PeerJS's free public matchmaker (so joining needs internet), then talk directly over WebRTC. On the same Wi-Fi that direct link almost always works. Across different networks it often won't, because that needs a relay server, which this doesn't have.

If the host closes the app, the match ends for everyone. Nobody can pause a party.

## Style

The menu's style picker has tabs for **Skins**, **Hats**, **Trails** and **Pops** (your death effect). Each locked item says how to unlock it: medals, streaks, close calls, playing a daily, beating the King, scoring in endless, and so on.

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
Unit tests for the service worker, audio, FX, items, rules and sync modules, plus headless smoke runs of the game (portrait and landscape) and of both sides of a party with a fake network: `node --test`.
Party mode against real WebRTC needs browsers: point several tabs at a local PeerJS server by setting `window.NOODLE_PEER = { host, port, path, secure: false }` before the page loads.
Balance: `node tools/balance-sim.mjs 20` prints frames-to-target per round for a greedy autopilot whose god mode skips all player contacts, so it measures growth from food and rival-vs-rival deaths only (a real player also grows from kills). `node tools/balance-sim.mjs 20 20000 1.5 mortal` turns god mode off and reports how often and how fast the autopilot dies. The medal par times in `ROUNDS` come from this sim; `PACE` in `game.js` scales round targets, rival sizes and the King (`node tools/balance-sim.mjs 20 20000 1.3` sweeps a value). Tuning notes live in `docs/superpowers/specs/2026-09-10-food-powerups-landscape-design.md`.
