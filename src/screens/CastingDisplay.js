// src/screens/CastingDisplay.js
import React from 'react';
import { View, Text } from 'react-native';
import { doc, collection, query, orderBy, onSnapshot } from 'firebase/firestore';

export default function CastingDisplay() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#001' }}>
      <Text style={{ color: 'white', fontSize: 22 }}>Casting Display — placeholder</Text>
    </View>
  );
}
