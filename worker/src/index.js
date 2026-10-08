// AI-RPG backend (Cloudflare Worker): shared-secret proxy to the Claude API, daily spend cap, server-side save.
import { newGame, migrate, publicState, pc, RECENT_TURNS, ARCHIVE_CHUNK } from "./schema.js";
import { applyNewFacts, ensureLocation } from "./ledger.js";
import { runTurn, fallbackTurn } from "./ai.js";

const SERVER_VERSION = 1;
const MAX_BODY = 4096; // bytes; a turn request is a few hundred
const MAX_CUSTOM = 300; // characters of free-text action
const SLOT = "main";
const DEFAULT_CAP_USD = 1;

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function corsHeaders(env, origin) {
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const h = { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Game-Key", "Access-Control-Max-Age": "86400", Vary: "Origin" };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

async function sha256(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

async function authorized(request, env) {
  const given = request.headers.get("X-Game-Key") || "";
  if (!env.GAME_KEY || !given) return false;
  return crypto.subtle.timingSafeEqual(await sha256(given), await sha256(env.GAME_KEY));
}

async function readBody(request) {
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) return { error: "too_large" };
  const text = await request.text();
  if (text.length > MAX_BODY) return { error: "too_large" };
  try { return { body: text ? JSON.parse(text) : {} }; } catch { return { error: "bad_json" }; }
}

const today = () => new Date().toISOString().slice(0, 10);

async function getSpend(env) {
  return Number((await env.GAME.get(`spend:${today()}`)) || 0);
}

async function addSpend(env, usd) {
  if (!usd) return;
  const key = `spend:${today()}`;
  const now = Number((await env.GAME.get(key)) || 0);
  await env.GAME.put(key, String(now + usd), { expirationTtl: 3 * 86400 });
}

function capUSD(env) {
  const n = parseFloat(env.DAILY_CAP_USD);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CAP_USD;
}

async function loadSave(env) {
  const save = await env.GAME.get(`save:${SLOT}`, "json");
  return save ? migrate(save) : null;
}

async function storeSave(env, save) {
  save.updated_at = new Date().toISOString();
  await env.GAME.put(`save:${SLOT}`, JSON.stringify(save));
}

async function archiveTurn(env, save, record) {
  const key = `arc:${save.id}:${Math.floor(record.n / ARCHIVE_CHUNK)}`;
  const chunk = (await env.GAME.get(key, "json")) || [];
  if (!chunk.some((r) => r.n === record.n)) chunk.push(record);
  await env.GAME.put(key, JSON.stringify(chunk));
}

async function stateWithSpend(env, save) {
  return publicState(save, { spend: { today: Math.round((await getSpend(env)) * 10000) / 10000, cap: capUSD(env) }, server: SERVER_VERSION });
}

// Placeholder roll until the Phase 3 rules engine (unseeded, no difficulty clamp).
function placeholderRoll(save, option) {
  const die = 1 + Math.floor(Math.random() * 20);
  const mod = pc(save).stats[option.stat] || 0;
  const label = option.stat[0].toUpperCase() + option.stat.slice(1);
  return { die, mod, label, dc: option.difficulty, success: die + mod >= option.difficulty, placeholder: true };
}

function resolveAction(save, a) {
  if (!a || typeof a !== "object") return null;
  if (a.kind === "option") {
    const option = save.scene.options[a.index];
    return option ? { kind: "option", text: option.text, option } : null;
  }
  if (a.kind === "custom") {
    const text = String(a.text || "").replace(/\s+/g, " ").trim().slice(0, MAX_CUSTOM);
    return text ? { kind: "custom", text } : null;
  }
  if (a.kind === "look") return { kind: "look", text: "Look around" };
  if (a.kind === "talk") return { kind: "talk", text: "Talk to someone nearby" };
  return null;
}

async function handleTurn(request, env) {
  const { body, error } = await readBody(request);
  if (error) return json({ error }, error === "too_large" ? 413 : 400);
  const requestId = String(body.request_id || "").slice(0, 64);
  if (!requestId) return json({ error: "missing_request_id" }, 400);

  const save = (await loadSave(env)) || newGame(SLOT);
  // Same request again (app closed mid-turn, network retry): hand back the stored result, no second AI call.
  if (save.last?.request_id === requestId) return json({ ...save.last.response, replay: true });
  if (body.turn !== save.turn) return json({ error: "stale", state: await stateWithSpend(env, save) }, 409);

  const action = resolveAction(save, body.action);
  if (!action) return json({ error: "bad_action" }, 400);
  const dice = action.option ? placeholderRoll(save, action.option) : null;

  const fallback = async (reason, detail) => {
    save.counters.fallbacks++;
    await storeSave(env, save);
    const f = fallbackTurn(save, reason);
    console.log(JSON.stringify({ event: "fallback", reason, detail, turn: save.turn }));
    return json({ fallback: true, reason, detail: detail ? String(detail).slice(0, 300) : undefined, turn: { n: save.turn, action: action.text, dice: null, narration: f.narration }, state: await stateWithSpend(env, save) });
  };

  if (!env.ANTHROPIC_API_KEY) return fallback("no_api_key");
  if ((await getSpend(env)) >= capUSD(env)) return fallback("daily_cap");

  const result = await runTurn(env, save, action, dice);
  await addSpend(env, result.cost);
  console.log(JSON.stringify({ event: "turn", turn: save.turn + 1, ok: !!result.turn, model: result.model, attempts: result.attempts, usage: result.usage, cost: result.cost, error: result.error }));
  if (!result.turn) return fallback("ai_failed", result.error);

  const t = result.turn;
  const n = save.turn + 1;
  // Code owns state. Phase 2 applies only location moves; the rest is stored as proposals for the Phase 3 rules engine.
  const changes = t.state_changes.map((c) => {
    if (c.kind === "move" && c.text) {
      const from = save.ledger.entities[save.scene.location_id];
      const to = ensureLocation(save, c.text, n);
      if (from && from.id !== to.id) {
        if (!from.connections.includes(to.id)) from.connections.push(to.id);
        if (!to.connections.includes(from.id)) to.connections.push(from.id);
      }
      save.scene.location_id = to.id;
      return { ...c, applied: true };
    }
    return { ...c, applied: false };
  });
  const factsAdded = applyNewFacts(save, t.new_facts, n);

  const record = {
    n, ts: new Date().toISOString(),
    action: { kind: action.kind, text: action.text }, dice,
    narration: t.narration, options: t.options,
    classification: t.classification, state_changes: changes, new_facts: t.new_facts, quest_flags: t.quest_flags,
    location_id: save.scene.location_id,
    model: result.model, attempts: result.attempts, usage: result.usage, cost: result.cost,
  };
  save.recent = [...save.recent, record].slice(-RECENT_TURNS);
  save.scene = { location_id: save.scene.location_id, narration: t.narration, options: t.options };
  save.turn = n;
  save.counters.ai_turns++;
  save.counters.retries += result.attempts - 1;

  const response = { turn: { n, action: action.text, dice, narration: t.narration }, facts_added: factsAdded, state: await stateWithSpend(env, save) };
  save.last = { request_id: requestId, response };
  await archiveTurn(env, save, record);
  await storeSave(env, save);
  return json(response);
}

async function route(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/health") {
    return json({ ok: true, server: SERVER_VERSION, configured: { api_key: !!env.ANTHROPIC_API_KEY, game_key: !!env.GAME_KEY, storage: !!env.GAME } });
  }
  if (!pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
  if (!env.GAME_KEY) return json({ error: "server_not_configured" }, 503);
  if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401);

  if (pathname === "/api/state" && request.method === "GET") {
    let save = await loadSave(env);
    if (!save) await storeSave(env, (save = newGame(SLOT)));
    return json(await stateWithSpend(env, save));
  }
  if (pathname === "/api/turn" && request.method === "POST") return handleTurn(request, env);
  if (pathname === "/api/new" && request.method === "POST") {
    const { body, error } = await readBody(request);
    if (error) return json({ error }, 400);
    if (body.confirm !== true) return json({ error: "confirm_required" }, 400);
    const old = await env.GAME.get(`save:${SLOT}`);
    if (old) await env.GAME.put(`bak:${SLOT}`, old); // one step back, in case of a mis-tap
    const save = newGame(SLOT);
    await storeSave(env, save);
    return json(await stateWithSpend(env, save));
  }
  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request.headers.get("Origin") || "");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let res;
    try {
      res = await route(request, env);
    } catch (err) {
      console.log(JSON.stringify({ event: "error", message: String(err?.stack || err) }));
      res = json({ error: "server_error" }, 500);
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};
