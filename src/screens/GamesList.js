// src/screens/GamesList.js
import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { db } from '../services/firebase';
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  doc,
  getDocs,
  deleteDoc,
  limit as qLimit,
} from 'firebase/firestore';

export default function GamesList({ navigation, route }) {
  // Expect StaffDashboard to pass { eventId, eventName }
  const { eventId = null, eventName = 'Games' } = route?.params || {};
  const [games, setGames] = useState(null);
  const [busy, setBusy] = useState(false);          // for purge progress
  const [deletingId, setDeletingId] = useState(null); // for per-card spinner

  useEffect(() => {
    // If eventId is present, filter by it; else show all live/ended games as a fallback
    const base = collection(db, 'games');
    const q = eventId
      ? query(base, where('eventId', '==', eventId), orderBy('createdAt', 'desc'))
      : query(base, where('status', 'in', ['live', 'ended']), orderBy('createdAt', 'desc'));

    const unsub = onSnapshot(q, snap => {
      setGames(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [eventId]);

  /* ---------------------- Deep delete helpers ---------------------- */
  // Delete all docs in a named subcollection under a game in chunks
  const deleteSubcollection = async (gameId, subName, chunkSize = 200) => {
    const colRef = collection(db, 'games', gameId, subName);
    while (true) {
      const snap = await getDocs(query(colRef, qLimit(chunkSize)));
      if (snap.empty) break;
      // Fire deletes in parallel for this chunk
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
      // loop continues until empty
    }
  };

  // Delete a single game and known subcollections
  const deleteGameDeep = async (gameId) => {
    // Known subcollections for this MVP
    await deleteSubcollection(gameId, 'logs');
    await deleteSubcollection(gameId, 'trackers');
    // Finally delete the game doc
    await deleteDoc(doc(db, 'games', gameId));
  };

  // Bulk purge: delete ENDED games older than N days (default 7)
  const purgeOldEndedGames = async (days = 7) => {
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

    // Build a list from already-loaded games to avoid an extra fetch:
    const targets = (games || [])
      .filter(g => g.status === 'ended' && g.createdAt && toMillis(g.createdAt) < cutoffMs)
      .map(g => g.id);

    if (targets.length === 0) {
      Alert.alert('No old games', `No ended games older than ${days} days.`);
      return;
    }

    setBusy(true);
    try {
      // Delete sequentially to avoid hammering the client/network (safe for MVP)
      for (const gid of targets) {
        await deleteGameDeep(gid);
      }
      Alert.alert('Purge complete', `Deleted ${targets.length} old game(s).`);
    } catch (e) {
      Alert.alert('Purge failed', e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const toMillis = (ts) => {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    const d = Date.parse(ts);
    return Number.isFinite(d) ? d : 0;
  };

  /* ---------------------- UI handlers ---------------------- */

  const confirmDeleteOne = (gameId) => {
    Alert.alert(
      'Delete game?',
      'This will permanently remove the game and its stats/logs. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(gameId);
            try {
              await deleteGameDeep(gameId);
            } catch (e) {
              Alert.alert('Delete failed', e?.message || String(e));
            } finally {
              setDeletingId(null);
            }
          }
        }
      ]
    );
  };

  const confirmPurge = () => {
    Alert.alert(
      'Purge old games?',
      'Delete ENDED games older than 7 days. This permanently removes games and their logs/trackers.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Purge', style: 'destructive', onPress: () => purgeOldEndedGames(7) }
      ]
    );
  };

  /* ---------------------- Render ---------------------- */

  if (!games) {
    return <ActivityIndicator style={{ marginTop: 40 }} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{eventName}</Text>

        {/* Purge action */}
        <TouchableOpacity
          style={[styles.smallBtn, busy && styles.smallBtnDisabled]}
          onPress={confirmPurge}
          disabled={busy}
        >
          <Text style={styles.smallBtnTxt}>{busy ? 'Purging…' : 'Purge Old'}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={games}
        keyExtractor={(g) => g.id}
        renderItem={({ item }) => {
          const created = item.createdAt ? new Date(toMillis(item.createdAt)) : null;
          const createdStr = created
            ? created.toLocaleString()
            : '—';

          return (
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.name}>Game {item.id.slice(0, 6)}</Text>
                  <Text style={styles.meta}>
                    {item.status?.toUpperCase() || 'LIVE'} • Challenge {Number(item.currentChallengeIndex ?? 0) + 1}
                  </Text>
                  <Text style={styles.meta}>
                    Match {item.matchScore?.A ?? 0} - {item.matchScore?.B ?? 0}
                  </Text>
                  <Text style={[styles.meta, { opacity: 0.7 }]}>
                    Created {createdStr}
                  </Text>
                </View>

                {/* Per-game delete */}
                <TouchableOpacity
                  onPress={() => confirmDeleteOne(item.id)}
                  style={[styles.dangerBtn, deletingId === item.id && styles.dangerBtnDisabled]}
                  disabled={deletingId === item.id}
                >
                  <Text style={styles.dangerTxt}>{deletingId === item.id ? 'Deleting…' : 'Delete'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.row}>
                <TouchableOpacity
                  style={styles.btn}
                  onPress={() => navigation.navigate('StatEntryScreen', { gameId: item.id })}
                >
                  <Text style={styles.btnTxt}>Open Tracker</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnDark]}
                  onPress={() => navigation.navigate('CastingDisplay', { gameId: item.id })}
                >
                  <Text style={styles.btnTxt}>Scoreboard</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={{ color: '#666', marginTop: 16 }}>
            No games yet for this event.
          </Text>
        }
      />

      {/* Floating "Start Match" action */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('TeamPicker', { eventId, eventName })}
      >
        <Text style={styles.fabTxt}>＋ Start Match</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ---------------------- Styles ---------------------- */
const styles = StyleSheet.create({
  container: { padding: 16, flex: 1, backgroundColor: 'white' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 20, fontWeight: '800' },

  smallBtn: { backgroundColor: '#111', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  smallBtnDisabled: { opacity: 0.6 },
  smallBtnTxt: { color: 'white', fontWeight: '800' },

  card: { borderWidth: 1, borderColor: '#eee', borderRadius: 10, padding: 12, marginBottom: 10, backgroundColor: '#fafafa' },
  name: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  meta: { color: '#666', marginBottom: 2 },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },

  btn: { backgroundColor: '#111', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  btnDark: { backgroundColor: '#333' },
  btnTxt: { color: 'white', fontWeight: '700' },

  dangerBtn: { backgroundColor: '#b00020', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  dangerBtnDisabled: { opacity: 0.6 },
  dangerTxt: { color: 'white', fontWeight: '800' },

  fab: {
    position: 'absolute', right: 16, bottom: 24,
    backgroundColor: '#0a0', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }
  },
  fabTxt: { color: 'white', fontWeight: '800' }
});
