// Quest engine (Phase 7): the main quest's milestone graph with leads and a branching finale, side quests and quest focus,
// the threat clock, the day and time of day, NPC attitude and first reactions.
//
// Code decides every quest step BEFORE the AI writes (planTurn) and tells it what to narrate, the same way it hands over a
// dice result. After the reply the plan is applied (applyTurn, then afterFacts). The AI only proposes small things:
// an attitude step, time passing, a move, a new side quest, a failed side quest.
import { rng, alignBands, resultOf, rollOption, customTable, XP } from "./rules.js";
import { findEntity, ensureLocation, norm } from "./ledger.js";

export const MILESTONE_STEPS = 6; // steps that finish a milestone
export const STEP_GAP = 5; // turns between two steps (a costly shortcut skips the wait)
export const SIDE_STEPS = 3, SIDE_GAP = 3;
export const NUDGE_TURNS = 15; // turns without a step before code brings the next lead to the player
export const DRAG_TURNS = 55, DRAG_EVERY = 10; // a milestone older than this ticks the threat clock every 10 turns
export const CLOCK_SEGMENTS = 8, MAX_DOOMS = 3;
export const TIME_IDLE = 6; // turns without time passing before the time of day moves on by itself
export const SIDE_MAX = 8; // side quests in one game, seeded and earned
export const PARTS = ["morning", "afternoon", "evening", "night"];
export const ATTITUDES = ["hostile", "wary", "neutral", "friendly", "loyal"];
export const VALUES = ["scene", "advance", "costly", "sidetrack"];
const TRAVEL_WORDS = { 1: "a few hours", 2: "half a day", 3: "most of a day", 4: "a full day" };

const clampAtt = (n) => Math.max(-2, Math.min(2, Math.round(n || 0)));
export const attitudeLabel = (n) => ATTITUDES[clampAtt(n) + 2];
export const travelWords = (p) => TRAVEL_WORDS[p] || `${p} parts of a day`;
export const timeLabel = (t) => `Day ${t.day}, ${PARTS[t.part]}`;
const pcOf = (save) => save.actors[save.party[0]];
const turns = (k) => `${k} turn${k === 1 ? "" : "s"}`;

// ---- building the quest state (region.js for a generated story, the placeholder below for the fixed opening) ----

const newLead = (l) => ({ text: String(l.text), target: String(l.target || ""), revealed: false, turn: null });

function newMilestone(id, m, extra = {}) {
  return {
    id, title: m.title, goal: m.goal, leads: (m.leads || []).map(newLead), status: "undiscovered", next: [], branch: null, final: false,
    steps: 0, need: MILESTONE_STEPS, started_turn: null, last_step_turn: null, last_move_turn: null, ...extra,
  };
}

// spec: { title, conflict, milestones: [m], branches: [{ choice, outcome, milestones: [m] }] }; m: { title, goal, leads: [{ text, target }] }.
// The trunk is shared by every playthrough; its last milestone ends at the key decision, and each branch is one side of it.
export function buildMain(spec) {
  const milestones = {};
  const trunk = spec.milestones.map((m, i) => (milestones[`m${i + 1}`] = newMilestone(`m${i + 1}`, m)));
  trunk.forEach((m, i) => { if (trunk[i + 1]) m.next = [trunk[i + 1].id]; });
  const forked = (spec.branches || []).length >= 2;
  const branches = forked ? spec.branches.map((b, bi) => {
    const id = "abc"[bi];
    const ms = b.milestones.map((m, i) => (milestones[`${id}${i + 1}`] = newMilestone(`${id}${i + 1}`, m, { branch: id })));
    ms.forEach((m, i) => { if (ms[i + 1]) m.next = [ms[i + 1].id]; });
    ms.at(-1).final = true;
    return { id, choice: b.choice, outcome: b.outcome, first: ms[0].id };
  }) : [];
  const fork = forked ? trunk.at(-1) : null;
  if (fork) fork.next = branches.map((b) => b.first);
  else trunk.at(-1).final = true;
  return { title: spec.title, conflict: spec.conflict || "", milestones, current: "m1", fork: fork?.id || null, branches, branch: null, choosing: false };
}

function newSide(id, s, origin) {
  return {
    id, title: s.title, goal: s.goal, giver: s.giver || "", place: s.place || "", leads: (s.leads || []).map(newLead),
    status: origin === "seed" ? "hidden" : "active", origin, steps: 0, need: SIDE_STEPS, started_turn: null, last_step_turn: null,
  };
}

export function newQuests(mainSpec, sideSpecs = []) {
  const side = {};
  sideSpecs.forEach((s, i) => { side[`s${i + 1}`] = newSide(`s${i + 1}`, s, "seed"); });
  return { main: buildMain(mainSpec), side, focus: "main", flags: [], side_seq: sideSpecs.length };
}

export function newClock(spec) {
  const pad = (list, n, fill) => Array.from({ length: n }, (_, i) => String(list[i] || list.at(-1) || fill));
  return { name: spec.name, signs: pad(spec.signs || [], CLOCK_SEGMENTS, "Trouble draws closer."), dooms: pad(spec.dooms || [], MAX_DOOMS, "The threat strikes."), filled: 0, dooms_hit: 0, pending: [], seen: [] };
}

export const newTime = () => ({ day: 1, part: 0, idle: 0 });

// The fixed opening at the Rusted Ford (no generated region: no API key, or a save from before Phase 7).
export const PLACEHOLDER_MAIN = {
  title: "The Burned Bridge",
  conflict: "Someone burned the bridge at the Rusted Ford to keep the river road closed.",
  milestones: [
    { title: "Learn who burned the bridge", goal: "The character knows who ordered the burning", leads: [
      { text: "The woman by the hearth was awake the night of the fire and saw riders on the far bank.", target: "The woman by the hearth" },
      { text: "Lamp oil was poured on the bridge planks; someone bought a lot of it in Gull's Landing.", target: "Gull's Landing" },
      { text: "A drover found a broken seal in the ashes, stamped with a guild mark.", target: "The Rusted Ford" },
    ] },
    { title: "Find out why they want the road closed", goal: "The character learns what the closed road protects or hides", leads: [
      { text: "Carts that used the river road now pay a ferryman downriver, at triple the old toll.", target: "Gull's Landing" },
      { text: "Someone keeps a ledger of who still crosses, and sends it upriver each week.", target: "The Rusted Ford" },
      { text: "Old drovers say the road passes a place nobody is supposed to see anymore.", target: "The Rusted Ford" },
    ] },
    { title: "Reopen the road", goal: "The crossing is usable again or the culprit is stopped", leads: [
      { text: "The culprit needs the closure to last only until the next full moon.", target: "The Rusted Ford" },
      { text: "The ferryman owes money to the wrong people and might talk for a price.", target: "Gull's Landing" },
      { text: "A Concord warden could order the bridge rebuilt if shown proof.", target: "Gull's Landing" },
    ] },
  ],
  branches: [],
};
export const PLACEHOLDER_CLOCK = {
  name: "The river road dies",
  signs: ["Fewer carts come down the road each day.", "A drover's cart is found overturned and looted.", "Prices for bread double at the ford.", "Armed men watch the ferry at night.", "The toll house keeper packs to leave.", "A body washes up below the burned bridge.", "Notices nailed up: the road is closed by order.", "Riders burn the ferry rope."],
  dooms: ["The ford's last travellers are driven off, and witnesses with them.", "The ferry is seized; the only crossing now answers to the culprits.", "The road is declared abandoned and its villages left to fend for themselves."],
};

// ---- time ----

// Returns how many new days began.
export function advanceTime(save, parts) {
  const t = save.time;
  const total = t.part + Math.max(0, parts);
  const days = Math.floor(total / PARTS.length);
  t.part = total % PARTS.length;
  t.day += days;
  if (parts > 0) t.idle = 0;
  return days;
}

// ---- the threat clock ----

// One tick on a copy ({ filled, dooms_hit }). Returns what the story must show: a warning sign or a doom (null once the worst has happened).
function tickOnce(state, clock) {
  if (state.dooms_hit >= MAX_DOOMS) return null;
  state.filled++;
  if (state.filled >= CLOCK_SEGMENTS) {
    const text = clock.dooms[state.dooms_hit] || clock.dooms.at(-1);
    state.dooms_hit++;
    if (state.dooms_hit < MAX_DOOMS) state.filled = 0; // after the last doom the clock stays full
    return { kind: "doom", text, n: state.dooms_hit };
  }
  return { kind: "sign", text: clock.signs[state.filled - 1] || clock.signs.at(-1), filled: state.filled };
}

const tickNote = (clock, t) => (t.kind === "doom" ? `Doom: ${t.text}` : `The threat grows: ${clock.name} (${t.filled}/${CLOCK_SEGMENTS})`);

// ---- NPC attitude and first reactions ----

// 2d6 reaction, shaped by what the person respects and the character's alignment, plus their attitude to strangers.
function reaction(save, key, values = "none", base = 0) {
  const r = rng(`${save.id}:react:${key}`);
  const b = alignBands(pcOf(save).align);
  const mod = { law: { lawful: 1, chaotic: -1 }, chaos: { chaotic: 1, lawful: -1 } }[values]?.[b.law] ??
    { good: { good: 1, evil: -1 }, evil: { evil: 1, good: -1 } }[values]?.[b.good] ?? 0;
  const t = 2 + Math.floor(r() * 6) + Math.floor(r() * 6) + mod;
  const step = t <= 3 ? -2 : t <= 5 ? -1 : t <= 8 ? 0 : t <= 10 ? 1 : 2;
  return clampAtt(step + (base || 0));
}

export const npcReaction = (save, e) => reaction(save, e.id, e.values, e.base);
const newcomerReaction = (save, n) => reaction(save, `new:${n}`);

// The opening call has no plan of its own; the people it introduces still get a first reaction.
export const introPlan = (save) => ({ n: 1, newcomer: newcomerReaction(save, 1) });

// The attitude a person brings to a check: their current one, or their first reaction if the character has not met them yet.
export const attitudeOf = (save, e) => (e.met === false ? npcReaction(save, e) : clampAtt(e.attitude));

// ---- quest lookups ----

export const currentMilestone = (save) => save.quests.main.milestones[save.quests.main.current];
const openSide = (s) => s && s.status === "active";

export function focusTitle(save) {
  const f = save.quests.focus;
  return f !== "main" && openSide(save.quests.side[f]) ? save.quests.side[f].title : save.quests.main.title;
}

// Leads revealed for the current milestone and open side quests; retrieval uses them to find the people and places they point to.
export function revealedLeads(save) {
  const m = currentMilestone(save);
  const leads = [...(m?.leads || []), ...Object.values(save.quests.side).filter(openSide).flatMap((s) => s.leads)];
  return leads.filter((l) => l.revealed).map((l) => `${l.text} ${l.target}`);
}

function flag(save, n, text) {
  save.quests.flags = [...save.quests.flags, { turn: n, text }].slice(-80);
}

function markKnown(save, name) {
  const e = name && findEntity(save, name);
  if (e) e.known = true;
}

function revealLead(save, q, i, n, events) {
  const l = q.leads[i];
  if (!l || l.revealed) return;
  l.revealed = true;
  l.turn = n;
  markKnown(save, l.target);
  events.push(`New lead: ${l.text}`);
  flag(save, n, `Lead (${q.title}): ${l.text}`);
}

const firstUnrevealed = (q) => q.leads.findIndex((l) => !l.revealed);

function startMilestone(save, m, n, events) {
  m.status = "ongoing";
  m.started_turn = m.last_step_turn = m.last_move_turn = n;
  save.quests.main.current = m.id;
  revealLead(save, m, firstUnrevealed(m), n, events);
}

// Called once when a game starts: the first milestone opens with its first lead.
export function openStory(save, n = 1) {
  const m = currentMilestone(save);
  if (m.status === "undiscovered") startMilestone(save, m, n, []);
  else if (!m.leads.some((l) => l.revealed)) revealLead(save, m, 0, n, []);
}

// ---- planning a turn (pure: a fallback turn changes nothing, a retried turn plans the same) ----

function doneLine(save, m) {
  const main = save.quests.main;
  if (m.final) {
    const b = main.branches.find((x) => x.id === main.branch);
    return `FINALE: "${m.title}" is achieved (${m.goal}). The main quest ends here: narrate the end of the story${b ? ` along the chosen path (${b.outcome})` : ""}, up to 200 words, resolving the hidden truth and the character's stake. Then 3 quiet closing options; the story is over.`;
  }
  if (m.id === main.fork) {
    return `MILESTONE COMPLETE: "${m.title}" (${m.goal}). The key decision is now open: the character must choose between ${main.branches.map((b) => `${b.id.toUpperCase()}) "${b.choice}" (${b.outcome})`).join(" and ")}. End the narration on that choice and do not choose for them; the app adds the choices as options.`;
  }
  const next = main.milestones[m.next[0]];
  const lead = next?.leads[0];
  return `MILESTONE COMPLETE: "${m.title}" (${m.goal}). Narrate it achieved.` + (next ? ` The next milestone opens: "${next.title}"; give the character its first lead: "${lead?.text}".` : "");
}

function stepsPlan(q, value, n, ref, gap, revealAt, finish) {
  const since = n - (q.last_step_turn ?? n);
  const ready = since >= gap;
  const k = value === "costly" ? 2 : ready ? 1 : 0;
  if (!k) return { ref, k: 0, lines: [`Quest: no decisive step yet (possible in ${turns(gap - since)}): a small advance within the scene (an answer, a detail), nothing that reveals a new lead or completes "${q.title}".`] };
  const to = Math.min(q.need, q.steps + k);
  const reveal = [], lines = [];
  const hidden = q.leads.map((l, i) => (l.revealed ? -1 : i)).filter((i) => i >= 0);
  for (let i = q.steps + 1; i <= to; i++) {
    if (i === q.need) { lines.push(finish); break; }
    if (revealAt(i) && hidden.length) {
      const li = hidden.shift();
      reveal.push(li);
      lines.push(`Quest step ${i}/${q.need} for "${q.title}": reveal this lead in the story, concretely: "${q.leads[li].text}".`);
    } else lines.push(`Quest step ${i}/${q.need} for "${q.title}": a real breakthrough along a revealed lead: the character finds, confirms or wins something concrete toward the goal (${q.goal}). Do not complete it yet.`);
  }
  return { ref, k, to, reveal, done: to === q.need, lines };
}

// What a successful quest action does to quest `ref` ("main" or a side quest id), or null when it cannot move.
export function stepPlan(save, ref, value, n) {
  const q = save.quests;
  if (!ref || ref === "main") {
    const main = q.main, m = currentMilestone(save);
    if (save.over || main.choosing || !m || m.status !== "ongoing") return null;
    return stepsPlan(m, value, n, "main", STEP_GAP, (i) => i % 2 === 0, doneLine(save, m));
  }
  const s = q.side[ref];
  if (!s || (s.status !== "active" && s.status !== "hidden")) return null;
  if (s.status === "hidden") {
    const li = firstUnrevealed(s);
    return { ref, activate: true, reveal: li >= 0 ? [li] : [], lines: [`NEW SIDE QUEST "${s.title}"${s.giver ? ` from ${s.giver}` : ""}: ${s.goal} Narrate how the character takes it up${li >= 0 ? `, and reveal its first lead: "${s.leads[li].text}"` : ""}.`] };
  }
  return stepsPlan(s, value, n, ref, SIDE_GAP, () => true, `SIDE QUEST COMPLETE: "${s.title}" (${s.goal}). Narrate it done.`);
}

// Decide everything code owns about this turn. action: the resolved action (index.js), with .option for an offered option.
export function planTurn(save, action) {
  const n = save.turn + 1;
  const q = save.quests, main = q.main, clock = save.clock;
  const plan = { n, value: "scene", quest: "", dice: null, custom: null, step: null, customStep: null, choose: null, pre_parts: 0, ticks: [], nudge: null, newcomer: newcomerReaction(save, n), lines: [] };
  const o = action.option;
  if (o?.value === "choose") {
    const b = main.branches.find((x) => x.id === o.quest);
    if (b && main.choosing) {
      const first = main.milestones[b.first];
      plan.value = "choose";
      plan.choose = b.id;
      plan.lines.push(`The character makes the key decision: "${b.choice}". Narrate the commitment and its first consequence. A new milestone begins: "${first.title}"; give the character its first lead: "${first.leads[0]?.text}".`);
    }
  } else if (o) {
    const npc = o.npc ? findEntity(save, o.npc, "npc") : null;
    const att = npc ? attitudeOf(save, npc) : 0;
    const social = o.kind === "social" || o.stat === "charm";
    plan.dice = rollOption(save, o, social && att ? { dcMod: -att, why: `${npc.name} is ${attitudeLabel(att)}` } : {});
    plan.value = VALUES.includes(o.value) ? o.value : "scene";
    plan.quest = o.quest || "";
  } else if (action.kind === "custom") {
    plan.custom = customTable(save);
    plan.customStep = stepPlan(save, q.focus, "advance", n);
  }

  const ok = plan.dice && resultOf(plan.dice) !== "failure";
  if (plan.value === "advance" || plan.value === "costly") {
    const step = stepPlan(save, plan.quest || q.focus, plan.value, n);
    if (step && plan.value === "costly") plan.ticks.push("costly"); // the shortcut's price, paid whatever the roll
    if (!step) plan.value = "scene"; // no quest it could move: an ordinary scene action
    else if (ok) plan.step = step;
    else plan.lines.push("Quest: no progress this turn (the attempt failed); the way forward stays open.");
  } else if (plan.value === "sidetrack") {
    plan.pre_parts = 1;
    if (ok) plan.lines.push("Sidetrack: a dead end for the quest, but the character gains an insight that will help them (the app grants advantage on their next check). It takes a while.");
    else { plan.ticks.push("dead end"); plan.lines.push("Sidetrack: a dead end that wastes time; nothing useful comes of it."); }
  }
  if (plan.step) plan.lines.push(...plan.step.lines);

  // Time: a sidetrack takes a part of the day; otherwise the time of day moves on by itself every few turns.
  if (!plan.pre_parts && save.time.idle + 1 >= TIME_IDLE) plan.pre_parts = 1;
  const days = Math.floor((save.time.part + plan.pre_parts) / PARTS.length);
  for (let i = 0; i < days; i++) plan.ticks.push("new day");

  // A milestone that drags on ticks the clock; one without a step for a while gets its next lead brought to the character.
  const m = currentMilestone(save);
  if (m?.status === "ongoing" && !save.over && !main.choosing) {
    const age = n - m.started_turn;
    if (age >= DRAG_TURNS && (age - DRAG_TURNS) % DRAG_EVERY === 0) plan.ticks.push("drag");
    if (!plan.step && !plan.custom && q.focus === "main" && n - m.last_move_turn >= NUDGE_TURNS) {
      const li = firstUnrevealed(m);
      plan.nudge = { lead: li };
      plan.lines.push(li >= 0
        ? `A lead comes to the character unasked (a messenger, a rumor, a find that fits the scene): reveal "${m.leads[li].text}".`
        : `The milestone "${m.title}" has stalled: make the way forward along a revealed lead obvious this turn (someone or something pushes the character toward it).`);
    }
  }

  // The clock: signs left over from the last turn's travel, then this turn's ticks.
  const sim = { filled: clock.filled, dooms_hit: clock.dooms_hit };
  const fresh = plan.ticks.map(() => tickOnce(sim, clock)).filter(Boolean);
  plan.clock = { ...sim, told: [...clock.pending, ...fresh], fresh };
  for (const t of plan.clock.told) {
    plan.lines.push(t.kind === "doom"
      ? `DOOM (the threat clock "${clock.name}" filled): ${t.text} Narrate it now as a hard setback the character witnesses or hears of; the story goes on.`
      : `Warning sign to work into the story (the threat "${clock.name}" grows, ${t.filled}/${CLOCK_SEGMENTS}): ${t.text}`);
  }

  if (main.choosing && !plan.choose) plan.lines.push(`The key decision is open: the character must choose between ${main.branches.map((b) => `"${b.choice}"`).join(" and ")}. Keep it in front of them; the app adds the choices as options. Do not choose for them.`);

  // A seeded side quest whose giver or place is in this scene may be offered.
  const here = save.scene.location_id;
  const offer = Object.values(q.side).find((s) => s.status === "hidden" && [s.giver, s.place].some((x) => {
    const e = x && findEntity(save, x);
    return e && (e.id === here || e.location_id === here);
  }));
  if (offer) plan.lines.push(`A side quest can be offered here: ${offer.id} "${offer.title}" (from ${offer.giver || "someone here"}): if it fits, one option may take it up (value "advance", quest "${offer.id}").`);
  return plan;
}

// The "This turn" section of the prompt: everything code decided, for the AI to narrate.
export function planText(save, plan) {
  const t = { ...save.time };
  const lines = [];
  if (plan.pre_parts) { const days = Math.floor((t.part + plan.pre_parts) / PARTS.length); t.part = (t.part + plan.pre_parts) % PARTS.length; t.day += days; }
  lines.push(`Time: ${timeLabel(t)}${plan.pre_parts ? " (time has moved on: show it)" : ""}.`);
  lines.push(...plan.lines);
  if (plan.custom) {
    const c = plan.custom;
    const rows = Object.entries(c.rows).map(([stat, r]) => `${stat} ${r.mod >= 0 ? "+" : ""}${r.mod}: ${Object.entries(r.results).map(([tier, res]) => `${tier} ${res}`).join(", ")}`);
    lines.push(`Free-text action: the app rolled d20 = ${c.die}${c.die === 20 ? " (NATURAL 20)" : c.die === 1 ? " (NATURAL 1)" : ""}${c.danger ? ` (the place's danger +${c.danger} is in the results)` : ""}. Choose the stat and tier that fit (tier "none" when no roll is needed or the action is blocked; a conditional action takes a harder tier), narrate exactly the matching result, and report stat, tier, value and result in custom_roll.`);
    lines.push(`Results: ${rows.join(" | ")}`);
    lines.push(plan.customStep ? `If it clearly advances the focused quest (value "advance") and does not fail: ${plan.customStep.lines.join(" ")}` : `It cannot move a quest this turn (value "scene").`);
  }
  const m = currentMilestone(save);
  if (m?.status === "ongoing" && !save.quests.main.choosing) {
    const since = plan.n - m.last_step_turn;
    lines.push(`Quest pace: "${m.title}" step ${m.steps}/${m.need}; next step ${since >= STEP_GAP ? "now" : `in ${turns(STEP_GAP - since)}`}.`);
  }
  lines.push(`Anyone new the character meets this turn starts out ${attitudeLabel(plan.newcomer)}.`);
  return lines.join("\n");
}

// ---- applying a turn ----

function completeMilestone(save, m, n, events) {
  const main = save.quests.main;
  m.status = "completed";
  m.done_turn = n;
  events.push(`Milestone complete: ${m.title}`);
  flag(save, n, `Milestone complete: ${m.title}`);
  if (save.clock.filled > 0 && save.clock.dooms_hit < MAX_DOOMS) save.clock.filled--; // finishing a milestone pushes the threat back
  if (m.final) {
    save.over = { kind: "won", turn: n, branch: main.branch, epilogue: null };
    events.push("The story is complete. Read the epilogue.");
    flag(save, n, "The main quest is complete");
  } else if (m.id === main.fork) {
    main.choosing = true;
    events.push("A decision lies ahead.");
  } else if (m.next[0]) startMilestone(save, main.milestones[m.next[0]], n, events);
  return XP.milestone;
}

function completeSide(save, s, n, events) {
  s.status = "completed";
  s.done_turn = n;
  events.push(`Side quest complete: ${s.title}`);
  flag(save, n, `Side quest complete: ${s.title}`);
  if (save.quests.focus === s.id) save.quests.focus = "main";
  return XP.side_quest;
}

// Returns quest XP earned.
function applyStep(save, step, n, events) {
  const q = save.quests;
  const target = step.ref === "main" ? currentMilestone(save) : q.side[step.ref];
  if (!target) return 0;
  if (step.activate) {
    target.status = "active";
    target.started_turn = target.last_step_turn = n;
    markKnown(save, target.giver);
    events.push(`New side quest: ${target.title}`);
    flag(save, n, `Side quest taken up: ${target.title}`);
    for (const li of step.reveal) revealLead(save, target, li, n, events);
    return 0;
  }
  if (!step.k) return 0;
  save.counters.steps = (save.counters.steps || 0) + 1;
  target.steps = step.to;
  target.last_step_turn = n;
  if (step.ref === "main") target.last_move_turn = n;
  for (const li of step.reveal) revealLead(save, target, li, n, events);
  if (!step.done) return 0;
  return step.ref === "main" ? completeMilestone(save, target, n, events) : completeSide(save, target, n, events);
}

function chooseBranch(save, id, n, events) {
  const main = save.quests.main;
  const b = main.branches.find((x) => x.id === id);
  main.branch = id;
  main.choosing = false;
  events.push(`You chose: ${b.choice}`);
  flag(save, n, `Key decision: ${b.choice}`);
  startMilestone(save, main.milestones[b.first], n, events);
}

// Move the scene, with the travel time code knows (the first time a route is used, the AI's estimate becomes the route's time).
function applyMove(save, name, parts, n) {
  const from = save.ledger.entities[save.scene.location_id];
  const to = ensureLocation(save, name, n);
  if (!to) return { applied: false, result: "beyond the region" };
  if (from && from.id !== to.id) {
    if (!from.connections.includes(to.id)) from.connections.push(to.id);
    if (!to.connections.includes(from.id)) to.connections.push(from.id);
    from.travel ??= {}; to.travel ??= {};
    if (!from.travel[to.id]) from.travel[to.id] = to.travel[from.id] = Math.max(1, Math.min(4, parts || 1));
  }
  to.known = true;
  const moved = save.scene.location_id !== to.id;
  save.scene.location_id = to.id;
  return { applied: true, result: moved ? "moved" : "same place", parts: from && moved ? from.travel?.[to.id] || 0 : 0, moved };
}

// Before the new facts: time, the clock, the quest step, the decision, insight, nudges, the move. Returns { xp, changes }.
export function applyTurn(save, plan, reply, dice, events) {
  const n = plan.n, clock = save.clock;
  let xp = 0;
  if (plan.pre_parts) advanceTime(save, plan.pre_parts);
  else save.time.idle++;
  clock.filled = plan.clock.filled;
  clock.dooms_hit = plan.clock.dooms_hit;
  clock.pending = [];
  for (const t of plan.clock.fresh) events.push(tickNote(clock, t));
  for (const t of plan.clock.told) {
    clock.seen = [...clock.seen, { turn: n, kind: t.kind, text: t.text }].slice(-16);
    if (t.kind === "doom") flag(save, n, `Doom: ${t.text}`);
  }

  if (plan.choose) chooseBranch(save, plan.choose, n, events);
  let step = plan.step;
  const customOk = dice && resultOf(dice) !== "failure";
  if (plan.custom && reply.custom_roll?.value === "advance" && customOk) step = plan.customStep;
  if (step) xp += applyStep(save, step, n, events);
  if (plan.value === "sidetrack" && dice && resultOf(dice) !== "failure") {
    const p = pcOf(save);
    if (!p.edge_next) { p.edge_next = { kind: null, from: "insight" }; events.push("Insight: your next check has advantage"); }
  }
  if (plan.nudge) {
    const m = currentMilestone(save);
    if (plan.nudge.lead >= 0) revealLead(save, m, plan.nudge.lead, n, events);
    m.last_move_turn = n;
  }

  // The AI's proposals: one move (with its travel time) and time passing.
  const changes = [];
  const asked = reply.state_changes.filter((c) => c.kind === "time").reduce((a, c) => Math.max(a, c.amount), 0);
  let parts = 0, moved = false;
  for (const c of reply.state_changes) {
    if (c.kind === "move") {
      if (moved || !c.text) { changes.push({ ...c, applied: false, result: "ignored" }); continue; }
      const r = applyMove(save, c.text, Math.max(1, Math.min(4, asked || 1)), n);
      moved = r.moved;
      if (r.moved) parts = r.parts;
      changes.push({ ...c, applied: r.applied, result: r.result });
    } else if (c.kind === "time") {
      changes.push({ ...c, applied: !moved && c.amount > 0, result: moved ? "travel time used" : c.amount > 0 ? "applied" : "ignored" });
    }
  }
  if (!moved) parts = Math.max(0, Math.min(2, asked));
  if (parts) {
    // Days that begin now tick the clock; their signs are told next turn.
    const days = advanceTime(save, parts);
    const sim = { filled: clock.filled, dooms_hit: clock.dooms_hit };
    for (let i = 0; i < days; i++) {
      const t = tickOnce(sim, clock);
      if (t) { clock.pending.push(t); events.push(tickNote(clock, t)); }
    }
    clock.filled = sim.filled;
    clock.dooms_hit = sim.dooms_hit;
  }
  return { xp, changes };
}

const wordIn = (hay, name) => { const k = norm(name); return k.length > 1 && hay.includes(` ${k} `); };

// After the new facts: who the character has now heard of and met, first reactions, profiles, attitude steps, side quest changes.
export function afterFacts(save, plan, reply, created, events) {
  const n = plan.n, q = save.quests;
  const hay = ` ${norm(reply.narration.join(" "))} `;
  for (const e of Object.values(save.ledger.entities)) {
    const named = [e.name, ...e.aliases].some((x) => wordIn(hay, x));
    if (named) e.known = true;
    if (e.type === "npc" && e.met === false && named) {
      e.met = true;
      e.attitude = npcReaction(save, e);
      e.met_turn = n;
    }
  }
  for (const e of created) if (e.type === "npc") { e.attitude = plan.newcomer; e.met_turn = n; }

  for (const p of reply.profiles || []) {
    const e = findEntity(save, p.npc, "npc");
    if (e && e.type === "npc" && !e.profile) e.profile = { want: p.want, fear: p.fear, secret: p.secret, voice: p.voice };
  }

  const stepped = new Set();
  const changes = [];
  for (const c of reply.state_changes.filter((x) => x.kind === "attitude")) {
    const e = c.text && findEntity(save, c.text, "npc");
    if (!e || e.type !== "npc" || e.met === false || stepped.has(e.id) || !Math.sign(c.amount)) { changes.push({ ...c, applied: false, result: "ignored" }); continue; }
    stepped.add(e.id);
    const before = clampAtt(e.attitude);
    e.attitude = clampAtt(before + Math.sign(c.amount));
    if (e.attitude !== before) events.push(`${e.name} is now ${attitudeLabel(e.attitude)}`);
    changes.push({ ...c, applied: e.attitude !== before, result: e.attitude !== before ? "applied" : "at the limit" });
  }

  // An earned side quest: at most one open at a time from the story, and a cap on the total.
  const sq = reply.side_quest;
  if (sq?.title) {
    const open = Object.values(q.side).some((s) => s.origin === "story" && s.status === "active");
    if (!open && Object.keys(q.side).length < SIDE_MAX && !Object.values(q.side).some((s) => norm(s.title) === norm(sq.title))) {
      const id = `s${++q.side_seq}`;
      const s = (q.side[id] = newSide(id, { title: sq.title, goal: sq.goal, giver: sq.giver, leads: [{ text: sq.goal, target: sq.giver }] }, "story"));
      s.started_turn = s.last_step_turn = n;
      s.leads[0].revealed = true;
      s.leads[0].turn = n;
      events.push(`New side quest: ${s.title}`);
      flag(save, n, `Side quest taken up: ${s.title}`);
    }
  }
  for (const f of reply.quest_flags || []) {
    const id = /^failed:(s\d+)$/.exec(f)?.[1];
    const s = id && q.side[id];
    if (s && s.status === "active") {
      s.status = "failed";
      s.done_turn = n;
      events.push(`Side quest failed: ${s.title}`);
      flag(save, n, `Side quest failed: ${s.title}`);
      if (q.focus === id) q.focus = "main";
    }
  }
  return changes;
}

// Code adds the key decision's choices to the options while it is open (no roll: a decision, not a check).
export function withDecision(save, options) {
  const main = save.quests.main;
  if (!main.choosing) return options;
  const keep = options.filter((o) => o.value !== "choose").slice(0, 2);
  return [...keep, ...main.branches.map((b) => ({ text: b.choice, kind: "other", stat: "charm", tier: "standard", edge: "none", edge_why: "", value: "choose", quest: b.id, npc: "" }))];
}

export function setFocus(save, id) {
  if (id !== "main" && !openSide(save.quests.side[id])) return false;
  save.quests.focus = id;
  return true;
}

// ---- prompt blocks ----

// The stable quest block (cached with the summary; it changes when a step lands).
export function questBlock(save) {
  const q = save.quests, main = q.main, m = currentMilestone(save), c = save.clock;
  const done = Object.values(main.milestones).filter((x) => x.status === "completed").length;
  const path = main.fork ? Object.keys(main.milestones).filter((id) => /^m/.test(id)).length + 2 : Object.keys(main.milestones).length;
  const L = [`Main quest: ${main.title}. ${main.conflict}`];
  if (save.world?.stake) L.push(`The character's stake: ${save.world.stake}`);
  if (save.over) L.push("The main quest is complete.");
  else if (m) {
    L.push(`Milestone ${Math.min(path, done + (m.status === "completed" ? 0 : 1))} of ${path}: "${m.title}". Goal: ${m.goal}${m.status === "completed" ? " (done)" : ""}`);
    const shown = m.leads.filter((l) => l.revealed), hidden = m.leads.filter((l) => !l.revealed);
    if (shown.length) L.push(`Leads the character has: ${shown.map((l) => `${l.text}${l.target ? ` (points to ${l.target})` : ""}`).join(" | ")}`);
    if (hidden.length && m.status === "ongoing") L.push(`Leads not revealed yet (the app reveals them; you may foreshadow, never hand them over): ${hidden.map((l) => l.text).join(" | ")}`);
    const next = main.milestones[m.next[0]];
    if (m.id === main.fork && !main.branch) L.push(`After this milestone comes the key decision: ${main.branches.map((b) => `${b.id.toUpperCase()}) ${b.choice}: ${b.outcome}`).join("; ")}`);
    else if (next && m.status === "ongoing") L.push(`Next milestone (a hint only; do not start it): ${next.title}`);
    const b = main.branches.find((x) => x.id === main.branch);
    if (b) L.push(`Chosen path: ${b.choice} (${b.outcome})`);
  }
  L.push(`Focused quest: ${q.focus === "main" ? `the main quest (${main.title})` : focusTitle(save)}. At least one option a turn must serve it.`);
  const open = Object.values(q.side).filter(openSide);
  for (const s of open) L.push(`Side quest ${s.id} "${s.title}"${s.giver ? ` from ${s.giver}` : ""}: ${s.goal} Step ${s.steps}/${s.need}. Leads: ${s.leads.filter((l) => l.revealed).map((l) => l.text).join(" | ") || "none yet"}`);
  L.push(`Threat clock "${c.name}": ${c.filled}/${CLOCK_SEGMENTS}${c.dooms_hit ? `, dooms so far ${c.dooms_hit} (${c.dooms.slice(0, c.dooms_hit).join(" ")})` : ""}.`);
  return L.join("\n");
}

// ---- views for the phone ----

export function publicQuests(save) {
  const q = save.quests, main = q.main, c = save.clock;
  const m = currentMilestone(save);
  const leadsOf = (x) => x.leads.filter((l) => l.revealed).map((l) => l.text);
  const path = Object.values(main.milestones).filter((x) => !x.branch || x.branch === main.branch);
  return {
    time: timeLabel(save.time),
    main: {
      title: main.title, stake: save.world?.stake || "", focus: q.focus === "main",
      done: path.filter((x) => x.status === "completed").map((x) => x.title),
      current: m && m.status === "ongoing" ? { title: m.title, goal: m.goal, steps: m.steps, need: m.need, leads: leadsOf(m) } : null,
      total: main.fork ? path.length + (main.branch ? 0 : 2) : path.length,
      choosing: main.choosing ? main.branches.map((b) => b.choice) : null,
      branch: main.branches.find((b) => b.id === main.branch)?.choice || null,
      complete: !!save.over,
    },
    side: Object.values(q.side).filter((s) => s.status !== "hidden").map((s) => ({ id: s.id, title: s.title, goal: s.goal, giver: s.giver, status: s.status, steps: s.steps, need: s.need, leads: leadsOf(s), focus: q.focus === s.id })),
    clock: { name: c.name, filled: c.filled, segments: CLOCK_SEGMENTS, dooms: c.dooms_hit, signs: c.seen.map((x) => (x.kind === "doom" ? `Doom: ${x.text}` : x.text)) },
  };
}
