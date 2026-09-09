/**
 * The camera overlay: skeleton, per-hand digit badge and the hold-to-lock ring.
 *
 * Everything here is drawn imperatively at frame rate so the 60 fps feedback
 * never touches React. Coordinates arrive normalised (0..1) from MediaPipe and
 * are mapped through the same "cover" fit the <video> uses, then mirrored, so
 * the overlay sits exactly on top of the player's real hands.
 */

import type { HandAnalysis } from '../vision/classifier.ts';
import type { MatchState } from '../game/matcher.ts';
import { SYMBOLS } from '../game/symbols.ts';

const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const COLOR_MATCH = '#6FD6A5';
const COLOR_WRONG = '#FF9FB8';
const COLOR_IDLE = '#B9AEF5';
const COLOR_LOCKED = '#FFC861';

export interface OverlayParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  hands: HandAnalysis[];
  match: MatchState | null;
  slotProgress: number[];
  holdProgress: number;
  videoWidth: number;
  videoHeight: number;
  time: number;
  /** hidden when the booth is in attract mode */
  showSkeleton: boolean;
}

interface Point {
  x: number;
  y: number;
}

function makeMapper(videoW: number, videoH: number, stageW: number, stageH: number) {
  const scale = Math.max(stageW / videoW, stageH / videoH);
  const drawnW = videoW * scale;
  const drawnH = videoH * scale;
  const offsetX = (stageW - drawnW) / 2;
  const offsetY = (stageH - drawnH) / 2;
  // Mirror on x so the stage behaves like a mirror the player can aim with.
  return (x: number, y: number): Point => ({
    x: offsetX + (1 - x) * drawnW,
    y: offsetY + y * drawnH,
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Which required hand (if any) this detection is scoring as. */
function matchIndexFor(hand: HandAnalysis, hands: HandAnalysis[], match: MatchState | null): number {
  if (!match) return -1;
  if (match.slots.length === 1) {
    const want = match.slots[0]!.want;
    if (hand.symbol === want) return 0;
    // Single-hand answer: no ring on the other hand.
    return -1;
  }
  const index = hands.indexOf(hand);
  const slot = match.slots[index];
  if (!slot) return -1;
  return index;
}

export function drawOverlay(params: OverlayParams): void {
  const { ctx, width, height, hands, match, slotProgress, holdProgress, time } = params;
  ctx.clearRect(0, 0, width, height);
  if (!params.showSkeleton || params.videoWidth === 0) return;

  const map = makeMapper(params.videoWidth, params.videoHeight, width, height);
  const px = Math.min(width, height) / 1000; // scale factor for line widths

  for (const hand of hands) {
    const slotIndex = matchIndexFor(hand, hands, match);
    const slot = slotIndex >= 0 ? match?.slots[slotIndex] : undefined;
    const isMatch = Boolean(slot?.ok);
    const recognised = hand.symbol !== null;

    const points = hand.landmarks.map((lm) => map(lm.x, lm.y));
    const color = isMatch ? COLOR_MATCH : recognised ? COLOR_WRONG : COLOR_IDLE;

    // --- skeleton -------------------------------------------------------
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 16 * px + 6;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 7 * px + 2.5;
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      const p = points[a];
      const q = points[b];
      if (!p || !q) continue;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();

    // joints
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const r = (i === 0 ? 6 : i % 4 === 0 ? 5.5 : 3.4) * px + 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // --- hold ring ------------------------------------------------------
    const bounds = boundingBox(points);
    const centre: Point = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
    const radius = Math.max(bounds.w, bounds.h) / 2 + 26 * px + 12;

    if (slot) {
      const progress = slotProgress[slotIndex] ?? 0;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = 9 * px + 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      if (progress > 0.001) {
        ctx.strokeStyle = progress >= 1 ? COLOR_LOCKED : color;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 22 * px + 6;
        ctx.beginPath();
        ctx.arc(centre.x, centre.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.stroke();
      }
      ctx.restore();
    }

    // --- digit badge ----------------------------------------------------
    const badgeSize = Math.min(150, Math.max(74, bounds.h * 0.9));
    const badgeY = Math.max(badgeSize * 0.62 + 8, bounds.y - badgeSize * 0.72);
    const badgeX = clampToRange(centre.x, badgeSize * 0.62 + 8, width - badgeSize * 0.62 - 8);

    ctx.save();
    const pulse = isMatch ? 1 + Math.sin(time / 140) * 0.035 : 1;
    ctx.translate(badgeX, badgeY);
    ctx.scale(pulse, pulse);

    ctx.shadowColor = 'rgba(72, 48, 96, 0.28)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = isMatch ? COLOR_MATCH : recognised ? 'rgba(255,255,255,0.94)' : 'rgba(255,255,255,0.7)';
    roundRect(ctx, -badgeSize / 2, -badgeSize / 2, badgeSize, badgeSize, badgeSize * 0.3);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = isMatch ? COLOR_MATCH : recognised ? COLOR_WRONG : COLOR_IDLE;
    ctx.lineWidth = 4 * px + 1.6;
    roundRect(ctx, -badgeSize / 2, -badgeSize / 2, badgeSize, badgeSize, badgeSize * 0.3);
    ctx.stroke();

    const glyph = recognised && hand.symbol ? SYMBOLS[hand.symbol].glyph : '?';
    ctx.fillStyle = isMatch ? '#12432F' : recognised ? '#4A3A63' : 'rgba(74,58,99,0.5)';
    ctx.font = `700 ${badgeSize * (glyph.length > 1 ? 0.46 : 0.62)}px Fredoka, "SF Pro Rounded", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, 0, badgeSize * 0.03);
    ctx.restore();

    // --- what the player needs for this hand ---------------------------
    if (slot) {
      const label = slot.ok ? 'LOCKED IN' : `${SYMBOLS[slot.want].name}?`;
      ctx.save();
      ctx.font = `700 ${22 * px + 8}px Nunito, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = slot.ok ? '#0E6B49' : '#7A5C86';
      ctx.shadowColor = 'rgba(255,255,255,0.85)';
      ctx.shadowBlur = 10;
      ctx.fillText(label, badgeX, badgeY + badgeSize / 2 + 8);
      ctx.restore();
    }
  }

  // --- global hold bar ---------------------------------------------------
  const anyProgress = holdProgress > 0.001;
  if (anyProgress) {
    const barW = Math.min(width * 0.5, 620);
    const barH = 26;
    const barX = (width - barW) / 2;
    const barY = height - 132;

    ctx.save();
    ctx.shadowColor = 'rgba(72, 48, 96, 0.22)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    roundRect(ctx, barX, barY, barW, barH, barH / 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, '#9BF6FF');
    grad.addColorStop(0.5, '#CAFFBF');
    grad.addColorStop(1, '#FFC861');
    ctx.fillStyle = grad;
    roundRect(ctx, barX + 4, barY + 4, Math.max(barH - 8, (barW - 8) * holdProgress), barH - 8, (barH - 8) / 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.font = `700 ${18 * px + 7}px Nunito, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#5B4A78';
    ctx.fillText(
      holdProgress >= 1 ? 'YES!' : 'HOLD IT THERE…',
      width / 2,
      barY - 12,
    );
    ctx.restore();
  }
}

function boundingBox(points: Point[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function clampToRange(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
