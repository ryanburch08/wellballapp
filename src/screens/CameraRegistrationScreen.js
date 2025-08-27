// src/screens/CameraRegistrationScreen.js
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, Alert } from 'react-native';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../services/firebase';

export default function CameraRegistrationScreen({ route }) {
  const { gameId } = route.params || {};
  const [name, setName] = useState('');
  const [role, setRole] = useState('rim_top'); // rim_top | shooter_front | baseline_left | baseline_right | overhead
  const [notes, setNotes] = useState('');

  const save = async () => {
    if (!gameId) return Alert.alert('Missing gameId');
    if (!name) return Alert.alert('Enter a camera name');
    try {
      await addDoc(collection(db, 'games', gameId, 'cameras'), {
        name,
        role,
        notes,
        platform: Platform.OS,
        registeredBy: auth.currentUser?.uid || 'unknown',
        createdAt: serverTimestamp(),
        calibrated: false,
      });
      Alert.alert('Saved', 'Camera registered.');
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Register Camera</Text>
      <Row label="Name">
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g., iPad Baseline L" />
      </Row>
      <Row label="Role">
        <TextInput style={styles.input} value={role} onChangeText={setRole} placeholder="rim_top / shooter_front / baseline_left / baseline_right / overhead" autoCapitalize="none" />
      </Row>
      <Row label="Notes">
        <TextInput style={styles.input} value={notes} onChangeText={setNotes} placeholder="notes (optional)" />
      </Row>
      <TouchableOpacity style={styles.primaryBtn} onPress={save}>
        <Text style={styles.primaryBtnTxt}>Save</Text>
      </TouchableOpacity>
    </View>
  );
}

function Row({ label, children }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12, backgroundColor: 'white' },
  h1: { fontSize: 20, fontWeight: '800', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  label: { width: 110, fontWeight: '700', color: '#333' },
  input: { borderWidth: 1, borderColor: '#ddd', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: 'white' },
  primaryBtn: { backgroundColor: '#111', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  primaryBtnTxt: { color: '#fff', fontWeight: '900' },
});
