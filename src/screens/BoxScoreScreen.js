// src/screens/BoxScoreScreen.js
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity } from 'react-native';
import { db } from '../services/firebase';
import { collection, doc, onSnapshot, orderBy, query, onSnapshot as onSnapCol } from 'firebase/firestore';
import * as ScreenOrientation from 'expo-screen-orientation'; // ✅ Expo-friendly

export default function BoxScoreScreen({ route, navigation }) {
  const { gameId } = route.params || {};
  const [game, setGame] = useState(null);
  const [logs, setLogs] = useState([]);

  // ✅ Lock to landscape on mount; restore portrait on unmount (Expo Go safe)
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);

  useEffect(() => {
    if (!gameId) return;
    const offGame = onSnapshot(doc(db, 'games', gameId), s =>
      setGame(s.exists() ? ({ id: s.id, ...s.data() }) : null)
    );
    const ql = query(collection(db, 'games', gameId, 'logs'), orderBy('ts', 'asc'));
    const offLogs = onSnapCol(ql, s => setLogs(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { offGame && offGame(); offLogs && offLogs(); };
  }, [gameId]);

  const attempts = useMemo(
    () => logs.filter(l => typeof l.made === 'boolean' && l.playerId && (l.team === 'A' || l.team === 'B')),
    [logs]
  );
  const winLogs = useMemo(
    () => logs.filter(l => l.type === 'challenge_win' && (l.team === 'A' || l.team === 'B')),
    [logs]
  );

  const pct = (m, a) => (a > 0 ? `${Math.round((m / a) * 100)}%` : '—');

  const perPlayer = useMemo(() => {
    const ensure = (map, pid, team) => {
      if (!map[pid]) {
        map[pid] = {
          team,
          total: { m: 0, a: 0 },
          mid: { m: 0, a: 0 },
          long: { m: 0, a: 0 },
          money: { m: 0, a: 0 },
          gamechanger: { m: 0, a: 0 },
          bonus: { m: 0, a: 0 },
          winners: 0,
        };
      }
      return map[pid];
    };

    const map = {};
    for (const l of attempts) {
      const row = ensure(map, l.playerId, l.team);
      row.total.a += 1;
      if (l.made) row.total.m += 1;

      if (l.shotType === 'mid' || l.shotType === 'long' || l.shotType === 'gamechanger' || l.shotType === 'bonus') {
        row[l.shotType].a += 1;
        if (l.made) row[l.shotType].m += 1;
      }
      if (l.moneyball) {
        row.money.a += 1;
        if (l.made) row.money.m += 1;
      }
    }
    for (const w of winLogs) {
      if (w.byPlayerId) {
        const row = ensure(map, w.byPlayerId, w.team);
        row.winners += 1;
      }
    }
    return map;
  }, [attempts, winLogs]);

  const teamAPlayers = useMemo(
    () => (game?.teamAIds || []).map(pid => ({ pid, ...(perPlayer[pid] || defaultRow('A')) })),
    [game?.teamAIds, perPlayer]
  );
  const teamBPlayers = useMemo(
    () => (game?.teamBIds || []).map(pid => ({ pid, ...(perPlayer[pid] || defaultRow('B')) })),
    [game?.teamBIds, perPlayer]
  );

  if (!game) {
    return (
      <SafeAreaView style={styles.center}>
        <Text>Loading box score…</Text>
      </SafeAreaView>
    );
  }

  const matchA = Number(game.matchScore?.A ?? 0) || 0;
  const matchB = Number(game.matchScore?.B ?? 0) || 0;
  const chalA  = Number(game.challengeScore?.A ?? 0) || 0;
  const chalB  = Number(game.challengeScore?.B ?? 0) || 0;

  const teamTotals = (teamKey) => {
    let m = 0, a = 0, wins = 0;
    for (const p of (teamKey === 'A' ? teamAPlayers : teamBPlayers)) {
      m += p.total.m; a += p.total.a; wins += p.winners;
    }
    return { m, a, wins };
  };
  const tA = teamTotals('A');
  const tB = teamTotals('B');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.h1}>Final Box Score</Text>
        <Text style={styles.meta}>Match: {matchA} : {matchB}</Text>
        <Text style={styles.metaSmall}>Last Challenge Score: {chalA} : {chalB}</Text>
      </View>

      <View style={styles.columns}>
        <TeamPanel title="Team A" totals={tA} players={teamAPlayers} />
        <TeamPanel title="Team B" totals={tB} players={teamBPlayers} right />
      </View>

      <View style={styles.footerRow}>
        <TouchableOpacity
          style={[styles.btn, styles.btnLight]}
          onPress={() => navigation.navigate('StaffDashboard')}
        >
          <Text style={[styles.btnTxt, { color: '#111' }]}>Back to Staff Dashboard</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => navigation.navigate('StatEntryScreen', { gameId })}
        >
          <Text style={styles.btnTxt}>Reopen Tracker</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/* ---------------- Subcomponents ---------------- */

function TeamPanel({ title, totals, players, right = false }) {
  return (
    <View style={[styles.teamPanel, right && { marginLeft: 6 }]}>
      <View style={styles.teamHeaderRow}>
        <Text style={styles.teamTitle}>{title}</Text>
        <Text style={styles.teamSum}>
          FG {pct(totals.m, totals.a)} • {totals.m}/{totals.a} • GW {totals.wins}
        </Text>
      </View>

      <View style={[styles.rowDense, styles.headerDense]}>
        <Text style={[styles.nameCell, styles.bold]}>Player</Text>
        <Text style={[styles.cell, styles.bold]}>FG%</Text>
        <Text style={[styles.cell, styles.bold]}>m/a</Text>
        <Text style={[styles.cell, styles.bold]}>Mid</Text>
        <Text style={[styles.cell, styles.bold]}>Long</Text>
        <Text style={[styles.cell, styles.bold]}>$</Text>
        <Text style={[styles.cell, styles.bold]}>GC</Text>
        <Text style={[styles.cell, styles.bold]}>Bonus</Text>
        <Text style={[styles.cell, styles.bold]}>GW</Text>
      </View>

      {players.map((p) => (
        <PlayerDenseRow key={p.pid} p={p} />
      ))}
    </View>
  );
}

function PlayerDenseRow({ p }) {
  const fgPct = p.total.a > 0 ? `${Math.round((p.total.m / p.total.a) * 100)}%` : '—';
  const fmtNa = (m, a) => (a > 0 ? `${m}/${a}` : '0/0');

  return (
    <View style={styles.rowDense}>
      <Text style={[styles.nameCell, styles.bold]} numberOfLines={1}>{p.pid}</Text>
      <Text style={styles.cell}>{fgPct}</Text>
      <Text style={styles.cell}>{p.total.m}/{p.total.a}</Text>
      <Text style={styles.cell}>{fmtNa(p.mid.m, p.mid.a)}</Text>
      <Text style={styles.cell}>{fmtNa(p.long.m, p.long.a)}</Text>
      <Text style={styles.cell}>{fmtNa(p.money.m, p.money.a)}</Text>
      <Text style={styles.cell}>{fmtNa(p.gamechanger.m, p.gamechanger.a)}</Text>
      <Text style={styles.cell}>{fmtNa(p.bonus.m, p.bonus.a)}</Text>
      <Text style={styles.cell}>{p.winners}</Text>
    </View>
  );
}

/* ---------------- Helpers & Styles ---------------- */

const pct = (m, a) => (a > 0 ? `${Math.round((m / a) * 100)}%` : '—');

function defaultRow(team) {
  return {
    team,
    total: { m: 0, a: 0 },
    mid: { m: 0, a: 0 },
    long: { m: 0, a: 0 },
    money: { m: 0, a: 0 },
    gamechanger: { m: 0, a: 0 },
    bonus: { m: 0, a: 0 },
    winners: 0,
  };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white', padding: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { alignItems: 'center', marginBottom: 6 },
  h1: { fontSize: 18, fontWeight: '900' },
  meta: { fontSize: 14, fontWeight: '800', marginTop: 2 },
  metaSmall: { color: '#666', marginTop: 2, fontSize: 12 },

  columns: { flexDirection: 'row', flex: 1, gap: 6 },
  teamPanel: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    padding: 8,
    backgroundColor: '#fafafa',
  },
  teamHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  teamTitle: { fontSize: 14, fontWeight: '900' },
  teamSum: { fontSize: 12, fontWeight: '800', color: '#222' },

  headerDense: { backgroundColor: '#f1f1f1', borderRadius: 6 },
  rowDense: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  nameCell: { flex: 1.5, paddingRight: 6, fontSize: 12, color: '#111' },
  cell: { flex: 1, textAlign: 'center', fontSize: 11, color: '#111' },
  bold: { fontWeight: '900' },

  footerRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btn: { backgroundColor: '#111', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center' },
  btnLight: { backgroundColor: '#eee' },
  btnTxt: { color: 'white', fontWeight: '800' },
});
