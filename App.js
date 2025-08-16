// App.js
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './src/services/firebase';

// Stack destinations
import MainTabs from './src/screens/MainTabs';
import GamesList from './src/screens/GamesList';
import TeamPicker from './src/screens/TeamPicker';
import LiveGamesAdmin from './src/screens/LiveGamesAdmin';
import CastingDisplay from './src/screens/CastingDisplay';
import StatEntryScreen from './src/screens/StatEntryScreen';
import SignupScreen from './src/screens/SignupScreen';
import LoginScreen from './src/screens/LoginScreen';
import BoxScoreScreen from './src/screens/BoxScoreScreen'; // ✅ imported

const Stack = createNativeStackNavigator();

export default function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setBooting(false);
    });
    return unsub;
  }, []);

  if (booting) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {!user ? (
        <Stack.Navigator screenOptions={{ headerShown: true }}>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Signup" component={SignupScreen} />
        </Stack.Navigator>
      ) : (
        <Stack.Navigator initialRouteName="MainTabs" screenOptions={{ headerShown: false }}>
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen
            name="GamesList"
            component={GamesList}
            options={{ headerShown: true, title: 'Games' }}
          />
          <Stack.Screen
            name="TeamPicker"
            component={TeamPicker}
            options={{ headerShown: true, title: 'Teams' }}
          />
          <Stack.Screen
            name="LiveGamesAdmin"
            component={LiveGamesAdmin}
            options={{ headerShown: true, title: 'Live Games' }}
          />
          <Stack.Screen
            name="CastingDisplay"
            component={CastingDisplay}
            options={{ headerShown: true, title: 'Scoreboard' }}
          />
          <Stack.Screen
            name="StatEntryScreen"
            component={StatEntryScreen}
            options={{ headerShown: true, title: 'Stat Tracker' }}
          />
          {/* ✅ Add this screen so navigation.navigate('BoxScoreScreen', ...) works */}
          <Stack.Screen
            name="BoxScoreScreen"
            component={BoxScoreScreen}
            options={{ headerShown: true, title: 'Box Score' }}
          />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}
