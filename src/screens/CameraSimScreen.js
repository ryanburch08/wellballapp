import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Switch, Alert } from 'react-native';
import { pushAutoEvent } from '../services/autoTrackingService';

export default function CameraSimScreen({ route }) {
  const { gameId } = route.params || {};
  const [team, setTeam] = useState('A');
  const [playerId, setPlayerId] = useState('A1');
  const [shotType, setShotType] = useState('mid'); // mid|long|gamechanger|bonus_mid|bonus_long|bonus_gc
  const [moneyball, setMoneyball] = useState(false);
  const [confidence, setConfidence] = useState('0.80');

  const send = async (made) => {
    if (!gameId) return Alert.alert('Missing gameId');
    const conf = Math.max(0, Math.min(1, Number(confidence) || 0.8));
    try {
      await pushAutoEvent(gameId, {
        type: 'shot',
        playerId,
        team,
        shotType,
        made,
        moneyball,
        confidence: conf,
        sourceCamId: 'sim',
        spotId: null,
      });
      Alert.alert('Sent', `Autoevent queued (made=${made ? '✓' : '✗'}, conf=${conf}).`);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  };

  const Cycle = ({ label, value, setValue, options }) => (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.cycle}
        onPress={() => {
          const i = options.indexOf(value);
          setValue(options[(i + 1) % options.length]);
        }}
      >
        <Text style={styles.value}>{value}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>CameraSim</Text>
      <Cycle label="Team" value={team} setValue={setTeam} options={['A','B']} />
      <View style={styles.row}>
        <Text style={styles.label}>Player ID</Text>
        <TextInput style={styles.input} value={playerId} onChangeText={setPlayerId} />
      </View>
      <Cycle label="Shot Type" value={shotType} setValue={setShotType}
        options={['mid','long','gamechanger','bonus_mid','bonus_long','bonus_gc']} />
      <View style={styles.row}>
        <Text style={styles.label}>Moneyball</Text>
        <Switch value={moneyball} onValueChange={setMoneyball} />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Confidence</Text>
        <TextInput style={styles.input} value={confidence} onChangeText={setConfidence} keyboardType="decimal-pad" />
      </View>

      <View style={{ flexDirection:'row', gap:10, marginTop:10 }}>
        <TouchableOpacity style={[styles.bigBtn, { backgroundColor:'#0a0' }]} onPress={() => send(true)}>
          <Text style={styles.bigTxt}>MAKE</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.bigBtn, { backgroundColor:'#aaa' }]} onPress={() => send(false)}>
          <Text style={styles.bigTxt}>MISS</Text>
        </TouchableOpacity>
      </View>
      <Text style={{ color:'#666', marginTop:10 }}>
        Clock gating applies: events are ignored unless the game clock is running.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container:{ flex:1, padding:12, backgroundColor:'#fff' },
  h1:{ fontSize:20, fontWeight:'800', marginBottom:8 },
  row:{ flexDirection:'row', alignItems:'center', marginBottom:8 },
  label:{ width:110, fontWeight:'700', color:'#333' },
  input:{ flex:1, borderWidth:1, borderColor:'#ddd', borderRadius:8, paddingHorizontal:10, paddingVertical:6, backgroundColor:'#fff' },
  cycle:{ flex:1, borderWidth:1, borderColor:'#ddd', borderRadius:8, paddingHorizontal:10, paddingVertical:10, backgroundColor:'#fff' },
  value:{ fontWeight:'800', color:'#111' },
  bigBtn:{ flex:1, borderRadius:12, alignItems:'center', justifyContent:'center', paddingVertical:16 },
  bigTxt:{ color:'#fff', fontWeight:'900', fontSize:18 },
});
