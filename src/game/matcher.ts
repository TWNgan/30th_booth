/**
 * Decides whether what the player is showing right now matches the answer.
 *
 * Side assignment is screen-relative, not anatomical: the hand the player sees
 * on the left of the mirrored view is the tens digit, the other is the ones
 * digit. Because the view is mirrored, that also matches the player's own left
 * and right hand, which is what the answer key in the brief describes.
 */

import type { HandAnalysis } from '../vision/classifier.ts';
import { type SymbolId, symbolName } from './symbols.ts';

export type Side = 'left' | 'right';

export interface SlotResult {
  side: Side;
  want: SymbolId;
  got: SymbolId | null;
  ok: boolean;
  present: boolean;
}

export interface MatchState {
  ok: boolean;
  slots: SlotResult[];
  /** 0..1 — how many required hands are currently correct */
  satisfied: number;
  /** true when every required hand is present and recognised (right or wrong) */
  allRecognised: boolean;
}

export function matchAnswer(hands: HandAnalysis[], answer: SymbolId[]): MatchState {
  if (answer.length === 0) return { ok: true, slots: [], satisfied: 1, allRecognised: true };

  if (answer.length === 1) {
    const want = answer[0]!;
    // A single-hand answer is satisfied by either hand; pick the best candidate
    // so the overlay can show the player which hand is scoring.
    let best: HandAnalysis | null = null;
    for (const hand of hands) {
      if (hand.symbol === want) {
        best = hand;
        break;
      }
      if (!best) best = hand;
    }
    const ok = hands.some((h) => h.symbol === want);
    return {
      ok,
      slots: [
        {
          side: 'left',
          want,
          got: best?.symbol ?? null,
          ok,
          present: Boolean(best),
        },
      ],
      satisfied: ok ? 1 : 0,
      allRecognised: Boolean(best?.symbol),
    };
  }

  // Two-hand answer: index 0 is the screen-left hand.
  const leftHand = hands[0] ?? null;
  const rightHand = hands[1] ?? null;
  const leftWant = answer[0]!;
  const rightWant = answer[1]!;

  const leftOk = leftHand?.symbol === leftWant;
  const rightOk = rightHand?.symbol === rightWant;

  const slots: SlotResult[] = [
    {
      side: 'left',
      want: leftWant,
      got: leftHand?.symbol ?? null,
      ok: leftOk,
      present: Boolean(leftHand),
    },
    {
      side: 'right',
      want: rightWant,
      got: rightHand?.symbol ?? null,
      ok: rightOk,
      present: Boolean(rightHand),
    },
  ];

  const satisfied = (leftOk ? 0.5 : 0) + (rightOk ? 0.5 : 0);
  return {
    ok: leftOk && rightOk,
    slots,
    satisfied,
    allRecognised: Boolean(leftHand?.symbol) && Boolean(rightHand?.symbol),
  };
}

/** Human-readable description of what the player is currently showing. */
export function describeShowing(hands: HandAnalysis[]): string | null {
  if (hands.length === 0) return null;
  const names = hands.map((h) => symbolName(h.symbol));
  if (hands.length === 1) return `Showing ${names[0]}`;
  return `Showing ${names[0]} and ${names[1]}`;
}
