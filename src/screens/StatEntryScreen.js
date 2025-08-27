// src/screens/StatEntryScreen.js
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, TextInput, Switch } from 'react-native';
import { db, auth } from '../services/firebase';
import { doc, onSnapshot, collection, query, orderBy, onSnapshot as onSnapCol, updateDoc, where } from 'firebase/firestore';
import { setPaused, toggleFlipSides } from '../services/gameService';
import CameraStatusBar from '../components/CameraStatusBar';
import { startAutoCoordinator, setAutoMode } from '../services/autoTrackingService';

import {
  logShot,
  deleteLogAndReverse,
  advanceToNextChallenge,
  setClockSeconds,
  startClock,
  stopClock,
  resetClockSeconds,
  startBonusMode,
  endBonusMode,
  listenMyTrackerAssignment,
  listenTrackers,
  heartbeat,
  leaveTracking,
  joinAsTracker,
  tryClaimTeam,
  setTeamLock,
  endGame,
} from '../services/gameService';

/* -------- helpers (no hooks) -------- */
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
const buildLastByPlayer = (logs) => {
  const map = {};
  for (const l of logs) {
    if (l?.playerId && typeof l.made === 'boolean' && !map[l.playerId]) {
      map[l.playerId] = l; // newest->oldest
    }
  }
  return map;
};

export default function StatEntryScreen({ route, navigation }) {
  const { gameId } = route.params || {};
  const uid = auth.currentUser?.uid;

  // ------ state/hooks (keep order stable) ------
  const [game, setGame] = useState(null);
  const [logs, setLogs] = useState([]);
  const [moneyballArmed, setMoneyballArmed] = useState(false);

  const [tick, setTick] = useState(0);
  const [newClock, setNewClock] = useState('');

  const [myTrack, setMyTrack] = useState(null);
  const [trackers, setTrackers] = useState([]);

  const [assignOpen, setAssignOpen] = useState(true);

  // freestyle inputs
  const [fsTarget, setFsTarget] = useState('');
  const [fsWorth, setFsWorth] = useState('');

  // challenge menu UI
  const [challengeMenuOpen, setChallengeMenuOpen] = useState(false);

  // proposals badge
  const [pendingCount, setPendingCount] = useState(0);

  // subscribe to game + logs
  useEffect(() => {
    if (!gameId) return;
    const unsubGame = onSnapshot(doc(db, 'games', gameId), snap => {
      const g = snap.exists() ? { id: snap.id, ...snap.data() } : null;
      setGame(g);

      // initialize freestyle inputs from server if empty (avoid stomping while typing)
      if (g) {
        if (fsTarget === '') {
          const t = Number(g.freestyleTarget);
          setFsTarget(Number.isFinite(t) ? String(t) : '');
        }
        if (fsWorth === '') {
          const w = Number(g.freestyleWorth);
          setFsWorth(Number.isFinite(w) ? String(w) : '');
        }
      }
    });

    const q = query(collection(db, 'games', gameId, 'logs'), orderBy('ts', 'desc'));
    const unsubLogs = onSnapCol(q, s => setLogs(s.docs.map(d => ({ id: d.id, ...d.data() }))));

    // listen pending proposals for badge
    const pq = query(collection(db, 'games', gameId, 'proposals'), where('status', '==', 'pending'));
    const unsubProps = onSnapCol(pq, (s) => setPendingCount(s.size));

    return () => { unsubGame && unsubGame(); unsubLogs && unsubLogs(); unsubProps && unsubProps(); };
  }, [gameId, fsTarget, fsWorth]);

  // subscribe to presence
  useEffect(() => {
    if (!gameId) return;
    const offMine = listenMyTrackerAssignment(gameId, setMyTrack);
    const offAll  = listenTrackers(gameId, setTrackers);
    const hb = setInterval(() => heartbeat(gameId), 5000);
    return () => { offMine && offMine(); offAll && offAll(); clearInterval(hb); leaveTracking(gameId); };
  }, [gameId]);

  // live tick for clock
  useEffect(() => {
    if (!game?.clockRunning || !game?.lastStartAt) return;
    const id = setInterval(() => setTick(t => (t + 1) % 60), 1000);
    return () => clearInterval(id);
  }, [game?.clockRunning, game?.lastStartAt]);

  // start auto coordinator
  useEffect(() => {
    if (!gameId) return;
    const stop = startAutoCoordinator(gameId);
    return () => stop && stop();
  }, [gameId]);

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

  const canTap = (playerId) => {
    if (!game) return false;
    if (game.challengeWon) return false;
    const teamKey = playerTeamKey(playerId);
    if (!teamKey) return false;
    return isMain || (myTrack?.team === teamKey);
  };

  const bonusActive = !!(game?.bonusActive ?? game?.bonusRound ?? false);

  // robust freestyle detection
  const isFreestyle = useMemo(() => {
    if (!game) return false;
    if (game.mode === 'freestyle' || game.freestyle === true) return true;
    if (game.sequenceId === 'freestyle') return true;
    const arr = game.sequenceChallengeIds;
    if (Array.isArray(arr) && arr.length === 0) return true;
    return false;
  }, [game]);

  // derived: last shot by player
  const lastByPlayer = useMemo(() => buildLastByPlayer(logs), [logs]);

  // actions
  const record = async (playerId, shotType, made) => {
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

  const undoLast = async () => {
    try {
      const last = logs.find(l => typeof l.made !== 'undefined');
      if (!last) return Alert.alert('Nothing to undo');
      await deleteLogAndReverse(gameId, last);
    } catch (e) {
      Alert.alert('Undo failed', e.message);
    }
  };

  const doAdvance = async () => {
    try {
      await advanceToNextChallenge(gameId);
      setChallengeMenuOpen(false);
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

  const canJoinA = !lockA || lockA === uid;
  const canJoinB = !lockB || lockB === uid;

  const joinTeam = async (team) => {
    try {
      await joinAsTracker(gameId, team);
      await tryClaimTeam(gameId, team);
    } catch (e) {
      Alert.alert('Assign failed', e.message);
    }
  };

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

  // bonus on/off
  const startBonusRound = async () => {
    try {
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
    if (!isMain) return;
    if (val) await startBonusRound();
    else await endBonusRound();
  };

  // freestyle setters
  const applyFreestyle = async () => {
    try {
      const target = Math.max(0, Number(fsTarget) || 0);
      const worth  = Math.max(0, Number(fsWorth) || 0);
      await updateDoc(doc(db, 'games', gameId), {
        freestyleTarget: target,
        freestyleWorth: worth,
      });
      Alert.alert('Freestyle updated', `Target: ${target} • Worth: ${worth}`);
    } catch (e) {
      Alert.alert('Update failed', e.message);
    }
  };

  // end game -> status ended + navigate to box score
  const endMatchNow = async () => {
    try {
      await endGame(gameId);
      navigation.replace('BoxScoreScreen', { gameId, fromEnded: true });
    } catch (e) {
      Alert.alert('End match failed', e.message);
    }
  };

  // ----- derived -----
  if (!game) {
    return (
      <View style={styles.center}>
        <Text>Loading game...</Text>
      </View>
    );
  }

  const aCh = Number(game.challengeScore?.A ?? 0) || 0;
  const bCh = Number(game.challengeScore?.B ?? 0) || 0;
  const aMatch = Number(game.matchScore?.A ?? 0) || 0;
  const bMatch = Number(game.matchScore?.B ?? 0) || 0;
  const won = game.challengeWon;

  const lastLabel = (l) => {
    if (!l) return '—';
    const t =
      l.shotType === 'gamechanger' ? 'GC'
      : l.shotType === 'bonus' ? 'Bonus' // legacy
      : l.shotType === 'bonus_mid' ? 'B-MR'
      : l.shotType === 'bonus_long' ? 'B-LR'
      : l.shotType === 'bonus_gc' ? 'B-GC'
      : l.shotType === 'mid' ? 'Mid'
      : l.shotType === 'long' ? 'Long'
      : l.shotType || 'Shot';
    const mb = l.moneyball ? '$ ' : '';
    return `${mb}${t} ${l.made ? '✓' : '✗'}`;
  };

  // challenge indices for menu
  const totalChallenges = Array.isArray(game.sequenceChallengeIds) ? game.sequenceChallengeIds.length : 0;
  const currIdx = Number(game.currentChallengeIndex ?? 0);
  const nextIdx = currIdx + 1 < totalChallenges ? currIdx + 1 : null;

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Stat Entry</Text>

      {/* Top meta line */}
      <Text style={styles.meta}>
        Challenge {Number(game.currentChallengeIndex) + 1} • Match {aMatch} - {bMatch} {game.paused ? '• PAUSED' : ''}
      </Text>

      {/* Camera readiness & Auto-mode config */}
      <CameraStatusBar
        gameId={gameId}
        onAddCamera={() => navigation.navigate('CameraRegistration', { gameId })}
      />
      <AutoModePanel game={game} gameId={gameId} navigation={navigation} />

      {game.paused && (
        <View style={styles.pausedBanner}>
          <Text style={styles.pausedTxt}>PAUSED — Dispute Mode (auto ingest disabled)</Text>
        </View>
      )}

      {/* Top control bar: Moneyball + Flip + Bonus + Undo + Review Queue + Pause/Dispute + End Match */}
      <View style={[styles.row, { marginBottom: 6, flexWrap: 'wrap', gap: 8 }]}>
        {!bonusActive && (
          <TouchableOpacity
            onPress={() => setMoneyballArmed(v => !v)}
            style={[styles.moneyToggle, moneyballArmed && styles.moneyToggleOn]}
          >
            <Text style={styles.moneyTxt}>{moneyballArmed ? 'Moneyball ARMED' : 'Moneyball OFF'}</Text>
          </TouchableOpacity>
        )}

        <View style={{ flex: 1 }} />

        {/* Global Flip Sides (affects CastingDisplay) */}
        <TouchableOpacity
          onPress={() => toggleFlipSides(gameId).catch(e => Alert.alert('Flip failed', e.message))}
          style={styles.smallBtn}
        >
          <Text style={styles.smallBtnTxt}>Flip Sides</Text>
        </TouchableOpacity>

        <View style={styles.bonusToggleWrap}>
          <Text style={styles.bonusLabel}>{bonusActive ? 'Bonus ON' : 'Bonus OFF'}</Text>
          <Switch value={bonusActive} onValueChange={toggleBonus} disabled={!isMain} />
        </View>

        <TouchableOpacity onPress={undoLast} style={[styles.undo]}>
          <Text style={{ color: 'white', fontWeight: '700' }}>Undo</Text>
        </TouchableOpacity>

        {/* Review Queue with pending badge */}
        <TouchableOpacity
          onPress={() => navigation.navigate('ReviewQueueScreen', { gameId })}
          style={[styles.smallBtn, { position: 'relative' }]}
        >
          <Text style={styles.smallBtnTxt}>Review Queue</Text>
          {!!pendingCount && (
            <View style={styles.badge}>
              <Text style={styles.badgeTxt}>{pendingCount}</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Pause / Dispute toggle */}
        <TouchableOpacity
          onPress={() => setPaused(gameId, !game?.paused).catch(e => Alert.alert('Pause failed', e.message))}
          style={[
            styles.smallBtn,
            { backgroundColor: game?.paused ? '#0a0' : '#b80' }
          ]}
        >
          <Text style={styles.smallBtnTxt}>{game?.paused ? 'Resume' : 'Pause / Dispute'}</Text>
        </TouchableOpacity>

        {isMain && (
          <TouchableOpacity onPress={endMatchNow} style={[styles.endBtn]}>
            <Text style={styles.endTxt}>End Match</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Clock controls */}
      <View style={[styles.row, { marginBottom: 8 }]}>
        <Text style={{ fontWeight: '700' }}>Clock:</Text>
        <Text style={{ marginLeft: 8 }}>
          {formatClock(computeDisplayedSeconds(game.clockSeconds, game.clockRunning, game.lastStartAt))}
          {game.clockRunning ? ' (running)' : ' (stopped)'}
        </Text>
      </View>

      <View style={[styles.row, { marginBottom: 12, gap: 8, flexWrap: 'wrap' }]}>
        <TextInput
          placeholder="Set seconds"
          value={newClock}
          onChangeText={setNewClock}
          keyboardType="numeric"
          style={styles.input}
        />
        <TouchableOpacity style={styles.smallBtn} onPress={doSetClock}><Text style={styles.smallBtnTxt}>Set</Text></TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={() => startClock(gameId)} disabled={game?.paused}><Text style={styles.smallBtnTxt}>Start</Text></TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={() => stopClock(gameId)}><Text style={styles.smallBtnTxt}>Stop</Text></TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={() => resetClockSeconds(gameId, Number(newClock) || game.clockSeconds)}><Text style={styles.smallBtnTxt}>Reset</Text></TouchableOpacity>

        {/* Challenge Menu */}
        <TouchableOpacity
          style={[styles.smallBtn, { marginLeft: 6 }]}
          onPress={() => setChallengeMenuOpen(v => !v)}
        >
          <Text style={styles.smallBtnTxt}>Challenge ▾</Text>
        </TouchableOpacity>
      </View>

      {/* Auto Mode toggle summary (main only) */}
      {isMain && (
        <View style={[styles.row, { marginBottom: 10, alignItems: 'center' }]}>
          <Text style={{ fontWeight: '700', marginRight: 8 }}>Auto Mode:</Text>
          <Switch
            value={!!game?.autoMode?.enabled}
            onValueChange={(v)=>setAutoMode(gameId, {
              enabled: v,
              ingestThreshold: game?.autoMode?.ingestThreshold ?? 0.85,
              reviewThreshold: game?.autoMode?.reviewThreshold ?? 0.65
            })}
          />
          <Text style={{ marginLeft: 10, color: '#666' }}>
            ingest≥{Math.round((game?.autoMode?.ingestThreshold ?? 0.85)*100)}% • review≥{Math.round((game?.autoMode?.reviewThreshold ?? 0.65)*100)}%
          </Text>
        </View>
      )}

      {/* Challenge Menu (Current / Next / Skip) */}
      {challengeMenuOpen && (
        <View style={styles.menuCard}>
          <Text style={styles.menuTitle}>
            Current: {totalChallenges ? `Challenge ${currIdx + 1} of ${totalChallenges}` : (isFreestyle ? 'Freestyle' : '—')}
          </Text>
          <Text style={styles.menuText}>
            Next: {nextIdx !== null ? `Challenge ${nextIdx + 1} of ${totalChallenges}` : (isFreestyle ? 'Freestyle (N/A)' : '—')}
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={doAdvance}>
            <Text style={styles.primaryBtnTxt}>Skip to Next</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Presence / Locks (collapsible) */}
      <View style={styles.panel}>
        <TouchableOpacity onPress={() => setAssignOpen(v => !v)} style={styles.panelHeader}>
          <Text style={styles.panelTitle}>Trackers & Team Assign</Text>
          <Text style={styles.caret}>{assignOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {assignOpen && (
          <>
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
          </>
        )}
      </View>

      {/* Freestyle controls (robust detection) */}
      {isFreestyle && (
        <View style={[styles.panel, { marginTop: 0 }]}>
          <Text style={styles.panelTitle}>Freestyle — Set Challenge Rules</Text>
          <View style={[styles.row, { gap: 8, flexWrap: 'wrap' }]}>
            <TextInput
              placeholder="Target Score (e.g., 5)"
              value={fsTarget}
              onChangeText={setFsTarget}
              keyboardType="numeric"
              style={[styles.input, { minWidth: 150 }]}
            />
            <TextInput
              placeholder="Points for Win (e.g., 1)"
              value={fsWorth}
              onChangeText={setFsWorth}
              keyboardType="numeric"
              style={[styles.input, { minWidth: 170 }]}
            />
            <TouchableOpacity style={styles.smallBtn} onPress={applyFreestyle}>
              <Text style={styles.smallBtnTxt}>Apply</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ color: '#666', marginTop: 6 }}>
            Current: to {Number(game.freestyleTarget ?? 0)} • worth {Number(game.freestyleWorth ?? 0)}
          </Text>
        </View>
      )}

      {/* Scores (show Match when Bonus) */}
      {!bonusActive ? (
        <View style={styles.scoreRow}>
          <Text style={[styles.sideScore, game.challengeWon?.team === 'A' ? styles.winScore : null]}>{aCh}</Text>
          <View style={styles.centerBlock}>
            <Text style={styles.centerTitle}>Current Challenge</Text>
            <Text style={styles.centerBig}>{aCh} : {bCh}</Text>
          </View>
          <Text style={[styles.sideScore, game.challengeWon?.team === 'B' ? styles.winScore : null]}>{bCh}</Text>
        </View>
      ) : (
        <View style={[styles.scoreRow, { marginTop: 2 }]}>
          <Text style={[styles.sideScore, styles.matchSide]}>{aMatch}</Text>
          <View style={styles.centerBlock}>
            <Text style={styles.centerTitle}>Match (Bonus Round)</Text>
            <Text style={[styles.centerBig, { fontSize: 40 }]}>{aMatch} : {bMatch}</Text>
          </View>
          <Text style={[styles.sideScore, styles.matchSide]}>{bMatch}</Text>
        </View>
      )}

      {/* Players & shot buttons */}
      <FlatList
        data={players}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => {
          const disabled = !canTap(item.id) || !!won;
          const last = lastByPlayer[item.id];
          return (
            <View style={[styles.card, item.team === 'A' ? styles.cardA : styles.cardB, disabled && styles.cardDisabled]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={styles.playerName}>{item.id}</Text>
                <Text style={styles.lastShotTag}>Last: {last ? lastLabel(last) : '—'}</Text>
              </View>

              <View style={styles.btnRow}>
                {!bonusActive ? (
                  <>
                    <TouchableOpacity style={[styles.btn, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'mid', true)}>
                      <Text style={styles.btnTxt}>Mid ✓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btnAlt, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'mid', false)}>
                      <Text style={styles.btnAltTxt}>Mid ✗</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.btn, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'long', true)}>
                      <Text style={styles.btnTxt}>Long ✓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btnAlt, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'long', false)}>
                      <Text style={styles.btnAltTxt}>Long ✗</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.btnGC, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'gamechanger', true)}>
                      <Text style={styles.btnTxt}>GC ✓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btnAlt, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'gamechanger', false)}>
                      <Text style={styles.btnAltTxt}>GC ✗</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    {/* Bonus round specific buttons */}
                    <TouchableOpacity style={[styles.btn, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'bonus_mid', true)}>
                      <Text style={styles.btnTxt}>B-MR ✓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btnAlt, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'bonus_mid', false)}>
                      <Text style={styles.btnAltTxt}>B-MR ✗</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.btn, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'bonus_long', true)}>
                      <Text style={styles.btnTxt}>B-LR ✓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btnAlt, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'bonus_long', false)}>
                      <Text style={styles.btnAltTxt}>B-LR ✗</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.btnGC, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'bonus_gc', true)}>
                      <Text style={styles.btnTxt}>B-GC ✓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btnAlt, disabled && styles.disabled]} disabled={disabled} onPress={() => record(item.id, 'bonus_gc', false)}>
                      <Text style={styles.btnAltTxt}>B-GC ✗</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text>No players on this game.</Text>}
      />

      {/* Bottom actions */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {won && (
          <TouchableOpacity style={[styles.nextBtn, { flex: 1 }]} onPress={doAdvance}>
            <Text style={styles.nextTxt}>Next Challenge</Text>
          </TouchableOpacity>
        )}
        {isMain && (
          <TouchableOpacity style={[styles.endBtn, { flex: 1 }]} onPress={endMatchNow}>
            <Text style={styles.endTxt}>End Match</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function AutoModePanel({ game, gameId, navigation }) {
  const [enabled, setEnabled] = useState(!!game?.autoMode?.enabled);
  const [ingest, setIngest] = useState(String(game?.autoMode?.ingestThreshold ?? 0.85));
  const [review, setReview] = useState(String(game?.autoMode?.reviewThreshold ?? 0.65));
  useEffect(() => {
    setEnabled(!!game?.autoMode?.enabled);
    setIngest(String(game?.autoMode?.ingestThreshold ?? 0.85));
    setReview(String(game?.autoMode?.reviewThreshold ?? 0.65));
  }, [game?.autoMode]);

  const save = async () => {
    const i = Math.max(0, Math.min(1, Number(ingest) || 0.85));
    const r = Math.max(0, Math.min(1, Number(review) || 0.65));
    if (r > i) {
      Alert.alert('Invalid thresholds', 'Review threshold must be ≤ ingest threshold.');
      return;
    }
    try {
      await setAutoMode(gameId, { enabled, ingestThreshold: i, reviewThreshold: r, gateByClock: true });
      Alert.alert('Saved', 'Auto-Mode settings updated.');
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  };

  return (
    <View style={{ borderWidth:1, borderColor:'#eee', borderRadius:10, padding:10, backgroundColor:'#fafafa', marginBottom:10 }}>
      <Text style={{ fontWeight:'800', marginBottom:8 }}>Auto-Mode</Text>
      <View style={{ flexDirection:'row', alignItems:'center', gap:8, marginBottom:8 }}>
        <Text style={{ fontWeight:'700' }}>Enabled</Text>
        <Switch value={enabled} onValueChange={setEnabled} />
        <View style={{ flex:1 }} />
        <TouchableOpacity
          style={{ backgroundColor:'#111', paddingVertical:6, paddingHorizontal:10, borderRadius:8 }}
          onPress={() => navigation.navigate('ReviewQueueScreen', { gameId })}
        >
          <Text style={{ color:'#fff', fontWeight:'700' }}>Open Review Queue</Text>
        </TouchableOpacity>
      </View>
      <View style={{ flexDirection:'row', gap:8 }}>
        <View style={{ flex:1 }}>
          <Text style={{ fontWeight:'700', marginBottom:4 }}>Ingest ≥</Text>
          <TextInput style={{ borderWidth:1, borderColor:'#ddd', borderRadius:8, paddingHorizontal:10, paddingVertical:6 }}
            value={ingest} onChangeText={setIngest} placeholder="0.85" keyboardType="decimal-pad" />
        </View>
        <View style={{ flex:1 }}>
          <Text style={{ fontWeight:'700', marginBottom:4 }}>Review ≥</Text>
          <TextInput style={{ borderWidth:1, borderColor:'#ddd', borderRadius:8, paddingHorizontal:10, paddingVertical:6 }}
            value={review} onChangeText={setReview} placeholder="0.65" keyboardType="decimal-pad" />
        </View>
        <View style={{ alignItems:'center', justifyContent:'flex-end' }}>
          <TouchableOpacity onPress={save} style={{ backgroundColor:'#111', paddingVertical:10, paddingHorizontal:14, borderRadius:10 }}>
            <Text style={{ color:'#fff', fontWeight:'900' }}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>
      <Text style={{ color:'#666', marginTop:6, fontSize:12 }}>
        Clock gating is always ON: auto events are ignored unless the clock is running and game status is “live”.
      </Text>
    </View>
  );
}

/* -------- styles -------- */
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, padding: 12, backgroundColor: 'white' },
  h1: { fontSize: 20, fontWeight: '800' },
  meta: { color: '#666', marginBottom: 6 },

  pausedBanner: { backgroundColor: '#fde68a', borderColor: '#f59e0b', borderWidth: 1, padding: 8, borderRadius: 8, marginBottom: 8 },
  pausedTxt: { color: '#7c2d12', fontWeight: '800', textAlign: 'center' },

  badge: { position: 'absolute', top: -6, right: -6, backgroundColor: '#ef4444', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, minWidth: 20, alignItems: 'center' },
  badgeTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },

  menuCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e5e5e5', marginBottom: 10 },
  menuTitle: { fontWeight: '800', marginBottom: 6, fontSize: 16 },
  menuText: { marginBottom: 12 },
  primaryBtn: { backgroundColor: '#111', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10 },
  primaryBtnTxt: { color: '#fff', fontWeight: '900' },

  panel: { borderWidth: 1, borderColor: '#eee', borderRadius: 10, padding: 10, marginBottom: 10, backgroundColor: '#fafafa' },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelTitle: { fontWeight: '800' },
  caret: { fontWeight: '900', fontSize: 16 },
  lockRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  lockLabel: { width: 100, color: '#333' },
  lockVal: { flex: 1, color: '#555' },
  trackerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 8 },
  joinRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 },

  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ddd', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, minWidth: 110, backgroundColor: 'white' },

  undo: { backgroundColor: '#111', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  moneyToggle: { backgroundColor: '#eee', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginRight: 10 },
  moneyToggleOn: { backgroundColor: '#0a0' },
  moneyTxt: { color: '#111', fontWeight: '700' },

  bonusToggleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bonusLabel: { color: '#111', fontWeight: '700', marginRight: 6 },

  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 6 },
  sideScore: { fontSize: 28, fontWeight: '800', width: 64, textAlign: 'center' },
  matchSide: { color: '#111' },
  winScore: { color: '#0a0' },
  centerBlock: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  centerTitle: { color: '#666', fontSize: 12 },
  centerBig: { fontSize: 32, fontWeight: '800' },

  card: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 12, marginBottom: 12, backgroundColor: 'white' },
  cardA: { backgroundColor: 'rgba(80, 140, 255, 0.05)' },
  cardB: { backgroundColor: 'rgba(255, 140, 80, 0.05)' },
  cardDisabled: { opacity: 0.45 },
  playerName: { fontWeight: '700' },
  lastShotTag: { fontSize: 12, color: '#444' },

  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  btn: { backgroundColor: '#0a0', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginRight: 8, marginBottom: 8 },
  btnGC: { backgroundColor: '#a50', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginRight: 8, marginBottom: 8 },
  btnAlt: { backgroundColor: '#eee', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginRight: 8, marginBottom: 8 },
  btnTxt: { color: 'white', fontWeight: '700' },
  btnAltTxt: { color: '#111', fontWeight: '700' },

  smallBtn: { backgroundColor: '#111', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  smallBtnTxt: { color: 'white', fontWeight: '700' },
  disabled: { opacity: 0.4 },

  nextBtn: { marginTop: 8, backgroundColor: '#111', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  nextTxt: { color: 'white', fontWeight: '800' },

  endBtn: { backgroundColor: '#b00', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center' },
  endTxt: { color: 'white', fontWeight: '800' },
});
