import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { MODELS, download, isDownloaded, modelFile, type ModelKind } from '../src/ai/models';
import { embedDocument } from '../src/ai/local';
import { getDb } from '../src/db/open';
import { embedPending } from '../src/db/repo';
import { Button, s } from '../src/ui';

export default function Models() {
  const [, force] = useState(0);
  const [busy, setBusy] = useState<ModelKind | null>(null);

  const get = async (kind: ModelKind) => {
    setBusy(kind);
    try {
      await download(kind);
      if (kind === 'embed') await embedPending(await getDb(), embedDocument);
    } catch (e) {
      Alert.alert('Download failed', String(e));
    } finally {
      setBusy(null);
      force((n) => n + 1);
    }
  };

  return (
    <View style={s.screen}>
      <Text style={s.body}>
        Everything runs on this phone. Models are downloaded once over Wi-Fi; after that Stölk works fully offline.
      </Text>
      {(Object.keys(MODELS) as ModelKind[]).map((k) => (
        <View key={k} style={s.card}>
          <Text style={s.h}>{MODELS[k].label}</Text>
          <Text style={s.meta}>
            {k === 'chat' ? 'Understands questions and writes answers' : 'Semantic search over your notes'} · ~{MODELS[k].approxMB} MB
          </Text>
          {isDownloaded(k) ? (
            <Text style={s.meta}>Ready: {modelFile(k).uri}</Text>
          ) : (
            <Button primary title={busy === k ? 'Downloading…' : 'Download'} onPress={() => get(k)} disabled={!!busy} />
          )}
        </View>
      ))}
    </View>
  );
}
