// Prompt assembly with a token budget per section. Every section is capped, so turn 500 costs about what turn 50 costs.
//
// Layout (cache prefix first, volatile last):
//   system   1. RULES                                   static, identical for every game
//            2. world core, the generated region, tone   static per game        <- cache breakpoint
//   user     3. story summary + quest                    changes every few turns <- cache breakpoint
//            4. character, known facts, earlier turns (brief, then verbatim), current scene, options to avoid,
//               this turn (what code decided), action
import { STATS, RECENT_PROMPT, locationName } from "./schema.js";
import { relevantEntities, EXTRA_PLACES } from "./ledger.js";
import { WORLD } from "./world.js";
import { TALENTS, BACKGROUNDS, DRIVES, FLAWS } from "./content.js";
import { resultOf, alignLabel, packUsed, packSlots, activeFailures } from "./rules.js";
import { questBlock, planText, revealedLeads, attitudeLabel, npcReaction, currentMilestone, timeLabel } from "./quest.js";

// Rough count (English prose is ~4 characters a token). The debug view shows it next to the real usage.
export const estTokens = (text) => Math.ceil(String(text || "").length / 4);

// The one-off call that opens a new game (index.js): the setup scene is already in the save; the AI writes who the character is and why they are here.
export const INTRO_ACTION = { kind: "intro", text: "Begin the story" };
const INTRO_FIXED = `(new game) Write the opening scene of the story (turn 1) for the player character above. Build on the setup shown under Current scene: keep its place, weather, people and the burned bridge. In the first two or three plain sentences make clear who the character is, where they come from and why they have come to the Rusted Ford, using their background, drive and flaw. The drive stays unresolved, and the scene gives them a first lead toward it. You may use up to 200 words. Introduce at most the woman by the hearth and the drovers. End on a concrete situation with 3 or 4 options, one of which follows the character's drive.`;
const INTRO_REGION = (save) => `(new game) Write the opening scene of the story (turn 1) for the player character above, at ${locationName(save, save.scene.location_id)}. In the first two or three plain sentences make clear who the character is, where they come from and why they are here: their personal stake (see Quest), from their background, drive and flaw. Open in the middle of a concrete situation tied to the stake, with the place's look, weather and people, and give the character the first lead of the first milestone ("${currentMilestone(save)?.leads[0]?.text}"). You may use up to 200 words. Introduce at most two named people, taken from the key people of the region. End on a concrete situation with 3 or 4 options; one advances the main quest.`;

// Token budget per section. Sum with the static part: about 6k at most, usually well under.
export const BUDGET = { summary: 450, quest: 450, character: 400, ledger: 1100, brief: 200, turns: 1000, scene: 450, avoid: 150, failed: 80, plan: 650, action: 300 };
const FACTS_EACH = 6;
const LEDGER_MAX = 20;
const BRIEF_CHARS = 170;

export const RULES = `You are the narrator of a solo text RPG played on a phone. The app owns all state, rules, dice and the story plan; you only narrate and propose.

Each turn you get the region and its hidden truth, the story summary, the quest, the character sheet, known facts, earlier turns (older ones in brief), the current scene, what the app decided for this turn, and the player's action with its dice result (if any). Reply with one JSON object.

narration: 1-3 short paragraphs (about 60-140 words total), second person, present tense. Narrate the outcome of the action and honor the dice result exactly. SUCCESS moves things forward. SUCCESS AT A COST: they get what they wanted, but something is lost, damaged, noticed or complicated. FAILURE costs or complicates something, and the story still moves on. A natural 20 is a standout success; a natural 1 goes badly wrong. Never contradict the known facts, the summary, the region or the world. Do not restate the previous scene or the player's action. End on a concrete situation the player can act on, never with "What do you do?".

This turn: the app decides quest progress, time, the threat clock and first reactions, and lists them under "This turn". Narrate every item there in this turn, as concretely as a dice result. Never go beyond it: do not complete a milestone, reveal a lead that is not revealed yet, or let anyone state the hidden truth unless told to. Leads not yet revealed may only be foreshadowed. The hidden truth is what really happened; everything you invent must fit it.

Narrator rules: never decide, feel or speak for the player's character beyond the chosen action. NPCs want things of their own: they can refuse, lie, bargain and act unasked. Key people have a want, a fear, a secret and a voice: let them act on the want, show the voice, and keep the secret until the player earns it. Play each person's attitude (hostile, wary, neutral, friendly, loyal) as given (for key people not met yet, Known facts says how they will react on meeting; the app rolled it); people and the world react to the character's alignment and deeds. Plain, concrete prose, no purple. Call back to the player's earlier deeds so consequences show. The character's flaw may complicate a scene now and then; never take control of them. Texture: name concrete places, people, customs and institutions of Calder and of the region; magic, monsters and non-humans appear only when the story calls for them. Pace: resolve minor beats (a short talk, a lock, a quick scuffle) in one turn and cut to the next real decision; when someone leaves, they are gone within the turn unless the player acts to stop them. Keep the story coherent: introduce at most one new named person or plot thread a turn, preferring the region's key people, and advance the existing threads first; always state why someone arrives, leaves or acts, never leave it implied. NPCs rarely volunteer plot: the player earns information by asking, showing something or trading. Time and travel: use the time of day given under This turn and never name another; travel between linked places takes the time listed. The region is the map: use its places; you may add at most ${EXTRA_PLACES} new places inside it, and places beyond it are known by name only.

options: 3 or 4 next actions, specific to this scene, each under 12 words, in the player's voice ("Ask Maren about the satchel"). Give each a different kind where you can (social, explore, direct, cautious, other). Never hint at risk, odds or reward in the text. Always include the natural continuation of the last beat: if someone leads, orders or invites the character somewhere, one option is to go along. Do not repeat or rephrase recently offered options, and do not offer an approach listed under failed approaches unless something has clearly changed. Give each a stat (might = force and melee, wits = notice, know, sneak and ranged, charm = talk, deceive and lead, grit = endure and nerve) and a tier: easy (most people manage it), standard (the default: a capable person succeeds more often than not), hard (real skill or risk), daunting (nearly out of reach). Use standard unless the situation clearly says otherwise, make most options standard, and never raise a tier because the player is strong or experienced. edge: "none" for nearly every option; "advantage" only when help, the right tool or a friendly NPC clearly applies; "disadvantage" for bad conditions; edge_why says why in a few words; at most one option a turn has an edge.
Each option also has a hidden value: "scene" (ordinary play in this scene: most options), "advance" (a real move on a quest: following a revealed lead, pressing the key question, going where a lead points), "costly" (a bold shortcut on a quest that would clearly cost time, attention or trust; rare) or "sidetrack" (chasing something off the quests' path: a rumor, an errand, a distraction). Offer one or two quest options a turn (advance or costly), at least one for the focused quest, at most one costly. quest: the quest id an advance or costly option serves ("main" or a side quest id like "s2"), otherwise "". npc: the name of the person the option addresses, or "".

classification: for a free-text action, "allowed", "conditional" (possible but harder), or "blocked" (conflicts with established facts, skips the story, or is implausible). Never answer a blocked action with a bare refusal: show the in-world consequence, a reaction, or why it cannot work, scaled to the gravity of the action. For options you offered, use "allowed".
custom_roll: for a free-text action, the stat, tier, value ("scene" or "advance") and result you used from the table under This turn; for options, stat "wits", tier "none", value "scene", result "none".

state_changes: changes the story implies, as proposals the app will check. actor is "pc" for the player. kind: hp (amount = change, negative for harm), xp (amount 1-3, only for a notable moment on a quest; the app already pays XP for rolls), item_add / item_remove (text = item name, amount = quantity), condition_add / condition_remove (text = condition), move (text = name of the new location), time (amount = parts of a day that passed, 1 for a few hours, only when this turn takes notable time without travel), attitude (text = a person's name, amount +1 or -1, when the character's deeds give them real reason), law / good (amount +1 or -1, rarely, only when the player's choice has real moral weight: law = keeping versus breaking oaths, rules and order; good = mercy and help versus cruelty and selfishness; reason says why). reason: a few words. Empty list if nothing changed.

new_facts: only lasting truths, each with a kind: identity (what it is), want, relationship, secret (once revealed), status (a lasting change: dead, badly hurt, hostile, allied; it replaces the old status) or place (a location's lasting feature). Events are not facts: never log what someone held, sat on, did or said in one scene; the narration and the summary carry those. One short fact per entry, at most two per entity per turn. EVERY named person, place, faction, item or quest you introduced or revealed this turn must appear (entity = its name; location = the place it is at, or "" if unknown or not a physical thing). Reuse known names exactly. If you named it, list it. was: when an entity gets a name for the first time or a new name (the woman by the hearth turns out to be Maren), the earlier name or description exactly as it was used; otherwise "".
profiles: for each new named person you introduced this turn (not the key people), a want, a fear, a secret and a voice, a few words each. Empty list otherwise.
side_quest: only when the story clearly offers a new task (someone asks for help with something concrete), its title, goal and giver; otherwise all three "". quest_flags: "failed:<side quest id>" only when the story makes an open side quest impossible (the giver died, the thing is lost); otherwise an empty list.`;

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

const RESULT_WORD = {
  success: "SUCCESS",
  cost: "SUCCESS AT A COST (missed by a little: they get it, but something is lost, damaged or complicated)",
  failure: "FAILURE",
};

export function rollText(dice) {
  if (!dice) return "No roll.";
  const r = resultOf(dice);
  const edge = dice.edge ? ` (${dice.edge}, best of ${dice.die} and ${dice.die2})` : "";
  const crit = dice.crit === 20 ? " NATURAL 20." : dice.crit === 1 ? " NATURAL 1." : "";
  return `d20 ${dice.die}${edge} ${sign(dice.mod)} ${dice.label} = ${dice.die + dice.mod} vs difficulty ${dice.dc}: ${RESULT_WORD[r] || r}.${crit}`;
}

function characterBlock(save) {
  const lines = [];
  for (const id of save.party) {
    const a = save.actors[id];
    const bg = BACKGROUNDS[a.bio?.background]?.name;
    const eq = Object.entries(a.equipment).filter(([, v]) => v).map(([slot, v]) => `${slot} ${v.name}`).join(", ") || "none";
    const count = new Map();
    for (const i of a.inventory) count.set(i.name, (count.get(i.name) || 0) + i.qty);
    const inv = [...count].map(([name, qty]) => (qty > 1 ? `${name} x${qty}` : name)).join(", ") || "nothing";
    const talents = (a.talents || []).map((t) => TALENTS[t.id].name + (TALENTS[t.id].use === "active" && save.turn >= t.ready_turn ? " (ready)" : "")).join(", ");
    lines.push(`${a.name} [${a.id}${a.kind === "pc" ? ", the player" : ""}]: ${bg ? bg + ", " : ""}level ${a.level}, XP ${a.xp}, HP ${a.hp}/${a.hp_max}. ` +
      STATS.map((s) => `${s} ${sign(a.stats[s])}`).join(", ") + `. Alignment: ${alignLabel(a.align)}. Conditions: ${a.conditions.join(", ") || "none"}.`);
    if (a.bio) lines.push(`Drive: ${DRIVES[a.bio.drive]?.text} Flaw: ${FLAWS[a.bio.flaw]?.name} (${FLAWS[a.bio.flaw]?.text})`);
    if (talents) lines.push(`Talents: ${talents}.` + (a.edge_next ? " Their next check has advantage (a talent)." : ""));
    lines.push(`Equipment: ${eq}. Pack ${packUsed(a)}/${packSlots(a)} slots: ${inv}.`);
  }
  return lines.join("\n");
}

function entityLine(save, e) {
  const person = e.type === "npc";
  const mood = person && (e.met ? attitudeLabel(e.attitude) : `not met yet; on meeting: ${attitudeLabel(npcReaction(save, save.ledger.entities[e.id]))}`);
  const meta = [e.type, e.where && `at ${e.where}`, e.faction && e.faction, mood, e.links?.length && `connects to ${e.links.join(", ")}`, e.aliases.length && `also called ${e.aliases.join(", ")}`].filter(Boolean).join("; ");
  const pr = person && e.profile ? ` Wants ${e.profile.want}; fears ${e.profile.fear}; secret (keep until earned): ${e.profile.secret}; voice: ${e.profile.voice}.` : "";
  return fit(`- ${e.name} (${meta}): ${e.facts.join("; ") || "no facts yet"}.${pr}`, person ? 240 : 200);
}

function firstSentence(paras) {
  const text = paras.join(" ");
  const m = text.match(/^.*?[.!?](?=\s|$)/);
  const s = (m ? m[0] : text).trim();
  return s.length > BRIEF_CHARS ? s.slice(0, BRIEF_CHARS).replace(/\s+\S*$/, "") + " …" : s;
}

const turnText = (t) => `Turn ${t.n}. Player: ${t.action.text}. ${rollText(t.dice)}\n${t.narration.join(" ")}`;
const briefText = (t) => `Turn ${t.n}. Player: ${t.action.text}. ${t.dice ? { success: "Success.", cost: "Success at a cost.", failure: "Failure." }[resultOf(t.dice)] : ""} ${firstSentence(t.narration)}`.replace(/\s+/g, " ");

// Returns { system, messages, sections, est }. sections carry each part's text and size for the debug view.
// plan: what code decided for this turn (quest.js planTurn); null for the opening call.
export function buildPrompt(save, action, dice, plan = null) {
  const sections = [];
  const add = (name, text, budget, cached = false) => { sections.push({ name, text, tokens: estTokens(text), budget, cached }); return text; };

  const settings = `World (fixed; never contradict it):\n${WORLD}\n\n${save.world?.block ? save.world.block + "\n\n" : ""}Tone: ${save.settings.tone}\nWrite everything in ${save.settings.language}.`;
  add("Rules", RULES, null, true);
  add(save.world ? "World, region and tone" : "World and tone", settings, null, true);
  const system = [{ type: "text", text: RULES }, { type: "text", text: settings, cache_control: { type: "ephemeral" } }];

  const summary = add("Story so far", fit(save.summary.text || "(The story has just begun.)", BUDGET.summary), BUDGET.summary, true);
  const quest = add("Quest", fit(questBlock(save), BUDGET.quest), BUDGET.quest, true);
  const stable = `## Story so far\n${summary}\n\n## Quest\n${quest}`;

  const character = add("Character", fit(characterBlock(save), BUDGET.character), BUDGET.character);
  const ledger = add("Known facts", fill(relevantEntities(save, action.text, { max: LEDGER_MAX, factsEach: FACTS_EACH, leads: revealedLeads(save) }).map((e) => entityLine(save, e)), BUDGET.ledger, true).join("\n") || "(none yet)", BUDGET.ledger);

  // Turns since the summary: the newest RECENT_PROMPT verbatim (the last one is the current scene), the rest in brief.
  const led = save.recent.at(-1)?.n === save.turn ? save.recent.at(-1) : null;
  const earlier = save.recent.filter((t) => t.n < save.turn);
  const verbatim = earlier.slice(-(RECENT_PROMPT - 1));
  const gap = earlier.slice(0, -(RECENT_PROMPT - 1)).filter((t) => t.n > save.summary.through_turn);
  const brief = add("Earlier, in brief", fill(gap.map(briefText).reverse(), BUDGET.brief).reverse().join("\n"), BUDGET.brief);
  const turns = add("Earlier turns", fill(verbatim.map(turnText).reverse(), BUDGET.turns).reverse().join("\n\n") || "(none)", BUDGET.turns);
  const scene = add("Current scene", fit(`(turn ${save.turn}, ${timeLabel(save.time)}) at ${locationName(save, save.scene.location_id)}\n` +
    (led ? `Player: ${led.action.text}. ${rollText(led.dice)}\n` : "") + `${save.scene.narration.join("\n")}\nOptions shown: ${save.scene.options.map((o) => o.text).join(" | ")}`, BUDGET.scene), BUDGET.scene);

  const shown = new Set(save.scene.options.map((o) => o.text));
  const older = [...new Set(save.recent.slice(-4).reverse().flatMap((t) => t.options.map((o) => o.text)))].filter((t) => !shown.has(t));
  const avoid = add("Recently offered options", fill(older, BUDGET.avoid).join(" | "), BUDGET.avoid);

  const failed = add("Failed approaches", fill(activeFailures(save).map((f) => f.text).reverse(), BUDGET.failed).join(" | "), BUDGET.failed);

  const turnPlan = plan ? add("This turn (decided by the app)", fit(planText(save, plan), BUDGET.plan), BUDGET.plan) : "";
  const kindLabel = { option: "chose an offered option", custom: "typed a free-text action" }[action.kind] || action.kind;
  const diceText = action.kind === "custom" ? "see the free-text roll under This turn" : rollText(dice);
  const intro = save.world ? INTRO_REGION(save) : INTRO_FIXED;
  const act = add("Player action", action.kind === "intro" ? intro : fit(`(the player ${kindLabel})\n"${action.text}"\nDice: ${diceText}\n\nWrite turn ${save.turn + 1}.`, BUDGET.action), BUDGET.action);

  const volatile = [
    `## Character\n${character}`,
    `## Known facts\n${ledger}`,
    brief && `## Earlier turns, in brief\n${brief}`,
    `## Earlier turns\n${turns}`,
    `## Current scene ${scene}`,
    avoid && `## Recently offered options (do not repeat)\n${avoid}`,
    failed && `## Failed approaches (do not offer again unless something has clearly changed)\n${failed}`,
    turnPlan && `## This turn (decided by the app; narrate it)\n${turnPlan}`,
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
