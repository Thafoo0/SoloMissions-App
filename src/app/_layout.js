import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { colors } from '../theme';

// Small helper so each tab declares its icon in one line
const icon = (name) => ({ color, size }) => (
  <Ionicons name={name} size={size} color={color} />
);

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="light" />
        <Tabs
          screenOptions={{
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.textMuted,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.text,
            tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
          }}
        >
          {/* "name" must match the file name inside src/app */}
          <Tabs.Screen name="index" options={{ title: 'New Quest', tabBarIcon: icon('add-circle-outline') }} />
          <Tabs.Screen name="missions" options={{ title: 'Missions', tabBarIcon: icon('list-outline') }} />
          <Tabs.Screen name="results" options={{ title: 'Results', tabBarIcon: icon('calendar-outline') }} />
        </Tabs>
    </GestureHandlerRootView>
  );
}