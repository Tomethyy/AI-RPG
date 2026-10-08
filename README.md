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

Before each deploy run `python3 stamp.py` (stamps build number and time into index.html, style.css and app.js; shown in the More sheet).

Local testing without spending credit: `cd worker && npm install && npm test`; for a full loop,
run `node test/mock-anthropic.mjs` and `npx wrangler dev` with a `worker/.dev.vars` file
(`GAME_KEY`, `ANTHROPIC_API_KEY=x`, `ANTHROPIC_BASE_URL=http://127.0.0.1:8788`, `ALLOWED_ORIGINS`).
