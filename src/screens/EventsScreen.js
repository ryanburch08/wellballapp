import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, FlatList, TouchableOpacity } from 'react-native';
import { db } from '../services/firebase';
import { collection, getDocs } from 'firebase/firestore';

export default function EventsScreen({ navigation }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const eventsCol = collection(db, 'events');
        const eventsSnapshot = await getDocs(eventsCol);
        const eventsList = eventsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        console.log(eventsList);
        setEvents(eventsList);
      } catch (err) {
        // Optional: log the error or set a message for debugging
        console.log('Error fetching events:', err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, []);

  if (loading) {
    return <ActivityIndicator style={{ flex: 1 }} />;
  }

  if (!events.length) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>No events found.</Text>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={{ padding: 24 }}
      data={events}
      keyExtractor={item => item.id}
      renderItem={({ item }) => (
        <TouchableOpacity
          onPress={() => navigation.navigate('EventDetails', { event: item })}
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
  );
}
//
