import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Tabs and screens
import MainTabs from './src/screens/MainTabs';
import GamesList from './src/screens/GamesList';
import TeamPicker from './src/screens/TeamPicker';
import CastingDisplay from './src/screens/CastingDisplay';
import LiveGamesAdmin from './src/screens/LiveGamesAdmin';
import StatEntryScreen from './src/screens/StatEntryScreen';

// Auth (optional)
import SignupScreen from './src/screens/SignupScreen';
import LoginScreen from './src/screens/LoginScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="MainTabs" screenOptions={{ headerShown: false }}>
        {/* Auth */}
        <Stack.Screen name="Signup" component={SignupScreen} options={{ headerShown: true }} />
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: true }} />

        {/* Tabs */}
        <Stack.Screen name="MainTabs" component={MainTabs} />

        {/* Deep screens */}
        <Stack.Screen name="GamesList" component={GamesList} options={{ headerShown: true, title: 'Games' }} />
        <Stack.Screen name="TeamPicker" component={TeamPicker} options={{ headerShown: true, title: 'Teams' }} />
        <Stack.Screen name="LiveGamesAdmin" component={LiveGamesAdmin} options={{ headerShown: true, title: 'Live Games' }} />
        <Stack.Screen name="CastingDisplay" component={CastingDisplay} options={{ headerShown: true, title: 'Scoreboard' }} />
        <Stack.Screen name="StatEntryScreen" component={StatEntryScreen} options={{ headerShown: true, title: 'Stat Tracker' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
