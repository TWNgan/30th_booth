/**
 * Optional UI smoke test. Boots the built booth in a real Chrome with a fake
 * webcam, walks through every screen and reports layout problems (clipped text,
 * off-screen or unclickable controls) plus any console error.
 *
 * Requires Playwright, which is deliberately not a dependency:
 *   npm i --no-save playwright && npx playwright install chrome
 *
 * Then, with the booth already served:
 *   npm run build && npm run serve &
 *   npm run test:ui
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173/';
const OUT = process.env.SHOT_DIR ?? '/tmp/booth-shots';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'tv', width: 1920, height: 1080 },
  { name: 'laptop', width: 1440, height: 900 },
  { name: 'small', width: 1280, height: 720 },
];

/** Runs inside the page: geometry and clickability checks. */
const AUDIT = () => {
  const issues = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).join('.') : '';
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  for (const el of [...document.querySelectorAll('body *')].filter(visible)) {
    const r = el.getBoundingClientRect();
    const decorative = el.closest('[aria-hidden="true"]') !== null;
    if (!decorative && (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1)) {
      issues.push(`offscreen ${describe(el)} @ ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }

  // Controls must actually be clickable at their centre.
  for (const el of document.querySelectorAll('button')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) {
      issues.push(`button offscreen ${describe(el)}`);
      continue;
    }
    const top = document.elementFromPoint(cx, cy);
    // Ignore anything sitting behind a modal panel, which is intentional.
    if (top && top !== el && !el.contains(top) && !top.contains(el) && !top.closest('.legend')) {
      issues.push(`button blocked ${describe(el)} by ${describe(top)}`);
    }
  }

  return {
    issues,
    headings: [...document.querySelectorAll('h1,h2')].map((h) => h.textContent.trim().slice(0, 60)),
    fonts: [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family))],
  };
};

const browser = await chromium.launch({
  channel: 'chrome',
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const report = {};

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    permissions: ['camera'],
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

  const screens = {};
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  screens.start = await page.evaluate(AUDIT);
  await page.screenshot({ path: `${OUT}/${vp.name}-01-start.png` });

  await page.getByRole('button', { name: /start the booth/i }).click();
  await page.waitForTimeout(9000);
  screens.attract = await page.evaluate(AUDIT);
  await page.screenshot({ path: `${OUT}/${vp.name}-02-attract.png` });

  await page.getByRole('button', { name: /see all hand signs/i }).click();
  await page.waitForTimeout(800);
  screens.legend = await page.evaluate(AUDIT);
  await page.screenshot({ path: `${OUT}/${vp.name}-03-legend.png` });
  await page.getByRole('button', { name: /got it/i }).click();
  await page.waitForTimeout(400);

  await page.evaluate(() => window.__booth.startSession(performance.now()));
  await page.waitForTimeout(900);
  screens.question = await page.evaluate(AUDIT);
  await page.screenshot({ path: `${OUT}/${vp.name}-04-question.png` });

  // Drive a correct answer so the celebration screen can be reviewed.
  await page.evaluate(() => {
    const booth = window.__booth;
    const answer = booth.getSnapshot().answer;
    const now = performance.now();
    const hands = answer.map((symbol, i) => ({
      slot: i,
      handedness: 'Right',
      handednessScore: 1,
      landmarks: Array.from({ length: 21 }, (_, k) => ({ x: 0.32 + i * 0.36, y: 0.42 + (k % 5) * 0.02, z: 0 })),
      center: { x: 0.32 + i * 0.36, y: 0.47 },
      screenX: 0.32 + i * 0.36,
      palmSize: 0.08,
      fingers: Object.fromEntries(
        ['thumb', 'index', 'middle', 'ring', 'pinky'].map((f) => [f, { extension: 1, extended: true }]),
      ),
      symbol,
      symbolConfidence: 1,
      pinchRatio: 1,
      debug: {},
    }));
    for (let i = 0; i < 140; i++) booth.tick(hands, now + i * 16, 60, 8);
  });
  await page.waitForTimeout(600);
  screens.celebrate = await page.evaluate(AUDIT);
  await page.screenshot({ path: `${OUT}/${vp.name}-05-celebrate.png` });

  // Skip out the rest of the session and check the summary.
  await page.evaluate(async () => {
    const booth = window.__booth;
    for (let i = 0; i < 12; i++) {
      const started = Date.now();
      while (booth.getSnapshot().phase === 'celebrate' && Date.now() - started < 4000) {
        await new Promise((r) => setTimeout(r, 60));
      }
      if (booth.getSnapshot().phase !== 'playing') break;
      booth.skip(performance.now());
      await new Promise((r) => setTimeout(r, 60));
    }
  });
  await page.waitForTimeout(1200);
  screens.summary = await page.evaluate(AUDIT);
  await page.screenshot({ path: `${OUT}/${vp.name}-06-summary.png` });

  const runtime = await page.evaluate(() => {
    const snap = window.__booth.getSnapshot();
    const video = document.querySelector('video');
    return {
      phase: snap.phase,
      score: snap.score,
      total: snap.totalRounds,
      fps: Math.round(snap.live.fps),
      inferenceMs: Number(snap.live.inferenceMs.toFixed(1)),
      videoSize: video ? `${video.videoWidth}x${video.videoHeight}` : 'none',
    };
  });

  report[vp.name] = { runtime, problems, screens };
  await context.close();
}

let failures = 0;
for (const [name, data] of Object.entries(report)) {
  console.log(`\n=== ${name} === ${JSON.stringify(data.runtime)}`);
  if (data.problems.length) {
    failures += data.problems.length;
    for (const p of data.problems) console.log(`  ERROR  ${p}`);
  }
  for (const [screen, audit] of Object.entries(data.screens)) {
    if (audit.issues.length === 0) continue;
    failures += audit.issues.length;
    console.log(`  ${screen}:`);
    for (const issue of audit.issues) console.log(`    - ${issue}`);
  }
}

console.log(`\nScreenshots in ${OUT}`);
console.log(failures === 0 ? 'No UI problems found.' : `${failures} UI problem(s) found.`);
await browser.close();
process.exitCode = failures === 0 ? 0 : 1;
