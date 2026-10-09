// Applying an AI turn to the save (pure: no storage, no network). index.js calls it after a good reply; the tests drive it directly.
import { RECENT_PROMPT, RECENT_KEEP } from "./schema.js";
import { applyNewFacts } from "./ledger.js";
import { varyOptions } from "./ai.js";
import { applyChanges, logDifficulty, consumeEdge, recordFailure, clearFailures, customDice } from "./rules.js";
import { applyTurn, afterFacts, withDecision } from "./quest.js";

// result: runTurn's { turn, model, usage, cost, attempts, est }. Returns { record, events, dice, factsAdded }.
export function settleTurn(save, action, plan, result) {
  const t = result.turn;
  const n = plan.n;
  // Soft variety: repeats of recent options are dropped (3 always remain), a turn with too few kinds is only counted.
  const varied = varyOptions(save, t.options);
  save.counters.options_dropped += varied.dropped;
  if (varied.low) save.counters.variety_low++;
  save.counters.values ??= {};
  for (const o of varied.options) {
    save.counters.kinds[o.kind] = (save.counters.kinds[o.kind] || 0) + 1;
    save.counters.values[o.value] = (save.counters.values[o.value] || 0) + 1;
  }
  if (!varied.options.some((o) => o.value === "advance" || o.value === "costly")) save.counters.no_quest_option = (save.counters.no_quest_option || 0) + 1;

  // A free-text action is rolled now, from the stat and tier the AI picked against code's table (validated in validateTurn).
  const dice = plan.custom ? (t.custom_roll.tier !== "none" ? customDice(plan.custom, t.custom_roll.stat, t.custom_roll.tier) : null) : plan.dice;
  const events = [];
  consumeEdge(save, dice);
  // Code owns state: the quest code applies its plan (time, clock, steps, travel), the rules engine validates every other change.
  const q = applyTurn(save, plan, t, dice, events);
  const questTurn = plan.value === "advance" || plan.value === "costly" || (plan.custom && t.custom_roll.value === "advance");
  const { changes: checked } = applyChanges(save, t.state_changes, dice, events, { bonus: questTurn, extra: q.xp });
  recordFailure(save, action, dice);
  if (checked.some((c) => c.kind === "item_add" && c.applied)) clearFailures(save); // new gear counts as something changed
  if (q.changes.some((c) => c.result === "moved")) clearFailures(save); // so does a new place
  logDifficulty(save, dice);
  const created = [];
  const factsAdded = applyNewFacts(save, t.new_facts, n, created);
  const people = afterFacts(save, plan, t, created, events);
  const changes = [...checked.filter((c) => !["move", "time", "attitude"].includes(c.kind)), ...q.changes, ...people];
  const options = save.over ? [] : withDecision(save, varied.options);

  const record = {
    n, ts: new Date().toISOString(),
    action: { kind: action.kind, text: action.text, value: plan.value, quest: plan.quest || undefined }, dice,
    narration: t.narration, options,
    classification: t.classification, custom_roll: plan.custom ? t.custom_roll : undefined,
    state_changes: changes, events, new_facts: t.new_facts, side_quest: t.side_quest.title ? t.side_quest : undefined, quest_flags: t.quest_flags,
    location_id: save.scene.location_id, time: { ...save.time, idle: undefined },
    model: result.model, attempts: result.attempts, usage: result.usage, cost: result.cost, est_input: result.est,
  };
  // Keep turns until the summary has them; the newest RECENT_PROMPT always stay.
  const all = [...save.recent, record];
  save.recent = all.filter((r, i) => r.n > save.summary.through_turn || i >= all.length - RECENT_PROMPT).slice(-RECENT_KEEP);
  save.scene = { location_id: save.scene.location_id, narration: t.narration, options };
  save.turn = n;
  save.counters.ai_turns++;
  save.counters.retries += result.attempts - 1;

  return { record, events, dice, factsAdded };
}
