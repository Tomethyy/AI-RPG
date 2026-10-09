// Fact merge: when an entity holds more than FACT_CAP facts, a cheap model folds them into a short list of lasting truths.
// Same pattern as the rolling summary: it runs after the reply (ctx.waitUntil), writes only its own key "fm:<game id>",
// and the next request adopts it, so it can never overwrite a turn.
import { FACT_CAP, norm } from "./ledger.js";
import { makeClient, costUSD, DEFAULT_SUMMARY_MODEL } from "./ai.js";

export const FACT_TARGET = 5;
const IN_FLIGHT_MS = 120_000;

const RULES = `You tidy the facts stored about one person, place, faction or item in a fantasy RPG. Merge duplicates and near-duplicates. Drop moment-to-moment detail (what someone held, wore, sat on or said in one scene). Keep lasting truths: what it is, what it wants, relationships, revealed secrets, status changes, and where it stands now. Keep the oldest identity fact first.

- At most ${FACT_TARGET} facts, one short line each.
- Use names exactly as written. Add nothing that is not in the input.

Reply with the facts only, one per line, no bullets or numbering.`;

export const fmKey = (save) => `fm:${save.id}`;

// The entity with the most facts above the cap, unless a merge is already running.
export function mergeDue(save, now = Date.now()) {
  if (save.fm && now - Date.parse(save.fm.requested_at || 0) < IN_FLIGHT_MS) return null;
  let best = null;
  for (const e of Object.values(save.ledger.entities)) if (e.facts.length > FACT_CAP && (!best || e.facts.length > best.facts.length)) best = e;
  return best;
}

export function mergeJob(save, e) {
  save.fm = { entity: e.id, requested_at: new Date().toISOString() };
  return { id: save.id, entity: e.id, name: e.name, type: e.type, turn: save.turn, facts: e.facts.map((f) => f.text), language: save.settings.language };
}

// Take a finished merge into the save. Facts added after the job started are kept after the merged ones.
export async function adoptFactMerge(env, save) {
  const r = await env.GAME.get(fmKey(save), "json");
  if (!r) return null;
  const e = save.ledger.entities[r.entity];
  if (r.facts?.length && e) {
    const added = e.facts.filter((f) => f.turn > r.turn && !r.facts.some((t) => norm(t) === norm(f.text)));
    e.facts = [...r.facts.map((text) => ({ text, turn: r.turn })), ...added];
    save.counters.fact_merges = (save.counters.fact_merges || 0) + 1;
  }
  save.fm = null;
  await env.GAME.delete(fmKey(save));
  return r;
}

export function parseFacts(text) {
  return String(text || "").split("\n").map((l) => l.replace(/^[\s\-*•\d.)]+/, "").trim()).filter((l) => l.length > 3).map((l) => l.slice(0, 300)).slice(0, FACT_TARGET);
}

export async function runFactMerge(env, job, addSpend) {
  const key = `fm:${job.id}`;
  const model = env.SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL;
  try {
    const res = await makeClient(env).messages.create({
      model, max_tokens: 800, system: RULES,
      messages: [{ role: "user", content: `Write in ${job.language}.\n${job.name} (${job.type}). Facts:\n${job.facts.map((f) => "- " + f).join("\n")}` }],
      output_config: { effort: "low" },
    });
    await addSpend(costUSD(model, res.usage));
    if (res.stop_reason === "refusal") throw new Error("refused");
    const facts = parseFacts(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
    if (facts.length < 2) throw new Error("merge too short");
    await env.GAME.put(key, JSON.stringify({ entity: job.entity, turn: job.turn, facts, model: res.model || model, usage: res.usage, at: new Date().toISOString() }));
    console.log(JSON.stringify({ event: "fact_merge", entity: job.entity, from: job.facts.length, to: facts.length, usage: res.usage }));
  } catch (err) {
    // No result is stored; the in-flight marker times out and the merge is tried again later.
    console.log(JSON.stringify({ event: "fact_merge_failed", entity: job.entity, error: String(err?.message || err).slice(0, 200) }));
  }
}
