import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AttractScreen } from './components/AttractScreen.tsx';
import { CameraStage } from './components/CameraStage.tsx';
import { Hud } from './components/Hud.tsx';
import { Legend } from './components/Legend.tsx';
import { QuestionCard } from './components/QuestionCard.tsx';
import { StartScreen } from './components/StartScreen.tsx';
import { SummaryScreen } from './components/SummaryScreen.tsx';
import { celebrate, finale } from './game/celebrate.ts';
import { BoothGame, type EngineEvent } from './game/engine.ts';
import { useAudio } from './hooks/useAudio.ts';
import { HandTracker, type TrackerFrame, type TrackerStatus } from './vision/handTracker.ts';
import './styles/global.css';
import './styles/booth.css';

const BEST_KEY = 'handsup.booth.best';

function readBest(): number {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

export function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const frameSubscribers = useRef(new Set<(frame: TrackerFrame) => void>());

  const audio = useAudio();
  const audioRef = useRef(audio);
  audioRef.current = audio;

  // The engine is created once and talks to React through a stable indirection,
  // so its event handlers always see the current audio/UI callbacks.
  const handlerRef = useRef<(event: EngineEvent) => void>(() => undefined);
  const game = useMemo(
    () => new BoothGame({ rounds: 7, onEvent: (event) => handlerRef.current(event) }),
    [],
  );
  const snapshot = useSyncExternalStore(game.subscribe, game.getSnapshot);

  const [status, setStatus] = useState<TrackerStatus>({ kind: 'idle' });
  const [booted, setBooted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [sessionBest, setSessionBest] = useState(readBest);

  const subscribeFrames = useCallback((fn: (frame: TrackerFrame) => void) => {
    frameSubscribers.current.add(fn);
    return () => {
      frameSubscribers.current.delete(fn);
    };
  }, []);

  useEffect(() => {
    handlerRef.current = (event) => {
      const sound = audioRef.current;
      switch (event.type) {
        case 'game-start':
          sound.play('start');
          break;
        case 'round-start':
          sound.play('round');
          break;
        case 'hint':
          sound.play('hint');
          break;
        case 'wrong':
          sound.play('wrong');
          break;
        case 'correct':
          sound.play('correct');
          celebrate();
          break;
        case 'game-end': {
          sound.play('finish');
          finale();
          setSessionBest((previous) => {
            const next = Math.max(previous, event.score);
            try {
              window.localStorage.setItem(BEST_KEY, String(next));
            } catch {
              /* private mode — a lost high score is not worth an error */
            }
            return next;
          });
          break;
        }
        case 'attract':
          break;
      }
    };
  }, []);

  const handleStart = useCallback(async () => {
    setStarting(true);
    await audioRef.current.enable();

    const video = videoRef.current;
    if (!video) {
      setStarting(false);
      return;
    }

    let tracker = trackerRef.current;
    if (!tracker) {
      tracker = new HandTracker({ maxHands: 2, targetFps: 60 });
      trackerRef.current = tracker;
    }
    tracker.onStatus = setStatus;
    tracker.onFrame = (frame) => {
      game.tick(frame.hands, frame.timestamp, frame.fps, frame.inferenceMs);
      audioRef.current.lockTick(game.getSnapshot().live.holdProgress);
      for (const fn of frameSubscribers.current) fn(frame);
    };

    setBooted(true);
    await tracker.start(video);
    setStarting(false);
  }, [game]);

  useEffect(() => () => trackerRef.current?.stop(), []);

  // Exposed for the booth host and for automated smoke tests: lets you force a
  // phase from the browser console, e.g. __booth.startSession(performance.now()).
  useEffect(() => {
    (window as unknown as { __booth?: BoothGame }).__booth = game;
    return () => {
      delete (window as unknown as { __booth?: BoothGame }).__booth;
    };
  }, [game]);

  const restart = useCallback(() => {
    game.startSession(performance.now());
  }, [game]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'r') restart();
      else if (key === 'l') setLegendOpen((open) => !open);
      else if (key === 'm') audioRef.current.toggleMuted();
      else if (key === 'd') setShowDebug((shown) => !shown);
      else if (key === 'escape') setLegendOpen(false);
      else if (key === 'f') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => undefined);
      } else if (key === 's') {
        game.skip(performance.now());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, restart]);

  const dimmed = snapshot.phase === 'attract' || snapshot.phase === 'finished';
  const cameraFailed = status.kind === 'error';

  return (
    <div className="app">
      <Hud
        snapshot={snapshot}
        muted={audio.muted}
        onToggleMuted={audio.toggleMuted}
        onShowLegend={() => setLegendOpen(true)}
        onRestart={restart}
      />

      <CameraStage videoRef={videoRef} game={game} subscribeFrames={subscribeFrames} dimmed={dimmed}>
        {!booted || cameraFailed ? (
          <StartScreen status={status} starting={starting} onStart={handleStart} />
        ) : null}

        {booted && !cameraFailed && snapshot.phase === 'attract' ? (
          <AttractScreen onOpenLegend={() => setLegendOpen(true)} />
        ) : null}

        {snapshot.phase === 'playing' || snapshot.phase === 'celebrate' ? (
          <QuestionCard snapshot={snapshot} />
        ) : null}

        {snapshot.phase === 'finished' ? (
          <SummaryScreen snapshot={snapshot} sessionBest={sessionBest} onRestart={restart} />
        ) : null}

        {legendOpen ? <Legend onClose={() => setLegendOpen(false)} /> : null}

        {showDebug ? <DebugPanel snapshot={snapshot} /> : null}

        {status.kind === 'loading' && booted && !cameraFailed ? (
          <div className="status-toast">{status.detail}</div>
        ) : null}
      </CameraStage>
    </div>
  );
}

function DebugPanel({ snapshot }: { snapshot: ReturnType<BoothGame['getSnapshot']> }) {
  const live = snapshot.live;
  return (
    <div className="debug">
      <div className="debug__row">
        <strong>{snapshot.phase}</strong>
        <span>
          {live.fps.toFixed(0)} fps · {live.inferenceMs.toFixed(1)} ms
        </span>
        <span>hold {(live.holdProgress * 100).toFixed(0)}%</span>
      </div>
      {live.hands.map((hand) => (
        <div className="debug__row debug__row--hand" key={hand.slot}>
          <strong>slot {hand.slot}</strong>
          <span>{hand.handedness}</span>
          <span>sym {hand.symbol ?? '—'}</span>
          <span>conf {hand.symbolConfidence.toFixed(2)}</span>
          <span className="debug__fingers">
            {(['thumb', 'index', 'middle', 'ring', 'pinky'] as const)
              .map((f) => `${f[0]}${hand.fingers[f].extended ? '1' : '0'}`)
              .join(' ')}
          </span>
        </div>
      ))}
      {live.hands.length === 0 ? <div className="debug__row">no hands</div> : null}
      <div className="debug__hint">R restart · L signs · M mute · S skip · F fullscreen · D debug</div>
    </div>
  );
}

export default App;
