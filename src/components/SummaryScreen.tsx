/**
 * End-of-session summary. Celebratory, and it invites the next group to play
 * by showing the current record for the day.
 */

import type { GameSnapshot } from '../game/engine.ts';

export interface SummaryScreenProps {
  snapshot: GameSnapshot;
  sessionBest: number;
  onRestart: () => void;
}

function medalFor(ratio: number): { title: string; blurb: string } {
  if (ratio >= 1) return { title: 'Perfect run!', blurb: 'Every single question, no hints needed.' };
  if (ratio >= 0.7) return { title: 'Hands down brilliant!', blurb: 'That was a serious display of finger agility.' };
  if (ratio >= 0.4) return { title: 'Nice work!', blurb: 'A solid run — try again and beat it.' };
  return { title: 'Good warm-up!', blurb: 'Now go again, you know the signs now.' };
}

export function SummaryScreen({ snapshot, sessionBest, onRestart }: SummaryScreenProps) {
  const ratio = snapshot.totalRounds > 0 ? snapshot.solvedCount / snapshot.totalRounds : 0;
  const medal = medalFor(ratio);
  const isRecord = snapshot.score > 0 && snapshot.score >= sessionBest;

  return (
    <div className="summary">
      <div className="card card--summary">
        <span className="card__eyebrow">Session complete</span>
        <h2 className="card__title">{medal.title}</h2>
        <p className="card__sub">{medal.blurb}</p>

        <div className="summary__stats">
          <div className="summary__stat">
            <span className="summary__value">{snapshot.score}</span>
            <span className="summary__label">points</span>
          </div>
          <div className="summary__stat">
            <span className="summary__value">
              {snapshot.solvedCount}
              <small>/{snapshot.totalRounds}</small>
            </span>
            <span className="summary__label">solved</span>
          </div>
          <div className="summary__stat">
            <span className="summary__value">{snapshot.bestStreak}</span>
            <span className="summary__label">best streak</span>
          </div>
        </div>

        {isRecord ? <p className="summary__record">🏆 Booth record!</p> : null}

        <div className="summary__cta">
          <button type="button" className="btn btn--primary" onClick={onRestart}>
            Play again
          </button>
          <p className="summary__hint">…or just raise a hand to start a new round</p>
        </div>
      </div>
    </div>
  );
}

export default SummaryScreen;
