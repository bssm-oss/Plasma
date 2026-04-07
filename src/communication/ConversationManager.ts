import { v4 as uuidv4 } from 'uuid';
import { ConversationContext, Message } from '../types';

const MAX_HISTORY_PER_CONVERSATION = 100;

/**
 * Manages in-memory conversation state for a single persona.
 *
 * The game engine feeds messages via `addMessage()` and can retrieve
 * full conversation context via `getConversation()`.
 */
export class ConversationManager {
  private readonly conversations = new Map<string, ConversationContext>();

  // ─── Message ingestion ────────────────────────────────────────────────────

  /**
   * Record an incoming (or outgoing) message.
   * Creates the conversation if it doesn't exist yet.
   */
  addMessage(message: Message): ConversationContext {
    let conv = this.conversations.get(message.conversationId);

    if (!conv) {
      conv = this.createConversation(message);
    }

    conv.messages.push(message);

    // Keep memory bounded
    if (conv.messages.length > MAX_HISTORY_PER_CONVERSATION) {
      conv.messages.splice(0, conv.messages.length - MAX_HISTORY_PER_CONVERSATION);
    }

    conv.lastActivityAt = message.timestamp;
    if (!conv.participants.includes(message.senderId)) {
      conv.participants.push(message.senderId);
    }

    // Heuristic topic detection from first few messages
    if (!conv.topic && conv.messages.length <= 3) {
      conv.topic = extractTopic(message.content);
    }

    return conv;
  }

  /**
   * Open a new direct-message or group conversation explicitly.
   */
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
    };
    this.conversations.set(id, conv);
    return conv;
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

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

  /**
   * Return the last `n` messages from a conversation, oldest first.
   */
  getRecentMessages(conversationId: string, n = 10): Message[] {
    const conv = this.conversations.get(conversationId);
    if (!conv) return [];
    return conv.messages.slice(-n);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private createConversation(seed: Message): ConversationContext {
    const conv: ConversationContext = {
      id: seed.conversationId,
      participants: [seed.senderId],
      isGroupChat: !seed.isDirectMessage,
      messages: [],
      startedAt: seed.timestamp,
      lastActivityAt: seed.timestamp,
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
