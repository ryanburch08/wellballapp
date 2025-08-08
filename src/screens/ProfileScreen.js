// src/screens/ProfileScreen.js
import React, { useEffect, useState } from 'react';
import { View, Text, Button, TextInput, ActivityIndicator, Alert } from 'react-native';
import { auth, db } from '../services/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

export default function ProfileScreen() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(true);

  // 1) Wait for auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
    });
    return unsub;
  }, []);

  // 2) Load or seed profile
  useEffect(() => {
    const load = async () => {
      try {
        if (!user) { setLoading(false); return; }

        const ref = doc(db, 'users', user.uid);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          const data = snap.data();
          setProfile(data);
          setDisplayName(data.displayName || user.displayName || '');
          setBio(data.bio || '');
        } else {
          const seed = {
            displayName: user.displayName || '',
            email: user.email || '',
            bio: '',
            role: 'player',
            createdAt: Date.now(),
          };
          await setDoc(ref, seed); // create it so other parts of the app see it
          setProfile(seed);
          setDisplayName(seed.displayName);
          setBio(seed.bio);
        }
      } catch (err) {
        Alert.alert('Error', err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const handleSave = async () => {
    try {
      if (!user) return;
      const ref = doc(db, 'users', user.uid);
      await updateDoc(ref, { displayName, bio });
      setProfile(prev => ({ ...(prev || {}), displayName, bio }));
      setEditMode(false);
      Alert.alert('Success', 'Profile updated!');
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      // App.js auth gate will route you back to Login automatically
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  };

  // Loading state
  if (loading) {
    return (
      <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Not signed in (edge case)
  if (!user) {
    return (
      <View style={{ flex:1, justifyContent:'center', alignItems:'center', padding:24 }}>
        <Text style={{ fontSize:18, marginBottom:12 }}>You’re not signed in.</Text>
        <Text>Go back and log in.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex:1, padding:24 }}>
      {editMode ? (
        <>
          <TextInput
            placeholder="Name"
            value={displayName}
            onChangeText={setDisplayName}
            style={{ marginBottom:12, borderBottomWidth:1, padding:8 }}
          />
          <TextInput
            placeholder="Bio"
            value={bio}
            onChangeText={setBio}
            style={{ marginBottom:12, borderBottomWidth:1, padding:8 }}
          />
          <Button title="Save" onPress={handleSave} />
          <View style={{ height:8 }} />
          <Button title="Cancel" onPress={() => setEditMode(false)} />
        </>
      ) : (
        <>
          <Text style={{ fontSize:24, marginBottom:8 }}>
            {(profile?.displayName || 'No name set')}
          </Text>
          <Text style={{ marginBottom:16 }}>
            {(profile?.bio || 'No bio yet')}
          </Text>
          <Text style={{ color:'gray', marginBottom:16 }}>
            Email: {profile?.email || user.email || '—'}
          </Text>

          <Button title="Edit Profile" onPress={() => setEditMode(true)} />

          <View style={{ marginTop:24 }}>
            <Button title="Log Out" color="red" onPress={handleLogout} />
          </View>
        </>
      )}
    </View>
  );
}
