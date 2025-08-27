// src/screens/CalibrationWizardScreen.js
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch, Alert, FlatList } from 'react-native';
import { saveCourtConfig, listenCourtConfig, DEFAULT_SPOT_MAP, buildShotKey, toDisplayLabel } from '../services/courtService';

const RANGE_CYCLE = (zone) => zone === 'gc' ? ['gamechanger'] : ['mid', 'long'];
const zoneShort = (z) =>
  z === 'corner' ? 'COR' :
  z === 'wing'   ? 'WNG' :
  z === 'elbow'  ? 'ELB' :
  z === 'top'    ? 'TOP' :
  'GC';

const rangeShort = (t) =>
  t === 'mid' ? 'MR' :
  t === 'long' ? 'LR' : 'GC';

const SpotCell = ({ num, zone, shotType, onToggle }) => {
  const shotKey = buildShotKey(shotType, zone);
  const label = toDisplayLabel(shotKey);
  const bg =
    shotType === 'mid' ? '#dbeafe' :
    shotType === 'long' ? '#fee2e2' :
    '#fef3c7';
  const disabled = zone === 'gc';

  return (
    <TouchableOpacity onPress={onToggle} disabled={disabled} style={[styles.cell, { backgroundColor: bg, opacity: disabled ? 0.8 : 1 }]}>
      <Text style={styles.cellNum}>{num}</Text>
      <Text style={styles.cellType}>{rangeShort(shotType)} • {zoneShort(zone)}</Text>
      <Text style={styles.cellLabel}>{label}</Text>
      {disabled && <Text style={styles.lockTag}>LOCKED</Text>}
    </TouchableOpacity>
  );
};

export default function CalibrationWizardScreen({ route }) {
  const { gameId } = route?.params || {};
  const [swapSides, setSwapSides] = useState(false);
  const [spotMap, setSpotMap] = useState(DEFAULT_SPOT_MAP);

  useEffect(() => {
    if (!gameId) return;
    const off = listenCourtConfig(gameId, (cfg) => {
      setSwapSides(!!cfg.swapSides);
      // Ensure we always have zone + shotType + shotKey
      const merged = {};
      Object.entries({ ...DEFAULT_SPOT_MAP, ...(cfg.spotMap || {}) }).forEach(([k, v]) => {
        const st = v?.shotType || DEFAULT_SPOT_MAP[k]?.shotType;
        const z  = v?.zone     || DEFAULT_SPOT_MAP[k]?.zone;
        merged[k] = { shotType: st, zone: z, shotKey: buildShotKey(st, z) };
      });
      setSpotMap(merged);
    });
    return () => off && off();
  }, [gameId]);

  const data = useMemo(() => (
    Array.from({ length: 18 }, (_, i) => {
      const n = i + 1;
      const cur = spotMap[n] || DEFAULT_SPOT_MAP[n];
      return { n, zone: cur.zone, shotType: cur.shotType };
    })
  ), [spotMap]);

  const toggleSpot = (n) => {
    setSpotMap((prev) => {
      const cur = prev[n] || DEFAULT_SPOT_MAP[n];
      const cycle = RANGE_CYCLE(cur.zone);
      const idx = cycle.indexOf(cur.shotType);
      const next = cycle[(idx + 1) % cycle.length];
      const upd = { ...prev };
      upd[n] = { shotType: next, zone: cur.zone, shotKey: buildShotKey(next, cur.zone) };
      return upd;
    });
  };

  const save = async () => {
    try {
      await saveCourtConfig(gameId, { spotMap, swapSides });
      Alert.alert('Saved', 'Court configuration updated.');
    } catch (e) {
      Alert.alert('Save failed', String(e?.message || e));
    }
  };

  return (
    <View style={{ flex:1, backgroundColor:'#fff', padding:12 }}>
      <Text style={{ fontSize:18, fontWeight:'800', marginBottom:6 }}>Calibration — Court Spots</Text>
      <Text style={{ color:'#444', marginBottom:10 }}>
        Each spot shows its <Text style={{ fontWeight:'800' }}>Range</Text> (MR/LR) and <Text style={{ fontWeight:'800' }}>Zone</Text> (COR/WNG/ELB/TOP or GC).
        Tap to toggle range on non-GC spots. Gamechangers are locked.
      </Text>

      <View style={[styles.row, { marginBottom:12 }]}>
        <Text style={{ fontWeight:'700' }}>Swap Sides</Text>
        <Switch value={swapSides} onValueChange={setSwapSides} />
        <View style={{ flex:1 }} />
        <TouchableOpacity style={styles.primary} onPress={save}>
          <Text style={styles.primaryTxt}>Save</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={data}
        keyExtractor={(it)=>String(it.n)}
        numColumns={6}
        columnWrapperStyle={{ gap:8 }}
        contentContainerStyle={{ gap:8 }}
        renderItem={({ item }) => (
          <SpotCell
            num={item.n}
            zone={item.zone}
            shotType={item.shotType}
            onToggle={() => toggleSpot(item.n)}
          />
        )}
        ListFooterComponent={<View style={{ height: 8 }} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row:{ flexDirection:'row', alignItems:'center', gap:12 },
  primary:{ backgroundColor:'#111', paddingVertical:8, paddingHorizontal:12, borderRadius:10 },
  primaryTxt:{ color:'#fff', fontWeight:'900' },
  cell:{
    flex:1,
    minWidth: 0,
    aspectRatio: 1.2,
    borderRadius: 10,
    alignItems:'center',
    justifyContent:'center',
    borderWidth:1, borderColor:'#e5e7eb',
    paddingVertical: 6,
  },
  cellNum:{ fontWeight:'800', fontSize:18, color:'#111' },
  cellType:{ fontWeight:'900', fontSize:12, color:'#111', opacity:0.9 },
  cellLabel:{ fontWeight:'700', fontSize:11, color:'#111', opacity:0.7, marginTop:2 },
  lockTag:{ marginTop:4, fontSize:10, fontWeight:'800', color:'#92400e' },
});
