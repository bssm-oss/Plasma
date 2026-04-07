import { v4 as uuidv4 } from 'uuid';
import { MemoryConfig, MemoryEntry, MemoryType } from '../types';

const DEFAULT_CONFIG: MemoryConfig = {
  maxEntries: 200,
  decayRatePerHour: 0.005, // importance drop per game-hour
  maxContextTokens: 800,
};

/**
 * Rough token estimator (1 token ≈ 4 chars).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class MemoryCore {
  private entries: MemoryEntry[] = [];
  private readonly cfg: MemoryConfig;

  constructor(config?: Partial<MemoryConfig>) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Write ────────────────────────────────────────────────────────────────

  add(
    params: {
      type: MemoryType;
      content: string;
      importance: number;
      emotionalWeight?: number;
      associatedPersonas?: string[];
      tags?: string[];
    }
  ): MemoryEntry {
    const entry: MemoryEntry = {
      id: uuidv4(),
      type: params.type,
      content: params.content,
      importance: Math.max(0, Math.min(1, params.importance)),
      emotionalWeight: params.emotionalWeight ?? 0,
      timestamp: Date.now(),
      associatedPersonas: params.associatedPersonas ?? [],
      tags: params.tags ?? [],
      accessCount: 0,
    };
    this.entries.push(entry);
    this.prune();
    return entry;
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  /**
   * Retrieve the most relevant memories for a given query string.
   * Relevance = keyword overlap + importance + recency.
   */
  retrieve(query: string, limit = 10): MemoryEntry[] {
    const queryTokens = tokenise(query);
    const now = Date.now();

    const scored = this.entries.map((entry) => {
      const entryTokens = tokenise(entry.content + ' ' + entry.tags.join(' '));
      const overlap = [...queryTokens].filter((t) => entryTokens.has(t)).length;
      const keywordScore = queryTokens.size > 0 ? overlap / queryTokens.size : 0;
      const ageHours = (now - entry.timestamp) / 3_600_000;
      const recencyScore = Math.exp(-ageHours / 48); // half-life ~2 game-days
      const score =
        keywordScore * 0.4 +
        entry.importance * 0.35 +
        recencyScore * 0.15 +
        Math.min(entry.accessCount / 10, 1) * 0.1;
      return { entry, score };
    });

    const top = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ entry }) => entry);

    top.forEach((e) => e.accessCount++);
    return top;
  }

  getAll(): MemoryEntry[] {
    return [...this.entries];
  }

  // ─── Maintenance ──────────────────────────────────────────────────────────

  /**
   * Apply time-based importance decay.
   * Call when game clock advances.
   */
  decay(gameHours: number): void {
    const drop = this.cfg.decayRatePerHour * gameHours;
    this.entries.forEach((e) => {
      e.importance = Math.max(0, e.importance - drop);
    });
    // Remove fully-faded insignificant entries
    this.entries = this.entries.filter((e) => e.importance > 0.01);
  }

  private prune(): void {
    if (this.entries.length <= this.cfg.maxEntries) return;
    // Sort by importance asc, remove lowest
    this.entries.sort((a, b) => a.importance - b.importance);
    this.entries.splice(0, this.entries.length - this.cfg.maxEntries);
  }

  // ─── Prompt formatting ────────────────────────────────────────────────────

  /**
   * Build a concise memory context string for LLM prompts,
   * respecting the token budget.
   */
  toPromptContext(query: string): string {
    const relevant = this.retrieve(query, 15);
    if (relevant.length === 0) return '';

    const lines: string[] = [];
    let tokens = 0;
    for (const m of relevant) {
      const line = `- [${m.type}] ${m.content}`;
      const t = estimateTokens(line);
      if (tokens + t > this.cfg.maxContextTokens) break;
      lines.push(line);
      tokens += t;
    }
    return lines.length ? `Relevant memories:\n${lines.join('\n')}` : '';
  }
}

function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1)
  );
}
