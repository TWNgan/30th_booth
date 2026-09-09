/**
 * Classifier sanity test.
 *
 * Builds synthetic 21-point hand skeletons from a simple anatomical model and
 * checks that `analyseHand` names each pose correctly. This does not replace
 * testing with real hands — it locks the decision rules against regressions and
 * documents exactly what each rule expects geometrically.
 *
 * It also covers the two-hand answer matcher, since the tens/ones side rules
 * are just as easy to get wrong as the pose rules.
 *
 * Run with:  npm test
 */

import { analyseHand, type HandAnalysis } from '../src/vision/classifier.ts';
import { BoothGame, type EngineEvent } from '../src/game/engine.ts';
import { matchAnswer } from '../src/game/matcher.ts';
import { SYMBOLS, type SymbolId } from '../src/game/symbols.ts';

type P = { x: number; y: number; z: number };

const D = Math.PI / 180;

/* --------------------------------------------------------------------------
   Hand model. Local frame: x to the right, y away from the wrist (up the
   fingers), z towards the camera. Units are millimetres, roughly matching a
   real adult hand: palm length (wrist -> middle knuckle) is about 90 mm.
   -------------------------------------------------------------------------- */

const WRIST: P = { x: 0, y: 0, z: 0 };

interface FingerSpec {
  mcp: P;
  /** proximal, middle, distal */
  lengths: [number, number, number];
  /** direction of a fully extended finger, degrees from +y towards +x */
  angle: number;
  /** unit direction the finger folds towards when it curls */
  inward: P;
}

const INWARD_LEFT: P = { x: -1, y: 0, z: 0 };

const FINGERS: Record<'index' | 'middle' | 'ring' | 'pinky', FingerSpec> = {
  index: { mcp: { x: 2, y: 84, z: 0 }, lengths: [42, 26, 20], angle: -5, inward: INWARD_LEFT },
  middle: { mcp: { x: 16, y: 90, z: 0 }, lengths: [46, 30, 22], angle: 2, inward: INWARD_LEFT },
  ring: { mcp: { x: 30, y: 86, z: 0 }, lengths: [42, 26, 20], angle: 9, inward: INWARD_LEFT },
  pinky: { mcp: { x: 43, y: 76, z: 0 }, lengths: [32, 20, 17], angle: 18, inward: INWARD_LEFT },
};

const THUMB_CMC: P = { x: -16, y: 16, z: 0 };
const THUMB_LENGTHS: [number, number, number] = [34, 26, 20];
const THUMB_ANGLE = -60;

function dir(angleDeg: number): P {
  const a = angleDeg * D;
  return { x: Math.sin(a), y: Math.cos(a), z: 0 };
}

function plus(base: P, ...offsets: P[]): P {
  return offsets.reduce((acc, o) => ({ x: acc.x + o.x, y: acc.y + o.y, z: acc.z + o.z }), base);
}

function scaled(v: P, k: number): P {
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}

/** Straight finger: all three segments in a line. */
function extendedFinger(spec: FingerSpec): P[] {
  const d = dir(spec.angle);
  const [a, b, c] = spec.lengths;
  const total = a + b + c;
  return [
    spec.mcp,
    plus(spec.mcp, scaled(d, a)),
    plus(spec.mcp, scaled(d, a + b)),
    plus(spec.mcp, scaled(d, total)),
  ];
}

/**
 * Curled finger: the proximal segment still goes up, then the finger folds
 * back down and inwards so the tip lands over the palm. Both the joint angles
 * and the tip's distance from the wrist shrink, which is what the classifier
 * actually measures.
 */
/**
 * Index finger of an OK sign / pinch: it arcs up and out to meet the thumb,
 * so its tip stays well away from the wrist — unlike a fist, where the index
 * folds back onto the palm.
 */
function ringFinger(spec: FingerSpec): P[] {
  const total = spec.lengths.reduce((a, b) => a + b, 0);
  return [
    spec.mcp,
    plus(spec.mcp, { x: 0, y: total * 0.36, z: 0 }),
    plus(spec.mcp, { x: -total * 0.12, y: total * 0.55, z: 0 }),
    plus(spec.mcp, { x: -total * 0.27, y: total * 0.44, z: 0 }),
  ];
}

function curledFinger(spec: FingerSpec): P[] {
  const total = spec.lengths.reduce((a, b) => a + b, 0);
  const pip = plus(spec.mcp, { x: 0, y: total * 0.36, z: 0 });
  const dip = plus(pip, scaled(spec.inward, total * 0.16), { x: 0, y: total * 0.16, z: 0 });
  const tip = plus(dip, scaled(spec.inward, total * 0.16), { x: 0, y: -total * 0.45, z: 0 });
  return [spec.mcp, pip, dip, tip];
}

type ThumbPose = 'extended' | 'tucked' | 'up';

function thumbPoints(pose: ThumbPose): P[] {
  if (pose === 'tucked') {
    // Folded across the front of the palm.
    return [THUMB_CMC, { x: -28, y: 34, z: 4 }, { x: -24, y: 56, z: 8 }, { x: -10, y: 72, z: 10 }];
  }
  const angle = pose === 'up' ? 0 : THUMB_ANGLE;
  const d = dir(angle);
  const [a, b, c] = THUMB_LENGTHS;
  return [
    THUMB_CMC,
    plus(THUMB_CMC, scaled(d, a)),
    plus(THUMB_CMC, scaled(d, a + b)),
    plus(THUMB_CMC, scaled(d, a + b + c)),
  ];
}

export interface HandPoseSpec {
  index: 'straight' | 'curled' | 'ring';
  middle: 'straight' | 'curled';
  ring: 'straight' | 'curled';
  pinky: 'straight' | 'curled';
  thumb: ThumbPose;
  /** place the thumb tip exactly on the index tip, for the OK sign / pinch */
  pinch?: boolean;
}

/** Returns 21 landmarks in MediaPipe order, y already flipped to image space. */
export function buildHand(pose: HandPoseSpec): P[] {
  const index =
    pose.index === 'straight'
      ? extendedFinger(FINGERS.index)
      : pose.index === 'ring'
        ? ringFinger(FINGERS.index)
        : curledFinger(FINGERS.index);
  const middle = pose.middle === 'straight' ? extendedFinger(FINGERS.middle) : curledFinger(FINGERS.middle);
  const ring = pose.ring === 'straight' ? extendedFinger(FINGERS.ring) : curledFinger(FINGERS.ring);
  const pinky = pose.pinky === 'straight' ? extendedFinger(FINGERS.pinky) : curledFinger(FINGERS.pinky);

  const thumb = thumbPoints(pose.thumb);
  if (pose.pinch) {
    // The ring: thumb tip meets index tip.
    thumb[3] = { ...index[3]!, x: index[3]!.x + 2, y: index[3]!.y + 2, z: 2 };
  }

  const ordered: P[] = [
    WRIST,
    thumb[0]!,
    thumb[1]!,
    thumb[2]!,
    thumb[3]!,
    index[0]!,
    index[1]!,
    index[2]!,
    index[3]!,
    middle[0]!,
    middle[1]!,
    middle[2]!,
    middle[3]!,
    ring[0]!,
    ring[1]!,
    ring[2]!,
    ring[3]!,
    pinky[0]!,
    pinky[1]!,
    pinky[2]!,
    pinky[3]!,
  ];

  // Image space has y growing downwards; the model is built with y up.
  return ordered.map((p) => ({ x: p.x, y: -p.y, z: p.z }));
}

const STRAIGHT = 'straight' as const;
const CURLED = 'curled' as const;

const CASES: Array<{ expected: SymbolId; pose: HandPoseSpec; note: string }> = [
  {
    expected: '0',
    pose: { index: CURLED, middle: CURLED, ring: CURLED, pinky: CURLED, thumb: 'tucked' },
    note: 'fist',
  },
  {
    expected: '1',
    pose: { index: STRAIGHT, middle: CURLED, ring: CURLED, pinky: CURLED, thumb: 'tucked' },
    note: 'one finger up',
  },
  {
    expected: '2',
    pose: { index: STRAIGHT, middle: STRAIGHT, ring: CURLED, pinky: CURLED, thumb: 'tucked' },
    note: 'peace sign',
  },
  {
    expected: '3',
    pose: { index: 'ring', middle: STRAIGHT, ring: STRAIGHT, pinky: STRAIGHT, thumb: 'tucked', pinch: true },
    note: 'OK sign',
  },
  {
    expected: '4',
    pose: { index: STRAIGHT, middle: STRAIGHT, ring: STRAIGHT, pinky: STRAIGHT, thumb: 'tucked' },
    note: 'four up, thumb in',
  },
  {
    expected: '5',
    pose: { index: STRAIGHT, middle: STRAIGHT, ring: STRAIGHT, pinky: STRAIGHT, thumb: 'extended' },
    note: 'open palm',
  },
  {
    expected: '6',
    pose: { index: CURLED, middle: CURLED, ring: CURLED, pinky: STRAIGHT, thumb: 'extended' },
    note: 'shaka',
  },
  {
    expected: '7',
    pose: { index: STRAIGHT, middle: STRAIGHT, ring: CURLED, pinky: CURLED, thumb: 'extended' },
    note: 'three fingers out',
  },
  {
    expected: '8',
    pose: { index: STRAIGHT, middle: CURLED, ring: CURLED, pinky: CURLED, thumb: 'extended' },
    note: 'letter L',
  },
  {
    expected: '9',
    pose: { index: 'ring', middle: CURLED, ring: CURLED, pinky: CURLED, thumb: 'tucked', pinch: true },
    note: 'pinch',
  },
  {
    expected: 'thumbsUp',
    pose: { index: CURLED, middle: CURLED, ring: CURLED, pinky: CURLED, thumb: 'up' },
    note: 'thumbs up',
  },
];

function classify(pose: HandPoseSpec): ReturnType<typeof analyseHand> {
  const world = buildHand(pose);
  // Normalised landmarks: the same shape scaled into the unit square.
  const image = world.map((p) => ({ x: 0.5 + p.x / 500, y: 0.5 + p.y / 500, z: p.z / 500 }));
  return analyseHand(image, world, {
    aspect: 16 / 9,
    slot: 0,
    handedness: 'Right',
    handednessScore: 0.99,
  });
}

let failures = 0;
const rows: string[] = [];

for (const testCase of CASES) {
  const analysis = classify(testCase.pose);
  const got = analysis?.symbol ?? null;
  const pass = got === testCase.expected;
  if (!pass) failures += 1;
  rows.push(
    `${pass ? 'PASS' : 'FAIL'}  want ${testCase.expected.padEnd(9)} got ${String(got).padEnd(9)} ` +
      `conf ${(analysis?.symbolConfidence ?? 0).toFixed(2)}  ${testCase.note}`,
  );
  if (!pass && analysis) {
    rows.push(`        debug: ${JSON.stringify(analysis.debug, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v))}`);
  }
}

/* --------------------------------------------------------------------------
   Answer matcher: which hand is the tens digit, and when is the answer right.
   -------------------------------------------------------------------------- */

function fakeHand(symbol: SymbolId | null, screenX: number): HandAnalysis {
  return {
    slot: Math.round(screenX * 100),
    handedness: 'Right',
    handednessScore: 1,
    landmarks: [],
    center: { x: 1 - screenX, y: 0.5 },
    screenX,
    palmSize: 0.08,
    fingers: {
      thumb: { extension: 1, extended: true },
      index: { extension: 1, extended: true },
      middle: { extension: 1, extended: true },
      ring: { extension: 1, extended: true },
      pinky: { extension: 1, extended: true },
    },
    symbol,
    symbolConfidence: 1,
    pinchRatio: 1,
    debug: {},
  };
}

const MATCH_CASES: Array<{
  note: string;
  hands: Array<SymbolId | null>;
  answer: SymbolId[];
  expect: boolean;
}> = [
  { note: '30 with 3 on the left and 0 on the right', hands: ['3', '0'], answer: ['3', '0'], expect: true },
  { note: '30 reversed is not 30', hands: ['0', '3'], answer: ['3', '0'], expect: false },
  { note: 'two-hand answer needs both hands', hands: ['3'], answer: ['3', '0'], expect: false },
  { note: 'one wrong digit is not a match', hands: ['3', '5'], answer: ['3', '0'], expect: false },
  { note: 'single-hand answer accepts either hand', hands: [null, '6'], answer: ['6'], expect: true },
  { note: 'single-hand answer ignores the other hand', hands: ['2', '6'], answer: ['6'], expect: true },
  { note: 'unrecognised hand is not a match', hands: [null], answer: ['6'], expect: false },
  { note: 'thumbs up is a valid single-hand answer', hands: ['thumbsUp'], answer: ['thumbsUp'], expect: true },
];

for (const testCase of MATCH_CASES) {
  const hands = testCase.hands.map((symbol, i) => fakeHand(symbol, 0.25 + i * 0.5));
  const result = matchAnswer(hands, testCase.answer);
  const pass = result.ok === testCase.expect;
  if (!pass) failures += 1;
  rows.push(
    `${pass ? 'PASS' : 'FAIL'}  matcher want ok=${String(testCase.expect).padEnd(5)} got ok=${String(result.ok).padEnd(5)} ${testCase.note}`,
  );
}

/* --------------------------------------------------------------------------
   Engine: hold-to-lock timing, phase transitions and scoring.
   -------------------------------------------------------------------------- */

function check(note: string, condition: boolean, detail = ''): void {
  if (!condition) failures += 1;
  rows.push(`${condition ? 'PASS' : 'FAIL'}  engine  ${note}${detail ? ` — ${detail}` : ''}`);
}

/** A symbol that is guaranteed not to be the right answer for this round. */
function wrongSymbol(answer: SymbolId[]): SymbolId {
  const candidate = (Object.keys(SYMBOLS) as SymbolId[]).find((id) => !answer.includes(id));
  if (!candidate) throw new Error('no unused symbol available');
  return candidate;
}

function makeEngine(overrides: Partial<ConstructorParameters<typeof BoothGame>[0]> = {}) {
  const events: EngineEvent[] = [];
  const game = new BoothGame({
    rounds: 3,
    holdMs: 200,
    celebrateMs: 100,
    summaryMs: 600,
    startHoldMs: 100,
    idleToAttractMs: 60_000,
    hintTimesMs: [400, 800, 1200],
    nudgeAfterMs: 200,
    rng: () => 0.5,
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  return { game, events };
}

function feed(game: BoothGame, hands: HandAnalysis[], from: number, ms: number, step = 20): number {
  let t = from;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    t += step;
    game.tick(hands, t, 60, 10);
  }
  return t;
}

{
  // 1. A recognised hand in attract mode starts a session.
  const { game, events } = makeEngine();
  check('starts in attract mode', game.getSnapshot().phase === 'attract');
  let t = feed(game, [], 0, 100);
  check('stays in attract with no hands', game.getSnapshot().phase === 'attract');
  t = feed(game, [fakeHand('5', 0.3)], t, 200);
  check('a hand sign starts the session', game.getSnapshot().phase === 'playing', game.getSnapshot().phase);
  check('session has the configured length', game.getSnapshot().totalRounds === 3);

  // 2. Holding the right gesture locks the answer in.
  const answer = game.getSnapshot().answer;
  const right = answer.map((symbol, i) => fakeHand(symbol, 0.3 + i * 0.4));
  const wrong = [fakeHand(wrongSymbol(answer), 0.3)];

  t = feed(game, wrong, t, 150);
  check('a wrong gesture does not score', game.getSnapshot().phase === 'playing');
  check('hold progress stays at zero when wrong', game.getSnapshot().live.holdProgress === 0);

  // A brief correct flash should not be enough — the hold buffer is the point.
  t = feed(game, right, t, 80);
  check('a quick flash does not lock in', game.getSnapshot().phase === 'playing');
  check('partial hold progress is tracked', game.getSnapshot().live.holdProgress > 0);

  // 80 ms + 130 ms of hold = 210 ms, just past the 200 ms threshold.
  t = feed(game, right, t, 130);
  check('holding locks the answer in', game.getSnapshot().phase === 'celebrate', game.getSnapshot().phase);
  check('score increases on a correct answer', game.getSnapshot().score > 0, `score=${game.getSnapshot().score}`);
  check('streak increases on a correct answer', game.getSnapshot().streak === 1);
  check('solved count increases', game.getSnapshot().solvedCount === 1);

  // 3. Celebration advances to the next question, then the session ends.
  t = feed(game, [], t, 200);
  check('celebration advances the round', game.getSnapshot().phase === 'playing');
  check('round number advances', game.getSnapshot().roundNumber === 2);

  for (let round = 0; round < 2; round++) {
    const next = game.getSnapshot().answer;
    const hands = next.map((symbol, i) => fakeHand(symbol, 0.3 + i * 0.4));
    t = feed(game, hands, t, 240);
    check(`round ${round + 2} locks in`, game.getSnapshot().phase === 'celebrate', game.getSnapshot().phase);
    // Roll the celebration over into the summary without letting it expire.
    for (let i = 0; i < 20 && game.getSnapshot().phase !== 'finished'; i++) {
      t = feed(game, [], t, 20);
    }
  }
  check('finishing all rounds ends the session', game.getSnapshot().phase === 'finished', game.getSnapshot().phase);
  check('final score is positive', game.getSnapshot().score > 0);
  check('emitted a game-end event', eventsOfType(events, 'game-end') === 1);
  check('emitted a correct event per solved round', eventsOfType(events, 'correct') === 3);

  // 4. The summary times out back to attract mode.
  t = feed(game, [], t, 800);
  check('summary returns to attract mode', game.getSnapshot().phase === 'attract', game.getSnapshot().phase);
}

{
  // 5. Walking away mid-session frees the booth.
  const { game } = makeEngine({ idleToAttractMs: 500 });
  let t = feed(game, [fakeHand('5', 0.3)], 0, 200);
  check('idle test: session started', game.getSnapshot().phase === 'playing');
  t = feed(game, [], t, 800);
  check('walking away returns to attract mode', game.getSnapshot().phase === 'attract', game.getSnapshot().phase);
  check('score resets for the next player', game.getSnapshot().score === 0);
}

{
  // 6. Hints escalate, and a wrong-but-stable pose nudges once.
  const { game, events } = makeEngine();
  let t = feed(game, [fakeHand('5', 0.3)], 0, 200);
  const answer = game.getSnapshot().answer;
  const wrongSymbolId = wrongSymbol(answer);
  const wrong = answer.map((_, i) => fakeHand(wrongSymbolId, 0.3 + i * 0.4));
  t = feed(game, wrong, t, 500);
  check('first hint fires', game.getSnapshot().hintLevel === 1, `level=${game.getSnapshot().hintLevel}`);
  check('a stable wrong pose nudges', eventsOfType(events, 'wrong') >= 1);
  t = feed(game, wrong, t, 500);
  check('second hint fires', game.getSnapshot().hintLevel === 2, `level=${game.getSnapshot().hintLevel}`);
  t = feed(game, wrong, t, 500);
  check('third hint fires', game.getSnapshot().hintLevel === 3, `level=${game.getSnapshot().hintLevel}`);
}

function eventsOfType(events: EngineEvent[], type: EngineEvent['type']): number {
  return events.filter((event) => event.type === type).length;
}

// The symbol table and the classifier must agree on what exists.
const declared = new Set(Object.keys(SYMBOLS));
for (const testCase of CASES) {
  if (!declared.has(testCase.expected)) {
    rows.push(`FAIL  ${testCase.expected} is not declared in SYMBOLS`);
    failures += 1;
  }
}

console.log(rows.join('\n'));
console.log(`\n${rows.length - failures}/${rows.length} checks passed`);
process.exitCode = failures === 0 ? 0 : 1;
