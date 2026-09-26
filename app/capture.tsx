import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { getDb } from '../src/db/open';
import { embedPending, listPlaces, saveCapture } from '../src/db/repo';
import { matchPlace } from '../src/geo/geo';
import { currentCoords } from '../src/geo/location';
import { embedDocument, embedReady } from '../src/ai/local';
import type { Coords } from '../src/db/types';
import { alert } from '../src/alert';
import { Button, Field, s } from '../src/ui';

export default function Capture() {
  const [f, setF] = useState({ fullName: '', linkedinUrl: '', company: '', role: '', note: '', eventName: '', placeName: '' });
  const [coords, setCoords] = useState<Coords | null>(null);
  const [knownPlace, setKnownPlace] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    (async () => {
      const c = await currentCoords();
      setCoords(c);
      if (c) setKnownPlace(matchPlace(await listPlaces(await getDb()), c)?.name ?? null);
      // Pre-fill the event you logged most recently today.
      const db = await getDb();
      const r = await db.execute(
        `SELECT ev.name FROM encounters e JOIN events ev ON ev.id = e.event_id
         WHERE date(e.met_at) = date('now','localtime') ORDER BY e.met_at DESC LIMIT 1`,
      );
      if (r.rows[0]) setF((x) => ({ ...x, eventName: x.eventName || String(r.rows[0].name) }));
    })();
  }, []);

  const save = async () => {
    if (!f.fullName.trim()) return alert('Add a name first');
    setBusy(true);
    try {
      const db = await getDb();
      await saveCapture(db, { ...f, coords });
      if (embedReady()) embedPending(db, embedDocument).catch(() => {}); // indexed in the background
      router.back();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <Field label="Name" value={f.fullName} onChangeText={set('fullName')} autoFocus placeholder="Ana García" />
      <Field label="LinkedIn URL (optional, stored as a link only)" value={f.linkedinUrl} onChangeText={set('linkedinUrl')} autoCapitalize="none" placeholder="linkedin.com/in/…" />
      <Field label="Company" value={f.company} onChangeText={set('company')} />
      <Field label="Role" value={f.role} onChangeText={set('role')} />
      <Field label="Event" value={f.eventName} onChangeText={set('eventName')} placeholder="South Summit 2026" />
      {coords && !knownPlace ? (
        <Field label="Name this place (optional)" value={f.placeName} onChangeText={set('placeName')} placeholder="IFEMA Hall 5" />
      ) : null}
      <Text style={s.meta}>
        {coords ? (knownPlace ? `At ${knownPlace}` : `GPS ±${Math.round(coords.accuracy ?? 0)} m`) : 'No location (permission off)'}
      </Text>
      <Field label="What did you talk about?" value={f.note} onChangeText={set('note')} multiline style={{ minHeight: 90 }} />
      <Button primary title={busy ? 'Saving…' : 'Save'} onPress={save} disabled={busy} />
    </ScrollView>
  );
}
