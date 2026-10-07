import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';

import MissionTracking from './screens/MissionTracking';
import ResultsCalendar from './screens/ResultsCalendar';
import TaskCreation from './screens/TaskCreation';
import { colors } from './theme';

const Tab = createBottomTabNavigator();

// Make the navigation container match our dark theme
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

// Icon for each tab
const icons = {
  'New Quest': 'add-circle-outline',
  Missions: 'list-outline',
  Results: 'calendar-outline',
};

export default function App() {
  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={icons[route.name]} size={size} color={color} />
          ),
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
        })}
      >
        <Tab.Screen name="New Quest" component={TaskCreation} />
        <Tab.Screen name="Missions" component={MissionTracking} />
        <Tab.Screen name="Results" component={ResultsCalendar} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}