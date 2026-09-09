/**
 * The camera stage: mirrored webcam feed plus the canvas overlay that draws
 * the tracked hands. Children are layered on top as normal DOM.
 */

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { BoothGame } from '../game/engine.ts';
import type { TrackerFrame } from '../vision/handTracker.ts';
import { drawOverlay } from './overlay.ts';

export interface CameraStageProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  game: BoothGame;
  subscribeFrames: (fn: (frame: TrackerFrame) => void) => () => void;
  /** fade the feed back when the booth is idle */
  dimmed?: boolean;
  children?: ReactNode;
}

export function CameraStage({ videoRef, game, subscribeFrames, dimmed = false, children }: CameraStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement>(null);

  // Keep the backing store in sync with the CSS box, without reading layout
  // on every frame.
  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    const apply = () => {
      const rect = stage.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { width: rect.width, height: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeFrames(() => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return;

      const snapshot = game.getSnapshot();
      const live = snapshot.live;

      drawOverlay({
        ctx,
        width,
        height,
        hands: live.hands,
        match: live.match,
        slotProgress: live.slotProgress,
        holdProgress: live.holdProgress,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        time: performance.now(),
        showSkeleton: snapshot.phase !== 'attract',
      });
    });
    return unsubscribe;
  }, [game, subscribeFrames, videoRef]);

  return (
    <div className={`stage${dimmed ? ' stage--dim' : ''}`} ref={stageRef}>
      <video ref={videoRef} className="stage__video" autoPlay muted playsInline />
      <div className="stage__wash" aria-hidden="true" />
      <canvas ref={canvasRef} className="stage__canvas" />
      {children}
    </div>
  );
}

export default CameraStage;
