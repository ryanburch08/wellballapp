// src/screens/ReviewQueueScreen.js
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, FlatList, Switch } from 'react-native';
import { doc, onSnapshot, collection, query, orderBy, limit, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { listenProposals, acceptProposal, rejectProposal, pushAutoEvent } from '../services/autoTrackingService';

export default function ReviewQueueScreen({ route }) {
  const { gameId } = route.params || {};
  const [proposals, setProposals] = useState([]);
  const [editing, setEditing] = useState({}); // id -> edit model

  useEffect(() => {
    if (!gameId) return;
    const off = listenProposals(gameId, setProposals, { status: 'pending', limitN: 100 });
    return () => off && off();
  }, [gameId]);

  const top = proposals[0] || null;

  const setEdit = (id, patch) =>
    setEditing((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));

  const modelFor = (p) => ({
    playerId: editing[p.id]?.playerId ?? (p.playerId || ''),
    team: editing[p.id]?.team ?? (p.team || ''),
    shotType: editing[p.id]?.shotType ?? (p.shotType || ''),
    made: typeof editing[p.id]?.made === 'boolean' ? editing[p.id].made : (typeof p.made === 'boolean' ? p.made : true),
    moneyball: typeof editing[p.id]?.moneyball === 'boolean' ? editing[p.id].moneyball : !!p.moneyball,
  });

  const acceptNow = async (p) => {
    const m = modelFor(p);
    if (!m.playerId || !m.team || !m.shotType || typeof m.made !== 'boolean') {
      return Alert.alert('Missing fields', 'Player, team, shot type, and made/miss are required.');
    }
    try {
      await acceptProposal(gameId, p.id, m);
    } catch (e) {
      Alert.alert('Accept failed', e.message);
    }
  };

  const rejectNow = async (p) => {
    try {
      await rejectProposal(gameId, p.id, 'operator_reject');
    } catch (e) {
      Alert.alert('Reject failed', e.message);
    }
  };

  const createDummy = async () => {
    try {
      await pushAutoEvent(gameId, {
        type: 'shot',
        playerId: 'A1',
        team: 'A',
        shotType: 'mid',
        made: Math.random() > 0.5,
        confidence: 0.72,
        moneyball: false,
        sourceCamId: 'dev',
        spotId: 6,
      });
      Alert.alert('Queued', 'Added a dummy autoevent (0.72 conf). If Auto Mode is ON, it may go straight to logs if ingest threshold ≤ 0.72.');
    } catch (e) {
      Alert.alert('Failed', e.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Review Queue</Text>
      <Text style={styles.meta}>{proposals.length} pending</Text>

      <View style={styles.devRow}>
        <TouchableOpacity style={styles.smallBtn} onPress={createDummy}>
          <Text style={styles.smallBtnTxt}>+ Dummy Autoevent</Text>
        </TouchableOpacity>
      </View>

      {top ? (
        <View style={styles.card}>
          <Text style={styles.lead}>Top Proposal</Text>
          <Row label="Confidence" value={`${Math.round((top.confidence ?? 0) * 100)}%`} />
          <EditRow label="Player ID" value={modelFor(top).playerId} onChange={(v)=>setEdit(top.id,{playerId:v})} />
          <EditRow label="Team" value={modelFor(top).team} onChange={(v)=>setEdit(top.id,{team:v})} placeholder="A or B" />
          <EditRow label="Shot Type" value={modelFor(top).shotType} onChange={(v)=>setEdit(top.id,{shotType:v})} placeholder="mid/long/gamechanger/bonus_mid/bonus_long/bonus_gc" />
          <ToggleRow label="Made?" value={modelFor(top).made} onToggle={(v)=>setEdit(top.id,{made:v})} />
          <ToggleRow label="Moneyball?" value={modelFor(top).moneyball} onToggle={(v)=>setEdit(top.id,{moneyball:v})} />

          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={()=>acceptNow(top)}>
              <Text style={styles.primaryBtnTxt}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.dangerBtn, { flex: 1 }]} onPress={()=>rejectNow(top)}>
              <Text style={styles.dangerBtnTxt}>Reject</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={{ color: '#666' }}>No pending items.</Text>
        </View>
      )}

      <Text style={[styles.h2, { marginTop: 14 }]}>All Pending</Text>
      <FlatList
        data={proposals}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <View style={styles.listItem}>
            <Text style={styles.itemTxt}>
              {item.playerId || '—'} • {item.team || '—'} • {item.shotType || '—'} • {typeof item.made === 'boolean' ? (item.made ? '✓' : '✗') : '—'} • {Math.round((item.confidence || 0) * 100)}%
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={styles.smallBtn} onPress={() => acceptNow(item)}>
                <Text style={styles.smallBtnTxt}>Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.smallBtn} onPress={() => rejectNow(item)}>
                <Text style={styles.smallBtnTxt}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={<View style={styles.empty}><Text style={{ color: '#666' }}>—</Text></View>}
      />
    </View>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{String(value)}</Text>
    </View>
  );
}
function EditRow({ label, value, onChange, placeholder }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        style={styles.input}
        autoCapitalize="none"
      />
    </View>
  );
}
function ToggleRow({ label, value, onToggle }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={!!value} onValueChange={onToggle} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12, backgroundColor: 'white' },
  h1: { fontSize: 20, fontWeight: '800' },
  h2: { fontSize: 16, fontWeight: '800' },
  meta: { color: '#666', marginBottom: 8 },
  devRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  smallBtn: { backgroundColor: '#111', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  smallBtnTxt: { color: 'white', fontWeight: '700' },

  card: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 12, backgroundColor: '#fff' },
  lead: { fontWeight: '800', marginBottom: 8 },

  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  label: { width: 110, color: '#333', fontWeight: '700' },
  value: { flex: 1, color: '#111' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: 'white' },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  primaryBtn: { backgroundColor: '#111', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  primaryBtnTxt: { color: '#fff', fontWeight: '900' },
  dangerBtn: { backgroundColor: '#b00', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  dangerBtnTxt: { color: '#fff', fontWeight: '900' },

  empty: { alignItems: 'center', justifyContent: 'center', padding: 20 },
  listItem: { borderTopWidth: 1, borderTopColor: '#eee', paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemTxt: { color: '#111' },
});
