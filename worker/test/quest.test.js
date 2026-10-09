// Phase 7: the quest engine (steps, leads, the decision, the finale), the clock, time and travel, NPC attitude, side quests,
// free-text rolls, region validation and the v6 migration. Turns are driven through settleTurn, the code the Worker runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { newGame, migrate, publicState, ledgerView, publicQuests } from "../src/schema.js";
import { validateRegion, applyRegion, REGION_SCHEMA, regionRequest } from "../src/region.js";
import { planTurn, planText, withDecision, setFocus, currentMilestone, questBlock, npcReaction, attitudeLabel, timeLabel,
  MILESTONE_STEPS, STEP_GAP, NUDGE_TURNS, DRAG_TURNS, CLOCK_SEGMENTS, MAX_DOOMS, TIME_IDLE } from "../src/quest.js";
import { settleTurn } from "../src/turn.js";
import { validateTurn } from "../src/ai.js";
import { buildPrompt, RULES } from "../src/prompt.js";
import { findEntity, applyNewFacts, EXTRA_PLACES } from "../src/ledger.js";
import { epilogueMaterial, plainEpilogue } from "../src/epilogue.js";
import { capWords } from "../src/summary.js";
import { DEFAULT_CHARACTER } from "../src/character.js";

const FIXTURE = JSON.parse(fs.readFileSync(new URL("./fixtures/region.json", import.meta.url), "utf8"));

// A generated game with a fixed id (so its dice are fixed) and a strong character (checks nearly always succeed).
function regionGame(id = "quest-test") {
  const s = newGame("main", undefined, DEFAULT_CHARACTER);
  s.id = id;
  const { spec, errors } = validateRegion(structuredClone(FIXTURE));
  assert.deepEqual(errors, []);
  applyRegion(s, spec, { model: "mock", cost: 0.07 });
  for (const k of Object.keys(s.actors.pc.stats)) s.actors.pc.stats[k] = 30;
  return s;
}

const opt = (text, value = "scene", extra = {}) => ({ text, kind: "social", stat: "charm", tier: "standard", edge: "none", edge_why: "", value, quest: value === "advance" || value === "costly" ? "main" : "", npc: "", ...extra });
const reply = (extra = {}) => ({
  narration: ["Something happens."], classification: "allowed", custom_roll: { stat: "wits", tier: "none", value: "scene", result: "none" },
  options: [opt("Press on", "advance"), opt("Look about", "scene"), opt("Chase a rumor", "sidetrack")],
  state_changes: [], new_facts: [], profiles: [], side_quest: { title: "", goal: "", giver: "" }, quest_flags: [], ...extra,
});

// One turn: pick the option at `index` (or a custom action), settle the reply. Returns { plan, record, events, dice }.
function play(save, choice = 0, rep = reply()) {
  const action = typeof choice === "string" ? { kind: "custom", text: choice } : { kind: "option", text: save.scene.options[choice].text, option: save.scene.options[choice] };
  const plan = planTurn(save, action);
  const r = settleTurn(save, action, plan, { turn: structuredClone(rep), model: "mock", usage: {}, cost: 0, attempts: 1, est: 0 });
  return { plan, ...r };
}

// Play quest options until the current milestone changes or `max` turns pass.
function playMilestone(save, max = 80) {
  const start = save.quests.main.current;
  for (let i = 0; i < max && save.quests.main.current === start && !save.quests.main.choosing && !save.over; i++) play(save, 0);
}

test("region: the fixture passes, bad shapes are refused, the save is seeded before turn 1", () => {
  assert.equal(REGION_SCHEMA.additionalProperties, false);
  const bad = structuredClone(FIXTURE);
  bad.places = bad.places.slice(0, 3);
  bad.main.milestones = bad.main.milestones.slice(0, 4);
  bad.main.milestones[0].leads.pop();
  const { spec, errors } = validateRegion(bad);
  assert.equal(spec, null);
  assert.ok(errors.some((e) => /6 to 8 places/.test(e)));
  assert.ok(errors.some((e) => /exactly 6 milestones/.test(e)));
  assert.ok(errors.some((e) => /exactly 3 leads/.test(e)));
  assert.match(regionRequest(DEFAULT_CHARACTER, "seed"), /Set the story in .*A starting idea/s);

  const s = regionGame();
  assert.equal(s.world.name, "The Harrow Reach");
  assert.equal(publicState(s).location, "Harrow Ford");
  // places carry travel times both ways; every place is reachable
  const gull = findEntity(s, "Gull's Landing", "location"), ford = findEntity(s, "Harrow Ford", "location");
  assert.equal(gull.travel[ford.id], ford.travel[gull.id]);
  // the milestone graph: 6 shared milestones, a fork, two branches of two, the first lead revealed
  const main = s.quests.main;
  assert.equal(Object.keys(main.milestones).length, 10);
  assert.equal(main.fork, "m6");
  assert.deepEqual(main.milestones.m6.next, ["a1", "b1"]);
  assert.ok(main.milestones.a2.final && main.milestones.b2.final && !main.milestones.m6.final);
  assert.equal(main.milestones.m1.status, "ongoing");
  assert.deepEqual(main.milestones.m1.leads.map((l) => l.revealed), [true, false, false]);
  // key people are in the ledger with profiles but unknown and unmet; the Ledger view hides them and every secret
  const hale = findEntity(s, "Hale", "npc");
  assert.equal(hale.met, false);
  assert.equal(hale.profile.secret, "the Vael cut");
  const view = JSON.stringify(ledgerView(s));
  assert.ok(!view.includes("Hale") && !view.includes("the Vael cut"));
  assert.ok(view.includes("Harrow Ford") && view.includes("Gull's Landing")); // the start and its neighbours are known
  // the prompt: the region sits in the cached system block, the truth is there, the quest block has the stake and the leads
  const p = buildPrompt(s, { kind: "custom", text: "Look around" }, null, planTurn(s, { kind: "custom", text: "Look around" }));
  assert.match(p.system[1].text, /This story's region: The Harrow Reach[\s\S]*Hidden truth/);
  const stable = p.messages[0].content[0].text;
  assert.match(stable, /The character's stake: Your brother/);
  assert.match(stable, /Leads the character has: Learn who burned the bridge: first clue/);
  assert.match(stable, /Leads not revealed yet .*never hand them over/);
  // key people at this place (or where a revealed lead points) come with their profile and the reaction code rolled for them
  assert.match(p.messages[0].content[1].text, /- Maren \(npc; at Harrow Ford; not met yet; on meeting: \w+\).*Wants her son back; fears Hale; secret \(keep until earned\): she sewed the false seals; voice: short sentences/);
  assert.ok(!p.messages[0].content[1].text.includes("the Vael cut"), "people elsewhere stay out of the prompt");
});

test("steps: 6 per milestone, 5 turns apart; leads at steps 2 and 4; done gives 25 XP and opens the next milestone", () => {
  const s = regionGame();
  const m1 = currentMilestone(s);
  // a successful quest option before the gap is over: only a small advance, told to the AI in advance
  const early = play(s, 0);
  assert.equal(early.dice.result === "failure" ? 0 : m1.steps, 0);
  assert.match(planText(s, early.plan), /Quest: (no decisive step yet|no progress)/);
  const xp0 = s.actors.pc.xp;
  playMilestone(s);
  assert.equal(m1.status, "completed");
  assert.equal(m1.steps, MILESTONE_STEPS);
  assert.ok(m1.done_turn - m1.started_turn >= MILESTONE_STEPS * STEP_GAP - 1, `took ${m1.done_turn - m1.started_turn} turns`);
  assert.ok(m1.leads.every((l) => l.revealed));
  assert.equal(s.quests.main.current, "m2");
  assert.equal(currentMilestone(s).leads.filter((l) => l.revealed).length, 1);
  assert.ok(s.actors.pc.xp - xp0 >= 25);
  assert.ok(s.quests.flags.some((f) => f.text === "Milestone complete: Learn who burned the bridge"));
  // the completing turn told the AI exactly what to narrate
  const rec = s.recent.find((r) => r.n === m1.done_turn);
  assert.ok(rec.events.includes("Milestone complete: Learn who burned the bridge"));
  assert.equal(rec.events.filter((e) => /^\+\d+ XP$/.test(e)).length, 1, "quest XP rides in the turn's one XP note");
});

test("options that matter: scene options never move the quest; bonus XP only on quest turns; costly gives 2 steps and ticks the clock", () => {
  const s = regionGame();
  const m1 = currentMilestone(s);
  for (let i = 0; i < 12; i++) play(s, 1, reply({ state_changes: [{ actor: "pc", kind: "xp", amount: 3, text: "", reason: "nice" }] }));
  assert.equal(m1.steps, 0);
  assert.ok(s.recent.every((r) => r.events.includes("+2 XP") || r.events.includes("+1 XP")), "the AI bonus is refused on scene turns");
  // the AI cannot mark more than two quest options, or two costly ones
  const { turn } = validateTurn({ ...reply(), options: [opt("A", "costly"), opt("B", "costly"), opt("C", "advance"), opt("D", "advance", { quest: "nonsense" })] }, s);
  assert.deepEqual(turn.options.map((o) => o.value), ["costly", "advance", "scene", "scene"]);
  assert.equal(turn.options[1].quest, "main");
  // a costly shortcut: two steps at once, whatever the gap, and the clock ticks
  s.scene.options = [opt("Break into the archive", "costly")];
  const filled = s.clock.filled;
  const r = play(s, 0);
  if (r.dice.result !== "failure") assert.equal(m1.steps, 2);
  assert.equal(s.clock.filled, filled + 1);
  assert.ok(r.events.some((e) => /^The threat grows/.test(e)));
  assert.match(planText(s, planTurn(s, { kind: "custom", text: "x" })), /Time: Day/);
});

test("sidetracks take time: success gives an insight (advantage next), failure a dead end that ticks the clock", () => {
  const s = regionGame();
  s.scene.options = [opt("Chase a rumor", "sidetrack")];
  const part = s.time.part;
  const r = play(s, 0);
  assert.equal(s.time.part, part + 1);
  assert.match(r.plan.lines.join(" "), /Sidetrack: a dead end for the quest, but the character gains an insight/);
  assert.deepEqual(s.actors.pc.edge_next, { kind: null, from: "insight" });
  const next = play(s, 1);
  assert.equal(next.dice.edge, "advantage");
  assert.match(next.dice.note, /advantage: insight/);
  assert.equal(s.actors.pc.edge_next, null);
  // a failed sidetrack: weak character, daunting tier
  const w = regionGame("weak");
  for (const k of Object.keys(w.actors.pc.stats)) w.actors.pc.stats[k] = -5;
  let ticked = false;
  for (let i = 0; i < 8 && !ticked; i++) {
    w.scene.options = [opt("Chase a rumor", "sidetrack", { tier: "daunting" })];
    const before = w.clock.filled;
    const t = play(w, 0);
    if (t.dice.result === "failure") { assert.equal(w.clock.filled, (before + 1) % CLOCK_SEGMENTS || CLOCK_SEGMENTS); ticked = true; }
  }
  assert.ok(ticked);
});

test("time: code owns the day; it moves every few idle turns and with travel; travel times are fixed per route", () => {
  const s = regionGame();
  assert.equal(timeLabel(s.time), "Day 1, morning");
  for (let i = 0; i < TIME_IDLE; i++) play(s, 1);
  assert.equal(s.time.part, 1, "the time of day moved on by itself");
  // travel to a linked place takes the route's time, whatever the AI proposes
  const gull = findEntity(s, "Gull's Landing", "location"), ford = findEntity(s, "Harrow Ford", "location");
  const before = { ...s.time };
  const r = play(s, 1, reply({ state_changes: [{ actor: "pc", kind: "move", amount: 0, text: "Gull's Landing", reason: "" }, { actor: "pc", kind: "time", amount: 4, text: "", reason: "" }] }));
  const parts = ford.travel[gull.id];
  assert.equal((s.time.day - before.day) * 4 + s.time.part - before.part, parts);
  assert.equal(s.scene.location_id, gull.id);
  assert.ok(r.record.state_changes.some((c) => c.kind === "move" && c.result === "moved"));
  // a new route: the AI's time becomes the route's time
  play(s, 1, reply({ state_changes: [{ actor: "pc", kind: "move", amount: 0, text: "Hidden Mill", reason: "" }, { actor: "pc", kind: "time", amount: 3, text: "", reason: "" }] }));
  const mill = findEntity(s, "Hidden Mill", "location");
  assert.equal(gull.travel[mill.id], 3);
  assert.equal(s.world.extra_places, 1);
  // the region is the map: after EXTRA_PLACES new places, a move to a new name is refused and a new place becomes lore
  for (let i = 0; i < EXTRA_PLACES; i++) applyNewFacts(s, [{ entity: `New Place ${i}`, type: "location", kind: "place", fact: "x", location: "", was: "" }], s.turn);
  assert.equal(s.world.extra_places, EXTRA_PLACES);
  assert.equal(findEntity(s, `New Place ${EXTRA_PLACES - 1}`).type, "lore");
  const far = play(s, 1, reply({ state_changes: [{ actor: "pc", kind: "move", amount: 0, text: "Highmark", reason: "" }] }));
  assert.ok(far.record.state_changes.some((c) => c.kind === "move" && c.result === "beyond the region"));
  assert.equal(s.scene.location_id, mill.id);
});

test("the threat clock: signs as it fills, a doom when full, back to zero, the worst after three; a finished milestone pushes it back", () => {
  const s = regionGame();
  const seen = [];
  for (let i = 0; i < CLOCK_SEGMENTS * MAX_DOOMS + 4; i++) {
    s.scene.options = [opt("Shortcut", "costly")];
    const r = play(s, 0);
    seen.push(...r.events.filter((e) => /^(The threat grows|Doom:)/.test(e)));
    if (s.quests.main.choosing || s.over) break;
  }
  assert.ok(seen.includes(`The threat grows: The cut is opened (1/${CLOCK_SEGMENTS})`));
  assert.ok(seen.some((e) => e === "Doom: Maren vanishes."), seen.join(" | "));
  assert.ok(s.clock.dooms_hit >= 1);
  assert.ok(s.quests.flags.some((f) => f.text === "Doom: Maren vanishes."));
  // the AI is told the sign in the same turn, and a doom as a hard setback
  const c = regionGame("clock2");
  c.clock.filled = CLOCK_SEGMENTS - 1;
  c.scene.options = [opt("Shortcut", "costly")];
  const plan = planTurn(c, { kind: "option", text: "Shortcut", option: c.scene.options[0] });
  assert.match(planText(c, plan), /DOOM \(the threat clock "The cut is opened" filled\): Maren vanishes\./);
  // after the last doom the clock stays full and nothing more happens
  c.clock.dooms_hit = MAX_DOOMS; c.clock.filled = CLOCK_SEGMENTS;
  const after = play(c, 0);
  assert.ok(!after.events.some((e) => /Doom|threat grows/.test(e)));
});

test("a stalled milestone gets its next lead brought to the character; a dragging one ticks the clock", () => {
  const s = regionGame();
  const m1 = currentMilestone(s);
  let nudged = null;
  for (let i = 0; i < NUDGE_TURNS + 1 && !nudged; i++) { const r = play(s, 1); if (r.plan.nudge) nudged = r; }
  assert.ok(nudged, "a nudge came");
  assert.match(nudged.plan.lines.join(" "), /A lead comes to the character unasked/);
  assert.equal(m1.leads.filter((l) => l.revealed).length, 2);
  // drag: the clock ticks once the milestone is older than DRAG_TURNS
  const d = regionGame("drag");
  currentMilestone(d).started_turn = d.turn + 1 - DRAG_TURNS;
  const plan = planTurn(d, { kind: "option", text: "Look about", option: opt("Look about") });
  assert.ok(plan.ticks.includes("drag"));
});

test("the key decision and the finale: choices are options, the branch opens, the last milestone ends the game", () => {
  const s = regionGame();
  play(s, 1, reply({ narration: ["Maren looks up from her sewing."] }));
  for (let k = 0; k < 6; k++) playMilestone(s);
  assert.equal(s.quests.main.choosing, true, `current ${s.quests.main.current}`);
  const pub = publicState(s);
  assert.deepEqual(pub.scene.options.filter((o) => o.tag === "Decision").map((o) => o.text), ["Hand Hale to the Wardens", "Make a deal with Hale"]);
  assert.ok(pub.scene.options.length <= 4);
  // quest options cannot move the main quest while the decision is open
  assert.equal(planTurn(s, { kind: "option", text: "x", option: opt("x", "advance") }).step, null);
  assert.match(questBlock(s), /After this milestone comes the key decision|Milestone 6 of 8/);
  const idx = s.scene.options.findIndex((o) => o.text === "Make a deal with Hale");
  const pick = play(s, idx);
  assert.equal(pick.dice, null, "a decision is not a check");
  assert.equal(s.quests.main.branch, "b");
  assert.equal(s.quests.main.current, "b1");
  assert.match(pick.plan.lines[0], /makes the key decision: "Make a deal with Hale"/);
  assert.ok(pick.events.includes("You chose: Make a deal with Hale"));
  playMilestone(s);
  assert.equal(s.quests.main.current, "b2");
  playMilestone(s);
  assert.ok(s.over, "the finale ends the game");
  assert.equal(s.over.kind, "won");
  assert.deepEqual(s.scene.options, []);
  const q = publicQuests(s);
  assert.equal(q.main.complete, true);
  assert.equal(q.main.branch, "Make a deal with Hale");
  assert.equal(q.main.done.length, 8);
  // the epilogue is built from the player's choices
  const mat = epilogueMaterial(s);
  assert.match(mat, /The key decision: Make a deal with Hale/);
  assert.match(mat, /Milestones achieved: .*Open the cut together/);
  assert.match(mat, /Person: Maren, \w+ toward the character/);
  assert.equal(plainEpilogue(s).length, 2);
});

test("people: first reactions from code, met when named, one attitude step a turn, attitude shifts social checks", () => {
  const s = regionGame();
  const hale = findEntity(s, "Hale", "npc");
  const first = npcReaction(s, hale);
  assert.ok(first >= -2 && first <= 2);
  assert.equal(hale.values, "law");
  play(s, 1, reply({ narration: ["Hale steps out of the rain."] }));
  assert.equal(hale.met, true);
  assert.equal(hale.attitude, first);
  assert.equal(hale.known, true);
  // a new person introduced by the AI starts with this turn's rolled reaction and gets a profile
  const r = play(s, 1, reply({ new_facts: [{ entity: "Odo Fenn", type: "npc", kind: "identity", fact: "A carter", location: "", was: "" }], profiles: [{ npc: "Odo Fenn", want: "his cart back", fear: "debt", secret: "stole it", voice: "mumbles" }] }));
  const odo = findEntity(s, "Odo Fenn", "npc");
  assert.equal(odo.attitude, r.plan.newcomer);
  assert.equal(odo.profile.voice, "mumbles");
  // attitude: one step a turn, never beyond loyal or hostile, a note when the label changes
  hale.attitude = 0;
  const up = play(s, 1, reply({ state_changes: [{ actor: "pc", kind: "attitude", amount: 1, text: "Hale", reason: "" }, { actor: "pc", kind: "attitude", amount: 1, text: "Hale", reason: "" }] }));
  assert.equal(hale.attitude, 1);
  assert.ok(up.events.includes("Hale is now friendly"));
  assert.equal(attitudeLabel(2), "loyal");
  // an unmet person cannot be shifted
  const ide = findEntity(s, "Sister Ide", "npc");
  play(s, 1, reply({ state_changes: [{ actor: "pc", kind: "attitude", amount: -1, text: "Sister Ide", reason: "" }] }));
  assert.equal(ide.met, false);
  // a friendly person makes a social check easier, a hostile one harder
  hale.attitude = 2;
  const easy = planTurn(s, { kind: "option", text: "x", option: opt("Talk to Hale", "scene", { npc: "Hale" }) });
  hale.attitude = -2;
  const hard = planTurn(s, { kind: "option", text: "x", option: opt("Talk to Hale", "scene", { npc: "Hale" }) });
  assert.equal(hard.dice.dc - easy.dice.dc, 4);
  assert.match(hard.dice.note, /Hale is hostile: difficulty \+2/);
});

test("side quests: seeded ones surface where their giver is and start when taken up; earned ones are capped; focus moves", () => {
  const s = regionGame();
  assert.deepEqual(publicQuests(s).side, []);
  const plan = planTurn(s, { kind: "option", text: "x", option: opt("x") });
  assert.match(plan.lines.join(" "), /A side quest can be offered here: s1 "Maren's son"/);
  s.scene.options = [opt("Ask about Maren's son", "advance", { quest: "s1" })];
  const r = play(s, 0);
  if (r.dice.result !== "failure") {
    assert.equal(s.quests.side.s1.status, "active");
    assert.ok(r.events.includes("New side quest: Maren's son"));
    assert.equal(s.quests.side.s1.leads.filter((l) => l.revealed).length, 1);
  }
  assert.equal(setFocus(s, "s2"), false, "a hidden side quest cannot be focused");
  assert.equal(setFocus(s, "s1"), true);
  assert.match(questBlock(s), /Focused quest: Maren's son/);
  // finish it: three steps, three turns apart; +10 XP; the focus returns to the main quest
  for (let i = 0; i < 30 && s.quests.side.s1.status === "active"; i++) { s.scene.options = [opt("Search for the boy", "advance", { quest: "s1" })]; play(s, 0); }
  assert.equal(s.quests.side.s1.status, "completed");
  assert.equal(s.quests.focus, "main");
  // earned side quests: one open at a time; a failed flag closes one
  play(s, 1, reply({ side_quest: { title: "The drowned cart", goal: "Pull the cart out", giver: "Maren" } }));
  play(s, 1, reply({ side_quest: { title: "Another errand", goal: "Refused", giver: "Maren" } }));
  const earned = Object.values(s.quests.side).filter((x) => x.origin === "story");
  assert.deepEqual(earned.map((x) => x.title), ["The drowned cart"]);
  const r2 = play(s, 1, reply({ quest_flags: [`failed:${earned[0].id}`] }));
  assert.equal(earned[0].status, "failed");
  assert.ok(r2.events.includes("Side quest failed: The drowned cart"));
});

test("free-text actions: code rolls, the AI picks stat and tier from the table, a wrong result is rejected", () => {
  const s = regionGame();
  const action = { kind: "custom", text: "I climb onto the roof" };
  const plan = planTurn(s, action);
  assert.ok(plan.custom.die >= 1 && plan.custom.die <= 20);
  const text = planText(s, plan);
  assert.match(text, /Free-text action: the app rolled d20 = \d+/);
  assert.match(text, /Results: might \+\d+: easy \w+, standard \w+, hard \w+, daunting \w+ \| wits/);
  const want = plan.custom.rows.might.results.hard;
  const wrong = want === "success" ? "failure" : "success";
  assert.equal(validateTurn(reply({ custom_roll: { stat: "might", tier: "hard", value: "scene", result: wrong } }), s, plan).turn, null);
  const ok = validateTurn(reply({ custom_roll: { stat: "might", tier: "hard", value: "advance", result: want } }), s, plan).turn;
  assert.ok(ok);
  // blocked: no roll at all
  const blocked = validateTurn(reply({ classification: "blocked", custom_roll: { stat: "might", tier: "hard", value: "advance", result: wrong } }), s, plan).turn;
  assert.equal(blocked.custom_roll.tier, "none");
  const r = settleTurn(s, action, plan, { turn: ok, model: "m", usage: {}, cost: 0, attempts: 1, est: 0 });
  assert.equal(r.dice.tier, "hard");
  assert.equal(r.dice.result, want);
  const p = buildPrompt(s, action, null, planTurn(s, action));
  assert.match(p.messages[0].content[1].text, /Dice: see the free-text roll under This turn/);
  assert.ok(RULES.includes("custom_roll"));
});

test("v5 saves migrate to v6: the placeholder quest gets leads, a clock and a day; people are met and neutral", () => {
  const s = newGame();
  s.v = 5;
  s.quests = { main: { title: "The Burned Bridge", milestones: { m1: { id: "m1", title: "Learn who burned the bridge", conditions: ["x"], status: "ongoing", next: ["m2"] }, m2: { id: "m2", title: "y", conditions: [], status: "undiscovered", next: [] } }, current: "m1", finale: "m3" }, side: {}, focus: "main" };
  delete s.clock; delete s.time; delete s.world; delete s.over;
  s.turn = 40;
  applyNewFacts(s, [{ entity: "Maren", type: "npc", kind: "identity", fact: "Sews seals", location: "", was: "" }], 3);
  const maren = findEntity(s, "Maren");
  delete maren.attitude; delete maren.met; delete maren.known;
  s.scene.options = s.scene.options.map(({ value, quest, npc, ...o }) => o);
  migrate(s);
  assert.equal(s.v, 6);
  assert.equal(s.world, null);
  assert.equal(s.quests.main.current, "m1");
  assert.equal(currentMilestone(s).started_turn, 40);
  assert.equal(currentMilestone(s).leads.filter((l) => l.revealed).length, 1);
  assert.equal(timeLabel(s.time), "Day 1, morning");
  assert.equal(s.clock.filled, 0);
  assert.equal(maren.met, true);
  assert.equal(maren.attitude, 0);
  assert.equal(s.scene.options[0].value, "scene");
  assert.equal(s.over, null);
  // the migrated game plays on
  for (const k of Object.keys(s.actors.pc.stats)) s.actors.pc.stats[k] = 30;
  s.id = "migrated";
  s.scene.options = [opt("Ask about the fire", "advance")];
  for (let i = 0; i < 40 && s.quests.main.current === "m1"; i++) { s.scene.options = [opt("Ask about the fire", "advance")]; play(s, 0); }
  assert.equal(s.quests.main.current, "m2");
});

test("a summary that runs long is cut at a sentence end", () => {
  const long = "One two three four. ".repeat(80).trim();
  const cut = capWords(long, 280);
  assert.ok(cut.split(/\s+/).length <= 280);
  assert.ok(cut.endsWith("four."));
  assert.equal(capWords("Short.", 280), "Short.");
});
