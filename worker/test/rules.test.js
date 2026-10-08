import { test } from "node:test";
import assert from "node:assert/strict";
import { newGame, migrate, ledgerView } from "../src/schema.js";
import { rollOption, clampDifficulty, difficultyBand, applyChanges, gainXp, turnDie, logDifficulty, rng } from "../src/rules.js";

const opt = (stat = "wits", difficulty = 12) => ({ text: "x", kind: "social", stat, difficulty });

test("dice are seeded per turn: same turn same die, whatever the option", () => {
  const s = newGame();
  const a = rollOption(s, opt("wits", 10));
  const b = rollOption(s, opt("might", 14));
  assert.equal(a.die, b.die);
  assert.equal(a.die, turnDie(s));
  s.turn = 2;
  const dice = new Set();
  for (let t = 1; t <= 60; t++) { s.turn = t; dice.add(turnDie(s)); }
  assert.ok(dice.size > 10 && [...dice].every((d) => d >= 1 && d <= 20));
  assert.equal(rng("a")(), rng("a")());
});

test("difficulty clamp by level and danger", () => {
  assert.deepEqual(difficultyBand(1), [8, 11]);
  assert.deepEqual(difficultyBand(10), [15, 18]);
  assert.deepEqual(difficultyBand(10, 2), [17, 20]);
  assert.equal(clampDifficulty(25, 1), 11);
  assert.equal(clampDifficulty(2, 1), 8);
  assert.equal(clampDifficulty(30, 10, 2), 20);
  const s = newGame();
  const d = rollOption(s, opt("wits", 25));
  assert.equal(d.dc, 11);
  assert.equal(d.dc_proposed, 25);
  logDifficulty(s, d);
  assert.equal(s.counters.dc[11], 1);
  assert.equal(s.counters.dc_clamped, 1);
});

test("roll modifier: stat, matching gear, wounded", () => {
  const s = newGame(); // wits 2; coat helps grit, sword helps might
  assert.equal(rollOption(s, opt("wits")).mod, 2);
  assert.equal(rollOption(s, opt("might")).mod, 2); // 1 + sword
  s.actors.pc.conditions.push("Wounded");
  assert.equal(rollOption(s, opt("grit")).mod, 1); // 1 + coat - 1
});

test("xp levels up, caps, and raises the lowest stat", () => {
  const p = newGame().actors.pc;
  const ev = [];
  gainXp(p, 20, ev);
  assert.equal(p.level, 2);
  assert.equal(p.hp_max, 24);
  assert.equal(p.stats.might + p.stats.wits + p.stats.grit, 5);
  assert.ok(ev.some((e) => e.startsWith("Level 2")));
  gainXp(p, 10000, []);
  assert.equal(p.level, 10);
});

test("AI changes are validated: hp clamp and floor, wounded, xp cap, loot from table", () => {
  const s = newGame();
  const p = s.actors.pc;
  const ch = (kind, amount, text = "") => ({ actor: "pc", kind, amount, text, reason: "" });
  applyChanges(s, [ch("hp", -500)], null);
  assert.equal(p.hp, 8); // one hit is capped at half max HP
  applyChanges(s, [ch("hp", -500)], null);
  assert.equal(p.hp, 1);
  assert.ok(p.conditions.includes("Wounded"));
  applyChanges(s, [ch("hp", 500)], null);
  assert.equal(p.hp, 1 + 5); // heal capped at a quarter of max
  applyChanges(s, [ch("hp", 500)], null);
  applyChanges(s, [ch("hp", 500)], null);
  assert.ok(!p.conditions.includes("Wounded")); // back above half
  const xp0 = p.xp;
  applyChanges(s, [ch("xp", 999)], { success: true });
  assert.equal(p.xp - xp0, 3 + 4);
  applyChanges(s, [ch("condition_add", 0, "Wounded"), ch("condition_add", 0, "Poisoned")], null);
  assert.deepEqual(p.conditions, ["Poisoned"]);
  const r1 = applyChanges(s, [ch("item_add", 1, "Iron dagger"), ch("item_add", 3, "Candle")], null);
  assert.ok(p.inventory.some((i) => i.name === "Candle" && i.qty === 3));
  assert.ok(r1.events.some((e) => e.includes("Iron dagger")));
  // same turn, same loot: replaying gives the same rarity
  const s2 = newGame();
  applyChanges(s2, [ch("item_add", 1, "Iron dagger")], null);
  const first = Object.values(s2.actors.pc.equipment).concat(s2.actors.pc.inventory.map((i) => i.gear)).filter((g) => g?.name === "Iron dagger")[0];
  const s3 = newGame(); s3.id = s2.id;
  applyChanges(s3, [ch("item_add", 1, "Iron dagger")], null);
  const second = Object.values(s3.actors.pc.equipment).concat(s3.actors.pc.inventory.map((i) => i.gear)).filter((g) => g?.name === "Iron dagger")[0];
  assert.equal(first.rarity, second.rarity);
});

test("v1 saves migrate to the rules engine", () => {
  const s = newGame();
  s.v = 1;
  delete s.counters.dc; delete s.counters.dc_clamped;
  s.actors.pc.equipment = { weapon: { id: "item-worn-shortsword", name: "Worn shortsword" } };
  delete s.ledger.entities["location-the-rusted-ford"].danger;
  migrate(s);
  assert.equal(s.v, 2);
  assert.equal(s.actors.pc.equipment.weapon.damage, 3);
  assert.equal(s.ledger.entities["location-the-rusted-ford"].danger, 0);
  assert.deepEqual(s.counters.dc, {});
});

test("ledger view lists entities with facts, no internals", () => {
  const v = ledgerView(newGame());
  assert.equal(v.entities[0].name, "The Rusted Ford");
  assert.equal(v.entities[0].facts.length, 2);
  assert.ok(!("danger" in v.entities[0]));
});
