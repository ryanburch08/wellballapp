// src/screens/TeamPicker.js
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, FlatList, Alert, StyleSheet, TextInput, Switch } from 'react-native';
import { db } from '../services/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { createGame } from '../services/gameService';

export default function TeamPicker({ navigation, route }) {
  const { eventId = null } = route?.params || {};
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [sequences, setSequences] = useState([]);
  const [teamA, setTeamA] = useState([]);
  const [teamB, setTeamB] = useState([]);
  const [selectedSequenceId, setSelectedSequenceId] = useState(null);

  // NEW: freestyle mode
  const [isFreestyle, setIsFreestyle] = useState(false);
  const [fsTarget, setFsTarget] = useState('10');
  const [fsPoints, setFsPoints] = useState('1');

  useEffect(() => {
    const load = async () => {
      try {
        const uSnap = await getDocs(collection(db, 'users'));
        setUsers(uSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        const sSnap = await getDocs(collection(db, 'sequences'));
        const seqs = sSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setSequences(seqs);
        if (!selectedSequenceId && seqs.length > 0) {
          setSelectedSequenceId(seqs[0].id); // default first sequence
        }
      } catch (e) {
        Alert.alert('Error', e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const toggleOnTeam = (teamSetter, team, uid) => {
    if (team.includes(uid)) {
      teamSetter(team.filter(id => id !== uid));
    } else {
      teamSetter([...team, uid]);
    }
  };

  const startMatch = async () => {
    try {
      if (teamA.length === 0 || teamB.length === 0) return Alert.alert('Pick at least one player per team');

      let sequenceChallengeIds = [];
      let sequenceId = null;
      let mode = 'sequence';
      let freestyle = undefined;

      if (isFreestyle) {
        mode = 'freestyle';
        freestyle = {
          targetScore: Number(fsTarget) || 0,
          pointsForWin: Number(fsPoints) || 0,
        };
      } else {
        if (!selectedSequenceId) return Alert.alert('Pick a sequence (or enable Freestyle)');
        sequenceId = selectedSequenceId;

        // Load the chosen sequence to get its ordered challengeIds
        const seqSnap = await getDoc(doc(db, 'sequences', selectedSequenceId));
        if (!seqSnap.exists()) throw new Error('Sequence not found');
        const seq = seqSnap.data();
        sequenceChallengeIds = Array.isArray(seq.challengeIds) ? seq.challengeIds : [];
      }

      const gameId = await createGame({
        teamAIds: teamA,
        teamBIds: teamB,
        sequenceId,
        sequenceChallengeIds,
        clockSeconds: 90,
        secondaryKeeper: null,
        eventId,
        mode,
        freestyle,
      });

      navigation.replace('StatEntryScreen', { gameId });
    } catch (e) {
      Alert.alert('Could not start match', e.message);
    }
  };

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Team Picker</Text>

      {/* NEW: Freestyle toggle */}
      <View style={styles.row}>
        <Text style={styles.h2}>Freestyle Mode</Text>
        <Switch value={isFreestyle} onValueChange={setIsFreestyle} />
      </View>

      {!isFreestyle ? (
        <>
          <Text style={styles.h2}>Sequence</Text>
          <FlatList
            data={sequences}
            keyExtractor={s => s.id}
            horizontal
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.pill, selectedSequenceId === item.id && styles.pillActive]}
                onPress={() => setSelectedSequenceId(item.id)}
              >
                <Text style={[styles.pillTxt, selectedSequenceId === item.id && { color: 'white' }]}>
                  {item.name || item.id}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text>No sequences</Text>}
            style={{ marginBottom: 12 }}
          />
        </>
      ) : (
        <View style={styles.fsCard}>
          <Text style={styles.h2}>Freestyle Settings</Text>
          <View style={[styles.row, { gap: 8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Target Score</Text>
              <TextInput
                value={fsTarget}
                onChangeText={setFsTarget}
                keyboardType="numeric"
                style={styles.input}
                placeholder="e.g. 10"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Points for Win</Text>
              <TextInput
                value={fsPoints}
                onChangeText={setFsPoints}
                keyboardType="numeric"
                style={styles.input}
                placeholder="e.g. 1"
              />
            </View>
          </View>
          <Text style={{ color: '#666', marginTop: 4 }}>
            These can be changed mid-game in the tracker screen.
          </Text>
        </View>
      )}

      <Text style={styles.h2}>Players</Text>
      <FlatList
        data={users}
        keyExtractor={u => u.id}
        renderItem={({ item }) => (
          <View style={styles.userRow}>
            <Text style={{ flex: 1 }}>{item.displayName || item.email || item.id}</Text>
            <TouchableOpacity
              style={[styles.btn, teamA.includes(item.id) && styles.btnOn]}
              onPress={() => toggleOnTeam(setTeamA, teamA, item.id)}
            >
              <Text style={[styles.btnTxt, teamA.includes(item.id) && { color: 'white' }]}>Team A</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, teamB.includes(item.id) && styles.btnOn]}
              onPress={() => toggleOnTeam(setTeamB, teamB, item.id)}
            >
              <Text style={[styles.btnTxt, teamB.includes(item.id) && { color: 'white' }]}>Team B</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<Text>No users found</Text>}
      />

      <TouchableOpacity style={styles.start} onPress={startMatch}>
        <Text style={styles.startTxt}>Start Match</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: 'white' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  h1: { fontSize: 22, fontWeight: '800', marginBottom: 8 },
  h2: { fontSize: 16, fontWeight: '700', marginTop: 8, marginBottom: 6 },
  label: { fontSize: 12, fontWeight: '700', marginBottom: 4, color: '#333' },

  pill: { paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 20, marginRight: 8 },
  pillActive: { backgroundColor: '#111' },
  pillTxt: { color: '#111' },

  fsCard: { borderWidth: 1, borderColor: '#eee', borderRadius: 10, padding: 10, marginBottom: 10, backgroundColor: '#fafafa' },

  userRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderColor: '#eee' },
  btn: { borderWidth: 1, borderColor: '#ccc', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, marginLeft: 8 },
  btnOn: { backgroundColor: '#111' },
  btnTxt: { color: '#111' },

  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },

  start: { marginTop: 16, backgroundColor: '#0a0', padding: 12, borderRadius: 10, alignItems: 'center' },
  startTxt: { color: 'white', fontWeight: '800' }
});
