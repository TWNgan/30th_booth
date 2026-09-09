/**
 * Owns the webcam, the MediaPipe HandLandmarker and the render loop.
 *
 * The important trick here is decoupling the two rates:
 *
 *   - inference runs at `targetFps` (30 by default — a 1.3 s hold does not
 *     need more, and it keeps the fan quiet at a booth)
 *   - the displayed landmarks ease towards the newest detection every
 *     animation frame, so the skeleton glides at a full 60 fps even when the
 *     model is only keeping up at 25
 *
 * Each hand also gets a stable "slot" so it keeps its identity while it moves,
 * and the symbol is decided by a majority vote over the last few detections,
 * which is what stops the on-screen digit badge flickering mid-gesture.
 */

import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { analyseHand, type HandAnalysis } from './classifier.ts';
import { smoothTowards, type Vec3 } from './geometry.ts';
import type { SymbolId } from '../game/symbols.ts';

export interface TrackerFrame {
  hands: HandAnalysis[];
  /** timestamp of this frame (performance.now()) */
  timestamp: number;
  /** measured detection rate */
  fps: number;
  /** time spent inside the model per detection */
  inferenceMs: number;
}

export interface TrackerOptions {
  maxHands?: number;
  targetFps?: number;
  /** smoothing half-life for the displayed skeleton, in ms */
  smoothingHalfLifeMs?: number;
  voteWindow?: number;
  preferGpu?: boolean;
  /** how long a hand may go undetected before it is dropped, in ms */
  lostAfterMs?: number;
}

export type TrackerStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; detail: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

interface Slot {
  id: number;
  /** newest raw detection */
  target: Vec3[];
  targetWorld: Vec3[] | null;
  /** eased landmarks used for drawing and classification */
  display: Vec3[];
  displayWorld: Vec3[] | null;
  lastSeen: number;
  handedness: string;
  handednessScore: number;
  votes: Array<{ symbol: SymbolId | null; confidence: number }>;
}

const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/models/hand_landmarker.task';

function toVec3(landmarks: NormalizedLandmark[]): Vec3[] {
  return landmarks.map((l) => ({ x: l.x, y: l.y, z: l.z }));
}

function easePoints(prev: Vec3[], next: Vec3[], dtMs: number, halfLifeMs: number): Vec3[] {
  const out: Vec3[] = new Array(next.length);
  for (let i = 0; i < next.length; i++) {
    const p = prev[i];
    const q = next[i]!;
    out[i] = p
      ? {
          x: smoothTowards(p.x, q.x, dtMs, halfLifeMs),
          y: smoothTowards(p.y, q.y, dtMs, halfLifeMs),
          z: smoothTowards(p.z, q.z, dtMs, halfLifeMs),
        }
      : q;
  }
  return out;
}

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private running = false;
  private lastDetectAt = 0;
  private lastFrameAt = 0;
  private fps = 0;
  private inferenceMs = 0;
  private slots: Slot[] = [];
  private nextSlotId = 0;
  private latest: HandAnalysis[] = [];

  readonly opts: Required<TrackerOptions>;

  onFrame: ((frame: TrackerFrame) => void) | null = null;
  onStatus: ((status: TrackerStatus) => void) | null = null;

  constructor(opts: TrackerOptions = {}) {
    this.opts = {
      maxHands: opts.maxHands ?? 2,
      targetFps: opts.targetFps ?? 30,
      smoothingHalfLifeMs: opts.smoothingHalfLifeMs ?? 55,
      voteWindow: opts.voteWindow ?? 5,
      preferGpu: opts.preferGpu ?? true,
      lostAfterMs: opts.lostAfterMs ?? 320,
    };
  }

  async load(): Promise<void> {
    if (this.landmarker) return;
    this.onStatus?.({ kind: 'loading', detail: 'Starting the vision runtime…' });
    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      this.onStatus?.({ kind: 'loading', detail: 'Loading the hand model…' });
      this.landmarker = await this.createLandmarker(fileset, this.opts.preferGpu ? 'GPU' : 'CPU');
      this.onStatus?.({ kind: 'ready' });
    } catch (firstError) {
      // Software rendering or a locked-down GPU is common on booth machines;
      // retry on the CPU delegate before reporting a failure.
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
        this.landmarker = await this.createLandmarker(fileset, 'CPU');
        this.onStatus?.({ kind: 'ready' });
      } catch {
        this.onStatus?.({ kind: 'error', message: describeError(firstError) });
      }
    }
  }

  private async createLandmarker(
    fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
    delegate: 'GPU' | 'CPU',
  ): Promise<HandLandmarker> {
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: 'VIDEO',
      numHands: this.opts.maxHands,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  async start(video: HTMLVideoElement): Promise<void> {
    if (this.running) return;
    this.video = video;
    await this.load();
    if (!this.landmarker) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      this.onStatus?.({
        kind: 'error',
        message: 'This browser cannot reach the camera. Open the booth over http://localhost or https://.',
      });
      return;
    }

    this.onStatus?.({ kind: 'loading', detail: 'Waking up the camera…' });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 },
        },
      });
    } catch (error) {
      this.onStatus?.({ kind: 'error', message: `Camera unavailable — ${describeError(error)}` });
      return;
    }

    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => undefined);

    this.running = true;
    this.lastDetectAt = 0;
    this.lastFrameAt = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);

    const video = this.video;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return;

    const dt = this.lastFrameAt === 0 ? 16 : Math.min(120, now - this.lastFrameAt);
    this.lastFrameAt = now;

    const minInterval = 1000 / this.opts.targetFps;
    if (now - this.lastDetectAt >= minInterval - 1) {
      const delta = this.lastDetectAt === 0 ? minInterval : now - this.lastDetectAt;
      this.lastDetectAt = now;
      this.detect(video, now, delta);
    }

    this.easeSlots(now, dt);
    this.rebuildAnalyses(video);
    this.onFrame?.({
      hands: this.latest,
      timestamp: now,
      fps: this.fps,
      inferenceMs: this.inferenceMs,
    });
  };

  /** Runs the model and refreshes each slot's target landmarks. */
  private detect(video: HTMLVideoElement, now: number, delta: number): void {
    const landmarker = this.landmarker;
    if (!landmarker) return;

    const t0 = performance.now();
    let result;
    try {
      result = landmarker.detectForVideo(video, now);
    } catch {
      // A single dropped frame is not worth surfacing; the next one will do.
      return;
    }
    this.inferenceMs = performance.now() - t0;
    const instantFps = 1000 / Math.max(1, delta);
    this.fps = this.fps === 0 ? instantFps : this.fps * 0.88 + instantFps * 0.12;

    const rawHands = (result.landmarks ?? []).map(toVec3);
    const rawWorld = (result.worldLandmarks ?? []).map(toVec3);
    const handedness = result.handedness ?? result.handednesses ?? [];
    const aspect = video.videoWidth / Math.max(1, video.videoHeight);

    this.assignSlots(rawHands, rawWorld, handedness, now);

    // Vote on the raw detection, not on the eased one, so the badge reflects
    // what the model actually saw.
    for (const slot of this.slots) {
      if (slot.lastSeen !== now) continue;
      const analysis = analyseHand(slot.target, slot.targetWorld, {
        aspect,
        slot: slot.id,
        handedness: slot.handedness,
        handednessScore: slot.handednessScore,
      });
      slot.votes.push({ symbol: analysis?.symbol ?? null, confidence: analysis?.symbolConfidence ?? 0 });
      while (slot.votes.length > this.opts.voteWindow) slot.votes.shift();
    }
  }

  /** Glides the displayed landmarks towards the newest detection. */
  private easeSlots(now: number, dt: number): void {
    for (const slot of this.slots) {
      slot.display = easePoints(slot.display, slot.target, dt, this.opts.smoothingHalfLifeMs);
      if (slot.targetWorld && slot.displayWorld) {
        slot.displayWorld = easePoints(slot.displayWorld, slot.targetWorld, dt, this.opts.smoothingHalfLifeMs);
      } else {
        slot.displayWorld = slot.targetWorld ? slot.targetWorld.map((p) => ({ ...p })) : null;
      }
    }
    this.slots = this.slots.filter((slot) => now - slot.lastSeen < this.opts.lostAfterMs);
  }

  /** Classifies the eased landmarks into the frame the game consumes. */
  private rebuildAnalyses(video: HTMLVideoElement): void {
    const aspect = video.videoWidth / Math.max(1, video.videoHeight);
    const hands: HandAnalysis[] = [];

    for (const slot of this.slots) {
      const analysis = analyseHand(slot.display, slot.displayWorld, {
        aspect,
        slot: slot.id,
        handedness: slot.handedness,
        handednessScore: slot.handednessScore,
      });
      if (!analysis) continue;
      analysis.symbol = this.votedSymbol(slot);
      hands.push(analysis);
    }

    // Screen-left hand first, so tens/ones ordering is stable for the game.
    hands.sort((a, b) => a.screenX - b.screenX);
    this.latest = hands;
  }

  /**
   * Match this frame's detections onto persistent slots by nearest centre, so a
   * hand keeps its identity (and its smoothing) while it moves.
   */
  private assignSlots(
    rawHands: Vec3[][],
    rawWorld: Vec3[][],
    handedness: Array<Array<{ categoryName?: string; score: number }>>,
    now: number,
  ): void {
    const used = new Set<number>();

    for (let i = 0; i < rawHands.length; i++) {
      const lms = rawHands[i];
      if (!lms || lms.length < 21) continue;
      const centre = { x: 1 - (lms[0]!.x + lms[9]!.x) / 2, y: (lms[0]!.y + lms[9]!.y) / 2 };

      let best: Slot | null = null;
      let bestDistance = 0.4; // a hand cannot teleport across the frame
      for (const slot of this.slots) {
        if (used.has(slot.id)) continue;
        const prev = slot.target;
        const prevCentre = { x: 1 - (prev[0]!.x + prev[9]!.x) / 2, y: (prev[0]!.y + prev[9]!.y) / 2 };
        const d = Math.hypot(centre.x - prevCentre.x, centre.y - prevCentre.y);
        if (d < bestDistance) {
          bestDistance = d;
          best = slot;
        }
      }

      if (!best) {
        best = {
          id: this.nextSlotId++,
          target: lms,
          targetWorld: rawWorld[i] ?? null,
          display: lms.map((p) => ({ ...p })),
          displayWorld: rawWorld[i] ? rawWorld[i]!.map((p) => ({ ...p })) : null,
          lastSeen: now,
          handedness: 'Unknown',
          handednessScore: 0,
          votes: [],
        };
        this.slots.push(best);
      } else {
        best.target = lms;
        best.targetWorld = rawWorld[i] ?? null;
        best.lastSeen = now;
      }

      best.handedness = handedness[i]?.[0]?.categoryName ?? 'Unknown';
      best.handednessScore = handedness[i]?.[0]?.score ?? 0;
      used.add(best.id);
    }
  }

  /** Majority vote over the recent detections, so the badge cannot flicker. */
  private votedSymbol(slot: Slot): SymbolId | null {
    const tally = new Map<string, number>();
    for (const vote of slot.votes) {
      const key = vote.symbol ?? '__none__';
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }

    let winner: string | null = null;
    let winnerCount = 0;
    for (const [key, count] of tally) {
      if (count > winnerCount) {
        winnerCount = count;
        winner = key;
      }
    }
    if (!winner || winner === '__none__' || winnerCount * 2 <= this.opts.voteWindow) return null;
    return winner as SymbolId;
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown error';
}
