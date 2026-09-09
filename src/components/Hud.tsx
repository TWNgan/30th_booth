/**
 * Top bar: live score, streak, session progress and the sound toggle.
 */

import type { GameSnapshot } from '../game/engine.ts';

export interface HudProps {
  snapshot: GameSnapshot;
  muted: boolean;
  onToggleMuted: () => void;
  onShowLegend: () => void;
  onRestart: () => void;
}

export function Hud({ snapshot, muted, onToggleMuted, onShowLegend, onRestart }: HudProps) {
  const playing = snapshot.phase !== 'attract';
  const rounds = Array.from({ length: snapshot.totalRounds }, (_, i) => i);

  return (
    <header className="hud">
      <div className="hud__brand">
        <span className="hud__mark">30</span>
        <span className="hud__brandtext">
          Hands Up!
          <em>anniversary booth</em>
        </span>
      </div>

      <div className="hud__stats">
        <div className="stat">
          <span className="stat__label">Score</span>
          <span className="stat__value">{snapshot.score}</span>
        </div>
        <div className={`stat stat--streak${snapshot.streak > 1 ? ' stat--hot' : ''}`}>
          <span className="stat__label">Streak</span>
          <span className="stat__value">{snapshot.streak}</span>
        </div>
        {playing && snapshot.totalRounds > 0 ? (
          <ol className="hud__dots" aria-label="Progress through this session">
            {rounds.map((i) => (
              <li
                key={i}
                className={
                  i < snapshot.solvedCount
                    ? 'hud__dot hud__dot--done'
                    : i === snapshot.roundNumber - 1
                      ? 'hud__dot hud__dot--now'
                      : 'hud__dot'
                }
              />
            ))}
          </ol>
        ) : null}
      </div>

      <div className="hud__actions">
        <button type="button" className="icon-btn" onClick={onShowLegend} title="How to make every number">
          <span aria-hidden="true">✋</span>
          <span className="icon-btn__text">Signs</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleMuted}
          title={muted ? 'Unmute' : 'Mute'}
          aria-pressed={muted}
        >
          <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
          <span className="icon-btn__text">{muted ? 'Muted' : 'Sound'}</span>
        </button>
        {playing ? (
          <button type="button" className="icon-btn" onClick={onRestart} title="Start a new session">
            <span aria-hidden="true">↻</span>
            <span className="icon-btn__text">Restart</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}

export default Hud;
