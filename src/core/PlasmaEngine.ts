import { v4 as uuidv4 } from 'uuid';
import {
  ConversationContext,
  EngagementDecision,
  FatigueConfig,
  GameEvent,
  LLMConfig,
  MCPTool,
  MemoryConfig,
  MemoryType,
  Message,
  PersonaDefinition,
  PlasmaConfig,
  PlasmaEventMap,
  PlasmaState,
  ToolHandler,
} from '../types';
import {
  InteractionEvent,
  RelationshipType,
  EgoGraph,
} from '../graph/RelationshipGraph';
import { TypedEventEmitter } from '../utils/EventEmitter';
import { Logger, LogLevel } from '../utils/Logger';
import { PersonaCore } from './PersonaCore';
import { EmotionCore } from './EmotionCore';
import { FatigueCore } from './FatigueCore';
import { MemoryCore } from './MemoryCore';
import { MessageRouter } from '../communication/MessageRouter';
import { ConversationManager } from '../communication/ConversationManager';
import { ResponseGenerator } from '../communication/ResponseGenerator';
import { MCPClient } from '../mcp/MCPClient';
import { LLMProvider } from '../llm/LLMProvider';
import { OpenAIProvider } from '../llm/OpenAIProvider';
import { AnthropicProvider } from '../llm/AnthropicProvider';
import { PromptBuilder } from '../llm/PromptBuilder';

function createLLMProvider(cfg: LLMConfig): LLMProvider {
  if (cfg.provider === 'openai') return new OpenAIProvider(cfg);
  if (cfg.provider === 'anthropic') return new AnthropicProvider(cfg);
  throw new Error(`Unknown LLM provider: "${cfg.provider}"`);
}

/**
 * PlasmaEngine — the top-level AI persona runtime.
 *
 * One instance = one simulated person.
 * The game engine creates one PlasmaEngine per employee/NPC.
 *
 * ## Quick start
 * ```ts
 * const engine = new PlasmaEngine(config);
 *
 * // Wire up game-world tools
 * engine.registerTool(myTool, async (args) => gameWorld.execute(args));
 *
 * // Feed messages from the game messenger
 * const decision = engine.routeMessage(message);
 * if (decision.action !== 'SKIP') {
 *   setTimeout(async () => {
 *     const reply = await engine.respond(message);
 *     ui.sendMessage(engine.persona.id, reply);
 *   }, decision.delayMs);
 * }
 *
 * // Record non-messenger interactions (affects relationship graph)
 * engine.logInteraction('dev2', 'Dev2', {
 *   type: 'collaborated', intensity: 0.8, timestamp: Date.now()
 * });
 *
 * // Get ego-graph for UI rendering
 * const graph = engine.getEgoGraph();
 * ```
 */
export class PlasmaEngine extends TypedEventEmitter<PlasmaEventMap> {
  readonly persona: PersonaCore;
  private readonly emotion: EmotionCore;
  private readonly fatigue: FatigueCore;
  private readonly memory: MemoryCore;
  private readonly router: MessageRouter;
  private readonly conversations: ConversationManager;
  private readonly responder: ResponseGenerator;
  private readonly mcp: MCPClient;
  private readonly log: Logger;

  constructor(config: PlasmaConfig) {
    super();
    const debug = config.debug ?? false;
    this.log = new Logger(config.persona.name, debug ? LogLevel.DEBUG : LogLevel.INFO);

    this.persona      = new PersonaCore(config.persona);
    this.emotion      = new EmotionCore();
    this.fatigue      = new FatigueCore(config.fatigue);
    this.memory       = new MemoryCore(config.memory);
    this.router       = new MessageRouter(this.persona, this.emotion, this.fatigue);
    this.conversations = new ConversationManager();
    this.mcp          = new MCPClient(debug);
    this.mcp.registerStubs();

    const llm = createLLMProvider(config.llm);
    const promptBuilder = new PromptBuilder(
      this.persona, this.emotion, this.fatigue, this.memory
    );
    this.responder = new ResponseGenerator(llm, promptBuilder, this.mcp, debug);

    this.log.info(
      `Persona ready: ${this.persona.name} (${this.persona.role}, influence ${this.persona.influence.score})`
    );
  }

  // ─── Message routing ──────────────────────────────────────────────────────

  /**
   * Feed an incoming message to the engine.
   * Records it in conversation history and returns an engagement decision.
   * Call this for EVERY message in the game messenger, not just ones directed at this persona.
   */
  routeMessage(message: Message): EngagementDecision {
    const conv = this.conversations.addMessage(message);

    if (message.senderId !== this.persona.id) {
      this.persona.graph.recordInteraction(message.senderId, message.senderName, {
        type: message.isDirectMessage ? 'direct_message' : 'message',
        intensity: 0.2,
        timestamp: message.timestamp,
      });
    }

    if (this.conversations.isPlasmaResponding(message.conversationId, this.persona.id)) {
      const decision: EngagementDecision = {
        action: 'SKIP',
        score: { relevance: 0, social: 0, energy: 0, relationship: 0, addressContext: 0, urgency: 0, influenceModifier: 1, total: 0 },
        shouldDelay: false,
        delayMs: 0,
        reasoning: 'Already generating a response',
      };
      this.emit('engagement:decided', decision);
      return decision;
    }

    const endCheck = this.conversations.shouldEndConversation(message.conversationId);
    if (endCheck.shouldEnd) {
      const decision: EngagementDecision = {
        action: 'SKIP',
        score: { relevance: 0, social: 0, energy: 0, relationship: 0, addressContext: 0, urgency: 0, influenceModifier: 1, total: 0 },
        shouldDelay: false,
        delayMs: 0,
        reasoning: endCheck.reason,
      };
      this.emit('engagement:decided', decision);
      return decision;
    }

    if (this.conversations.hasOtherPlasmaResponding(message.conversationId, this.persona.id)) {
      const decision = this.router.decide(message, conv);
      if (decision.action === 'CAN_RESPOND' || decision.action === 'SHOULD_RESPOND') {
        decision.action = 'SKIP';
        decision.reasoning = 'Another plasma is already responding';
      }
      this.emit('engagement:decided', decision);
      return decision;
    }

    const decision = this.router.decide(message, conv);
    this.emit('engagement:decided', decision);
    this.log.debug(`Route: ${decision.action} (${decision.score.total.toFixed(2)}) for msg from ${message.senderName}`);
    return decision;
  }

  // ─── Response generation ──────────────────────────────────────────────────

  /**
   * Generate a response to a specific message.
   * The message should have been ingested via routeMessage() first.
   */
  async respond(
    message: Message,
    options: { extraInstructions?: string } = {}
  ): Promise<string> {
    let conv = this.conversations.getConversation(message.conversationId);
    if (!conv) conv = this.conversations.addMessage(message);

    if (this.conversations.isPlasmaResponding(message.conversationId, this.persona.id)) {
      this.log.debug('Already responding — skipping duplicate');
      return '';
    }

    const endCheck = this.conversations.shouldEndConversation(message.conversationId);
    if (endCheck.shouldEnd) {
      this.log.debug(`Conversation ended: ${endCheck.reason}`);
      this.conversations.endConversation(message.conversationId);
      return '';
    }

    this.conversations.markResponding(message.conversationId, this.persona.id);
    try {
      return await this.generateAndRecord(message, conv, options);
    } finally {
      this.conversations.markResponseDone(message.conversationId, this.persona.id);
    }
  }

  private async generateAndRecord(
    message: Message,
    conv: ConversationContext,
    options: { extraInstructions?: string }
  ): Promise<string> {
    const result = await this.responder.generate(message, conv, options);

    // Record persona's outgoing message
    const outgoing: Message = {
      id: uuidv4(),
      conversationId: message.conversationId,
      senderId: this.persona.id,
      senderName: this.persona.name,
      content: result.response,
      timestamp: Date.now(),
      mentions: [],
      isDirectMessage: message.isDirectMessage,
    };
    this.conversations.addMessage(outgoing);

    // Responding costs energy
    const hours = Math.max(0.05, result.totalTokensUsed / 2000);
    this.emit('fatigue:changed', this.fatigue.work(hours));

    // Tool uses → memory
    for (const tr of result.toolResultLog) {
      if (!tr.isError) {
        this.memory.add({
          type: 'semantic',
          content: `Used tool "${tr.toolName}": ${JSON.stringify(tr.result).slice(0, 180)}`,
          importance: 0.3,
          tags: ['tool_use', tr.toolName],
        });
      }
    }

    this.emit('response:generated', {
      conversationId: message.conversationId,
      response: result.response,
    });
    return result.response;
  }

  // ─── Relationship graph ───────────────────────────────────────────────────

  /**
   * Record a non-messenger interaction (pair work, conflict, mentoring, etc.)
   * This is how the relationship graph grows beyond chat history.
   */
  logInteraction(
    targetId: string,
    targetName: string,
    event: Omit<InteractionEvent, 'id'> & { id?: string }
  ): void {
    const edge = this.persona.recordInteraction(targetId, targetName, event);
    this.emit('relationship:updated', edge);

    // Significant interactions leave a memory trace
    if (event.intensity >= 0.5) {
      const desc = event.description
        ?? `${event.type.replace(/_/g, ' ')} with ${targetName} (intensity ${event.intensity.toFixed(1)})`;
      const mem = this.memory.add({
        type: 'episodic',
        content: desc,
        importance: event.intensity * 0.7,
        emotionalWeight: edge.trust - 0.5,
        associatedPersonas: [targetId],
        tags: [event.type, targetId],
      });
      this.emit('memory:added', mem);
    }
  }

  /**
   * Explicitly set the relationship type (e.g. after a hire or promotion).
   * Use for structural roles that cannot be inferred from interaction counts.
   */
  setRelationshipType(
    targetId: string,
    targetName: string,
    type: RelationshipType,
    meta?: { targetRole?: string; targetInfluenceScore?: number }
  ): void {
    this.persona.setRelationshipType(targetId, targetName, type, meta);
  }

  /**
   * Export the ego-centric relationship graph.
   * Pass this to your UI graph renderer (vis.js, cytoscape, d3, etc.)
   */
  getEgoGraph(): EgoGraph {
    return this.persona.graph.toEgoGraph(
      this.persona.id,
      this.persona.name,
      this.persona.role
    );
  }

  // ─── Game event handling ──────────────────────────────────────────────────

  /**
   * Notify the persona about a significant game event.
   * Updates emotional state and optionally records a memory.
   */
  applyGameEvent(event: GameEvent): void {
    const newEmotion = this.emotion.applyEvent(event);
    this.emit('emotion:changed', newEmotion);

    if (event.intensity > 0.3) {
      const desc = event.description
        ?? `${event.type.replace(/_/g, ' ')} (intensity ${event.intensity.toFixed(2)})`;
      const mem = this.memory.add({
        type: 'emotional',
        content: desc,
        importance: event.intensity,
        emotionalWeight: newEmotion.valence,
        associatedPersonas: event.sourcePersonaId ? [event.sourcePersonaId] : [],
        tags: [event.type],
      });
      this.emit('memory:added', mem);
    }
  }

  // ─── Time simulation ──────────────────────────────────────────────────────

  /**
   * Advance simulated game time.
   * @param gameHours  Simulated hours that have passed
   * @param isResting  Whether the persona was resting during this period
   */
  advanceTime(gameHours: number, isResting = false): void {
    if (gameHours <= 0) return;
    const newFatigue = isResting
      ? this.fatigue.rest(gameHours)
      : this.fatigue.work(gameHours);
    this.emit('fatigue:changed', newFatigue);
    this.emotion.decayTowardNeutral(gameHours);
    this.memory.decay(gameHours);
    this.persona.graph.decay(gameHours);
  }

  startNewDay(): void  { this.fatigue.newDay(); }
  startNewWeek(): void { this.fatigue.newWeek(); }

  // ─── Memory ───────────────────────────────────────────────────────────────

  remember(
    content: string,
    importance: number,
    type: MemoryType = 'semantic',
    tags: string[] = []
  ): void {
    const mem = this.memory.add({ type, content, importance, tags });
    this.emit('memory:added', mem);
  }

  recallRelevant(query: string, limit = 5) {
    return this.memory.retrieve(query, limit);
  }

  // ─── Tool registration ────────────────────────────────────────────────────

  registerTool(tool: MCPTool, handler: ToolHandler): void {
    this.mcp.register(tool, handler);
  }

  unregisterTool(name: string): void {
    this.mcp.unregister(name);
  }

  listTools(): MCPTool[] {
    return this.mcp.listTools();
  }

  // ─── State ────────────────────────────────────────────────────────────────

  getState(): PlasmaState {
    return {
      personaId:           this.persona.id,
      emotion:             this.emotion.current,
      fatigue:             this.fatigue.current,
      memoryCount:         this.memory.getAll().length,
      activeConversations: this.conversations.getActiveConversations().length,
      influenceScore:      this.persona.influence.score,
      relationshipCount:   this.persona.graph.getAllEdges().length,
    };
  }

  serialize(): SerializedPlasmaState {
    return {
      personaId:     this.persona.id,
      emotion:       this.emotion.current,
      fatigue:       this.fatigue.current,
      memories:      this.memory.getAll(),
      relationships: this.persona.graph.toJSON(),
    };
  }
}

// ─── Serialised state ─────────────────────────────────────────────────────────

export interface SerializedPlasmaState {
  personaId: string;
  emotion:   import('../types').EmotionState;
  fatigue:   import('../types').FatigueState;
  memories:  import('../types').MemoryEntry[];
  relationships: import('../graph/RelationshipGraph').RelationshipEdge[];
}
