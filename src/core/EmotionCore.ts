import { EmotionState, GameEvent, GameEventType, MoodType } from '../types';

// How each event type shifts valence and arousal
const EVENT_DELTAS: Record<
  GameEventType,
  { valence: number; arousal: number; stress: number; confidence: number; motivation: number }
> = {
  task_completed:     { valence:  0.15, arousal:  0.05, stress: -0.10, confidence:  0.10, motivation:  0.10 },
  task_failed:        { valence: -0.20, arousal: -0.05, stress:  0.20, confidence: -0.15, motivation: -0.10 },
  praised:            { valence:  0.20, arousal:  0.10, stress: -0.10, confidence:  0.15, motivation:  0.15 },
  criticized:         { valence: -0.15, arousal:  0.05, stress:  0.15, confidence: -0.10, motivation: -0.05 },
  promoted:           { valence:  0.30, arousal:  0.20, stress: -0.10, confidence:  0.25, motivation:  0.30 },
  demoted:            { valence: -0.30, arousal:  0.15, stress:  0.25, confidence: -0.25, motivation: -0.25 },
  deadline_missed:    { valence: -0.25, arousal:  0.10, stress:  0.30, confidence: -0.20, motivation: -0.15 },
  conflict:           { valence: -0.20, arousal:  0.20, stress:  0.25, confidence: -0.05, motivation: -0.10 },
  resolved_conflict:  { valence:  0.15, arousal: -0.10, stress: -0.20, confidence:  0.10, motivation:  0.10 },
  overtime_forced:    { valence: -0.10, arousal: -0.05, stress:  0.20, confidence:  0.00, motivation: -0.15 },
  bonus_received:     { valence:  0.25, arousal:  0.15, stress: -0.10, confidence:  0.10, motivation:  0.20 },
  team_success:       { valence:  0.20, arousal:  0.10, stress: -0.10, confidence:  0.10, motivation:  0.15 },
  team_failure:       { valence: -0.15, arousal:  0.00, stress:  0.15, confidence: -0.10, motivation: -0.10 },
  mentored:           { valence:  0.10, arousal:  0.05, stress: -0.05, confidence:  0.10, motivation:  0.10 },
  learned_skill:      { valence:  0.15, arousal:  0.10, stress: -0.05, confidence:  0.15, motivation:  0.15 },
  custom:             { valence:  0.00, arousal:  0.00, stress:  0.00, confidence:  0.00, motivation:  0.00 },
};

/** Natural drift toward neutral per game-hour */
const DECAY_RATE = 0.05;

function clamp(v: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

function deriveMood(valence: number, arousal: number, stress: number): MoodType {
  if (valence > 0.5 && arousal > 0.5) return 'elated';
  if (valence > 0.3) return 'happy';
  if (valence > 0.05) return 'content';
  if (stress > 0.75) return 'burned_out';
  if (stress > 0.55) return 'stressed';
  if (valence < -0.5 && arousal > 0.4) return 'angry';
  if (valence < -0.4) return 'frustrated';
  if (valence < -0.2 && arousal < 0.3) return 'sad';
  if (arousal > 0.6 && valence < 0) return 'anxious';
  if (valence < -0.05) return 'uneasy';
  return 'neutral';
}

export class EmotionCore {
  private state: EmotionState;

  constructor(initial?: Partial<EmotionState>) {
    this.state = {
      mood: 'neutral',
      valence: 0,
      arousal: 0.4,
      stressLevel: 0.2,
      confidence: 0.6,
      motivation: 0.7,
      lastUpdated: Date.now(),
      ...initial,
    };
    this.state.mood = deriveMood(
      this.state.valence,
      this.state.arousal,
      this.state.stressLevel
    );
  }

  get current(): EmotionState {
    return { ...this.state };
  }

  // ─── Apply a game event ───────────────────────────────────────────────────

  applyEvent(event: GameEvent): EmotionState {
    const deltas = EVENT_DELTAS[event.type];
    const scale = event.intensity;

    const valenceDelta =
      event.type === 'custom' && event.customValenceDelta !== undefined
        ? event.customValenceDelta * scale
        : deltas.valence * scale;

    this.state.valence    = clamp(this.state.valence    + valenceDelta);
    this.state.arousal    = clamp01(this.state.arousal    + deltas.arousal    * scale);
    this.state.stressLevel = clamp01(this.state.stressLevel + deltas.stress    * scale);
    this.state.confidence  = clamp01(this.state.confidence  + deltas.confidence * scale);
    this.state.motivation  = clamp01(this.state.motivation  + deltas.motivation * scale);
    this.state.mood       = deriveMood(this.state.valence, this.state.arousal, this.state.stressLevel);
    this.state.lastUpdated = Date.now();
    return { ...this.state };
  }

  /**
   * Passive drift toward neutral over simulated game time.
   * Call when the game clock advances.
   */
  decayTowardNeutral(gameHours: number): void {
    const factor = 1 - Math.min(DECAY_RATE * gameHours, 0.9);
    this.state.valence     = this.state.valence * factor;
    this.state.arousal     = clamp01(this.state.arousal * factor + 0.4 * (1 - factor));
    this.state.stressLevel = clamp01(this.state.stressLevel * factor);
    this.state.mood        = deriveMood(this.state.valence, this.state.arousal, this.state.stressLevel);
    this.state.lastUpdated = Date.now();
  }

  // ─── Modifiers for other systems ─────────────────────────────────────────

  /** -1 to +1 modifier for response quality / helpfulness */
  getMoodQualityModifier(): number {
    return this.state.valence * 0.5 + (1 - this.state.stressLevel) * 0.5 - 0.25;
  }

  /** 0–1 willingness to engage socially */
  getSocialModifier(): number {
    return clamp01(
      0.5 +
        this.state.valence * 0.25 +
        this.state.motivation * 0.25 -
        this.state.stressLevel * 0.2
    );
  }

  // ─── Human-readable summary for prompts ──────────────────────────────────

  toPromptSummary(): string {
    const mood = this.state.mood.replace(/_/g, ' ');
    const stress =
      this.state.stressLevel > 0.7
        ? 'very stressed'
        : this.state.stressLevel > 0.4
        ? 'somewhat stressed'
        : 'relatively calm';
    const confidence =
      this.state.confidence > 0.7
        ? 'confident'
        : this.state.confidence < 0.35
        ? 'insecure'
        : 'moderately confident';
    const motivation =
      this.state.motivation > 0.7
        ? 'highly motivated'
        : this.state.motivation < 0.35
        ? 'unmotivated'
        : 'moderately motivated';
    return `Mood: ${mood}. Feeling ${stress}, ${confidence}, and ${motivation}.`;
  }
}
