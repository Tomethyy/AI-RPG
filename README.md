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
`TURN_MODEL` (default claude-sonnet-5-5), `TURN_EFFORT` (default low).

Rules (Phase 3, reworked in Phase 5) live in `worker/src/rules.js`, with the hand-written numbers in `worker/src/content.js`
(difficulty tiers, 12 talents, backgrounds, drives, flaws) and the fixed world in `worker/src/world.js`.
Seeded d20 (one die per game+turn, a second for advantage or disadvantage, so retries never reroll), difficulty from a tier the AI names plus the place's danger (never the level),
three results (success, success at a cost, failure), four stats, XP table and level-up picks, talents, item slots, alignment axes,
failed approaches that are not offered again unchanged, validation of the AI's proposed state changes. Character creation is validated in
`worker/src/character.js`; `GET /api/creation` serves the pick-lists, `POST /api/new` with a `character` starts a game, `POST /api/char` picks level-ups,
uses talents and drops items. More → Ledger shows the memory read-only (`GET /api/ledger`).

Prompt (Phase 4) lives in `worker/src/prompt.js`: a token budget per section keeps every turn at roughly the same size
however long the campaign runs. Rules, the world core and the tone are a cached system prefix; summary and quest are a second cached block.
Turns since the summary go in verbatim (newest 5) or in brief. `worker/src/summary.js` folds old turns into a rolling summary
of at most 250 words, with Haiku in the background every 5 turns (own KV key `sum:<game id>`, adopted on the next request).
`worker/src/factmerge.js` does the same for an entity that holds more than 8 facts (key `fm:<game id>`). Facts must carry a lasting kind (no events); New game makes one AI call to write the character's intro (`writeIntro` in `index.js`).
Duplicate entities merge through the `was` field of new_facts. More → Prompt shows the next prompt section by section with
token estimates (including the output schema, scaled by the last turn's real/estimated ratio), the last turn's real usage and cost, and counters (`GET /api/prompt`).
Optional variable `SUMMARY_MODEL` (default claude-haiku-5-5), used for summaries and fact merges.

Saves: schema v5. An older save is copied to `bak:main:v<old version>` in KV before it is migrated, once. Starting a new game keeps the previous save in `bak:main`.

Before each deploy run `python3 stamp.py` (stamps build number and time into index.html, every script, style.css and the manifest link; shown in the More sheet).

Local testing without spending credit: `cd worker && npm install && npm test`. It runs the unit tests and an end-to-end test that plays 30 turns through
the real Worker code against `worker/test/mock-anthropic.mjs` with an in-memory KV. For a full loop with a browser,
run `node test/mock-anthropic.mjs` and `npx wrangler dev` with a `worker/.dev.vars` file
(`GAME_KEY`, `ANTHROPIC_API_KEY=x`, `ANTHROPIC_BASE_URL=http://127.0.0.1:8788`, `ALLOWED_ORIGINS`).
