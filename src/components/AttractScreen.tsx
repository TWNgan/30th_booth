/**
 * Attract mode: what runs when nobody is playing. It has to answer three
 * questions in two seconds from across the room — what is this, how do I play,
 * and what do I do right now.
 */

import { HandIcon } from './HandIcon.tsx';
import { DIGIT_SYMBOLS } from '../game/symbols.ts';

export interface AttractScreenProps {
  onOpenLegend: () => void;
}

export function AttractScreen({ onOpenLegend }: AttractScreenProps) {
  return (
    <div className="attract">
      <div className="attract__inner">
        <p className="attract__kicker">30th anniversary booth</p>
        <h1 className="attract__title">
          Hands<span className="attract__title-accent">Up!</span>
        </h1>
        <p className="attract__lede">
          Answer the quiz <em>without saying a word</em>. Make the number with your hands, hold it
          steady, and the booth will do the rest.
        </p>

        <div className="attract__demo">
          <div className="attract__demo-hand">
            <HandIcon symbol="3" size={148} className="attract__hand attract__hand--left" />
            <span className="attract__demo-label">tens</span>
          </div>
          <span className="attract__demo-eq">+</span>
          <div className="attract__demo-hand">
            <HandIcon symbol="0" size={148} className="attract__hand attract__hand--right" />
            <span className="attract__demo-label">ones</span>
          </div>
          <span className="attract__demo-eq">=</span>
          <div className="attract__demo-result">
            <span className="attract__demo-number">30</span>
            <span className="attract__demo-label">years!</span>
          </div>
        </div>

        <div className="attract__cta">
          <span className="attract__pulse" aria-hidden="true" />
          <span>
            Raise a hand and make a sign to <strong>start</strong>
          </span>
        </div>

        <button type="button" className="btn btn--ghost attract__legend-btn" onClick={onOpenLegend}>
          See all hand signs
        </button>
      </div>

      <ul className="attract__strip" aria-hidden="true">
        {DIGIT_SYMBOLS.map((def) => (
          <li key={def.id} className="attract__strip-item">
            <HandIcon symbol={def.id} size={58} />
            <span>{def.glyph}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default AttractScreen;
