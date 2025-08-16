// src/screens/StaffDashboard.js
import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator,
  TextInput, Alert, StyleSheet
} from 'react-native';
import { db } from '../services/firebase';
import {
  collection, addDoc, onSnapshot, orderBy, query, serverTimestamp,
  doc, setDoc, getDoc
} from 'firebase/firestore';

export default function StaffDashboard({ navigation }) {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(true);

  // -- New Event form state
  const [showEventForm, setShowEventForm] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');        // free-form for now
  const [location, setLocation] = useState('');

  // -- New User form state
  const [showUserForm, setShowUserForm] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [userId, setUserId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('player'); // 'player' | 'staff'
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'events'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      snap => {
        setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      err => {
        Alert.alert('Error', err?.message || String(err));
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  /* -------------------- Event helpers -------------------- */
  const resetEventForm = () => {
    setName('');
    setDate('');
    setLocation('');
  };

  const createEvent = async () => {
    if (!name.trim()) {
      Alert.alert('Missing name', 'Please enter an event name.');
      return;
    }
    setCreatingEvent(true);
    try {
      const ref = await addDoc(collection(db, 'events'), {
        name: name.trim(),
        date: date.trim() || null,
        location: location.trim() || null,
        createdAt: serverTimestamp(),
      });
      resetEventForm();
      setShowEventForm(false);
      navigation.navigate('GamesList', { eventId: ref.id, eventName: name.trim() });
    } catch (e) {
      Alert.alert('Create failed', e?.message || String(e));
    } finally {
      setCreatingEvent(false);
    }
  };

  /* -------------------- User helpers -------------------- */
  const resetUserForm = () => {
    setUserId('');
    setDisplayName('');
    setRole('player');
    setEmail('');
    setPhone('');
  };

  const saveUserDoc = async (overwrite = false) => {
    const id = userId.trim();
    const dn = displayName.trim();
    const rl = (role === 'staff' ? 'staff' : 'player');

    if (!id) {
      Alert.alert('Missing Document ID', 'Please enter a unique document ID for the user.');
      return;
    }
    if (!dn) {
      Alert.alert('Missing Display Name', 'Please enter a display name.');
      return;
    }

    setCreatingUser(true);
    try {
      const ref = doc(db, 'users', id);
      const exists = (await getDoc(ref)).exists();

      if (exists && !overwrite) {
        Alert.alert(
          'User exists',
          `A user with ID “${id}” already exists. Overwrite this user?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Overwrite', style: 'destructive', onPress: () => saveUserDoc(true) }
          ]
        );
        return;
      }

      const data = {
        displayName: dn,
        role: rl,                 // 'player' | 'staff'
        email: email.trim() || null,
        phone: phone.trim() || null,
        updatedAt: serverTimestamp(),
        ...(exists ? {} : { createdAt: serverTimestamp() }),
      };

      await setDoc(ref, data, { merge: true });
      resetUserForm();
      setShowUserForm(false);
      Alert.alert('Success', `User “${dn}” saved.`);
    } catch (e) {
      Alert.alert('Save failed', e?.message || String(e));
    } finally {
      setCreatingUser(false);
    }
  };

  if (loading || !events) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header with two actions */}
      <View style={styles.headerRow}>
        <Text style={styles.title}>Staff Dashboard</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            style={[styles.primaryBtn, showUserForm && styles.primaryBtnAlt]}
            onPress={() => {
              setShowUserForm(v => !v);
              setShowEventForm(false);
            }}
          >
            <Text style={styles.primaryBtnTxt}>{showUserForm ? 'Cancel' : '＋ New User'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryBtn, showEventForm && styles.primaryBtnAlt]}
            onPress={() => {
              setShowEventForm(v => !v);
              setShowUserForm(false);
            }}
          >
            <Text style={styles.primaryBtnTxt}>{showEventForm ? 'Cancel' : '＋ New Event'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Create User Form */}
      {showUserForm && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Create User / Player</Text>

          <TextInput
            placeholder="Document ID (required, unique)"
            value={userId}
            onChangeText={setUserId}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <TextInput
            placeholder="Display Name (required)"
            value={displayName}
            onChangeText={setDisplayName}
            style={styles.input}
          />

          {/* Role toggle */}
          <View style={styles.roleRow}>
            <Text style={styles.roleLabel}>Role:</Text>
            <TouchableOpacity
              style={[styles.rolePill, role === 'player' && styles.rolePillActive]}
              onPress={() => setRole('player')}
            >
              <Text style={[styles.roleTxt, role === 'player' && styles.roleTxtActive]}>Player</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.rolePill, role === 'staff' && styles.rolePillActive]}
              onPress={() => setRole('staff')}
            >
              <Text style={[styles.roleTxt, role === 'staff' && styles.roleTxtActive]}>Staff</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            placeholder="Email (optional)"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />
          <TextInput
            placeholder="Phone (optional)"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            style={styles.input}
          />

          <View style={styles.formRow}>
            <TouchableOpacity
              style={[styles.createBtn, creatingUser && styles.disabled]}
              onPress={() => saveUserDoc(false)}
              disabled={creatingUser}
            >
              <Text style={styles.createTxt}>{creatingUser ? 'Saving…' : 'Save User'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Create Event Form */}
      {showEventForm && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Create Event</Text>
          <TextInput
            placeholder="Event name (required)"
            value={name}
            onChangeText={setName}
            style={styles.input}
          />
          <TextInput
            placeholder="Date (e.g., Aug 21, 2025)"
            value={date}
            onChangeText={setDate}
            style={styles.input}
          />
          <TextInput
            placeholder="Location"
            value={location}
            onChangeText={setLocation}
            style={styles.input}
          />
          <View style={styles.formRow}>
            <TouchableOpacity
              style={[styles.createBtn, creatingEvent && styles.disabled]}
              onPress={createEvent}
              disabled={creatingEvent}
            >
              <Text style={styles.createTxt}>{creatingEvent ? 'Creating…' : 'Create Event'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Events List */}
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate('GamesList', { eventId: item.id, eventName: item.name })}
            style={styles.card}
          >
            <Text style={styles.cardTitle}>{item.name || 'Untitled Event'}</Text>
            {!!item.date && <Text style={styles.meta}>{item.date}</Text>}
            {!!item.location && <Text style={styles.meta}>{item.location}</Text>}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={{ color: '#666', marginTop: 16 }}>No events yet. Create your first one!</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, backgroundColor: 'white' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: 'bold' },

  primaryBtn: { backgroundColor: '#111', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  primaryBtnAlt: { backgroundColor: '#555' },
  primaryBtnTxt: { color: 'white', fontWeight: '800' },

  formCard: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 12, marginBottom: 16, backgroundColor: '#fafafa' },
  formTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8
  },
  formRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  createBtn: { backgroundColor: '#0a0', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  createTxt: { color: 'white', fontWeight: '800' },
  disabled: { opacity: 0.6 },

  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  roleLabel: { fontWeight: '700', marginRight: 6 },
  rolePill: { borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  rolePillActive: { backgroundColor: '#111', borderColor: '#111' },
  roleTxt: { color: '#111', fontWeight: '700' },
  roleTxtActive: { color: 'white' },

  card: { marginBottom: 12, backgroundColor: '#f0f0f0', borderRadius: 10, padding: 16 },
  cardTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  meta: { color: '#444' },
});
