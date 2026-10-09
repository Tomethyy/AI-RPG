// Epilogue (Phase 7): when the story ends, code gathers what the player did (the path chosen, milestones, side quests, dooms,
// the people met and how they feel, who the character became) and one AI call turns it into a short Fallout-style ending.
// Phase 6 calls the same builder with ending { kind: "dead", cause } when the character dies.
import { makeClient, costUSD, DEFAULT_TURN_MODEL } from "./ai.js";
import { BACKGROUNDS, DRIVES } from "./content.js";
import { alignLabel } from "./rules.js";
import { attitudeLabel } from "./quest.js";

const MAX_PARAGRAPHS = 7;

export const EPILOGUE_RULES = `You write the epilogue of a finished solo text RPG campaign, in the style of the closing slides of a classic role-playing game. You get what the player did; tell what became of the people and places they touched and of the character, from those facts only.

- 4 to 6 short paragraphs, about 250-350 words in all, past tense, third person, plain and concrete.
- First the main quest's outcome along the path the player chose, then one paragraph each for the people (or factions and places) the player touched most, shaped by how those people felt about the character and what happened to them, then a last paragraph on who the character became (their alignment and their drive), and what they did next.
- Dooms that came to pass leave their mark; finished and failed side quests are remembered.
- Invent nothing that contradicts the input. Use names exactly as written.

Reply with the paragraphs only, separated by blank lines.`;

// What the ending is built from (also shown in the playtest report). ending: { kind: "won" | "dead", cause? }.
export function epilogueMaterial(save, ending = save.over || { kind: "won" }) {
  const p = save.actors[save.party[0]];
  const q = save.quests, main = q.main;
  const L = [];
  L.push(`Character: ${p.name}, ${BACKGROUNDS[p.bio?.background]?.name || "traveller"}, level ${p.level}, ${alignLabel(p.align)}. Drive: ${DRIVES[p.bio?.drive]?.text || "unknown"}`);
  if (save.world) L.push(`Region: ${save.world.name}. ${save.world.summary}\nThe character's stake: ${save.world.stake}\nThe hidden truth: ${save.world.truth}`);
  L.push(`Main quest: ${main.title}. ${main.conflict}`);
  const b = main.branches.find((x) => x.id === main.branch);
  if (b) L.push(`The key decision: ${b.choice} (${b.outcome})`);
  L.push(ending.kind === "dead" ? `Ending: the character died (${ending.cause || "unknown cause"}) on day ${save.time.day}, turn ${save.turn}.` : `Ending: the main quest is complete, on day ${save.time.day}, turn ${save.turn}.`);
  const done = Object.values(main.milestones).filter((m) => m.status === "completed").map((m) => m.title);
  if (done.length) L.push(`Milestones achieved: ${done.join("; ")}`);
  const sides = Object.values(q.side).filter((s) => s.status !== "hidden").map((s) => `${s.title} (${s.status === "active" ? "left open" : s.status})`);
  if (sides.length) L.push(`Side quests: ${sides.join("; ")}`);
  if (save.clock.dooms_hit) L.push(`Dooms that came to pass (${save.clock.name}): ${save.clock.dooms.slice(0, save.clock.dooms_hit).join(" ")}`);
  // The people the character met, the strongest feelings and the most recent first.
  const people = Object.values(save.ledger.entities).filter((e) => e.type === "npc" && e.met !== false)
    .sort((a, b) => Math.abs(b.attitude || 0) - Math.abs(a.attitude || 0) || b.last_turn - a.last_turn).slice(0, 8);
  for (const e of people) L.push(`Person: ${e.name}, ${attitudeLabel(e.attitude)} toward the character. ${e.facts.slice(-3).map((f) => f.text).join("; ")}`);
  const places = Object.values(save.ledger.entities).filter((e) => e.type === "location" && e.known !== false).sort((a, b) => b.last_turn - a.last_turn).slice(0, 4);
  if (places.length) L.push(`Places: ${places.map((e) => `${e.name} (${e.facts.at(-1)?.text || ""})`).join("; ")}`);
  L.push(`Story so far: ${save.summary.text}`);
  return L.join("\n");
}

const splitParas = (text) => String(text || "").split(/\n\s*\n/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, MAX_PARAGRAPHS);

// Without the AI (no key, the cap, a failed call): a plain ending from the same facts.
export function plainEpilogue(save) {
  const p = save.actors[save.party[0]];
  const b = save.quests.main.branches.find((x) => x.id === save.quests.main.branch);
  return [
    `${save.quests.main.title} came to its end${b ? `: ${b.outcome}` : "."}`,
    `${p.name} walked on, ${alignLabel(p.align).toLowerCase()}, and the ${save.world?.name || "Fenmarch"} remembered them.`,
  ];
}

// Returns { paragraphs, cost, model, usage, error }.
export async function writeEpilogue(env, save, ending) {
  const model = env.TURN_MODEL || DEFAULT_TURN_MODEL;
  try {
    const res = await makeClient(env).messages.create({
      model, max_tokens: 3000, system: EPILOGUE_RULES,
      messages: [{ role: "user", content: `Write in ${save.settings.language}.\n${epilogueMaterial(save, ending)}` }],
      output_config: { effort: "low" },
    });
    const cost = costUSD(model, res.usage);
    const paragraphs = splitParas(res.content.filter((x) => x.type === "text").map((x) => x.text).join(""));
    if (res.stop_reason === "refusal" || paragraphs.length < 2) return { paragraphs: null, cost, model, usage: res.usage, error: res.stop_reason === "refusal" ? "refused" : "too short" };
    return { paragraphs, cost, model: res.model || model, usage: res.usage };
  } catch (err) {
    return { paragraphs: null, cost: 0, model, error: String(err?.message || err).slice(0, 200) };
  }
}
