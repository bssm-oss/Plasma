import { v4 as uuidv4 } from 'uuid';
import { ConversationContext, Message } from '../types';

const MAX_HISTORY_PER_CONVERSATION = 100;
const CONVERSATION_END_IDLE_MS = 10 * 60 * 1000;
const MIN_MESSAGES_FOR_END_DETECTION = 4;

export class ConversationManager {
  private readonly conversations = new Map<string, ConversationContext>();

  addMessage(message: Message): ConversationContext {
    let conv = this.conversations.get(message.conversationId);

    if (!conv) {
      conv = this.createConversation(message);
    }

    conv.messages.push(message);

    if (conv.messages.length > MAX_HISTORY_PER_CONVERSATION) {
      conv.messages.splice(0, conv.messages.length - MAX_HISTORY_PER_CONVERSATION);
    }

    conv.lastActivityAt = message.timestamp;
    if (!conv.participants.includes(message.senderId)) {
      conv.participants.push(message.senderId);
    }

    if (!conv.topic && conv.messages.length <= 3) {
      conv.topic = extractTopic(message.content);
    }

    return conv;
  }

  openConversation(params: {
    id?: string;
    participants: string[];
    isGroupChat: boolean;
    topic?: string;
  }): ConversationContext {
    const id = params.id ?? uuidv4();
    const conv: ConversationContext = {
      id,
      participants: params.participants,
      isGroupChat: params.isGroupChat,
      topic: params.topic,
      messages: [],
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      respondingPlasmaIds: [],
    };
    this.conversations.set(id, conv);
    return conv;
  }

  markResponding(conversationId: string, plasmaId: string): void {
    const conv = this.conversations.get(conversationId);
    if (conv && !conv.respondingPlasmaIds.includes(plasmaId)) {
      conv.respondingPlasmaIds.push(plasmaId);
    }
  }

  markResponseDone(conversationId: string, plasmaId: string): void {
    const conv = this.conversations.get(conversationId);
    if (conv) {
      conv.respondingPlasmaIds = conv.respondingPlasmaIds.filter(id => id !== plasmaId);
      conv.lastPlasmaResponseAt = Date.now();
    }
  }

  isPlasmaResponding(conversationId: string, plasmaId: string): boolean {
    const conv = this.conversations.get(conversationId);
    return conv?.respondingPlasmaIds.includes(plasmaId) ?? false;
  }

  hasOtherPlasmaResponding(conversationId: string, excludePlasmaId: string): boolean {
    const conv = this.conversations.get(conversationId);
    if (!conv) return false;
    return conv.respondingPlasmaIds.some(id => id !== excludePlasmaId);
  }

  shouldEndConversation(conversationId: string): { shouldEnd: boolean; reason: string } {
    const conv = this.conversations.get(conversationId);
    if (!conv) return { shouldEnd: false, reason: '' };

    if (conv.messages.length < MIN_MESSAGES_FOR_END_DETECTION) {
      return { shouldEnd: false, reason: '' };
    }

    const now = Date.now();
    const lastActivityAge = now - conv.lastActivityAt;
    if (lastActivityAge > CONVERSATION_END_IDLE_MS) {
      return { shouldEnd: true, reason: 'Conversation has been idle too long' };
    }

    const lastTwo = conv.messages.slice(-2);
    if (lastTwo.length === 2) {
      const allPlasma = lastTwo.every(m => !m.isDirectMessage || m.senderId !== conv.participants[0]);
      const bothShort = lastTwo.every(m => m.content.trim().length < 20);
      if (allPlasma && bothShort) {
        return { shouldEnd: true, reason: 'Exchange has naturally concluded' };
      }
    }

    if (conv.lastPlasmaResponseAt) {
      const timeSinceLastResponse = now - conv.lastPlasmaResponseAt;
      if (timeSinceLastResponse > 5 * 60 * 1000) {
        return { shouldEnd: true, reason: 'No recent engagement from participants' };
      }
    }

    return { shouldEnd: false, reason: '' };
  }

  endConversation(conversationId: string): void {
    const conv = this.conversations.get(conversationId);
    if (conv) {
      conv.respondingPlasmaIds = [];
    }
  }

  getConversation(id: string): ConversationContext | null {
    return this.conversations.get(id) ?? null;
  }

  getAllConversations(): ConversationContext[] {
    return Array.from(this.conversations.values());
  }

  getActiveConversations(maxIdleMs = 30 * 60 * 1000): ConversationContext[] {
    const cutoff = Date.now() - maxIdleMs;
    return this.getAllConversations().filter((c) => c.lastActivityAt >= cutoff);
  }

  getRecentMessages(conversationId: string, n = 10): Message[] {
    const conv = this.conversations.get(conversationId);
    if (!conv) return [];
    return conv.messages.slice(-n);
  }

  private createConversation(seed: Message): ConversationContext {
    const conv: ConversationContext = {
      id: seed.conversationId,
      participants: [seed.senderId],
      isGroupChat: !seed.isDirectMessage,
      messages: [],
      startedAt: seed.timestamp,
      lastActivityAt: seed.timestamp,
      respondingPlasmaIds: [],
    };
    this.conversations.set(seed.conversationId, conv);
    return conv;
  }
}

/**
 * Very simple topic extractor — grabs the first meaningful noun phrase.
 */
function extractTopic(content: string): string | undefined {
  const clean = content.trim().replace(/[?!.]+$/, '');
  if (clean.length <= 60) return clean;
  return clean.slice(0, 57) + '…';
}
