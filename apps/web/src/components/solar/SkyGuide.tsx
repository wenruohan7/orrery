import { X } from 'lucide-react';
import { KindDot } from '../SpaceDialogs';
import type { SpaceKind } from '../../lib/hierarchy';

const ROWS: { kind: SpaceKind; name: string; text: string }[] = [
  { kind: 'blackhole', name: 'Black hole', text: 'The heart of a galaxy. Each top-level folder is a galaxy, and its folder note (a note named like the folder) is the black hole.' },
  { kind: 'star', name: 'Star', text: 'A note that orbits a black hole. Tap a black hole and choose Add star, or set a note to orbit it.' },
  { kind: 'planet', name: 'Planet', text: 'A note that orbits a star, lit by that star. Tap a star and choose Add planet.' },
  { kind: 'moon', name: 'Moon', text: 'A note that orbits a planet. Tap a planet and choose Add moon.' },
  { kind: 'asteroid', name: 'Asteroids and rogue planets', text: 'Notes that aren’t in orbit yet. Give them an orbit to pull them in.' },
];

export function SkyGuide({ onClose }: { onClose(): void }) {
  return (
    <div className="galaxy-panel sky-guide">
      <div className="galaxy-panel-head">
        <h2>How the sky works</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close guide">
          <X size={18} />
        </button>
      </div>
      <div className="guide-rows">
        {ROWS.map((r) => (
          <div key={r.kind} className="guide-row">
            <KindDot kind={r.kind} />
            <div>
              <b>{r.name}</b>
              <p className="muted small">{r.text}</p>
            </div>
          </div>
        ))}
        <div className="guide-row">
          <span className="kind-dot beam" aria-hidden />
          <div>
            <b>Light beams</b>
            <p className="muted small">Links between notes that don’t orbit each other.</p>
          </div>
        </div>
      </div>
      <section>
        <div className="design-label">Moving things around</div>
        <ul className="guide-tips small">
          <li>
            Every note has an <b>Orbits</b> setting: on its card here, or under its title when you open it. Pick what it should circle.
          </li>
          <li>Without an Orbits setting, links decide: notes the black hole links to become stars, and so on down.</li>
          <li>
            <b>New note</b> lets you choose its orbit straight away.
          </li>
          <li>Use ↑ Up, Core and ‹ › on a card to move around, or swipe the card on a phone.</li>
        </ul>
      </section>
    </div>
  );
}
