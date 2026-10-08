// Phase 1 skeleton: everything here is hardcoded. No backend, no AI, no rules engine.
// Dice values are fixed fake data so the layout can be judged on the phone.

const TURNS = [
  {
    location: "The Rusted Ford",
    hp: "HP 18/20",
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
    hp: "HP 18/20",
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
    hp: "HP 15/20",
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

const GENERIC = ["Look around", "Talk to someone", "Travel", "Rest", "Inventory", "Wildcard", "Custom action"];

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
  $("hp").textContent = turn.hp;
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

function closeCustom() { custom.hidden = true; customText.value = ""; }

function buildGeneric() {
  const box = $("generic");
  for (const label of GENERIC) {
    const btn = el("button", "", label);
    btn.type = "button";
    btn.addEventListener("click", () => {
      if (label === "Custom action") { custom.hidden = false; customText.focus(); return; }
      addNote(`[${label}] is not wired up in Phase 1.`);
    });
    box.append(btn);
  }
}

custom.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = customText.value.trim();
  closeCustom();
  if (text) choose(text);
});
$("customCancel").addEventListener("click", closeCustom);

buildGeneric();
renderTurn(0);
