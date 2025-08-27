// src/screens/SequenceBuilderScreen.js
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert } from 'react-native';
import { listChallenges } from '../services/challengeService';
import { createSequence } from '../services/challengeService';

export default function SequenceBuilderScreen({ navigation }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const [filters, setFilters] = useState({ range:null, difficulty:null });
  const [choices, setChoices] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState([]); // array of {id, name}

  const load = async () => {
    setLoading(true);
    try {
      const list = await listChallenges({
        range: filters.range, difficulty: filters.difficulty, activeOnly: true,
      });
      setChoices(list);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filters]);

  const add = (c) => {
    if (selected.find((x) => x.id === c.id)) return;
    setSelected((s) => [...s, { id: c.id, name: c.name }]);
  };
  const remove = (id) => setSelected((s) => s.filter((x) => x.id !== id));
  const moveUp = (idx) => { if (idx<=0) return; const s=[...selected]; [s[idx-1],s[idx]]=[s[idx],s[idx-1]]; setSelected(s); };
  const moveDown = (idx) => { if (idx>=selected.length-1) return; const s=[...selected]; [s[idx+1],s[idx]]=[s[idx],s[idx+1]]; setSelected(s); };

  const save = async () => {
    if (!name.trim()) return Alert.alert('Name required');
    if (!selected.length) return Alert.alert('Add at least one challenge');
    try {
      await createSequence({ name, description, challengeIds: selected.map((s) => s.id) });
      Alert.alert('Saved', 'Sequence created');
      navigation.goBack();
    } catch (e) {
      Alert.alert('Save failed', e.message);
    }
  };

  return (
    <View style={{ flex:1, padding:12 }}>
      <Text style={{ fontWeight:'800', fontSize:18, marginBottom:10 }}>Build Sequence</Text>

      <Text style={{ fontWeight:'700' }}>Name</Text>
      <TextInput value={name} onChangeText={setName}
        placeholder="Friday Shootout"
        style={{ borderWidth:1, borderColor:'#ddd', borderRadius:8, padding:10, marginBottom:8 }} />

      <Text style={{ fontWeight:'700' }}>Description (optional)</Text>
      <TextInput value={description} onChangeText={setDescription} multiline
        placeholder="Notes for staff or rules summary"
        style={{ borderWidth:1, borderColor:'#ddd', borderRadius:8, padding:10, minHeight:60, marginBottom:12 }} />

      {/* Filters */}
      <View style={{ flexDirection:'row', gap:8, marginBottom:8 }}>
        {['all','mid','long','gc'].map((r) => (
          <TouchableOpacity key={r}
            onPress={() => setFilters((f)=>({ ...f, range: r==='all'?null:r }))}
            style={{ paddingVertical:6, paddingHorizontal:10, borderRadius:999, backgroundColor: (filters.range=== (r==='all'?null:r)) ? '#111' : '#eee' }}>
            <Text style={{ color: (filters.range=== (r==='all'?null:r)) ? '#fff' : '#111', fontWeight:'700' }}>{r.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
        {['all','easy','normal','hard'].map((d) => (
          <TouchableOpacity key={d}
            onPress={() => setFilters((f)=>({ ...f, difficulty: d==='all'?null:d }))}
            style={{ paddingVertical:6, paddingHorizontal:10, borderRadius:999, backgroundColor: (filters.difficulty=== (d==='all'?null:d)) ? '#111' : '#eee' }}>
            <Text style={{ color: (filters.difficulty=== (d==='all'?null:d)) ? '#fff' : '#111', fontWeight:'700' }}>{d.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ flexDirection:'row', gap:12, flex:1 }}>
        {/* Left: available */}
        <View style={{ flex:1 }}>
          <Text style={{ fontWeight:'800', marginBottom:6 }}>Available</Text>
          <FlatList
            data={choices}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => add(item)}
                style={{ padding:10, borderWidth:1, borderColor:'#eee', borderRadius:10, marginBottom:8 }}
              >
                <Text style={{ fontWeight:'700' }}>{item.name}</Text>
                <Text style={{ color:'#555' }}>{item.description}</Text>
                <Text style={{ color:'#333', marginTop:4, fontSize:12 }}>
                  {item.difficulty} • range={item.shotRule?.requireRange} • spots={item.shotRule?.allowedSpotIds?.join(',')||'any'}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text>{loading ? 'Loading…' : 'No matches'}</Text>}
          />
        </View>

        {/* Right: selected */}
        <View style={{ flex:1 }}>
          <Text style={{ fontWeight:'800', marginBottom:6 }}>In Sequence ({selected.length})</Text>
          <FlatList
            data={selected}
            keyExtractor={(i, idx) => i.id + ':' + idx}
            renderItem={({ item, index }) => (
              <View style={{ padding:10, borderWidth:1, borderColor:'#eee', borderRadius:10, marginBottom:8 }}>
                <Text style={{ fontWeight:'700' }}>{index+1}. {item.name}</Text>
                <View style={{ flexDirection:'row', gap:8, marginTop:8 }}>
                  <TouchableOpacity onPress={() => moveUp(index)} style={{ backgroundColor:'#eee', padding:6, borderRadius:8 }}>
                    <Text style={{ fontWeight:'800' }}>↑</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => moveDown(index)} style={{ backgroundColor:'#eee', padding:6, borderRadius:8 }}>
                    <Text style={{ fontWeight:'800' }}>↓</Text>
                  </TouchableOpacity>
                  <View style={{ flex:1 }} />
                  <TouchableOpacity onPress={() => remove(item.id)} style={{ backgroundColor:'#b00', padding:6, borderRadius:8 }}>
                    <Text style={{ color:'#fff', fontWeight:'800' }}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            ListEmptyComponent={<Text>No challenges selected.</Text>}
          />
        </View>
      </View>

      <TouchableOpacity onPress={save} style={{ backgroundColor:'#0a0', padding:14, borderRadius:10, marginTop:10 }}>
        <Text style={{ color:'#fff', fontWeight:'900', textAlign:'center' }}>Save Sequence</Text>
      </TouchableOpacity>
    </View>
  );
}
