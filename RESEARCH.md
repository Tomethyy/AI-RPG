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

Status: gaps A-G were accepted into v1 in `PLAN.md`. H-M are listed there under "Should have". N-P are in Later.

| # | Gap | Why it matters (evidence) | Fix | Priority | Status in PLAN.md |
|---|---|---|---|---|---|
| A | Main quest has no mechanism | ChatRPG's narrative graph guaranteed required beats. Without it, an AI drifts forever. | Milestone graph generated at game start, tracked by code | Foundation | v1, Phase 6 |
| B | No policy for off-path custom actions | Over-compliance was a recurring failure. Hard denials were least liked. | Classify actions, answer with consequences, never a bare refusal | Foundation | v1, Phase 6 |
| C | No progression or loot | Progression is the long-term loop. Just Loot-style combat needs growing numbers. | XP, levels, equipment stats, code loot tables | Foundation | v1, Phase 3 |
| D | AI sets difficulty with no limits | Risk-averse and over-compliant AI GMs collapse tension. | Code clamps difficulty, logs distribution | Foundation | v1, Phase 3 |
| E | Proxy unprotected and uncapped | The key is the only secret. | Shared secret, spend cap, size limit, model tiering | Foundation | v1, Phase 2 |
| F | No failure handling | Everweave reviews complain about slowness and breakage. | Validation and retry, safe fallback turn, streaming, idempotent turns | Foundation | v1, Phase 2 |
| G | Save data can be lost | Permadeath plus a lost save is the worst case. | Server-side saves plus export/import | Foundation | v1, Phase 2 |
| H | Retry/undo without reroll cheating | Undo and retry are AI Dungeon's most-used features. | Regenerate text, keep dice fixed per turn | Should | Phase 8 |
| I | Player cannot see or fix what the AI believes | Editable context is how AI Dungeon players fix drift. | Codex screen, prompt debug view | Should | Phase 4 (debug), Phase 8 (Codex) |
| J | Option repetition and sameness | AI Dungeon repetition loops, ChatRPG restating replies | Send recent option sets, forbid repeats, require variety | Should | Phase 4 |
| K | No pressure on the player | Stakes come from scarcity. | Day counter and supplies, or a threat clock | Should | Open question |
| L | Dice are invisible | Players need to see fairness, especially with permadeath | Show roll, modifier, difficulty and result | Should | v1, Phase 3 |
| M | No way to test consistency and cost | Successful developers studied logs for contradictions and balance bugs | Bot-played 100+ turn test runs with logging | Should | Phase 8 |
| N | Weak random events | Mythic's Chaos Factor produces surprise and pacing | Chaos Factor and scene-check twists | Later | Later |
| O | Oracle questions | Standard solo-RPG tool | Yes/no button with odds, resolved by code | Later | Later |
| P | Companions, drawn map, item art, legacy | Already deferred | Keep deferred | Later | Later |

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
