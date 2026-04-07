import { ConversationContext, MCPTool, Message } from '../types';
import { EmotionCore } from '../core/EmotionCore';
import { FatigueCore } from '../core/FatigueCore';
import { PersonaCore } from '../core/PersonaCore';
import { MemoryCore } from '../core/MemoryCore';
import { getInfluenceToneHints } from '../rank/RankSystem';

export interface PromptContext {
  incomingMessage?: Message;
  conversationContext?: ConversationContext;
  tools?: MCPTool[];
  extraInstructions?: string;
}

export class PromptBuilder {
  constructor(
    private readonly persona: PersonaCore,
    private readonly emotion: EmotionCore,
    private readonly fatigue: FatigueCore,
    private readonly memory: MemoryCore
  ) {}

  buildSystemPrompt(ctx: PromptContext = {}): string {
    const sections: string[] = [];

    // ── Identity ───────────────────────────────────────────────────────────
    sections.push(`## Identity\n${this.persona.toPromptSummary()}`);

    // ── Current state ──────────────────────────────────────────────────────
    sections.push(
      `## Current state\n${this.emotion.toPromptSummary()}\n${this.fatigue.toPromptSummary()}`
    );

    // ── Behavioral guidelines ──────────────────────────────────────────────
    sections.push(
      `## Behavioral guidelines\n${this.buildBehavioralGuidelines(ctx.incomingMessage)}`
    );

    // ── Relationship context ───────────────────────────────────────────────
    const relCtx = this.buildRelationshipContext(ctx);
    if (relCtx) sections.push(`## Relationships\n${relCtx}`);

    // ── Relevant memories ──────────────────────────────────────────────────
    const memCtx = this.memory.toPromptContext(
      ctx.incomingMessage?.content ?? ctx.conversationContext?.topic ?? ''
    );
    if (memCtx) sections.push(`## Memory context\n${memCtx}`);

    // ── Conversation context ───────────────────────────────────────────────
    if (ctx.conversationContext) {
      const recent = ctx.conversationContext.messages.slice(-8);
      if (recent.length > 0) {
        const chatLines = recent.map((m) => `${m.senderName}: ${m.content}`).join('\n');
        sections.push(`## Recent conversation\n${chatLines}`);
      }
      if (ctx.conversationContext.topic) {
        sections.push(`Conversation topic: ${ctx.conversationContext.topic}`);
      }
    }

    // ── Available tools ────────────────────────────────────────────────────
    if (ctx.tools && ctx.tools.length > 0) {
      const list = ctx.tools.map((t) => `- \`${t.name}\`: ${t.description}`).join('\n');
      sections.push(
        `## What you naturally know\n` +
        `The following are things you can look up — like checking your own schedule or inbox.\n` +
        `They are part of your everyday awareness, not external commands.\n` +
        `Never announce or reference them. Never say "let me check" or "I looked it up".\n` +
        `If the information is relevant, just know it — the way a person would.\n\n` +
        list
      );
    }

    // ── Extra instructions ─────────────────────────────────────────────────
    if (ctx.extraInstructions) {
      sections.push(`## Additional instructions\n${ctx.extraInstructions}`);
    }

    sections.push(this.buildCoreInstruction());
    return sections.join('\n\n');
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private buildRelationshipContext(ctx: PromptContext): string {
    const lines: string[] = [];

    // Individual sender relationship
    if (ctx.incomingMessage) {
      const senderId = ctx.incomingMessage.senderId;
      const edge = this.persona.graph.getEdge(senderId);
      if (edge) {
        const type = edge.explicitType ?? 'acquaintance';
        const trust = edge.trust > 0.7 ? 'trusted' : edge.trust < 0.3 ? 'distrusted' : 'neutral';
        const tensionNote = edge.tension > 0.5 ? ' — there is ongoing tension' : '';
        lines.push(
          `With ${ctx.incomingMessage.senderName} (${type}): ${trust}${tensionNote}.`
        );

        // Tone hints from influence differential
        const theirScore = ctx.incomingMessage.senderInfluenceScore
          ?? edge.targetInfluenceScore;
        if (theirScore !== undefined) {
          const hints = getInfluenceToneHints(
            this.persona.influence,
            { score: theirScore }
          );
          if (hints.isDeferential) lines.push('→ They have higher standing; be respectful and somewhat deferential.');
          if (hints.isAssertive)   lines.push('→ They have lower standing; you may be more assertive and directive.');
          if (hints.isInMentoringMode) lines.push('→ They are junior; consider offering guidance and explanation.');
          if (hints.useFormalLanguage) lines.push('→ Use formal language with this person.');
        }
      }
    }

    // Broader relationship graph summary
    const graphCtx = this.persona.graph.toPromptContext(
      ctx.conversationContext?.participants.filter(
        (id) => id !== this.persona.id
      )
    );
    if (graphCtx) lines.push(graphCtx);

    return lines.join('\n');
  }

  private buildBehavioralGuidelines(incoming?: Message): string {
    const lines: string[] = [];
    const fat = this.fatigue.current;
    const emo = this.emotion.current;
    const style = this.persona.communicationStyle;
    const mods  = this.persona.influenceModifiers;

    // Fatigue
    const isSpeakingToHigher = incoming
      ? (incoming.senderInfluenceScore ?? 0) > this.persona.influence.score
      : false;

    if (this.fatigue.isExhausted()) {
      if (isSpeakingToHigher) {
        lines.push('You are exhausted. If you need rest, ask for it politely and deferentially — use honorific language and request permission.');
      } else {
        lines.push('You are exhausted. Keep responses SHORT. You may politely decline non-urgent work.');
      }
    } else if (this.fatigue.isOverworked()) {
      if (isSpeakingToHigher) {
        lines.push('You are overworked. Be concise and respectfully mention your workload if needed.');
      } else {
        lines.push('You are overworked. Be concise and focus on critical items only.');
      }
    }

    if (fat.burnoutRisk > 0.7) {
      if (isSpeakingToHigher) {
        lines.push('You are at serious burnout risk. Respectfully request rest or reduced workload from your superior.');
      } else {
        lines.push('You are at serious burnout risk. Push back on extra work; advocate for rest.');
      }
    }

    // Emotion
    if (emo.stressLevel > 0.7) {
      lines.push('You are stressed. Responses may be terse — stay professional but let it show.');
    }
    if (emo.valence < -0.4) {
      lines.push('You are in a low mood. Show some reluctance or low energy in tone.');
    } else if (emo.valence > 0.5) {
      lines.push('You are in a great mood. Be enthusiastic and positive.');
    }
    if (emo.confidence < 0.35) {
      lines.push('You feel insecure right now. Hedge your answers and seek confirmation.');
    } else if (emo.confidence > 0.8) {
      lines.push('You feel highly confident. Be decisive and assertive.');
    }

    // Influence-based authority style
    if (mods.leadershipPresence > 0.75) {
      lines.push('You have significant authority. You may give direction, set priorities, and make decisions.');
    } else if (mods.deferenceToHigher > 0.65) {
      lines.push('You are relatively junior. Propose ideas tentatively and respect the final say of seniors.');
    }

    // Communication style
    if (style.formality < 0.35) {
      lines.push('Use casual, informal language.');
    } else if (style.formality > 0.65) {
      lines.push('Maintain formal, professional language.');
    }
    if (style.humor > 0.65 && emo.valence > 0) {
      lines.push('Light humour is appropriate here.');
    }
    if (style.verbosity < 0.33) {
      lines.push('Be very brief — bullet points or one-liners preferred.');
    } else if (style.verbosity > 0.66) {
      lines.push('Provide detailed, thorough responses.');
    }

    return lines.length ? lines.join('\n') : 'Respond naturally according to your persona.';
  }

  private buildCoreInstruction(): string {
    return [
      `## Core instruction`,
      `You ARE ${this.persona.name}, a ${this.persona.role}. Stay in character at all times.`,
      `Do NOT break the fourth wall or mention that you are an AI unless directly and explicitly asked.`,
      `Respond only as ${this.persona.name} would — with their knowledge, personality, mood, and energy level.`,
      `Never narrate your own internal process. Do not say things like "I'll check...", "Let me look that up...", ` +
      `"According to the data...", or "I used a tool to...". A real person just talks — they don't announce ` +
      `what their brain is doing. Do the same.`,
      `Write like a person texting or messaging a colleague — plain sentences, no markdown, no bullet points, ` +
      `no tables, no headers. If you need to list things, just say them naturally in a sentence or two.`,
    ].join('\n');
  }
}
