import React, { useEffect, useState } from 'react';
import { View, Text, Button, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { db } from '../services/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

const statFields = [
  { key: 'totalMakes', label: 'Total Makes' },
  { key: 'totalMisses', label: 'Total Misses' },
  { key: 'midRangeMakes', label: 'Mid-Range Makes' },
  { key: 'midRangeMisses', label: 'Mid-Range Misses' },
  { key: 'longRangeMakes', label: 'Long-Range Makes' },
  { key: 'longRangeMisses', label: 'Long-Range Misses' },
  { key: 'moneyballMakes', label: 'Moneyball Makes' },
  { key: 'moneyballMisses', label: 'Moneyball Misses' },
  { key: 'gameChangerMakes', label: 'Game Changer Makes' },
  { key: 'gameChangerMisses', label: 'Game Changer Misses' },
  { key: 'gameWinners', label: 'Game Winners' },
  { key: 'bonusRoundMakes', label: 'Bonus Makes' },
  { key: 'bonusRoundMisses', label: 'Bonus Misses' }
];

export default function StatEntryScreen({ route, navigation }) {
  const { gameId } = route.params;
  const [game, setGame] = useState(null);
  const [teamIdx, setTeamIdx] = useState(null); // Which team staff is scoring for
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);

  // Load game data from Firestore
  useEffect(() => {
    const fetchGame = async () => {
      try {
        const gameRef = doc(db, 'games', gameId);
        const snap = await getDoc(gameRef);
        if (snap.exists()) {
          setGame({ id: snap.id, ...snap.data() });
        }
      } catch (err) {
        Alert.alert('Error loading game', err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchGame();
  }, [gameId]);

  // Team picker screen
  if (loading || !game) {
    return <Text style={{ marginTop: 60, textAlign: 'center' }}>Loading...</Text>;
  }

  if (teamIdx === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 22, fontWeight: 'bold', marginBottom: 24 }}>
          Select your team to score:
        </Text>
        {game.teams && game.teams.map((team, idx) => (
          <TouchableOpacity
            key={idx}
            onPress={() => setTeamIdx(idx)}
            style={{
              backgroundColor: '#dde6f9',
              padding: 24,
              borderRadius: 10,
              marginBottom: 20,
              alignItems: 'center'
            }}
          >
            <Text style={{ fontWeight: 'bold', fontSize: 18 }}>{team.name}</Text>
            <Text>{team.players.join(', ')}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  const team = game.teams[teamIdx];
  if (!team) {
    return <Text style={{ color: 'red', marginTop: 40 }}>Team not found.</Text>;
  }

  // Update stats locally
  const updateStat = (uid, statKey, delta) => {
    setStats(prev => ({
      ...prev,
      [uid]: {
        ...(prev[uid] || {}),
        [statKey]: ((prev[uid]?.[statKey] || 0) + delta)
      }
    }));
  };

  // Save stats to Firestore, merge with others
  const handleSave = async () => {
    try {
      const gameRef = doc(db, 'games', gameId);
      // Merge just your team's stats with all existing stats in Firestore
      const updatedStats = { ...(game.stats || {}), ...stats };
      await updateDoc(gameRef, { stats: updatedStats });
      Alert.alert('Stats saved!');
      navigation.goBack();
    } catch (err) {
      Alert.alert('Error saving stats', err.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 80 }}>
      <Text style={{ fontSize: 22, fontWeight: 'bold', marginBottom: 18 }}>
        Stat Entry for {team.name}
      </Text>
      {team.players.map(uid => (
        <View key={uid} style={{
          marginBottom: 28,
          backgroundColor: '#f3f3fa',
          padding: 16,
          borderRadius: 10,
        }}>
          <Text style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 8 }}>
            {uid}
          </Text>
          {statFields.map(field => (
            <View key={field.key} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
              <Text style={{ flex: 1 }}>{field.label}:</Text>
              <TouchableOpacity
                onPress={() => updateStat(uid, field.key, -1)}
                style={{
                  backgroundColor: '#d6d6e1',
                  borderRadius: 4,
                  width: 32, height: 32,
                  alignItems: 'center', justifyContent: 'center',
                  marginHorizontal: 4
                }}>
                <Text style={{ fontSize: 22 }}>-</Text>
              </TouchableOpacity>
              <Text style={{ width: 36, textAlign: 'center' }}>
                {stats[uid]?.[field.key] || 0}
              </Text>
              <TouchableOpacity
                onPress={() => updateStat(uid, field.key, 1)}
                style={{
                  backgroundColor: '#d6d6e1',
                  borderRadius: 4,
                  width: 32, height: 32,
                  alignItems: 'center', justifyContent: 'center',
                  marginHorizontal: 4
                }}>
                <Text style={{ fontSize: 22 }}>+</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ))}
      <Button title="Save Stats" onPress={handleSave} />
    </ScrollView>
  );
}
