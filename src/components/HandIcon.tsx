/**
 * A parametric hand icon drawn from the same finger states the classifier
 * looks for. One SVG renderer covers every symbol, so the legend, the hints
 * and the attract-mode demo can never drift out of sync with the game rules.
 */

import { SYMBOLS, type SymbolId } from '../game/symbols.ts';

const FINGERS = [
  { key: 'index', base: { x: 46, y: 70 }, angle: -6, len: 36 },
  { key: 'middle', base: { x: 60, y: 68 }, angle: 1, len: 40 },
  { key: 'ring', base: { x: 74, y: 70 }, angle: 9, len: 36 },
  { key: 'pinky', base: { x: 86, y: 75 }, angle: 17, len: 28 },
] as const;

const THUMB = { base: { x: 34, y: 104 }, angle: -52, len: 28 };

const PALM_PATH =
  'M 32 90 C 30 74 38 66 50 66 L 72 66 C 86 66 94 74 92 90 L 90 116 C 89 130 80 136 68 136 L 52 136 C 40 136 32 130 31 116 Z';

function direction(angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: Math.sin(a), y: -Math.cos(a) };
}

/** Two-segment finger that folds over the palm as `curl` goes 0 -> 1. */
function fingerPath(base: { x: number; y: number }, angle: number, len: number, curl: number): string {
  const seg = len / 2;
  const d1 = direction(angle);
  const mid = { x: base.x + d1.x * seg, y: base.y + d1.y * seg };
  const d2 = direction(angle + curl * 150);
  const tip = { x: mid.x + d2.x * seg, y: mid.y + d2.y * seg };
  const r = (n: number) => Math.round(n * 10) / 10;
  return `M ${r(base.x)} ${r(base.y)} Q ${r(mid.x)} ${r(mid.y)} ${r(tip.x)} ${r(tip.y)}`;
}

export interface HandIconProps {
  symbol: SymbolId;
  /** rendered height in px; width follows the 120x150 aspect */
  size?: number;
  className?: string;
}

export function HandIcon({ symbol, size = 72, className }: HandIconProps) {
  const def = SYMBOLS[symbol];
  const pose = def.pose;
  const width = (size * 120) / 150;

  const paths: string[] = [];

  if (pose.pinch) {
    // Thumb and index meet to form the ring; drawn explicitly because the
    // generic two-segment finger cannot reach across the palm.
    paths.push('M 46 70 C 44 58 46 50 56 47'); // index, curling down
    paths.push('M 34 104 C 26 84 30 56 56 47'); // thumb, arcing up to meet it
  }

  for (const f of FINGERS) {
    if (pose.pinch && f.key === 'index') continue;
    paths.push(fingerPath(f.base, f.angle, f.len, pose[f.key]));
  }

  if (!pose.pinch) {
    // A thumbs-up needs a longer, more vertical thumb, otherwise the palm
    // (drawn on top) swallows it.
    const thumbAngle = pose.thumbUp ? -6 : THUMB.angle;
    const thumbLen = pose.thumbUp ? 56 : THUMB.len;
    paths.push(fingerPath(THUMB.base, thumbAngle, thumbLen, pose.thumb));
  }

  return (
    <svg
      className={className}
      width={width}
      height={size}
      viewBox="0 0 120 150"
      role="img"
      aria-label={`${def.name}: ${def.howTo}`}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={14}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="hand-icon__stroke"
      >
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <path d={PALM_PATH} fill="currentColor" className="hand-icon__palm" />
      {pose.pinch ? <circle cx={56} cy={47} r={5} fill="currentColor" className="hand-icon__palm" /> : null}
    </svg>
  );
}

export default HandIcon;
