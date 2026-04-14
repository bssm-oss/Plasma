/**
 * PlasmaEngine LLM Integration Tests
 *
 * Gated behind PLASMA_INTEGRATION env var.
 * Conversation logs are written to integration-test.log
 *
 * .env example (Groq):
 *   PLASMA_INTEGRATION=1
 *   PLASMA_LLM_PROVIDER=openai
 *   PLASMA_LLM_API_KEY=gsk_xxx
 *   PLASMA_LLM_BASE_URL=https://api.groq.com/openai/v1
 *   PLASMA_LLM_MODEL=llama-3.3-70b-versatile
 *
 * Run: npm run test:integration
 */

import fs from 'fs';
import path from 'path';
import { PlasmaEngine } from '../core/PlasmaEngine';
import { PersonaDefinition, Message, LLMConfig } from '../types';

const RUN = !!process.env.PLASMA_INTEGRATION;

const LOG_PATH = path.resolve(__dirname, '../../integration-test.log');

class ConversationLogger {
  private lines: string[] = [];

  constructor() {
    this.lines.push(
      `═══════════════════════════════════════════════════════════`,
      `  PlasmaEngine Integration Test Log`,
      `  ${new Date().toISOString()}`,
      `  Model: ${process.env.PLASMA_LLM_MODEL ?? 'default'}`,
      `  Provider: ${process.env.PLASMA_LLM_PROVIDER ?? 'openai'}`,
      `═══════════════════════════════════════════════════════════`,
      ''
    );
  }

  section(title: string) {
    this.lines.push(`\n─── ${title} ${'─'.repeat(Math.max(0, 55 - title.length))}`);
  }

  incoming(sender: string, content: string) {
    this.lines.push(`\n  ▶ ${sender}: ${content}`);
  }

  outgoing(sender: string, content: string) {
    this.lines.push(`  ◀ ${sender}: ${content}`);
  }

  toolCall(toolName: string, args: unknown, result: unknown) {
    this.lines.push(`  🔧 Tool: ${toolName}`);
    this.lines.push(`     Args:   ${JSON.stringify(args)}`);
    this.lines.push(`     Result: ${JSON.stringify(result)}`);
  }

  state(label: string, data: unknown) {
    this.lines.push(`  📊 ${label}: ${JSON.stringify(data, null, 2).replace(/\n/g, '\n     ')}`);
  }

  info(msg: string) {
    this.lines.push(`  ℹ ${msg}`);
  }

  flush() {
    this.lines.push(`\n${'═'.repeat(59)}`);
    this.lines.push(`  Test completed at ${new Date().toISOString()}`);
    this.lines.push(`${'═'.repeat(59)}\n`);
    fs.writeFileSync(LOG_PATH, this.lines.join('\n'), 'utf-8');
    console.log(`\nConversation log saved to: ${LOG_PATH}`);
  }
}

const logger = new ConversationLogger();

function getEnvConfig(): LLMConfig {
  const provider = (process.env.PLASMA_LLM_PROVIDER ?? 'openai') as 'openai' | 'anthropic';
  const apiKey = process.env.PLASMA_LLM_API_KEY ?? '';
  const baseURL = process.env.PLASMA_LLM_BASE_URL;
  const model = process.env.PLASMA_LLM_MODEL;

  return {
    provider,
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(model ? { model } : {}),
    temperature: 0.6,
    maxTokens: 300,
  };
}

const TIMEOUT = 90_000;

function makePersona(overrides: Partial<PersonaDefinition> = {}): PersonaDefinition {
  return {
    id: 'dev-jisu',
    name: '김지수',
    role: 'Frontend Developer',
    influenceScore: 58,
    influenceLabel: '과장',
    personality: {
      openness: 0.75,
      conscientiousness: 0.65,
      extraversion: 0.45,
      agreeableness: 0.70,
      neuroticism: 0.30,
      ambition: 0.65,
    },
    background: '5년차 프론트엔드 개발자. React와 TypeScript 전문가.',
    skills: [
      { name: 'React', level: 'expert', domain: 'frontend' },
      { name: 'TypeScript', level: 'advanced', domain: 'frontend' },
      { name: 'UI Design', level: 'intermediate', domain: 'design' },
    ],
    communicationStyle: {
      formality: 0.35,
      verbosity: 0.55,
      directness: 0.6,
      humor: 0.4,
      language: 'ko',
    },
    relationships: [
      {
        personaId: 'ceo-1',
        name: 'CEO',
        trust: 0.7,
        rapport: 0.6,
        influenceScore: 99,
        explicitType: 'superior',
      },
      {
        personaId: 'dev-2',
        name: 'Park Minsu',
        trust: 0.8,
        rapport: 0.8,
        influenceScore: 40,
      },
    ],
    values: ['code quality', 'autonomy', 'learning'],
    ...overrides,
  };
}

const messageCounter = { value: 0 };

function makeMessage(overrides: Partial<Message> = {}): Message {
  const counter = ++messageCounter.value;
  return {
    id: `msg-int-${counter.toString().padStart(3, '0')}`,
    conversationId: `conv-int-${counter.toString().padStart(3, '0')}`,
    senderId: 'ceo-1',
    senderName: 'CEO',
    content: '지수씨, 오늘 스프린트 리뷰 준비됐나요?',
    timestamp: Date.now(),
    mentions: ['dev-jisu'],
    isDirectMessage: true,
    senderInfluenceScore: 99,
    ...overrides,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const describeIf = RUN ? describe : describe.skip;

describeIf('PlasmaEngine Integration (real LLM)', () => {
  afterAll(() => {
    logger.flush();
  });

  test(
    'routeMessage returns MUST_RESPOND for direct @mention from CEO',
    () => {
      logger.section('1. routeMessage — MUST_RESPOND for CEO DM');
      const engine = new PlasmaEngine({
        persona: makePersona(),
        llm: getEnvConfig(),
        debug: true,
      });
      const msg = makeMessage();
      logger.incoming(msg.senderName, msg.content);

      const decision = engine.routeMessage(msg);
      logger.state('Engagement Decision', {
        action: decision.action,
        totalScore: decision.score.total.toFixed(2),
        reasoning: decision.reasoning,
      });

      expect(decision.action).toBe('MUST_RESPOND');
      expect(decision.score.total).toBeGreaterThan(0);
      expect(decision.delayMs).toBeGreaterThan(0);
      expect(decision.reasoning).toBeTruthy();
    }
  );

  test(
    'respond to Korean DM from CEO and get Korean reply',
    async () => {
      logger.section('2. Korean DM from CEO');
      const engine = new PlasmaEngine({
        persona: makePersona(),
        llm: getEnvConfig(),
        debug: true,
      });

      const msg = makeMessage({
        content: '안녕하세요, 오늘 점심에 시간 있으세요?',
      });
      logger.incoming(msg.senderName, msg.content);
      engine.routeMessage(msg);

      const response = await engine.respond(msg, {
        extraInstructions: 'Respond conversationally without using any tools. Do not call any tools.',
      });
      logger.outgoing('김지수', response);

      expect(typeof response).toBe('string');
      expect(response.length).toBeGreaterThan(3);
    },
    TIMEOUT
  );

  test(
    'respond to group chat message about React',
    async () => {
      await delay(2000);
      logger.section('3. Group Chat — React Component');

      const engine = new PlasmaEngine({
        persona: makePersona(),
        llm: getEnvConfig(),
        debug: true,
      });

      const msg = makeMessage({
        id: 'msg-int-002',
        conversationId: 'conv-int-group',
        senderId: 'dev-2',
        senderName: 'Park Minsu',
        content: '지수야, 이 React 컴포넌트 props 타입 좀 같이 봐줄 수 있어?',
        isDirectMessage: false,
        mentions: ['dev-jisu'],
        senderInfluenceScore: 40,
      });
      logger.incoming(msg.senderName, msg.content);

      const decision = engine.routeMessage(msg);
      logger.info(`Decision: ${decision.action} (score: ${decision.score.total.toFixed(2)})`);
      expect(decision.action).not.toBe('SKIP');

      const response = await engine.respond(msg, {
        extraInstructions: 'Respond conversationally without using any tools. Do not call any tools.',
      });
      logger.outgoing('김지수', response);
      expect(response.length).toBeGreaterThan(3);
    },
    TIMEOUT
  );

  test(
    'persona with low energy — responds but shows fatigue',
    async () => {
      await delay(2000);
      logger.section('4. Exhausted Junior Developer');

      const engine = new PlasmaEngine({
        persona: makePersona({
          id: 'dev-tired',
          name: '피곤한개발자',
          role: 'Junior Developer',
          influenceScore: 20,
        }),
        llm: getEnvConfig(),
        debug: true,
      });

      engine.advanceTime(14, false);
      engine.applyGameEvent({ type: 'overtime_forced', intensity: 0.8 });

      const state = engine.getState();
      logger.state('Fatigue State', {
        energy: state.fatigue.energy.toFixed(1),
        mentalFatigue: state.fatigue.mentalFatigue.toFixed(1),
        burnoutRisk: state.fatigue.burnoutRisk.toFixed(2),
      });
      logger.state('Emotion State', {
        mood: state.emotion.mood,
        valence: state.emotion.valence.toFixed(2),
        stress: state.emotion.stressLevel.toFixed(2),
      });
      expect(state.fatigue.energy).toBeLessThan(50);

      const msg = makeMessage({
        id: 'msg-int-003',
        senderId: 'dev-2',
        senderName: 'Park Minsu',
        content: '이거 코드 리뷰 해줄 수 있어?',
        isDirectMessage: true,
        senderInfluenceScore: 40,
      });
      logger.incoming(msg.senderName, msg.content);

      engine.routeMessage(msg);
      const response = await engine.respond(msg, {
        extraInstructions: 'Respond conversationally without using any tools. Do not call any tools.',
      });
      logger.outgoing('피곤한개발자', response);

      expect(response.length).toBeGreaterThan(0);
    },
    TIMEOUT
  );

  test(
    'emotion change affects response tone',
    async () => {
      await delay(2000);
      logger.section('5. Happy Persona (praised + bonus)');

      const engine = new PlasmaEngine({
        persona: makePersona({ id: 'dev-happy', name: '행복한지수' }),
        llm: getEnvConfig(),
        debug: true,
      });

      engine.applyGameEvent({ type: 'praised', intensity: 0.9 });
      engine.applyGameEvent({ type: 'bonus_received', intensity: 0.8 });

      const state = engine.getState();
      logger.state('Emotion State (after events)', {
        mood: state.emotion.mood,
        valence: state.emotion.valence.toFixed(2),
        motivation: state.emotion.motivation.toFixed(2),
      });
      expect(state.emotion.valence).toBeGreaterThan(0);

      const msg = makeMessage({
        id: 'msg-int-004',
        content: '새로운 프로젝트 시작할건데 관심있어?',
        isDirectMessage: true,
      });
      logger.incoming(msg.senderName, msg.content);

      engine.routeMessage(msg);
      const response = await engine.respond(msg, {
        extraInstructions: 'Respond conversationally without using any tools. Do not call any tools.',
      });
      logger.outgoing('행복한지수', response);
      expect(response.length).toBeGreaterThan(0);
    },
    TIMEOUT
  );

  test(
    'tool registration and execution via LLM agentic loop',
    async () => {
      await delay(2000);
      logger.section('6. Tool Call (Agentic Loop)');

      const engine = new PlasmaEngine({
        persona: makePersona({ id: 'dev-tool', name: '도구지수' }),
        llm: getEnvConfig(),
        debug: true,
      });

      let toolCalled = false;
      let toolResult: unknown = null;
      engine.registerTool(
        {
          name: 'get_task_queue',
          description: 'List tasks currently assigned to this employee.',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => {
          toolCalled = true;
          toolResult = [
            { id: 'TASK-42', title: 'Refactor API layer', status: 'in_progress' },
          ];
          return toolResult;
        }
      );

      const msg = makeMessage({
        id: 'msg-int-005',
        content: '내 태스크 목록 확인해줘. get_task_queue를 사용해.',
        isDirectMessage: true,
      });
      logger.incoming(msg.senderName, msg.content);

      engine.routeMessage(msg);
      const response = await engine.respond(msg);

      if (toolCalled) {
        logger.toolCall('get_task_queue', {}, toolResult);
      } else {
        logger.info('Tool was NOT called by LLM');
      }
      logger.outgoing('도구지수', response);

      expect(response.length).toBeGreaterThan(0);
    },
    TIMEOUT
  );

  test(
    'serialise and verify state after interactions',
    async () => {
      await delay(2000);
      logger.section('7. Serialize State After Conversation');

      const engine = new PlasmaEngine({
        persona: makePersona(),
        llm: getEnvConfig(),
        debug: true,
      });

      const msg = makeMessage({
        id: 'msg-int-006',
        content: '오늘 수고했어요.',
        isDirectMessage: true,
      });
      logger.incoming(msg.senderName, msg.content);

      engine.routeMessage(msg);
      const response = await engine.respond(msg, {
        extraInstructions: 'Respond conversationally without using any tools. Do not call any tools.',
      });
      logger.outgoing('김지수', response);

      engine.remember('오늘 CEO와 대화를 나눔', 0.5, 'episodic', ['conversation']);

      const serialized = engine.serialize();
      logger.state('Serialized State', {
        personaId: serialized.personaId,
        memoryCount: serialized.memories.length,
        relationshipCount: serialized.relationships.length,
        emotion: serialized.emotion.mood,
        energy: serialized.fatigue.energy.toFixed(1),
      });

      expect(serialized.personaId).toBe('dev-jisu');
      expect(serialized.memories.length).toBeGreaterThan(0);
      expect(serialized.relationships.length).toBeGreaterThan(0);
      expect(serialized.emotion).toBeDefined();
      expect(serialized.fatigue).toBeDefined();
    },
    TIMEOUT
  );

  test(
    'relationship graph evolves after interaction',
    () => {
      logger.section('8. Relationship Graph Evolution');

      const engine = new PlasmaEngine({
        persona: makePersona(),
        llm: getEnvConfig(),
        debug: true,
      });

      logger.info('Before: pair_work interaction with dev-2 (intensity 0.85)');
      engine.logInteraction('dev-2', 'Park Minsu', {
        type: 'pair_work',
        intensity: 0.85,
        timestamp: Date.now(),
        description: 'Pair programmed on the authentication module for 3 hours',
      });

      const graph = engine.getEgoGraph();
      expect(graph.nodes.length).toBeGreaterThan(1);
      expect(graph.edges.length).toBeGreaterThan(0);

      const edge = graph.edges.find((e) => e.targetId === 'dev-2');
      expect(edge).toBeDefined();
      expect(edge!.trust).toBeGreaterThan(0.8);
      logger.state('Relationship Edge (dev-jisu → dev-2)', {
        type: edge!.type,
        trust: edge!.trust.toFixed(3),
        rapport: edge!.rapport.toFixed(3),
        tension: edge!.tension.toFixed(3),
        interactionCount: edge!.interactionCount,
      });
    }
  );

  test(
    'memory recall after storing memories',
    () => {
      logger.section('9. Memory Recall');

      const engine = new PlasmaEngine({
        persona: makePersona(),
        llm: getEnvConfig(),
        debug: true,
      });

      engine.remember(
        'React 19의 새로운 compiler 기능을 학습함',
        0.8,
        'semantic',
        ['react', 'learning']
      );
      logger.info('Stored memory: "React 19의 새로운 compiler 기능을 학습함"');

      const results = engine.recallRelevant('React compiler', 3);
      expect(results.length).toBeGreaterThan(0);
      logger.info(`Recalled ${results.length} memories:`);
      for (const m of results) {
        logger.outgoing(`  [${m.type}] (importance: ${m.importance.toFixed(1)})`, m.content);
      }
    }
  );
});
