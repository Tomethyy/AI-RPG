// Playtest report: the story, the options (with the hidden tier and edge), the dice, what changed and what the ledger holds,
// as one plain-text block the player can copy from the phone and paste into a chat for review. No AI call.
import { TALENTS, BACKGROUNDS, DRIVES, FLAWS, STAT_LABELS } from "./content.js";
import { alignLabel, resultOf, packUsed, packSlots } from "./rules.js";
import { ARCHIVE_CHUNK } from "./schema.js";

export const PLAYTEST_MAX = 60; // turns in one report

const sign = (n) => (n >= 0 ? "+" : "") + n;

function diceLine(d) {
  if (!d) return "no roll";
  const edge = d.edge ? ` (${d.edge}: ${d.die}, ${d.die2})` : "";
  const crit = d.crit ? ` NAT ${d.crit}` : "";
  return `d20 ${d.die}${edge} ${sign(d.mod)} ${d.label} = ${d.die + d.mod} vs ${d.dc}${d.tier ? ` (${d.tier})` : ""} -> ${resultOf(d)}${crit}${d.note ? ` [${d.note}]` : ""}`;
}

const optionLine = (o, i) => `${i + 1}) ${o.text} [${o.kind}, ${o.stat}, ${o.tier || "?"}${o.edge && o.edge !== "none" ? `, ${o.edge}: ${o.edge_why}` : ""}]`;

// Which turn records to load: the last `last` turns of the game, from the archive chunks.
export function archiveKeys(save, last) {
  const to = save.turn, from = Math.max(2, to - last + 1);
  const keys = [];
  for (let c = Math.floor(from / ARCHIVE_CHUNK); c <= Math.floor(to / ARCHIVE_CHUNK); c++) keys.push(`arc:${save.id}:${c}`);
  return { keys, from, to };
}

// records: every archived record found, any order. Returns { text, turns }.
export function playtestReport(save, records, last, { spend } = {}) {
  const p = save.actors[save.party[0]];
  const from = Math.max(2, save.turn - last + 1);
  const turns = [...new Map(records.map((r) => [r.n, r])).values()].filter((r) => r.n >= from).sort((a, b) => a.n - b.n);
  const prevOptions = new Map(); // options offered before turn n, to describe what the player chose
  const all = [...new Map(records.map((r) => [r.n, r])).values()].sort((a, b) => a.n - b.n);
  for (const r of all) prevOptions.set(r.n + 1, r.options);
  prevOptions.set(2, save.intro?.options || null);

  const L = [];
  L.push(`PLAYTEST REPORT · game ${save.id.slice(0, 8)} · now at turn ${save.turn} · showing turns ${turns[0]?.n ?? "-"}-${turns.at(-1)?.n ?? "-"}`);
  const bio = p.bio ? `${BACKGROUNDS[p.bio.background]?.name}, drive: ${DRIVES[p.bio.drive]?.name}, flaw: ${FLAWS[p.bio.flaw]?.name}` : "no background (old save)";
  L.push(`${p.name} · ${bio} · level ${p.level} · XP ${p.xp} · HP ${p.hp}/${p.hp_max} · ${alignLabel(p.align)} (law ${p.align.law}, good ${p.align.good})`);
  L.push(`Stats: ${Object.entries(p.stats).map(([k, v]) => `${STAT_LABELS[k]} ${sign(v)}`).join(", ")} · Talents: ${(p.talents || []).map((t) => TALENTS[t.id]?.name).join(", ") || "none"} · Pack ${packUsed(p)}/${packSlots(p)} · Conditions: ${p.conditions.join(", ") || "none"}`);
  L.push(`Equipment: ${Object.entries(p.equipment).filter(([, v]) => v).map(([s, v]) => `${s} ${v.name}`).join(", ") || "none"} · Inventory: ${p.inventory.map((i) => `${i.name}${i.qty > 1 ? " x" + i.qty : ""}`).join(", ") || "nothing"}`);
  const c = save.counters;
  L.push(`Counters: AI turns ${c.ai_turns}, fallbacks ${c.fallbacks}, retries ${c.retries}, tiers ${JSON.stringify(c.tiers || {})}, results ${JSON.stringify(c.results || {})}, edges ${c.edges || 0}, repeats dropped ${c.options_dropped}, summaries ${c.summaries}, fact merges ${c.fact_merges || 0}, merges ${c.merges}${spend ? ` · spend today $${spend.today} of $${spend.cap}` : ""}`);
  L.push("");
  L.push("STORY SO FAR (rolling summary)");
  L.push(save.summary.text || "(none yet)");
  L.push("");
  if (save.intro?.narration) {
    L.push("OPENING SCENE (written by the intro call)");
    L.push(save.intro.narration.join("\n"));
    L.push(save.intro.options.map(optionLine).join("\n"));
    L.push("");
  }
  const newByTurn = new Map();
  for (const e of Object.values(save.ledger.entities)) newByTurn.set(e.first_turn, [...(newByTurn.get(e.first_turn) || []), `${e.name} (${e.type})`]);
  for (const r of turns) {
    const chosen = (prevOptions.get(r.n) || []).find((o) => o.text === r.action.text);
    L.push(`## Turn ${r.n} · ${save.ledger.entities[r.location_id]?.name || "?"}`);
    L.push(`Player (${r.action.kind}): ${r.action.text}${chosen ? ` [${chosen.kind}, ${chosen.stat}, ${chosen.tier || "?"}${chosen.edge && chosen.edge !== "none" ? `, ${chosen.edge}: ${chosen.edge_why}` : ""}]` : ""}`);
    L.push(`Dice: ${diceLine(r.dice)}`);
    L.push(...r.narration);
    L.push(`Options offered:\n${r.options.map(optionLine).join("\n")}`);
    const changes = (r.state_changes || []).map((s) => `${s.kind}${s.amount ? " " + sign(s.amount) : ""}${s.text ? " " + s.text : ""}${s.applied === false ? " (refused)" : ""}`);
    if (changes.length) L.push(`Changes: ${changes.join("; ")}`);
    if (r.events?.length) L.push(`Events: ${r.events.join(" | ")}`);
    const facts = (r.new_facts || []).filter((f) => f.fact).map((f) => `${f.entity} [${f.kind || "-"}]: ${f.fact}`);
    if (facts.length) L.push(`Facts recorded: ${facts.join(" | ")}`);
    const fresh = newByTurn.get(r.n);
    if (fresh) L.push(`NEW NAMES THIS TURN (${fresh.length}): ${fresh.join(", ")}`);
    const u = r.usage || {};
    L.push(`Cost: in ${u.input_tokens ?? "?"} cache-read ${u.cache_read_input_tokens ?? 0} cache-write ${u.cache_creation_input_tokens ?? 0} out ${u.output_tokens ?? "?"} $${(r.cost ?? 0).toFixed(4)}${r.attempts > 1 ? ` · ${r.attempts} attempts` : ""}`);
    L.push("");
  }
  L.push("CURRENT SCENE OPTIONS");
  L.push(save.scene.options.map(optionLine).join("\n"));
  L.push("");
  L.push("LEDGER (what the app remembers)");
  const byType = Object.values(save.ledger.entities).sort((a, b) => a.type.localeCompare(b.type) || a.first_turn - b.first_turn);
  for (const e of byType) {
    L.push(`- ${e.name} (${e.type}${e.aliases.length ? `, also ${e.aliases.join(" / ")}` : ""}, since turn ${e.first_turn}): ${e.facts.map((f) => `${f.kind ? `[${f.kind}] ` : ""}${f.text}`).join("; ") || "no facts"}`);
  }
  if (save.fallback_log?.length) {
    L.push("");
    L.push("FALLBACKS");
    for (const f of save.fallback_log) L.push(`- turn ${f.turn}: ${f.reason}${f.detail ? " " + f.detail : ""}`);
  }
  return { text: L.join("\n"), turns: turns.length };
}
