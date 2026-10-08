// One AI turn: prompt assembly, structured JSON output, validation with retry, safe fallback.
import Anthropic from "@anthropic-ai/sdk";
import { STATS, ENTITY_TYPES, OPTION_KINDS, CLASSIFICATIONS, CHANGE_KINDS, locationName } from "./schema.js";
import { relevantEntities } from "./ledger.js";

export const DEFAULT_TURN_MODEL = "claude-sonnet-5-5";
export const DEFAULT_SUMMARY_MODEL = "claude-haiku-5-5"; // used by the rolling summary (Phase 4)
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
  required: ["narration", "options", "classification", "state_changes", "new_facts", "quest_flags"],
  properties: {
    narration: { type: "array", items: str },
    options: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["text", "kind", "stat", "difficulty"],
        properties: { text: str, kind: { type: "string", enum: OPTION_KINDS }, stat: { type: "string", enum: STATS }, difficulty: { type: "integer" } },
      },
    },
    classification: { type: "string", enum: CLASSIFICATIONS },
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
        required: ["entity", "type", "fact", "location"],
        properties: { entity: str, type: { type: "string", enum: ENTITY_TYPES }, fact: str, location: str },
      },
    },
    quest_flags: { type: "array", items: str },
  },
};

// Static part of the system prompt: identical every turn, so it is cached.
const RULES = `You are the narrator of a solo text RPG played on a phone. The app owns all state, rules and dice; you only narrate and propose.

Each turn you get the character sheet, the story summary, the quest, known facts, recent turns, and the player's action with its dice result (if any). Reply with one JSON object.

narration: 1-3 short paragraphs (about 60-140 words total), second person, present tense. Narrate the outcome of the action, honoring the dice result exactly: a failure must cost or complicate something, a success must move things forward. Never contradict the known facts. Do not restate the previous scene or the player's action. End on a concrete situation the player can act on.

options: 3 or 4 next actions, specific to this scene, each under 12 words, in the player's voice ("Ask Maren about the satchel"). Make them differ in kind (social, explore, direct, cautious, other). At least one must advance the focused quest. Never hint at risk, odds or reward in the text. Do not repeat recently offered options. Give each a stat (might = force and physical feats, wits = perception, knowledge and talk, grit = endurance, nerve and stealth) and a difficulty from 6 (easy) to 18 (very hard).

classification: for a free-text action, "allowed", "conditional" (possible but harder), or "blocked" (conflicts with established facts, skips the story, or is implausible). Never answer a blocked action with a bare refusal: show the in-world consequence, a reaction, or why it cannot work. For options you offered, use "allowed".

state_changes: changes the story implies, as proposals the app will check. actor is "pc" for the player. kind: hp (amount = change, negative for harm), xp (amount gained), item_add / item_remove (text = item name, amount = quantity), condition_add / condition_remove (text = condition), move (text = name of the new location). reason: a few words. Empty list if nothing changed.

new_facts: EVERY named person, place, faction, item or quest you introduced or revealed this turn, and any new fact about a known one, one short fact per entry (entity = its name; location = the place it is at, or "" if unknown or not a physical thing). Reusing a known name is fine. If you named it, list it.

quest_flags: short flags when the story meets a milestone condition, e.g. "learned_who_burned_bridge". Empty list otherwise.`;

function sign(n) { return (n >= 0 ? "+" : "") + n; }

function characterBlock(save) {
  const lines = [];
  for (const id of save.party) {
    const a = save.actors[id];
    const eq = Object.entries(a.equipment).filter(([, v]) => v).map(([slot, v]) => `${slot} ${v.name}`).join(", ") || "none";
    const inv = a.inventory.map((i) => (i.qty > 1 ? `${i.name} x${i.qty}` : i.name)).join(", ") || "nothing";
    lines.push(`${a.name} [${a.id}${a.kind === "pc" ? ", the player" : ""}]: level ${a.level}, XP ${a.xp}, HP ${a.hp}/${a.hp_max}. ` +
      STATS.map((s) => `${s} ${sign(a.stats[s])}`).join(", ") + `.\nEquipment: ${eq}. Inventory: ${inv}. Conditions: ${a.conditions.join(", ") || "none"}.`);
  }
  return lines.join("\n");
}

function questBlock(save) {
  const q = save.quests.main;
  const cur = q.milestones[q.current];
  const next = cur?.next.map((id) => q.milestones[id]?.title).filter(Boolean)[0];
  const focus = save.quests.focus === "main" ? `the main quest (${q.title})` : save.quests.side[save.quests.focus]?.title || q.title;
  return `Main quest: ${q.title}\nCurrent milestone: ${cur ? `${cur.title} (met when: ${cur.conditions.join("; ")})` : "none"}\n` +
    (next ? `Hint of what follows: ${next}\n` : "") + `Focused quest: ${focus}`;
}

function rollText(dice) {
  if (!dice) return "No roll.";
  return `d20 ${dice.die} ${sign(dice.mod)} ${dice.label} = ${dice.die + dice.mod} vs difficulty ${dice.dc}: ${dice.success ? "SUCCESS" : "FAILURE"}.`;
}

export function buildPrompt(save, action, dice) {
  const system = [
    { type: "text", text: RULES },
    {
      type: "text",
      text: `Setting: ${save.settings.setting}\nTone: ${save.settings.tone}\nWrite everything in ${save.settings.language}.`,
      cache_control: { type: "ephemeral" },
    },
  ];
  const ledger = relevantEntities(save, action.text);
  const ledgerText = ledger.map((e) => `- ${e.name} (${e.type}${e.where ? `, at ${e.where}` : ""}): ${e.facts.join("; ") || "no facts yet"}`).join("\n") || "(none yet)";
  const earlier = save.recent.filter((t) => t.n < save.turn);
  const recentText = earlier.map((t) => `Turn ${t.n}. Player: ${t.action.text}. ${rollText(t.dice)}\n${t.narration.join(" ")}`).join("\n\n") || "(none)";
  const current = new Set(save.scene.options.map((o) => o.text));
  const recentOptions = [...new Set(save.recent.slice(-4).flatMap((t) => t.options.map((o) => o.text)))].filter((t) => !current.has(t));
  const led = save.recent.at(-1)?.n === save.turn ? save.recent.at(-1) : null;
  const kindLabel = { option: "chose an offered option", custom: "typed a free-text action", look: "looks around", talk: "talks to someone nearby" }[action.kind];
  const user = [
    `## Character\n${characterBlock(save)}`,
    `## Story so far\n${save.summary.text || "(The story has just begun.)"}`,
    `## Quest\n${questBlock(save)}`,
    `## Known facts\n${ledgerText}`,
    `## Earlier turns\n${recentText}`,
    `## Current scene (turn ${save.turn}) at ${locationName(save, save.scene.location_id)}\n` +
      (led ? `Player: ${led.action.text}. ${rollText(led.dice)}\n` : "") + `${save.scene.narration.join("\n")}\nOptions shown: ${save.scene.options.map((o) => o.text).join(" | ")}`,
    recentOptions.length ? `## Recently offered options (do not repeat)\n${recentOptions.join(" | ")}` : "",
    `## Player action (the player ${kindLabel})\n"${action.text}"\nDice: ${rollText(dice)}\n\nWrite turn ${save.turn + 1}.`,
  ].filter(Boolean).join("\n\n");
  return { system, messages: [{ role: "user", content: user }] };
}

// Check the parsed reply and normalize it. Returns { turn, errors }; errors means retry.
export function validateTurn(raw, save) {
  const errors = [];
  if (!raw || typeof raw !== "object") return { turn: null, errors: ["reply is not a JSON object"] };
  const narration = (Array.isArray(raw.narration) ? raw.narration : []).map((p) => String(p).trim()).filter(Boolean).slice(0, 5);
  if (!narration.length) errors.push("narration is empty");
  if (narration.join(" ").length > 3000) errors.push("narration is too long (keep it under 140 words)");

  const seen = new Set();
  const options = [];
  for (const o of Array.isArray(raw.options) ? raw.options : []) {
    const text = String(o?.text || "").trim().slice(0, 120);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    options.push({
      text,
      kind: OPTION_KINDS.includes(o.kind) ? o.kind : "other",
      stat: STATS.includes(o.stat) ? o.stat : "wits",
      // Placeholder range; Phase 3 clamps by level and location danger.
      difficulty: Math.min(18, Math.max(6, Math.round(Number(o.difficulty) || 12))),
    });
  }
  if (options.length < 3) errors.push(`need 3 or 4 distinct options, got ${options.length}`);

  const classification = CLASSIFICATIONS.includes(raw.classification) ? raw.classification : "allowed";
  const state_changes = (Array.isArray(raw.state_changes) ? raw.state_changes : [])
    .filter((c) => c && CHANGE_KINDS.includes(c.kind) && save.actors[c.actor || "pc"])
    .slice(0, 10)
    .map((c) => ({ actor: c.actor || "pc", kind: c.kind, amount: Math.round(Number(c.amount) || 0), text: String(c.text || "").slice(0, 80), reason: String(c.reason || "").slice(0, 120) }));
  const new_facts = (Array.isArray(raw.new_facts) ? raw.new_facts : [])
    .filter((f) => f && String(f.entity || "").trim() && String(f.fact || "").trim())
    .slice(0, 15)
    .map((f) => ({ entity: String(f.entity).trim().slice(0, 80), type: ENTITY_TYPES.includes(f.type) ? f.type : "lore", fact: String(f.fact).trim(), location: String(f.location || "").trim().slice(0, 80) }));
  const quest_flags = (Array.isArray(raw.quest_flags) ? raw.quest_flags : []).map((s) => String(s).slice(0, 60)).filter(Boolean).slice(0, 8);

  return { turn: errors.length ? null : { narration, options: options.slice(0, 4), classification, state_changes, new_facts, quest_flags }, errors };
}

const FALLBACK_OK = /^claude-(sonnet-5-5|opus-5-5|opus-5|fable-5-1)$/;

// Calls the model up to MAX_ATTEMPTS times. Returns { turn, model, usage, cost, attempts, error }.
// cost covers every billed attempt, failed ones included, so the daily cap sees them.
export async function runTurn(env, save, action, dice) {
  const model = env.TURN_MODEL || DEFAULT_TURN_MODEL;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 1, timeout: 60_000 });
  const { system, messages } = buildPrompt(save, action, dice);
  let useFallbacks = FALLBACK_OK.test(model);
  let lastError = "";
  let total = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let cost = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const msgs = attempt === 1 ? messages : [
      { role: "user", content: messages[0].content + `\n\nYour previous reply was rejected: ${lastError}. Reply again, following the rules exactly.` },
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
    const { turn, errors } = validateTurn(raw, save);
    if (turn) return { turn, model: res.model || model, usage: total, cost, attempts: attempt };
    lastError = errors.join("; ");
  }
  return { turn: null, model, usage: total, cost, attempts: MAX_ATTEMPTS, error: lastError };
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

