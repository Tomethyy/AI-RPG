# Solo RPG App: Dev Plan

A lightweight, AI-driven solo pen-and-paper RPG for my iPhone. The AI proposes options, I pick, code resolves the rules, the AI narrates.

Background research on existing products and the evidence behind these decisions is in `RESEARCH.md`. Do not read it unless a question needs it.

**Working rules for Claude Code:**
- Build one phase at a time, starting with Phase 1. Ask me about any open question that blocks the current phase. Do not build ahead.
- At the end of each phase: stop, give me a 3-line summary of what works, commit, and tell me which model and effort level to use for the NEXT phase (see "Model and effort per phase"). You cannot switch the model yourself, so remind me to do it. Do not start the next phase until I say go.
- If a phase turns out harder than its recommendation, tell me and suggest moving up one level instead of grinding at the current one.

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
| Setting | Picked at game start |
| Length | Main quest with an ending, tracked as a milestone graph. Finishing it ends the game. Side quests along the way. |
| Combat | Abstract, round-based, resolved entirely by code. AI writes one in-universe summary at the end. |
| Death | Permanent |
| Option quality | Neutral: do not hint at risk or reward in option text |
| Platform | Mobile-first PWA with a tiny backend that holds the API key and the save data |
| Items | Text only, no pictures |
| Map | Text-based location list with connections, no drawn map in v1 |
| Progression | XP, levels, equipment with stats, loot from code tables |
| Scope | v1 is frozen (see below). Everything else goes in Later. |

## v1 scope (frozen)

- Story loop with options plus generic buttons
- Main quest as a milestone graph, quest focus, side quests
- Policy for off-path custom actions (consequences, not refusals)
- Rules engine with XP, levels, equipment and loot, clamped difficulty, visible dice
- Code-resolved combat with one AI summary, permanent death
- Text map with Travel, rest with random events
- Memory: state, rolling summary, lore ledger
- Backend: protected proxy with spend cap, JSON validation with retry, server-side saves with export/import

If the loop is not fun at this size, extras will not fix it.

## Core loop

1. Show scene narration.
2. Show 3-4 AI-generated situation-specific options plus fixed generic buttons.
3. Player taps one.
4. Code rolls dice and applies rules.
5. AI narrates the outcome and returns the next options, state changes, newly established facts and quest flags.

## Screens (phone-first, thumb-reachable)

- **Story:** narration on top, option buttons pinned at the bottom. Dice results shown for every check (roll, modifier, difficulty, result).
- **Character:** stats, HP, XP/level, equipment, inventory, conditions.
- **Journal:** main quest progress, side quests, focused quest, past scene history.
- **New game:** setting, tone, character creation.

## Generic buttons (hardcoded, no AI cost)

Look around, Talk to someone, Travel, Rest, Check inventory, Wildcard (random event table), Custom action (free text escape hatch).

## Main quest as a milestone graph

The AI cannot be trusted to steer toward an ending on its own, so the ending is structure owned by the app.

- At game start, the AI generates once a **milestone graph**: 6-12 milestones, each with yes/no completion conditions, ending in a defined finale. Stored as data, not prose.
- Each milestone has a status: undiscovered, ongoing, completed.
- Each turn the prompt includes only the current milestone and a hint at the next one.
- The AI reports quest flags in its output; code checks the conditions and advances the graph.
- Finishing the final milestone ends the game with an epilogue.
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

## Rules (deliberately tiny)

- 3 stats, d20 + stat vs. a difficulty, HP, XP and levels, equipment with stats (damage, multiplier, defense).
- Code owns all rules and dice. The AI never rolls or changes numbers directly. It proposes, code validates and applies.
- **Difficulty is clamped by code** to a range based on level and location danger. The AI proposes, code limits. Log the difficulty distribution so drift is visible.
- Loot comes from code tables. The AI only names and describes items.
- Option text stays neutral. Each option carries a suggested stat and difficulty internally, but the player sees no risk or reward hints.
- Every check shows its roll, modifier, difficulty and result.

## Combat (inspired by "Just Loot")

- Resolved fully in code, no AI calls during the fight.
- Each round: player damage numbers and multipliers resolve, damage is applied, then enemies attack, then next round.
- Player choices during combat are minimal and mechanical (which ability or item to use), not narrated.
- Uses equipment stats, XP and loot from the rules engine.
- When combat ends, ONE AI call receives the structured combat log and writes an in-universe combat summary.
- Death is permanent. If HP hits 0, the run ends with a short AI-written epilogue.

## Map and travel (text-based)

- Known locations live in the ledger, each with connections and travel info.
- A **Travel** button lists reachable locations. Choosing one costs no AI call until arrival, when the AI narrates the new scene.
- The AI may add locations via new_facts; code adds them to the known map when the player learns of them.

## Rest and camp

- Rest restores some HP, with a chance of a random event from the wildcard table.
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

**Prompt assembled per turn (with a token budget per section):**
1. Fixed rules and tone (static, cacheable)
2. Character sheet, equipment and inventory
3. Rolling summary
4. Current milestone, next-milestone hint, focused quest
5. Only the relevant ledger entities for the current scene (match by name or location tag)
6. Last ~5 turns verbatim, plus recent options to avoid repeating
7. The player's chosen action and the dice result

**AI output per turn (JSON, validated before applying):**
- narration
- options (each with suggested stat and difficulty; must vary in kind, e.g. at least one social, one exploratory, one direct, without hinting at risk)
- action classification (for custom actions)
- state_changes (proposed, validated by code)
- new_facts (every named thing the AI invented this turn)
- quest_flags

**Cost behavior:** a turn stays around 3-5k tokens regardless of campaign length. The static prefix is cached. Turn 500 should cost about the same as turn 50.

**Known weak spots to tune:**
- Summaries lose detail over time, so the ledger matters more than the summary.
- The AI can contradict stored facts (a cheap consistency check is in Later).
- The AI may forget to report a fact it invented. Prompt it hard to list all new named things.
- Retrieval can miss a relevant entity.
- Option repetition and restating replies.

## Backend and reliability

- **Proxy protection:** shared secret or login, per-day spend cap, request size limit. Model tiering: cheaper model for options and summaries, better model for key scenes.
- **Failure handling:** schema validation with automatic retry, fall back to a safe generic turn when the AI fails, stream narration, make turns idempotent so a half-finished turn can be resumed after closing the app.
- **Saves:** stored server-side (KV or database in the backend), plus manual export and import. localStorage alone is not safe on iOS with permanent death. Verify iOS storage behavior early.
- **Dice fairness:** the dice result is fixed per turn (seeded), so regenerating narration or options cannot be used to reroll.

## Phases

1. **Skeleton:** Story screen with a hardcoded fake turn, fake dice display, fake options. Get the mobile layout right on the phone. Decide here whether the loop feels good.
2. **Backend and schema:** protected proxy (Cloudflare Worker or Vercel function), spend cap, server-side save, memory schema (state, summary, ledger, milestone graph). One real AI turn, JSON validation with retry, the turn writes to the ledger.
3. **Rules engine:** dice, HP, XP and levels, equipment, loot tables, difficulty clamps, visible dice, state persistence.
4. **Retrieval and prompt assembly:** token budget per section, rolling summary, ledger retrieval, last-N turns, option variety, prompt caching of the static prefix, debug view of the assembled prompt.
5. **Combat:** code-resolved rounds, combat log, one AI summary call, permanent death and epilogue.
6. **Quest structure:** milestone graph generation, quest flags, quest focus pinning, side quests, custom action classification and consequence-based responses, game-complete state.
7. **Map and polish:** text map and Travel, rest with random events, generic buttons, character screen, journal, new game flow, export/import, home screen icon.
8. **Tuning:** bot-played test runs of 100+ turns logging tokens per turn, contradictions against the ledger, option repetition and difficulty distribution. Try a cheaper model. Add regenerate-with-fixed-dice, a Codex screen to view and edit ledger facts, and a pressure mechanic if the loop feels too safe.

## Model and effort per phase

My usage limit is a real constraint, so default to Sonnet at medium effort and move up only where a mistake is expensive. Higher effort and Opus burn the limit faster.

| Phase | Model | Effort | Why |
|---|---|---|---|
| 1 Skeleton | Sonnet | Medium | Simple UI work with fake data |
| 2 Backend and schema | Opus (budget option: Sonnet at high) | High | The memory schema is hard to change later |
| 3 Rules engine | Sonnet | Medium | Clear rules, well specified |
| 4 Retrieval and prompt assembly | Opus (budget option: Sonnet at high) | High | Core of consistency and cost, subtle to get right |
| 5 Combat | Sonnet | Medium | Deterministic code plus one AI call |
| 6 Quest structure | Sonnet | High | Milestone graph and action classification are prompt-design heavy. Try Opus if the output is poor |
| 7 Map and polish | Sonnet | Medium | Mostly UI and glue |
| 8 Tuning | Sonnet | Medium | Reading logs and adjusting. High only for a stubborn problem |

Do not use the highest effort modes (Max, Ultra Code) for this project. The work is well specified.

Runtime models for the game itself are a separate question (see Open questions and the backend section).

## Should have (schedule, may slip)

- Regenerate narration/options with the dice result kept fixed
- Codex screen: list ledger entities and facts, edit and delete
- Pressure on the player: day counter and consumable supplies, or a threat clock on the main quest (needs a decision)
- Bot-played consistency and cost tests

## Later (not in v1)

- **Companions:** each needs a ledger record, stats, combat participation and an AI voice, so more context per turn and more rules. Design the memory schema so it does not block them, but do not build them first.
- Full camp scene with its own options
- Drawn map
- Item pictures
- Consistency-check call against stored facts
- Mythic-style Chaos Factor and scene-check twists for random events
- Oracle button (yes/no questions with odds, resolved by code)
- Legacy between runs

## Open questions

- Which model for per-turn calls vs. summary calls vs. milestone graph generation?
- Backend choice (Cloudflare Worker vs. Vercel)?
- How long should the main quest be (number of turns), and how is it paced?
- Should the character be fully AI-generated at the start or hand-built from a template?
- Game language: English, German, or a setting? Test narration and option phrasing in the chosen language early.
- Is the milestone graph generated once by the AI at game start, or picked from a few hand-written templates per setting?
- Pressure mechanic: supplies and day counter, a threat clock, or neither in v1?
