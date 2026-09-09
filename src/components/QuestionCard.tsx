/**
 * The question card. Shows the riddle, then the reveal on a correct answer.
 * Hints escalate over time so nobody ever gets stuck and walks away.
 */

import type { GameSnapshot } from '../game/engine.ts';
import { SYMBOLS, type SymbolId } from '../game/symbols.ts';
import { HandIcon } from './HandIcon.tsx';

export interface QuestionCardProps {
  snapshot: GameSnapshot;
}

const HINT_TEXT: Record<number, string> = {
  1: 'Tip: hold the sign steady for a second and it will lock in.',
  2: 'Tip: the screen-left hand is the tens digit, the right one is the ones digit.',
  3: 'Here’s the shape you need — just copy it with your hands.',
};

function AnswerSlot({ want, revealed, locked }: { want: SymbolId; revealed: boolean; locked: boolean }) {
  return (
    <div className={`answer-slot${locked ? ' answer-slot--locked' : ''}`}>
      <div className="answer-slot__shape">
        {revealed || locked ? (
          <HandIcon symbol={want} size={96} />
        ) : (
          <div className="answer-slot__mystery" aria-hidden="true">
            ?
          </div>
        )}
      </div>
      <span className="answer-slot__label">{SYMBOLS[want].name}</span>
      {locked ? <span className="answer-slot__check">✓</span> : null}
    </div>
  );
}

export function QuestionCard({ snapshot }: QuestionCardProps) {
  const { question, phase, answer, hintLevel, lastRound, live } = snapshot;
  if (!question) return null;

  if (phase === 'celebrate' && lastRound) {
    return (
      <div className="card card--question card--correct">
        <span className="card__eyebrow">Correct!</span>
        <h2 className="card__title">{lastRound.question.reveal}</h2>
        <div className="card__scoreline">
          <span className="points">+{lastRound.points}</span>
          {lastRound.number !== null ? <span className="number-reveal">{lastRound.number}</span> : null}
        </div>
      </div>
    );
  }

  const revealed = hintLevel >= 3;
  const locked = answer.map((_, i) => (live.match?.slots[i]?.ok ?? false));
  const multi = answer.length > 1;

  return (
    <div className="card card--question">
      <span className="card__eyebrow">Question {snapshot.roundNumber} of {snapshot.totalRounds}</span>
      <h2 className="card__title">{question.prompt}</h2>
      {question.sub ? <p className="card__sub">{question.sub}</p> : null}

      <div className={`answer-row${multi ? '' : ' answer-row--single'}`}>
        {answer.map((want, i) => (
          <div className="answer-row__item" key={`${want}-${i}`}>
            <AnswerSlot want={want} revealed={revealed} locked={locked[i] ?? false} />
            {multi ? (
              <span className="answer-row__side">{i === 0 ? 'screen-left · tens' : 'screen-right · ones'}</span>
            ) : (
              <span className="answer-row__side">either hand</span>
            )}
          </div>
        ))}
      </div>

      {hintLevel > 0 ? <p className="card__hint">{HINT_TEXT[hintLevel] ?? ''}</p> : null}
    </div>
  );
}

export default QuestionCard;
