import React from 'react';
import { StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Home, User } from 'lucide-react-native';
import { HomeScreen } from '@/features/search/screens/HomeScreen';
import { MineScreen } from '@/features/library/screens/MineScreen';
import { SearchResultScreen } from '@/features/search/screens/SearchResultScreen';
import { DetailScreen } from '@/features/detail/screens/DetailScreen';
import { ReaderScreen } from '@/features/reader/screens/ReaderScreen';
import { PdfReaderScreen } from '@/features/reader/screens/PdfReaderScreen';
import { SettingsScreen } from '@/features/settings/screens/SettingsScreen';
import { RootStackParamList, TabParamList } from '@/app/navigation/types';
import { colors, fontSize } from '@/shared/theme/theme';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: '检索',
          tabBarIcon: ({ color, focused }) => (
            <Home size={21} color={color} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
      <Tab.Screen
        name="Mine"
        component={MineScreen}
        options={{
          title: '我的',
          tabBarIcon: ({ color, focused }) => (
            <User size={21} color={color} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={Tabs} />
      <Stack.Screen name="SearchResult" component={SearchResultScreen} />
      <Stack.Screen
        name="Detail"
        component={DetailScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Reader"
        component={ReaderScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="PdfReader"
        component={PdfReaderScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    height: 58,
    paddingTop: 6,
    paddingBottom: 6,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tabItem: { gap: 2 },
  tabLabel: { fontSize: fontSize.caption, fontWeight: '600' },
});
