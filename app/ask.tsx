import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { getDb } from '../src/db/open';
import { ask, type AskResult, type LocalAI } from '../src/rag/ask';
import { chatReady, completeChat, completeJson, embedQuery, embedReady } from '../src/ai/local';
import { currentCoords } from '../src/geo/location';
import { Button, Field, Tag, s } from '../src/ui';

export default function Ask() {
  const [q, setQ] = useState('');
  const [streamed, setStreamed] = useState('');
  const [res, setRes] = useState<AskResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setRes(null);
    setStreamed('');
    try {
      const ai: LocalAI = {
        completeJson: chatReady() ? completeJson : undefined,
        completeChat: chatReady() ? completeChat : undefined,
        embedQuery: embedReady() ? embedQuery : undefined,
      };
      const here = /\b(here|near|nearby|around|aqu[ií]|cerca)\b/i.test(q) ? await currentCoords() : null;
      setRes(await ask(await getDb(), q, ai, here, (t) => setStreamed((x) => x + t)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <Field label="Ask about people you met" value={q} onChangeText={setQ} placeholder="Who did I meet at South Summit?" onSubmitEditing={run} returnKeyType="search" />
      <Button primary title={busy ? 'Thinking on device…' : 'Ask'} onPress={run} disabled={busy} />
      {!chatReady() ? <Text style={s.meta}>Chat model not downloaded: showing plain results.</Text> : null}
      {(res?.answer || streamed) ? (
        <View style={s.card}>
          <Text style={s.body}>{res?.answer ?? streamed}</Text>
        </View>
      ) : null}
      {res?.hits.map((h, i) => (
        <View key={h.encounter_id} style={s.card}>
          <Text style={s.h}>[{i + 1}] {h.full_name}</Text>
          {h.company || h.role ? <Text style={s.body}>{[h.role, h.company].filter(Boolean).join(' at ')}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {h.event_name ? <Tag kind="event" text={h.event_name} /> : null}
            {h.place_name ? <Tag kind="place" text={h.place_name} /> : null}
          </View>
          <Text style={s.meta}>{h.met_at.replace('T', ' ').slice(0, 16)}</Text>
          {h.note ? <Text style={s.body}>{h.note}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}
