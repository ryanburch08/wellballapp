// src/screens/ChallengeEditorScreen.js
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch, Alert, ScrollView } from 'react-native';
import { createChallenge, getChallenge, updateChallenge } from '../services/challengeService';
import { ALL_SPOT_IDS, SPOT_META } from '../services/courtService';

const SpotButton = ({ id, selected, onToggle }) => (
  <TouchableOpacity
    onPress={() => onToggle(id)}
    style={{
      width: 44, height: 44, margin: 4, borderRadius: 8,
      alignItems:'center', justifyContent:'center',
      backgroundColor: selected ? '#111' : '#eee'
    }}
  >
    <Text style={{ color: selected ? '#fff' : '#111', fontWeight:'800' }}>{id}</Text>
  </TouchableOpacity>
);

export default function ChallengeEditorScreen({ route, navigation }) {
  const { mode = 'create', id = null } = route.params || {};

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState('normal');
  const [targetScore, setTargetScore] = useState('5');
  const [pointsForWin, setPointsForWin] = useState('1');

  const [requireRange, setRequireRange] = useState('any'); // any|mid|long
  const [allowedSpotIds, setAllowedSpotIds] = useState([]);
  const [moneyballAllowed, setMoneyballAllowed] = useState(true);
  const [mustStartFromSpot, setMustStartFromSpot] = useState(false);
  const [active, setActive] = useState(true);

  useEffect(() => {
    (async () => {
      if (mode === 'edit' && id) {
        const c = await getChallenge(id);
        if (!c) {
          Alert.alert('Not found', 'Challenge no longer exists');
          navigation.goBack();
          return;
        }
        setName(c.name || '');
        setDescription(c.description || '');
        setDifficulty(c.difficulty || 'normal');
        setTargetScore(String(c.targetScore ?? '0'));
        setPointsForWin(String(c.pointsForWin ?? '1'));
        setRequireRange(c.shotRule?.requireRange || 'any');
        setAllowedSpotIds(c.shotRule?.allowedSpotIds || []);
        setMoneyballAllowed(!!c.shotRule?.moneyballAllowed);
        setMustStartFromSpot(!!c.shotRule?.mustStartFromSpot);
        setActive(!!c.active);
      }
    })();
  }, [mode, id]);

  const toggleSpot = (n) =>
    setAllowedSpotIds((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));

  const save = async () => {
    try {
      const payload = {
        name, description, difficulty,
        targetScore: Number(targetScore) || 0,
        pointsForWin: Number(pointsForWin) || 0,
        active,
        shotRule: {
          requireRange,
          allowedSpotIds: allowedSpotIds.map(Number),
          moneyballAllowed,
          mustStartFromSpot,
        },
      };
      if (mode === 'edit' && id) {
        await updateChallenge(id, payload);
      } else {
        await createChallenge(payload);
      }
      Alert.alert('Saved', 'Challenge saved');
      navigation.goBack();
    } catch (e) {
      Alert.alert('Save failed', e.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding:12 }}>
      <Text style={{ fontWeight:'800', fontSize:18, marginBottom:10 }}>
        {mode === 'edit' ? 'Edit Challenge' : 'New Challenge'}
      </Text>

      <Text style={{ fontWeight:'700' }}>Name</Text>
      <TextInput value={name} onChangeText={setName}
        placeholder="Corner Chaos" style={{ borderWidth:1, borderColor:'#ddd', borderRadius:8, padding:10, marginBottom:10 }} />

      <Text style={{ fontWeight:'700' }}>Description</Text>
      <TextInput value={description} onChangeText={setDescription} multiline
        placeholder="Describe the rules…" style={{ borderWidth:1, borderColor:'#ddd', borderRadius:8, padding:10, minHeight:70, marginBottom:10 }} />

      <Text style={{ fontWeight:'700' }}>Difficulty</Text>
      <View style={{ flexDirection:'row', gap:8, marginBottom:10 }}>
        {['easy','normal','hard'].map((d) => (
          <TouchableOpacity key={d}
            onPress={() => setDifficulty(d)}
            style={{ paddingVertical:8, paddingHorizontal:12, borderRadius:10, backgroundColor: difficulty===d ? '#111' : '#eee' }}>
            <Text style={{ color: difficulty===d ? '#fff' : '#111', fontWeight:'800' }}>{d.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ flexDirection:'row', gap:10 }}>
        <View style={{ flex:1 }}>
          <Text style={{ fontWeight:'700' }}>Target Score</Text>
          <TextInput value={targetScore} onChangeText={setTargetScore} keyboardType="number-pad"
            style={{ borderWidth:1, borderColor:'#ddd', borderRadius:8, padding:10, marginBottom:10 }} />
        </View>
        <View style={{ flex:1 }}>
          <Text style={{ fontWeight:'700' }}>Points for Win</Text>
          <TextInput value={pointsForWin} onChangeText={setPointsForWin} keyboardType="number-pad"
            style={{ borderWidth:1, borderColor:'#ddd', borderRadius:8, padding:10, marginBottom:10 }} />
        </View>
      </View>

      <Text style={{ fontWeight:'800', marginTop:6 }}>Shot Rule</Text>

      <Text style={{ fontWeight:'700', marginTop:8 }}>Require Range</Text>
      <View style={{ flexDirection:'row', gap:8, marginBottom:10 }}>
        {['any','mid','long'].map((r) => (
          <TouchableOpacity key={r} onPress={() => setRequireRange(r)}
            style={{ paddingVertical:6, paddingHorizontal:10, borderRadius:999, backgroundColor: requireRange===r ? '#111' : '#eee' }}>
            <Text style={{ color: requireRange===r ? '#fff' : '#111', fontWeight:'700' }}>{r.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={{ fontWeight:'700' }}>Allowed Spots (optional)</Text>
      <View style={{ flexDirection:'row', flexWrap:'wrap', marginVertical:8 }}>
        {ALL_SPOT_IDS.map((n) => (
          <SpotButton key={n} id={n} selected={allowedSpotIds.includes(n)} onToggle={toggleSpot} />
        ))}
      </View>
      <Text style={{ color:'#666', marginBottom:10 }}>
        Leave empty = any spot. Spots: use your court map (1–18 = LR/MR; 17–18 = GC).
      </Text>

      <View style={{ flexDirection:'row', alignItems:'center', marginBottom:6 }}>
        <Switch value={moneyballAllowed} onValueChange={setMoneyballAllowed} />
        <Text style={{ marginLeft:8, fontWeight:'700' }}>Moneyball Allowed</Text>
      </View>
      <View style={{ flexDirection:'row', alignItems:'center', marginBottom:10 }}>
        <Switch value={mustStartFromSpot} onValueChange={setMustStartFromSpot} />
        <Text style={{ marginLeft:8, fontWeight:'700' }}>Must Start From a Listed Spot</Text>
      </View>

      <View style={{ flexDirection:'row', alignItems:'center', marginBottom:16 }}>
        <Switch value={active} onValueChange={setActive} />
        <Text style={{ marginLeft:8, fontWeight:'700' }}>Active</Text>
      </View>

      <TouchableOpacity onPress={save} style={{ backgroundColor:'#111', padding:12, borderRadius:10 }}>
        <Text style={{ color:'#fff', fontWeight:'900', textAlign:'center' }}>Save Challenge</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
