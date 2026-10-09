# Research: how existing AI text RPGs work

Background for `PLAN.md`. Read only when a design question needs evidence. The decisions themselves live in `PLAN.md`.

**Source reliability:** Most competitor feature comparisons (Old Greg's Tavern, Everweave, AI Realm, FableAI, AI Game Master) come from Friends & Fables' own marketing pages, which are written by a competitor and date from late 2025. Treat them as claims, not verified facts. AI Dungeon facts come from its own documentation. The research findings come from papers and developer posts. Check current versions before copying any feature.

## How existing products work

### AI Dungeon (Latitude): the freeform baseline
- **Input:** freeform. Action types Do, Say, Story.
- **Context assembly:** instructions (system prompt), Plot Essentials (always included), Author's Note, Story Summary, Story Cards (lore entries inserted only when their keywords show up in recent text), a Memory Bank (summarized story chunks retrieved by embedding relevance to the latest action), and recent story history. Dynamic parts share the remaining token budget in rough proportions (about 25% story cards, 50% history, 25% memory bank, per their docs).
- **Pros:** most flexible product on the market. Player can see and edit everything the AI sees. Undo, retry and edit are core. Model can be switched.
- **Cons:** the AI drifts, repeats itself, and sometimes ignores context. Their own help pages have a section on fixing repetition loops. Player reports describe it as eager to please. No rules engine, so stakes are whatever the AI feels like.
- **Take-away for us:** our ledger is the same pattern as Story Cards plus Memory Bank, but with structure (typed entities, code-owned numbers) instead of free text. Copy two ideas: an explicit token budget per prompt section, and a "context viewer" so I can see what the AI saw.

### Old Greg's Tavern: round-based drop-in play
- **Design:** an AI game master with an original D&D-lite system. Tracks HP, inventory and conditions. Turn-based combat. Solo or small party. Sold as credits that convert to "rounds", where one round is the whole party acting, rolling checks and the AI responding.
- **Pros:** quick to start, no prep, rules enforced for you.
- **Cons:** pay-per-round means the cost per turn is visible and painful. Per Friends & Fables' comparison it has no lore system (unverified). Freeform input, which is the "too much freedom" problem.
- **Take-away:** its pricing model shows cost per turn is the core business problem for everyone. Our flat per-turn design targets exactly that.

### Friends & Fables: full virtual tabletop
- **Design:** 5e-inspired rules engine, AI GM that tracks HP/inventory/conditions, initiative-based combat (crits, multi-attacks, XP, levels, rests), maps and tokens, a world-building suite, and lore pages the AI reads during play. The AI is asked to enforce constraints, so you can actually die.
- **Free tier:** limited by daily AI turns (reported as 5-25).
- **Pros:** deepest feature set. Structured lore the AI reads is the same idea as our ledger.
- **Cons:** heavy and tabletop-shaped, not a quick phone experience. Their own patch notes admit rough spots (mid-combat healing was called problematic).
- **Take-away:** proves "AI narrates, rules engine decides" works and that players accept real death. We should not copy the scope.

### Everweave: cinematic mobile text RPG
- **Design:** AI Dungeon Master with 5e-style mechanics, dice and character sheet, theatre-of-the-mind turn-based combat, a built-in long-term memory system, iOS app.
- **Pros:** polished mobile experience, high App Store rating (about 4.4 from several thousand ratings).
- **Cons:** user reviews mention memory inconsistencies, slow responses and the AI breaking down in long sessions. (Review aggregator and vendor claims, not verified.)
- **Take-away:** shows long-session memory and latency are the real complaints even for the better products. Streaming narration and the ledger are not optional.

### Other mobile story-first apps (AI Game Master, FableAI) and AI Realm
- Lightweight trait plus free-text combat, token/gem-based pricing, premium models for narration and images. AI Realm uses campaign notes and summaries for memory and tracks HP and turn order on a map, but leaves inventory to the player.
- **Take-away:** monetization is always by tokens/turns. Nobody solved cheap long play.

### AI Game Master SE-3 (itch.io, Windows alpha) and SoloGM (CLI)
- SE-3: an AI oracle for solo pen and paper that shows 5 default choices matching the scene plus a custom "I do..." input and a character sheet. Uses the Groq API.
- SoloGM: organizes solo play into games, acts and scenes. Claude interprets oracle results, generating several candidate interpretations (a configurable count), summarizes completed acts and can write a prose narrative afterward.
- **Take-away:** both validate the options-first approach and the "multiple suggestions" pattern. Neither seems to combine it with a lore ledger and code-owned rules, which is our gap in the market.

### Hidden Door
- Co-op narrative platform in licensed fictional worlds, with explicit modeling of narrative arcs and a custom model stack. Mostly a social, multi-player product.
- **Take-away:** mainly relevant for its stance that the story arc should be modeled explicitly rather than hoped for from the model.

### Mythic Game Master Emulator (analog solo-RPG standard)
- Oracle for yes/no questions with odds, a **Chaos Factor** that rises when events spiral out of the player's control and falls when things go as planned, a scene check (normal, altered, interrupted), random events driven by focus tables, and lists of NPCs and plot threads that make frequently used elements more likely to reappear.
- **Take-away:** a proven way to inject surprise without relying on AI creativity. Our "Wildcard" table is a weaker version of this.

### Research systems: ChatRPG v1-v3 (SENNA) and the Labyrinth function-calling paper
- **ChatRPG:** a solo AI GM built from separate agents. Narrator (writes), Archivist (tracks world consistency), Examiner (judges whether a player action is allowed: allowed, conditionally allowed, disallowed), Navigator (updates story progress), Scribe (turns an adventure module into a **narrative graph**, a directed graph of story milestones with yes/no conditions between them).
- **Findings:** early versions complied with nearly anything the player typed, hurting coherence. With the narrative graph, all required story beats occurred in all 12 test runs, but optional content was reached in only about half, because the system favored content-heavy branches. Players strongly disliked hard denials ("you can't do that"). They preferred in-world consequences, then NPC influence, then extra information. Players also disliked repeated, restating replies and hints that felt like hand-holding.
- **Labyrinth paper:** giving the AI GM explicit functions to update game state improved narrative quality and state-update consistency versus free text.
- **Developer reports:** a general chat model was unreliable at tracking health and buffs, so one developer moved state into an external database and used the LLM only for narration. Another noted LLM consistency is a systems problem, so the model must sit inside a system that enforces the world state. Another reported separating game logic from narration and tracking player state outside the model.
- **Take-away:** this is the strongest evidence for our architecture (external state, structured output, code-owned rules) and it supplies two things we lacked: a milestone graph for the main quest and a policy for unreasonable player actions.

### Newer AI RPG apps (2026)
- Auferet (browser AI GM, persistent memory of characters, places and events, 10 free actions a day), Eidolon Engine and Jenova's Roleplay Game Master all market "persistent" or "unlimited" memory. All are vendor claims with no independent tests. A neutral 2026 roundup (Converge) still calls consistency the genre's core engineering challenge.
- PAYADOR (arXiv 2504.07304, 2025) reports that LLM game masters struggle to keep the narrated world coherent after changes, with an AI Dungeon example of inventory being contradicted. A 2026 neuro-symbolic storytelling paper (arXiv 2605.24719) has the LLM propose actions that are executed against a structured world state, the same split we use.
- **Take-away:** nothing new changes the architecture. Memory is still what everyone sells and nobody has proven.

## Standard practices from tabletop and solo RPG design

Established techniques from human-run and solo games that address problems this project has. They are design practice, not studies, so the evidence is decades of play rather than measurement.

### Degrees of success and "fail forward" (Powered by the Apocalypse, Ironsworn)
- PbtA games roll 2d6: 10+ full success, 7-9 success at a cost or a lesser version of the goal, 6- a miss that still moves the story. Ironsworn has the same three bands (strong hit, weak hit, miss). The middle band is where "fail forward" lives: failure is never "nothing happens".
- The hard part is the middle result. The common advice is that a 7-9 does not cancel the success; it adds a cost, a complication or a smaller gain.
- **For us:** our d20 check is binary. A cost band just under the difficulty (e.g. 1-2 below) gives the AI a third, well-defined result, makes the game less swingy under permanent death, and needs no extra AI call. It touches the rules engine, the dice display and the prompt, and combat will reuse the same resolution, so it is cheapest to add before Phase 5.

### Progress clocks and fronts (Blades in the Dark, Dungeon World)
- A clock is a circle of 4, 6 or 8 segments that tracks a complex obstacle or a growing threat. Danger clocks tick on complications (1-3 segments by severity) and trigger the danger when full. Faction clocks advance a group's plans on their own, independently of the player.
- Dungeon World fronts: each danger has an impending doom (what happens if the heroes do nothing) and 1-5 grim portents, the visible warning signs that move it closer. Player action can divert it.
- **For us:** this is the standard answer to the open pressure question (gap K). A threat clock on the main quest, with portents generated together with the milestone graph, is pure data that code ticks (on failures, rests, travel, time), and the narration shows each portent. It gives pacing and stakes without trusting the AI to create urgency.

### Solo play toolkit (Ironsworn, Mythic)
- Ironsworn is built for solo play: vows (sworn quests, ranked by difficulty) with progress tracks; momentum, a resource that successes build and failures drain, spendable to turn a failure into a success; supply, a shared resource track instead of item-by-item rations; oracles (random tables) for twists and names. XP comes from completing vows.
- **For us:** vows match our quest focus. Momentum is the standard way to give a solo player some control over luck, which matters more with permanent death and dice fixed per turn. Supply is a lighter alternative to tracking every ration. XP for completing quests (not only for rolls) is the genre norm.

### The Three Clue Rule and node-based scenarios (The Alexandrian)
- For any conclusion the player must reach, include at least three clues, because players miss or misread clues. Inverted: a player with any three leads reaches at least one destination, so a scenario can branch without a fixed path. Nodes can be whole scenarios in a campaign.
- **For us:** a milestone whose condition the AI never makes reachable stalls the game. Generating 3 leads per milestone with the graph (Phase 6) and putting the unrevealed ones in the prompt keeps the main quest moving. Leads can point to locations and NPCs, which also feeds the side-quest surfacing rule.

### Morale, reactions and escape (OSR / B/X)
- Classic morale: when a side loses its first member or half its strength, roll 2d6 against a morale score (2 = never fights, 12 = to the death); on a failed check the enemies flee, withdraw or surrender. Reaction rolls (2d6, hostile to friendly) decide how a newly met creature or NPC behaves before anyone draws steel.
- **For us:** fights that end in flight or surrender are shorter (cheaper to resolve and to narrate) and less lethal. A first-meeting reaction is a code-owned roll the AI must honor, the same pattern as our dice.

### Fair permanent death (roguelike design)
- Roguelike designers agree a death should trace back to a decision the player could have read: give enough information to decide, make randomness create hard situations, not unwinnable ones, and keep escape routes visible. Some games turn 0 HP into a "defeat branch" (escape, capture, treatment) and end the run only if none is available or the player picks a self-destructive option.
- **For us:** "option text stays neutral" is fine, but the scene must still telegraph danger before a fight, every fight needs a flee or surrender choice, and code should guarantee that combat never starts with no warning unless the player chose to attack.

### NPC attitude and the passage of time (CRPG practice, recent AI work)
- CRPGs track NPC disposition as a number and let it gate options and prices. A 2026 survey of agent systems and the NarrativeWorlds thesis (HKUST, 2026) both name relationship state as explicit memory that keeps long stories coherent.
- No source covers time-of-day tracking specifically, but in our own play the AI already makes time claims ("burned four nights ago", "until the month turns"). Without a code-owned day counter these will drift and contradict each other.
- **For us:** a small code-owned attitude per NPC (-2..+2, changed by at most 1 per turn, shifting social difficulty) and a code-owned clock (day number plus time of day, advanced by travel and rest) are cheap state that the prompt can show every turn.

### Table practices
- Session zero and safety tools (lines: never include; veils: happens off-screen) are standard at the start of a campaign. For a solo AI game this is a "never include" field at New game, stored with the setting (it lives in the cached prefix, so it costs nothing per turn).
- A "previously on" recap at the start of a session is standard GM practice and helps a phone player who returns after days. We already store the rolling summary, so it needs no AI call.
- Character creation in most modern games is a short list of choices (archetype or background, one drive or bond, one flaw) that the game then fleshes out. This answers the open question about templates vs AI generation: the player picks, the AI writes.

## What the research says about the plan

**Supported by evidence:**
- External state and rebuilt prompts (everyone who succeeded does this)
- Ledger of established facts with retrieval (Story Cards, lore pages, Archivist)
- Rolling summary plus last-N turns
- Code-owned dice, HP and inventory
- Structured JSON output for state changes
- Options-first loop (SE-3, SoloGM)
- Flat per-turn cost through a capped prompt (addresses the pain behind everyone's turn limits)
- Permanent death (accepted by players in Friends & Fables)

## Gap analysis and status

Priority: **Foundation** means v1 would feel broken or be unsafe without it. **Should** means clearly valuable. **Later** is optional.

Status: gaps A-G were accepted into v1 in `PLAN.md`. H-M are listed there under "Should have". N-P are in Later. Q-AC came from the review after Phase 4; their status shows what was accepted. Character creation got its own phase (5) before combat.

| # | Gap | Why it matters (evidence) | Fix | Priority | Status in PLAN.md |
|---|---|---|---|---|---|
| A | Main quest has no mechanism | ChatRPG's narrative graph guaranteed required beats. Without it, an AI drifts forever. | Milestone graph generated at game start, tracked by code | Foundation | v1, Phase 6 |
| B | No policy for off-path custom actions | Over-compliance was a recurring failure. Hard denials were least liked. | Classify actions, answer with consequences, never a bare refusal | Foundation | v1, Phase 6 |
| C | No progression or loot | Progression is the long-term loop. Just Loot-style combat needs growing numbers. | XP, levels, equipment stats, code loot tables | Foundation | v1, Phase 3 |
| D | AI sets difficulty with no limits | Risk-averse and over-compliant AI GMs collapse tension. | Code clamps difficulty, logs distribution | Foundation | v1, Phase 3 |
| E | Proxy unprotected and uncapped | The key is the only secret. | Shared secret, spend cap, size limit, model tiering | Foundation | v1, Phase 2 |
| F | No failure handling | Everweave reviews complain about slowness and breakage. | Validation and retry, safe fallback turn, streaming, idempotent turns | Foundation | v1, Phase 2 |
| G | Save data can be lost | Permadeath plus a lost save is the worst case. | Server-side saves plus export/import | Foundation | v1, Phase 2 |
| H | Retry/undo without reroll cheating | Undo and retry are AI Dungeon's most-used features. | Regenerate text, keep dice fixed per turn | Should | Phase 9 |
| I | Player cannot see or fix what the AI believes | Editable context is how AI Dungeon players fix drift. | Codex screen, prompt debug view | Should | Debug view done (Phase 4); Codex in Phase 7 |
| J | Option repetition and sameness | AI Dungeon repetition loops, ChatRPG restating replies | Send recent option sets, forbid repeats, require variety | Should | Done (Phase 4, soft filter plus counters) |
| K | No pressure on the player | Stakes come from scarcity. | Day counter and supplies, or a threat clock | Should | Decided: threat clock + day, Phase 7 |
| L | Dice are invisible | Players need to see fairness, especially with permadeath | Show roll, modifier, difficulty and result | Should | Done (Phase 3) |
| M | No way to test consistency and cost | Successful developers studied logs for contradictions and balance bugs | Bot-played 100+ turn test runs with logging | Should | Phase 9 |
| N | Weak random events | Mythic's Chaos Factor produces surprise and pacing | Chaos Factor and scene-check twists | Later | Later |
| O | Oracle questions | Standard solo-RPG tool | Yes/no button with odds, resolved by code | Later | Later |
| P | Companions, drawn map, item art, legacy | Already deferred | Keep deferred | Later | Later |
| Q | Checks are binary pass/fail | PbtA and Ironsworn three-band results; fail forward | Cost band just under the difficulty, plus natural 1/20 | Should, before Phase 5 | Accepted, Phase 5 (Character) |
| R | No escape from a lethal fight | Roguelike fairness; OSR morale | Flee/surrender choice in every fight, enemy morale, defeat branch at 0 HP | Foundation for permadeath | Accepted, Phase 6 |
| S | Danger is not telegraphed | Roguelike fairness ("enough information to decide") | Scene shows the threat before a fight; location danger visible | Should | Accepted, Phase 6 (location danger shown too) |
| T | Enemy numbers have no source | Same rule as loot: code owns numbers | Enemy stat tables by tier and danger; AI names and describes only | Foundation | Accepted, Phase 6 |
| U | Consumables do nothing | Combat plan allows "use an item" | Code table of item effects (heal, bonus, escape) | Foundation | Accepted, Phase 6 |
| V | A milestone can stall | Three Clue Rule | 3 leads per milestone, unrevealed ones in the prompt | Should | Accepted, Phase 7 |
| W | Time is not tracked, the AI invents dates | Observed in play; fronts and clocks need time | Code-owned day and time of day, advanced by travel and rest | Should | Accepted, Phase 7 |
| X | Pressure (gap K) | Blades clocks, Dungeon World fronts, Ironsworn supply | Threat clock with portents on the main quest; supply optional | Should | Accepted (threat clock), Phase 7; supplies in Later |
| Y | NPC attitude lives only in prose facts | CRPG disposition; OSR reaction rolls; NarrativeWorlds | Attitude -2..+2 per NPC, code-clamped, first-meeting reaction roll | Should | Accepted, Phase 7 |
| Z | The player has no say over luck | Ironsworn momentum, Fate points | Small luck resource: earned on failures, spent for +2 after a roll | Later or Should | Later |
| AA | Coming back after days is disorienting | "Previously on" recap | Recap screen from the stored summary, no AI call | Should | Accepted, Phase 8 |
| AB | No content boundaries | Session zero, lines and veils | "Never include" field at New game, in the cached prefix | Should | Accepted, Phase 8 |
| AC | Plan items with no phase | Everweave latency complaints | Streaming narration; better model for milestone and finale turns | Should | Streaming: Phase 8. Key-scene model: Later |

Biggest hole was A. "Main quest with an ending" is a promise the AI cannot keep on its own.

## Sources

- AI Dungeon documentation: memory system, context contents, plot components, repetition help (latitudegames.notion.site, help.aidungeon.io)
- Friends & Fables comparison and patch notes (fables.gg): Old Greg's Tavern, Everweave, AI Realm, FableAI, AI Game Master, combat update. Vendor marketing, late 2025.
- Everweave App Store listing and review aggregator (apps.apple.com, mwm.ai)
- AI Game Master SE-3 (dehe25.itch.io/ai-game-master-se-3)
- SoloGM CLI (pypi.org/project/sologm)
- Hidden Door coverage (pcgamer.com, gamesbeat.com)
- Mythic GM Emulator 2e (wordmillgames.itch.io, glyphngrok.substack.com, an MCP implementation on val.town)
- Jørgensen and Tharmabalan, "Narrative Adherence in LLM-driven Games" (ChatRPG v3 / SENNA), Aalborg University, 2025
- Song et al., "You Have Thirteen Hours in Which to Solve the Labyrinth: Enhancing AI Game Masters with Function Calling" (arxiv.org/abs/2409.06949)
- OpenAI community developer threads on AI dungeon masters and RPG state tracking
- Respan, "NPC dialogue consistency" (engineering article on LLM game NPC failure modes)
- PbtA partial success: Gnome Stew, "Failing forward" (gnomestew.com/failing-forward-how-to-make-failure-interesting-in-rpgs); "Conquering the dreaded 7-9" (viridianvoid.bearblog.dev); StartPlaying, "What is Powered by the Apocalypse"
- Blades in the Dark progress clocks: Roll20 compendium (roll20.net/compendium/BITD/Progress clocks); Sly Flourish, "Progress clocks in D&D"; The Alexandrian on Blades
- Ironsworn: Wikipedia; Gnome Stew review; Quest Portal, "Tools for the Lone Oathkeeper" and "What is Ironsworn?"; ironswornrpg.com
- The Alexandrian, "The Three Clue Rule" (thealexandrian.net/?p=7985) and "Node-Based Scenario Design, Part 2" (thealexandrian.net/creations/misc/node-design/node-design2.html)
- Dungeon World fronts: Roll20 compendium (roll20.net/compendium/dw/Fronts); Sly Flourish, "Fronts in D&D"
- OSR morale and reactions: DMDavid, "Morale checks"; The Alexandrian on reactions; referee screen notes (git.itsericwoodward.com)
- Roguelike permadeath: Game Developer, "The game design lessons of permadeath"; r/roguelikedev FAQ Friday #19 (Cogmind); Bugnet, "How to make a roguelike feel fair"; Blade RPG, "One life"
- PAYADOR (arxiv.org/abs/2504.07304); "World-State Transformations for Neuro-symbolic Interactive Storytelling" (arXiv 2605.24719); "AI Agent Systems" survey (arXiv 2601.01743); Kumyol, "NarrativeWorlds" (HKUST, 2026)
- 2026 apps: Auferet (peerpush.com/p/auferet, toolradar.com), Eidolon Engine (Gumroad listing), Jenova articles (vendor), Converge, "Best AI text adventure games 2026"
