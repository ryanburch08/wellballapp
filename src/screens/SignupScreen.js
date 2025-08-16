// src/screens/SignupScreen.js
import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, TouchableOpacity, ActivityIndicator } from 'react-native';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../services/firebase';

export default function SignupScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSignUp = async () => {
    setError('');
    const e = email.trim();

    if (!e || !password || !displayName) {
      setError('Please fill all fields.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      // 1) Create user in Firebase Auth
      const { user } = await createUserWithEmailAndPassword(auth, e, password);

      // 2) Optional: set displayName on the Auth user (helps in UI)
      try {
        await updateProfile(user, { displayName });
      } catch {}

      // 3) Assign role — staff if using company email, otherwise player
      const role = e.toLowerCase().endsWith('@playwellball.com') ? 'staff' : 'player';

      // 4) Seed the Firestore user document (doc id MUST be the auth uid)
      await setDoc(doc(db, 'users', user.uid), {
        displayName,
        email: e,
        role,
        createdAt: serverTimestamp(),
      });

      // 5) Do NOT navigate. App.js onAuthStateChanged will switch to MainTabs automatically.
      // If you prefer to force navigation instead, uncomment:
      // navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });

    } catch (err) {
      setError(err?.message ?? 'Sign up failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign Up for Wellball</Text>

      <TextInput
        style={styles.input}
        placeholder="Full Name"
        value={displayName}
        onChangeText={setDisplayName}
        autoCapitalize="words"
        editable={!submitting}
      />

      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoCorrect={false}
        editable={!submitting}
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        autoCapitalize="none"
        secureTextEntry
        editable={!submitting}
      />

      <TextInput
        style={styles.input}
        placeholder="Confirm Password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        autoCapitalize="none"
        secureTextEntry
        editable={!submitting}
      />

      {error ? <Text style={{ color: 'red', marginBottom: 12 }}>{error}</Text> : null}
      {submitting ? <ActivityIndicator style={{ marginBottom: 12 }} /> : null}

      <Button
        title={submitting ? 'Signing Up...' : 'Sign Up'}
        onPress={handleSignUp}
        disabled={submitting}
      />

      <TouchableOpacity
        onPress={() => navigation.replace('Login')}
        style={{ marginTop: 24 }}
        disabled={submitting}
      >
        <Text style={{ color: '#007bff', textAlign: 'center' }}>
          Already have an account? Log in
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// Simple styles for usability
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 32,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 16,
  },
});
