// src/screens/LoginScreen.js
import React, { useState } from 'react';
import { View, TextInput, Button, Text, ActivityIndicator } from 'react-native';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../services/firebase';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async () => {
    setError('');
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // Do NOT navigate here. App.js onAuthStateChanged will switch to MainTabs automatically.
    } catch (err) {
      setError(err?.message ?? 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 16 }}>Log In</Text>

      <TextInput
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoCorrect={false}
        style={{ marginBottom: 12, borderBottomWidth: 1, padding: 10 }}
        editable={!submitting}
      />

      <TextInput
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={{ marginBottom: 12, borderBottomWidth: 1, padding: 10 }}
        editable={!submitting}
        onSubmitEditing={handleLogin}
      />

      {error ? <Text style={{ color: 'red', marginBottom: 12 }}>{error}</Text> : null}

      {submitting ? (
        <ActivityIndicator style={{ marginBottom: 12 }} />
      ) : null}

      <Button
        title="Log In"
        onPress={handleLogin}
        disabled={submitting || !email || !password}
      />

      <View style={{ height: 10 }} />

      <Button
        title="Don't have an account? Sign up"
        onPress={() => navigation.navigate('Signup')}
        disabled={submitting}
      />
    </View>
  );
}
