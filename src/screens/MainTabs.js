// src/screens/MainTabs.js
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../services/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { ensureUserDoc } from '../services/userService';

import HomeScreen from './HomeScreen';
import EventsScreen from './EventsScreen';
import MediaScreen from './MediaScreen';
import ProfileScreen from './ProfileScreen';
import StaffDashboard from './StaffDashboard';

const Tab = createBottomTabNavigator();

export default function MainTabs() {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState('player'); // default

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          setRole('player');
          setLoading(false);
          return;
        }

        // Ensure user doc exists (creates with a sensible default role)
        const ensured = await ensureUserDoc(user);

        // Read role from Firestore
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const data = userDoc.exists() ? userDoc.data() : ensured || {};
        setRole(data.role || 'player');
      } catch (e) {
        console.warn('Role load failed:', e);
        // fallback: keep non-staff UI
        setRole('player');
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  if (loading) {
    return (
      <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
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
