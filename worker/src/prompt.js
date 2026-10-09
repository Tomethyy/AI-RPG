// Prompt assembly with a token budget per section. Every section is capped, so turn 500 costs about what turn 50 costs.
//
// Layout (cache prefix first, volatile last):
//   system   1. RULES                         static, identical for every game
//            2. setting, tone, language       static per game        <- cache breakpoint
//   user     3. story summary + quest         changes every ~5 turns <- cache breakpoint
//            4. character, known facts, earlier turns (brief, then verbatim), current scene, options to avoid, action
import { STATS, RECENT_PROMPT, locationName } from "./schema.js";
import { relevantEntities } from "./ledger.js";

// Rough count (English prose is ~4 characters a token). The debug view shows it next to the real usage.
export const estTokens = (text) => Math.ceil(String(text || "").length / 4);

// Token budget per section. Sum with the static part: about 4.5k at most, usually well under.
export const BUDGET = { summary: 450, quest: 150, character: 300, ledger: 900, brief: 200, turns: 1000, scene: 450, avoid: 150, action: 200 };
const FACTS_EACH = 6;
const LEDGER_MAX = 20;
const BRIEF_CHARS = 170;

export const RULES = `You are the narrator of a solo text RPG played on a phone. The app owns all state, rules and dice; you only narrate and propose.

Each turn you get the story summary, the quest, the character sheet, known facts, earlier turns (older ones in brief), the current scene, and the player's action with its dice result (if any). Reply with one JSON object.

narration: 1-3 short paragraphs (about 60-140 words total), second person, present tense. Narrate the outcome of the action, honoring the dice result exactly: a failure must cost or complicate something, a success must move things forward. Never contradict the known facts or the summary. Do not restate the previous scene or the player's action. End on a concrete situation the player can act on.

options: 3 or 4 next actions, specific to this scene, each under 12 words, in the player's voice ("Ask Maren about the satchel"). Give each a different kind where you can (social, explore, direct, cautious, other). At least one must advance the focused quest. Never hint at risk, odds or reward in the text. Do not repeat or rephrase recently offered options. Give each a stat (might = force and physical feats, wits = perception, knowledge and talk, grit = endurance, nerve and stealth) and a difficulty from 6 (easy) to 18 (very hard).

classification: for a free-text action, "allowed", "conditional" (possible but harder), or "blocked" (conflicts with established facts, skips the story, or is implausible). Never answer a blocked action with a bare refusal: show the in-world consequence, a reaction, or why it cannot work. For options you offered, use "allowed".

state_changes: changes the story implies, as proposals the app will check. actor is "pc" for the player. kind: hp (amount = change, negative for harm), xp (amount gained), item_add / item_remove (text = item name, amount = quantity), condition_add / condition_remove (text = condition), move (text = name of the new location). reason: a few words. Empty list if nothing changed.

new_facts: EVERY named person, place, faction, item or quest you introduced or revealed this turn, and any new fact about a known one, one short fact per entry (entity = its name; location = the place it is at, or "" if unknown or not a physical thing). Reuse known names exactly. If you named it, list it. was: when an entity gets a name for the first time or a new name (the woman by the hearth turns out to be Maren), the earlier name or description exactly as it was used; otherwise "".

quest_flags: short flags when the story meets a milestone condition, e.g. "learned_who_burned_bridge". Empty list otherwise.`;

const sign = (n) => (n >= 0 ? "+" : "") + n;

// Cut text to a token budget at a line or word boundary.
export function fit(text, budget) {
  text = String(text || "");
  if (estTokens(text) <= budget) return text;
  const max = Math.max(0, budget * 4 - 2);
  const cut = text.slice(0, max);
  const nl = cut.lastIndexOf("\n");
  const sp = cut.lastIndexOf(" ");
  return cut.slice(0, nl > max * 0.6 ? nl : sp > 0 ? sp : max).trimEnd() + " …";
}

// Keep lines in priority order while they fit. With skip, a line that is too big is passed over and smaller ones still get in.
function fill(lines, budget, skip = false) {
  const out = [];
  let used = 0;
  for (const line of lines) {
    const t = estTokens(line) + 1;
    if (used + t > budget) { if (skip) continue; break; }
    out.push(line);
    used += t;
  }
  return out;
}

export function rollText(dice) {
  if (!dice) return "No roll.";
  return `d20 ${dice.die} ${sign(dice.mod)} ${dice.label} = ${dice.die + dice.mod} vs difficulty ${dice.dc}: ${dice.success ? "SUCCESS" : "FAILURE"}.`;
}

function characterBlock(save) {
  const lines = [];
  for (const id of save.party) {
    const a = save.actors[id];
    const eq = Object.entries(a.equipment).filter(([, v]) => v).map(([slot, v]) => `${slot} ${v.name}`).join(", ") || "none";
    const count = new Map();
    for (const i of a.inventory) count.set(i.name, (count.get(i.name) || 0) + i.qty);
    const inv = [...count].map(([name, qty]) => (qty > 1 ? `${name} x${qty}` : name)).join(", ") || "nothing";
    lines.push(`${a.name} [${a.id}${a.kind === "pc" ? ", the player" : ""}]: level ${a.level}, XP ${a.xp}, HP ${a.hp}/${a.hp_max}. ` +
      STATS.map((s) => `${s} ${sign(a.stats[s])}`).join(", ") + `. Conditions: ${a.conditions.join(", ") || "none"}.\nEquipment: ${eq}. Inventory: ${inv}.`);
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

function entityLine(e) {
  const meta = [e.type, e.where && `at ${e.where}`, e.links?.length && `connects to ${e.links.join(", ")}`, e.aliases.length && `also called ${e.aliases.join(", ")}`].filter(Boolean).join("; ");
  return fit(`- ${e.name} (${meta}): ${e.facts.join("; ") || "no facts yet"}`, 220);
}

function firstSentence(paras) {
  const text = paras.join(" ");
  const m = text.match(/^.*?[.!?](?=\s|$)/);
  const s = (m ? m[0] : text).trim();
  return s.length > BRIEF_CHARS ? s.slice(0, BRIEF_CHARS).replace(/\s+\S*$/, "") + " …" : s;
}

const turnText = (t) => `Turn ${t.n}. Player: ${t.action.text}. ${rollText(t.dice)}\n${t.narration.join(" ")}`;
const briefText = (t) => `Turn ${t.n}. Player: ${t.action.text}. ${t.dice ? (t.dice.success ? "Success." : "Failure.") : ""} ${firstSentence(t.narration)}`.replace(/\s+/g, " ");

// Returns { system, messages, sections, est }. sections carry each part's text and size for the debug view.
export function buildPrompt(save, action, dice) {
  const sections = [];
  const add = (name, text, budget, cached = false) => { sections.push({ name, text, tokens: estTokens(text), budget, cached }); return text; };

  const settings = `Setting: ${save.settings.setting}\nTone: ${save.settings.tone}\nWrite everything in ${save.settings.language}.`;
  add("Rules", RULES, null, true);
  add("Setting", settings, null, true);
  const system = [{ type: "text", text: RULES }, { type: "text", text: settings, cache_control: { type: "ephemeral" } }];

  const summary = add("Story so far", fit(save.summary.text || "(The story has just begun.)", BUDGET.summary), BUDGET.summary, true);
  const quest = add("Quest", fit(questBlock(save), BUDGET.quest), BUDGET.quest, true);
  const stable = `## Story so far\n${summary}\n\n## Quest\n${quest}`;

  const character = add("Character", fit(characterBlock(save), BUDGET.character), BUDGET.character);
  const ledger = add("Known facts", fill(relevantEntities(save, action.text, { max: LEDGER_MAX, factsEach: FACTS_EACH }).map(entityLine), BUDGET.ledger, true).join("\n") || "(none yet)", BUDGET.ledger);

  // Turns since the summary: the newest RECENT_PROMPT verbatim (the last one is the current scene), the rest in brief.
  const led = save.recent.at(-1)?.n === save.turn ? save.recent.at(-1) : null;
  const earlier = save.recent.filter((t) => t.n < save.turn);
  const verbatim = earlier.slice(-(RECENT_PROMPT - 1));
  const gap = earlier.slice(0, -(RECENT_PROMPT - 1)).filter((t) => t.n > save.summary.through_turn);
  const brief = add("Earlier, in brief", fill(gap.map(briefText).reverse(), BUDGET.brief).reverse().join("\n"), BUDGET.brief);
  const turns = add("Earlier turns", fill(verbatim.map(turnText).reverse(), BUDGET.turns).reverse().join("\n\n") || "(none)", BUDGET.turns);
  const scene = add("Current scene", fit(`(turn ${save.turn}) at ${locationName(save, save.scene.location_id)}\n` +
    (led ? `Player: ${led.action.text}. ${rollText(led.dice)}\n` : "") + `${save.scene.narration.join("\n")}\nOptions shown: ${save.scene.options.map((o) => o.text).join(" | ")}`, BUDGET.scene), BUDGET.scene);

  const shown = new Set(save.scene.options.map((o) => o.text));
  const older = [...new Set(save.recent.slice(-4).reverse().flatMap((t) => t.options.map((o) => o.text)))].filter((t) => !shown.has(t));
  const avoid = add("Recently offered options", fill(older, BUDGET.avoid).join(" | "), BUDGET.avoid);

  const kindLabel = { option: "chose an offered option", custom: "typed a free-text action", look: "looks around", talk: "talks to someone nearby" }[action.kind] || action.kind;
  const act = add("Player action", fit(`(the player ${kindLabel})\n"${action.text}"\nDice: ${rollText(dice)}\n\nWrite turn ${save.turn + 1}.`, BUDGET.action), BUDGET.action);

  const volatile = [
    `## Character\n${character}`,
    `## Known facts\n${ledger}`,
    brief && `## Earlier turns, in brief\n${brief}`,
    `## Earlier turns\n${turns}`,
    `## Current scene ${scene}`,
    avoid && `## Recently offered options (do not repeat)\n${avoid}`,
    `## Player action ${act}`,
  ].filter(Boolean).join("\n\n");

  const messages = [{ role: "user", content: [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: volatile },
  ] }];
  const sum = (f) => sections.filter(f).reduce((n, s) => n + s.tokens, 0);
  const est = { cached: sum((s) => s.cached), volatile: sum((s) => !s.cached) };
  est.total = est.cached + est.volatile;
  return { system, messages, sections, est };
}
