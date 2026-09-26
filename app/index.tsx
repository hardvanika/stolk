import { useCallback, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { getDb } from '../src/db/open';
import { recentEncounters } from '../src/db/repo';
import { Button, Tag, s } from '../src/ui';

type Item = Awaited<ReturnType<typeof recentEncounters>>[number];

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  useFocusEffect(
    useCallback(() => {
      getDb().then(recentEncounters).then(setItems);
    }, []),
  );
  return (
    <View style={s.screen}>
      <Button primary title="+ I just met someone" onPress={() => router.push('/capture')} />
      <Button title="Ask Stölk" onPress={() => router.push('/ask')} />
      <FlatList
        data={items}
        keyExtractor={(i) => String(i.id)}
        contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
        ListEmptyComponent={<Text style={s.meta}>Nobody yet. Remember everyone you meet.</Text>}
        renderItem={({ item }) => (
          <View style={s.card}>
            <Text style={s.h}>{String(item.full_name)}</Text>
            {item.company || item.role ? <Text style={s.body}>{[item.role, item.company].filter(Boolean).join(' at ')}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {item.event_name ? <Tag kind="event" text={String(item.event_name)} /> : null}
              {item.place_name ? <Tag kind="place" text={String(item.place_name)} /> : null}
            </View>
            <Text style={s.meta}>{String(item.met_at).replace('T', ' ').slice(0, 16)}</Text>
            {item.note ? <Text style={s.body}>{String(item.note)}</Text> : null}
          </View>
        )}
      />
      <Button title="On-device models" onPress={() => router.push('/models')} />
    </View>
  );
}
