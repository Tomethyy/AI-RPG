// Phase 1 skeleton: everything here is hardcoded. No backend, no AI, no rules engine.
// Dice values are fixed fake data so the layout can be judged on the phone.

const TURNS = [
  {
    location: "The Rusted Ford",
    hp: 18,
    narration: [
      "Rain hammers the old toll house as you shoulder through the door. Inside, a handful of drovers hunch over cold stew, and nobody looks up. The bridge outside is gone; only blackened stumps remain in the river.",
      "A woman by the hearth is sewing a seal onto a leather satchel. She notices your mud-caked boots and finally meets your eye.",
    ],
    options: [
      "Ask the woman about the bridge",
      "Search the toll house for a way across",
      "Offer to buy a round for the drovers",
      "Step back outside and study the river",
    ],
  },
  {
    location: "The Rusted Ford",
    hp: 18,
    dice: { die: 14, label: "Wits", mod: 2, dc: 12, success: true },
    narration: [
      "The woman gives her name as Maren and sets the satchel aside. \"Burned three nights ago,\" she says. \"Whoever did it wanted the road closed, not the river crossed.\"",
      "She slides a scrap of oilcloth across the table. A ferryman's mark is scratched into it, along with the words “Gull's Landing”.",
    ],
    options: [
      "Ask what is in the satchel",
      "Ask where Gull's Landing is",
      "Keep the oilcloth and say nothing",
      "Ask who benefits from a closed road",
    ],
  },
  {
    location: "The Rusted Ford",
    hp: 15,
    dice: { die: 4, label: "Grit", mod: 1, dc: 13, success: false },
    narration: [
      "You reach for the satchel and the nearest drover catches your wrist. A short scuffle follows; you come away with a split lip and a bruised pride, but the satchel stays where it was.",
      "Maren watches without moving. \"Now you know how the road feels,\" she says.",
    ],
    options: [
      "Apologize and ask for a moment of her time",
      "Leave for Gull's Landing",
      "Rest by the fire and watch the room",
      "Ask the drover what he is guarding",
    ],
  },
];

const JS_BUILD = "1.5"; // stamped by stamp.py
const HP_MAX = 20;
const GENERIC = ["Look", "Talk", "Travel", "Rest"];
const MORE = ["Inventory", "Wildcard", "Custom action"];

const $ = (id) => document.getElementById(id);
const story = $("story");
let turnIndex = 0;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function scrollDown() {
  story.scrollTo({ top: story.scrollHeight, behavior: "smooth" });
}

function addNote(text) {
  story.append(el("p", "note", text));
  scrollDown();
}

function renderDice(d) {
  const box = el("div", "dice");
  const die = el("div", "die rolling", "…");
  const math = el("div", "math");
  const total = d.die + d.mod;
  const result = el("div", "result " + (d.success ? "success" : "fail"), d.success ? "Success" : "Failure");
  math.innerHTML = `d20 <b>${d.die}</b> + ${d.label} <b>${d.mod >= 0 ? "+" : ""}${d.mod}</b> = <b>${total}</b> vs DC <b>${d.dc}</b><br>`;
  math.append(result);
  box.append(die, math);
  setTimeout(() => { die.textContent = d.die; die.classList.remove("rolling"); }, 500);
  return box;
}

function renderTurn(index, chosenText) {
  const turn = TURNS[index];
  $("location").textContent = turn.location;
  $("hp").textContent = `HP ${turn.hp}/${HP_MAX}`;
  $("hpfill").style.width = (turn.hp / HP_MAX) * 100 + "%";
  const pct = turn.hp / HP_MAX;
  $("hpbar").classList.toggle("mid", pct <= 0.5 && pct >= 0.25);
  $("hpbar").classList.toggle("low", pct < 0.25);
  $("hpbar").setAttribute("aria-valuenow", turn.hp);
  $("hpbar").setAttribute("aria-valuemax", HP_MAX);
  $("turn").textContent = "Turn " + (index + 1);

  if (chosenText) story.append(el("p", "chosen", chosenText));
  if (turn.dice) story.append(renderDice(turn.dice));
  for (const para of turn.narration) story.append(el("p", "", para));

  const options = $("options");
  options.replaceChildren();
  for (const text of turn.options) {
    const btn = el("button", "", text);
    btn.type = "button";
    btn.addEventListener("click", () => choose(text));
    options.append(btn);
  }
  scrollDown();
}

function choose(text) {
  // Fake loop: cycle through the hardcoded turns.
  turnIndex = (turnIndex + 1) % TURNS.length;
  if (turnIndex === 0) addNote("(Fake story ended, looping back to turn 1.)");
  renderTurn(turnIndex, "▸ " + text);
}

const custom = $("custom");
const customText = $("customText");
const generic = $("generic");
const sheet = $("sheet");
const backdrop = $("backdrop");

// The custom input takes the generic row's slot; the options above stay visible and untouched.
function openCustom() {
  generic.hidden = true;
  custom.hidden = false;
  customText.focus();
}
function closeCustom() {
  custom.hidden = true;
  generic.hidden = false;
  customText.value = "";
  customText.blur();
}

function setSheet(open) {
  sheet.hidden = backdrop.hidden = !open;
  sheet.style.transform = "";
  if (open) showBuildInfo();
}

// Build stamp + live layout numbers, so the Home Screen app can be compared with Safari.
const metaBuild = (document.querySelector('meta[name="build"]')?.content || "?|").split("|");
const HTML_BUILD = metaBuild[0];
const CSS_BUILD = getComputedStyle(document.documentElement).getPropertyValue("--build").replace(/["'\s]/g, "");

// html, css and js are stamped together. If a cached file is from another build, reload once past the cache.
if (new Set([HTML_BUILD, CSS_BUILD, JS_BUILD]).size > 1 && !location.search.includes("fresh=")) {
  location.replace(location.pathname + "?fresh=" + Date.now());
}

// What sits on top of a node, ignoring the More sheet itself (it is open while we measure).
function topEl(node) {
  const r = node.getBoundingClientRect();
  sheet.style.pointerEvents = backdrop.style.pointerEvents = "none";
  const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  sheet.style.pointerEvents = backdrop.style.pointerEvents = "";
  return e ? e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") : "none";
}

function showBuildInfo() {
  const when = new Date(metaBuild[1]);
  const time = isNaN(when) ? "?" : when.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const same = new Set([HTML_BUILD, CSS_BUILD, JS_BUILD]).size === 1;
  $("buildStamp").textContent = `build ${HTML_BUILD} · ${time}` + (same ? "" : `  (MISMATCH html ${HTML_BUILD} css ${CSS_BUILD} js ${JS_BUILD})`);

  const probe = el("div");
  probe.style.cssText = "position:fixed;visibility:hidden;top:0;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)";
  document.body.append(probe);
  const insetSum = probe.getBoundingClientRect().height;
  probe.remove();
  const cs = getComputedStyle($("hp"));
  const vv = window.visualViewport;
  const lastBtn = generic.hidden ? null : generic.querySelector("button");
  const lines = [
    `mode ${navigator.standalone || matchMedia("(display-mode: standalone)").matches ? "standalone" : "browser"}`,
    `inner ${innerWidth}x${innerHeight}  visual ${vv ? Math.round(vv.width) + "x" + Math.round(vv.height) : "n/a"}  screen ${screen.width}x${screen.height}`,
    `insets top+bottom ${insetSum}  app.kb ${$("app").classList.contains("kb")}`,
    `app bottom ${Math.round($("app").getBoundingClientRect().bottom)}  gap below buttons ${lastBtn ? Math.round(innerHeight - lastBtn.getBoundingClientRect().bottom) : "n/a"}`,
    `header title y ${Math.round($("location").getBoundingClientRect().top)}  on top: ${topEl($("location"))} / ${topEl($("hp"))}`,
    `title opacity ${getComputedStyle($("location")).opacity} color ${getComputedStyle($("location")).color}  hp color ${cs.color}`,
  ];
  $("diag").textContent = lines.join("\n");
}

function useGeneric(label) {
  if (label === "Custom action") { openCustom(); return; }
  addNote(`[${label}] is not wired up in Phase 1.`);
}

function buildGeneric() {
  for (const label of GENERIC) {
    const btn = el("button", "", label);
    btn.type = "button";
    btn.addEventListener("click", () => useGeneric(label));
    generic.append(btn);
  }
  const more = el("button", "", "More");
  more.type = "button";
  more.addEventListener("click", () => setSheet(true));
  generic.append(more);

  for (const label of MORE) {
    const btn = el("button", "", label);
    btn.type = "button";
    btn.addEventListener("click", () => { setSheet(false); useGeneric(label); });
    $("sheetBody").append(btn);
  }
  backdrop.addEventListener("click", () => setSheet(false));
  $("sheetClose").addEventListener("click", () => setSheet(false));

  // Drag the handle area down to dismiss.
  const head = $("sheetHead");
  let startY = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    startY = e.clientY;
    head.setPointerCapture(e.pointerId);
    sheet.classList.add("dragging");
  });
  head.addEventListener("pointermove", (e) => {
    if (startY === null) return;
    sheet.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`;
  });
  const endDrag = (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    sheet.classList.remove("dragging");
    if (dy > 70) setSheet(false); else sheet.style.transform = "";
  };
  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", endDrag);
}

custom.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = customText.value.trim();
  closeCustom();
  if (text) choose(text);
});
$("customCancel").addEventListener("click", closeCustom);

// iOS keeps the layout viewport full height when the keyboard opens, so size the app to the visible area.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => {
    // Only shrink for the keyboard while the input is focused; a stray viewport difference must never shorten the layout.
    const keyboard = document.activeElement === customText && window.innerHeight - vv.height > 80;
    const app = document.getElementById("app");
    app.classList.toggle("kb", keyboard);
    app.style.setProperty("--app-h", keyboard ? vv.height + "px" : "");
    if (keyboard) window.scrollTo(0, 0);
  };
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
  customText.addEventListener("blur", fit);
}

buildGeneric();
renderTurn(0);
