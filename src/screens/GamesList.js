// src/screens/GamesList.js
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function GamesList() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Games List</Text>
      <Text style={styles.subtitle}>No games yet. Create one from Staff.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { marginTop: 8, color: '#666' },
});
