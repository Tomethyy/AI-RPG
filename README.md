# AI-RPG

Phone-first solo RPG. See `PLAN.md` for the full plan.

- Frontend: `index.html`, `app.js`, `style.css`, served by GitHub Pages from `main`.
  With no server set (More → Server) it runs the Phase 1 offline demo.
- Backend: `worker/`, a Cloudflare Worker with KV. It holds the API key, checks the shared game key,
  enforces the daily spend cap and request size limit, runs the AI turn and stores the save.
  Cloudflare deploys it from `main` (Workers Builds, root directory `worker`).

Secrets live only in the Cloudflare dashboard (Worker → Settings → Variables and Secrets):
`ANTHROPIC_API_KEY`, `GAME_KEY` (and `ANTHROPIC_WORKSPACE_ID` only if the API key is not tied to a workspace). Optional plain variables: `DAILY_CAP_USD` (default 1),
`TURN_MODEL` (default claude-sonnet-5-5), `TURN_EFFORT` (default low).

Rules (Phase 3) live in `worker/src/rules.js`: seeded d20 (one die per game+turn, so retries never reroll), difficulty clamp by level and location danger, XP/levels, gear and loot tables, validation of the AI's proposed state changes. More → Ledger shows the memory read-only (`GET /api/ledger`).

Prompt (Phase 4) lives in `worker/src/prompt.js`: a token budget per section keeps every turn at roughly 1.5-4.5k input tokens
however long the campaign runs. Rules and setting are a cached system prefix; summary and quest are a second cached block.
Turns since the summary go in verbatim (newest 5) or in brief. `worker/src/summary.js` folds old turns into a rolling summary
of at most 250 words, with Haiku in the background every 5 turns (own KV key `sum:<game id>`, adopted on the next request).
Duplicate entities merge through the `was` field of new_facts. More → Prompt shows the next prompt section by section with
token estimates, the last turn's real usage and cost, and counters (`GET /api/prompt`). Optional variable `SUMMARY_MODEL`
(default claude-haiku-5-5).

Before each deploy run `python3 stamp.py` (stamps build number and time into index.html, style.css and app.js; shown in the More sheet).

Local testing without spending credit: `cd worker && npm install && npm test`; for a full loop,
run `node test/mock-anthropic.mjs` and `npx wrangler dev` with a `worker/.dev.vars` file
(`GAME_KEY`, `ANTHROPIC_API_KEY=x`, `ANTHROPIC_BASE_URL=http://127.0.0.1:8788`, `ALLOWED_ORIGINS`).
