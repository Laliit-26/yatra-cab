// Car seen from directly above, roof cut away so the cabin reads at a glance.
// Taken seats are solid, free seats are outlined and pulse — the point of the
// card is "a seat is going spare", which a photo of passengers never conveys.

function Seat({ x, y, taken, delay = 0 }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        x="-9" y="-10" width="18" height="20" rx="5"
        fill={taken ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={taken ? 0 : 1.7}
        strokeDasharray={taken ? undefined : '3 2.6'}
        opacity={taken ? 0.92 : 0.8}
      >
        {!taken && (
          <animate attributeName="opacity" values="0.35;0.9;0.35" dur="2.4s" begin={`${delay}s`} repeatCount="indefinite" />
        )}
      </rect>
      <rect x="-6" y="-13" width="12" height="4.5" rx="2.2" fill="currentColor" opacity={taken ? 0.92 : 0.35} />
    </g>
  );
}

export function SeatShareArt({ className, taken = 1, total = 4 }) {
  // Front row is the driver + one passenger; the rest is the back bench.
  const layout = [
    { x: 42, y: 78 },
    { x: 78, y: 78 },
    { x: 42, y: 128 },
    { x: 78, y: 128 },
  ];
  const seats = layout.slice(0, Math.max(2, Math.min(total, 4)));

  return (
    <svg viewBox="0 0 120 200" className={className} role="img" aria-label={`${Math.max(0, total - taken)} of ${total} seats free`}>
      {/* wheels, just proud of the body */}
      {[[14, 56], [98, 56], [14, 138], [98, 138]].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="8" height="26" rx="4" fill="currentColor" opacity="0.55" />
      ))}

      {/* body */}
      <rect x="16" y="10" width="88" height="180" rx="34" fill="currentColor" opacity="0.1" />
      <rect x="16" y="10" width="88" height="180" rx="34" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" />

      {/* bonnet + windscreen */}
      <path d="M32 52 Q60 40 88 52 L92 62 Q60 54 28 62 Z" fill="currentColor" opacity="0.3" />
      {/* rear window */}
      <path d="M30 152 Q60 160 90 152 L86 143 Q60 149 34 143 Z" fill="currentColor" opacity="0.3" />
      {/* roof rails */}
      <rect x="27" y="70" width="3" height="66" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="90" y="70" width="3" height="66" rx="1.5" fill="currentColor" opacity="0.35" />
      {/* mirrors */}
      <rect x="8" y="64" width="9" height="5" rx="2.5" fill="currentColor" opacity="0.5" />
      <rect x="103" y="64" width="9" height="5" rx="2.5" fill="currentColor" opacity="0.5" />

      {seats.map((s, i) => (
        <Seat key={i} x={s.x} y={s.y} taken={i < taken} delay={i * 0.4} />
      ))}
    </svg>
  );
}
