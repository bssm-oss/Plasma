import { FatigueConfig, FatigueState } from '../types';

const DEFAULT_CONFIG: FatigueConfig = {
  maxDailyHours: 10,
  recoveryRatePerHour: 12,   // energy points per rest-hour
  fatiguePenaltyPerHour: 8,  // mental fatigue added per work-hour
  energyCostPerHour: 6,      // energy drained per work-hour
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class FatigueCore {
  private state: FatigueState;
  private readonly cfg: FatigueConfig;

  constructor(config?: Partial<FatigueConfig>, initial?: Partial<FatigueState>) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      energy: 90,
      mentalFatigue: 10,
      burnoutRisk: 0.05,
      workHoursToday: 0,
      workHoursThisWeek: 0,
      lastRestTimestamp: Date.now(),
      ...initial,
    };
  }

  get current(): FatigueState {
    return { ...this.state };
  }

  // ─── Simulation ───────────────────────────────────────────────────────────

  /**
   * Advance game time by working for `hours` simulated hours.
   * Returns updated state.
   */
  work(hours: number): FatigueState {
    const h = Math.max(0, hours);
    this.state.energy       = clamp(this.state.energy - this.cfg.energyCostPerHour * h, 0, 100);
    this.state.mentalFatigue = clamp(this.state.mentalFatigue + this.cfg.fatiguePenaltyPerHour * h, 0, 100);
    this.state.workHoursToday   += h;
    this.state.workHoursThisWeek += h;

    // Burnout risk accumulates when overworked
    const overHours = Math.max(0, this.state.workHoursToday - this.cfg.maxDailyHours);
    this.state.burnoutRisk = clamp01(
      this.state.burnoutRisk +
        overHours * 0.03 +
        (this.state.mentalFatigue / 100) * 0.005 * h
    );
    return { ...this.state };
  }

  /**
   * Rest for `hours` simulated hours.
   */
  rest(hours: number): FatigueState {
    const h = Math.max(0, hours);
    this.state.energy       = clamp(this.state.energy + this.cfg.recoveryRatePerHour * h, 0, 100);
    this.state.mentalFatigue = clamp(this.state.mentalFatigue - this.cfg.recoveryRatePerHour * 0.8 * h, 0, 100);
    this.state.burnoutRisk   = clamp01(this.state.burnoutRisk - 0.02 * h);
    this.state.lastRestTimestamp = Date.now();
    return { ...this.state };
  }

  /**
   * Call at the start of a new game day to reset daily counters.
   */
  newDay(): void {
    this.state.workHoursToday = 0;
    // Weekly reset on every 7th call would be handled externally
  }

  newWeek(): void {
    this.state.workHoursToday = 0;
    this.state.workHoursThisWeek = 0;
  }

  // ─── Derived values ───────────────────────────────────────────────────────

  /** 0–1 modifier applied to response quality and work output */
  getEfficiencyModifier(): number {
    const energyFactor    = this.state.energy / 100;
    const fatiguePenalty  = this.state.mentalFatigue / 100;
    return clamp01(energyFactor * 0.6 + (1 - fatiguePenalty) * 0.4);
  }

  /** 0–1 willingness to take on MORE work right now */
  getWorkWillingnessModifier(): number {
    if (this.state.energy < 20) return 0.1;
    if (this.isOverworked()) return 0.25;
    return clamp01((this.state.energy / 100) * 0.7 + (1 - this.state.mentalFatigue / 100) * 0.3);
  }

  isOverworked(): boolean {
    return this.state.workHoursToday >= this.cfg.maxDailyHours;
  }

  isExhausted(): boolean {
    return this.state.energy < 20 || this.state.mentalFatigue > 85;
  }

  isBurningOut(): boolean {
    return this.state.burnoutRisk > 0.7;
  }

  // ─── Prompt summary ───────────────────────────────────────────────────────

  toPromptSummary(): string {
    const energyLabel =
      this.state.energy > 70 ? 'energetic' :
      this.state.energy > 40 ? 'a bit tired' :
      this.state.energy > 20 ? 'quite tired' : 'exhausted';
    const fatigueLabel =
      this.state.mentalFatigue < 30 ? 'mentally fresh' :
      this.state.mentalFatigue < 60 ? 'mentally loaded' : 'mentally drained';
    const burnoutWarning = this.isBurningOut() ? ' (burnout risk is high)' : '';
    return `Energy: ${energyLabel} (${Math.round(this.state.energy)}/100). ${fatigueLabel}.${burnoutWarning}`;
  }
}
