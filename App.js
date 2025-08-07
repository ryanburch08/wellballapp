import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import MainTabs from './src/navigation/MainTabs';
import GamesList from './src/screens/GamesList';
import TeamPicker from './src/screens/TeamPicker';
import StatEntryScreen from './src/screens/StatEntryScreen';
// Add your Auth screens if needed
import SignupScreen from './src/screens/SignupScreen';
import LoginScreen from './src/screens/LoginScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="MainTabs" screenOptions={{ headerShown: false }}>
        {/* Auth screens (show headers if you want) */}
        <Stack.Screen name="Signup" component={SignupScreen} options={{ headerShown: true }} />
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: true }} />
        
        {/* Main tabbed experience */}
        <Stack.Screen name="MainTabs" component={MainTabs} />

        {/* "Deep" screens (not tabs) */}
        <Stack.Screen name="GamesList" component={GamesList} options={{ headerShown: true, title: "Games" }} />
        <Stack.Screen name="TeamPicker" component={TeamPicker} options={{ headerShown: true, title: "Teams" }} />
        <Stack.Screen name="TeamPicker" component={TeamPicker} />
        <Stack.Screen name="StatEntry" component={StatEntryScreen} options={{ headerShown: true, title: "Stat Tracker" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
