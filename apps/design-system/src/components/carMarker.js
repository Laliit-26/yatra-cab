/**
 * Vehicle marker for the rider and ops maps — a car sitting on the road, not a
 * pin. No badge behind it: the badge made it read as an icon in a UI rather
 * than a vehicle in traffic.
 *
 * Legibility over map tiles comes from a white outline and a ground shadow
 * instead, which hold up over roads, parks and water alike. Checked against a
 * real OSM tile rather than a white page, because a marker that reads on paper
 * can disappear on a yellow arterial road.
 *
 * Side profile, so it is FLIPPED by direction of travel rather than rotated —
 * rotating a side-on car to a northerly heading draws it climbing a wall.
 */
const TAXI = '#f5c542'; // the ride you are tracking / a car on a trip
const IDLE = '#1f2937'; // ambient traffic — present, but not competing

export const facesLeft = (heading) =>
  Number.isFinite(Number(heading)) && Number(heading) > 180 && Number(heading) < 360;

export const CAR_ASPECT = 34 / 30; // viewBox is wider than it is tall

/**
 * @param {number}  heading  degrees, 0 = north
 * @param {boolean} active   the tracked ride / a car mid-trip
 * @param {number}  size     px width
 */
export function carMarkerHtml({ heading, active = false, size = 38 } = {}) {
  const body = active ? TAXI : IDLE;
  const wheel = '#111827';
  const flip = facesLeft(heading) ? 'scaleX(-1)' : 'none';
  const h = Math.round(size / CAR_ASPECT);

  return `<div style="width:${size}px;height:${h}px;transform:${flip};transition:transform .3s ease">
    <svg width="${size}" height="${h}" viewBox="0 0 34 30" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">
      <ellipse cx="16.5" cy="25.6" rx="11" ry="2.1" fill="rgba(0,0,0,.25)"/>
      <path d="M3.2 21.2v-2.4c0-1.3.7-2.1 2-2.4l4.6-.9c2.4-2.6 4.7-3.9 7.2-3.9h2.6c2.3 0 4.2 1 5.7 3l1.9 2.4 1.6.4c1.3.3 2 1.1 2 2.4v1.4z"
        fill="${body}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M12.2 15.2c1.8-1.7 3.5-2.5 5.2-2.5h1.9c1.6 0 3 .8 4.1 2.5z" fill="#1c1917"/>
      <circle cx="10.2" cy="21.4" r="3.7" fill="${wheel}" stroke="#fff" stroke-width="1.1"/>
      <circle cx="10.2" cy="21.4" r="1.4" fill="#fff"/>
      <circle cx="23.2" cy="21.4" r="3.7" fill="${wheel}" stroke="#fff" stroke-width="1.1"/>
      <circle cx="23.2" cy="21.4" r="1.4" fill="#fff"/>
    </svg></div>`;
}
