import type { Coords } from '../db/types';

/**
 * Desktop: no GPS. Browser/Electron geolocation resolves the position through Google's
 * network location service, which would break the "no server" promise, so it is not used.
 */
export async function currentCoords(): Promise<Coords | null> {
  return null;
}
