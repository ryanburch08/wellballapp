// App.js
import 'react-native-gesture-handler'; // keep this first for React Navigation
import 'react-native-reanimated';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
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
import BoxScoreScreen from './src/screens/BoxScoreScreen';
import RosterSetupScreen from './src/screens/RosterSetupScreen';

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: '#ffffff' },
};

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
    <NavigationContainer theme={navTheme}>
      {!user ? (
        <Stack.Navigator screenOptions={{ headerShown: true, headerBackTitleVisible: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Signup" component={SignupScreen} />
        </Stack.Navigator>
      ) : (
        <Stack.Navigator initialRouteName="MainTabs" screenOptions={{ headerShown: false, headerBackTitleVisible: false }}>
          {/* Main app */}
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
          {/* Fullscreen casting (no header) */}
          <Stack.Screen
            name="CastingDisplay"
            component={CastingDisplay}
            options={{ headerShown: false, presentation: 'fullScreenModal' }}
          />
          <Stack.Screen
            name="RosterSetup"
            component={require('./src/screens/RosterSetupScreen').default}
            options={{ headerShown: true, title: 'Roster Setup' }}
          />
          <Stack.Screen
            name="StatEntryScreen"
            component={StatEntryScreen}
            options={{ headerShown: true, title: 'Stat Tracker' }}
          />
          <Stack.Screen
            name="BoxScoreScreen"
            component={BoxScoreScreen}
            options={{ headerShown: true, title: 'Box Score' }}
          />

          {/* Modal group for setup/review flows */}
          <Stack.Group screenOptions={{ headerShown: true, presentation: 'modal' }}>
            <Stack.Screen
              name="CameraRegistration"
              component={require('./src/screens/CameraRegistrationScreen').default}
              options={{ title: 'Register Cameras' }}
            />
            <Stack.Screen
              name="CalibrationWizard"
              component={require('./src/screens/CalibrationWizardScreen').default}
              options={{ title: 'Calibration Wizard' }}
            />
            <Stack.Screen
              name="ReviewQueueScreen"
              component={require('./src/screens/ReviewQueueScreen').default}
              options={{ title: 'Review Queue' }}
            />

            <Stack.Screen
              name="CameraSim"
              component={require('./src/screens/CameraSimScreen').default}
              options={{ headerShown: true, title: 'Camera Simulator' }}
            />

          </Stack.Group>
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}
