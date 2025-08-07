import React, { useState, useEffect } from 'react';
import { View, Text, Button, TextInput, ActivityIndicator, Alert } from 'react-native';
import { auth, db } from '../services/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

export default function ProfileScreen({ navigation }) {
  const user = auth.currentUser;
  const [profile, setProfile] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchProfile = async () => {
      try {
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setProfile(data);
          setDisplayName(data.displayName || '');
          setBio(data.bio || '');
        } else {
          setProfile({});
        }
        setLoading(false);
      } catch (err) {
        Alert.alert('Error', err.message);
        setLoading(false);
      }
    };
    fetchProfile();
  }, [user]);

  const handleSave = async () => {
    try {
      const docRef = doc(db, 'users', user.uid);
      await updateDoc(docRef, {
        displayName,
        bio,
      });
      setProfile({ ...profile, displayName, bio });
      setEditMode(false);
      Alert.alert('Success', 'Profile updated!');
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  };

  const handleLogout = async () => {
    await auth.signOut();
    navigation.replace('Login');
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 24 }}>
      {editMode ? (
        <>
          <TextInput
            placeholder="Name"
            value={displayName}
            onChangeText={setDisplayName}
            style={{ marginBottom: 12, borderBottomWidth: 1, padding: 8 }}
          />
          <TextInput
            placeholder="Bio"
            value={bio}
            onChangeText={setBio}
            style={{ marginBottom: 12, borderBottomWidth: 1, padding: 8 }}
          />
          <Button title="Save" onPress={handleSave} />
          <Button title="Cancel" onPress={() => setEditMode(false)} />
        </>
      ) : !profile ? (
        <Text>Loading profile...</Text>
      ) : (
        <>
          <Text style={{ fontSize: 24, marginBottom: 8 }}>
            {profile.displayName ? profile.displayName : 'No name set'}
          </Text>
          <Text style={{ marginBottom: 16 }}>
            {profile.bio ? profile.bio : 'No bio yet'}
          </Text>
          <Text style={{ color: 'gray', marginBottom: 16 }}>
            Email: {profile.email}
          </Text>
          <Button title="Edit Profile" onPress={() => setEditMode(true)} />
          <View style={{ marginTop: 24 }}>
            <Button title="Log Out" onPress={handleLogout} color="red" />
          </View>
        </>
      )}
    </View>
  );
}
