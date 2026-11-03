# More fun: hybrid bites, rival personalities, streaks, the King fight, arena events, modes, cosmetics

## Why

Before this change, size decided every contact: the longer worm always won, whoever hit whom. The only strategy
was "eat pellets, avoid anything bigger, wait to be biggest". There was little room for skill, every rival behaved
the same, and once the King was beaten there was nothing left to do.

## 1. Hybrid contact rule (`Rules.resolveContact`)

- A head touching another worm within `HEAD_ZONE × radius` of that worm's head is a **head-on** clash: the bigger
  worm wins, and ties go to the biter. The winner swallows half the loser.
- A head touching anywhere further down a body is a **side hit**: the biter dies, whatever the sizes.
- The **King** plows through rivals (he always wins against them). A side hit on the *player's* body only **bonks**
  him: he loses one of three lives.
- Death drops are unchanged (a chunk every other body point), so a cut-off pays out like a jackpot.
- AI and the sim autopilot now avoid every body except the head of a smaller worm.

## 2. Rival personalities (`Rules.PERSONAS`, `PERSONA_MIX`)

| Persona | Behaviour | Tell |
|---|---|---|
| grazer | richest-nearest food, snaps at much smaller heads | plain |
| hunter | aims at the player's head plus a lead, boosts in close | angry brows |
| coward | flees the player inside 320 px | big eyes, small pupils, sweat drop |
| coiler | orbits the nearest smaller worm so it hits the coiler's side | banded body |
| thief | values death-drop chunks 5×, shadows the biggest nearby worm | bandit mask |

The mix shifts per round from mostly grazers and cowards towards hunters, coilers and thieves.

## 3. Score, streaks, medals

- Food: 10 points per length. Kills: `(100 + 2 × victim length) × (1 + 0.5 × (streak − 1))`.
- Streak: kills within 240 frames stack. A streak of n ≥ 2 adds `L(4 × (n − 1))` length and a banner.
- Near miss: the player's head within `r + r' + 12` of a lethal body point without touching it. Worth +1 length and
  50 points, with cooldowns of 45 frames overall and 180 frames per worm (so you can't farm one worm by riding
  alongside it).
- Medals by clear time against `ROUNDS[i].par`: gold ≤ par, silver ≤ 1.6 × par, bronze otherwise. Time bonus is
  `(2 × par − frames) / 6`. Best medal per round is saved in `noodleMedals`.

## 4. The Pit King

Three lives. Each bonk costs him a life and 15% of his length (dropped as grubs), leaves him dizzy for 60 frames, and
makes him immune for 80 frames. The player gets 40 frames of ghost to get clear. The wall and spike logs also bonk
him (they never kill him outright, which would end the fight with a free win).

- Life 3: hunts with a 40 px lead, short boosts when lined up.
- Life 2: longer boosts with a berry bait trail; spawns minions (max 3) that he eats when you're far away.
- Life 1: orbits the player at 210 px and lunges every ~220 frames; minions come faster.

A boss bar shows his lives, and an edge arrow points to him when he's off-screen.

## 5. Arena

`Rules.HAZARDS[round]`: mud (55% speed) from round 2; spinning spike logs from Apex; the wall closes to 70% / 75% of
its radius over 90 s on Apex and the King round. A **feeding frenzy** fires every 30–45 s (first at 25 s): a 3 s
warning with an edge arrow, then 10 s of berries, grubs and the odd apple raining into a 260 px zone. Rivals within
1400 px head for it (cowards excepted).

## 6. Modes and cosmetics

- **Daily**: `Rules.dailyFor(dateKey)` hashes the date to a seed and a modifier. The arena is built under a seeded
  `Math.random` (`withSeed`), so everyone gets the same start that day. A run lasts 3 minutes, and today's best is
  saved in `noodleDaily`.
- **Endless**: unlocked by beating the King. Rivals that spawn later are up to 2.5× bigger. Best score is kept in
  `noodleStats.endlessBest`.
- **Cosmetics**: hats (drawn emoji), trails (FX particles or text) and death pops. They unlock from
  `statView()` = `noodleStats` + best + eaten + medals.

## 7. Quick wins

- The killer gets a 💢 and a taunt bubble, the camera glides to it for 80 frames at ⅓ speed, and it comes back on
  your retry as a nemesis worth a REVENGE bonus.
- The game-over screen shows your rank by size ("#3 biggest of 12").
- Big kills (≥ L(40)) get 24 frames of half-speed slow motion; the King gets 50.

## Balance

`tools/balance-sim.mjs` god mode now skips all player contacts. The old god mode let an invincible autopilot farm
every rival that rammed it, and under the hybrid rule that inflated growth 2–3×. The sim therefore measures growth
from food and rival-vs-rival deaths only; kills are extra income for a real player. `PACE` stays at 1.5. The `par`
values in `ROUNDS` are about the median food-only frames to target, so gold means "as fast as a greedy bot that never
fights", which a player who gets kills can beat.

A `mortal` sim mode reports how often the autopilot dies. As a check, a mindless wandering bot died within 30 s in
25/40 round-1 runs (33/40 on the old rules) and 38/40 round-3 runs (39/40 before). The hybrid rule didn't make the
early game harder, because hunters that ram your side now pop.

A pre-existing spawn bug is fixed: a long rival's straight-line body could be laid across the player's spawn point.
`mkRival` re-rolls until the whole body is 180 px clear of the player and the head is off the spike logs.
