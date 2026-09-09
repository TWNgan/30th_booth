/**
 * The sign legend — the teaching card that makes the whole game learnable in
 * about ten seconds. Doubles as the attract-mode demo and the pause screen.
 */

import { DIGIT_SYMBOLS, SYMBOLS } from '../game/symbols.ts';
import { HandIcon } from './HandIcon.tsx';

export interface LegendProps {
  onClose?: () => void;
}

export function Legend({ onClose }: LegendProps) {
  return (
    <div className="legend">
      <div className="legend__head">
        <h2 className="legend__title">Make these numbers with one hand</h2>
        <p className="legend__sub">
          One hand per digit. The hand on the <strong>left of the screen</strong> is the tens digit, the
          other is the ones digit. Hold the sign steady to lock it in.
        </p>
        {onClose ? (
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Got it
          </button>
        ) : null}
      </div>

      <ul className="legend__grid">
        {DIGIT_SYMBOLS.map((def, i) => (
          <li className="legend__item" key={def.id} style={{ animationDelay: `${i * 70}ms` }}>
            <span className="legend__num">{def.glyph}</span>
            <HandIcon symbol={def.id} size={104} className="legend__hand" />
            <span className="legend__how">{def.howTo}</span>
          </li>
        ))}
        <li className="legend__item legend__item--extra" style={{ animationDelay: '700ms' }}>
          <span className="legend__num">👍</span>
          <HandIcon symbol="thumbsUp" size={104} className="legend__hand" />
          <span className="legend__how">{SYMBOLS.thumbsUp.howTo}</span>
        </li>
      </ul>
    </div>
  );
}

export default Legend;
