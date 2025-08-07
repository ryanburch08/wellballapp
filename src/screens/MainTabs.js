import React, { useEffect, useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { auth, db } from '../services/firebase';
import { doc, getDoc } from 'firebase/firestore';

import HomeScreen from '../screens/HomeScreen';
import EventsScreen from '../screens/EventsScreen';
import MediaScreen from '../screens/MediaScreen';
import ProfileScreen from '../screens/ProfileScreen';
import StaffDashboard from '../screens/StaffDashboard';

const Tab = createBottomTabNavigator();

export default function MainTabs() {
  const [role, setRole] = useState(null);

  useEffect(() => {
    const fetchUserRole = async () => {
      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          setRole(userDoc.data().role);
        }
      }
    };
    fetchUserRole();
  }, []);

  if (role === null) {
    // Show nothing or a spinner while loading role
    return null;
  }

  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Events" component={EventsScreen} />
      <Tab.Screen name="Media" component={MediaScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
      {role === 'staff' && (
        <Tab.Screen name="StaffDashboard" component={StaffDashboard} />
      )}
    </Tab.Navigator>
  );
}
