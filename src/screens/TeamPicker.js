// src/screens/TeamPicker.js
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, FlatList, Alert, StyleSheet, TextInput } from 'react-native';
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

  // NEW: search state
  const [queryStr, setQueryStr] = useState('');

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

  // Quick toggle helpers (unchanged)
  const toggleOnTeam = (teamSetter, team, uid) => {
    if (team.includes(uid)) {
      teamSetter(team.filter(id => id !== uid));
    } else {
      teamSetter([...team, uid]);
    }
  };

  const startMatch = async () => {
    try {
      if (!selectedSequenceId) return Alert.alert('Pick a sequence');
      if (teamA.length === 0 || teamB.length === 0) return Alert.alert('Pick at least one player per team');

      // Load the chosen sequence to get its ordered challengeIds
      const seqSnap = await getDoc(doc(db, 'sequences', selectedSequenceId));
      if (!seqSnap.exists()) throw new Error('Sequence not found');
      const seq = seqSnap.data();
      const sequenceChallengeIds = Array.isArray(seq.challengeIds) ? seq.challengeIds : [];

      const gameId = await createGame({
        teamAIds: teamA,
        teamBIds: teamB,
        sequenceId: selectedSequenceId,
        sequenceChallengeIds,
        clockSeconds: 90,
        secondaryKeeper: null,
        eventId,
      });

      navigation.replace('StatEntryScreen', { gameId });
    } catch (e) {
      Alert.alert('Could not start match', e.message);
    }
  };

  // NEW: filtered users based on query string
  const filteredUsers = useMemo(() => {
    const q = queryStr.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u => {
      const name = String(u.displayName || '').toLowerCase();
      const email = String(u.email || '').toLowerCase();
      const id = String(u.id || '').toLowerCase();
      return name.includes(q) || email.includes(q) || id.includes(q);
    });
  }, [users, queryStr]);

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Team Picker</Text>

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
            <Text style={[styles.pillTxt, selectedSequenceId === item.id && styles.pillTxtActive]}>
              {item.name || item.id}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text>No sequences</Text>}
        style={{ marginBottom: 12 }}
        showsHorizontalScrollIndicator={false}
      />

      <View style={styles.rowBetween}>
        <Text style={styles.h2}>Players</Text>
        {/* quick glance of selected counts */}
        <Text style={styles.selectedMeta}>A: {teamA.length} • B: {teamB.length}</Text>
      </View>

      {/* NEW: search box */}
      <View style={styles.searchWrap}>
        <TextInput
          placeholder="Search players by name, email, or ID"
          value={queryStr}
          onChangeText={setQueryStr}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {queryStr.length > 0 && (
          <TouchableOpacity onPress={() => setQueryStr('')} style={styles.clearBtn}>
            <Text style={styles.clearTxt}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={filteredUsers}
        keyExtractor={u => u.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const label = item.displayName || item.email || item.id;
          const onA = teamA.includes(item.id);
          const onB = teamB.includes(item.id);
          return (
            <View style={styles.userRow}>
              <Text style={{ flex: 1 }} numberOfLines={1}>{label}</Text>
              <TouchableOpacity
                style={[styles.btn, onA && styles.btnOn]}
                onPress={() => toggleOnTeam(setTeamA, teamA, item.id)}
              >
                <Text style={[styles.btnTxt, onA && styles.btnOnTxt]}>Team A</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, onB && styles.btnOn]}
                onPress={() => toggleOnTeam(setTeamB, teamB, item.id)}
              >
                <Text style={[styles.btnTxt, onB && styles.btnOnTxt]}>Team B</Text>
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={<Text>No users found</Text>}
        style={{ marginTop: 4 }}
      />

      <TouchableOpacity style={styles.start} onPress={startMatch}>
        <Text style={styles.startTxt}>Start Match</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: 'white' },
  h1: { fontSize: 22, fontWeight: '800', marginBottom: 8 },
  h2: { fontSize: 16, fontWeight: '700', marginTop: 8, marginBottom: 6 },

  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectedMeta: { color: '#666', fontWeight: '700' },

  pill: { paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 20, marginRight: 8 },
  pillActive: { backgroundColor: '#111', borderColor: '#111' },
  pillTxt: { color: '#111', fontWeight: '700' },
  pillTxtActive: { color: 'white' },

  // Search
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  searchInput: {
    flex: 1,
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  clearBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#eee' },
  clearTxt: { fontWeight: '800', color: '#111' },

  userRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderColor: '#eee' },
  btn: { borderWidth: 1, borderColor: '#ccc', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, marginLeft: 8, backgroundColor: 'white' },
  btnOn: { backgroundColor: '#111', borderColor: '#111' },
  btnTxt: { color: '#111', fontWeight: '800' },
  btnOnTxt: { color: 'white' },

  start: { marginTop: 16, backgroundColor: '#0a0', padding: 12, borderRadius: 10, alignItems: 'center' },
  startTxt: { color: 'white', fontWeight: '800' }
});
