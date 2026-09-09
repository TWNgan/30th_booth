/**
 * Boot screen. The button is not decoration: browsers only allow audio and
 * camera prompts after a real user gesture, and it gives the model a moment to
 * warm up before the first student walks over.
 */

import { HandIcon } from './HandIcon.tsx';
import type { TrackerStatus } from '../vision/handTracker.ts';

export interface StartScreenProps {
  status: TrackerStatus;
  starting: boolean;
  onStart: () => void;
}

export function StartScreen({ status, starting, onStart }: StartScreenProps) {
  const loading = status.kind === 'loading';
  const errored = status.kind === 'error';

  return (
    <div className="start">
      <div className="card card--start">
        <div className="start__hands" aria-hidden="true">
          <HandIcon symbol="3" size={128} className="start__hand start__hand--a" />
          <HandIcon symbol="0" size={128} className="start__hand start__hand--b" />
        </div>
        <span className="card__eyebrow">30th anniversary booth</span>
        <h1 className="start__title">
          Hands<span>Up!</span>
        </h1>
        <p className="start__lede">
          A quiz you answer with your hands. The camera reads your fingers — no touching, no
          controllers, nothing to wipe down between players.
        </p>

        <ul className="start__points">
          <li>
            <span aria-hidden="true">1</span> Read the question on screen.
          </li>
          <li>
            <span aria-hidden="true">2</span> Make the number with your hands.
          </li>
          <li>
            <span aria-hidden="true">3</span> Hold it steady until the ring fills.
          </li>
        </ul>

        <button type="button" className="btn btn--primary btn--big" onClick={onStart} disabled={starting || loading}>
          {starting || loading ? 'Warming up the camera…' : 'Start the booth'}
        </button>

        {loading ? <p className="start__status">{status.detail}</p> : null}
        {errored ? (
          <p className="start__error">
            <strong>Could not start:</strong> {status.message}
            <br />
            Check the camera permission for this page, then reload.
          </p>
        ) : null}

        <p className="start__privacy">
          Everything runs on this machine. No video is uploaded, recorded or stored.
        </p>
      </div>
    </div>
  );
}

export default StartScreen;
