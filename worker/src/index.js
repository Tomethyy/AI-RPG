// AI-RPG backend (Cloudflare Worker): shared-secret proxy to the Claude API, daily spend cap, server-side save.
import { newGame, publicState, publicQuests, ledgerView, RECENT_PROMPT, SUMMARY_BATCH } from "./schema.js";
import { applyNewFacts } from "./ledger.js";
import { runTurn, fallbackTurn, DEFAULT_TURN_MODEL, DEFAULT_SUMMARY_MODEL, SCHEMA_TEXT, SCHEMA_TOKENS } from "./ai.js";
import { buildPrompt, BUDGET, INTRO_ACTION, fit } from "./prompt.js";
import { adoptSummary, summaryDue, summaryJob, updateSummary } from "./summary.js";
import { adoptFactMerge, mergeDue, mergeJob, runFactMerge } from "./factmerge.js";
import { applyPick, useTalent, dropItem } from "./rules.js";
import { planTurn, afterFacts, setFocus, introPlan } from "./quest.js";
import { settleTurn } from "./turn.js";
import { generateRegion, applyRegion, DEFAULT_REGION_EFFORT } from "./region.js";
import { writeEpilogue, plainEpilogue } from "./epilogue.js";
import { validateCharacter, DEFAULT_CHARACTER } from "./character.js";
import { creationTables } from "./content.js";
import { playtestReport, archiveKeys, PLAYTEST_MAX } from "./playtest.js";
import { SLOT, getSpend, addSpend, capUSD, underCap, loadSave, storeSave, archiveTurn } from "./store.js";

const SERVER_VERSION = 1;
const MAX_BODY = 4096; // bytes; a turn request is a few hundred
const MAX_CUSTOM = 300; // characters of free-text action
const KEEPALIVE_MS = 5000; // New game: a space every few seconds keeps the phone's connection open while the plan is written

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

async function stateWithSpend(env, save) {
  return publicState(save, { spend: { today: Math.round((await getSpend(env)) * 10000) / 10000, cap: capUSD(env) }, server: SERVER_VERSION });
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
  return null;
}

async function handleTurn(request, env, ctx) {
  const { body, error } = await readBody(request);
  if (error) return json({ error }, error === "too_large" ? 413 : 400);
  const requestId = String(body.request_id || "").slice(0, 64);
  if (!requestId) return json({ error: "missing_request_id" }, 400);

  const save = (await loadSave(env)) || newGame(SLOT);
  // Same request again (app closed mid-turn, network retry): hand back the stored result, no second AI call.
  if (save.last?.request_id === requestId) return json({ ...save.last.response, replay: true });
  if (body.turn !== save.turn) return json({ error: "stale", state: await stateWithSpend(env, save) }, 409);
  if (save.over) return json({ error: "game_over", state: await stateWithSpend(env, save) }, 409);
  await adoptSummary(env, save);
  if (save.fm) await adoptFactMerge(env, save);

  const action = resolveAction(save, body.action);
  if (!action) return json({ error: "bad_action" }, 400);
  // Code decides the dice (seeded by game, turn and option, so a retried turn rolls the same) and every quest step before the AI writes.
  const plan = planTurn(save, action);

  const fallback = async (reason, detail) => {
    save.counters.fallbacks++;
    // Keep the last few reasons: the phone shows the note only once, so More → Prompt is where they can be looked up later.
    save.fallback_log = [...(save.fallback_log || []), { ts: new Date().toISOString(), turn: save.turn, reason, detail: detail ? String(detail).slice(0, 300) : undefined }].slice(-5);
    await storeSave(env, save);
    const f = fallbackTurn(save, reason);
    console.log(JSON.stringify({ event: "fallback", reason, detail, turn: save.turn }));
    return json({ fallback: true, reason, detail: detail ? String(detail).slice(0, 300) : undefined, turn: { n: save.turn, action: action.text, dice: null, narration: f.narration }, state: await stateWithSpend(env, save) });
  };

  if (!env.ANTHROPIC_API_KEY) return fallback("no_api_key");
  if (!(await underCap(env))) return fallback("daily_cap");

  const result = await runTurn(env, save, action, plan.dice, plan);
  await addSpend(env, result.cost);
  console.log(JSON.stringify({ event: "turn", turn: save.turn + 1, ok: !!result.turn, model: result.model, attempts: result.attempts, usage: result.usage, cost: result.cost, error: result.error }));
  if (!result.turn) return fallback("ai_failed", result.error);

  const { record, events, dice, factsAdded } = settleTurn(save, action, plan, result);
  const n = record.n;
  const response = { turn: { n, action: action.text, dice, narration: record.narration }, facts_added: factsAdded, events, state: await stateWithSpend(env, save) };
  save.last = { request_id: requestId, response };
  await archiveTurn(env, save, record);
  const due = summaryDue(save);
  const roomLeft = await underCap(env);
  const job = due && roomLeft ? summaryJob(save, due) : null;
  // One background job a turn (they share the spend counter): a summary when one is due, otherwise a fact merge.
  const crowded = !job && roomLeft ? mergeDue(save) : null;
  const fmJob = crowded ? mergeJob(save, crowded) : null;
  await storeSave(env, save);
  // After the reply: fold old turns into the rolling summary, or tidy an entity's facts (own KV keys, adopted by the next request).
  if (job) ctx.waitUntil(updateSummary(env, job, (usd) => addSpend(env, usd)));
  if (fmJob) ctx.waitUntil(runFactMerge(env, fmJob, (usd) => addSpend(env, usd)));
  return json(response);
}

// One AI call opens a new game: who the character is and why they are here, from the region's stake (or, for the fixed
// opening, their background, drive and flaw). If it cannot run (no key, daily cap, a failed reply) the code-built scene stays.
async function writeIntro(env, save) {
  if (!env.ANTHROPIC_API_KEY || !(await underCap(env))) return;
  const r = await runTurn(env, save, INTRO_ACTION, null, null);
  await addSpend(env, r.cost);
  console.log(JSON.stringify({ event: "intro", ok: !!r.turn, usage: r.usage, cost: r.cost, error: r.error }));
  if (!r.turn) return;
  const t = r.turn;
  save.scene = { location_id: save.scene.location_id, narration: t.narration, options: t.options };
  const created = [];
  applyNewFacts(save, t.new_facts, 1, created);
  afterFacts(save, introPlan(save), t, created, []);
  save.summary.text = fit(save.world ? `${save.summary.text} ${t.narration.join(" ")}` : t.narration.join(" "), BUDGET.summary);
  save.intro = { cost: r.cost, narration: t.narration, options: t.options }; // kept for the playtest report; turn 1 has no record
}

// New game: with an API key, one call writes the region and story plan (1-2 minutes), then the opening scene.
// The response streams a space every few seconds so the phone does not give up on a quiet connection; the JSON comes at the end
// (leading spaces are valid JSON). The current game is replaced only when the new one is ready.
async function handleNew(request, env, ctx) {
  const { body, error } = await readBody(request);
  if (error) return json({ error }, 400);
  if (body.confirm !== true) return json({ error: "confirm_required" }, 400);
  const picked = body.character === undefined ? { character: DEFAULT_CHARACTER } : validateCharacter(body.character);
  if (picked.error) return json({ error: "bad_character", field: picked.error }, 400);
  const save = newGame(SLOT, undefined, picked.character);
  const replace = async () => {
    const old = await env.GAME.get(`save:${SLOT}`);
    if (old) await env.GAME.put(`bak:${SLOT}`, old); // one step back, in case of a mis-tap
    await storeSave(env, save);
  };
  if (!env.ANTHROPIC_API_KEY || !(await underCap(env))) {
    await writeIntro(env, save);
    await replace();
    return json(await stateWithSpend(env, save));
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const ping = setInterval(() => writer.write(enc.encode(" ")).catch(() => {}), Number(env.KEEPALIVE_MS) || KEEPALIVE_MS); // the variable is for tests
  const work = (async () => {
    let out;
    try {
      const g = await generateRegion(env, picked.character, save.id);
      await addSpend(env, g.cost);
      console.log(JSON.stringify({ event: "region", ok: !!g.spec, model: g.model, attempts: g.attempts, usage: g.usage, cost: g.cost, error: g.error }));
      if (!g.spec) out = { error: "generation_failed", detail: g.error };
      else {
        applyRegion(save, g.spec, { model: g.model, cost: g.cost });
        await writeIntro(env, save);
        await replace();
        out = await stateWithSpend(env, save);
      }
    } catch (err) {
      console.log(JSON.stringify({ event: "error", message: String(err?.stack || err) }));
      out = { error: "server_error" };
    }
    clearInterval(ping);
    try { await writer.write(enc.encode(JSON.stringify(out))); await writer.close(); } catch {}
  })();
  ctx.waitUntil(work);
  return new Response(readable, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

// Character screen actions (no AI call): pick a level-up reward, use a talent, drop an item.
async function handleChar(request, env) {
  const { body, error } = await readBody(request);
  if (error) return json({ error }, 400);
  const save = await loadSave(env);
  if (!save) return json({ error: "no_game" }, 404);
  let r;
  if (body.act === "pick") r = applyPick(save, { kind: body.kind, stat: body.stat, talent: body.talent });
  else if (body.act === "use") r = useTalent(save, String(body.id || ""));
  else if (body.act === "drop") r = dropItem(save, String(body.id || ""));
  else return json({ error: "bad_act" }, 400);
  if (!r.ok) return json({ error: r.error, state: await stateWithSpend(env, save) }, 409);
  await storeSave(env, save);
  return json({ events: r.events, state: await stateWithSpend(env, save) });
}

// Quests panel actions (no AI call): pin a quest as the focused one.
async function handleQuest(request, env) {
  const { body, error } = await readBody(request);
  if (error) return json({ error }, 400);
  const save = await loadSave(env);
  if (!save) return json({ error: "no_game" }, 404);
  if (body.act !== "focus") return json({ error: "bad_act" }, 400);
  if (!setFocus(save, String(body.id || ""))) return json({ error: "not_open", quests: publicQuests(save) }, 409);
  await storeSave(env, save);
  return json({ quests: publicQuests(save), state: await stateWithSpend(env, save) });
}

// The epilogue, written once when the story is over (one AI call; a plain one without an API key).
async function handleEpilogue(env) {
  const save = await loadSave(env);
  if (!save) return json({ error: "no_game" }, 404);
  if (!save.over) return json({ error: "not_over", state: await stateWithSpend(env, save) }, 409);
  if (!save.over.epilogue) {
    if (!env.ANTHROPIC_API_KEY) save.over.epilogue = plainEpilogue(save);
    else {
      if (!(await underCap(env))) return json({ error: "daily_cap", state: await stateWithSpend(env, save) }, 503);
      const r = await writeEpilogue(env, save, save.over);
      await addSpend(env, r.cost);
      console.log(JSON.stringify({ event: "epilogue", ok: !!r.paragraphs, usage: r.usage, cost: r.cost, error: r.error }));
      if (!r.paragraphs) return json({ error: "epilogue_failed", detail: r.error, state: await stateWithSpend(env, save) }, 502);
      save.over.epilogue = r.paragraphs;
      save.over.cost = r.cost;
    }
    await storeSave(env, save);
  }
  return json(await stateWithSpend(env, save));
}

// Playtest report (More → Playtest log): the last turns, the hidden option tiers, the ledger, as text to paste into a chat. No AI call.
async function handlePlaytest(url, env) {
  const save = (await loadSave(env)) || newGame(SLOT);
  const last = Math.max(1, Math.min(PLAYTEST_MAX, parseInt(url.searchParams.get("last"), 10) || 25));
  const { keys } = archiveKeys(save, last);
  const records = [...save.recent];
  for (const k of keys) records.push(...((await env.GAME.get(k, "json")) || []));
  const spend = { today: Math.round((await getSpend(env)) * 10000) / 10000, cap: capUSD(env) };
  const model = env.TURN_MODEL || DEFAULT_TURN_MODEL, effort = env.TURN_EFFORT || "low";
  const r = playtestReport(save, records, last, { spend, model, effort });
  return json({ text: r.text, turns: r.turns, bytes: r.text.length, last, max: PLAYTEST_MAX, model, effort });
}

// Debug view: the prompt the next turn would send (for an example free-text action), section by section, plus the last turn's real usage.
async function handlePrompt(env) {
  const save = (await loadSave(env)) || newGame(SLOT);
  const sum = await adoptSummary(env, save);
  const action = { kind: "custom", text: "Look around" };
  const p = buildPrompt(save, action, null, planTurn(save, action));
  const last = save.recent.at(-1);
  // The JSON schema travels with every request and is not part of the prompt text; count it, then scale by the real/estimated ratio of the last turn.
  const sections = [...p.sections, { name: "Output schema (sent with every request)", text: SCHEMA_TEXT, tokens: SCHEMA_TOKENS, budget: null, cached: false }];
  const est = { cached: p.est.cached, volatile: p.est.volatile + SCHEMA_TOKENS, total: p.est.total + SCHEMA_TOKENS };
  const u = last?.usage;
  const real = u ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : 0;
  const ratio = real && last.est_input ? Math.round((real / last.est_input) * 100) / 100 : null;
  if (ratio) est.scaled = Math.round(est.total * ratio);
  const due = summaryDue(save);
  return json({
    turn: save.turn,
    example_action: action.text,
    model: env.TURN_MODEL || DEFAULT_TURN_MODEL,
    effort: env.TURN_EFFORT || "low",
    summary_model: env.SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL,
    region: save.world ? { model: save.world.model, effort: env.REGION_EFFORT || DEFAULT_REGION_EFFORT, cost: save.world.cost } : null,
    budget: BUDGET,
    est,
    ratio,
    sections,
    last: last ? { n: last.n, model: last.model, attempts: last.attempts, usage: last.usage, cost: last.cost, est_input: last.est_input, real_input: real || undefined } : null,
    summary: {
      through_turn: save.summary.through_turn,
      words: save.summary.text ? save.summary.text.split(/\s+/).length : 0,
      next_due_at_turn: due ? save.turn : save.summary.through_turn + RECENT_PROMPT + SUMMARY_BATCH,
      last_cost: sum?.cost, last_model: sum?.model, error: sum?.error,
    },
    counters: save.counters,
    fallbacks: save.fallback_log || [],
  });
}

async function route(request, env, ctx) {
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
  if (pathname === "/api/ledger" && request.method === "GET") {
    const save = (await loadSave(env)) || newGame(SLOT);
    return json(ledgerView(save));
  }
  if (pathname === "/api/quests" && request.method === "GET") {
    const save = (await loadSave(env)) || newGame(SLOT);
    return json(publicQuests(save));
  }
  if (pathname === "/api/prompt" && request.method === "GET") return handlePrompt(env);
  if (pathname === "/api/playtest" && request.method === "GET") return handlePlaytest(new URL(request.url), env);
  if (pathname === "/api/creation" && request.method === "GET") return json(creationTables());
  if (pathname === "/api/char" && request.method === "POST") return handleChar(request, env);
  if (pathname === "/api/quest" && request.method === "POST") return handleQuest(request, env);
  if (pathname === "/api/epilogue" && request.method === "POST") return handleEpilogue(env);
  if (pathname === "/api/turn" && request.method === "POST") return handleTurn(request, env, ctx);
  if (pathname === "/api/new" && request.method === "POST") return handleNew(request, env, ctx);
  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(env, request.headers.get("Origin") || "");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let res;
    try {
      res = await route(request, env, ctx);
    } catch (err) {
      console.log(JSON.stringify({ event: "error", message: String(err?.stack || err) }));
      res = json({ error: "server_error" }, 500);
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};
