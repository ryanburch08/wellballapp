import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Button } from 'react-native';
import { db } from '../services/firebase';
import { collection, getDocs, addDoc } from 'firebase/firestore';

export default function StaffDashboard({ navigation }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const eventsCol = collection(db, 'events');
        const snapshot = await getDocs(eventsCol);
        const eventsList = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setEvents(eventsList);
      } catch (err) {
        alert('Error fetching events: ' + err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 24 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 24 }}>Staff Dashboard</Text>
      <FlatList
        data={events}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate('GamesList', { event: item })}
            style={{
              marginBottom: 16,
              backgroundColor: '#f0f0f0',
              borderRadius: 10,
              padding: 20,
            }}
          >
            <Text style={{ fontSize: 20, fontWeight: 'bold' }}>{item.name}</Text>
            <Text>{item.date}</Text>
            <Text>{item.location}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
