// ─── LLM ─────────────────────────────────────────────────────────────────────

export type LLMProviderType = 'openai' | 'anthropic';

export interface LLMConfig {
  provider: LLMProviderType;
  apiKey: string;
  /** Defaults to a recommended model per provider */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  baseURL?: string;
  dangerouslyAllowBrowser?: boolean;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

// ─── PERSONA ──────────────────────────────────────────────────────────────────

export type SkillLevel = 'novice' | 'intermediate' | 'advanced' | 'expert';

/** Big-Five + Ambition personality model */
export interface PersonalityMatrix {
  /** Creativity, curiosity, openness to new ideas (0–1) */
  openness: number;
  /** Organisation, dependability, goal-directedness (0–1) */
  conscientiousness: number;
  /** Social energy, talkativeness, assertiveness (0–1) */
  extraversion: number;
  /** Cooperativeness, empathy, trust (0–1) */
  agreeableness: number;
  /** Emotional instability, anxiety tendency (0–1) */
  neuroticism: number;
  /** Drive, ambition, desire for achievement (0–1) */
  ambition: number;
}

export interface Skill {
  name: string;
  level: SkillLevel;
  /** e.g. 'frontend', 'design', 'backend', 'marketing' */
  domain: string;
}

export interface CommunicationStyle {
  /** 0 = casual, 1 = very formal */
  formality: number;
  /** 0 = very brief, 1 = verbose */
  verbosity: number;
  /** 0 = diplomatic, 1 = blunt */
  directness: number;
  /** 0 = serious, 1 = frequently humorous */
  humor: number;
  /** BCP-47 tag e.g. 'en', 'ko' */
  language?: string;
}

/**
 * Seed data for the RelationshipGraph.
 * Richer runtime state lives in RelationshipGraph; this is the initial snapshot.
 */
export interface RelationshipEntry {
  personaId: string;
  name: string;
  role?: string;
  trust: number;    // 0–1
  rapport: number;  // 0–1
  /** Optional structural override (e.g. 'superior', 'mentor') */
  explicitType?: import('../graph/RelationshipGraph').RelationshipType;
  /** Target's social influence score (0–100) */
  influenceScore?: number;
}

export interface PersonaDefinition {
  id: string;
  name: string;
  /** Job title / role in the company */
  role: string;
  personality: PersonalityMatrix;
  /** Short backstory / bio */
  background: string;
  skills: Skill[];
  communicationStyle: CommunicationStyle;
  /** Seed relationships — loaded into RelationshipGraph on startup */
  relationships: RelationshipEntry[];
  /** Core personal values e.g. ['quality', 'autonomy'] */
  values: string[];
  /**
   * Social influence score (0–100).
   * Use INFLUENCE_PRESETS from RankSystem for convenience.
   * Affects engagement patterns, deference, communication tone.
   */
  influenceScore?: number;
  /** Optional human-readable label for the influence level (e.g. '시니어', 'Lead') */
  influenceLabel?: string;
}

// ─── EMOTION ──────────────────────────────────────────────────────────────────

export type MoodType =
  | 'elated'
  | 'happy'
  | 'content'
  | 'neutral'
  | 'uneasy'
  | 'stressed'
  | 'anxious'
  | 'frustrated'
  | 'sad'
  | 'angry'
  | 'burned_out';

export interface EmotionState {
  mood: MoodType;
  /** Overall positivity/negativity (-1 to +1) */
  valence: number;
  /** Activation: calm (0) → excited (1) */
  arousal: number;
  stressLevel: number;   // 0–1
  confidence: number;    // 0–1
  motivation: number;    // 0–1
  /** Unix ms */
  lastUpdated: number;
}

export type GameEventType =
  | 'task_completed'
  | 'task_failed'
  | 'praised'
  | 'criticized'
  | 'promoted'
  | 'demoted'
  | 'deadline_missed'
  | 'conflict'
  | 'resolved_conflict'
  | 'overtime_forced'
  | 'bonus_received'
  | 'team_success'
  | 'team_failure'
  | 'mentored'
  | 'learned_skill'
  | 'custom';

export interface GameEvent {
  type: GameEventType;
  /** Intensity 0–1 */
  intensity: number;
  description?: string;
  sourcePersonaId?: string;
  customValenceDelta?: number;
}

// ─── FATIGUE ──────────────────────────────────────────────────────────────────

export interface FatigueState {
  /** Physical + mental energy (0–100, 100 = fully rested) */
  energy: number;
  /** Accumulated cognitive load (0–100) */
  mentalFatigue: number;
  /** Long-term depletion risk (0–1) */
  burnoutRisk: number;
  workHoursToday: number;
  workHoursThisWeek: number;
  /** Unix ms */
  lastRestTimestamp: number;
}

export interface FatigueConfig {
  maxDailyHours: number;
  recoveryRatePerHour: number;
  fatiguePenaltyPerHour: number;
  energyCostPerHour: number;
}

// ─── MEMORY ───────────────────────────────────────────────────────────────────

export type MemoryType = 'episodic' | 'semantic' | 'emotional';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  importance: number;         // 0–1
  /** Emotional valence of this memory (-1 to +1) */
  emotionalWeight: number;
  /** Unix ms */
  timestamp: number;
  associatedPersonas: string[];
  tags: string[];
  accessCount: number;
}

export interface MemoryConfig {
  maxEntries: number;
  decayRatePerHour: number;
  maxContextTokens: number;
}

// ─── MESSAGING ────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  /** Unix ms */
  timestamp: number;
  /** Persona IDs explicitly @mentioned */
  mentions: string[];
  isDirectMessage: boolean;
  /** Sender's influence score (0–100) — helps MessageRouter adjust engagement */
  senderInfluenceScore?: number;
  metadata?: Record<string, unknown>;
}

export interface ConversationContext {
  id: string;
  participants: string[];
  topic?: string;
  messages: Message[];
  startedAt: number;
  lastActivityAt: number;
  isGroupChat: boolean;
  /** Tracks which plasma instances are currently generating a response */
  respondingPlasmaIds: string[];
  /** Timestamp of last plasma response, used for conversation ending detection */
  lastPlasmaResponseAt?: number;
}

// ─── ENGAGEMENT DECISION ─────────────────────────────────────────────────────

export type EngagementAction =
  | 'MUST_RESPOND'    // directly addressed — must reply
  | 'SHOULD_RESPOND'  // relevant — should reply
  | 'CAN_RESPOND'     // optional — may chime in
  | 'SKIP';           // ignore

export interface EngagementScore {
  /** Topic relevance to this persona's role/skills */
  relevance: number;
  /** Social inclination (personality × mood) */
  social: number;
  /** Available energy to engage */
  energy: number;
  /** Closeness/trust with the sender */
  relationship: number;
  /** Directness of address (DM / @mention vs group noise) */
  addressContext: number;
  /** Estimated urgency */
  urgency: number;
  /** Social influence differential modifier */
  influenceModifier: number;
  /** Final weighted total */
  total: number;
}

export interface EngagementDecision {
  action: EngagementAction;
  score: EngagementScore;
  shouldDelay: boolean;
  delayMs: number;
  reasoning: string;
}

// ─── MCP / TOOLS ──────────────────────────────────────────────────────────────

export interface ToolParameterSchema {
  type: string;
  description: string;
  enum?: string[];
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, ToolParameterSchema>;
    required?: string[];
  };
}

export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<unknown> | unknown;

export interface ToolResult {
  toolName: string;
  result: unknown;
  isError: boolean;
  errorMessage?: string;
}

// ─── PLASMA ENGINE ────────────────────────────────────────────────────────────

export interface PlasmaConfig {
  persona: PersonaDefinition;
  llm: LLMConfig;
  memory?: Partial<MemoryConfig>;
  fatigue?: Partial<FatigueConfig>;
  debug?: boolean;
}

export interface PlasmaState {
  personaId: string;
  emotion: EmotionState;
  fatigue: FatigueState;
  memoryCount: number;
  activeConversations: number;
  influenceScore: number;
  relationshipCount: number;
}

export type PlasmaEventMap = {
  'emotion:changed': EmotionState;
  'fatigue:changed': FatigueState;
  'memory:added': MemoryEntry;
  'engagement:decided': EngagementDecision;
  'response:generated': { conversationId: string; response: string };
  'tool:called': { name: string; args: Record<string, unknown> };
  'tool:result': ToolResult;
  'relationship:updated': import('../graph/RelationshipGraph').RelationshipEdge;
  error: Error;
};
