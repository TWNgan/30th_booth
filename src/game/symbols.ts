/**
 * The vocabulary of the game: every symbol a player can throw with one hand.
 *
 * Digits 0-9 use a hand-counting scheme that is easy to teach at a booth and
 * easy to tell apart with 21-point landmarks:
 *
 *   0  ✊ fist                  5  🖐 open palm
 *   1  ☝ index                 6  🤙 thumb + pinky (shaka)
 *   2  ✌ index + middle        7  thumb + index + middle
 *   3  👌 OK sign              8  thumb + index (letter L)
 *   4  four fingers, thumb in 9  🤏 thumb + index pinch
 *
 * plus one non-digit: 👍 "yeah" (thumbs up).
 */

export type DigitSymbol = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
export type ExtraSymbol = 'thumbsUp';
export type SymbolId = DigitSymbol | ExtraSymbol;

/** How much each finger is folded: 0 = straight out, 1 = folded onto the palm. */
export interface HandPose {
  thumb: number;
  index: number;
  middle: number;
  ring: number;
  pinky: number;
  /** thumb tip and index tip touch (OK sign / pinch) */
  pinch?: boolean;
  /** thumb is straight and pointing up, away from the palm */
  thumbUp?: boolean;
}

export interface SymbolDef {
  id: SymbolId;
  /** big glyph shown on badges */
  glyph: string;
  /** short human name */
  name: string;
  /** how a player should make it — shown in hints and the legend */
  howTo: string;
  pose: HandPose;
  /** numeric value for building multi-hand answers; null for non-digits */
  digit: number | null;
}

const STRAIGHT = 0;
const FOLDED = 1;

export const SYMBOLS: Record<SymbolId, SymbolDef> = {
  '0': {
    id: '0',
    glyph: '0',
    name: 'Zero',
    howTo: 'Make a fist',
    pose: { thumb: 0.9, index: FOLDED, middle: FOLDED, ring: FOLDED, pinky: FOLDED },
    digit: 0,
  },
  '1': {
    id: '1',
    glyph: '1',
    name: 'One',
    howTo: 'Point one finger up',
    pose: { thumb: 0.75, index: STRAIGHT, middle: FOLDED, ring: FOLDED, pinky: FOLDED },
    digit: 1,
  },
  '2': {
    id: '2',
    glyph: '2',
    name: 'Two',
    howTo: 'Peace sign — index and middle up',
    pose: { thumb: 0.85, index: STRAIGHT, middle: STRAIGHT, ring: FOLDED, pinky: FOLDED },
    digit: 2,
  },
  '3': {
    id: '3',
    glyph: '3',
    name: 'Three',
    howTo: 'OK sign — thumb and index touch, three fingers up',
    pose: { thumb: 0.25, index: 0.15, middle: STRAIGHT, ring: STRAIGHT, pinky: STRAIGHT, pinch: true },
    digit: 3,
  },
  '4': {
    id: '4',
    glyph: '4',
    name: 'Four',
    howTo: 'Four fingers up, thumb tucked in',
    pose: { thumb: FOLDED, index: STRAIGHT, middle: STRAIGHT, ring: STRAIGHT, pinky: STRAIGHT },
    digit: 4,
  },
  '5': {
    id: '5',
    glyph: '5',
    name: 'Five',
    howTo: 'Open palm, all five fingers up',
    pose: { thumb: STRAIGHT, index: STRAIGHT, middle: STRAIGHT, ring: STRAIGHT, pinky: STRAIGHT },
    digit: 5,
  },
  '6': {
    id: '6',
    glyph: '6',
    name: 'Six',
    howTo: 'Shaka — thumb and pinky out',
    pose: { thumb: STRAIGHT, index: FOLDED, middle: FOLDED, ring: FOLDED, pinky: STRAIGHT },
    digit: 6,
  },
  '7': {
    id: '7',
    glyph: '7',
    name: 'Seven',
    howTo: 'Thumb, index and middle out',
    pose: { thumb: STRAIGHT, index: STRAIGHT, middle: STRAIGHT, ring: FOLDED, pinky: FOLDED },
    digit: 7,
  },
  '8': {
    id: '8',
    glyph: '8',
    name: 'Eight',
    howTo: 'Letter L — thumb and index out',
    pose: { thumb: STRAIGHT, index: STRAIGHT, middle: FOLDED, ring: FOLDED, pinky: FOLDED },
    digit: 8,
  },
  '9': {
    id: '9',
    glyph: '9',
    name: 'Nine',
    howTo: 'Pinch — thumb and index touch, other fingers curled',
    pose: { thumb: 0.25, index: 0.15, middle: FOLDED, ring: FOLDED, pinky: FOLDED, pinch: true },
    digit: 9,
  },
  thumbsUp: {
    id: 'thumbsUp',
    glyph: '👍',
    name: 'Thumbs up',
    howTo: 'Thumbs up — "yeah!"',
    pose: { thumb: STRAIGHT, index: FOLDED, middle: FOLDED, ring: FOLDED, pinky: FOLDED, thumbUp: true },
    digit: null,
  },
};

/** Digits in display order for the legend. */
export const DIGIT_SYMBOLS: SymbolDef[] = (['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as DigitSymbol[]).map(
  (id) => SYMBOLS[id],
);

export function symbolName(id: SymbolId | null | undefined): string {
  if (!id) return 'nothing yet';
  return SYMBOLS[id].name;
}

/** A number built from one or two hands, e.g. [3, 0] -> "30". */
export function symbolsToNumber(symbols: SymbolId[]): number | null {
  if (symbols.length === 0) return null;
  let value = 0;
  for (const s of symbols) {
    const d = SYMBOLS[s].digit;
    if (d === null) return null;
    value = value * 10 + d;
  }
  return value;
}
