# Plasma Engine

LLM-backed AI persona engine for games and simulations.

Each `PlasmaEngine` instance is one simulated person — they have a **personality**, **mood**, **fatigue**, **memory**, a **social influence score**, and a **relationship graph** centered on themselves. They read messages, decide whether to respond, call game-world tools, and produce in-character text replies.

Built for: **Electron + TypeScript** game engines (startup tycoon, RPG, social sims, etc.).
Requires an OpenAI or Anthropic API key supplied by the player at runtime.

---

## Architecture

```
PlasmaEngine (one per NPC/employee)
├── PersonaCore         — static traits: personality, skills, values, influence score
├── EmotionCore         — dynamic mood: valence, arousal, stress, confidence, motivation
├── FatigueCore         — energy, mental fatigue, burnout risk; work/rest simulation
├── MemoryCore          — episodic/semantic/emotional memories with decay + retrieval
├── RelationshipGraph   — ego-centric graph; edges updated by every interaction
│
├── MessageRouter       — engagement decision engine (MUST / SHOULD / CAN / SKIP)
├── ConversationManager — conversation state and history
├── ResponseGenerator   — agentic loop: LLM → tool calls → result → final reply
│
├── MCPClient           — tool registry; game wires up handlers at startup
├── PromptBuilder       — assembles system prompt from all live state
└── LLMProvider         — OpenAI / Anthropic abstraction
```

---

## Installation

```bash
npm install plasma-engine
# install your chosen LLM provider:
npm install openai          # for OpenAI
npm install @anthropic-ai/sdk  # for Anthropic
```

---

## Quick start

```ts
import { PlasmaEngine, fromPreset } from 'plasma-engine';

const engine = new PlasmaEngine({
  persona: {
    id: 'dev-jisu',
    name: '김지수',
    role: 'Frontend Developer',
    influenceScore: fromPreset('senior').score,   // 58
    influenceLabel: '과장',
    personality: {
      openness: 0.75, conscientiousness: 0.65,
      extraversion: 0.45, agreeableness: 0.70,
      neuroticism: 0.30, ambition: 0.65,
    },
    background: '5년차 프론트엔드 개발자. React와 TypeScript 전문가.',
    skills: [
      { name: 'React',      level: 'expert',    domain: 'frontend' },
      { name: 'TypeScript', level: 'advanced',  domain: 'frontend' },
      { name: 'UI Design',  level: 'intermediate', domain: 'design' },
    ],
    communicationStyle: { formality: 0.35, verbosity: 0.55, directness: 0.6, humor: 0.4, language: 'ko' },
    relationships: [
      { personaId: 'ceo-1', name: 'CEO', trust: 0.7, rapport: 0.6, influenceScore: 99, explicitType: 'superior' },
      { personaId: 'dev-2', name: 'Park Minsu', trust: 0.8, rapport: 0.8, influenceScore: 40 },
    ],
    values: ['code quality', 'autonomy', 'learning'],
  },
  llm: {
    provider: 'anthropic',
    apiKey: userSuppliedApiKey,   // pass from game settings screen
  },
  debug: false,
});
```

### Wire up game-world tools

```ts
engine.registerTool(
  {
    name: 'get_task_queue',
    description: 'List tasks currently assigned to this employee.',
    inputSchema: { type: 'object', properties: {} },
  },
  async () => gameWorld.getTasksFor(engine.persona.id)
);

engine.registerTool(
  {
    name: 'complete_task',
    description: 'Mark a task as completed.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID' },
        summary: { type: 'string', description: 'What was done' },
      },
      required: ['task_id'],
    },
  },
  async ({ task_id, summary }) => gameWorld.completeTask(task_id as string, summary as string)
);
```

### Handle incoming messages

```ts
// Called for EVERY message in the game messenger
const decision = engine.routeMessage({
  id: 'msg-001',
  conversationId: 'channel-general',
  senderId: 'ceo-1',
  senderName: 'CEO',
  senderInfluenceScore: 99,   // triggers deference boost in scoring
  content: '지수씨, 오늘 스프린트 리뷰 준비됐나요?',
  timestamp: Date.now(),
  mentions: ['dev-jisu'],
  isDirectMessage: false,
});

// decision.action: 'MUST_RESPOND' | 'SHOULD_RESPOND' | 'CAN_RESPOND' | 'SKIP'
// decision.delayMs: realistic typing delay

if (decision.action !== 'SKIP') {
  setTimeout(async () => {
    const reply = await engine.respond(message);
    gameUI.sendMessage(engine.persona.id, reply);
  }, decision.delayMs);
}
```

### Non-messenger interactions (updates relationship graph)

```ts
// Pair programming session
engine.logInteraction('dev-2', 'Park Minsu', {
  type: 'pair_work',
  intensity: 0.85,
  timestamp: Date.now(),
  description: 'Pair programmed on the authentication module for 3 hours',
});

// Conflict
engine.logInteraction('designer-1', 'Lee Sora', {
  type: 'conflict',
  intensity: 0.7,
  timestamp: Date.now(),
  description: 'Disagreed on UI component API design',
});

// Explicit structural relationship (after a hire event)
engine.setRelationshipType('new-intern', '정인턴', 'mentee', {
  targetRole: 'Intern',
  targetInfluenceScore: 5,
});
```

### Relationship graph for UI rendering

```ts
const graph = engine.getEgoGraph();
// graph.nodes — includes isCentral=true for the persona itself
// graph.edges — sourceId always = persona id
// graph.stats — mostTrustedId, closestAllyId, biggestRivalId, etc.

// Pass to vis.js / cytoscape / d3 / your own renderer
renderGraph(graph.nodes, graph.edges);
```

### Game events → emotion

```ts
engine.applyGameEvent({ type: 'praised',         intensity: 0.9 });
engine.applyGameEvent({ type: 'deadline_missed', intensity: 0.7 });
engine.applyGameEvent({ type: 'promoted',        intensity: 1.0 });
engine.applyGameEvent({ type: 'custom', intensity: 0.6, customValenceDelta: -0.3, description: 'Got rejected at hackathon demo' });
```

### Time simulation

```ts
// Advance 8 in-game hours of work
engine.advanceTime(8, false);

// Advance 6 in-game hours of rest (sleep / weekend)
engine.advanceTime(6, true);

// Start a new game day / week
engine.startNewDay();
engine.startNewWeek();
```

### Events

```ts
engine.on('emotion:changed',      (state) => ui.updateMoodIndicator(state.mood));
engine.on('fatigue:changed',      (state) => ui.updateEnergyBar(state.energy));
engine.on('engagement:decided',   (d)     => console.log(d.action, d.reasoning));
engine.on('relationship:updated', (edge)  => updateGraphNode(edge));
engine.on('memory:added',         (mem)   => console.log('Memory:', mem.content));
engine.on('response:generated',   ({ response }) => console.log(response));
```

---

## Social Influence system

Instead of hardcoded job titles, Plasma uses a **0–100 influence score** that scales all authority/deference modifiers via power-law curves:

```ts
import { INFLUENCE_PRESETS, fromPreset, deriveModifiers } from 'plasma-engine';

// Use built-in presets for common domains
INFLUENCE_PRESETS.intern        // 5
INFLUENCE_PRESETS.senior        // 58
INFLUENCE_PRESETS.team_manager  // 80
INFLUENCE_PRESETS.ceo_founder   // 99

// Academic
INFLUENCE_PRESETS.student       // 10
INFLUENCE_PRESETS.professor     // 75

// Build a SocialInfluence object
const jisu = fromPreset('senior', '과장');
// → { score: 58, label: '과장' }

// Inspect what the score means behaviourally
const mods = deriveModifiers(58);
// mods.decisionAuthority      ≈ 0.52
// mods.deferenceToHigher      ≈ 0.44
// mods.leadershipPresence     ≈ 0.48
// mods.maxEffectiveHoursPerDay ≈ 11.5
```

Set your own domain-specific scores — the engine only cares about the number:

```ts
// Fantasy RPG
{ id: 'guild-master', influenceScore: 92, influenceLabel: 'Guild Master' }
{ id: 'new-recruit',  influenceScore: 8,  influenceLabel: 'Recruit'      }
```

---

## Relationship Graph

Every `PlasmaEngine` maintains an **ego-centric directed graph**. The edges represent this persona's subjective view of others — trust, rapport, respect, tension, familiarity.

### Edge metrics

| Metric | Range | Meaning |
|--------|-------|---------|
| `trust` | 0–1 | Reliability and honesty |
| `rapport` | 0–1 | Warmth and social comfort |
| `respect` | 0–1 | Admiration of competence/character |
| `tension` | 0–1 | Conflict and friction |
| `familiarity` | 0–1 | How well they know each other |

### Interaction types (affects edge metrics)

| Type | Effect |
|------|--------|
| `message` / `direct_message` | Small boost to rapport + familiarity |
| `collaborated` / `pair_work` | Significant trust + rapport gain |
| `helped` | Strong trust boost |
| `conflict` | Trust/rapport drop, tension spike |
| `resolved_conflict` | Strong tension reduction |
| `praised` / `criticized` | Trust +/- |
| `mentored` | Trust + rapport + respect gain |
| `hired` / `fired` | Large trust +/- |
| `social` | Rapport boost |
| `custom` | Use `customTrustDelta` / `customRapportDelta` / `customTensionDelta` |

### Auto-derived relationship type

The graph automatically classifies relationships based on metrics:

| Type | Condition |
|------|-----------|
| `close_friend` | trust > 0.78 AND rapport > 0.75 |
| `friend` | trust > 0.58 AND rapport > 0.55 |
| `colleague` | familiarity > 0.35 |
| `rival` | tension > 0.6 AND rapport < 0.3 |
| `acquaintance` | interactionCount ≥ 2 |
| `stranger` | interactionCount < 2 |

Override with `setRelationshipType()` for structural roles (`superior`, `mentor`, `report`, etc.).

---

## API reference

### `PlasmaEngine`

| Method | Description |
|--------|-------------|
| `routeMessage(msg)` | Feed a message → returns `EngagementDecision` |
| `respond(msg, opts?)` | Generate and record a response string |
| `logInteraction(targetId, name, event)` | Record non-messenger interaction |
| `setRelationshipType(id, name, type, meta?)` | Set explicit relationship classification |
| `getEgoGraph()` | Export graph for UI rendering |
| `applyGameEvent(event)` | Trigger emotional/memory update |
| `advanceTime(hours, isResting?)` | Simulate passage of game time |
| `startNewDay()` / `startNewWeek()` | Reset time accumulators |
| `registerTool(tool, handler)` | Add a game-world tool |
| `remember(content, importance, type?, tags?)` | Manually add a memory |
| `recallRelevant(query, limit?)` | Retrieve relevant memories |
| `getState()` | Snapshot of current engine state |
| `serialize()` | Full serialisable state for save/load |
| `.on(event, handler)` | Subscribe to engine events |

### `EngagementDecision`

```ts
{
  action: 'MUST_RESPOND' | 'SHOULD_RESPOND' | 'CAN_RESPOND' | 'SKIP';
  score: {
    relevance: number;        // topic relevance to skills
    social: number;           // mood-adjusted social inclination
    energy: number;           // fatigue-adjusted energy
    relationship: number;     // trust + rapport with sender
    addressContext: number;   // DM/mention vs group noise
    urgency: number;          // keyword-based urgency
    influenceModifier: number; // authority differential multiplier
    total: number;            // final weighted score
  };
  shouldDelay: boolean;
  delayMs: number;            // realistic typing delay
  reasoning: string;
}
```

### Game event types

`task_completed` · `task_failed` · `praised` · `criticized` · `promoted` · `demoted` · `deadline_missed` · `conflict` · `resolved_conflict` · `overtime_forced` · `bonus_received` · `team_success` · `team_failure` · `mentored` · `learned_skill` · `custom`

---

## Save / load

```ts
// Save
const saved = engine.serialize();
localStorage.setItem('persona-dev-jisu', JSON.stringify(saved));

// Load — restore from saved state
// (currently requires manual restoration of emotion/fatigue/memory/relationships)
// Full restore API planned for v0.3
```

---

## Running tests

```bash
npm install
npm test
```

Coverage: `EmotionCore`, `FatigueCore`, `MemoryCore`, `RelationshipGraph`, `RankSystem`, `MessageRouter`.

---

## Notes for AI agents using this library

- **One engine = one persona.** Create one `PlasmaEngine` per NPC/employee.
- **`routeMessage()` before `respond()`** — routeMessage records the message in conversation history. Skipping it means the history will be incomplete.
- **`logInteraction()` is how relationships grow.** Without it, only messenger chat influences the graph.
- **Influence scores are just numbers.** Do not rely on any specific preset name — always use `INFLUENCE_PRESETS.xxx` or `fromPreset()` rather than hardcoding values.
- **Tools are stubs by default.** Call `registerTool()` with real handlers before the engine processes messages; otherwise all tool calls return empty/mock data.
- **`advanceTime()` must be called** or emotion/fatigue/memory never change passively. Wire it to your game clock.
- **Serialise with `serialize()`** and store to disk. The engine has no persistence of its own.
