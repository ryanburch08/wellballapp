// src/screens/ChallengeManagerScreen.js
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, FlatList } from 'react-native';
import { listChallenges, deleteChallenge } from '../services/challengeService';

const FilterPill = ({ label, active, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={{ paddingVertical:6, paddingHorizontal:10, borderRadius:999,
             backgroundColor: active ? '#111' : '#eee', marginRight:8 }}
  >
    <Text style={{ color: active ? '#fff' : '#111', fontWeight:'700' }}>{label}</Text>
  </TouchableOpacity>
);

export default function ChallengeManagerScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({ range: null, difficulty: null, activeOnly: true });

  const load = async () => {
    setLoading(true);
    try {
      const list = await listChallenges({
        range: filters.range,
        difficulty: filters.difficulty,
        activeOnly: filters.activeOnly,
      });
      setItems(list);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filters]);

  const confirmDelete = (id) =>
    Alert.alert('Delete challenge?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteChallenge(id); load(); } },
    ]);

  return (
    <View style={{ flex:1, padding:12 }}>
      <View style={{ flexDirection:'row', alignItems:'center', marginBottom:10 }}>
        <Text style={{ fontWeight:'800', fontSize:18 }}>Challenges</Text>
        <View style={{ flex:1 }} />
        <TouchableOpacity
          onPress={() => navigation.navigate('ChallengeEditor', { mode:'create' })}
          style={{ backgroundColor:'#111', paddingVertical:8, paddingHorizontal:12, borderRadius:10 }}
        >
          <Text style={{ color:'#fff', fontWeight:'800' }}>New</Text>
        </TouchableOpacity>
      </View>

      {/* Filters */}
      <View style={{ flexDirection:'row', marginBottom:10 }}>
        {['all','mid','long','gc'].map((r) => (
          <FilterPill
            key={r}
            label={r.toUpperCase()}
            active={filters.range === (r === 'all' ? null : r)}
            onPress={() => setFilters((f) => ({ ...f, range: r === 'all' ? null : r }))}
          />
        ))}
        {['all','easy','normal','hard'].map((d) => (
          <FilterPill
            key={d+'d'}
            label={d.toUpperCase()}
            active={filters.difficulty === (d === 'all' ? null : d)}
            onPress={() => setFilters((f) => ({ ...f, difficulty: d === 'all' ? null : d }))}
          />
        ))}
      </View>

      {loading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => navigation.navigate('ChallengeEditor', { mode:'edit', id:item.id })}
              onLongPress={() => confirmDelete(item.id)}
              style={{ padding:12, borderWidth:1, borderColor:'#eee', borderRadius:10, marginBottom:10 }}
            >
              <Text style={{ fontWeight:'800' }}>{item.name}</Text>
              <Text style={{ color:'#555', marginTop:4 }}>{item.description}</Text>
              <Text style={{ color:'#333', marginTop:6 }}>
                diff: {item.difficulty} • target:{item.targetScore} • pfw:{item.pointsForWin}
              </Text>
              <Text style={{ color:'#333', marginTop:2 }}>
                rule: range={item.shotRule?.requireRange} • spots={item.shotRule?.allowedSpotIds?.join(', ') || 'any'}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text>No challenges yet.</Text>}
          refreshing={loading}
          onRefresh={load}
        />
      )}

      {/* Build sequences */}
      <TouchableOpacity
        onPress={() => navigation.navigate('SequenceBuilder')}
        style={{ position:'absolute', right:12, bottom:12, backgroundColor:'#0a0',
                 borderRadius:999, paddingVertical:12, paddingHorizontal:16 }}
      >
        <Text style={{ color:'#fff', fontWeight:'900' }}>Build Sequence</Text>
      </TouchableOpacity>
    </View>
  );
}
