import { v4 as uuidv4 } from 'uuid';
import {
  ConversationContext,
  LLMMessage,
  MCPTool,
  Message,
  ToolResult,
} from '../types';
import { LLMProvider } from '../llm/LLMProvider';
import { PromptBuilder, PromptContext } from '../llm/PromptBuilder';
import { MCPClient } from '../mcp/MCPClient';
import { Logger, LogLevel } from '../utils/Logger';

const MAX_TOOL_ROUNDS = 8; // prevent infinite agentic loops

export interface GenerateOptions {
  /** Override the list of tools available for this call */
  tools?: MCPTool[];
  /** Extra instructions appended to the system prompt */
  extraInstructions?: string;
}

export interface GenerateResult {
  response: string;
  toolResultLog: ToolResult[];
  totalTokensUsed: number;
}

/**
 * ResponseGenerator orchestrates the full agentic loop:
 *   1. Build system prompt from current persona state
 *   2. Call LLM
 *   3. If LLM calls a tool → execute via MCPClient → feed result back → loop
 *   4. Return final text response
 */
export class ResponseGenerator {
  private readonly log: Logger;

  constructor(
    private readonly llm: LLMProvider,
    private readonly promptBuilder: PromptBuilder,
    private readonly mcpClient: MCPClient,
    debug = false
  ) {
    this.log = new Logger('ResponseGenerator', debug ? LogLevel.DEBUG : LogLevel.INFO);
  }

  async generate(
    incomingMessage: Message,
    conversation: ConversationContext,
    options: GenerateOptions = {}
  ): Promise<GenerateResult> {
    const tools = options.tools ?? this.mcpClient.listTools();

    const promptCtx: PromptContext = {
      incomingMessage,
      conversationContext: conversation,
      tools,
      extraInstructions: options.extraInstructions,
    };

    const systemPrompt = this.promptBuilder.buildSystemPrompt(promptCtx);

    // Build conversation history for the LLM
    const history = buildLLMHistory(conversation, incomingMessage);

    this.log.debug('Starting generation', { messageId: incomingMessage.id });

    const toolResultLog: ToolResult[] = [];
    let totalTokens = 0;
    let round = 0;

    // ── Agentic loop ──────────────────────────────────────────────────────
    const messages: LLMMessage[] = [...history];

    while (round < MAX_TOOL_ROUNDS) {
      round++;

      const llmResponse = await this.llm.chat(messages, tools.length ? tools : undefined, systemPrompt);
      totalTokens += llmResponse.usage?.promptTokens ?? 0;
      totalTokens += llmResponse.usage?.completionTokens ?? 0;

      this.log.debug(`Round ${round} response`, {
        content: llmResponse.content.slice(0, 80),
        toolCalls: llmResponse.toolCalls?.map((t) => t.name),
      });

      // No tool calls — we have the final answer
      if (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) {
        const finalText = llmResponse.content.trim();
        this.log.info(`Generated response (${totalTokens} tokens, ${round} round(s))`);
        return { response: finalText, toolResultLog, totalTokensUsed: totalTokens };
      }

      // ── Execute tool calls ──────────────────────────────────────────────
      // Add assistant turn with tool calls
      if (llmResponse.content) {
        messages.push({ role: 'assistant', content: llmResponse.content });
      }

      for (const tc of llmResponse.toolCalls) {
        this.log.debug(`Executing tool: ${tc.name}`, tc.arguments);
        const result = await this.mcpClient.execute(tc.name, tc.arguments);
        toolResultLog.push(result);

        // Feed tool result back as a user message.
        // Framed as internal context, not as a "tool call", so the LLM
        // incorporates it naturally without narrating the lookup.
        const resultContent = result.isError
          ? `(unavailable: ${result.errorMessage})`
          : JSON.stringify(result.result, null, 2);

        messages.push({
          role: 'user',
          content: `[Internal context — ${tc.name}]:\n${resultContent}\n(Use this naturally. Do not reference this lookup in your reply.)`,
        });
      }
    }

    this.log.warn('Reached max tool rounds — returning last content');
    const lastMsg = messages[messages.length - 1];
    return {
      response: lastMsg.content || '...',
      toolResultLog,
      totalTokensUsed: totalTokens,
    };
  }
}

/**
 * Convert recent conversation messages to LLM message format.
 * The incoming message itself is the last user turn.
 */
function buildLLMHistory(
  conversation: ConversationContext,
  incoming: Message
): LLMMessage[] {
  const messages: LLMMessage[] = [];

  // Use last 12 messages as context (excluding the incoming one to avoid duplication)
  const prior = conversation.messages
    .filter((m) => m.id !== incoming.id)
    .slice(-12);

  for (const m of prior) {
    // Messages from the persona itself are "assistant" turns
    messages.push({
      role: 'user', // All conversation history shown as user context
      content: `${m.senderName}: ${m.content}`,
    });
  }

  // The actual incoming message is the final user turn
  messages.push({
    role: 'user',
    content: `${incoming.senderName}: ${incoming.content}`,
  });

  return messages;
}
