// src/components/CameraStatusBar.js
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { listenCameras, computeReadiness, REQUIRED_ROLES } from '../services/cameraService';

export default function CameraStatusBar({ gameId, requiredRoles = REQUIRED_ROLES, onAddCamera }) {
  const [cams, setCams] = useState([]);
  useEffect(() => {
    if (!gameId) return;
    const off = listenCameras(gameId, setCams);
    return () => off && off();
  }, [gameId]);

  const { details, missing, allReady } = computeReadiness(cams, { requiredRoles });

  const dot = (state) => (
    <View style={[
      styles.dot,
      state === 'green' ? styles.dotGreen :
      state === 'yellow' ? styles.dotYellow :
      styles.dotGray
    ]} />
  );

  const chipColor = (c) => {
    if (c.ready) return 'green';
    if (c.online) return 'yellow';
    return 'gray';
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Cameras</Text>
      <View style={styles.row}>
        {requiredRoles.map((role) => {
          const list = details.filter((c) => c.role === role);
          if (list.length === 0) {
            return (
              <View key={role} style={styles.chip}>
                {dot('gray')}
                <Text style={styles.chipTxt}>{role}</Text>
              </View>
            );
          }
          return list.map((c) => (
            <View key={c.id} style={styles.chip}>
              {dot(chipColor(c))}
              <Text style={styles.chipTxt}>
                {role}{c.name ? ` • ${c.name}` : ''}
                {!c.calibrated ? ' • uncalib' : ''}
                {c.status ? ` • ${c.status}` : ''}
              </Text>
            </View>
          ));
        })}
        <TouchableOpacity onPress={onAddCamera} style={[styles.addBtn]}>
          <Text style={styles.addTxt}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.summaryRow}>
        <Text style={[styles.summary, allReady ? styles.ok : styles.warn]}>
          {allReady ? 'Ready to capture' : `Waiting: ${missing.join(', ') || '—'}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderColor: '#eee', backgroundColor: '#fafafa', borderRadius: 10, padding: 10, marginBottom: 10 },
  title: { fontWeight: '800', marginBottom: 6, color: '#111' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },

  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 8, backgroundColor: 'white' },
  chipTxt: { fontWeight: '700', color: '#111' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotGreen: { backgroundColor: '#10b981' },
  dotYellow: { backgroundColor: '#f59e0b' },
  dotGray: { backgroundColor: '#9ca3af' },

  addBtn: { backgroundColor: '#111', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  addTxt: { color: '#fff', fontWeight: '700' },

  summaryRow: { marginTop: 8 },
  summary: { fontWeight: '800' },
  ok: { color: '#10b981' },
  warn: { color: '#b45309' },
});
