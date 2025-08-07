import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../services/firebase'; // Adjust path if needed

export default function SignupScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignUp = async () => {
    if (!email || !password || !displayName) {
      Alert.alert('Error', 'Please fill all fields.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      // 1. Create user in Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 2. Assign role based on email
      const role = email.endsWith('@playwellball.com') ? 'staff' : 'player';

      // 3. Add user doc to Firestore
      await setDoc(doc(db, 'users', user.uid), {
        displayName,
        email,
        role,
      });

      Alert.alert('Success', 'Account created! You can now log in.');
      navigation.replace('Login');
    } catch (error) {
      Alert.alert('Signup Error', error.message);
    }
    setLoading(false);
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
      />
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        autoCapitalize="none"
        secureTextEntry
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm Password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        autoCapitalize="none"
        secureTextEntry
      />

      <Button
        title={loading ? 'Signing Up...' : 'Sign Up'}
        onPress={handleSignUp}
        disabled={loading}
      />

      <TouchableOpacity
        onPress={() => navigation.replace('Login')}
        style={{ marginTop: 24 }}
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
