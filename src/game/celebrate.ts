/**
 * Pastel celebration bursts. canvas-confetti renders into its own fixed,
 * pointer-events:none canvas, so it never interferes with the camera stage.
 */

import confetti from 'canvas-confetti';

export const PASTEL = [
  '#FFB3C7',
  '#FFD6A5',
  '#FDFFB6',
  '#CAFFBF',
  '#9BF6FF',
  '#A0C4FF',
  '#BDB2FF',
  '#FFC6FF',
];

function burst(x: number, y: number, count: number, spread: number, scalar = 1): void {
  void confetti({
    particleCount: count,
    spread,
    startVelocity: 42 * scalar,
    decay: 0.91,
    scalar: scalar * 1.05,
    ticks: 220,
    gravity: 0.9,
    origin: { x, y },
    colors: PASTEL,
    disableForReducedMotion: true,
  });
}

/** The main "you got it" celebration. */
export function celebrate(): void {
  burst(0.5, 0.62, 90, 78, 1.15);
  window.setTimeout(() => burst(0.22, 0.7, 55, 62), 110);
  window.setTimeout(() => burst(0.78, 0.7, 55, 62), 210);
  window.setTimeout(() => {
    void confetti({
      particleCount: 130,
      spread: 130,
      startVelocity: 30,
      decay: 0.93,
      ticks: 260,
      gravity: 0.75,
      scalar: 0.8,
      origin: { x: 0.5, y: 0.35 },
      colors: PASTEL,
      shapes: ['circle'],
      disableForReducedMotion: true,
    });
  }, 330);
}

/** Big finale for the end of a session. */
export function finale(): void {
  const end = Date.now() + 2200;
  const frame = () => {
    if (Date.now() > end) return;
    void confetti({
      particleCount: 6,
      angle: 60,
      spread: 60,
      origin: { x: 0, y: 0.75 },
      colors: PASTEL,
      disableForReducedMotion: true,
    });
    void confetti({
      particleCount: 6,
      angle: 120,
      spread: 60,
      origin: { x: 1, y: 0.75 },
      colors: PASTEL,
      disableForReducedMotion: true,
    });
    requestAnimationFrame(frame);
  };
  frame();
  window.setTimeout(celebrate, 120);
}
