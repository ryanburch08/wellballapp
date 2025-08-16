// src/screens/CastingDisplay.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity, SafeAreaView, useWindowDimensions
} from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { db, auth } from '../services/firebase';
import {
  doc, onSnapshot, collection, query, orderBy, onSnapshot as onSnapCol, updateDoc
} from 'firebase/firestore';

const COLOR_PALETTE = [
  { key: 'orange', bg: '#FF7A00', fg: '#000' },
  { key: 'black',  bg: '#111111', fg: '#fff' },
  { key: 'blue',   bg: '#246BFD', fg: '#fff' },
  { key: 'red',    bg: '#E03131', fg: '#fff' },
  { key: 'green',  bg: '#1D9A6C', fg: '#fff' },
  { key: 'purple', bg: '#6F48FF', fg: '#fff' },
];

const AVATAR_PLACEHOLDER =
  'https://dummyimage.com/120x120/cccccc/ffffff.png&text=%20'; // blank for now

export default function CastingDisplay({ route }) {
  const { gameId } = route.params || {};

  // state
  const [game, setGame] = useState(null);
  const [logs, setLogs] = useState([]);
  const [challenge, setChallenge] = useState(null);
  const [wins, setWins] = useState([]);

  const uid = auth.currentUser?.uid || null;
  const isMain = !!uid && uid === game?.roles?.main;

  const { width, height } = useWindowDimensions();

  // -------- Orientation lock: landscape on enter, portrait on exit --------
  useEffect(() => {
    (async () => {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_LEFT);
      } catch (e) {
        console.warn('Orientation lock to landscape failed:', e?.message || e);
      }
    })();
    return () => {
      (async () => {
        try {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        } catch (e) {
          console.warn('Orientation lock back to portrait failed:', e?.message || e);
        }
      })();
    };
  }, []);

  // --- subscriptions (game + logs) ---
  useEffect(() => {
    if (!gameId) return;
    const offGame = onSnapshot(doc(db, 'games', gameId), snap => {
      if (snap.exists()) setGame({ id: snap.id, ...snap.data() });
    });
    const qLogs = query(collection(db, 'games', gameId, 'logs'), orderBy('ts', 'desc'));
    const offLogs = onSnapCol(qLogs, s => {
      const arr = s.docs.map(d => ({ id: d.id, ...d.data() }));
      setLogs(arr);
      setWins(arr.filter(l => l.type === 'challenge_win'));
    });
    return () => { offGame && offGame(); offLogs && offLogs(); };
  }, [gameId]);

  // Current challenge doc (safe when game is null)
  useEffect(() => {
    const idx = Number(game?.currentChallengeIndex ?? -1);
    const id = game?.sequenceChallengeIds?.[idx];
    if (!id) { setChallenge(null); return; }
    const off = onSnapshot(doc(db, 'challenges', id), snap => {
      setChallenge(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    return () => off && off();
  }, [game?.currentChallengeIndex, game?.sequenceChallengeIds]);

  // --- stats aggregates from logs (ALWAYS call hooks; handle null data inside) ---
  const attemptLogs = useMemo(
    () => logs.filter(l => typeof l.made === 'boolean' && l.playerId && l.team),
    [logs]
  );

  const perPlayer = useMemo(() => {
    const map = {};
    for (const l of attemptLogs) {
      const pid = l.playerId;
      if (!map[pid]) map[pid] = { team: l.team, makes: 0, misses: 0, moneyballMakes: 0 };
      if (l.made) {
        map[pid].makes += 1;
        if (l.moneyball) map[pid].moneyballMakes += 1;
      } else {
        map[pid].misses += 1;
      }
    }
    return map;
  }, [attemptLogs]);

  const perTeam = useMemo(() => {
    const agg = {
      A: { makes: 0, misses: 0, moneyballMakes: 0, wins: 0 },
      B: { makes: 0, misses: 0, moneyballMakes: 0, wins: 0 },
    };
    for (const l of attemptLogs) {
      if (!agg[l.team]) continue;
      if (l.made) {
        agg[l.team].makes += 1;
        if (l.moneyball) agg[l.team].moneyballMakes += 1;
      } else {
        agg[l.team].misses += 1;
      }
    }
    for (const w of wins) {
      if (agg[w.team]) agg[w.team].wins += 1;
    }
    return agg;
  }, [attemptLogs, wins]);

  // --- helpers that don't use hooks ---
  const pct = (m, x) => {
    const att = m + x;
    if (att <= 0) return '—';
    return Math.round((m / att) * 100) + '%';
  };

  const computeDisplayedSeconds = (clockSeconds, running, lastStartAt) => {
    const base = Number(clockSeconds || 0);
    if (!running || !lastStartAt) return base;
    const lastMs = lastStartAt?.toMillis ? lastStartAt.toMillis() : Date.parse(lastStartAt);
    const elapsed = Math.max(0, Math.floor((Date.now() - lastMs) / 1000));
    return Math.max(0, base - elapsed);
  };
  const formatClock = (sec) => {
    if (!Number.isFinite(sec)) return '--:--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // ----- from here down, safe to early-return if game hasn't loaded -----
  if (!game) {
    return (
      <SafeAreaView style={[styles.fill, styles.center, { backgroundColor: '#000' }]}>
        <Text style={{ color: '#fff' }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  // --- display state ---
  const displaySwap = !!game?.displaySwap;
  const teamColors = game?.teamColors || { A: 'orange', B: 'black' };

  const leftKey  = displaySwap ? 'B' : 'A';
  const rightKey = displaySwap ? 'A' : 'B';

  const teamIds = {
    A: game?.teamAIds || [],
    B: game?.teamBIds || [],
  };

  // --- clock & scores ---
  const clockSec = computeDisplayedSeconds(game?.clockSeconds, game?.clockRunning, game?.lastStartAt);
  const clockTxt = formatClock(clockSec);

  const matchA = Number(game?.matchScore?.A ?? 0) || 0;
  const matchB = Number(game?.matchScore?.B ?? 0) || 0;
  const chalA  = Number(game?.challengeScore?.A ?? 0) || 0;
  const chalB  = Number(game?.challengeScore?.B ?? 0) || 0;

  const leftScore  = { match: leftKey === 'A' ? matchA : matchB, chal: leftKey === 'A' ? chalA : chalB };
  const rightScore = { match: rightKey === 'A' ? matchA : matchB, chal: rightKey === 'A' ? chalA : chalB };

  // --- firestore updates (swap/colors) ---
  const colorFor = (teamKey) => {
    const key = (teamColors?.[teamKey] || 'black');
    const found = COLOR_PALETTE.find(c => c.key === key);
    return found || COLOR_PALETTE[1];
  };
  const setSwap = async (val) => {
    if (!isMain) return;
    await updateDoc(doc(db, 'games', gameId), { displaySwap: !!val });
  };
  const setColor = async (teamKey, colorKey) => {
    if (!isMain) return;
    const next = { ...(game?.teamColors || {}) };
    next[teamKey] = colorKey;
    await updateDoc(doc(db, 'games', gameId), { teamColors: next });
  };

  // --- layout math to fit players without scrolling ---
  const TOP_BAR_H = 56;
  const SIDE_PADDING_V = 8 + 8;
  const HEADER_H = 48;
  const FOOTER_H = 34;
  const PLAYER_GAP = 8;
  const usableSideHeight = Math.max(
    120,
    height - TOP_BAR_H - SIDE_PADDING_V - HEADER_H - FOOTER_H
  );

  const rowsLeft = Math.max(1, teamIds[leftKey].length);
  const rowsRight = Math.max(1, teamIds[rightKey].length);

  const rowHeightLeft = Math.floor((usableSideHeight - PLAYER_GAP * (rowsLeft - 1)) / rowsLeft);
  const rowHeightRight = Math.floor((usableSideHeight - PLAYER_GAP * (rowsRight - 1)) / rowsRight);

  const makeRow = (pid, rowH) => {
    const s = perPlayer[pid] || { makes: 0, misses: 0 };
    const fg = pct(s.makes, s.misses);
    const avatarSize = Math.max(22, Math.min(36, Math.floor(rowH * 0.6)));
    const nameSize = Math.max(10, Math.min(16, Math.floor(rowH * 0.32)));
    const statsSize = Math.max(9, Math.min(13, Math.floor(rowH * 0.26)));
    return (
      <View key={pid} style={[styles.playerRow, { height: rowH, marginBottom: PLAYER_GAP }]}>
        <Image source={{ uri: AVATAR_PLACEHOLDER }} style={{ width: avatarSize, height: avatarSize, borderRadius: avatarSize/2, marginRight: 8, backgroundColor: '#333' }} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: nameSize }} numberOfLines={1}>{pid}</Text>
          <Text style={{ color: '#ddd', fontWeight: '700', fontSize: statsSize }} numberOfLines={1}>
            FG {fg} • {s.makes}/{s.misses}
          </Text>
        </View>
      </View>
    );
  };

  const leftColor  = colorFor(leftKey);
  const rightColor = colorFor(rightKey);

  return (
    <SafeAreaView style={styles.root}>
      {/* TOP BAR: centered match time; swap on right for main */}
      <View style={styles.topBar}>
        <View style={{ width: 140 }} />
        <Text style={styles.topClock}>{clockTxt}</Text>
        <View style={styles.topRight}>
          {isMain && (
            <TouchableOpacity onPress={() => setSwap(!game?.displaySwap)} style={styles.swapBtn}>
              <Text style={styles.swapTxt}>Swap Sides</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.landRow}>
        {/* LEFT TEAM COLUMN */}
        <View style={styles.sideCol}>
          <TeamHeader
            teamKey={leftKey}
            color={leftColor}
            isMain={isMain}
            onPickColor={(key) => setColor(leftKey, key)}
            align="left"
            compact
          />
          <View style={{ height: usableSideHeight }}>
            {teamIds[leftKey].map(pid => makeRow(pid, rowHeightLeft))}
          </View>
          <TeamFooter
            color={leftColor}
            makes={perTeam[leftKey]?.makes || 0}
            misses={perTeam[leftKey]?.misses || 0}
            money={perTeam[leftKey]?.moneyballMakes || 0}
            wins={perTeam[leftKey]?.wins || 0}
            pct={pct(perTeam[leftKey]?.makes || 0, perTeam[leftKey]?.misses || 0)}
            align="left"
          />
        </View>

        {/* CENTER STACK */}
        <View style={styles.centerCol}>
          <Text style={styles.sectionTitle}>
            {challenge?.name ? `Challenge: ${challenge.name}` : 'Challenge Score'}
          </Text>
          <View style={styles.scoreRow}>
            <Text style={styles.challengeScore}>{leftScore.chal}</Text>
            <Text style={styles.vs}>:</Text>
            <Text style={styles.challengeScore}>{rightScore.chal}</Text>
          </View>
          <Text style={styles.challengeMeta}>
            To {challenge?.targetScore ?? '—'} • Worth {challenge?.pointsForWin ?? '—'}
          </Text>

          <View style={{ height: 12 }} />

          <Text style={styles.sectionTitle}>Match Score</Text>
          <View style={styles.scoreRow}>
            <Text style={styles.matchScore}>{leftScore.match}</Text>
            <Text style={styles.vs}>:</Text>
            <Text style={styles.matchScore}>{rightScore.match}</Text>
          </View>
        </View>

        {/* RIGHT TEAM COLUMN */}
        <View style={styles.sideCol}>
          <TeamHeader
            teamKey={rightKey}
            color={rightColor}
            isMain={isMain}
            onPickColor={(key) => setColor(rightKey, key)}
            align="right"
            compact
          />
          <View style={{ height: usableSideHeight }}>
            {teamIds[rightKey].map(pid => makeRow(pid, rowHeightRight))}
          </View>
          <TeamFooter
            color={rightColor}
            makes={perTeam[rightKey]?.makes || 0}
            misses={perTeam[rightKey]?.misses || 0}
            money={perTeam[rightKey]?.moneyballMakes || 0}
            wins={perTeam[rightKey]?.wins || 0}
            pct={pct(perTeam[rightKey]?.makes || 0, perTeam[rightKey]?.misses || 0)}
            align="right"
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

/* ----- Subcomponents ----- */
function TeamHeader({ teamKey, color, isMain, onPickColor, align = 'left', compact = false }) {
  return (
    <View style={[styles.teamHeader, { backgroundColor: color.bg }, compact && { paddingVertical: 8 }]}>
      <Text style={[styles.teamTitle, { color: color.fg, textAlign: align }]}>Team {teamKey}</Text>
      {isMain && (
        <View style={[styles.paletteRow, compact && { marginTop: 6 }]}>
          {COLOR_PALETTE.map(c => (
            <TouchableOpacity
              key={c.key}
              style={[
                styles.paletteSwatch,
                { backgroundColor: c.bg, borderColor: c.key === 'black' ? '#666' : 'transparent' },
                compact && { width: 10, height: 10, borderRadius: 2, marginRight: 4 }
              ]}
              onPress={() => onPickColor(c.key)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function TeamFooter({ color, makes, misses, money, wins, pct, align = 'left' }) {
  return (
    <View style={[styles.teamFooter, { borderColor: color.bg }]}>
      <Text style={[styles.teamFooterTxt, { textAlign: align }]}>
        Team FG {pct} • {makes}/{misses} • Moneyballs {money} • Challenges Won {wins}
      </Text>
    </View>
  );
}

/* ----- Styles ----- */
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },

  topBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topClock: { color: '#fff', fontSize: 28, fontWeight: '900', textAlign: 'center' },
  topRight: { width: 140, alignItems: 'flex-end' },

  landRow: { flex: 1, flexDirection: 'row' },

  sideCol: { flex: 1.12, paddingVertical: 8, paddingHorizontal: 10 },
  centerCol: { flex: 1.76, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },

  teamHeader: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8 },
  teamTitle: { fontSize: 20, fontWeight: '900', letterSpacing: 1, color: '#fff' },

  paletteRow: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap' },
  paletteSwatch: { width: 18, height: 18, borderRadius: 4, marginRight: 6, borderWidth: 1 },

  playerRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10,
    paddingHorizontal: 8,
  },

  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 0.5, textAlign: 'center' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22, marginTop: 6 },
  challengeScore: { color: '#ddd', fontSize: 52, fontWeight: '900' },
  matchScore: { color: '#fff', fontSize: 100, fontWeight: '900', lineHeight: 104 },
  vs: { color: '#aaa', fontSize: 36, fontWeight: '900' },

  teamFooter: { borderTopWidth: 2, paddingTop: 6, marginTop: 6 },
  teamFooterTxt: { color: '#fff', fontWeight: '800', fontSize: 13.5, opacity: 0.95 },

  swapBtn: {
    backgroundColor: '#222', paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 8, borderWidth: 1, borderColor: '#555'
  },
  swapTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },
});
