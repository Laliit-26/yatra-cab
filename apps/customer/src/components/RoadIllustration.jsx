// Trip-type illustrations. One-way is a single black carriageway with one white
// arrow; a round trip is a dual carriageway with arrows pointing opposite ways
// and the YatraCab mark at the turnaround.
//
// The arrows are SVG <marker>s with orient="auto", so the browser places and
// rotates them along the path's own tangent. Hand-placing them meant guessing
// both the point and the angle, and they ended up floating beside the road.

const ROAD = '#0a0a0a';
const PAINT = '#ffffff';

function ArrowMarker({ id }) {
  return (
    <marker
      id={id}
      viewBox="0 0 12 12"
      refX="7"
      refY="6"
      markerWidth="15"
      markerHeight="15"
      markerUnits="userSpaceOnUse" // don't scale with the road's stroke width
      orient="auto"
    >
      <path d="M2.5 2 L 9 6 L 2.5 10" fill="none" stroke={PAINT} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </marker>
  );
}

function Mark({ x, y, r = 14 }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill={PAINT} />
      <circle r={r} fill="none" stroke={ROAD} strokeWidth="1.5" opacity="0.25" />
      <path
        d="M-6 -1h12M-4.2 -1a4.2 4.2 0 0 1 8.4 0M-3.6 2.8a1.5 1.5 0 1 0 0-.01M3.6 2.8a1.5 1.5 0 1 0 0-.01"
        fill="none"
        stroke={ROAD}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </g>
  );
}

export function OneWayRoad({ className }) {
  // Stops short of the pin so the end-arrow points into it.
  const road = 'M14 152 C 92 152, 120 48, 268 41';
  return (
    <svg viewBox="4 20 312 142" className={className} role="img" aria-label="One-way trip: a single road running in one direction">
      <defs><ArrowMarker id="yc-arrow-oneway" /></defs>

      <path d={road} fill="none" stroke={ROAD} strokeWidth="30" strokeLinecap="round" />
      {/* lane paint carries the arrow, so it sits on top of the asphalt */}
      <path
        d={road}
        fill="none"
        stroke={PAINT}
        strokeWidth="2.5"
        strokeDasharray="12 14"
        strokeLinecap="round"
        opacity="0.9"
        markerEnd="url(#yc-arrow-oneway)"
      />

      <circle cx="14" cy="152" r="7" fill={PAINT} />
      <circle cx="14" cy="152" r="3" fill={ROAD} />
      <Mark x={298} y={38} r={13} />
    </svg>
  );
}

export function RoundTripRoad({ className }) {
  // Outbound runs origin → destination; the return is drawn destination →
  // origin so its end-arrow naturally points back the way it came.
  const out = 'M16 120 C 96 120, 124 44, 262 38';
  const back = 'M266 66 C 130 72, 104 148, 40 149';
  return (
    <svg viewBox="4 20 316 140" className={className} role="img" aria-label="Round trip: a dual road going out and coming back">
      <defs>
        <ArrowMarker id="yc-arrow-out" />
        <ArrowMarker id="yc-arrow-back" />
      </defs>

      <path d={out} fill="none" stroke={ROAD} strokeWidth="19" strokeLinecap="round" />
      <path d={back} fill="none" stroke={ROAD} strokeWidth="19" strokeLinecap="round" />

      <path d={out} fill="none" stroke={PAINT} strokeWidth="2" strokeDasharray="9 11" opacity="0.85" markerEnd="url(#yc-arrow-out)" />
      <path d={back} fill="none" stroke={PAINT} strokeWidth="2" strokeDasharray="9 11" opacity="0.85" markerEnd="url(#yc-arrow-back)" />

      <circle cx="16" cy="120" r="6.5" fill={PAINT} />
      <circle cx="16" cy="120" r="2.8" fill={ROAD} />
      <Mark x={292} y={52} r={14} />
    </svg>
  );
}
