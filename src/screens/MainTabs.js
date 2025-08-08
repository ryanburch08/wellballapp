// src/screens/MainTabs.js
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../services/firebase';
import { doc, getDoc } from 'firebase/firestore';

// FIXED imports: same-folder screens use "./"
import HomeScreen from './HomeScreen';
import EventsScreen from './EventsScreen';
import MediaScreen from './MediaScreen';
import ProfileScreen from './ProfileScreen';
import StaffDashboard from './StaffDashboard';

const Tab = createBottomTabNavigator();

export default function MainTabs() {
  const [role, setRole] = useState(null);       // "player" | "staff" | "admin" | null while loading
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Keep role in sync with auth state
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            setRole(userDoc.data().role || 'player');
          } else {
            // No /users doc yet, default to player
            setRole('player');
          }
        } else {
          // Not signed in
          setRole('player');
        }
      } catch (e) {
        console.warn('Failed to load role', e);
        setRole('player');
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Events" component={EventsScreen} />
      <Tab.Screen name="Media" component={MediaScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
      {role === 'staff' && (
        <Tab.Screen
          name="Staff"
          component={StaffDashboard}
          options={{ headerShown: true, title: 'Staff Dashboard' }}
        />
      )}
    </Tab.Navigator>
  );
}
