/**
 * Turns MediaPipe's 21 landmarks into a game symbol (0-9 or thumbs up).
 *
 * Everything is measured relative to the palm (`palmSize` = wrist -> middle
 * MCP), so a player standing 1 m away and a player standing 3 m away produce
 * the same numbers. Angles come from the metric `worldLandmarks` when
 * available, because those are far less distorted by perspective than the
 * normalised image landmarks.
 */

import { LM, angleAt, clamp, distance, length, sub, type Vec3 } from './geometry.ts';
import type { SymbolId } from '../game/symbols.ts';

export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';

export interface FingerState {
  /** 0..1 — how confident we are that the finger is held out straight */
  extension: number;
  extended: boolean;
}

export interface HandAnalysis {
  /** stable slot id for the current tracking session */
  slot: number;
  handedness: 'Left' | 'Right' | 'Unknown';
  handednessScore: number;
  /** normalised image landmarks (0..1), mirrored-space drawing is done by the caller */
  landmarks: Vec3[];
  /** smoothed centre in normalised image space */
  center: { x: number; y: number };
  /** mirrored centre x (0 = left edge of the screen the player sees) */
  screenX: number;
  /** wrist -> middle MCP distance in normalised units, for sizing the overlay */
  palmSize: number;
  fingers: Record<FingerName, FingerState>;
  symbol: SymbolId | null;
  /** 0..1 */
  symbolConfidence: number;
  /** thumb tip <-> index tip distance over palm size; small = pinching */
  pinchRatio: number;
  debug: Record<string, number>;
}

interface FingerSpec {
  key: Exclude<FingerName, 'thumb'>;
  mcp: number;
  pip: number;
  dip: number;
  tip: number;
}

const FINGERS: FingerSpec[] = [
  { key: 'index', mcp: LM.INDEX_MCP, pip: LM.INDEX_PIP, dip: LM.INDEX_DIP, tip: LM.INDEX_TIP },
  { key: 'middle', mcp: LM.MIDDLE_MCP, pip: LM.MIDDLE_PIP, dip: LM.MIDDLE_DIP, tip: LM.MIDDLE_TIP },
  { key: 'ring', mcp: LM.RING_MCP, pip: LM.RING_PIP, dip: LM.RING_DIP, tip: LM.RING_TIP },
  { key: 'pinky', mcp: LM.PINKY_MCP, pip: LM.PINKY_PIP, dip: LM.PINKY_DIP, tip: LM.PINKY_TIP },
];

const noFinger: FingerState = { extension: 0, extended: false };

function mkFinger(extension: number): FingerState {
  return { extension, extended: extension >= 0.5 };
}

function emptyFingers(): Record<FingerName, FingerState> {
  return {
    thumb: { ...noFinger },
    index: { ...noFinger },
    middle: { ...noFinger },
    ring: { ...noFinger },
    pinky: { ...noFinger },
  };
}

/**
 * Landmarks arrive normalised by image width/height, which makes x and y use
 * different scales. Multiply x (and z) by the aspect ratio so distances are
 * isotropic before we take any ratios.
 */
function toIsotropic(landmarks: Vec3[], aspect: number): Vec3[] {
  return landmarks.map((p) => ({ x: p.x * aspect, y: p.y, z: p.z * aspect }));
}

/** Confidence that a value is above `threshold`, ramping over `softness`. */
function above(value: number, threshold: number, softness: number): number {
  return clamp((value - threshold) / softness + 0.5, 0, 1);
}

export interface AnalyseOptions {
  aspect: number;
  slot: number;
  handedness: string;
  handednessScore: number;
}

export function analyseHand(
  imageLandmarks: Vec3[],
  worldLandmarks: Vec3[] | null,
  opts: AnalyseOptions,
): HandAnalysis | null {
  if (imageLandmarks.length < 21) return null;

  // Prefer metric world landmarks for geometry; fall back to aspect-corrected
  // image landmarks if the model did not return them.
  const geo = worldLandmarks && worldLandmarks.length >= 21 ? worldLandmarks : toIsotropic(imageLandmarks, opts.aspect);
  const palmSize = distance(geo[LM.WRIST]!, geo[LM.MIDDLE_MCP]!);
  if (palmSize < 1e-6) return null;
  const n = (i: number) => geo[i]!;

  // ---- four main fingers -------------------------------------------------
  const fingers = emptyFingers();
  const debug: Record<string, number> = { palmSize };

  for (const spec of FINGERS) {
    const mcp = n(spec.mcp);
    const pip = n(spec.pip);
    const dip = n(spec.dip);
    const tip = n(spec.tip);

    const straightness = (angleAt(mcp, pip, dip) + angleAt(pip, dip, tip)) / 2;
    const reach = distance(n(LM.WRIST), tip) / Math.max(1e-6, distance(n(LM.WRIST), mcp));

    // A finger counts as out only when it is both straight AND reaching away
    // from the wrist. Requiring both kills the classic false positive where a
    // curled finger still looks fairly straight from the camera's angle.
    const straightScore = above(straightness, 148, 34);
    const reachScore = above(reach, 1.42, 0.42);
    const extension = Math.min(straightScore, reachScore);

    fingers[spec.key] = mkFinger(extension);
    debug[`${spec.key}.straight`] = straightness;
    debug[`${spec.key}.reach`] = reach;
    debug[`${spec.key}.ext`] = extension;
  }

  // ---- thumb -------------------------------------------------------------
  // The thumb bends in a different plane, so it gets its own rules:
  //  * `straightness` — is the thumb itself extended?
  //  * `reach`        — is the tip out past the palm, or folded onto it?
  //
  // Reach is measured from the wrist rather than from the pinky knuckle: a
  // tucked thumb and a thumbs-up both sit near the knuckles, so knuckle
  // distance cannot tell them apart, but a thumbs-up tip is still a full
  // palm-length away from the wrist.
  const thumbStraightness = (angleAt(n(LM.THUMB_CMC), n(LM.THUMB_MCP), n(LM.THUMB_IP)) +
    angleAt(n(LM.THUMB_MCP), n(LM.THUMB_IP), n(LM.THUMB_TIP))) / 2;
  const thumbReach = distance(n(LM.WRIST), n(LM.THUMB_TIP)) / palmSize;
  const thumbSpread = distance(n(LM.THUMB_TIP), n(LM.PINKY_MCP)) / palmSize;
  const thumbAwayFromIndex = distance(n(LM.THUMB_TIP), n(LM.INDEX_MCP)) / palmSize;

  const thumbStraightScore = above(thumbStraightness, 146, 36);
  const thumbReachScore = above(thumbReach, 0.95, 0.3);
  const thumbExtension = Math.min(thumbStraightScore, thumbReachScore);
  fingers.thumb = mkFinger(thumbExtension);

  // Thumb axis in image space. y grows downwards, so a thumbs-up direction has
  // a strongly negative y component.
  const thumbAxis = sub(n(LM.THUMB_TIP), n(LM.THUMB_CMC));
  const thumbAxisLength = Math.max(1e-6, length(thumbAxis));
  const thumbDirY = thumbAxis.y / thumbAxisLength;

  debug['thumb.straight'] = thumbStraightness;
  debug['thumb.reach'] = thumbReach;
  debug['thumb.spread'] = thumbSpread;
  debug['thumb.awayFromIndex'] = thumbAwayFromIndex;
  debug['thumb.dirY'] = thumbDirY;
  debug['thumb.ext'] = thumbExtension;

  // ---- pinch / OK ring ---------------------------------------------------
  // Touching tips alone are not enough: in a closed fist the thumb tip rests
  // right on the curled index tip, so a bare distance test reads every fist as
  // a nine. A real ring also requires the index to be reaching out to meet the
  // thumb rather than folded into the palm, which is what `index.reach` shows.
  const pinchRatio = distance(n(LM.THUMB_TIP), n(LM.INDEX_TIP)) / palmSize;
  const indexReach = distance(n(LM.WRIST), n(LM.INDEX_TIP)) / palmSize;
  debug['pinch'] = pinchRatio;
  debug['index.reachAbs'] = indexReach;
  const pinchScore = clamp((0.62 - pinchRatio) / 0.22, 0, 1);
  const ringScore = above(indexReach, 1.15, 0.35);
  const isPinching = pinchRatio < 0.46 && indexReach > 1.15;

  const i = fingers.index.extended;
  const m = fingers.middle.extended;
  const r = fingers.ring.extended;
  const p = fingers.pinky.extended;
  const thumbOut = fingers.thumb.extended;
  const raised = [i, m, r, p].filter(Boolean).length;
  const certainty = (ext: number) => Math.abs(ext - 0.5) * 2;

  // ---- thumbs up ---------------------------------------------------------
  // A fist whose thumb is genuinely standing up: extended, pointing at the top
  // of the image, and clearing the knuckles. Deliberately strict — a false
  // positive here would steal the "0" gesture the anniversary answer needs.
  const thumbUpRatio = (n(LM.INDEX_MCP).y - n(LM.THUMB_TIP).y) / palmSize;
  debug['thumb.up'] = thumbUpRatio;
  const isThumbUp = raised === 0 && thumbExtension > 0.5 && thumbDirY < -0.6 && thumbUpRatio > 0.05;

  // ---- decision tree -----------------------------------------------------
  const out = (id: SymbolId | null, confidence: number): { symbol: SymbolId | null; confidence: number } => ({
    symbol: id,
    confidence: clamp(confidence, 0, 1),
  });

  let result: { symbol: SymbolId | null; confidence: number };

  if (isPinching && m && r && p) {
    // OK sign: ring closed with the thumb, three fingers standing.
    result = out(
      '3',
      Math.min(pinchScore, ringScore, fingers.middle.extension, fingers.ring.extension, fingers.pinky.extension),
    );
  } else if (isPinching && !m && !r && !p) {
    // Pinch with everything else folded.
    result = out(
      '9',
      Math.min(pinchScore, ringScore, certainty(fingers.middle.extension), certainty(fingers.ring.extension)),
    );
  } else if (raised === 0) {
    if (isThumbUp) {
      result = out('thumbsUp', Math.min(certainty(fingers.index.extension), thumbExtension));
    } else if (thumbOut) {
      // Fist with the thumb sticking out sideways reads as a shaka half-way
      // house; treat as ambiguous rather than guessing.
      result = out('0', Math.min(certainty(fingers.index.extension), 1 - thumbExtension) * 0.9);
    } else {
      result = out(
        '0',
        Math.min(
          certainty(fingers.index.extension),
          certainty(fingers.middle.extension),
          certainty(fingers.ring.extension),
          certainty(fingers.pinky.extension),
        ),
      );
    }
  } else if (i && m && r && p) {
    // Four or five — only the thumb tells them apart.
    result = thumbOut
      ? out('5', Math.min(fingers.index.extension, fingers.pinky.extension, thumbExtension))
      : out('4', Math.min(fingers.index.extension, fingers.pinky.extension, 1 - thumbExtension));
  } else if (i && m && r && !p) {
    result = out(null, 0.2);
  } else if (!i && !m && !r && p) {
    result = thumbOut
      ? out('6', Math.min(fingers.pinky.extension, thumbExtension))
      : out(null, 0.2);
  } else if (i && m && !r && !p) {
    result = thumbOut
      ? out('7', Math.min(fingers.index.extension, fingers.middle.extension, thumbExtension))
      : out('2', Math.min(fingers.index.extension, fingers.middle.extension, 1 - thumbExtension));
  } else if (i && !m && !r && !p) {
    result = thumbOut
      ? out('8', Math.min(fingers.index.extension, thumbExtension))
      : out('1', Math.min(fingers.index.extension, 1 - thumbExtension));
  } else {
    result = out(null, 0);
  }

  // A fist whose thumb is out sideways is the single most common source of
  // confusion between 0 and 6, so require a little more evidence for 6.
  if (result.symbol === '6' && result.confidence < 0.35) {
    result = out(null, 0);
  }

  const wrist = imageLandmarks[LM.WRIST]!;
  const middleMcp = imageLandmarks[LM.MIDDLE_MCP]!;
  const center = {
    x: (wrist.x + middleMcp.x) / 2,
    y: (wrist.y + middleMcp.y) / 2,
  };

  return {
    slot: opts.slot,
    handedness: opts.handedness === 'Left' || opts.handedness === 'Right' ? opts.handedness : 'Unknown',
    handednessScore: opts.handednessScore,
    landmarks: imageLandmarks,
    center,
    screenX: 1 - center.x,
    // Normalised palm size with x corrected for the frame's aspect ratio, so
    // the on-screen overlay is the right size on any display.
    palmSize: Math.hypot((wrist.x - middleMcp.x) * opts.aspect, wrist.y - middleMcp.y),
    fingers,
    symbol: result.symbol,
    symbolConfidence: result.confidence,
    pinchRatio,
    debug,
  };
}
