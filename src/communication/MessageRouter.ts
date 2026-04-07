import {
  ConversationContext,
  EngagementAction,
  EngagementDecision,
  EngagementScore,
  Message,
} from '../types';
import { EmotionCore } from '../core/EmotionCore';
import { FatigueCore } from '../core/FatigueCore';
import { PersonaCore } from '../core/PersonaCore';
import { getInfluenceEngagementMultiplier } from '../rank/RankSystem';

// ─── Urgency heuristic ─────────────────────────────────────────────────────────

const URGENCY_KEYWORDS = [
  'urgent', 'asap', 'immediately', 'critical', 'help', 'broken', 'down',
  'bug', 'crash', 'deadline', 'blocked', 'emergency', 'fire', 'hotfix',
  '긴급', '빨리', '도움', '버그', '에러', '크래시', '마감', '막힘', '장애',
];

function estimateUrgency(content: string): number {
  const lower = content.toLowerCase();
  let hits = 0;
  for (const kw of URGENCY_KEYWORDS) {
    if (lower.includes(kw)) hits++;
  }
  return Math.min(hits * 0.22, 1);
}

// ─── Topic relevance ──────────────────────────────────────────────────────────

function estimateTopicRelevance(message: Message, persona: PersonaCore): number {
  const lower = message.content.toLowerCase();
  let best = 0;
  for (const skill of persona.skills) {
    const keywords = [skill.domain, skill.name, ...skill.domain.split(/[\s,]+/)];
    for (const kw of keywords) {
      if (kw.length > 2 && lower.includes(kw.toLowerCase())) {
        const score = persona.getSkillScore(skill.domain);
        if (score > best) best = score;
      }
    }
  }
  const roleWords = persona.role.toLowerCase().split(/\s+/);
  for (const rw of roleWords) {
    if (rw.length > 2 && lower.includes(rw)) {
      best = Math.max(best, 0.5);
    }
  }
  return best;
}

// ─── MessageRouter ─────────────────────────────────────────────────────────────

/**
 * Decides whether and how a persona should engage with an incoming message.
 *
 * Scoring weights:
 *   relevance        0.24 — is this my area?
 *   energy           0.19 — do I have bandwidth?
 *   addressContext   0.20 — was I directly addressed?
 *   social           0.14 — am I in the mood to engage?
 *   relationship     0.12 — do I know/trust this person?
 *   urgency          0.07 — is it time-sensitive?
 *   influenceModifier 0.04 — social authority differential
 *
 * Then multiplied by an extraversion amplifier (personality).
 */
export class MessageRouter {
  constructor(
    private readonly persona: PersonaCore,
    private readonly emotion: EmotionCore,
    private readonly fatigue: FatigueCore
  ) {}

  decide(
    message: Message,
    conversation: ConversationContext
  ): EngagementDecision {
    const personaId = this.persona.id;

    const isDirect    = message.isDirectMessage;
    const isMentioned = message.mentions.includes(personaId);
    const isSelf      = message.senderId === personaId;

    if (isSelf) {
      return makeSkip(zeroScore(), 'Message is from self');
    }

    // ── Component scores ────────────────────────────────────────────────────
    const relevance = estimateTopicRelevance(message, this.persona);
    const social    = this.emotion.getSocialModifier();
    const energy    = this.fatigue.getWorkWillingnessModifier();
    const urgency   = estimateUrgency(message.content);

    const edge = this.persona.getRelationship(message.senderId);
    const relationship = edge
      ? edge.trust * 0.55 + edge.rapport * 0.30 + edge.familiarity * 0.15
      : 0.30;  // stranger default

    const addressContext = isDirect || isMentioned ? 1.0
      : conversation.isGroupChat ? 0.12 : 0.38;

    // ── Influence differential ───────────────────────────────────────────────
    const theirInfluence = message.senderInfluenceScore !== undefined
      ? { score: message.senderInfluenceScore }
      : edge?.targetInfluenceScore !== undefined
        ? { score: edge.targetInfluenceScore }
        : null;

    const influenceModifier = theirInfluence
      ? getInfluenceEngagementMultiplier(this.persona.influence, theirInfluence)
      : 1.0;

    // ── Weighted raw score ───────────────────────────────────────────────────
    const raw =
      relevance      * 0.24 +
      energy         * 0.19 +
      addressContext * 0.20 +
      social         * 0.14 +
      relationship   * 0.12 +
      urgency        * 0.07 +
      0.04;  // influence weight slot (applied as multiplier below)

    // Personality: extraverts engage more readily
    const extraversionBoost = 0.78 + this.persona.personality.extraversion * 0.44;
    const total = Math.min(raw * extraversionBoost * influenceModifier, 1);

    const score: EngagementScore = {
      relevance, social, energy, relationship, addressContext, urgency,
      influenceModifier, total,
    };

    // ── Action thresholds ────────────────────────────────────────────────────
    let action: EngagementAction;
    let reasoning: string;

    if (isDirect || isMentioned) {
      if (this.fatigue.isExhausted() && urgency < 0.3) {
        action = 'SHOULD_RESPOND';
        reasoning = 'Directly addressed but exhausted — brief reply only.';
      } else {
        action = 'MUST_RESPOND';
        reasoning = isDirect ? 'Direct message received.' : 'Mentioned by name.';
      }
    } else if (total >= 0.60) {
      action = 'SHOULD_RESPOND';
      reasoning = `High engagement score (${total.toFixed(2)}).`;
    } else if (total >= 0.34) {
      action = 'CAN_RESPOND';
      reasoning = `Moderate engagement score (${total.toFixed(2)}).`;
    } else {
      action = 'SKIP';
      reasoning = `Low engagement score (${total.toFixed(2)}).`;
    }

    const delayMs = calculateDelay(
      this.persona.personality.extraversion,
      energy,
      action
    );

    return { action, score, shouldDelay: delayMs > 0, delayMs, reasoning };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSkip(score: EngagementScore, reasoning: string): EngagementDecision {
  return { action: 'SKIP', score, shouldDelay: false, delayMs: 0, reasoning };
}

function zeroScore(): EngagementScore {
  return { relevance: 0, social: 0, energy: 0, relationship: 0, addressContext: 0, urgency: 0, influenceModifier: 1, total: 0 };
}

function calculateDelay(
  extraversion: number,
  energy: number,
  action: EngagementAction
): number {
  if (action === 'SKIP') return 0;
  const speedFactor = extraversion * 0.6 + energy * 0.4;
  const delay = 500 + (1 - speedFactor) * 19_500;
  const jitter = delay * 0.2 * (Math.random() - 0.5);
  return Math.round(Math.max(200, delay + jitter));
}
