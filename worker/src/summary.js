// Rolling summary: once SUMMARY_BATCH turns have left the prompt's verbatim window, a cheap model folds them into the summary.
// It runs after the reply is sent (ctx.waitUntil) and writes only its own key, "sum:<game id>", so it can never overwrite a turn.
// The next request adopts it into the save. A failed run is retried after IN_FLIGHT_MS; until then those turns stay in brief.
import { RECENT_PROMPT, SUMMARY_BATCH, ARCHIVE_CHUNK } from "./schema.js";
import { makeClient, costUSD, DEFAULT_SUMMARY_MODEL } from "./ai.js";
import { rollText } from "./prompt.js";

export const SUMMARY_WORDS = 250;
const HARD_WORDS = 320; // cut if the model overshoots
const MAX_TURNS_IN = 40; // a long backlog (an old save) is summarized from its newest 40 turns
const IN_FLIGHT_MS = 120_000;

const RULES = `You keep the running summary of a solo text RPG campaign. You get the summary so far and the turns played since. Rewrite them as one updated summary.

- At most ${SUMMARY_WORDS} words of plain prose, past tense, no headings or lists.
- Keep what matters later: what the player character did, learned and decided; promises, debts, allies and enemies; open threads and unanswered questions; where the character is now and why.
- Drop moment-to-moment detail, dice and descriptions. People and places are stored separately, so name them but don't describe them.
- As the story grows, compress older events harder and keep recent ones more detailed. Never drop an open thread.
- Use names exactly as written. Add nothing that is not in the input.

Reply with the summary text only.`;

export const sumKey = (save) => `sum:${save.id}`;

// Take a finished background summary into the save. Returns the stored record (for the debug view) or null.
export async function adoptSummary(env, save) {
  const s = await env.GAME.get(sumKey(save), "json");
  if (s && s.through_turn > save.summary.through_turn && s.text) {
    save.summary.text = s.text;
    save.summary.through_turn = s.through_turn;
    save.counters.summaries++;
  }
  return s;
}

// Which turns to summarize now, or null. Not while a run is still in flight.
export function summaryDue(save, now = Date.now()) {
  const s = save.summary;
  const to = save.turn - RECENT_PROMPT;
  if (to - s.through_turn < SUMMARY_BATCH) return null;
  if (s.requested_through > s.through_turn && now - Date.parse(s.requested_at || 0) < IN_FLIGHT_MS) return null;
  return { from: Math.max(s.through_turn + 1, to - MAX_TURNS_IN + 1), to };
}

// Everything the background run needs, copied now so later changes to the save don't matter.
export function summaryJob(save, due) {
  save.summary.requested_through = due.to;
  save.summary.requested_at = new Date().toISOString();
  const q = save.quests.main;
  return {
    id: save.id, ...due,
    text: save.summary.text, through: save.summary.through_turn,
    records: save.recent.filter((t) => t.n >= due.from && t.n <= due.to),
    language: save.settings.language,
    pc: save.actors[save.party[0]].name,
    quest: `${q.title} (current milestone: ${q.milestones[q.current]?.title || "none"})`,
  };
}

async function gatherTurns(env, job) {
  const have = new Map(job.records.map((t) => [t.n, t]));
  const missing = [];
  for (let n = job.from; n <= job.to; n++) if (!have.has(n)) missing.push(n);
  for (const chunk of new Set(missing.map((n) => Math.floor(n / ARCHIVE_CHUNK)))) {
    for (const t of (await env.GAME.get(`arc:${job.id}:${chunk}`, "json")) || []) if (t.n >= job.from && t.n <= job.to) have.set(t.n, t);
  }
  return [...have.values()].sort((a, b) => a.n - b.n);
}

function capWords(text, n) {
  const w = text.trim().split(/\s+/);
  return w.length <= n ? text.trim() : w.slice(0, n).join(" ") + " …";
}

export function summaryPrompt(job, turns) {
  const lines = turns.map((t) => `Turn ${t.n}. Player: ${t.action.text}. ${rollText(t.dice)}\n${t.narration.join(" ")}`);
  return `Write in ${job.language}.\nPlayer character: ${job.pc}\nMain quest: ${job.quest}\n\n## Summary so far\n${job.text || "(none yet: the story has just begun)"}\n\n## Turns since\n${lines.join("\n\n")}`;
}

// Background run. addSpend books the cost against the daily cap.
export async function updateSummary(env, job, addSpend) {
  const key = `sum:${job.id}`;
  const model = env.SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL;
  try {
    const turns = await gatherTurns(env, job);
    if (!turns.length) throw new Error("no turns found");
    const res = await makeClient(env).messages.create({
      model, max_tokens: 2000, system: RULES,
      messages: [{ role: "user", content: summaryPrompt(job, turns) }],
      output_config: { effort: "low" },
    });
    const cost = costUSD(model, res.usage);
    await addSpend(cost);
    if (res.stop_reason === "refusal") throw new Error(`refused (${res.stop_details?.category || "no category"})`);
    const text = capWords(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""), HARD_WORDS);
    if (!text) throw new Error("empty summary");
    await env.GAME.put(key, JSON.stringify({ text, through_turn: job.to, from: turns[0].n, model: res.model || model, usage: res.usage, cost, at: new Date().toISOString() }));
    console.log(JSON.stringify({ event: "summary", through: job.to, turns: turns.length, usage: res.usage, cost }));
  } catch (err) {
    const error = String(err?.message || err).slice(0, 200);
    await env.GAME.put(key, JSON.stringify({ text: job.text, through_turn: job.through, error, failed_at: new Date().toISOString() }));
    console.log(JSON.stringify({ event: "summary_failed", through: job.to, error }));
  }
}
