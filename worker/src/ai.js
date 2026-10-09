// One AI turn: prompt assembly, structured JSON output, validation with retry, safe fallback.
import Anthropic from "@anthropic-ai/sdk";
import { STATS, ENTITY_TYPES, FACT_KINDS, OPTION_KINDS, OPTION_TIERS, OPTION_EDGES, OPTION_VALUES, CLASSIFICATIONS, CHANGE_KINDS, CUSTOM_TIERS, RESULTS } from "./schema.js";
import { tierFromNumber } from "./content.js";
import { activeFailures } from "./rules.js";
import { norm } from "./ledger.js";
import { buildPrompt } from "./prompt.js";

export { buildPrompt };

export const DEFAULT_TURN_MODEL = "claude-sonnet-5-5";
export const DEFAULT_SUMMARY_MODEL = "claude-haiku-5-5"; // rolling summary (summary.js)
const MAX_ATTEMPTS = 2; // first try + one retry
const MAX_TOKENS = 4000; // thinking + JSON; bounds the cost of a single call

// USD per million tokens: [input, output, cache write (5 min), cache read]. Unknown models are billed as Opus.
const PRICES = {
  "claude-sonnet-5-5": [2, 10, 2.5, 0.2],
  "claude-sonnet-5": [2, 10, 2.5, 0.2],
  "claude-haiku-5-5": [0.1, 0.5, 0.125, 0.01],
  "claude-opus-5-5": [4, 20, 5, 0.2],
};

export function costUSD(model, u = {}) {
  const [i, o, w, r] = PRICES[model] || PRICES["claude-opus-5-5"];
  return ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_creation_input_tokens || 0) * w + (u.cache_read_input_tokens || 0) * r) / 1e6;
}

const str = { type: "string" };
export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["narration", "options", "classification", "custom_roll", "state_changes", "new_facts", "profiles", "side_quest", "quest_flags"],
  properties: {
    narration: { type: "array", items: str },
    options: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["text", "kind", "stat", "tier", "edge", "edge_why", "value", "quest", "npc"],
        properties: {
          text: str, kind: { type: "string", enum: OPTION_KINDS }, stat: { type: "string", enum: STATS },
          tier: { type: "string", enum: OPTION_TIERS }, edge: { type: "string", enum: OPTION_EDGES }, edge_why: str,
          value: { type: "string", enum: OPTION_VALUES }, quest: str, npc: str,
        },
      },
    },
    classification: { type: "string", enum: CLASSIFICATIONS },
    custom_roll: {
      type: "object", additionalProperties: false, required: ["stat", "tier", "value", "result"],
      properties: { stat: { type: "string", enum: STATS }, tier: { type: "string", enum: CUSTOM_TIERS }, value: { type: "string", enum: ["scene", "advance"] }, result: { type: "string", enum: RESULTS } },
    },
    state_changes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["actor", "kind", "amount", "text", "reason"],
        properties: { actor: str, kind: { type: "string", enum: CHANGE_KINDS }, amount: { type: "integer" }, text: str, reason: str },
      },
    },
    new_facts: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["entity", "type", "kind", "fact", "location", "was"],
        properties: { entity: str, type: { type: "string", enum: ENTITY_TYPES }, kind: { type: "string", enum: FACT_KINDS }, fact: str, location: str, was: str },
      },
    },
    profiles: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["npc", "want", "fear", "secret", "voice"], properties: { npc: str, want: str, fear: str, secret: str, voice: str } },
    },
    side_quest: { type: "object", additionalProperties: false, required: ["title", "goal", "giver"], properties: { title: str, goal: str, giver: str } },
    quest_flags: { type: "array", items: str },
  },
};

// The schema travels with every request; count it so the Prompt view's estimate is closer to the real input.
export const SCHEMA_TEXT = JSON.stringify(OUTPUT_SCHEMA);
export const SCHEMA_TOKENS = Math.ceil(SCHEMA_TEXT.length / 4);

// Check the parsed reply and normalize it. Returns { turn, errors }; errors means retry.
// plan (quest.js planTurn) carries the free-text roll table: the result the AI reports must match it.
export function validateTurn(raw, save, plan = null) {
  const errors = [];
  if (!raw || typeof raw !== "object") return { turn: null, errors: ["reply is not a JSON object"] };
  // A paragraph that ends on a quote mark it never opened loses it ("...on the way.\"").
  const tidy = (p) => { p = String(p).trim(); return (p.match(/"/g) || []).length % 2 === 1 && p.endsWith('"') ? p.slice(0, -1).trimEnd() : p; };
  const narration = (Array.isArray(raw.narration) ? raw.narration : []).map(tidy).filter(Boolean).slice(0, 5);
  if (!narration.length) errors.push("narration is empty");
  if (narration.join(" ").length > 3000) errors.push("narration is too long (keep it under 140 words)");

  const seen = new Set();
  const options = [];
  let edged = false, quests = 0, costly = 0;
  const sides = save.quests?.side || {};
  for (const o of Array.isArray(raw.options) ? raw.options : []) {
    const text = String(o?.text || "").trim().slice(0, 120);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    // At most one option a turn carries an edge, and only with a reason; the AI proposes, code limits.
    let edge = OPTION_EDGES.includes(o.edge) ? o.edge : "none";
    const edge_why = String(o.edge_why || "").trim().slice(0, 60);
    if (edge !== "none" && (edged || !edge_why)) edge = "none";
    if (edge !== "none") edged = true;
    // Options that matter: at most two quest options a turn, at most one costly; a quest option names a quest that can move.
    let value = OPTION_VALUES.includes(o.value) ? o.value : "scene";
    let quest = String(o.quest || "").trim();
    if (value === "advance" || value === "costly") {
      if (quest !== "main" && !(sides[quest] && ["active", "hidden"].includes(sides[quest].status))) quest = save.quests?.focus || "main";
      if (value === "costly" && costly) value = "advance";
      if (quests >= 2) value = "scene";
    }
    if (value === "advance" || value === "costly") { quests++; if (value === "costly") costly++; } else quest = "";
    options.push({
      text,
      kind: OPTION_KINDS.includes(o.kind) ? o.kind : "other",
      stat: STATS.includes(o.stat) ? o.stat : "wits",
      tier: OPTION_TIERS.includes(o.tier) ? o.tier : o.difficulty ? tierFromNumber(Number(o.difficulty)) : "standard",
      edge,
      edge_why: edge === "none" ? "" : edge_why,
      value, quest, npc: String(o.npc || "").trim().slice(0, 60),
    });
  }
  if (options.length < 3) errors.push(`need 3 or 4 distinct options, got ${options.length}`);

  const classification = CLASSIFICATIONS.includes(raw.classification) ? raw.classification : "allowed";
  // A free-text action: code rolled the die; the AI picked stat and tier and must narrate the result that table gives.
  const cr = raw.custom_roll && typeof raw.custom_roll === "object" ? raw.custom_roll : {};
  const custom_roll = { stat: STATS.includes(cr.stat) ? cr.stat : "wits", tier: CUSTOM_TIERS.includes(cr.tier) ? cr.tier : "none", value: cr.value === "advance" ? "advance" : "scene", result: RESULTS.includes(cr.result) ? cr.result : "none" };
  if (plan?.custom) {
    if (classification === "blocked") custom_roll.tier = "none";
    if (custom_roll.tier !== "none") {
      const want = plan.custom.rows[custom_roll.stat].results[custom_roll.tier];
      if (custom_roll.result !== want) errors.push(`custom_roll: ${custom_roll.stat} at ${custom_roll.tier} with d20 ${plan.custom.die} is "${want}", not "${custom_roll.result}"; narrate that result`);
    } else custom_roll.value = "scene";
  }
  const state_changes = (Array.isArray(raw.state_changes) ? raw.state_changes : [])
    .filter((c) => c && CHANGE_KINDS.includes(c.kind) && save.actors[c.actor || "pc"])
    .slice(0, 10)
    .map((c) => ({ actor: c.actor || "pc", kind: c.kind, amount: Math.round(Number(c.amount) || 0), text: String(c.text || "").slice(0, 80), reason: String(c.reason || "").slice(0, 120) }));
  // A fact needs a lasting kind (no events) and an entity gets at most two facts a turn; an entity named without a valid fact is still recorded.
  const perEntity = new Map();
  const new_facts = (Array.isArray(raw.new_facts) ? raw.new_facts : [])
    .filter((f) => f && String(f.entity || "").trim())
    .slice(0, 15)
    .map((f) => {
      const entity = String(f.entity).trim().slice(0, 80);
      const key = norm(entity);
      const used = perEntity.get(key) || 0;
      const kind = FACT_KINDS.includes(f.kind) ? f.kind : "";
      const keep = kind && used < 2 && String(f.fact || "").trim();
      if (keep) perEntity.set(key, used + 1);
      return { entity, type: ENTITY_TYPES.includes(f.type) ? f.type : "lore", kind, fact: keep ? String(f.fact).trim() : "", location: String(f.location || "").trim().slice(0, 80), was: String(f.was || "").trim().slice(0, 80) };
    });
  const quest_flags = (Array.isArray(raw.quest_flags) ? raw.quest_flags : []).map((s) => String(s).slice(0, 60)).filter(Boolean).slice(0, 8);
  const clip = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
  const profiles = (Array.isArray(raw.profiles) ? raw.profiles : []).filter((p) => p && clip(p.npc, 60)).slice(0, 2)
    .map((p) => ({ npc: clip(p.npc, 60), want: clip(p.want, 120), fear: clip(p.fear, 120), secret: clip(p.secret, 160), voice: clip(p.voice, 100) }));
  const sq = raw.side_quest && typeof raw.side_quest === "object" ? raw.side_quest : {};
  const side_quest = { title: clip(sq.title, 80), goal: clip(sq.goal, 200), giver: clip(sq.giver, 60) };
  if (!side_quest.goal) side_quest.title = "";

  return { turn: errors.length ? null : { narration, options: options.slice(0, 4), classification, custom_roll, state_changes, new_facts, profiles, side_quest, quest_flags }, errors };
}

// Option variety without extra calls: drop repeats of recently offered options (while 3 remain) and count low-variety turns.
const words = (t) => new Set(norm(t).split(" ").filter((w) => w.length > 2));
function similar(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return norm(a) === norm(b);
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.max(A.size, B.size) >= 0.75;
}

export function varyOptions(save, options) {
  // Recently offered options and approaches that just failed are not offered again unchanged.
  const recent = [...save.scene.options, ...save.recent.slice(-3).flatMap((t) => t.options)].map((o) => o.text).concat(activeFailures(save).map((f) => f.text));
  let removable = options.length - 3;
  const kept = options.filter((o) => {
    // A quest option stays even if it repeats: it is the way forward.
    if (removable > 0 && o.value !== "advance" && o.value !== "costly" && recent.some((r) => similar(o.text, r))) { removable--; return false; }
    return true;
  });
  const kinds = new Set(kept.map((o) => o.kind)).size;
  return { options: kept, dropped: options.length - kept.length, low: kinds < Math.min(3, kept.length) };
}

const FALLBACK_OK = /^claude-(sonnet-5-5|opus-5-5|opus-5|fable-5-1)$/;

export function makeClient(env, opts = {}) {
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL || undefined,
    // Organization-level keys must name a workspace on every request; workspace keys don't need this.
    defaultHeaders: env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID.trim() } : undefined,
    maxRetries: 1,
    timeout: opts.timeout || 60_000,
  });
}

// Calls the model up to MAX_ATTEMPTS times. Returns { turn, model, usage, cost, attempts, error, est }.
// cost covers every billed attempt, failed ones included, so the daily cap sees them.
export async function runTurn(env, save, action, dice, plan = null) {
  const model = env.TURN_MODEL || DEFAULT_TURN_MODEL;
  const client = makeClient(env);
  const { system, messages, est } = buildPrompt(save, action, dice, plan);
  let useFallbacks = FALLBACK_OK.test(model);
  let lastError = "";
  let total = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let cost = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // The retry note goes after the cached blocks, so a retry still reads the cache.
    const msgs = attempt === 1 ? messages : [
      { role: "user", content: [...messages[0].content, { type: "text", text: `Your previous reply was rejected: ${lastError}. Reply again, following the rules exactly.` }] },
    ];
    const params = {
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: msgs,
      output_config: { effort: env.TURN_EFFORT || "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    };
    let res;
    try {
      res = useFallbacks
        // Server-side refusal fallback: a declined turn is re-run on another model instead of failing.
        ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
        : await client.messages.create(params);
    } catch (err) {
      lastError = `API error ${err.status || ""} ${String(err.message || err).slice(0, 200)}`;
      if (err.status === 400 && /fallback/i.test(String(err.message))) useFallbacks = false;
      if (err.status === 401 || err.status === 403) break;
      continue;
    }
    for (const k of Object.keys(total)) total[k] += res.usage?.[k] || 0;
    cost += costUSD(model, res.usage);
    if (res.stop_reason === "refusal") { lastError = `refused (${res.stop_details?.category || "no category"})`; continue; }
    if (res.stop_reason === "max_tokens") { lastError = "ran out of tokens; keep it shorter"; continue; }
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let raw;
    try { raw = JSON.parse(text); } catch { lastError = "reply was not valid JSON"; continue; }
    const { turn, errors } = validateTurn(raw, save, plan);
    if (turn) return { turn, model: res.model || model, usage: total, cost, attempts: attempt, est: est.total + SCHEMA_TOKENS };
    lastError = errors.join("; ");
  }
  return { turn: null, model, usage: total, cost, attempts: MAX_ATTEMPTS, error: lastError, est: est.total + SCHEMA_TOKENS };
}

// Safe turn when the AI is unavailable: nothing in the save changes, the player sees the same options again.
const FALLBACK_LINES = [
  "The moment stretches. Rain ticks against the shutters while you gather your thoughts.",
  "You pause, weighing your next move. Nothing around you seems to be in a hurry.",
  "A gust rattles the door and the room settles again. The choice is still yours.",
];

export function fallbackTurn(save, reason) {
  return {
    narration: [FALLBACK_LINES[save.turn % FALLBACK_LINES.length]],
    options: save.scene.options.map((o) => o.text),
    reason,
  };
}

