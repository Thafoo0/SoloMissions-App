import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { colors } from '../theme';
import { supabase } from '../utils/supabase';

// Make navigation match our dark theme
const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.primary,
  },
};

// Small helper so each tab declares its icon in one line
const icon = (name) => ({ color, size }) => (
  <Ionicons name={name} size={size} color={color} />
);

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const navigationState = useRootNavigationState();

  // undefined = still checking, null = signed out, object = signed in
  const [session, setSession] = useState(undefined);

  // Listen to Supabase auth changes (sign in, sign out, token expiry)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession); // keep this callback light: only update state
    });

    return () => subscription.unsubscribe();
  }, []);

  // Redirect based on the session
  useEffect(() => {
    if (session === undefined) return;      // still checking the stored session
    if (!navigationState?.key) return;      // navigator isn't ready yet

    const onAuthScreen = segments[0] === 'auth';

    if (!session && !onAuthScreen) {
      router.replace('/auth');
    } else if (session && onAuthScreen) {
      router.replace('/');
    }
  }, [session, segments, navigationState?.key]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={navTheme}>
        <StatusBar style="light" />
        {session === undefined ? (
          // Dark placeholder while the saved session loads, so there's no flash of the wrong screen
          <View style={{ flex: 1, backgroundColor: colors.background }} />
        ) : (
          <Tabs
            screenOptions={{
              tabBarActiveTintColor: colors.primary,
              tabBarInactiveTintColor: colors.textMuted,
            }}
          >
            {/* "name" must match the file name inside src/app */}
            <Tabs.Screen name="index" options={{ title: 'New Quest', tabBarIcon: icon('add-circle-outline') }} />
            <Tabs.Screen name="missions" options={{ title: 'Missions', tabBarIcon: icon('list-outline') }} />
            <Tabs.Screen name="results" options={{ title: 'Results', tabBarIcon: icon('calendar-outline') }} />
            {/* Login screen: not a tab, no header, no tab bar */}
            <Tabs.Screen
              name="auth"
              options={{ href: null, headerShown: false, tabBarStyle: { display: 'none' } }}
            />
          </Tabs>
        )}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}