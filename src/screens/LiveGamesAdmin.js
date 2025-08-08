// src/screens/LiveGamesAdmin.js
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { db } from '../services/firebase';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';

export default function LiveGamesAdmin({ navigation }) {
  const [games, setGames] = useState(null);

  useEffect(() => {
    const q = query(
      collection(db, 'games'),
      where('status', '==', 'live'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, snap => {
      setGames(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  if (!games) return <ActivityIndicator style={{ marginTop: 40 }} />;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Live Games</Text>

      <FlatList
        data={games}
        keyExtractor={(g) => g.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>Game {item.id.slice(0, 6)}</Text>
            <Text style={styles.meta}>
              Challenge {Number(item.currentChallengeIndex ?? 0) + 1} • Match {(item.matchScore?.A ?? 0)} - {(item.matchScore?.B ?? 0)}
            </Text>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => navigation.navigate('CastingDisplay', { gameId: item.id })}
            >
              <Text style={styles.btnTxt}>View Scoreboard</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<Text style={{ color: '#666', marginTop: 16 }}>No live games</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, flex: 1, backgroundColor: 'white' },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 10 },
  card: { borderWidth: 1, borderColor: '#eee', borderRadius: 10, padding: 12, marginBottom: 10, backgroundColor: '#fafafa' },
  name: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  meta: { color: '#666', marginBottom: 8 },
  btn: { marginTop: 6, backgroundColor: '#111', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, alignSelf: 'flex-start' },
  btnTxt: { color: 'white', fontWeight: '700' }
});
