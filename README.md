# Hands Up! — a gesture-controlled anniversary quiz booth

A booth game where students answer quiz questions by **making numbers with their hands**.
No controllers, no touchscreens, nothing to sanitise between players: a webcam reads
21 points per hand and the game decides whether the pose is right.

The opening question is the one from the brief:

> **Happy \_\_\_th Anniversary! Complete the phrase with your hands!**
> Left hand ✊ (`0`) + right hand 👌 (`3`) → **30**

Everything runs locally in one browser tab. No video is uploaded, recorded or stored.

---

## Quick start

```bash
npm install

npm run dev          # develop at http://localhost:5173
npm test             # 47 logic checks: pose recognition, answer matching, game engine
npm run build        # production bundle into dist/
npm run serve        # tiny dependency-free static server on http://127.0.0.1:4173
npm run kiosk        # serve + launch full-screen Chrome with the camera pre-granted
```

`npm run kiosk` is the one you want on the day. It finds Chrome/Chromium/Edge/Brave,
serves `dist/`, and launches it with the camera permission already granted so no
student ever meets a browser dialog.

> The camera only works on a secure context. `localhost`/`127.0.0.1` counts, which is
> why the booth serves itself locally. Opening `dist/index.html` from the file system
> will load the UI but the camera will be blocked.

---

## How the game plays

| Phase | What the player sees |
| --- | --- |
| **Start** | One button. Browsers only allow audio and camera prompts after a real gesture, so this is not decoration. |
| **Attract** | Big title, an animated `3` + `0` = `30` demo, and "raise a hand and make a sign to start". Runs whenever nobody is playing. |
| **Question** | The riddle, plus one slot per required hand labelled *tens* / *ones*. Slots stay blank so the answer is not given away. |
| **Hold** | Each hand gets a ring that fills while the correct pose is held; a bar at the bottom shows the slowest hand. The pose must be held **1.3 s** so thinking hands never trigger an answer. |
| **Celebrate** | Confetti, a fanfare, points and a streak. Then the next question. |
| **Summary** | Score, solved count, best streak, and the booth record. |

There is **no losing**. Instead the game helps more over time: a tip at 9 s, the
tens/ones explanation at 18 s, and the actual hand shapes at 27 s. A stable but wrong
combination gets a gentle "not quite" sound rather than a penalty.

**Reading the answer.** The view is mirrored (selfie-style), so the hand the player sees
on the *left of the screen* is their left hand. That hand is the **tens** digit, the other
is the **ones** digit. Two hands make a two-digit number; one-hand answers can be made
with either hand.

### The hand signs

Digits are chosen so every one is geometrically distinct with 21 landmarks, and easy to
teach in ten seconds. The in-game legend shows them all.

| | Sign | | Sign |
| --- | --- | --- | --- |
| **0** | ✊ fist | **5** | 🖐 open palm, thumb out |
| **1** | ☝️ index up | **6** | 🤙 shaka (thumb + pinky) |
| **2** | ✌️ peace | **7** | thumb + index + middle |
| **3** | 👌 OK sign | **8** | thumb + index (letter L) |
| **4** | four fingers, thumb tucked | **9** | 🤏 pinch (thumb + index tips together) |
| **👍** | thumbs up — "yeah!" | | |

The difference between `4` and `5` is the thumb (tucked vs out), between `3` and `9` is
whether the other three fingers are up, and between `2` and `7` is whether the thumb is
out. The live digit badge drawn above each hand means a player who gets it wrong sees it
immediately and self-corrects — the hold buffer gives them time to.

---

## Architecture

```
src/
  vision/                 ── the eyes
    geometry.ts           3D vector maths, joint angles, frame-rate-independent smoothing
    classifier.ts         21 landmarks  ->  one of 0-9 / thumbs-up, with confidence
    handTracker.ts        webcam + MediaPipe loop, hand slots, smoothing, symbol voting
  game/                   ── the rules
    symbols.ts            the sign vocabulary and the SVG pose data
    questions.ts          question bank + session picker
    matcher.ts            screen-left/right answer matching
    engine.ts             phases, hold-to-lock timers, hints, scoring  (framework-free)
    celebrate.ts          pastel confetti bursts
  components/             ── the paint
    CameraStage.tsx       mirrored <video> + overlay <canvas>
    overlay.ts            skeleton, digit badges, hold rings, drawn at 60 fps
    HandIcon.tsx          one parametric SVG hand renderer for every sign
    QuestionCard / Hud / Legend / AttractScreen / StartScreen / SummaryScreen
  hooks/useAudio.ts       synthesised sound effects (no audio files at all)
  styles/                 design tokens, painterly pastel backdrop, layout
scripts/
  serve.mjs               dependency-free static server (secure context for the camera)
  kiosk.mjs               serve + full-screen Chrome with camera pre-granted
  classifier-test.ts      the 47-check logic suite
  ui-smoke.mjs            optional Playwright layout/console smoke test
```

### Data flow, once per frame

```
getUserMedia ──▶ <video> (mirrored with CSS)
                     │
        MediaPipe HandLandmarker.detectForVideo()   ~30 Hz, GPU delegate
                     │  21 landmarks × up to 2 hands (normalised + metric world)
                     ▼
        HandTracker: nearest-centre slot assignment, landmark easing, symbol vote
                     │  HandAnalysis[]  (screen-left first)
          ┌──────────┴───────────┐
          ▼                      ▼
   BoothGame.tick()        drawOverlay()
   match / hold / phase    skeleton, badges, rings
          │
          └──▶ React re-render only on real events (new question, score, phase)
```

Two deliberate choices keep this smooth:

1. **Inference and display run at different rates.** The model runs at 30 Hz; the
   displayed landmarks ease towards the newest detection on every animation frame, so
   the skeleton glides at 60 fps even when inference is slow. In headless software
   rendering the same code measured 7–20 fps of inference and the overlay still looked
   continuous.
2. **Nothing per-frame touches React.** Hold progress, match state and hands live in a
   mutable `live` object that the canvas reads directly. React only re-renders when a
   question starts, the score changes, or the phase changes.

### How a pose becomes a digit

`classifier.ts` measures everything relative to the palm (`palmSize` = wrist → middle
knuckle), so distance from the camera and hand size drop out. Angles come from
MediaPipe's metric `worldLandmarks` where available, because those are far less
distorted by perspective than the normalised image landmarks.

A finger counts as **out** only when it is *both* straight and reaching away from the
wrist:

```
straightness = mean(angle at PIP, angle at DIP)        must exceed ~148°
reach        = |wrist → tip| / |wrist → MCP|           must exceed ~1.42
```

Requiring both kills the classic false positive where a curled finger still looks fairly
straight from the camera's angle. The thumb gets its own rules because it bends in a
different plane: straightness plus **reach from the wrist** — knuckle distance cannot
separate a tucked thumb from a thumbs-up, because both sit near the knuckles, but a
thumbs-up tip is still a full palm-length from the wrist.

Two bugs the test suite caught and that are worth keeping in mind if you tune anything:

- **A bare tip-distance test reads every fist as `9`.** In a closed fist the thumb tip
  rests right on the curled index tip. A real ring also needs the index *reaching out*
  to meet the thumb (`|wrist → index tip| / palmSize > 1.15`), which a fist never does.
- **Thumbs-up must be strict.** A false positive there would steal the `0` the
  anniversary answer depends on, so it needs an extended thumb, a clearly vertical thumb
  axis, *and* the tip above the knuckles.

Temporal stability comes from two places: landmarks are eased, and the symbol is decided
by a majority vote over the last 5 detections, so the badge cannot flicker mid-gesture.

### Tuning

Press **`D`** for the live debug panel: fps, inference time, and per hand the slot,
handedness, recognised symbol, confidence and each finger's extended flag. That is the
tool to use with a real hand in front of the camera.

Thresholds worth knowing (all in `classifier.ts`, all named):

| Constant | Default | Raise it if… |
| --- | --- | --- |
| finger `straightness` | 148° | curled fingers are read as out |
| finger `reach` | 1.42 | ditto |
| thumb `reach` | 0.95 | tucked thumbs read as out |
| ring `index reach` | 1.15 | fists read as `9` |
| `pinchRatio` | 0.46 | tips that don't quite touch fail to register |
| `thumbDirY` (thumbs-up) | −0.6 | a fist reads as thumbs-up |
| `HOLD_MS` | 1300 | players lock in answers by accident |

Other keys: `R` restart · `L` signs legend · `M` mute · `S` skip question · `F` fullscreen
· `Esc` close legend. The game object is also on `window.__booth` for the host console.

---

## The question bank

`src/game/questions.ts` holds the bank. Each entry is:

```ts
{
  id: 'anniversary',
  prompt: 'Happy ___th Anniversary! Complete the phrase with your hands!',
  sub: 'One hand for the tens digit, one hand for the ones digit.',
  answer: ['3', '0'],          // screen-left first
  reveal: '30 years — happy anniversary!',
  level: 'warmup',
}
```

`pickSession(count)` always opens with a warm-up and then interleaves fun and tricky
questions, so no two groups get the same run. Answers can be one or two symbols; `👍` is
a valid symbol too.

To add a question, add an object to `QUESTIONS` with an `answer` of one or two ids from
`SYMBOLS`. Nothing else needs changing.

---

## Booth setup

- **Machine:** any modern laptop or mini PC. Apple Silicon or a machine with a working
  GPU delegate will comfortably hit 30 Hz inference; check with `D`.
- **Camera:** 720p is plenty. Mount it **above** the screen, angled slightly down, so it
  sees the hands of both tall and short students. Keep the play area about 1–1.5 m away.
- **Lighting:** avoid a bright window directly behind the player — backlighting is the
  single biggest cause of missed hands.
- **Screen:** 1080p or 720p, full-screen kiosk. Every screen was laid out to fit
  1280×720 without scrolling.
- **Sound:** on, at a sensible level. Muting is one click (`M`) if the room gets loud.
- **Privacy:** the feed never leaves the machine. Put a small "no recording" note next to
  the booth if the venue needs it.

Offline: the MediaPipe WASM runtime and the hand model are vendored into `public/`, and
the fonts are local `.woff2` files. After `npm run build` the booth needs no network at
all.

---

## Testing

```bash
npm test        # 47 checks, no browser needed
```

Covers three things:

1. **Pose recognition** — synthetic 21-point skeletons built from a simple anatomical
   model are fed through `analyseHand`; all 11 signs must be named correctly.
2. **Answer matching** — that `30` needs `3` on the screen-left and `0` on the
   screen-right, that `03` is rejected, that single-hand answers accept either hand.
3. **Engine** — hold-to-lock timing (a quick flash must *not* lock in), phase
   transitions, scoring, hint escalation, and that walking away frees the booth.

The synthetic model validates the decision rules and their internal consistency; it is
not a substitute for testing with real hands, which is what the debug panel is for.

Optional UI smoke test (needs Playwright, deliberately not a dependency):

```bash
npm i --no-save playwright && npx playwright install chrome
npm run build && npm run serve &
npm run test:ui
```

It boots the real bundle in Chrome with a fake webcam, walks every screen at 1920×1080,
1440×900 and 1280×720, and fails on clipped content, off-screen or unclickable controls,
or any console error. Screenshots land in `/tmp/booth-shots`.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "This browser cannot reach the camera" | You opened the file directly. Use `npm run serve` (or `npm run kiosk`) and open the localhost URL. |
| Camera prompt appears every launch | Use `npm run kiosk`, which pre-grants it, or allow the camera permanently for `127.0.0.1`. |
| Hands are detected but never lock | Check the `D` panel: if the badge shows `?`, the pose is ambiguous — try a cleaner, more deliberate sign. |
| Digits flicker between two values | Raise `smoothingHalfLifeMs` or `voteWindow` in `HandTracker`, or lower `targetFps`. |
| Low fps / hot fan | Lower `targetFps` to 24, or request 960×540 in `HandTracker.start()`. |
| Everything is slow on a locked-down PC | The GPU delegate failed and it fell back to CPU automatically; check the console for the retry. |
| `9` fires when making a fist | Raise the ring `index reach` threshold in `classifier.ts`. |

## Known limits

- **Two digits per answer.** Four-hand numbers like `2025` are not supported; the bank
  avoids them.
- **One player at a time.** `numHands` is 2, and the game assumes both hands belong to
  the same person.
- **Handedness is not used for the answer.** MediaPipe reports handedness assuming a
  mirrored input, which is easy to get backwards; the game uses screen position instead,
  which is unambiguous and matches what the player sees.
- **Thresholds were tuned analytically, then validated against a synthetic hand model.**
  They behave well in the model and in the browser, but the first thing to do on site is
  put a real hand in front of the camera with `D` open and adjust if a sign is stubborn.
