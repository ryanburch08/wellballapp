// src/screens/RosterSetupScreen.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Image, Alert, FlatList, ActivityIndicator
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { db } from '../services/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { listenRoster, setJerseyNumber, saveFacePhoto } from '../services/playerService';

export default function RosterSetupScreen({ route, navigation }) {
  const { gameId } = route.params || {};
  const [game, setGame] = useState(null);
  const [roster, setRoster] = useState([]);
  const [saving, setSaving] = useState(false);

  // local input buffer to avoid writing on every keystroke
  const [localNums, setLocalNums] = useState({});

  // subscribe to game for team lists
  useEffect(() => {
    if (!gameId) return;
    const off = onSnapshot(doc(db, 'games', gameId), (snap) => {
      setGame(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    return off;
  }, [gameId]);

  // subscribe roster
  useEffect(() => {
    if (!gameId) return;
    const off = listenRoster(gameId, (items) => setRoster(items));
    return off;
  }, [gameId]);

  // sync local number inputs when roster changes
  useEffect(() => {
    const next = {};
    roster.forEach(r => {
      next[r.id] = r.jerseyNumber == null ? '' : String(r.jerseyNumber);
    });
    setLocalNums(next);
  }, [roster]);

  const teamRows = useMemo(() => {
    if (!game) return [];
    const mk = (id, team) => ({ playerId: id, team });
    return [
      ...(game.teamAIds || []).map((id) => mk(id, 'A')),
      ...(game.teamBIds || []).map((id) => mk(id, 'B')),
    ];
  }, [game]);

  const rosterById = useMemo(() => {
    const m = {};
    roster.forEach((r) => { m[r.id] = r; });
    return m;
  }, [roster]);

  const onCommitNumber = async (playerId) => {
    try {
      const text = (localNums[playerId] ?? '').replace(/[^0-9]/g, '');
      await setJerseyNumber(gameId, playerId, text === '' ? null : Number(text));
    } catch (e) {
      Alert.alert('Save failed', e.message);
    }
  };

  const onCapture = async (playerId) => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        return Alert.alert('Camera denied', 'Enable camera permission in settings.');
      }
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],       // square crop → consistent face chip
        quality: 0.85,
      });
      if (res.canceled) return;
      const uri = res.assets?.[0]?.uri;
      if (!uri) return;

      setSaving(true);
      await saveFacePhoto(gameId, playerId, uri);
    } catch (e) {
      Alert.alert('Photo error', e.message);
    } finally {
      setSaving(false);
    }
  };

  const missingCounts = useMemo(() => {
    if (!game) return { nums: 0, photos: 0, total: 0 };
    const ids = [...(game.teamAIds || []), ...(game.teamBIds || [])];
    let nums = 0, photos = 0;
    ids.forEach(id => {
      const r = rosterById[id] || {};
      if (r.jerseyNumber == null || r.jerseyNumber === '') nums += 1;
      if (!r.faceUrl) photos += 1;
    });
    return { nums, photos, total: ids.length };
  }, [game, rosterById]);

  const renderRow = ({ item }) => {
    const r = rosterById[item.playerId] || {};
    const local = localNums[item.playerId] ?? (r.jerseyNumber == null ? '' : String(r.jerseyNumber));
    return (
      <View style={[styles.row, item.team === 'A' ? styles.teamA : styles.teamB]}>
        <View style={styles.left}>
          <Text style={styles.pid}>{item.playerId}</Text>
          <Text style={styles.teamTag}>Team {item.team}</Text>
        </View>

        <TextInput
          style={styles.numberInput}
          keyboardType="number-pad"
          placeholder="##"
          value={local}
          onChangeText={(t) => {
            const only = t.replace(/[^0-9]/g, '');
            setLocalNums(prev => ({ ...prev, [item.playerId]: only }));
          }}
          onEndEditing={() => onCommitNumber(item.playerId)}
          onSubmitEditing={() => onCommitNumber(item.playerId)}
          maxLength={3}
        />

        <View style={styles.faceWrap}>
          {r.faceUrl ? (
            <Image source={{ uri: r.faceUrl }} style={styles.face} />
          ) : (
            <View style={[styles.face, styles.faceMissing]}><Text style={{ color: '#666' }}>no photo</Text></View>
          )}
        </View>

        <TouchableOpacity style={styles.captureBtn} onPress={() => onCapture(item.playerId)}>
          <Text style={styles.captureTxt}>{r.faceUrl ? 'Retake' : 'Take Photo'}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (!game) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading game…</Text>
      </View>
    );
  }

  const showBanner = missingCounts.total > 0 && (missingCounts.nums > 0 || missingCounts.photos > 0);

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Roster Setup</Text>
      <Text style={styles.sub}>Assign jersey #’s and capture headshots.</Text>

      {showBanner && (
        <View style={styles.banner}>
          <Text style={styles.bannerTxt}>
            Missing: #{missingCounts.nums} numbers • {missingCounts.photos} photos
          </Text>
        </View>
      )}

      {saving && <Text style={{ color: '#666', marginBottom: 8 }}>Uploading photo…</Text>}

      <FlatList
        data={teamRows}
        keyExtractor={(x) => `${x.team}-${x.playerId}`}
        renderItem={renderRow}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={<Text>No players on this game.</Text>}
        contentContainerStyle={{ paddingBottom: 12 }}
      />

      <TouchableOpacity
        style={[styles.doneBtn, saving && { opacity: 0.6 }]}
        disabled={saving}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.doneTxt}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex:1, alignItems:'center', justifyContent:'center' },
  container: { flex:1, padding:12, backgroundColor:'#fff' },
  h1: { fontSize:20, fontWeight:'800' },
  sub: { color:'#666', marginBottom:10 },

  banner: { backgroundColor:'#eef6ff', borderColor:'#cfe0ff', borderWidth:1, padding:8, borderRadius:8, marginBottom:8 },
  bannerTxt: { color:'#1d4ed8', fontWeight:'700' },

  row: {
    flexDirection:'row', alignItems:'center', borderWidth:1, borderColor:'#eee',
    backgroundColor:'#fafafa', borderRadius:12, padding:10,
  },
  teamA: { backgroundColor:'rgba(80, 140, 255, 0.06)' },
  teamB: { backgroundColor:'rgba(255, 140, 80, 0.06)' },
  left: { flex:1, minWidth: 120 },
  pid: { fontWeight:'700' },
  teamTag: { color:'#666', fontSize:12 },

  numberInput: {
    width:64, borderWidth:1, borderColor:'#ddd', borderRadius:8, paddingVertical:6,
    paddingHorizontal:10, backgroundColor:'#fff', marginRight:8, textAlign:'center', fontWeight:'800'
  },

  faceWrap: { width:58, height:58, borderRadius:8, overflow:'hidden', borderWidth:1, borderColor:'#ddd', backgroundColor:'#fff' },
  face: { width:'100%', height:'100%', resizeMode:'cover' },
  faceMissing: { alignItems:'center', justifyContent:'center' },

  captureBtn: { marginLeft:8, backgroundColor:'#111', paddingVertical:8, paddingHorizontal:10, borderRadius:8 },
  captureTxt: { color:'#fff', fontWeight:'700' },

  doneBtn: { marginTop:12, backgroundColor:'#111', paddingVertical:12, borderRadius:10, alignItems:'center' },
  doneTxt: { color:'#fff', fontWeight:'900' },
});
