import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { newGame, migrate, ledgerView, publicState } from "../src/schema.js";
import {
  rollOption, classify, applyChanges, gainXp, turnDie, logDifficulty, rng, xpForLevel, XP_AT, maxHpOf, packUsed, packSlots,
  applyPick, useTalent, dropItem, alignLabel, recordFailure, activeFailures, clearFailures, consumeEdge, addTalent, resultOf, awardQuestXp,
} from "../src/rules.js";
import { TIERS, TALENTS, BACKGROUNDS } from "../src/content.js";
import { validateCharacter, DEFAULT_CHARACTER } from "../src/character.js";

const opt = (stat = "wits", tier = "standard", extra = {}) => ({ text: "x", kind: "social", stat, tier, edge: "none", edge_why: "", ...extra });
const game = (char = {}) => newGame("main", undefined, { ...DEFAULT_CHARACTER, ...char });
const ch = (kind, amount, text = "") => ({ actor: "pc", kind, amount, text, reason: "" });

test("dice are seeded per turn: same turn same die, whatever the option", () => {
  const s = game();
  const a = rollOption(s, opt("wits", "easy"));
  const b = rollOption(s, opt("might", "hard"));
  assert.equal(a.die, b.die);
  assert.equal(a.die, turnDie(s));
  const dice = new Set();
  for (let t = 1; t <= 60; t++) { s.turn = t; dice.add(turnDie(s)); }
  assert.ok(dice.size > 10 && [...dice].every((d) => d >= 1 && d <= 20));
  assert.equal(rng("a")(), rng("a")());
});

test("difficulty comes from the tier and the place, never from the player's level", () => {
  const s = game();
  assert.deepEqual(TIERS, { easy: 7, standard: 10, hard: 13, daunting: 16 });
  for (const level of [1, 5, 10]) {
    s.actors.pc.level = level;
    assert.equal(rollOption(s, opt("wits", "standard")).dc, 10);
    assert.equal(rollOption(s, opt("wits", "daunting")).dc, 16);
  }
  s.ledger.entities["location-the-rusted-ford"].danger = 2;
  assert.equal(rollOption(s, opt("wits", "hard")).dc, 15);
  assert.equal(rollOption(s, { ...opt(), tier: "legendary" }).dc, 12); // unknown tier falls back to standard
  assert.equal(rollOption(s, { text: "x", kind: "social", stat: "wits", difficulty: 17 }).dc, 18); // an old numeric option
  const d = rollOption(s, opt("wits", "hard"));
  logDifficulty(s, d);
  assert.equal(s.counters.dc[15], 1);
  assert.equal(s.counters.tiers.hard, 1);
  assert.equal(s.counters.results[resultOf(d)], 1);
});

test("three results: success, success at a cost (missed by 1-2), failure; natural 20 and 1 are special", () => {
  assert.equal(classify(10, 12, 12), "success");
  assert.equal(classify(10, 11, 12), "cost");
  assert.equal(classify(10, 10, 12), "cost");
  assert.equal(classify(10, 9, 12), "failure");
  assert.equal(classify(20, 5, 16), "success");
  assert.equal(classify(1, 30, 7), "failure");
  assert.equal(resultOf({ success: true }), "success"); // records from before Phase 5
  assert.equal(resultOf({ success: false }), "failure");
});

test("an average check lands near 65% and a stronger character does better in the same place", () => {
  const s = game({ background: "clerk", free: { wits: 1, charm: 1 }, talent: "keen-eye" }); // wits 4
  s.id = "fixed-game"; // the dice are seeded by game id, so this test is deterministic
  const rate = (stat, tier) => {
    let ok = 0, okOrCost = 0;
    for (let t = 1; t <= 4000; t++) {
      s.turn = t;
      const r = resultOf(rollOption(s, opt(stat, tier)));
      if (r === "success") ok++;
      if (r !== "failure") okOrCost++;
    }
    return [ok / 4000, okOrCost / 4000];
  };
  const [avg, avgWithCost] = rate("charm", "standard"); // charm +3 with the clerk spread plus 1 free point
  assert.ok(avg > 0.6 && avg < 0.9, `standard rate ${avg}`);
  assert.ok(avgWithCost > avg);
  const [low] = rate("might", "standard"); // might 0
  assert.ok(low > 0.4 && low < 0.6, `untrained rate ${low}`);
  const strong = rate("wits", "daunting")[0];
  s.actors.pc.stats.wits = 8; // the level-10 build
  assert.ok(rate("wits", "daunting")[0] > strong + 0.15);
});

test("advantage and disadvantage use two seeded dice, never a reroll", () => {
  const s = game();
  s.turn = 7;
  const base = rollOption(s, opt());
  const adv = rollOption(s, opt("wits", "standard", { edge: "advantage", edge_why: "borrowed lantern" }));
  const dis = rollOption(s, opt("wits", "standard", { edge: "disadvantage", edge_why: "pouring rain" }));
  assert.equal(adv.edge, "advantage");
  assert.ok(adv.die >= adv.die2 && [adv.die, adv.die2].includes(base.die)); // the better of the turn's two dice
  assert.ok(dis.die <= dis.die2 && [dis.die, dis.die2].includes(base.die));
  assert.deepEqual(rollOption(s, opt("wits", "standard", { edge: "advantage", edge_why: "borrowed lantern" })), adv);
  assert.match(adv.note, /advantage: borrowed lantern/);
  // a talent's advantage cancels the situation's disadvantage, and is only spent by consumeEdge
  s.actors.pc.edge_next = { kind: null, from: "quick-study" };
  const both = rollOption(s, opt("wits", "standard", { edge: "disadvantage", edge_why: "rain" }));
  assert.equal(both.edge, null);
  assert.equal(both.die, base.die);
  consumeEdge(s, both);
  assert.equal(s.actors.pc.edge_next, null);
});

test("roll modifier: stat, matching gear, talent bonus, wounded", () => {
  const s = game(); // drover: grit 3, might 2, wits 2 (1 + free), charm 1; cudgel helps might, coat helps grit
  const p = s.actors.pc;
  assert.equal(rollOption(s, opt("wits")).mod, 2);
  assert.equal(rollOption(s, opt("might")).mod, 3); // 2 + cudgel
  p.conditions.push("Wounded");
  assert.equal(rollOption(s, opt("grit")).mod, 3); // 3 + coat - 1
  addTalent(p, "grim-resolve");
  assert.equal(rollOption(s, opt("grit")).mod, 4);
  addTalent(p, "silver-tongue");
  assert.equal(rollOption(s, opt("charm", "standard")).mod, 2); // charm 1 + silver tongue on a social option
  assert.equal(rollOption(s, opt("charm", "standard", { kind: "direct" })).mod, 1);
});

test("xp: one note per turn, a table sized for the game, levels give a stat pick or a talent pick, cap at 10", () => {
  const s = game();
  const p = s.actors.pc;
  assert.equal(xpForLevel(2), 40);
  assert.ok(XP_AT[10] > 1000 && XP_AT[7] <= 700);
  const ev = [];
  gainXp(s, p, 41, ev);
  assert.equal(p.level, 2);
  assert.deepEqual(p.picks.map((x) => x.kind), ["stat"]);
  assert.equal(ev.filter((e) => /XP/.test(e)).length, 1);
  assert.ok(ev.some((e) => e.startsWith("Level 2")));
  gainXp(s, p, 60, []);
  assert.equal(p.level, 3);
  assert.deepEqual(p.picks.map((x) => x.kind), ["stat", "talent"]);
  assert.equal(p.picks[1].offer.length, 3);
  // the same game offers the same talents
  const again = game();
  again.id = s.id;
  gainXp(again, again.actors.pc, 101, []);
  assert.deepEqual(again.actors.pc.picks[1].offer, p.picks[1].offer);
  gainXp(s, p, 100000, []);
  assert.equal(p.level, 10);
  const at = p.xp;
  gainXp(s, p, 50, []);
  assert.equal(p.xp, at);
  const q = [];
  const s2 = game();
  awardQuestXp(s2, s2.actors.pc, "milestone", q);
  assert.equal(s2.actors.pc.xp, 25);
});

test("picks: raise a stat, choose a talent; max HP follows Grit and Tough as Boots", () => {
  const s = game();
  const p = s.actors.pc;
  assert.equal(p.hp_max, 16 + 6); // grit 3
  gainXp(s, p, 41, []);
  assert.deepEqual(applyPick(s, { kind: "talent", talent: "tough" }), { ok: false, error: "no_such_pick", events: [] });
  assert.equal(applyPick(s, { kind: "stat", stat: "luck" }).ok, false);
  const hp0 = p.hp;
  const r = applyPick(s, { kind: "stat", stat: "grit" });
  assert.ok(r.ok);
  assert.equal(p.stats.grit, 4);
  assert.equal(p.hp_max, 16 + 8 + 3);
  assert.equal(p.hp, hp0 + 2);
  assert.equal(p.picks.length, 0);
  gainXp(s, p, 100, []);
  const offer = p.picks[0].offer;
  assert.equal(applyPick(s, { kind: "talent", talent: "nope" }).ok, false);
  assert.ok(applyPick(s, { kind: "talent", talent: offer[0] }).ok);
  assert.ok(p.talents.some((t) => t.id === offer[0]));
  const m = game();
  addTalent(m.actors.pc, "tough");
  assert.equal(maxHpOf(m.actors.pc), 16 + 6 + 4);
});

test("talents: heal, cleanse and edge are usable on a cooldown and never roll", () => {
  const s = game({ background: "soldier", talent: "second-wind" });
  const p = s.actors.pc;
  assert.equal(useTalent(s, "second-wind").error, "full_health");
  p.hp = 5;
  const r = useTalent(s, "second-wind");
  assert.ok(r.ok);
  assert.equal(p.hp, 5 + Math.ceil(p.hp_max * 0.33));
  assert.equal(useTalent(s, "second-wind").error, "not_ready");
  s.turn += 10;
  assert.notEqual(useTalent(s, "second-wind").error, "not_ready");
  assert.equal(useTalent(s, "heavy-hand").error, "not_usable");

  addTalent(p, "iron-will");
  assert.equal(useTalent(s, "iron-will").error, "nothing_to_clear");
  p.conditions.push("Poisoned", "Wounded");
  assert.ok(useTalent(s, "iron-will").ok);
  assert.deepEqual(p.conditions, ["Wounded"]);

  addTalent(p, "commanding-presence");
  assert.ok(useTalent(s, "commanding-presence").ok);
  assert.deepEqual(p.edge_next, { kind: "social", from: "commanding-presence" });
  assert.equal(rollOption(s, opt("charm", "standard", { kind: "direct" })).edge, null); // wrong kind: not spent
  assert.equal(rollOption(s, opt("charm", "standard", { kind: "social" })).edge, "advantage");
  assert.equal(publicState(s).pc.talents.find((t) => t.id === "commanding-presence").ready_in, 10);
});

test("AI changes are validated: hp clamp and floor, wounded, xp cap and one note, loot from table", () => {
  const s = game();
  const p = s.actors.pc;
  const max = p.hp_max;
  applyChanges(s, [ch("hp", -500)], null);
  assert.equal(p.hp, max - Math.ceil(max / 2)); // one hit is capped at half max HP
  applyChanges(s, [ch("hp", -500)], null);
  applyChanges(s, [ch("hp", -500)], null);
  assert.equal(p.hp, 1);
  assert.ok(p.conditions.includes("Wounded"));
  applyChanges(s, [ch("hp", 500)], null);
  assert.equal(p.hp, 1 + Math.ceil(max / 4)); // heal capped at a quarter of max
  for (let i = 0; i < 4; i++) applyChanges(s, [ch("hp", 500)], null);
  assert.ok(!p.conditions.includes("Wounded")); // back above half
  const xp0 = p.xp;
  const out = applyChanges(s, [ch("xp", 999)], { result: "success", success: true });
  assert.equal(p.xp - xp0, 2 + 3); // roll XP plus the AI bonus, capped at 3
  assert.equal(out.events.filter((e) => /XP/.test(e)).length, 1);
  const f = applyChanges(s, [], { result: "failure", success: false });
  assert.equal(f.events[0], "+1 XP");
  applyChanges(s, [ch("condition_add", 0, "Wounded"), ch("condition_add", 0, "Poisoned")], null);
  assert.deepEqual(p.conditions, ["Poisoned"]);
  const r1 = applyChanges(s, [ch("item_add", 1, "Iron dagger"), ch("item_add", 3, "Candle")], null);
  assert.ok(p.inventory.some((i) => i.name === "Candle" && i.qty === 3));
  assert.ok(r1.events.some((e) => e.includes("Iron dagger")));
  // same turn, same loot: replaying gives the same rarity
  const find = (sv) => Object.values(sv.actors.pc.equipment).concat(sv.actors.pc.inventory.map((i) => i.gear)).filter((g) => g?.name === "Iron dagger")[0];
  const s2 = game();
  applyChanges(s2, [ch("item_add", 1, "Iron dagger")], null);
  const s3 = game(); s3.id = s2.id;
  applyChanges(s3, [ch("item_add", 1, "Iron dagger")], null);
  assert.equal(find(s2).rarity, find(s3).rarity);
});

test("item slots: 10 + Grit, big items take 2, coins are free, a full pack leaves loot behind", () => {
  const s = game({ talent: "tough" }); // grit 3 -> 13 slots
  const p = s.actors.pc;
  assert.equal(packSlots(p), 13);
  assert.equal(packUsed(p), 2); // rations and rope; coins are free
  addTalent(p, "pack-mule");
  assert.equal(packSlots(p), 15);
  applyChanges(s, [ch("item_add", 500, "Coins")], null);
  assert.equal(packUsed(p), 2);
  p.inventory.push({ id: "big", name: "Splint mail", qty: 1, note: "", gear: { id: "big", name: "Splint mail", big: true } });
  assert.equal(packUsed(p), 4);
  for (let i = 0; i < 11; i++) applyChanges(s, [ch("item_add", 1, `Odd thing ${i}`)], null);
  assert.equal(packUsed(p), 15);
  const full = applyChanges(s, [ch("item_add", 1, "One more thing")], null);
  assert.ok(full.events.some((e) => e.startsWith("Pack full")));
  assert.ok(!p.inventory.some((i) => i.name === "One more thing"));
  assert.equal(full.changes[0].applied, false);
  // stacks of small things share a slot up to 10
  applyChanges(s, [ch("item_remove", 1, "Odd thing 0")], null);
  assert.ok(dropItem(s, "big").ok);
  assert.equal(dropItem(s, "item-coins").ok, false);
  assert.ok(packUsed(p) < 15);
  assert.equal(publicState(s).pc.slots.max, 15);
});

test("alignment: one small step per axis per turn, a label from thresholds, a note when it changes", () => {
  const s = game({ law: "lawful", good: "good" });
  const p = s.actors.pc;
  assert.equal(alignLabel(p.align), "Lawful Good");
  const out = applyChanges(s, [ch("good", 1), ch("good", 1), ch("law", -1)], null);
  assert.equal(p.align.good, 5); // second good step in the same turn is ignored
  assert.equal(p.align.law, 3);
  assert.equal(out.changes[1].applied, false);
  assert.equal(alignLabel(p.align), "Lawful Good");
  for (let i = 0; i < 2; i++) applyChanges(s, [ch("law", -1)], null);
  assert.equal(p.align.law, 1);
  assert.equal(alignLabel(p.align), "Neutral Good");
  const n = game();
  assert.equal(alignLabel(n.actors.pc.align), "True Neutral");
  let notes = [];
  for (let i = 0; i < 3; i++) notes = notes.concat(applyChanges(n, [ch("good", -1)], null).events);
  assert.equal(alignLabel(n.actors.pc.align), "Neutral Evil");
  assert.ok(notes.some((e) => /cruelty/.test(e)));
  for (let i = 0; i < 40; i++) applyChanges(n, [ch("good", -1)], null);
  assert.equal(n.actors.pc.align.good, -12);
  assert.ok(!JSON.stringify(publicState(n)).includes('"good":-12')); // only the label leaves the server
});

test("no retry without change: a failed approach is remembered until a move, new gear or 8 turns", () => {
  const s = game();
  const act = { kind: "option", text: "Pick the lock" };
  recordFailure(s, act, { result: "cost", success: true });
  assert.equal(activeFailures(s).length, 0);
  recordFailure(s, act, { result: "failure", success: false });
  assert.deepEqual(activeFailures(s).map((f) => f.text), ["Pick the lock"]);
  s.turn += 9;
  assert.equal(activeFailures(s).length, 0);
  s.turn -= 9;
  s.scene.location_id = "elsewhere";
  assert.equal(activeFailures(s).length, 0);
  s.scene.location_id = "location-the-rusted-ford";
  clearFailures(s);
  assert.equal(activeFailures(s).length, 0);
});

test("character creation is validated; backgrounds and talents are consistent", () => {
  for (const bad of [{ name: "" }, { name: "<b>x</b>" }, { background: "wizard" }, { drive: "x" }, { flaw: "x" }, { law: "x" }, { good: "x" }, { free: { wits: 3 } }, { free: { wits: 1 } }, { free: { grit: 2 } }, { talent: "second-wind" }]) {
    assert.ok(validateCharacter({ ...DEFAULT_CHARACTER, ...bad }).error, JSON.stringify(bad));
  }
  assert.ok(validateCharacter(DEFAULT_CHARACTER).character);
  for (const [id, b] of Object.entries(BACKGROUNDS)) {
    assert.deepEqual(Object.values(b.stats).sort(), [0, 1, 2, 3], id);
    for (const t of b.talents) assert.ok(TALENTS[t], `${id}: ${t}`);
  }
  assert.equal(Object.keys(TALENTS).length, 12);
  const s = game({ background: "soldier", free: { wits: 2 }, talent: "iron-will", law: "chaotic", good: "evil" });
  const p = s.actors.pc;
  assert.deepEqual(p.stats, { might: 3, wits: 2, charm: 1, grit: 2 });
  assert.equal(p.hp, p.hp_max);
  assert.equal(alignLabel(p.align), "Chaotic Evil");
  assert.equal(p.equipment.weapon.slot, "weapon");
  assert.equal(p.talents[0].id, "iron-will");
  assert.ok(s.summary.text.startsWith("Ash"));
});

test("v3 saves migrate to v4: new stat, talent picks, tiers, hp formula", () => {
  const old = JSON.parse(fs.readFileSync(new URL("./fixtures/save-v3.json", import.meta.url), "utf8"));
  assert.equal(old.v, 3);
  const s = migrate(structuredClone(old));
  const p = s.actors.pc;
  assert.equal(s.v, 4);
  assert.equal(p.stats.charm, 0);
  assert.equal(p.stats.wits, 3);
  assert.equal(p.level, 3);
  assert.equal(p.hp_max, 16 + 4 + 6); // new formula: 16 + 2 grit + 3 per level above 1
  assert.ok(p.hp <= p.hp_max);
  assert.deepEqual(p.picks.map((x) => x.kind), ["talent", "talent"]); // starting talent and the level 3 talent
  assert.equal(alignLabel(p.align), "True Neutral");
  assert.deepEqual(s.scene.options.map((o) => o.tier), ["hard", "daunting", "easy"]);
  assert.equal(s.scene.options[0].difficulty, undefined);
  assert.equal(s.recent[0].options[0].edge, "none");
  assert.equal(resultOf(s.recent[1].dice), "failure"); // old dice still read
  assert.equal(s.settings.setting, undefined);
  assert.deepEqual(s.failed, []);
  assert.equal(s.ledger.entities["location-the-rusted-ford"].facts.length, 2);
  assert.equal(s.counters.dc[11], 2);
  assert.equal(migrate(structuredClone(s)).v, 4); // migrating again changes nothing
  assert.equal(publicState(s).pc.pick.kind, "talent");
});

test("v1 saves migrate to the rules engine", () => {
  const s = game();
  s.v = 1;
  delete s.counters.dc; delete s.counters.dc_clamped;
  s.actors.pc.equipment = { weapon: { id: "item-worn-shortsword", name: "Worn shortsword" } };
  delete s.ledger.entities["location-the-rusted-ford"].danger;
  migrate(s);
  assert.equal(s.v, 4);
  assert.equal(s.actors.pc.equipment.weapon.damage, 3);
  assert.equal(s.ledger.entities["location-the-rusted-ford"].danger, 0);
  assert.deepEqual(s.counters.dc, {});
});

test("ledger view lists entities with facts, no internals", () => {
  const v = ledgerView(game());
  assert.equal(v.entities[0].name, "The Rusted Ford");
  assert.equal(v.entities[0].facts.length, 2);
  assert.ok(!("danger" in v.entities[0]));
});
