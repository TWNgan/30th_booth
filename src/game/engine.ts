/**
 * The booth game state machine.
 *
 * Deliberately framework-free: the per-frame work (hold timers, match state,
 * hands) lives in a mutable `live` object that the canvas overlay reads
 * directly, so React only re-renders on real events — a phase change, a score
 * change, a new question. Nothing here touches the DOM.
 */

import type { HandAnalysis } from '../vision/classifier.ts';
import { describeShowing, matchAnswer, type MatchState } from './matcher.ts';
import { pickSession, type Question } from './questions.ts';
import { symbolsToNumber, type SymbolId } from './symbols.ts';

export type Phase = 'attract' | 'playing' | 'celebrate' | 'finished';

export interface RoundResult {
  question: Question;
  answer: SymbolId[];
  number: number | null;
  points: number;
  elapsedMs: number;
  hintLevel: number;
}

export interface LiveState {
  hands: HandAnalysis[];
  match: MatchState | null;
  /** 0..1 — drives the big hold-to-lock ring */
  holdProgress: number;
  /** per required hand, 0..1 */
  slotProgress: number[];
  /** ms the player has been on the current question */
  elapsedMs: number;
  fps: number;
  inferenceMs: number;
  /** true when the player is showing a stable but wrong combination */
  nudging: boolean;
}

export interface GameSnapshot {
  phase: Phase;
  roundNumber: number;
  totalRounds: number;
  question: Question | null;
  answer: SymbolId[];
  score: number;
  streak: number;
  bestStreak: number;
  solvedCount: number;
  hintLevel: number;
  lastRound: RoundResult | null;
  live: LiveState;
}

export type EngineEvent =
  | { type: 'game-start' }
  | { type: 'round-start'; question: Question }
  | { type: 'hold-tick'; progress: number }
  | { type: 'correct'; result: RoundResult }
  | { type: 'wrong'; showing: string }
  | { type: 'hint'; level: number }
  | { type: 'game-end'; score: number; solved: number; bestStreak: number }
  | { type: 'attract' };

export interface EngineOptions {
  /** questions per booth session */
  rounds?: number;
  /** how long the correct gesture must be held, in ms */
  holdMs?: number;
  /** celebration length before the next question */
  celebrateMs?: number;
  /** summary screen length */
  summaryMs?: number;
  /** no hands for this long -> back to attract mode */
  idleToAttractMs?: number;
  /** how long a hand must be up to start a session from attract mode */
  startHoldMs?: number;
  /** ms on a question before hint 1 / 2 / 3 */
  hintTimesMs?: [number, number, number];
  /** ms of stable-but-wrong combo before the gentle nudge */
  nudgeAfterMs?: number;
  rng?: () => number;
  onEvent?: (event: EngineEvent) => void;
}

const DEFAULTS: Required<Omit<EngineOptions, 'onEvent' | 'rng'>> = {
  rounds: 7,
  holdMs: 1300,
  celebrateMs: 2600,
  summaryMs: 9000,
  idleToAttractMs: 30000,
  startHoldMs: 900,
  hintTimesMs: [9000, 18000, 27000],
  nudgeAfterMs: 1400,
};

function emptyLive(): LiveState {
  return {
    hands: [],
    match: null,
    holdProgress: 0,
    slotProgress: [],
    elapsedMs: 0,
    fps: 0,
    inferenceMs: 0,
    nudging: false,
  };
}

export class BoothGame {
  private readonly opts: Required<Omit<EngineOptions, 'onEvent' | 'rng'>> & {
    onEvent?: (event: EngineEvent) => void;
    rng: () => number;
  };

  private listeners = new Set<() => void>();
  private snapshot: GameSnapshot;
  private session: Question[] = [];
  private roundIndex = 0;
  private phaseStartedAt = 0;
  private questionStartedAt = 0;
  private lastTickAt = 0;
  private slotHoldMs: number[] = [];
  private handPresentSince = 0;
  private lastHandSeenAt = 0;
  private lastNudgeAt = Number.NEGATIVE_INFINITY;
  private wrongStableMs = 0;
  private lastEmittedHint = 0;

  constructor(options: EngineOptions = {}) {
    const { onEvent, rng, ...rest } = options;
    this.opts = {
      ...DEFAULTS,
      ...rest,
      rng: rng ?? Math.random,
      ...(onEvent ? { onEvent } : {}),
    };
    this.snapshot = {
      phase: 'attract',
      roundNumber: 0,
      totalRounds: this.opts.rounds,
      question: null,
      answer: [],
      score: 0,
      streak: 0,
      bestStreak: 0,
      solvedCount: 0,
      hintLevel: 0,
      lastRound: null,
      live: emptyLive(),
    };
  }

  // ---- store plumbing ----------------------------------------------------
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): GameSnapshot => this.snapshot;

  private commit(patch: Partial<GameSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private emit(event: EngineEvent): void {
    this.opts.onEvent?.(event);
  }

  get holdMs(): number {
    return this.opts.holdMs;
  }

  // ---- lifecycle ---------------------------------------------------------
  startSession(now: number): void {
    this.session = pickSession(this.opts.rounds, this.opts.rng);
    this.roundIndex = 0;
    this.commit({
      phase: 'playing',
      score: 0,
      streak: 0,
      bestStreak: 0,
      solvedCount: 0,
      hintLevel: 0,
      lastRound: null,
      roundNumber: 1,
      totalRounds: this.session.length,
    });
    this.emit({ type: 'game-start' });
    this.beginQuestion(now);
  }

  /** Drop back to attract mode and forget the run in progress. */
  toAttract(): void {
    this.session = [];
    this.roundIndex = 0;
    this.slotHoldMs = [];
    this.wrongStableMs = 0;
    this.lastEmittedHint = 0;
    const live = this.snapshot.live;
    live.match = null;
    live.holdProgress = 0;
    live.slotProgress = [];
    live.nudging = false;
    this.commit({
      phase: 'attract',
      question: null,
      answer: [],
      roundNumber: 0,
      hintLevel: 0,
      lastRound: null,
    });
    this.emit({ type: 'attract' });
  }

  /** Host shortcut: skip the current question. */
  skip(now: number): void {
    if (this.snapshot.phase !== 'playing') return;
    this.nextQuestion(now);
  }

  private beginQuestion(now: number): void {
    const question = this.session[this.roundIndex] ?? null;
    if (!question) {
      this.finish(now);
      return;
    }
    this.questionStartedAt = now;
    this.slotHoldMs = new Array(question.answer.length).fill(0);
    this.wrongStableMs = 0;
    this.lastNudgeAt = Number.NEGATIVE_INFINITY;
    this.lastEmittedHint = 0;

    const live = this.snapshot.live;
    live.holdProgress = 0;
    live.slotProgress = [];
    live.nudging = false;
    live.match = null;
    live.elapsedMs = 0;

    this.commit({
      phase: 'playing',
      question,
      answer: question.answer,
      roundNumber: this.roundIndex + 1,
      hintLevel: 0,
    });
    this.emit({ type: 'round-start', question });
  }

  private nextQuestion(now: number): void {
    this.roundIndex += 1;
    if (this.roundIndex >= this.session.length) {
      this.finish(now);
      return;
    }
    this.beginQuestion(now);
  }

  private finish(now: number): void {
    this.phaseStartedAt = now;
    const live = this.snapshot.live;
    live.holdProgress = 0;
    live.match = null;
    live.nudging = false;
    this.commit({ phase: 'finished', question: null, answer: [], hintLevel: 0 });
    this.emit({
      type: 'game-end',
      score: this.snapshot.score,
      solved: this.snapshot.solvedCount,
      bestStreak: this.snapshot.bestStreak,
    });
  }

  // ---- per-frame ---------------------------------------------------------
  tick(hands: HandAnalysis[], now: number, fps: number, inferenceMs: number): void {
    const dt = this.lastTickAt === 0 ? 16 : Math.min(120, now - this.lastTickAt);
    this.lastTickAt = now;

    const live = this.snapshot.live;
    live.hands = hands;
    live.fps = fps;
    live.inferenceMs = inferenceMs;

    if (hands.length > 0) this.lastHandSeenAt = now;

    switch (this.snapshot.phase) {
      case 'attract':
        this.tickAttract(hands, now);
        break;
      case 'playing':
        this.tickPlaying(hands, now, dt);
        break;
      case 'celebrate':
        if (now - this.phaseStartedAt >= this.opts.celebrateMs) this.nextQuestion(now);
        break;
      case 'finished':
        if (now - this.phaseStartedAt >= this.opts.summaryMs) this.toAttract();
        break;
    }

    // Anyone who walks away for long enough frees the booth for the next player.
    if (
      this.snapshot.phase !== 'attract' &&
      now - this.lastHandSeenAt > this.opts.idleToAttractMs
    ) {
      this.toAttract();
    }
  }

  private tickAttract(hands: HandAnalysis[], now: number): void {
    const showingSomething = hands.some((h) => h.symbol !== null);
    if (!showingSomething) {
      this.handPresentSince = 0;
      return;
    }
    if (this.handPresentSince === 0) this.handPresentSince = now;
    if (now - this.handPresentSince >= this.opts.startHoldMs) {
      this.handPresentSince = 0;
      this.startSession(now);
    }
  }

  private tickPlaying(hands: HandAnalysis[], now: number, dt: number): void {
    const question = this.snapshot.question;
    if (!question) return;

    const live = this.snapshot.live;
    const elapsed = now - this.questionStartedAt;
    live.elapsedMs = elapsed;

    // Escalating hints — the game never fails the player, it just helps more.
    const [t1, t2, t3] = this.opts.hintTimesMs;
    let hintLevel = 0;
    if (elapsed >= t3) hintLevel = 3;
    else if (elapsed >= t2) hintLevel = 2;
    else if (elapsed >= t1) hintLevel = 1;
    if (hintLevel !== this.lastEmittedHint) {
      this.lastEmittedHint = hintLevel;
      this.commit({ hintLevel });
      if (hintLevel > 0) this.emit({ type: 'hint', level: hintLevel });
    }

    const match = matchAnswer(hands, question.answer);
    live.match = match;

    // Per-hand hold timers. A wrong or missing hand bleeds off quickly rather
    // than snapping to zero, so a one-frame dropout does not punish the player.
    let progress = 1;
    const slotProgress: number[] = [];
    for (let i = 0; i < match.slots.length; i++) {
      const slot = match.slots[i]!;
      const current = this.slotHoldMs[i] ?? 0;
      let next: number;
      if (slot.ok) next = Math.min(this.opts.holdMs, current + dt);
      else next = Math.max(0, current - dt * 2.5);
      this.slotHoldMs[i] = next;
      const p = next / this.opts.holdMs;
      slotProgress.push(p);
      progress = Math.min(progress, p);
    }
    live.slotProgress = slotProgress;
    live.holdProgress = progress;

    // Gentle "not quite" nudge: only when both hands are confidently read and
    // the combination has been stable for a moment, so mid-transition poses
    // never trigger it.
    if (match.allRecognised && !match.ok) {
      this.wrongStableMs += dt;
    } else {
      this.wrongStableMs = Math.max(0, this.wrongStableMs - dt * 2);
    }
    const shouldNudge =
      match.allRecognised &&
      !match.ok &&
      this.wrongStableMs >= this.opts.nudgeAfterMs &&
      now - this.lastNudgeAt > 4500;
    live.nudging = match.allRecognised && !match.ok && this.wrongStableMs >= this.opts.nudgeAfterMs;
    if (shouldNudge) {
      this.lastNudgeAt = now;
      this.emit({ type: 'wrong', showing: describeShowing(hands) ?? 'nothing yet' });
    }

    if (match.ok && progress >= 1) this.completeRound(elapsed, now);
  }

  private completeRound(elapsedMs: number, now: number): void {
    const question = this.snapshot.question;
    if (!question) return;

    const hintLevel = this.snapshot.hintLevel;
    const speedBonus = Math.round(60 * Math.max(0, 1 - elapsedMs / 15000));
    const streakBonus = this.snapshot.streak * 25;
    const points = Math.max(10, 100 + speedBonus + streakBonus - hintLevel * 20);

    const streak = this.snapshot.streak + 1;
    const result: RoundResult = {
      question,
      answer: question.answer,
      number: symbolsToNumber(question.answer),
      points,
      elapsedMs,
      hintLevel,
    };

    this.phaseStartedAt = now;
    const live = this.snapshot.live;
    live.holdProgress = 1;
    live.nudging = false;

    this.commit({
      phase: 'celebrate',
      score: this.snapshot.score + points,
      streak,
      bestStreak: Math.max(this.snapshot.bestStreak, streak),
      solvedCount: this.snapshot.solvedCount + 1,
      lastRound: result,
    });
    this.emit({ type: 'correct', result });
  }
}
