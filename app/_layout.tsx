import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../src/theme';

export default function Layout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.mist },
          headerTintColor: colors.fjord,
          contentStyle: { backgroundColor: colors.mist },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Stölk' }} />
        <Stack.Screen name="capture" options={{ title: 'Who did you meet?' }} />
        <Stack.Screen name="ask" options={{ title: 'Ask' }} />
        <Stack.Screen name="models" options={{ title: 'On-device models' }} />
      </Stack>
    </>
  );
}
