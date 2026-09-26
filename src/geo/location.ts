import * as Location from 'expo-location';
import type { Coords } from '../db/types';

/** Current GPS fix. Works offline; returns null if permission is denied. */
export async function currentCoords(): Promise<Coords | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 100 });
  const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
  return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
}
