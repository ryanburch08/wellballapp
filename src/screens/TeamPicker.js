import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, TextInput, StyleSheet } from 'react-native';
import { db } from '../services/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { createGame } from '../services/gameService';

export default function TeamPicker({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState('');
  const [teamA, setTeamA] = useState([]);
  const [teamB, setTeamB] = useState([]);
  const [sequence, setSequence] = useState(null); // pick one for MVP
  const [sequenceChallengeIds, setSequenceChallengeIds] = useState([]);

  useEffect(() => {
    const fetchUsers = async () => {
      const snap = await getDocs(collection(db, 'users'));
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    };
    const fetchSequence = async () => {
      // MVP: hardcode or fetch one default sequence with a few challenges
      // Replace this with your real sequence picker UI
      // Example defaults:
      setSequence({ id: 'default-seq', name: 'Default Sequence' });
      setSequenceChallengeIds(['challenge1', 'challenge2', 'challenge3']); // ensure these exist in /challenges
    };
    fetchUsers();
    fetchSequence();
  }, []);

  const addToTeam = (teamSetter, team, player) => {
    if (team.find(p => p.id === player.id)) return;
    teamSetter([...team, player]);
  };
  const removeFromTeam = (teamSetter, team, player) => {
    teamSetter(team.filter(p => p.id !== player.id));
  };

  const startMatch = async () => {
    const teamAIds = teamA.map(p => p.id);
    const teamBIds = teamB.map(p => p.id);
    if (teamAIds.length === 0 || teamBIds.length === 0) {
      alert('Pick at least one player for each team');
      return;
    }
    if (!sequence) {
      alert('Select a challenge sequence');
      return;
    }
    const gameId = await createGame({
      teamAIds,
      teamBIds,
      sequenceId: sequence.id,
      sequenceChallengeIds,
      clockSeconds: 90
    });
    navigation.navigate('StatEntryScreen', { gameId, role: 'main' });
  };

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;

  const filtered = users.filter(u =>
    (u.displayName || u.email || '').toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Game Setup</Text>

      <TextInput
        placeholder="Search players"
        value={filter}
        onChangeText={setFilter}
        style={styles.search}
      />

      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.h2}>All Players</Text>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.itemRow}>
                <Text style={styles.player}>{item.displayName || item.email}</Text>
                <View style={styles.actions}>
                  <TouchableOpacity onPress={() => addToTeam(setTeamA, teamA, item)} style={styles.btn}>
                    <Text>A+</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => addToTeam(setTeamB, teamB, item)} style={styles.btn}>
                    <Text>B+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            style={{ maxHeight: 220 }}
          />
        </View>

        <View style={styles.col}>
          <Text style={styles.h2}>Team A</Text>
          {teamA.map(p => (
            <TouchableOpacity key={p.id} onPress={() => removeFromTeam(setTeamA, teamA, p)} style={styles.tag}>
              <Text>{p.displayName || p.email}</Text>
            </TouchableOpacity>
          ))}

          <Text style={[styles.h2, { marginTop: 16 }]}>Team B</Text>
          {teamB.map(p => (
            <TouchableOpacity key={p.id} onPress={() => removeFromTeam(setTeamB, teamB, p)} style={styles.tag}>
              <Text>{p.displayName || p.email}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity onPress={startMatch} style={styles.start}>
        <Text style={{ color: 'white', fontSize: 16 }}>Start Match</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, flex: 1, backgroundColor: 'white' },
  h1: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  h2: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
  search: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 12, flex: 1 },
  col: { flex: 1 },
  itemRow: { paddingVertical: 8, borderBottomWidth: 1, borderColor: '#eee', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  player: { fontSize: 14 },
  actions: { flexDirection: 'row', gap: 8 },
  btn: { paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#f2f2f2', borderRadius: 6 },
  tag: { backgroundColor: '#f7f7f7', marginVertical: 4, padding: 8, borderRadius: 8 },
  start: { marginTop: 18, backgroundColor: '#111', padding: 14, alignItems: 'center', borderRadius: 10 }
});
