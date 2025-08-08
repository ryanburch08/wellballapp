// src/screens/LobbyScreen.js
import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';

export default function LobbyScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Lobby</Text>
      <Text style={styles.p}>This is a placeholder lobby screen.</Text>
      <Button title="Open Team Picker" onPress={() => navigation.navigate('TeamPicker')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  h1: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  p: { color: '#666', marginBottom: 12 }
});
