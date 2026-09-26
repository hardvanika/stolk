import type { Coords } from '../db/types';

const EARTH_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a: Coords, b: Coords): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

/** Lat/lng box that contains a circle; used as a cheap SQL prefilter before exact distance. */
export function boundingBox(c: Coords, radiusM: number) {
  const dLat = (radiusM / EARTH_M) * (180 / Math.PI);
  const dLng = dLat / Math.max(Math.cos(rad(c.lat)), 1e-6);
  return { minLat: c.lat - dLat, maxLat: c.lat + dLat, minLng: c.lng - dLng, maxLng: c.lng + dLng };
}

export type Place = { id: number; name: string; lat: number; lng: number; radius_m: number };

/** The saved place whose radius contains the point, closest first. */
export function matchPlace(places: Place[], at: Coords): Place | null {
  let best: Place | null = null;
  let bestD = Infinity;
  for (const p of places) {
    const d = distanceM(p, at);
    if (d <= p.radius_m && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}
