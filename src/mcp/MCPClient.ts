import { MCPTool, ToolHandler, ToolResult } from '../types';
import { Logger, LogLevel } from '../utils/Logger';

interface RegisteredTool {
  definition: MCPTool;
  handler: ToolHandler;
}

/**
 * MCPClient — lightweight tool registry + dispatcher.
 *
 * Personas use this to call game-world actions during their
 * agentic response loop (e.g. "check_backlog", "submit_pr", "send_message").
 *
 * Game integration wires up tools via `register()` at startup.
 * The ResponseGenerator calls `execute()` when the LLM emits a tool_call.
 */
export class MCPClient {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly log: Logger;

  constructor(debug = false) {
    this.log = new Logger('MCPClient', debug ? LogLevel.DEBUG : LogLevel.INFO);
  }

  // ─── Registration ─────────────────────────────────────────────────────────

  register(tool: MCPTool, handler: ToolHandler): void {
    if (this.tools.has(tool.name)) {
      this.log.warn(`Overwriting existing tool: ${tool.name}`);
    }
    this.tools.set(tool.name, { definition: tool, handler });
    this.log.debug(`Registered tool: ${tool.name}`);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  listTools(): MCPTool[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  // ─── Execution ────────────────────────────────────────────────────────────

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const registered = this.tools.get(name);
    if (!registered) {
      const msg = `Unknown tool: "${name}"`;
      this.log.warn(msg);
      return { toolName: name, result: null, isError: true, errorMessage: msg };
    }

    this.log.debug(`Calling tool ${name}`, args);
    try {
      const result = await registered.handler(args);
      this.log.debug(`Tool ${name} result`, result);
      return { toolName: name, result, isError: false };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.log.error(`Tool ${name} threw: ${errorMessage}`);
      return { toolName: name, result: null, isError: true, errorMessage };
    }
  }

  // ─── Built-in no-op tools (game can override) ─────────────────────────────

  /**
   * Register a standard set of game-world tools with stub handlers.
   * The game engine should call `register()` again with real handlers
   * to override these stubs before the engine runs.
   */
  registerStubs(): void {
    const stubs: Array<[MCPTool, ToolHandler]> = [
      [
        {
          name: 'get_game_time',
          description: 'Get the current in-game date and time.',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ date: 'Day 1', time: '09:00' }),
      ],
      [
        {
          name: 'get_task_queue',
          description: 'List tasks currently assigned to this employee.',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => [],
      ],
      [
        {
          name: 'start_task',
          description: 'Begin working on a specific task.',
          inputSchema: {
            type: 'object',
            properties: {
              task_id: { type: 'string', description: 'ID of the task to start.' },
            },
            required: ['task_id'],
          },
        },
        async (args) => ({ started: args['task_id'], status: 'in_progress' }),
      ],
      [
        {
          name: 'complete_task',
          description: 'Mark a task as completed and submit the work.',
          inputSchema: {
            type: 'object',
            properties: {
              task_id: { type: 'string', description: 'ID of the task to complete.' },
              summary: { type: 'string', description: 'Brief summary of what was done.' },
            },
            required: ['task_id'],
          },
        },
        async (args) => ({ completed: args['task_id'], message: args['summary'] }),
      ],
      [
        {
          name: 'get_project_status',
          description: 'Retrieve the current project progress and metrics.',
          inputSchema: {
            type: 'object',
            properties: {
              project_id: { type: 'string', description: 'Project identifier.' },
            },
          },
        },
        async () => ({ progress: 0, health: 'unknown' }),
      ],
      [
        {
          name: 'send_message',
          description: 'Send a message to another employee or channel in the messenger.',
          inputSchema: {
            type: 'object',
            properties: {
              recipient_id: { type: 'string', description: 'Target persona ID or channel name.' },
              content: { type: 'string', description: 'Message text to send.' },
            },
            required: ['recipient_id', 'content'],
          },
        },
        async (args) => ({ sent: true, recipient: args['recipient_id'] }),
      ],
      [
        {
          name: 'request_time_off',
          description: 'Request rest or time off to recover fatigue.',
          inputSchema: {
            type: 'object',
            properties: {
              hours: { type: 'number', description: 'Number of hours requested.' },
              reason: { type: 'string', description: 'Reason for the request.' },
            },
            required: ['hours'],
          },
        },
        async () => ({ approved: true }),
      ],
    ];

    for (const [tool, handler] of stubs) {
      if (!this.tools.has(tool.name)) {
        this.register(tool, handler);
      }
    }
  }
}
