/**
 * All sound effects are synthesised with the Web Audio API, so the booth has
 * zero audio assets to ship and nothing to go missing on the day.
 *
 * The AudioContext is created on the first user gesture (the Start button),
 * which is also what browsers require for audio to be allowed at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type SoundName =
  | 'start'
  | 'round'
  | 'correct'
  | 'wrong'
  | 'hint'
  | 'lock'
  | 'finish'
  | 'blip';

interface Voice {
  freq: number;
  /** seconds after the sound starts */
  at: number;
  dur: number;
  type: OscillatorType;
  gain: number;
}

const RECIPES: Record<SoundName, Voice[]> = {
  start: [
    { freq: 392, at: 0, dur: 0.16, type: 'triangle', gain: 0.2 },
    { freq: 587, at: 0.1, dur: 0.2, type: 'triangle', gain: 0.2 },
    { freq: 784, at: 0.22, dur: 0.3, type: 'triangle', gain: 0.18 },
  ],
  round: [
    { freq: 523, at: 0, dur: 0.1, type: 'sine', gain: 0.12 },
    { freq: 784, at: 0.09, dur: 0.16, type: 'sine', gain: 0.12 },
  ],
  correct: [
    { freq: 523.25, at: 0, dur: 0.16, type: 'triangle', gain: 0.22 },
    { freq: 659.25, at: 0.1, dur: 0.16, type: 'triangle', gain: 0.22 },
    { freq: 783.99, at: 0.2, dur: 0.2, type: 'triangle', gain: 0.22 },
    { freq: 1046.5, at: 0.32, dur: 0.42, type: 'triangle', gain: 0.2 },
    { freq: 1567.98, at: 0.34, dur: 0.5, type: 'sine', gain: 0.08 },
  ],
  wrong: [
    { freq: 349.23, at: 0, dur: 0.16, type: 'sine', gain: 0.14 },
    { freq: 261.63, at: 0.13, dur: 0.26, type: 'sine', gain: 0.13 },
  ],
  hint: [
    { freq: 880, at: 0, dur: 0.22, type: 'sine', gain: 0.12 },
    { freq: 1318.51, at: 0.1, dur: 0.3, type: 'sine', gain: 0.07 },
  ],
  lock: [{ freq: 660, at: 0, dur: 0.06, type: 'square', gain: 0.05 }],
  finish: [
    { freq: 523.25, at: 0, dur: 0.18, type: 'triangle', gain: 0.2 },
    { freq: 659.25, at: 0.14, dur: 0.18, type: 'triangle', gain: 0.2 },
    { freq: 783.99, at: 0.28, dur: 0.18, type: 'triangle', gain: 0.2 },
    { freq: 1046.5, at: 0.42, dur: 0.7, type: 'triangle', gain: 0.22 },
    { freq: 1318.51, at: 0.6, dur: 0.8, type: 'sine', gain: 0.1 },
  ],
  blip: [{ freq: 1200, at: 0, dur: 0.05, type: 'sine', gain: 0.06 }],
};

export interface AudioApi {
  play: (name: SoundName) => void;
  /** rising tick while a gesture locks in; call with 0..1 */
  lockTick: (progress: number) => void;
  muted: boolean;
  toggleMuted: () => void;
  enabled: boolean;
  enable: () => Promise<void>;
}

export function useAudio(): AudioApi {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const [muted, setMuted] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const lastTickRef = useRef(0);
  const mutedRef = useRef(false);

  useEffect(() => {
    mutedRef.current = muted;
    if (masterRef.current && ctxRef.current) {
      masterRef.current.gain.setTargetAtTime(muted ? 0 : 0.9, ctxRef.current.currentTime, 0.02);
    }
  }, [muted]);

  const enable = useCallback(async () => {
    if (!ctxRef.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      ctxRef.current = ctx;
      masterRef.current = master;
    }
    if (ctxRef.current.state === 'suspended') await ctxRef.current.resume();
    setEnabled(ctxRef.current.state === 'running');
  }, []);

  const play = useCallback((name: SoundName) => {
    const ctx = ctxRef.current;
    const master = masterRef.current;
    if (!ctx || !master || mutedRef.current || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + 0.005;

    for (const voice of RECIPES[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = voice.type;
      osc.frequency.setValueAtTime(voice.freq, t0 + voice.at);
      // Short attack, exponential release — reads as a soft "pluck".
      gain.gain.setValueAtTime(0.0001, t0 + voice.at);
      gain.gain.exponentialRampToValueAtTime(voice.gain, t0 + voice.at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + voice.at + voice.dur);
      osc.connect(gain).connect(master);
      osc.start(t0 + voice.at);
      osc.stop(t0 + voice.at + voice.dur + 0.05);
    }
  }, []);

  const lockTick = useCallback(
    (progress: number) => {
      const ctx = ctxRef.current;
      const master = masterRef.current;
      if (!ctx || !master || mutedRef.current || ctx.state !== 'running') return;
      if (progress <= 0 || progress >= 1) return;
      const now = ctx.currentTime;
      if (now - lastTickRef.current < 0.11) return;
      lastTickRef.current = now;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520 + progress * 620, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.035 + progress * 0.03, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      osc.connect(gain).connect(master);
      osc.start(now);
      osc.stop(now + 0.12);
    },
    [],
  );

  const toggleMuted = useCallback(() => setMuted((m) => !m), []);

  return useMemo(
    () => ({ play, lockTick, muted, toggleMuted, enabled, enable }),
    [play, lockTick, muted, toggleMuted, enabled, enable],
  );
}
