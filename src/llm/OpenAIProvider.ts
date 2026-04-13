import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { LLMConfig, LLMMessage, LLMResponse, MCPTool } from '../types';
import { LLMProvider } from './LLMProvider';

const DEFAULT_MODEL = 'gpt-4o';

export class OpenAIProvider extends LLMProvider {
  private readonly client: OpenAI;

  constructor(config: LLMConfig) {
    super(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      ...(config.dangerouslyAllowBrowser ? { dangerouslyAllowBrowser: true } : {}),
    });
  }

  get providerName(): string {
    return 'openai';
  }

  async chat(
    messages: LLMMessage[],
    tools?: MCPTool[],
    system?: string
  ): Promise<LLMResponse> {
    const oaiMessages: ChatCompletionMessageParam[] = [];

    if (system) {
      oaiMessages.push({ role: 'system', content: system });
    }

    for (const m of messages) {
      oaiMessages.push({ role: m.role as 'user' | 'assistant', content: m.content });
    }

    const oaiTools: ChatCompletionTool[] | undefined =
      tools && tools.length > 0
        ? tools.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: {
                type: t.inputSchema.type,
                properties: t.inputSchema.properties,
                required: t.inputSchema.required ?? [],
              },
            },
          }))
        : undefined;

    const res = await this.client.chat.completions.create({
      model: this.config.model ?? DEFAULT_MODEL,
      temperature: this.config.temperature ?? 0.75,
      max_tokens: this.config.maxTokens ?? 1024,
      messages: oaiMessages,
      ...(oaiTools ? { tools: oaiTools, tool_choice: 'auto' } : {}),
    });

    const choice = res.choices[0];
    const msg = choice.message;

    const toolCalls = msg.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: msg.content ?? '',
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: res.usage
        ? {
            promptTokens: res.usage.prompt_tokens,
            completionTokens: res.usage.completion_tokens,
          }
        : undefined,
    };
  }
}
