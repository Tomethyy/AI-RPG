// Shared basics: DOM helpers, local storage, server calls, and the story widgets (dice, header, options).
// Plain scripts share one global scope (no build step); load order is ui.js, panels.js, character.js, app.js.

const DEFAULT_SERVER = "https://ai-rpg.mr-tom-richter.workers.dev"; // not a secret; the game key is typed in on the phone
const LS = { server: "rpg.server", key: "rpg.key", pending: "rpg.pending" };

const $ = (id) => document.getElementById(id);
const story = $("story");
const sheet = $("sheet");
const backdrop = $("backdrop");
const generic = $("generic");
const custom = $("custom");
const customText = $("customText");

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch {} };
const serverUrl = () => lsGet(LS.server) || DEFAULT_SERVER;
const online = () => !!(serverUrl() && lsGet(LS.key));

async function api(path, body) {
  const res = await fetch(serverUrl() + path, {
    method: body ? "POST" : "GET",
    headers: { "X-Game-Key": lsGet(LS.key), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

function scrollDown() {
  story.scrollTo({ top: story.scrollHeight, behavior: "smooth" });
}

function addNote(text) {
  story.append(el("p", "note", text));
  scrollDown();
}

// Three results: success, success at a cost, failure. Records from before Phase 5 only have `success`.
const RESULT_LABELS = { success: ["Success", "success"], cost: ["Success at a cost", "cost"], failure: ["Failure", "fail"] };

function renderDice(d, animate = true) {
  const box = el("div", "dice");
  const die = el("div", animate ? "die rolling" : "die", animate ? "…" : String(d.die));
  const math = el("div", "math");
  const total = d.die + d.mod;
  const [label, cls] = RESULT_LABELS[d.result || (d.success ? "success" : "failure")];
  const edge = d.edge ? ` (${d.edge === "advantage" ? "advantage" : "disadvantage"}: ${d.die}, ${d.die2})` : "";
  math.innerHTML = `d20 <b>${d.die}</b>${edge} + ${d.label} <b>${d.mod >= 0 ? "+" : ""}${d.mod}</b> = <b>${total}</b> vs DC <b>${d.dc}</b><br>`;
  const crit = d.crit === 20 ? " · natural 20" : d.crit === 1 ? " · natural 1" : "";
  math.append(el("div", "result " + cls, label + crit));
  if (d.note) math.append(el("div", "dice-note", d.note));
  box.append(die, math);
  if (animate) setTimeout(() => { die.textContent = d.die; die.classList.remove("rolling"); }, 500);
  return box;
}

function renderHeader(location, hp, hpMax, turnNo) {
  $("location").textContent = location;
  $("hp").textContent = `HP ${hp}/${hpMax}`;
  $("hpfill").style.width = (hp / hpMax) * 100 + "%";
  const pct = hp / hpMax;
  $("hpbar").classList.toggle("mid", pct <= 0.5 && pct >= 0.25);
  $("hpbar").classList.toggle("low", pct < 0.25);
  $("hpbar").setAttribute("aria-valuenow", hp);
  $("hpbar").setAttribute("aria-valuemax", hpMax);
  $("turn").textContent = "Turn " + turnNo;
}

function renderOptions(texts, onPick) {
  const options = $("options");
  options.replaceChildren();
  texts.forEach((text, i) => {
    const btn = el("button", "", text);
    btn.type = "button";
    btn.addEventListener("click", () => onPick(i, text));
    options.append(btn);
  });
}
