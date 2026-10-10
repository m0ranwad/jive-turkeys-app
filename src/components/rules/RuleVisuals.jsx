import { Check } from 'lucide-react';
import { CARD } from '@/lib/constants';
import { jerseyText } from '@/lib/format';

const RED = '#ef4444';
const LIME = '#a3e635';

/** Top-down indoor field showing a three-line violation and where play restarts. */
export function ThreeLineDiagram() {
  const labels = [
    { x: 100, text: 'RED LINE' },
    { x: 160, text: 'CENTER' },
    { x: 220, text: 'RED LINE' },
  ];
  return (
    <figure className="mt-3 max-w-md rounded-2xl bg-zinc-50 p-3">
      <svg viewBox="0 0 320 146" className="h-auto w-full" role="img" aria-label="Field drawing of the three-line rule">
        {labels.map((l) => (
          <text
            key={l.x}
            x={l.x}
            y={11}
            textAnchor="middle"
            fontSize="9"
            fontWeight="800"
            letterSpacing="0.8"
            fill="#71717a"
          >
            {l.text}
          </text>
        ))}
        <rect x="10" y="20" width="300" height="116" rx="20" fill="#18181b" stroke="#3f3f46" strokeWidth="3" />
        <g fill="none" stroke="#fafafa" strokeOpacity="0.35" strokeWidth="1.5">
          <rect x="10" y="46" width="36" height="64" />
          <rect x="274" y="46" width="36" height="64" />
          <circle cx="160" cy="78" r="16" />
        </g>
        <g fill="none" stroke="#fafafa" strokeWidth="2">
          <rect x="3" y="63" width="7" height="30" rx="2" />
          <rect x="310" y="63" width="7" height="30" rx="2" />
        </g>
        <line x1="160" y1="21.5" x2="160" y2="134.5" stroke="#fafafa" strokeOpacity="0.7" strokeWidth="2" />
        <line x1="100" y1="21.5" x2="100" y2="134.5" stroke={RED} strokeWidth="3" />
        <line x1="220" y1="21.5" x2="220" y2="134.5" stroke={RED} strokeWidth="3" />
        <path
          d="M52 104 Q160 -20 268 54"
          fill="none"
          stroke={LIME}
          strokeWidth="2.5"
          strokeDasharray="5 5"
          strokeLinecap="round"
        />
        <circle cx="52" cy="104" r="4" fill={LIME} />
        <circle cx="268" cy="54" r="6" fill="#fafafa" stroke="#18181b" strokeWidth="1.5" />
        <circle cx="100" cy="82" r="9" fill={RED} stroke="#18181b" strokeWidth="2" />
        <path d="M96 78 L104 86 M104 78 L96 86" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <figcaption className="mt-2.5 space-y-1.5 text-xs leading-snug text-zinc-600">
        <div className="flex gap-2">
          <span className="mt-1.5 h-0.5 w-4 shrink-0 border-t-2 border-dashed border-lime-500" />
          <span>The ball goes over all three lines in the air without touching anything.</span>
        </div>
        <div className="flex gap-2">
          <svg viewBox="0 0 16 16" className="mt-px h-4 w-4 shrink-0" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill={RED} />
            <path d="M5.5 5.5 L10.5 10.5 M10.5 5.5 L5.5 10.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span>The other team restarts from the middle of the first red line it crossed.</span>
        </div>
      </figcaption>
    </figure>
  );
}

function PlayingCard({ className }) {
  return (
    <span
      className={`mt-0.5 h-9 w-6 shrink-0 -rotate-6 rounded-[4px] shadow-[0_2px_4px_rgba(0,0,0,0.18)] ${className}`}
    />
  );
}

/** Blue and red cards at a glance. */
export function CardsExplainer() {
  const cards = [
    {
      name: 'Blue card',
      color: 'bg-blue-500',
      lines: ['Off for 2 minutes. The team plays a player down.', '3 blues on one player make a red.'],
    },
    {
      name: 'Red card',
      color: 'bg-red-500',
      lines: ['The team plays a player down for 5 minutes.', 'At least a one-game suspension.'],
    },
  ];
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {cards.map((card) => (
        <div key={card.name} className="flex gap-3 rounded-2xl bg-zinc-50 p-3">
          <PlayingCard className={card.color} />
          <div className="min-w-0">
            <div className="font-display text-xs font-extrabold uppercase tracking-[0.14em] text-zinc-900">
              {card.name}
            </div>
            {card.lines.map((line) => (
              <p key={line} className="mt-0.5 text-xs leading-snug text-zinc-600">
                {line}
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** What to sort out before heading to a game. */
export function GameDayChecklist({ settings }) {
  const items = [
    { title: 'Waiver on file', body: 'The complex won’t let you play without one.' },
    { title: 'Shin guards', body: 'Everyone wears them, every game.' },
    { title: 'Jewelry off', body: 'Or taped over.' },
    {
      title: 'Right jersey',
      body: `${jerseyText('primary', settings)}, or ${jerseyText('backup', settings)} when the schedule says so.`,
    },
    { title: 'Get there early', body: 'The clock starts on time and never stops.' },
  ];
  return (
    <section className={CARD} aria-labelledby="game-day-checklist">
      <h2 id="game-day-checklist" className="font-display text-sm font-extrabold uppercase tracking-[0.18em]">
        Game-day checklist
      </h2>
      <ul className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.title} className="flex gap-2.5">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-lime-400 text-black">
              <Check className="h-3 w-3" strokeWidth={3.5} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-bold leading-snug text-zinc-900">{item.title}</div>
              <div className="text-xs leading-snug text-zinc-500">{item.body}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
