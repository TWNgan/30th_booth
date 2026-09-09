/**
 * The question bank.
 *
 * Every answer is a short list of hand symbols: one entry for a single-hand
 * answer, two entries for a two-digit answer (screen-left hand = tens,
 * screen-right hand = ones).
 *
 * A booth session plays a random sample, always starting with a warm-up, so
 * the same student group never sees the identical run twice.
 */

import type { SymbolId } from './symbols.ts';

export type Level = 'warmup' | 'fun' | 'tricky';

export interface Question {
  id: string;
  /** the big line on the card */
  prompt: string;
  /** smaller supporting line */
  sub?: string;
  /** required symbols, in screen order */
  answer: SymbolId[];
  /** shown once the player nails it */
  reveal: string;
  level: Level;
}

export const QUESTIONS: Question[] = [
  {
    id: 'anniversary',
    prompt: 'Happy ___th Anniversary! Complete the phrase with your hands!',
    sub: 'One hand for the tens digit, one hand for the ones digit.',
    answer: ['3', '0'],
    reveal: '30 years — happy anniversary!',
    level: 'warmup',
  },
  {
    id: 'thumbs-up',
    prompt: 'Give a great big thumbs up to kick things off!',
    sub: 'One hand is all you need.',
    answer: ['thumbsUp'],
    reveal: 'Yeah! Let’s go.',
    level: 'warmup',
  },
  {
    id: 'three-decades',
    prompt: 'Three whole decades. How many years is that?',
    answer: ['3', '0'],
    reveal: '30 years of memories.',
    level: 'warmup',
  },
  {
    id: 'clap',
    prompt: 'Show me how many hands you clap with.',
    answer: ['2'],
    reveal: 'Two hands, one big round of applause.',
    level: 'warmup',
  },
  {
    id: 'thirty-letters',
    prompt: 'Count the letters: T-H-I-R-T-Y.',
    answer: ['6'],
    reveal: 'Six letters in THIRTY.',
    level: 'fun',
  },
  {
    id: 'decades',
    prompt: 'Thirty divided by ten equals how many decades?',
    answer: ['3'],
    reveal: 'Three decades.',
    level: 'fun',
  },
  {
    id: 'peace-times-five',
    prompt: 'How many fingers make a peace sign? Now times five!',
    answer: ['1', '0'],
    reveal: 'Two fingers times five is ten.',
    level: 'fun',
  },
  {
    id: 'four-times-five',
    prompt: 'Quick maths: 4 × 5 = ?',
    answer: ['2', '0'],
    reveal: 'Twenty!',
    level: 'fun',
  },
  {
    id: 'both-hands',
    prompt: 'How many fingers are on both hands?',
    answer: ['1', '0'],
    reveal: 'Ten fingers.',
    level: 'fun',
  },
  {
    id: 'candles',
    prompt: 'Count the candles: three tens and five ones.',
    answer: ['3', '5'],
    reveal: 'Thirty-five candles — that cake is heavy.',
    level: 'fun',
  },
  {
    id: 'tricycle',
    prompt: 'A tricycle has how many wheels? Add the number of hands you’re using.',
    answer: ['5'],
    reveal: 'Three wheels plus two hands makes five.',
    level: 'fun',
  },
  {
    id: 'week',
    prompt: 'How many days are in a week?',
    answer: ['7'],
    reveal: 'Seven days.',
    level: 'fun',
  },
  {
    id: 'rainbow',
    prompt: 'How many colours are in a rainbow?',
    answer: ['7'],
    reveal: 'Seven colours.',
    level: 'fun',
  },
  {
    id: 'guitar',
    prompt: 'How many strings does a standard guitar have?',
    answer: ['6'],
    reveal: 'Six strings.',
    level: 'fun',
  },
  {
    id: 'basketball',
    prompt: 'How many players from one team are on the court?',
    answer: ['5'],
    reveal: 'Five players.',
    level: 'fun',
  },
  {
    id: 'stop-sign',
    prompt: 'How many sides does a stop sign have?',
    answer: ['8'],
    reveal: 'Eight sides.',
    level: 'fun',
  },
  {
    id: 'spider',
    prompt: 'How many legs does a spider have?',
    answer: ['8'],
    reveal: 'Eight legs.',
    level: 'fun',
  },
  {
    id: 'planets',
    prompt: 'How many planets are in our solar system?',
    answer: ['8'],
    reveal: 'Eight planets.',
    level: 'fun',
  },
  {
    id: 'car',
    prompt: 'How many wheels does a car have?',
    answer: ['4'],
    reveal: 'Four wheels.',
    level: 'fun',
  },
  {
    id: 'triangle',
    prompt: 'How many sides does a triangle have?',
    answer: ['3'],
    reveal: 'Three sides.',
    level: 'fun',
  },
  {
    id: 'until-fifty',
    prompt: 'How many years until the 50th anniversary?',
    answer: ['2', '0'],
    reveal: 'Twenty more years to the golden one.',
    level: 'tricky',
  },
  {
    id: 'happy-times-four',
    prompt: 'Count the letters in HAPPY, then multiply by four.',
    answer: ['2', '0'],
    reveal: 'Five letters times four is twenty.',
    level: 'tricky',
  },
  {
    id: 'six-times-ten',
    prompt: 'Show me 6 × 10.',
    answer: ['6', '0'],
    reveal: 'Sixty!',
    level: 'tricky',
  },
  {
    id: 'quarter-hour',
    prompt: 'How many minutes are in a quarter of an hour?',
    answer: ['1', '5'],
    reveal: 'Fifteen minutes.',
    level: 'tricky',
  },
  {
    id: 'day-thirds',
    prompt: 'A day has 24 hours. Divide it by three.',
    answer: ['8'],
    reveal: 'Eight hours.',
    level: 'tricky',
  },
  {
    id: 'zeros',
    prompt: 'How many zeros are hiding in the number 300?',
    answer: ['2'],
    reveal: 'Two zeros.',
    level: 'tricky',
  },
  {
    id: 'nine',
    prompt: 'Show me nine.',
    sub: 'Pinch your thumb and index finger together.',
    answer: ['9'],
    reveal: 'Nine.',
    level: 'fun',
  },
];

/** Fisher-Yates on a copy. */
function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}

/**
 * Build one booth session: a warm-up opener, then a mix of fun and tricky
 * questions, so the difficulty ramps instead of spiking.
 */
export function pickSession(count = 7, rng: () => number = Math.random): Question[] {
  const warmups = shuffled(
    QUESTIONS.filter((q) => q.level === 'warmup'),
    rng,
  );
  const fun = shuffled(
    QUESTIONS.filter((q) => q.level === 'fun'),
    rng,
  );
  const tricky = shuffled(
    QUESTIONS.filter((q) => q.level === 'tricky'),
    rng,
  );

  const opener = warmups.shift();
  const trickyQuota = Math.max(1, Math.round(count * 0.3));
  const trickyPicks = tricky.splice(0, trickyQuota);
  const funPicks = fun.splice(0, Math.max(0, count - 1 - trickyPicks.length));

  // Interleave so the tricky ones are spread out rather than dumped at the end.
  const middle: Question[] = [];
  const long = Math.max(funPicks.length, trickyPicks.length);
  for (let i = 0; i < long; i++) {
    const f = funPicks[i];
    const t = trickyPicks[i];
    if (f) middle.push(f);
    if (t) middle.push(t);
  }

  const session: Question[] = [];
  const seen = new Set<string>();
  for (const q of [opener, ...middle]) {
    if (!q || seen.has(q.id)) continue;
    seen.add(q.id);
    session.push(q);
    if (session.length >= count) break;
  }
  return session;
}
