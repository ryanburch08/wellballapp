import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, ScrollView } from 'react-native';
import { auth, db } from '../services/firebase';
import { doc, getDoc } from 'firebase/firestore';

export default function StatsScreen() {
  const user = auth.currentUser;
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchStats = async () => {
      try {
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setStats(docSnap.data().stats || {});
        }
        setLoading(false);
      } catch (err) {
        setLoading(false);
      }
    };
    fetchStats();
  }, [user]);

  if (loading) {
    return <ActivityIndicator style={{ flex: 1 }} />;
  }

  if (!stats) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>No stats found for your profile.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <Text style={{ fontSize: 24, marginBottom: 24 }}>Your Wellball Stats</Text>
      {Object.entries(stats).map(([key, value]) => (
        <View key={key} style={{ marginBottom: 12, flexDirection: 'row', width: '100%', justifyContent: 'space-between' }}>
          <Text style={{ fontWeight: 'bold' }}>{key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}:</Text>
          <Text>{typeof value === 'number' ? value.toFixed(2) : value}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
