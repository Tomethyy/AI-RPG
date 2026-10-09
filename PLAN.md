# Solo RPG App: Dev Plan

A lightweight, AI-driven solo pen-and-paper RPG for my iPhone. The AI proposes options, I pick, code resolves the rules, the AI narrates.

Background research on existing products and the evidence behind these decisions is in `RESEARCH.md`. Do not read it unless a question needs it.

## Status

- **Done:** Phases 1-4 (skeleton, backend and schema, rules engine, retrieval and prompt assembly), verified on the phone. Phase 5 (Character) is built, tested (39 tests, including a 30-turn end-to-end run against the mock) and deployed; it waits for the phone checklist to be ticked.
- **Next:** Phase 6 Combat (Sonnet, High), after the Phase 5 phone checklist and the next playtest notes.
- **Cost baseline (after Phase 4, measured on the phone):** about 4.4k input tokens a turn (half from cache), about 680 output tokens, about $0.012 a turn.
- **Cost after Phase 5 (measured on the phone, turn 11):** input 2,698 + cache read 3,572 + cache write 705 (about 7.0k in all; the Prompt view's estimate was 4.4k, a real/estimated ratio of 1.57), 555 output, $0.0134 a turn (the estimate before building was about $0.013). Flat as the campaign grows. A turn after a pause of over 5 minutes re-writes the cache.
- **Free-plan limits (30-turn end-to-end run):** save 19 KB (the verbatim window and the fact cap bound it; expect 60-120 KB at 250 turns); 3.6 KV writes a turn (about 275 turns a day against the 1,000-write limit); pure compute about 1 ms a turn against 10 ms CPU.
- **Known issues (playtest notes after Phase 5, build 1.35), status after the Phase 5 patch (build 1.37, schema v5):**
  - **No intro:** fixed for now. New game makes one AI call (about $0.015, once per game) that writes who the character is and why they are at the Rusted Ford, from their background, drive and flaw; if it cannot run, the fixed scene stays. The full fix is region generation (Phase 7) and the New game flow (Phase 8).
  - **Options do not matter:** deferred to Phase 7 by decision. Requirement for Phase 7: each option gets a hidden value (advances, sidetrack, costly); code only gives quest flags, lead reveals and bonus XP to options that advance; a sidetrack is narrated as a dead end that costs time (a threat clock tick) or an insight; the finale cannot be reached by tapping one button. Until then the story can still carry you.
  - **Ledger recorded events:** fixed in code. Every new fact needs a kind (identity, want, relationship, secret, status, place; there is no event kind, so events are refused), an entity gets at most two facts a turn, a status replaces the previous status, and "Reeve" and "Tam Reeve" merge into one person. Judge on the phone: Known facts should hold only lasting truths, and fact merges should stay rare.
  - **Look and Talk replaced the options:** both buttons are gone (the bottom row is Talents, Travel, Rest, Custom, More). Look returns in Phase 8 as a Wits roll for a place's secret that does not replace the options. A new narrator rule: always include the natural continuation of the last beat (going along with someone who leads you).
  - **Active talents:** the Talents button in the bottom row lists them with Use (the Character screen only shows them); every option now shows its kind and stat as a small tag ("Social · Charm"); an armed advantage talent shows as "Talents ⚡". Grim Resolve (hard to see) became Stubborn (+1 on Grit checks). Talent offers include one from your best stat.
  - **Plot sprawl and forced dialogue:** narrator rules added (at most one new named person or thread a turn, state why people arrive or leave, NPCs rarely volunteer plot). Prompt rules only; the real fix is the milestone graph with its leads (Phase 7). Judge on the phone.
  - **Stakes:** tiers used so far were mostly standard and easy; watch the Checks line in More → Prompt for hard and daunting.
- **Known issues (playtest notes after Phase 4), status after Phase 5:**
  - **Too many failures:** fixed. The AI names a tier (easy 7, standard 10, hard 13, daunting 16, plus the place's danger 0-2); level is never used; a miss by 1-2 is "success at a cost". An average check is about 70% success (about 80% counting success at a cost); untrained about 55%. Level 1 and level 10 face the same numbers, so levelling really helps. The Prompt view shows the tier and result counts.
  - **Ledger clutter:** fixed in the rules (only lasting truths), a cap of 8 facts per entity, and a Haiku pass that merges an entity's facts to at most 5 (a hard stop at 12). Judge on the phone: Known facts should stay well under budget.
  - **Slow pacing:** a narrator rule now says to resolve minor beats in one turn. Turns per milestone are still measured in Phase 9 (the milestones themselves arrive in Phase 7).
  - **Fallbacks:** 3 in the first 6 turns, none in the next 5; probably the deploy restart. Still watch More → Prompt for the last 5.
  - **Prompt view estimate:** now counts the JSON schema and shows the estimate scaled by the last turn's real/estimated ratio.
  - **XP notes:** one note a turn.
  - **New games start from the Rusted Ford template:** the character is now made in New game and the world core gives the lore, but the opening scene is still the template. Fixed by region generation (Phase 7) and the New game flow (Phase 8).

**Working rules for Claude Code:**
- Build one phase at a time, starting with Phase 1. Ask me about any open question that blocks the current phase. Do not build ahead.
- At the end of each phase: stop, give me a 3-line summary of what works, commit, and tell me which model and effort level to use for the NEXT phase (see "Model and effort per phase"). You cannot switch the model yourself, so remind me to do it. Do not start the next phase until I say go.
- If a phase turns out harder than its recommendation, tell me and suggest moving up one level instead of grinding at the current one.
- **Scope freeze:** no new v1 features until Phase 9 is done. New ideas go to Later. Exceptions: bugs, and things a phase proves necessary (say so and ask).
- **Main always playable:** `main` deploys straight to the phone, so push only when all tests pass (unit tests and the automated end-to-end run against `worker/test/mock-anthropic.mjs`). Run `python3 stamp.py` before every commit that changes the app or the Worker.
- **Save safety:** every save-format upgrade keeps a copy of the old save on the server before migrating, and has a test that migrates an old save.
- **Definition of done** for a phase:
  - unit tests and the end-to-end run pass
  - a short **phone test checklist** (what to tap, what you should see) is handed to me, and I have ticked it off
  - a **cost report** compares tokens per turn (input, cached, output) and cost with the baseline in Status, and explains any increase; it also checks the save size and the Worker's CPU time per request against the Cloudflare free-plan limits (10 ms CPU per request, 1,000 KV writes a day; we use about 3 writes a turn)
  - README and this plan (including Status) are updated
- **Playtest notes:** after each phase I play about 20 turns and name 3 things that feel off; they go into Known issues and are weighed at the start of the next phase.

## Why this exists

- Old Greg's Tavern and similar apps give too much freedom. I'm not very creative and have no group, so I need the game to hand me concrete next steps.
- Each turn the AI offers situation-specific options. A fixed set of generic options is always available.
- Existing apps were awkward on mobile (Old Greg's was a browser site not made for phones).

## My concerns (design constraints)

1. **AI context / consistency over long play.** The AI must stay consistent over a whole campaign.
2. **Cost.** More context means more money. Per-turn cost must stay roughly flat no matter how long the campaign runs.
3. **Context gets cleared / is limited.** The AI must never be the memory. The app's own storage is the memory.
4. **iOS, personal use only.** No App Store. Phone-first web app (PWA, Add to Home Screen).
5. **Combat must be cheap.** Round-by-round feels good but must not cost an AI call per round.

## Decisions

| Topic | Decision |
|---|---|
| Setting | v1 has one fixed world, the Realm of Calder (`worker/src/world.js`): normal fantasy in the spirit of The Witcher and Dragon Age. Humans dominate, elves and dwarves exist as tolerated minorities (the player is human); magic is real and powerful but uncommon, costly and distrusted (licensed mages of the Conclave, hunted hedge-mages); monsters are common in the wild; the Lantern Church, the Crown, the Concord guilds and the Karsk clans are the powers. Choosing other settings (cyberpunk, pirates, ...) is v2 |
| Content tables | Numbers are hand-written (`worker/src/content.js`); the AI never sets a number. Decided for talents in Phase 5: 12 hand-written talents, with an optional AI re-skin of the flavor text later (Phase 8, when New game exists). Enemies and consumables (Phase 6) and prices (Phase 8) are decided in their phases |
| Map bounds | The generated region is the map: its places plus a few the AI may add inside it (capped). Far places from the world core are known by name but lie beyond this story |
| Side quests | Seeded and earned: region generation seeds 2-3 side quests tied to its factions and NPCs (with leads); in play the AI may propose new ones from what happens, at most one new open side quest at a time and a total cap |
| World and lore | Two layers. A hand-written **world core**, fixed for v1 and cached in the prompt (~500 tokens, near zero cost per turn): the realm and its regions, a short history, how magic works and why it is distrusted, the main religion, 3-4 major powers, which monsters exist. Plus a **region generated once per New game** inside that world: starting area, 6-8 places, 3-4 local factions with goals, key NPCs, the central conflict, with the milestone graph and threat clock built on it, stored in the ledger. Every run gets new names and a new story in the same world |
| Length | Main quest with an ending, tracked as a milestone graph. Finishing it ends the game. Side quests along the way. One game is about 150-250 turns (a few weeks of short sessions), 8-10 milestones, reaching about level 6-8 by the finale |
| Combat | Abstract, round-based, resolved entirely by code. AI writes one in-universe summary at the end. |
| Death | Permanent, but 0 HP opens a defeat branch first (captured, left for dead or rescued, each with a real cost). Death when no branch fits or after a second fall soon after |
| Option quality | Neutral: do not hint at risk or reward in option text |
| Platform | Mobile-first PWA with a tiny backend that holds the API key and the save data |
| Items | Text only, no pictures |
| Map | Text-based location list with connections, no drawn map in v1 |
| Stats | Four: Might (force, melee), Wits (notice, know, sneak, ranged), Charm (talk, deceive, lead), Grit (endure, nerve; sets HP and pack slots). A background gives a +3/+2/+1/0 spread, plus 2 free points at creation (no stat above +4 then). HP = 16 + 2 x Grit + 3 per level above 1 |
| Progression | XP (total to reach level 2-10: 40, 100, 190, 310, 460, 640, 860, 1120, 1420; the cap is 10 and XP stops there). Even levels give +1 to a stat you choose; odd levels from 3 give a talent (1 of 3 offered, seeded per game). Roll XP 2 (1 for a failure), the AI may add 1-3 for a notable moment, milestones 25 and side quests 10 (paid by the Phase 7 quest code). Difficulty does not scale with level |
| Check results | Three results: success (total at least the difficulty), success at a cost (missed by 1-2), failure; a natural 20 always succeeds and a natural 1 always fails. Code decides the band, the AI narrates it |
| Pressure | Threat clock on the main quest with visible warning signs, plus a code-owned day and time of day |
| Narrator | Never decides or speaks for the character beyond the chosen action; NPCs have their own wants and can refuse or lie; earlier deeds get called back |
| Ending | Branching finale: one path until late, then a telegraphed key decision splits into 2-3 finales. The epilogue is built from your choices |
| Morality | Two independent hidden axes (Law-Chaos, Good-Evil), shown as a label like "Chaotic Good". Deeds shift it; the world reacts to it; nothing gets locked |
| Economy | Coins buy and sell at merchants; prices come from a code table, the AI only names wares |
| Inventory | Item slots: 10 + Grit (+2 with Pack Mule) for the pack; worn gear is free, big items (heavy armor, polearms) take 2, coins are free, small items stack 10 to a slot. A full pack leaves new loot behind, with a note |
| Difficulty | Story / Normal / Hard, chosen at New game |
| Fair death | Every fight offers flee or surrender, enemies have morale, danger is shown before a fight, location danger is visible |
| Scope | v1 is frozen (see below). Everything else goes in Later. |
| Backend | Cloudflare Worker + KV, deployed from GitHub (Workers Builds). Shared game key, $1/day spend cap (DAILY_CAP_USD) |
| Runtime models | Turns: Sonnet 5.5 at low effort. Summaries: Haiku 5.5. Both are config values |
| Language | English (stored per save, so German stays possible) |

## v1 scope (frozen)

Everything below ships in v1, each item in its phase. If a phase runs long, it is split into parts (e.g. 6a and 6b); items are not postponed past their phase.

Done (Phases 1-5): story loop and options, rules engine (dice, HP, XP, gear, loot, visible dice), memory (state, rolling summary, lore ledger, prompt budget and caching), backend (protected proxy, spend cap, JSON validation with retry, server-side saves), and the Character phase: world core, character creation, 4 stats, difficulty tiers and three-result checks, advantage/disadvantage, 12 talents, level-up picks, alignment axes, item slots, no retry without change, narrator rules, the Character screen.

| Item | Phase |
|---|---|
| Two-axis morality: reactions of NPCs and the world (the axes, label and shifts are done) | 7 |
| Code combat with enemy tables, item effects, one AI summary | 6 |
| Fair death: flee/surrender, morale, danger shown first, enemy intent shown, defeat branch, permanent death | 6 |
| Enemy roles and status effects | 6 |
| Unique items with properties or drawbacks | 6 |
| Region generated per game (places, factions, NPCs, conflict, personal stake, seeded side quests) with the milestone graph | 7 |
| Content tables (enemy templates, consumables, prices, item properties and drawbacks; talents are done); how they are made is decided in the phase that first needs each | 6-8 |
| Milestone graph with 3 leads per milestone, quest flags, quest focus, side quests | 7 |
| Options that matter: a hidden value per option (advances, sidetrack, costly) that code checks before any quest progress, lead or bonus XP counts; sidetracks are dead ends that cost time or an insight | 7 |
| Threat clock with warning signs, code-owned day and time of day | 7 |
| Custom action classification and consequence-based responses | 7 |
| NPC attitude and first-meeting reactions | 7 |
| Epilogue built from choices (also on death), game-complete state | 7 |
| Branching finale | 7 |
| NPC profiles (want, fear, secret, voice) | 7 |
| Text map and Travel, rest with random events, generic buttons, journal, Codex | 8 |
| New game flow, export/import | 8 |
| Merchants and shops, difficulty setting, "never include" field | 8 |
| Recap on return, streaming narration, rest refreshing talents (they use a 10-turn cooldown until then), AI re-skin of talent flavor | 8 |
| Location secrets, hall of fallen heroes, text size setting and first-time tips | 8 |

If the loop is not fun at this size, extras will not fix it. (Most rows came from the RPG practice reviews after Phase 4, gaps Q-AV in `RESEARCH.md`.)

## Core loop

1. Show scene narration.
2. Show 3-4 AI-generated situation-specific options plus fixed generic buttons.
3. Player taps one.
4. Code rolls dice and applies rules.
5. AI narrates the outcome and returns the next options, state changes, newly established facts and quest flags.

## Screens (phone-first, thumb-reachable)

- **Story:** narration on top, option buttons pinned at the bottom. Dice results shown for every check (roll, modifier, difficulty, result).
- **Character (done in Phase 5, More → Character):** name, background, level, alignment label, HP and XP bar, the four stats, drive and flaw, talents with Use buttons, equipment, pack slots with Drop buttons, conditions, and the waiting level-up choice. Character creation (More → Server → New game) uses the same panel area.
- **Journal:** main quest progress, side quests, focused quest, past scene history.
- **New game:** "never include" list, difficulty, character creation (the world is fixed in v1).
- **Hall of fallen heroes:** past characters with level, turns survived, cause of death (or ending) and their epilogue. No AI cost.
- **Settings:** text size; one-time tips the first time dice, combat or a shop appear.
- **Recap:** "previously on" from the stored summary when the app opens after a break (no AI call).

## Generic buttons (hardcoded, no AI cost)

Bottom row: Talents (ready active talents with Use), Travel, Rest, Custom action (free text escape hatch), More. In More: Character, Ledger, Prompt, Wildcard (random event table). Look returns in Phase 8 as a Wits roll for a place's secret that does not replace the options; Talk is gone because the options and Custom action cover it.

## World core and generated region

- **World core (done in Phase 5, `worker/src/world.js`):** written once (Claude drafted, I approved), stored in the code as static text in the cached prompt prefix. The AI must never contradict it; it is the frame for everything the AI invents. It also anchors the v2 mythic paths (angels need a heaven, liches need death magic).
- **Region generation (Phase 7, called by New game in Phase 8):** one larger AI call at game start returns structured data, validated by code like a turn: places with connections (code rolls their danger), local factions with goals, 4-6 key NPCs with profiles, the central conflict, and the milestone graph with leads, branching finale and threat clock. Everything goes into the ledger before turn 1, so retrieval finds it from the start. Cost about $0.05-0.10 once per game.
- **Personal stake:** character creation picks a background and a drive; region generation must give the character a personal stake in the central conflict (a debt, a missing sibling, a stolen inheritance), and the opening scene starts from it.
- **Region bounds:** the region is the map. The AI may add a few places inside it (capped, e.g. 4 more); far places from the world core are named but out of reach in this story.
- **Side quests:** region generation seeds 2-3 side quests with leads, tied to local factions and NPCs. During play the AI may propose a new one from events; code accepts at most one new open side quest at a time, with a cap on the total.
- **Readable content:** how enemies, items and wares get their names and numbers depends on the content-table decision (open, see Decisions).
- The opening scene is generated from the region and the character, replacing the fixed Rusted Ford start.

## Main quest as a milestone graph

The AI cannot be trusted to steer toward an ending on its own, so the ending is structure owned by the app.

- At game start, the AI generates once a **milestone graph**: 8-10 milestones (6-12 allowed), each with yes/no completion conditions, ending in a defined finale. Stored as data, not prose.
- Each milestone has a status: undiscovered, ongoing, completed.
- Each milestone gets at least **3 leads** (Three Clue Rule): clues that point to a place, person or item where progress can be made. Code tracks which leads are revealed; unrevealed ones go into the prompt so the AI always has a way forward to offer.
- **Threat clock:** the main quest has a clock of 6-8 segments with an impending doom and warning signs (portents), generated with the graph. Code ticks it on failures, rests, travel and time passing; each tick puts its warning sign into the story; a full clock makes the doom happen (a hard setback, not automatic game over). Completing milestones can push it back.
- Each turn the prompt includes only the current milestone and a hint at the next one.
- The AI reports quest flags in its output; code checks the conditions and advances the graph.
- **Branching finale:** the graph is one path until late in the game, then a key decision (telegraphed as a real fork, e.g. side with the Wardens, expose Hale, or make a deal) splits it into 2-3 branches, each with its own last 1-2 milestones and finale. All branches are generated once at game start; only one is played.
- Finishing the final milestone ends the game with an **epilogue built from your choices**: the fate of the NPCs and places you touched (from the ledger, quest flags and NPC attitude) and who you became (alignment), Fallout-style. A death epilogue uses the same builder.
- Side quests are surfaced deliberately (they are often missed otherwise): when the scene touches a side quest's location or NPC, at least one option may reference it.

## Quest focus (how the player steers an AI-driven game)

- Each quest has a status (active, completed, failed).
- The player pins one quest as the **focused quest**. The main quest is the default focus.
- The focused quest is always included in the prompt, and the AI must offer at least one option that advances it every turn.
- The player can change focus any time from the Journal.

## Custom actions and off-path input

The Custom action button invites the AI to say yes to everything. Handle it explicitly.

- In the same AI call, classify the action: **allowed**, **conditionally allowed** (harder roll), or **blocked** (conflicts with world facts, skips the story, or is implausible).
- Never answer a blocked action with a bare "you can't do that".
- Preferred responses, in order: in-world consequences (the action happens, with logical fallout, or a short "what would happen" glimpse), an NPC or environment reaction, extra information that shows why it won't work.
- Scale the drama to the gravity of the action.

## Rules (code owns every number)

- 4 stats (Might, Wits, Charm, Grit), d20 + stat (+1 for matching gear, plus talent bonuses, -1 while Wounded) vs. a difficulty, HP, XP and levels, equipment with stats (damage, multiplier, defense). Numbers are in `worker/src/rules.js` and `content.js`; combat (Phase 6) gets its own use for each stat on top of these.
- **Three results** per check (done): success (total >= difficulty), success at a cost (missed by 1-2: you get it, but something is lost, damaged or complicated), failure (the story still moves forward). Natural 20 always succeeds well, natural 1 always fails badly. Code picks the result; the AI must narrate exactly that result.
- **Time:** code owns the day number and time of day (morning, afternoon, evening, night). Travel, rest and some actions advance it; the prompt shows it every turn, so the AI does not invent dates.
- **Morality (alignment):** two hidden numbers, Law-Chaos and Good-Evil, each moving on its own (a grid, not a wheel, so a lawful deed never drags you toward good). The starting alignment is chosen at character creation. Only choices with real moral weight move it: the AI proposes a shift with a reason, code allows a small step per turn and decides the label (e.g. Lawful Neutral) from thresholds. Option text never shows the moral direction. The Character screen shows the label, and a short in-world note appears only when the label changes ("Word of your mercy spreads"); numbers stay hidden so it cannot be played as a score. Effects: NPC first reactions and attitude, the tone of the narration, and options that fit who the character is. Nothing is locked by alignment. Done in Phase 5: two numbers per axis (-12..12) set by two creation questions (lawful/neutral/chaotic, good/neutral/evil start at +-4), the AI proposes `law` or `good` +-1 in state_changes, code allows one step per axis per turn, a side is shown from +-3 (labels like "Lawful Neutral", "True Neutral"), and a short in-world note appears when a side changes. The reactions (NPCs, world) come in Phase 7.
- **Item slots (done):** the pack holds 10 + Grit slots (+2 with Pack Mule). Worn gear is free; big items (heavy armor, polearms) take 2; coins take none; small items stack 10 to a slot. When the pack is full, new loot is left behind with a note and the player drops something on the Character screen. (Blocking travel until the pack fits comes with Travel in Phase 8.)
- **Economy:** coins buy and sell at merchants (NPCs or locations flagged as shops). Prices come from a code table by item kind and rarity, adjusted by NPC attitude; selling pays a fraction. The AI names wares and haggles in the story, but never sets a number.
- **Difficulty:** Story / Normal / Hard at New game. It shifts the difficulty band, enemy strength and how forgiving the defeat branch is. Stored per save.
- **NPC attitude:** each NPC has an attitude from -2 (hostile) to +2 (friendly). The AI proposes changes, code allows at most 1 step per turn, and attitude shifts the difficulty of social checks. A first meeting gets a code-rolled reaction the AI must honor.
- Code owns all rules and dice. The AI never rolls or changes numbers directly. It proposes, code validates and applies.
- **Difficulty (done)** comes from the obstacle's tier and the location's danger, **never from the player's level**, so levelling up really makes you better. The AI names a tier (easy 7, standard 10, hard 13, daunting 16) and code adds the danger (0-2); the AI cannot set a number. The tier and result distribution are counted and shown in More → Prompt so drift is visible.
- **Advantage / disadvantage (done):** help, the right tool or a friendly NPC lets a check roll two dice and keep the better; bad conditions keep the worse. The AI may flag at most one option a turn with a reason; a talent can also grant advantage on the next check; advantage and disadvantage cancel. Both dice are seeded per turn, so this is never a reroll.
- **Talents (done):** 12 hand-written talents, three per stat (`content.js`): passive (+1 on checks of one kind, +2 pack slots, +4 max HP, +1 on Grit checks) and active (heal a third or a quarter of max HP, clear conditions, advantage on the next check) with a 10-turn cooldown (Rest refreshes them from Phase 8). One is picked at creation from the background's three; the rest at odd levels from 3. Phase 6 maps each effect type to a combat effect.
- **No retry without change (done):** a failed approach cannot simply be repeated; something must change first (new information, a tool, help, a different stat). Code tracks recently failed options (listed in the prompt, filtered out of new options while 3 remain) until the player moves, gains an item, or 8 turns pass.
- **Narrator rules (prompt, done):** never decide, feel or speak for the character beyond the chosen action; NPCs want things, can refuse, lie and act on their own; no "What do you do?" endings or purple prose; call back to the player's earlier deeds so consequences are visible.
- **NPC profiles:** each named NPC gets a want, a fear, a secret and a voice or quirk, stored in the ledger and shown when the NPC is relevant, so they act consistently and sound different. The secret is revealed only through play.
- Loot comes from code tables. The AI only names and describes items. Rare **unique items** have a code-defined property and sometimes a drawback (a blade that cannot be put down, armor that slows travel) instead of only bigger numbers.
- Option text stays neutral. Each option carries a suggested stat, a difficulty tier and an optional edge (with a reason) internally, but the player sees no risk or reward hints; the dice box shows the roll, difficulty, advantage and result afterwards.
- Every check shows its roll, modifier, difficulty and result.

## Combat (inspired by "Just Loot")

- Resolved fully in code, no AI calls during the fight.
- Each round: player damage numbers and multipliers resolve, damage is applied, then enemies attack, then next round.
- Player choices during combat are minimal and mechanical (which ability or item to use), not narrated.
- Uses equipment stats, XP and loot from the rules engine.
- **Enemies come from code tables** by tier and location danger (HP, damage, defense, morale). The AI only names and describes them, as with loot. Tables have **roles** (brute, skirmisher, caster, leader) with different moves, plus a few status effects with a chance to land, so fights differ.
- **Enemy intent is shown** each round ("The brute winds up a heavy swing"), so the player's choice is informed (Slay the Spire style).
- **Items do something:** a code table of consumable effects (heal, bonus, escape) for "use an item" in combat and outside it.
- **Fair death:** a fight never starts without warning unless the player attacked; the scene shows the threat first. Every round offers flee or surrender (flee is a check with a cost; surrender leads to capture or a price, not death). Enemies check morale when they lose a member or half their strength and may flee or surrender. Location danger is shown (header and Travel list); option text stays neutral.
- When combat ends, ONE AI call receives the structured combat log and writes an in-universe combat summary.
- **Defeat branch at 0 HP:** you are down, not dead. Code picks what follows from the situation: captured (by enemies who take prisoners), left for dead, or rescued (by an NPC with a good attitude), each with a real cost such as lost gear, lost time, a threat clock tick or a lasting injury. The AI narrates the branch code picked.
- Death is permanent. It happens when no branch fits (alone in the wilds, against enemies who take no prisoners) or when HP hits 0 again soon after a defeat. The run then ends with a short AI-written epilogue.

## Map and travel (text-based)

- Known locations live in the ledger, each with connections and travel info.
- **Location secrets:** each place gets a hidden feature that code knows about (a cache, a passage, a clue). A good Look around can find it, which rewards exploring.
- A **Travel** button lists reachable locations with their danger level. Travel advances time. Choosing one costs no AI call until arrival, when the AI narrates the new scene.
- The AI may add locations via new_facts; code adds them to the known map when the player learns of them.

## Rest and camp

- Rest restores some HP, advances time and the threat clock, with a chance of a random event from the wildcard table.
- A full camp scene is a Later item.

## Memory architecture (the key part)

The AI has no memory. The app stores everything and rebuilds a compact prompt every turn.

**Stored by the app:**
- Character state (exact numbers, from code)
- Inventory and equipment
- Rolling story summary (a few hundred words)
- **Lore ledger:** entity records (NPCs, locations, factions, items, quests) with facts established so far, e.g. "Orrin, blacksmith, owes the party a favor" or "the bridge is destroyed"
- Milestone graph and side quest state
- Last ~5 turns verbatim and the last few option sets

**Prompt assembled per turn (with a token budget per section, built in Phase 4 in `worker/src/prompt.js`):**
1. Fixed rules, narrator rules, setting, tone and "never include" list (static, cached)
2. Rolling summary, current milestone with its unrevealed leads, next-milestone hint, focused quest, threat clock state (changes every few turns, cached)
3. Character sheet, equipment, inventory, talents, alignment label, day and time of day
4. Only the relevant ledger entities for the current scene, with NPC attitude and profile (match by name, alias or location)
5. Turns since the summary: the newest ~5 verbatim, older ones in brief, plus recent options to avoid repeating and recently failed approaches
6. The player's chosen action and the dice result (band: success, at a cost, failure)

Every phase that adds a section must fit it into the budget (rebalancing the others) and keep the Phase 4 test that a 500-turn campaign prompt stays flat passing.

**AI output per turn (JSON, validated before applying):**
- narration
- options (each with suggested stat, difficulty tier and optional edge; must vary in kind, e.g. at least one social, one exploratory, one direct, without hinting at risk)
- action classification (for custom actions)
- state_changes (proposed, validated by code; alignment shifts are in since Phase 5, NPC attitude changes and time passing come later)
- new_facts (every named thing the AI invented this turn, with `was` for renamed entities)
- quest_flags and revealed leads

**Cost behavior:** a turn stays around 3-5k input tokens regardless of campaign length (measured after Phase 4: about 4.4k, half of it read from cache, about $0.012 a turn). The static prefix is cached. Turn 500 should cost about the same as turn 50.

**Known weak spots to tune:**
- Summaries lose detail over time, so the ledger matters more than the summary.
- The AI can contradict stored facts (a cheap consistency check is in Later).
- The AI may forget to report a fact it invented. Prompt it hard to list all new named things.
- Retrieval can miss a relevant entity.
- Option repetition and restating replies.

## Backend and reliability

- **Proxy protection:** shared secret or login, per-day spend cap, request size limit. Model tiering: cheaper model for summaries (done in Phase 4); a better model for key scenes is in Later.
- **Failure handling:** schema validation with automatic retry, fall back to a safe generic turn when the AI fails, stream narration (Phase 8), make turns idempotent so a half-finished turn can be resumed after closing the app.
- **Saves:** stored server-side (KV or database in the backend), plus manual export and import. localStorage alone is not safe on iOS with permanent death. Verify iOS storage behavior early.
- **Dice fairness:** the dice result is fixed per turn (seeded), so regenerating narration or options cannot be used to reroll.

## Phases

1. **Skeleton:** Story screen with a hardcoded fake turn, fake dice display, fake options. Get the mobile layout right on the phone. Decide here whether the loop feels good.
2. **Backend and schema:** protected proxy (Cloudflare Worker or Vercel function), spend cap, server-side save, memory schema (state, summary, ledger, milestone graph). One real AI turn, JSON validation with retry, the turn writes to the ledger.
3. **Rules engine:** dice, HP, XP and levels, equipment, loot tables, difficulty clamps, visible dice, state persistence. Start with a small read-only Ledger view in the More sheet (entities and their facts, no AI call) so the memory can be checked while playing.
4. **Retrieval and prompt assembly:** token budget per section, rolling summary, ledger retrieval, last-N turns, option variety, prompt caching of the static prefix, debug view of the assembled prompt.
5. **Character (done, awaiting the phone checklist):** housekeeping first (world core written and approved, `app.js` split into `ui.js`, `panels.js`, `character.js` and `app.js`, the 30-turn end-to-end test against the mock in `npm test`, saves copied to `bak:main:v<old>` before migrating), then the Known issues (difficulty tiers, three results, facts policy with cap and merge pass, pacing rule, single XP note, a truer Prompt estimate), then the character: pick-list creation (name, background, drive, flaw, two alignment questions, 2 free points, starting talent), 4 stats, XP table and level-up picks, 12 talents, advantage/disadvantage, alignment axes, item slots, no retry without change, narrator rules and the Character screen (More → Character). Schema v4.
6. **Combat:** (each talent effect type from `content.js` needs a combat meaning, and each stat a use in combat; the defeat branch's "rescued by a friendly NPC" and threat-clock costs are hooked up in Phase 7, once NPC attitude and the clock exist) code-resolved rounds, enemy tables with roles and visible intent, status effects, item effects, unique items, item prices (designed with gear), flee/surrender and morale, danger shown before fights and in the header, combat log, one AI summary call, defeat branch at 0 HP, permanent death and epilogue.
7. **Quest structure:** region generation at game start (places, factions, key NPCs, conflict) inside the world core, milestone graph generation with 3 leads per milestone, threat clock with warning signs, day and time of day, NPC attitude and first-meeting reactions (shaped by alignment), NPC profiles, branching finale, epilogue built from choices, quest flags, quest focus pinning, side quests, custom action classification and consequence-based responses, game-complete state.
8. **Map and polish:** text map and Travel (with danger and time), rest with random events, generic buttons, journal, Codex (known NPCs, places, factions, items with their facts; edit and delete), new game flow (no setting choice in v1) with the "never include" field and difficulty setting, merchants and shops, location secrets, hall of fallen heroes, text size setting and first-time tips, recap on return, streaming narration, export/import, home screen icon.
9. **Tuning:** bot-played test runs of 100+ turns logging tokens per turn, contradictions against the ledger, option repetition and difficulty distribution. Try a cheaper model. Add regenerate-with-fixed-dice; tune the threat clock if the loop feels too safe.

## Model and effort per phase

My usage limit is a real constraint, so default to Sonnet at medium effort and move up only where a mistake is expensive. Higher effort and Opus burn the limit faster.

| Phase | Model | Effort | Why |
|---|---|---|---|
| 1 Skeleton | Sonnet | Medium | Simple UI work with fake data |
| 2 Backend and schema | Opus (budget option: Sonnet at high) | High | The memory schema is hard to change later |
| 3 Rules engine | Sonnet | Medium | Clear rules, well specified |
| 4 Retrieval and prompt assembly | Opus (budget option: Sonnet at high) | High | Core of consistency and cost, subtle to get right |
| 5 Character | Sonnet | High | Design-heavy: the stat system is hard to change later. Try Opus if the recommendations feel thin |
| 6 Combat | Sonnet | High | Grew in the reviews: enemy roles and intent, morale, flee, defeat branch. Deterministic code plus one AI call |
| 7 Quest structure | Sonnet | High | Milestone graph, leads, threat clock and action classification are prompt-design heavy. Try Opus if the output is poor |
| 8 Map and polish | Sonnet | Medium | Mostly UI and glue; streaming needs care. Split into 8a (map, travel, journal, Codex, new game) and 8b (shops and the rest) |
| 9 Tuning | Sonnet | Medium | Reading logs and adjusting. High only for a stubborn problem |

Do not use the highest effort modes (Max, Ultra Code) for this project. The work is well specified.

Runtime models for the game itself are a separate question (see Open questions and the backend section).

## Should have (schedule, may slip)

- Ledger duplicate names: the same person can end up as two entities (e.g. "The woman by the hearth", then "Maren" once named). Merge or alias them on rename. Phase 4 added a `was` field to new_facts: code renames the entity, keeps the old name as an alias and merges two records if both exist (counted as `merges`). Measure it in the Phase 9 bot runs; the Codex in Phase 8 gets manual edit/merge.

(Regenerate with fixed dice and the bot-played tests are part of Phase 9.)

## Character progression review (done in Phase 5; balance with bot-play data in Phase 9)

Phase 3 shipped a first guess (3 stats at +0..+2, +1 to the lowest stat per level, 20 XP per level). Phase 5 decided:
- **Stats and numbers:** four stats, a background spread of +3/+2/+1/0 plus 2 free points; a typical stat grows from about +3 to +8 by level 10. Difficulty tiers 7/10/13/16 do not move with level.
- **Level-up choice:** the player picks (even levels a stat, odd levels from 3 a talent), no automatic stat gain.
- **XP pace:** about 2.2 XP a turn from rolls and bonuses (2 per roll, 1 per failure or no roll, 1-3 AI bonus), plus 25 per milestone and 10 per side quest from Phase 7. The table (40, 100, 190, 310, 460, 640, 860, 1120, 1420) puts level 2 near turn 16 and levels 6-8 at about turn 150-250 with quest XP. Re-check with bot-play in Phase 9.
- **Cap:** level 10; XP stops counting there and the Character screen says "top level".
- **XP notes:** one note a turn.
- **Level and difficulty:** checked in tests: the same check succeeds more often at +8 than at +4 (`rules.test.js`).
- **Quest XP:** the split is decided (above); `awardQuestXp` in `rules.js` is what the Phase 7 quest code calls.
- **What each stat does:** Might, Wits, Charm and Grit each add to their checks; Grit also sets HP and pack slots; combat (Phase 6) adds its own use for the others.

## Later (not in v1)

### v2: Mythic paths (inspired by Pathfinder: Wrath of the Righteous)

Written down so it is not forgotten. Not part of v1 (scope freeze); build after Phase 9. It needs v1's alignment, talents, milestone graph and epilogue builder.

**What WotR does:** a mythic rank separate from character level, earned from main-quest milestones, not XP (rank 1-2 are a generic "mythic hero"). At rank 3 the player picks a path among those unlocked: Angel, Demon, Lich, Aeon, Azata, Trickster, or Legend (stay mortal). Paths unlock through earlier deeds and dialogue choices, and a path not unlocked by then is gone. Each path has a core alignment you may stray from by one step; further, and a path quest pulls you back. Late paths (Gold Dragon, Swarm-That-Walks, Devil) open around rank 8. Each path changes powers, how the world treats you, companions' reactions and the ending.

**How it fits our game:**
- **Missable on purpose (replayability):** paths open and close through what you do. Each path has an unlock window and conditions; a path you did not earn in time, or one that clashes with who you have become, is gone for this run. A second run with different choices reaches different paths. This is deliberate, unlike most of the plan's anti-lockout rules.
- **Mythic rank** from milestones (about one rank per 2 milestones, so 4-5 ranks in a 150-250 turn game), separate from level.
- **Path tree in code:** each path has a core alignment, a theme, unlock signs, talents, an ending, and the paths it can turn into. Committing to a path closes the incompatible ones for good (a Saint can never become a Lich).
- **Transformations within a path:** a path can rise, fall or be redeemed as alignment moves. Example: Saint -> Angel at a higher rank; an Angel whose deeds turn cruel becomes a **Fallen Angel** (new talents, new reactions, darker ending), and a Fallen Angel may be redeemed through a hard path quest, or fall for good. Each path defines its own allowed transformations; there is no jump to an unrelated path.
- **Example catalog** (fantasy, v1 world): Saint -> Angel / Fallen Angel (lawful good), Fiend -> Demon (chaotic evil, rage and ruin), Undying -> Lich (lawful or neutral evil, bargains with death, forbidden lore), Arbiter -> Aeon (lawful neutral, judgment and balance), Free spirit -> Azata (chaotic good, freedom and art), Trickster (chaotic neutral, deception and luck), Legend (stay mortal: extra levels and talents). In the low-magic world these powers are rare and feared, which makes them feel earned.
- **Unlocking:** each path has a hidden affinity counter. Code moves it from the same signals as alignment plus path-specific tagged deeds the AI proposes with a reason ("spared the deserter: Saint +1"), capped per turn like every other proposal. An unlocked path shows up as an in-world sign or offer, never as a meter.
- **The choice** comes at a telegraphed milestone among the paths still open; Legend is always available.
- **Effects:** path talents with code-defined effects; NPC first reactions, attitude and fear shift with the path (a lich is not welcome at the shrine); the narrator voice changes; the path decides which branch of the branching finale is open and gets its own epilogue.
**Cost per turn:** about 30 more prompt tokens (rank, path and one line of path voice) and one more proposal kind in state_changes; affinity, rank and unlocks are code state. Flat cost holds.

- **v2: Setting choice** at New game (cyberpunk, pirates, ...). Each setting needs its own flavor of the code tables (gear, enemies, loot names, prices) and of the mythic paths; the rules engine stays the same.
- **Companions:** each needs a ledger record, stats, combat participation and an AI voice, so more context per turn and more rules. Design the memory schema so it does not block them, but do not build them first.
- AI re-skin of the 12 talents' names and flavor per game (Phase 8 at the earliest; the numbers stay in code)
- Full camp scene with its own options
- Drawn map
- Item pictures
- Consistency-check call against stored facts
- Better model or higher effort for key scenes (milestones, finale)
- Luck points: a small resource earned on failures, spent for +2 after seeing a roll (Ironsworn momentum style)
- Supplies as a resource (only if the threat clock is not enough pressure)
- Faction clocks: factions pursue their own plans, each with a small clock code advances over time (Blades in the Dark)
- Mythic-style Chaos Factor and scene-check twists for random events
- Oracle button (yes/no questions with odds, resolved by code)
- Legacy between runs

## Open questions

- Content tables: numbers by hand (decided for talents in Phase 5, flavor by AI later). Revisit at the start of each phase that needs a table (enemies, consumables and items in 6, prices in 8).
- Which model for milestone graph generation? (Turns and summaries are decided, see Decisions.)
- Pacing: how many turns per milestone, and how the game nudges when a milestone drags (Phase 7, with the threat clock).
- Is the milestone graph generated once by the AI at game start, or picked from a few hand-written templates per setting?
- Threat clock details: what ticks it and by how much, and what a full clock does (Phase 7).
