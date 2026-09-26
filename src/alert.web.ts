// react-native-web's Alert.alert is a no-op, so the desktop uses the window's own dialog.
export const alert = (title: string, message?: string) => window.alert(message ? `${title}\n\n${message}` : title);
