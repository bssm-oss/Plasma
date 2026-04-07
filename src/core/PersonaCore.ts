import {
  PersonaDefinition,
  PersonalityMatrix,
  RelationshipEntry,
  Skill,
  SkillLevel,
} from '../types';
import {
  RelationshipGraph,
  RelationshipType,
  InteractionEvent,
} from '../graph/RelationshipGraph';
import {
  SocialInfluence,
  resolveModifiers,
  InfluenceModifiers,
} from '../rank/RankSystem';

const SKILL_LEVEL_SCORE: Record<SkillLevel, number> = {
  novice: 0.25,
  intermediate: 0.5,
  advanced: 0.75,
  expert: 1.0,
};

export class PersonaCore {
  readonly graph: RelationshipGraph;
  private readonly _influence: SocialInfluence;

  constructor(private readonly def: PersonaDefinition) {
    this._influence = {
      score: def.influenceScore ?? 40,
      label: def.influenceLabel,
    };

    // Seed the relationship graph from the definition's snapshot
    this.graph = new RelationshipGraph(
      def.relationships.map((r: RelationshipEntry) => ({
        personaId: r.personaId,
        name: r.name,
        role: r.role,
        influenceScore: r.influenceScore,
        trust: r.trust,
        rapport: r.rapport,
        explicitType: r.explicitType,
      }))
    );
  }

  // ─── Identity ──────────────────────────────────────────────────────────────

  get id(): string { return this.def.id; }
  get name(): string { return this.def.name; }
  get role(): string { return this.def.role; }
  get personality(): PersonalityMatrix { return this.def.personality; }
  get background(): string { return this.def.background; }
  get values(): string[] { return this.def.values; }
  get skills(): Skill[] { return this.def.skills; }
  get communicationStyle() { return this.def.communicationStyle; }

  // ─── Social influence ──────────────────────────────────────────────────────

  get influence(): SocialInfluence { return this._influence; }

  get influenceModifiers(): InfluenceModifiers {
    return resolveModifiers(this._influence);
  }

  // ─── Skill queries ─────────────────────────────────────────────────────────

  getSkillScore(domain: string): number {
    const lower = domain.toLowerCase();
    let best = 0;
    for (const skill of this.def.skills) {
      if (
        skill.domain.toLowerCase().includes(lower) ||
        skill.name.toLowerCase().includes(lower)
      ) {
        const score = SKILL_LEVEL_SCORE[skill.level];
        if (score > best) best = score;
      }
    }
    return best;
  }

  isExpertIn(domain: string): boolean {
    return this.getSkillScore(domain) >= 0.75;
  }

  // ─── Relationship (delegates to graph) ────────────────────────────────────

  getRelationship(personaId: string) {
    return this.graph.getEdge(personaId);
  }

  recordInteraction(
    targetId: string,
    targetName: string,
    event: Omit<InteractionEvent, 'id'> & { id?: string }
  ) {
    return this.graph.recordInteraction(targetId, targetName, event);
  }

  setRelationshipType(
    targetId: string,
    targetName: string,
    type: RelationshipType,
    meta?: { targetRole?: string; targetInfluenceScore?: number }
  ) {
    this.graph.setExplicitType(targetId, targetName, type, meta);
  }

  // ─── Serialisation ─────────────────────────────────────────────────────────

  toDefinition(): PersonaDefinition {
    return structuredClone(this.def);
  }

  toPromptSummary(): string {
    const p = this.def.personality;
    const traits: string[] = [];
    if (p.extraversion > 0.6) traits.push('outgoing and social');
    else if (p.extraversion < 0.4) traits.push('introverted and reserved');
    if (p.openness > 0.65) traits.push('creative and curious');
    if (p.conscientiousness > 0.65) traits.push('organised and thorough');
    if (p.agreeableness > 0.65) traits.push('empathetic and cooperative');
    if (p.neuroticism > 0.65) traits.push('prone to worry and emotional swings');
    if (p.ambition > 0.7) traits.push('highly driven and goal-oriented');

    const skillList = this.def.skills
      .map((s) => `${s.name} (${s.level})`)
      .join(', ');

    const influenceLine = this._influence.label
      ? `Social standing: ${this._influence.label} (influence ${this._influence.score}/100)`
      : `Social influence score: ${this._influence.score}/100`;

    return [
      `Name: ${this.def.name}`,
      `Role: ${this.def.role}`,
      influenceLine,
      `Background: ${this.def.background}`,
      `Personality: ${traits.length ? traits.join(', ') : 'balanced'}`,
      `Skills: ${skillList || 'none listed'}`,
      `Values: ${this.def.values.join(', ')}`,
      `Communication: formality=${fmt(this.def.communicationStyle.formality)} verbosity=${fmt(this.def.communicationStyle.verbosity)} directness=${fmt(this.def.communicationStyle.directness)}`,
    ].join('\n');
  }
}

function fmt(n: number): string {
  if (n < 0.33) return 'low';
  if (n < 0.66) return 'medium';
  return 'high';
}
