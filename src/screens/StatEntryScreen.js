// src/screens/StatEntryScreen.js
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, TextInput, Switch } from 'react-native';
import { db, auth } from '../services/firebase';
import { doc, onSnapshot, collection, query, orderBy, onSnapshot as onSnapCol } from 'firebase/firestore';

import {
  // shots + undo + progression
  logShot,
  deleteLogAndReverse,
  advanceToNextChallenge,
  // clock helpers
  setClockSeconds,
  startClock,
  stopClock,
  resetClockSeconds,
  // bonus helpers (new)
  startBonusMode,
  endBonusMode,
  // end game
  endGame,
  // two-tracker presence & locks
  listenMyTrackerAssignment,
  listenTrackers,
  heartbeat,
  leaveTracking,
  joinAsTracker,
  tryClaimTeam,
  setTeamLock,
} from '../services/gameService';

export default function StatEntryScreen({ route, navigation }) {
  const { gameId } = route.params || {};
  const uid = auth.currentUser?.uid;

  const [game, setGame] = useState(null);
  const [logs, setLogs] = useState([]);
  const [moneyballArmed, setMoneyballArmed] = useState(false);

  // live clock tick
  const [tick, setTick] = useState(0);
  const [newClock, setNewClock] = useState('');

  // presence
  const [myTrack, setMyTrack] = useState(null);      // {team?: 'A'|'B', lastSeen?}
  const [trackers, setTrackers] = useState([]);      // [{id: uid, team, lastSeen}]

  // subscribe to game + logs
  useEffect(() => {
    if (!gameId) return;
    const unsubGame = onSnapshot(doc(db, 'games', gameId), snap => {
      if (snap.exists()) setGame({ id: snap.id, ...snap.data() });
    });
    const q = query(collection(db, 'games', gameId, 'logs'), orderBy('ts', 'desc'));
    const unsubLogs = onSnapCol(q, s => setLogs(s.docs.map(d => ({ id: d.id, ...d.data() }))));

    return () => { unsubGame && unsubGame(); unsubLogs && unsubLogs(); };
  }, [gameId]);

  // subscribe to presence
  useEffect(() => {
    if (!gameId) return;
    const offMine = listenMyTrackerAssignment(gameId, setMyTrack);
    const offAll  = listenTrackers(gameId, setTrackers);
    const hb = setInterval(() => heartbeat(gameId), 5000);
    return () => { offMine && offMine(); offAll && offAll(); clearInterval(hb); leaveTracking(gameId); };
  }, [gameId]);

  // re-render once per second while clock is running
  useEffect(() => {
    if (!game?.clockRunning || !game?.lastStartAt) return;
    const id = setInterval(() => setTick(t => (t + 1) % 60), 1000);
    return () => clearInterval(id);
  }, [game?.clockRunning, game?.lastStartAt]);

  const isMain = !!uid && uid === game?.roles?.main;
  const lockA = game?.trackerLocks?.A?.uid || null;
  const lockB = game?.trackerLocks?.B?.uid || null;

  const players = useMemo(() => {
    if (!game) return [];
    return [
      ...((game.teamAIds || []).map(id => ({ id, team: 'A' }))),
      ...((game.teamBIds || []).map(id => ({ id, team: 'B' }))),
    ];
  }, [game]);

  const playerTeamKey = (playerId) => {
    if (game?.teamAIds?.includes(playerId)) return 'A';
    if (game?.teamBIds?.includes(playerId)) return 'B';
    return null;
  };

  // Only allow taps for my assigned team (main can tap both)
  const canTap = (playerId) => {
    if (!game) return false;
    if (game.status === 'ended') return false;
    if (game.challengeWon) return false; // block until Next Challenge
    const teamKey = playerTeamKey(playerId);
    if (!teamKey) return false;
    return isMain || (myTrack?.team === teamKey);
  };

  // -------- Bonus state (aligned on bonusActive, fallback to legacy) --------
  const bonusActive = !!(game?.bonusActive ?? game?.bonusRound ?? false);

  // Record shot
  const record = async (playerId, shotType, made) => {
    if (game?.status === 'ended') {
      return Alert.alert('Game ended', 'This game is completed. No further stats can be recorded.');
    }
    if (game?.challengeWon) {
      return Alert.alert('Challenge complete', 'Tap “Next Challenge” to continue.');
    }
    if (!canTap(playerId)) {
      return Alert.alert('Not your team', 'You are not assigned to this team.');
    }
    try {
      const useMoney = !bonusActive && moneyballArmed && (shotType === 'mid' || shotType === 'long');
      await logShot(gameId, { playerId, shotType, made, moneyball: useMoney });
      if (useMoney) setMoneyballArmed(false);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  };

  // Undo last attempt (uses most recent attempt in logs)
  const undoLast = async () => {
    try {
      if (game?.status === 'ended') return Alert.alert('Game ended', 'Cannot undo after the game has ended.');
      const last = logs.find(l => typeof l.made !== 'undefined');
      if (!last) return Alert.alert('Nothing to undo');
      await deleteLogAndReverse(gameId, last);
    } catch (e) {
      Alert.alert('Undo failed', e.message);
    }
  };

  const doAdvance = async () => {
    try {
      if (game?.status === 'ended') return Alert.alert('Game ended', 'This game is completed.');
      await advanceToNextChallenge(gameId);
    } catch (e) {
      Alert.alert('Advance failed', e.message);
    }
  };

  const doSetClock = async () => {
    const secs = Number(newClock);
    if (!Number.isFinite(secs)) return Alert.alert('Enter seconds (number)');
    try {
      await setClockSeconds(gameId, secs);
      setNewClock('');
    } catch (e) {
      Alert.alert('Clock error', e.message);
    }
  };

  // Non-main join helpers
  const canJoinA = !lockA || lockA === uid;
  const canJoinB = !lockB || lockB === uid;

  const joinTeam = async (team) => {
    try {
      await joinAsTracker(gameId, team);  // presence preference
      await tryClaimTeam(gameId, team);   // attempt to lock
    } catch (e) {
      Alert.alert('Assign failed', e.message);
    }
  };

  // Main assign helpers
  const assignTeam = async (team, toUid) => {
    try {
      await setTeamLock(gameId, team, toUid);
    } catch (e) {
      Alert.alert('Assign failed', e.message);
    }
  };
  const clearTeam = async (team) => {
    try {
      await setTeamLock(gameId, team, null);
    } catch (e) {
      Alert.alert('Clear failed', e.message);
    }
  };

  // -------- Bonus Round toggle + behavior (using gameService helpers) --------
  const startBonusRound = async () => {
    try {
      if (game?.status === 'ended') return Alert.alert('Game ended', 'This game is completed.');
      // Stop clock, set to 180, mark bonusActive true — do NOT auto-start
      await startBonusMode(gameId);
      if (moneyballArmed) setMoneyballArmed(false);
    } catch (e) {
      Alert.alert('Bonus error', e.message);
    }
  };

  const endBonusRound = async () => {
    try {
      await endBonusMode(gameId);
    } catch (e) {
      Alert.alert('Bonus error', e.message);
    }
  };

  const toggleBonus = async (val) => {
    if (!isMain) return; // only main can toggle
    if (val) await startBonusRound();
    else await endBonusRound();
  };

  // -------- End Game flow --------
  const onEndGame = () => {
    if (!isMain) return;
    Alert.alert(
      'End game?',
      'This will mark the game as completed. You can still view the box score, but no further stats can be recorded.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Game',
          style: 'destructive',
          onPress: async () => {
            try {
              await endGame(gameId);
              navigation.navigate('BoxScoreScreen', { gameId, fromEnded: true });
            } catch (e) {
              Alert.alert('End failed', e?.message || String(e));
            }
          }
        }
      ]
    );
  };

  if (!game) return <View style={styles.center}><Text>Loading game...</Text></View>;

  const aCh = Number(game.challengeScore?.A ?? 0) || 0;
  const bCh = Number(game.challengeScore?.B ?? 0) || 0;
  const won = game.challengeWon;

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Stat Entry</Text>
      <Text style={styles.meta}>
        Challenge {Number(game.currentChallengeIndex) + 1} • Match {game.matchScore?.A ?? 0} - {game.matchScore?.B ?? 0}
      </Text>

      {/* Presence / Locks UI */}
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Trackers</Text>

        {/* Main admin panel */}
        {isMain ? (
          <>
            <View style={styles.lockRow}>
              <Text style={styles.lockLabel}>Team A lock:</Text>
              <Text style={styles.lockVal}>{lockA ? lockA : '—'}</Text>
              <TouchableOpacity style={styles.smallBtn} onPress={() => clearTeam('A')}>
                <Text style={styles.smallBtnTxt}>Clear A</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.lockRow}>
              <Text style={styles.lockLabel}>Team B lock:</Text>
              <Text style={styles.lockVal}>{lockB ? lockB : '—'}</Text>
              <TouchableOpacity style={styles.smallBtn} onPress={() => clearTeam('B')}>
                <Text style={styles.smallBtnTxt}>Clear B</Text>
              </TouchableOpacity>
            </View>

            <View style={{ marginTop: 6 }}>
              {trackers
                .filter(t => t.id !== uid)
                .map(t => (
                  <View key={t.id} style={styles.trackerRow}>
                    <Text style={{ flex: 1 }}>uid: {t.id} • pref: {t.team || '—'}</Text>
                    {/* Allow assign if slot free or already owned by that uid */}
                    <TouchableOpacity
                      style={[styles.smallBtn, (!lockA || lockA === t.id) ? null : styles.disabled]}
                      disabled={!!lockA && lockA !== t.id}
                      onPress={() => assignTeam('A', t.id)}
                    >
                      <Text style={styles.smallBtnTxt}>Assign A</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.smallBtn, (!lockB || lockB === t.id) ? null : styles.disabled]}
                      disabled={!!lockB && lockB !== t.id}
                      onPress={() => assignTeam('B', t.id)}
                    >
                      <Text style={styles.smallBtnTxt}>Assign B</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              {trackers.filter(t => t.id !== uid).length === 0 && (
                <Text style={{ color: '#666' }}>No other trackers present yet.</Text>
              )}
            </View>
          </>
        ) : (
          // Secondary tracker self-join panel
          <View style={styles.joinRow}>
            <Text style={{ marginRight: 8 }}>You: {myTrack?.team ? `tracking Team ${myTrack.team}` : 'not assigned'}</Text>
            <TouchableOpacity
              style={[styles.smallBtn, canJoinA ? null : styles.disabled]}
              disabled={!canJoinA}
              onPress={() => joinTeam('A')}
            >
              <Text style={styles.smallBtnTxt}>Join Team A</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.smallBtn, canJoinB ? null : styles.disabled]}
              disabled={!canJoinB}
              onPress={() => joinTeam('B')}
            >
              <Text style={styles.smallBtnTxt}>Join Team B</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Top controls row */}
      <View style={styles.row}>
        {/* Moneyball toggle hidden during Bonus Round */}
        {!bonusActive && game.status !== 'ended' && (
          <TouchableOpacity
            onPress={() => setMoneyballArmed(v => !v)}
            style={[styles.moneyToggle, moneyballArmed && styles.moneyToggleOn]}
          >
            <Text style={styles.moneyTxt}>{moneyballArmed ? 'Moneyball ARMED' : 'Moneyball OFF'}</Text>
          </TouchableOpacity>
        )}

        <View style={{ flex: 1 }} />

        {/* Bonus Round toggle for main tracker */}
        <View style={styles.bonusToggleWrap}>
          <Text style={styles.bonusLabel}>
            {game.status === 'ended' ? 'Game Ended' : (bonusActive ? 'Bonus Round ON' : 'Bonus Round OFF')}
          </Text>
          <Switch value={bonusActive} onValueChange={toggleBonus} disabled={!isMain || game.status === 'ended'} />
        </View>

        <TouchableOpacity onPress={undoLast} style={[styles.undo, { marginLeft: 8 }]} disabled={game.status === 'ended'}>
          <Text style={{ color: 'white', fontWeight: '700' }}>Undo</Text>
        </TouchableOpacity>
      </View>

      {/* Clock controls */}
      <View style={[styles.row, { marginBottom: 10 }]}>
        <Text style={{ fontWeight: '700' }}>Clock:</Text>
        <Text style={{ marginLeft: 8 }}>
          {formatClock(computeDisplayedSeconds(game.clockSeconds, game.clockRunning, game.lastStartAt))}
          {game.clockRunning ? ' (running)' : ' (stopped)'}
        </Text>
      </View>

      <View style={[styles.row, { marginBottom: 12, gap: 8 }]}>
        <TextInput
          placeholder="Set seconds"
          value={newClock}
          onChangeText={setNewClock}
          keyboardType="numeric"
          style={styles.input}
          editable={game.status !== 'ended'}
        />
        <TouchableOpacity style={styles.smallBtn} onPress={doSetClock} disabled={game.status === 'ended'}>
          <Text style={styles.smallBtnTxt}>Set</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={() => startClock(gameId)} disabled={game.status === 'ended'}>
          <Text style={styles.smallBtnTxt}>Start</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={() => stopClock(gameId)} disabled={game.status === 'ended'}>
          <Text style={styles.smallBtnTxt}>Stop</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.smallBtn}
          onPress={() => resetClockSeconds(gameId, Number(newClock) || game.clockSeconds)}
          disabled={game.status === 'ended'}
        >
          <Text style={styles.smallBtnTxt}>Reset</Text>
        </TouchableOpacity>
      </View>

      {/* Scores for current challenge with win highlight */}
      <View style={styles.scoreRow}>
        <Text style={[styles.sideScore, won?.team === 'A' ? styles.winScore : null]}>{aCh}</Text>
        <View style={styles.centerBlock}>
          <Text style={styles.centerTitle}>Current Challenge</Text>
          <Text style={styles.centerBig}>{aCh} : {bCh}</Text>
          {won && (
            <Text style={styles.winBanner}>
              Team {won.team} won +{won.pointsForWin} — tap Next Challenge when ready
            </Text>
          )}
        </View>
        <Text style={[styles.sideScore, won?.team === 'B' ? styles.winScore : null]}>{bCh}</Text>
      </View>

      {/* Players & shot buttons */}
      <FlatList
        data={players}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => {
          const disabled = !canTap(item.id) || !!won || game.status === 'ended';
          return (
            <View style={[styles.card, item.team === 'A' ? styles.cardA : styles.cardB, disabled && styles.cardDisabled]}>
              <Text style={styles.playerName}>{item.id}</Text>
              <View style={styles.btnRow}>
                {!bonusActive ? (
                  <>
                    {/* MID */}
                    <TouchableOpacity style={[styles.btn, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'mid', true)}>
                      <Text style={styles.btnTxt}>Mid ✓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btnAlt, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'mid', false)}>
                      <Text style={styles.btnAltTxt}>Mid ✗</Text>
                    </TouchableOpacity>

                    {/* LONG */}
                    <TouchableOpacity style={[styles.btn, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'long', true)}>
                      <Text style={styles.btnTxt}>Long ✓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btnAlt, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'long', false)}>
                      <Text style={styles.btnAltTxt}>Long ✗</Text>
                    </TouchableOpacity>

                    {/* GAMECHANGER */}
                    <TouchableOpacity style={[styles.btnGC, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'gamechanger', true)}>
                      <Text style={styles.btnTxt}>GC ✓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btnAlt, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'gamechanger', false)}>
                      <Text style={styles.btnAltTxt}>GC ✗</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    {/* BONUS (Bonus Round only) */}
                    <TouchableOpacity style={[styles.btn, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'bonus', true)}>
                      <Text style={styles.btnTxt}>Bonus ✓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btnAlt, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'bonus', false)}>
                      <Text style={styles.btnAltTxt}>Bonus ✗</Text>
                    </TouchableOpacity>

                    {/* GAMECHANGER (still available in Bonus) */}
                    <TouchableOpacity style={[styles.btnGC, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'gamechanger', true)}>
                      <Text style={styles.btnTxt}>GC ✓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btnAlt, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'gamechanger', false)}>
                      <Text style={styles.btnAltTxt}>GC ✗</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text>No players on this game.</Text>}
      />

      {/* Next challenge button only when we have a winner */}
      {won && game.status !== 'ended' && (
        <TouchableOpacity style={styles.nextBtn} onPress={doAdvance}>
          <Text style={styles.nextTxt}>Next Challenge</Text>
        </TouchableOpacity>
      )}

      {/* END GAME (main tracker only) */}
      {isMain && (
        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: '#b00020', marginTop: 10 }]}
          onPress={onEndGame}
        >
          <Text style={styles.nextTxt}>{game.status === 'ended' ? 'View Box Score' : 'End Game'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/* -------- clock helpers -------- */
const computeDisplayedSeconds = (clockSeconds, running, lastStartAt) => {
  const base = Number(clockSeconds || 0);
  if (!running || !lastStartAt) return base;
  const lastMs = lastStartAt.toMillis ? lastStartAt.toMillis() : Date.parse(lastStartAt);
  const elapsed = Math.max(0, Math.floor((Date.now() - lastMs) / 1000));
  return Math.max(0, base - elapsed);
};

const formatClock = (sec) => {
  if (!Number.isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/* -------- styles -------- */
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, padding: 12, backgroundColor: 'white' },
  h1: { fontSize: 20, fontWeight: '800' },
  meta: { color: '#666', marginBottom: 6 },

  panel: { borderWidth: 1, borderColor: '#eee', borderRadius: 10, padding: 10, marginBottom: 10 },
  panelTitle: { fontWeight: '800', marginBottom: 6 },
  lockRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  lockLabel: { width: 100, color: '#333' },
  lockVal: { flex: 1, color: '#555' },
  trackerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  joinRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },

  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ddd', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, minWidth: 110 },

  undo: { backgroundColor: '#111', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  moneyToggle: { backgroundColor: '#eee', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginRight: 10 },
  moneyToggleOn: { backgroundColor: '#0a0' },
  moneyTxt: { color: '#111', fontWeight: '700' },

  bonusToggleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bonusLabel: { color: '#111', fontWeight: '700', marginRight: 6 },

  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 6 },
  sideScore: { fontSize: 28, fontWeight: '800', width: 64, textAlign: 'center' },
  winScore: { color: '#0a0' },
  centerBlock: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  centerTitle: { color: '#666', fontSize: 12 },
  centerBig: { fontSize: 32, fontWeight: '800' },
  winBanner: { marginTop: 6, color: '#0a0', fontWeight: '700' },

  card: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 12, marginBottom: 12 },
  cardA: { backgroundColor: 'rgba(80, 140, 255, 0.05)' },
  cardB: { backgroundColor: 'rgba(255, 140, 80, 0.05)' },
  cardDisabled: { opacity: 0.45 },
  playerName: { fontWeight: '700', marginBottom: 8 },

  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: { backgroundColor: '#0a0', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginRight: 8, marginBottom: 8 },
  btnGC: { backgroundColor: '#a50', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginRight: 8, marginBottom: 8 },
  btnAlt: { backgroundColor: '#eee', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginRight: 8, marginBottom: 8 },
  btnTxt: { color: 'white', fontWeight: '700' },
  btnAltTxt: { color: '#111', fontWeight: '700' },

  smallBtn: { backgroundColor: '#111', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  smallBtnTxt: { color: 'white', fontWeight: '700' },
  disabled: { opacity: 0.4 },

  nextBtn: { marginTop: 8, backgroundColor: '#111', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  nextTxt: { color: 'white', fontWeight: '800' }
});
