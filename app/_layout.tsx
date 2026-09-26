import { Platform } from 'react-native';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../src/theme';

export default function Layout() {
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.mist },
          headerTintColor: colors.fjord,
          contentStyle: [{ backgroundColor: colors.mist }, Platform.OS === 'web' && desktopColumn],
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Stölk' }} />
        <Stack.Screen name="capture" options={{ title: 'Who did you meet?' }} />
        <Stack.Screen name="ask" options={{ title: 'Ask' }} />
        <Stack.Screen name="models" options={{ title: 'On-device models' }} />
      </Stack>
    </ThemeProvider>
  );
}

// Mist behind everything, including the margins around the desktop column.
const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.mist } };

// On the desktop the window can be wide; keep the phone's single column, centred.
const desktopColumn = { width: '100%', maxWidth: 640, alignSelf: 'center' } as const;
