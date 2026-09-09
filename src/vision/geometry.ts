/**
 * Small 3D geometry helpers used by the hand classifier.
 *
 * MediaPipe gives us 21 landmarks per hand. We normalise everything against the
 * palm so that recognition is invariant to how far away the player stands and
 * how big their hands are.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** MediaPipe landmark indices, named for readability. */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(a: Vec3, k: number): Vec3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/** Angle at `b`, in degrees, for the corner a-b-c. 180° = perfectly straight. */
export function angleAt(a: Vec3, b: Vec3, c: Vec3): number {
  const v1 = sub(a, b);
  const v2 = sub(c, b);
  const denom = length(v1) * length(v2);
  if (denom < 1e-6) return 0;
  const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / denom));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Ease-in-out used for the hold-to-lock ring. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Exponential smoothing that is frame-rate independent.
 * `halfLifeMs` is the time in which the value closes half of the remaining gap.
 */
export function smoothTowards(current: number, target: number, dtMs: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) return target;
  const k = 1 - Math.pow(0.5, dtMs / halfLifeMs);
  return current + (target - current) * k;
}
