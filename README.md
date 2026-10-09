# AI-RPG

Phone-first solo RPG. See `PLAN.md` for the full plan.

- Frontend: `index.html`, `style.css` and four plain scripts (no build step, shared global scope, loaded in this order):
  `ui.js` (helpers, dice, header, options, server calls), `panels.js` (the More sheet, Ledger and Prompt views),
  `character.js` (Character screen and character creation), `app.js` (play loop, buttons, boot).
  Served by GitHub Pages from `main`. With no server set (More → Server) it runs the Phase 1 offline demo.
- Backend: `worker/`, a Cloudflare Worker with KV. It holds the API key, checks the shared game key,
  enforces the daily spend cap and request size limit, runs the AI turn and stores the save.
  Cloudflare deploys it from `main` (Workers Builds, root directory `worker`).

Secrets live only in the Cloudflare dashboard (Worker → Settings → Variables and Secrets):
`ANTHROPIC_API_KEY`, `GAME_KEY` (and `ANTHROPIC_WORKSPACE_ID` only if the API key is not tied to a workspace). Optional plain variables: `DAILY_CAP_USD` (default 1),
`TURN_MODEL` (default claude-sonnet-5-5), `TURN_EFFORT` (default low), `REGION_MODEL` (default: the turn model) and `REGION_EFFORT`
(default medium) for the story plan written once per New game.

Rules (Phase 3, reworked in Phase 5) live in `worker/src/rules.js`, with the hand-written numbers in `worker/src/content.js`
(difficulty tiers, 12 talents, backgrounds, drives, flaws) and the fixed world in `worker/src/world.js`.
Seeded d20 (one die per game+turn, a second for advantage or disadvantage, so retries never reroll), difficulty from a tier the AI names plus the place's danger (never the level),
three results (success, success at a cost, failure), four stats, XP table and level-up picks, talents, item slots, alignment axes,
failed approaches that are not offered again unchanged, validation of the AI's proposed state changes. Character creation is validated in
`worker/src/character.js`; `GET /api/creation` serves the pick-lists, `POST /api/new` with a `character` starts a game, `POST /api/char` picks level-ups,
uses talents and drops items. More → Ledger shows the memory read-only (`GET /api/ledger`). More → Playtest log (`GET /api/playtest?last=N`, `worker/src/playtest.js`) builds a copy-and-paste text report of the last turns for review in a chat.

Prompt (Phase 4) lives in `worker/src/prompt.js`: a token budget per section keeps every turn at roughly the same size
however long the campaign runs. Rules, the world core and the tone are a cached system prefix; summary and quest are a second cached block.
Turns since the summary go in verbatim (newest 5) or in brief. `worker/src/summary.js` folds old turns into a rolling summary
of at most 250 words, with Haiku in the background every 5 turns (own KV key `sum:<game id>`, adopted on the next request).
`worker/src/factmerge.js` does the same for an entity that holds more than 8 facts (key `fm:<game id>`). Facts must carry a lasting kind (no events); New game makes one AI call to write the character's intro (`writeIntro` in `index.js`).
Duplicate entities merge through the `was` field of new_facts. More → Prompt shows the next prompt section by section with
token estimates (including the output schema, scaled by the last turn's real/estimated ratio), the last turn's real usage and cost, and counters (`GET /api/prompt`).
Optional variable `SUMMARY_MODEL` (default claude-haiku-5-5), used for summaries and fact merges.

Quest structure (Phase 7): `worker/src/region.js` writes the story plan with one AI call at New game (places with travel times,
factions, key people with want/fear/secret/voice, the hidden truth, the personal stake, 6 shared milestones then a key decision
into 2 branches of 2, 3 leads each, the threat clock, 2-3 side quests); code checks its shape and retries once. The response streams
a space every few seconds while it runs so the phone keeps the connection; the current game is only replaced when the new one is ready.
`worker/src/quest.js` owns the rest: before each AI call it decides the quest step (each option carries a hidden value: scene,
advance, costly or sidetrack; a milestone needs 6 steps at least 5 turns apart), lead reveals, nudges, the threat clock (8 segments,
warning signs, 3 dooms), the day and time of day, travel time and first reactions, and puts them in a "This turn" section the AI must
narrate; after the reply it applies them, with NPC attitude (-2..2), profiles, side quests and focus. Free-text actions get one
seeded die and a results table; the AI picks stat and tier and code checks the result. `worker/src/turn.js` settles a reply into the
save (pure, also driven by the tests); `worker/src/epilogue.js` writes the ending once (`POST /api/epilogue`). More → Quests
(`GET /api/quests`, `POST /api/quest` to focus) is the small journal. `worker/src/store.js` holds the KV helpers.

Saves: schema v6. An older save is copied to `bak:main:v<old version>` in KV before it is migrated, once. Starting a new game keeps the previous save in `bak:main`.
Without an API key (or for a migrated old save) the fixed Rusted Ford opening is played with a hand-written 3-milestone quest.

Before each deploy run `python3 stamp.py` (stamps build number and time into index.html, every script, style.css and the manifest link; shown in the More sheet).

Local testing without spending credit: `cd worker && npm install && npm test`. It runs the unit tests, the quest-engine tests
(`test/quest.test.js`, a whole story to its epilogue) and end-to-end tests that play through the real Worker code against
`worker/test/mock-anthropic.mjs` with an in-memory KV (a generated region from `test/fixtures/region.json`, 30 turns, the decision,
the finale and the epilogue). For a full loop with a browser,
run `node test/mock-anthropic.mjs` and `npx wrangler dev` with a `worker/.dev.vars` file
(`GAME_KEY`, `ANTHROPIC_API_KEY=x`, `ANTHROPIC_BASE_URL=http://127.0.0.1:8788`, `ALLOWED_ORIGINS`).
