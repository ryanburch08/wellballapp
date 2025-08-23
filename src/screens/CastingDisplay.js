// src/screens/CastingDisplay.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, Image } from 'react-native';
import { db } from '../services/firebase';
import { doc, onSnapshot, collection, query, orderBy, onSnapshot as onSnapCol, updateDoc } from 'firebase/firestore';
import * as ScreenOrientation from 'expo-screen-orientation';

/* ---------------- constants ---------------- */
const AVATAR = 'https://dummyimage.com/240x360/cccccc/ffffff.png&text=%20';
const PALETTE = ['#FF6B00', '#000000', '#1F6CFF', '#10B981', '#B30059', '#D97706'];

/* ---------------- helpers ---------------- */
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
const pct = (m, a) => (a > 0 ? Math.round((m / a) * 100) : null);
const pctTxt = (m, a) => (a > 0 ? `${Math.round((m / a) * 100)}%` : '—');

const textOn = (hex) => {
  try {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
    const yiq = (r*299 + g*587 + b*114)/1000;
    return yiq >= 160 ? '#000' : '#fff';
  } catch { return '#fff'; }
};
// lighten/darken base color by amt (-40..40)
const adjust = (hex, amt) => {
  try {
    const h = hex.replace('#','');
    let r = Math.max(0, Math.min(255, parseInt(h.substring(0,2),16) + amt));
    let g = Math.max(0, Math.min(255, parseInt(h.substring(2,4),16) + amt));
    let b = Math.max(0, Math.min(255, parseInt(h.substring(4,6),16) + amt));
    const to2 = (n) => n.toString(16).padStart(2,'0');
    return `#${to2(r)}${to2(g)}${to2(b)}`;
  } catch { return hex; }
};

const buildStats = (logs) => {
  const perPlayer = {};
  const teamMoneyMakes = { A: 0, B: 0 };
  const teamWinners = { A: 0, B: 0 };

  for (const l of logs) {
    if (typeof l.made === 'boolean' && l.playerId && (l.team === 'A' || l.team === 'B')) {
      if (!perPlayer[l.playerId]) {
        perPlayer[l.playerId] = {
          team: l.team,
          total: { m: 0, a: 0 },
          mid: { m: 0, a: 0 },
          long: { m: 0, a: 0 },
          money: { m: 0, a: 0 },
          gamechanger: { m: 0, a: 0 },
          winners: 0,
        };
      }
      const row = perPlayer[l.playerId];
      row.total.a += 1; if (l.made) row.total.m += 1;
      if (l.shotType === 'mid') { row.mid.a++; if (l.made) row.mid.m++; }
      if (l.shotType === 'long') { row.long.a++; if (l.made) row.long.m++; }
      if (l.shotType === 'gamechanger') { row.gamechanger.a++; if (l.made) row.gamechanger.m++; }
      if (l.moneyball) { row.money.a++; if (l.made) { row.money.m++; teamMoneyMakes[l.team]++; } }
    }
    if (l.type === 'challenge_win' && (l.team === 'A' || l.team === 'B')) {
      teamWinners[l.team]++; if (l.byPlayerId && perPlayer[l.byPlayerId]) perPlayer[l.byPlayerId].winners++;
    }
  }
  return { perPlayer, teamMoneyMakes, teamWinners };
};

/* ---------------- component ---------------- */
export default function CastingDisplay({ route }) {
  const { gameId } = route.params || {};
  const [game, setGame] = useState(null);
  const [logs, setLogs] = useState([]);
  const [tick, setTick] = useState(0);            // UI ticking for clock + blinkers
  const [flipped, setFlipped] = useState(false);

  // UI prefs
  const [highContrast, setHighContrast] = useState(false);
  const [detailMode, setDetailMode] = useState(false);

  // team-bound colors (persist through flips)
  const [teamColors, setTeamColors] = useState({ A: '#FF6B00', B: '#000000' });

  // used to guard OT auto-setup so it triggers only once per tie
  const processedOTRef = useRef(-1);

  // orientation lock
  useEffect(() => {
    (async () => { try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } catch {} })();
    return () => { (async () => { try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    } catch {} })(); };
  }, []);

  // subscribe
  useEffect(() => {
    if (!gameId) return;
    const offGame = onSnapshot(doc(db, 'games', gameId), s => setGame(s.exists() ? ({ id: s.id, ...s.data() }) : null));
    const ql = query(collection(db, 'games', gameId, 'logs'), orderBy('ts', 'asc'));
    const offLogs = onSnapCol(ql, s => setLogs(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { offGame && offGame(); offLogs && offLogs(); };
  }, [gameId]);

  // tick every 500ms while we have a running clock OR a winner banner (for blink)
  useEffect(() => {
    const needBlink = !!game?.challengeWon;
    if (!game?.clockRunning && !needBlink) return;
    const id = setInterval(() => setTick(t => (t + 1) % 1000), 500);
    return () => clearInterval(id);
  }, [game?.clockRunning, game?.challengeWon]);

  const secs = computeDisplayedSeconds(game?.clockSeconds, game?.clockRunning, game?.lastStartAt);
  const clockText = formatClock(secs);

  const bonusActive = !!(game?.bonusActive ?? false);

  const challMeta = useMemo(() => {
    if (!game) return { name: '', target: 0, worth: 0 };
    if (game.mode === 'freestyle') {
      return {
        name: 'Freestyle',
        target: Number(game?.freestyle?.targetScore ?? 0) || 0,
        worth: Number(game?.freestyle?.pointsForWin ?? 0) || 0,
      };
    }
    return {
      name: `Challenge ${Number(game.currentChallengeIndex ?? 0) + 1}`,
      target: Number(game?.lastTargetScore ?? 0) || 0,
      worth: Number(game?.lastPointsForWin ?? 1) || 1,
    };
  }, [game]);

  const { perPlayer, teamMoneyMakes, teamWinners } = useMemo(() => buildStats(logs), [logs]);

  const aList = useMemo(
    () => (game?.teamAIds || []).map(pid => ({ pid, ...ensureRow(perPlayer[pid], 'A') })),
    [game?.teamAIds, perPlayer]
  );
  const bList = useMemo(
    () => (game?.teamBIds || []).map(pid => ({ pid, ...ensureRow(perPlayer[pid], 'B') })),
    [game?.teamBIds, perPlayer]
  );

  const totals = (list) => list.reduce((acc, p) => ({ m: acc.m + p.total.m, a: acc.a + p.total.a }), { m: 0, a: 0 });
  const tA = totals(aList);
  const tB = totals(bList);

  const leftKey  = flipped ? 'B' : 'A';
  const rightKey = flipped ? 'A' : 'B';

  const chalA = Number(game?.challengeScore?.A ?? 0) || 0;
  const chalB = Number(game?.challengeScore?.B ?? 0) || 0;
  const matchA = Number(game?.matchScore?.A ?? 0) || 0;
  const matchB = Number(game?.matchScore?.B ?? 0) || 0;

  const chalLeft  = leftKey === 'A' ? chalA : chalB;
  const chalRight = rightKey === 'A' ? chalA : chalB;
  const matchLeft  = leftKey === 'A' ? matchA : matchB;
  const matchRight = rightKey === 'A' ? matchA : matchB;

  const leftRoster  = leftKey === 'A' ? aList : bList;
  const rightRoster = rightKey === 'A' ? aList : bList;
  const leftTotals  = leftKey === 'A' ? tA : tB;
  const rightTotals = rightKey === 'A' ? tA : tB;

  const leftMoneyMakes  = leftKey === 'A' ? teamMoneyMakes.A : teamMoneyMakes.B;
  const rightMoneyMakes = rightKey === 'A' ? teamMoneyMakes.A : teamMoneyMakes.B;
  const leftWinners  = leftKey === 'A' ? teamWinners.A : teamWinners.B;
  const rightWinners = rightKey === 'A' ? teamWinners.A : teamWinners.B;

  const specials = game?.specials || { A: { moneyUsed:false, gcUsed:false }, B: { moneyUsed:false, gcUsed:false } };
  const leftSpecials  = specials[leftKey]  || { moneyUsed:false, gcUsed:false };
  const rightSpecials = specials[rightKey] || { moneyUsed:false, gcUsed:false };

  const colorA = teamColors.A;
  const colorB = teamColors.B;

  const theme = highContrast
    ? { bg:'#000', fg:'#fff', sub:'#ddd', panelBg:'#111', panelBorder:'#333', cellBg:'#0f0f0f', divider:'#222', outline:'#ffffff44' }
    : { bg:'#fff', fg:'#111', sub:'#333', panelBg:'#fafafa', panelBorder:'#eee', cellBg:'#fff', divider:'#eee', outline:'#00000022' };

  const won = game?.challengeWon || null;
  const blinkOn = !!won && (tick % 2 === 0); // blink every 500ms
  const leftIsWinner  = !!won && ((won.team === leftKey));
  const rightIsWinner = !!won && ((won.team === rightKey));

  // BONUS — winner highlight (as soon as clock hits 0)
  const bonusTimeUp = bonusActive && computeDisplayedSeconds(game?.clockSeconds, game?.clockRunning, game?.lastStartAt) <= 0;
  let bonusWinnerSide = null;
  if (bonusTimeUp) {
    if (matchLeft > matchRight) bonusWinnerSide = 'left';
    else if (matchRight > matchLeft) bonusWinnerSide = 'right';
  }

  // ---------------- OVERTIME AUTO-SETUP ----------------
  useEffect(() => {
    if (!game || !bonusActive) return;

    // If we changed games or someone manually reset overtimeCount elsewhere, resync the guard.
    const currentCount = Number(game.overtimeCount ?? 0);
    if (processedOTRef.current < currentCount) {
      processedOTRef.current = currentCount;
    }

    // Trigger OT only when:
    // - Bonus time has reached 0
    // - Match tied
    // - We haven't already processed this exact tie (guarded by processedOTRef)
    const isTie = bonusTimeUp && matchLeft === matchRight;
    if (!isTie) return;

    const alreadyHandled = processedOTRef.current > currentCount;
    if (alreadyHandled) return;

    const nextSecs = currentCount === 0 ? 120 : 60; // first OT 2:00, then 1:00
    (async () => {
      try {
        await updateDoc(doc(db, 'games', gameId), {
          // keep bonusActive true
          clockSeconds: nextSecs,
          clockRunning: false,
          lastStartAt: null,
          overtimeCount: currentCount + 1,
        });
        // bump guard so we don't loop
        processedOTRef.current = currentCount + 1;
      } catch (e) {
        // no Alert in display; fail silently
        console.warn('OT setup failed:', e?.message || e);
      }
    })();
  }, [bonusActive, bonusTimeUp, matchLeft, matchRight, game, gameId]);

  if (!game) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={{ color: theme.fg }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  /* -------------- render -------------- */
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      {/* Top controls */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => setHighContrast(v => !v)} style={[styles.smallBtn, { backgroundColor: highContrast ? '#444' : '#111' }]}>
          <Text style={styles.smallBtnTxt}>{highContrast ? 'Light Mode' : 'High Contrast'}</Text>
        </TouchableOpacity>

        <View style={styles.midTop}>
          <Text style={[styles.clockText, { color: theme.fg }]}>{clockText}</Text>
          <Text style={[styles.meta, { color: theme.fg }]}>{bonusActive ? `BONUS ROUND${Number(game.overtimeCount ?? 0) > 0 ? ` — OT ${game.overtimeCount}` : ''}` : challMeta.name}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={() => setDetailMode(d => !d)} style={[styles.smallBtn, { backgroundColor: '#111' }]}>
            <Text style={styles.smallBtnTxt}>Stats: {detailMode ? 'In-Depth' : 'Basic'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setFlipped(f => !f)} style={[styles.smallBtn, { backgroundColor: '#111' }]}>
            <Text style={styles.smallBtnTxt}>Flip Sides</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Score row (normal vs bonus) */}
      {!bonusActive ? (
        <ScoreRowNormal
          leftKey={leftKey}
          rightKey={rightKey}
          theme={theme}
          colorA={teamColors.A}
          colorB={teamColors.B}
          chalLeft={chalLeft}
          chalRight={chalRight}
          matchLeft={matchLeft}
          matchRight={matchRight}
          leftIsWinner={leftIsWinner}
          rightIsWinner={rightIsWinner}
          blinkOn={blinkOn}
          teamAName={game.teamAName || 'Team A'}
          teamBName={game.teamBName || 'Team B'}
        />
      ) : (
        <ScoreRowBonus
          theme={theme}
          colorLeft={leftKey === 'A' ? teamColors.A : teamColors.B}
          colorRight={rightKey === 'A' ? teamColors.A : teamColors.B}
          teamLeft={leftKey === 'A' ? (game.teamAName || 'Team A') : (game.teamBName || 'Team B')}
          teamRight={rightKey === 'A' ? (game.teamAName || 'Team A') : (game.teamBName || 'Team B')}
          matchLeft={matchLeft}
          matchRight={matchRight}
          bonusWinnerSide={bonusWinnerSide}
        />
      )}

      {/* Team panels */}
      <View style={styles.sidesRow}>
        <TeamPanel
          teamKey={leftKey}
          roster={leftRoster}
          totals={leftTotals}
          moneyMakes={leftMoneyMakes}
          winners={leftWinners}
          specials={game?.specials?.[leftKey]}
          theme={theme}
          accent={leftKey === 'A' ? teamColors.A : teamColors.B}
          onPickColor={(c) => setTeamColors(prev => ({ ...prev, [leftKey]: c }))}
          detailMode={detailMode}
        />
        <TeamPanel
          teamKey={rightKey}
          roster={rightRoster}
          totals={rightTotals}
          moneyMakes={rightMoneyMakes}
          winners={rightWinners}
          specials={game?.specials?.[rightKey]}
          theme={theme}
          accent={rightKey === 'A' ? teamColors.A : teamColors.B}
          onPickColor={(c) => setTeamColors(prev => ({ ...prev, [rightKey]: c }))}
          detailMode={detailMode}
        />
      </View>
    </SafeAreaView>
  );
}

/* ---------------- structured pieces ---------------- */

function ensureRow(row, team) {
  if (row) return row;
  return {
    team, total:{m:0,a:0}, mid:{m:0,a:0}, long:{m:0,a:0}, money:{m:0,a:0}, gamechanger:{m:0,a:0}, winners:0
  };
}

function ScoreRowNormal({
  leftKey, rightKey, theme, colorA, colorB,
  chalLeft, chalRight, matchLeft, matchRight,
  leftIsWinner, rightIsWinner, blinkOn,
  teamAName, teamBName
}) {
  const leftColor = leftKey === 'A' ? colorA : colorB;
  const rightColor = rightKey === 'A' ? colorA : colorB;
  const leftTeamName = leftKey === 'A' ? teamAName : teamBName;
  const rightTeamName = rightKey === 'A' ? teamAName : teamBName;

  return (
    <View style={styles.centerRow}>
      {/* Left match */}
      <View style={styles.matchCol}>
        <Text style={[styles.teamName, { color: theme.sub }]}>{leftTeamName}</Text>
        <View style={[styles.matchBox, { backgroundColor: leftColor, opacity: leftIsWinner && blinkOn ? 0.35 : 1 }]}>
          <Text style={[styles.matchVal, { color: textOn(leftColor) }]}>{matchLeft}</Text>
        </View>
        <Text style={[styles.overallLabel, { color: theme.fg }]}>Overall Score</Text>
      </View>

      {/* Challenge area */}
      <View style={[styles.challengePanel, { backgroundColor: theme.panelBg, borderColor: theme.panelBorder }]}>
        <Text style={[styles.infoTitle, { color: theme.sub }]}>Challenge Score</Text>

        <View style={styles.chalBigRow}>
          <TintedScore value={chalLeft} baseColor={leftColor} highContrast={theme.bg === '#000'} blink={leftIsWinner && blinkOn} />
          <Text style={[styles.chalColon, { color: theme.fg }]}>:</Text>
          <TintedScore value={chalRight} baseColor={rightColor} highContrast={theme.bg === '#000'} blink={rightIsWinner && blinkOn} />
        </View>

        <View style={styles.winnerRow}>
          <Text style={[styles.winnerHint, { opacity: leftIsWinner && blinkOn ? 1 : 0 }]}>WINNER ⟵</Text>
          <View style={{ flex: 1 }} />
          <Text style={[styles.winnerHint, { opacity: rightIsWinner && blinkOn ? 1 : 0 }]}>⟶ WINNER</Text>
        </View>

        {/* Challenge meta moved out in earlier revs – re-add as needed */}
      </View>

      {/* Right match */}
      <View style={styles.matchCol}>
        <Text style={[styles.teamName, { color: theme.sub, textAlign: 'right' }]}>{rightTeamName}</Text>
        <View style={[styles.matchBox, { backgroundColor: rightColor, opacity: rightIsWinner && blinkOn ? 0.35 : 1 }]}>
          <Text style={[styles.matchVal, { color: textOn(rightColor) }]}>{matchRight}</Text>
        </View>
        <Text style={[styles.overallLabel, { color: theme.fg }]}>Overall Score</Text>
      </View>
    </View>
  );
}

function ScoreRowBonus({
  theme, colorLeft, colorRight, teamLeft, teamRight, matchLeft, matchRight, bonusWinnerSide
}) {
  return (
    <View style={styles.bonusRow}>
      <View
        style={[
          styles.bonusBox,
          {
            backgroundColor: bonusWinnerSide === 'left' ? '#10b981' : colorLeft,
            borderColor: theme.bg === '#000' ? '#fff' : '#00000022'
          }
        ]}
      >
        <Text style={[styles.bonusTeam, { color: textOn(bonusWinnerSide === 'left' ? '#10b981' : colorLeft) }]}>{teamLeft}</Text>
        <Text style={[styles.bonusVal, { color: textOn(bonusWinnerSide === 'left' ? '#10b981' : colorLeft) }]}>{matchLeft}</Text>
      </View>

      <Text style={[styles.bonusColon, { color: theme.fg }]}>:</Text>

      <View
        style={[
          styles.bonusBox,
          {
            backgroundColor: bonusWinnerSide === 'right' ? '#10b981' : colorRight,
            borderColor: theme.bg === '#000' ? '#fff' : '#00000022'
          }
        ]}
      >
        <Text style={[styles.bonusTeam, { color: textOn(bonusWinnerSide === 'right' ? '#10b981' : colorRight) }]}>{teamRight}</Text>
        <Text style={[styles.bonusVal, { color: textOn(bonusWinnerSide === 'right' ? '#10b981' : colorRight) }]}>{matchRight}</Text>
      </View>
    </View>
  );
}

function TintedScore({ value, baseColor, highContrast, blink }) {
  const tint = highContrast ? adjust(baseColor, -35) : adjust(baseColor, 40);
  return (
    <View style={[styles.tintedBox, { backgroundColor: tint, opacity: blink ? 0.35 : 1 }]}>
      <Text style={[styles.tintedVal, { color: textOn(tint) }]}>{value}</Text>
    </View>
  );
}

function Light({ used, theme }) {
  return (
    <View style={[
      styles.light,
      { borderColor: theme.outline, backgroundColor: used ? '#ef4444' : '#10b981' }
    ]} />
  );
}

function ColorSwatches({ value, onChange }) {
  return (
    <View style={styles.swatchRow}>
      {PALETTE.map((c) => (
        <TouchableOpacity key={c} onPress={() => onChange(c)} style={[styles.swatch, { backgroundColor: c, borderColor: value === c ? '#fff' : '#00000022' }]} />
      ))}
    </View>
  );
}

function TeamPanel({
  teamKey, roster, totals, moneyMakes, winners, specials,
  theme, accent, onPickColor, detailMode
}) {
  const title = teamKey === 'A' ? 'TEAM A' : 'TEAM B';
  const fgHeader = `FG ${pctTxt(totals.m, totals.a)} • ${totals.m}/${totals.a}`;

  const [boxH, setBoxH] = useState(0);
  const rows = Math.max(1, roster.length);
  const gap = 8;
  const minRow = detailMode ? 64 : 60;
  const rowH = Math.max(minRow, Math.floor((boxH - gap*(rows-1)) / rows));

  return (
    <View style={[styles.teamPanel, { backgroundColor: theme.panelBg, borderColor: accent || theme.panelBorder }]}>
      <View style={styles.teamHeader}>
        <Text style={[styles.teamTitle, { color: accent || theme.fg }]}>{title}</Text>
        <Text style={[styles.teamSummary, { color: theme.sub }]}>{fgHeader}</Text>
      </View>

      <ColorSwatches value={accent} onChange={onPickColor} />

      <View style={styles.lightsRow}>
        <View style={styles.lightItem}><Light used={!!specials?.moneyUsed} theme={theme} /><Text style={[styles.lightLabel, { color: theme.fg }]}>Moneyball</Text></View>
        <View style={styles.lightItem}><Light used={!!specials?.gcUsed} theme={theme} /><Text style={[styles.lightLabel, { color: theme.fg }]}>Gamechanger</Text></View>
      </View>

      <View style={[styles.playersWrap, { gap }]} onLayout={(e)=>setBoxH(e.nativeEvent.layout.height)}>
        {roster.map(p => <PlayerRow key={p.pid} p={p} height={rowH} theme={theme} detail={detailMode} />)}
      </View>

      <View style={[styles.teamFooter, { borderTopColor: theme.divider }]}>
        <Text style={[styles.footerText, { color: accent || theme.fg }]}>Team FG {pctTxt(totals.m, totals.a)}</Text>
        <Text style={[styles.footerDot, { color: theme.sub }]}>•</Text>
        <Text style={[styles.footerText, { color: accent || theme.fg }]}>$ makes: {moneyMakes}</Text>
        <Text style={[styles.footerDot, { color: theme.sub }]}>•</Text>
        <Text style={[styles.footerText, { color: accent || theme.fg }]}>Challenges Won: {winners}</Text>
      </View>
    </View>
  );
}

function PlayerRow({ p, theme, height, detail }) {
  const fgPct = pct(p.total.m, p.total.a);
  const fgPctText = p.total.a > 0 ? `${fgPct}%` : '—';

  const chip = (label, m, a) => (
    <View style={[styles.chip, { borderColor: theme.divider }]}>
      <Text style={[styles.chipTxt, { color: theme.sub }]}>{label} {m}/{a}{a>0?` (${pct(m,a)}%)`:''}</Text>
    </View>
  );

  return (
    <View style={[styles.playerRow, { height, borderColor: theme.divider, backgroundColor: theme.cellBg }]}>
      {/* Tall rectangular avatar that spans row height */}
      <Image source={{ uri: AVATAR }} style={[styles.avatarTall, { height: height - 8 }]} />
      <View style={styles.playerMid}>
        <Text style={[styles.playerName, { color: theme.fg }]} numberOfLines={1}>{p.pid}</Text>
        {!detail ? (
          <Text style={[styles.playerMetaBig, { color: theme.sub }]}>
            FG <Text style={[styles.bold, { color: theme.fg }]}>{fgPctText}</Text>
          </Text>
        ) : (
          <View style={styles.chipsRow}>
            {chip('Mid', p.mid.m, p.mid.a)}
            {chip('Long', p.long.m, p.long.a)}
            {chip('$', p.money.m, p.money.a)}
            {chip('GC', p.gamechanger.m, p.gamechanger.a)}
            <View style={[styles.chip, { borderColor: theme.divider }]}><Text style={[styles.chipTxt, { color: theme.sub }]}>GW {p.winners}</Text></View>
          </View>
        )}
      </View>
      <Text style={[styles.playerMABig, { color: theme.fg }]}>{p.total.m}/{p.total.a}</Text>
    </View>
  );
}

/* ---------------- styles ---------------- */
const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  topBar: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  smallBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  smallBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },
  midTop: { alignItems: 'center' },
  clockText: { fontSize: 28, fontWeight: '900' },
  meta: { fontWeight: '800', fontSize: 14, marginTop: 2 },

  centerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },

  matchCol: { width: 190, alignItems: 'center' },
  teamName: { fontSize: 14, fontWeight: '900', marginBottom: 4 },
  matchBox: { width: 170, height: 98, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  matchVal: { fontSize: 58, fontWeight: '900' },
  overallLabel: { marginTop: 4, fontSize: 12, fontWeight: '800' },

  challengePanel: { flex: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 10, alignItems: 'center' },
  infoTitle: { fontSize: 14, fontWeight: '900', marginBottom: 2 },
  chalBigRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 2 },
  chalColon: { fontSize: 42, fontWeight: '900' },
  tintedBox: { width: 120, height: 78, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tintedVal: { fontSize: 42, fontWeight: '900' },
  winnerRow: { width: '100%', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, marginTop: 2 },
  winnerHint: { fontSize: 16, fontWeight: '900', color: '#10b981' },

  // BONUS LAYOUT
  bonusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 6 },
  bonusBox: {
    width: 280, height: 140, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2
  },
  bonusTeam: { fontSize: 14, fontWeight: '900', marginBottom: 4 },
  bonusVal: { fontSize: 72, fontWeight: '900' },
  bonusColon: { fontSize: 56, fontWeight: '900' },

  sidesRow: { flex: 1, flexDirection: 'row', gap: 10, marginTop: 6 },

  teamPanel: { flex: 1, borderWidth: 2, borderRadius: 14, padding: 10, justifyContent: 'space-between' },
  teamHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  teamTitle: { fontSize: 18, fontWeight: '900' },
  teamSummary: { fontSize: 12, fontWeight: '800' },

  swatchRow: { flexDirection: 'row', gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  swatch: { width: 20, height: 20, borderRadius: 4, borderWidth: 2 },

  lightsRow: { flexDirection: 'row', gap: 14, marginBottom: 6 },
  lightItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  light: { width: 14, height: 14, borderRadius: 3, borderWidth: 1 },
  lightLabel: { fontSize: 12, fontWeight: '700' },

  playersWrap: { flex: 1 },

  playerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderWidth: 1, borderRadius: 8 },
  avatarTall: { width: 46, borderRadius: 6, marginRight: 10, backgroundColor: '#ddd' },
  playerMid: { flex: 1, minWidth: 0 },
  playerName: { fontSize: 14, fontWeight: '900' },
  playerMetaBig: { fontSize: 14, marginTop: 2 },
  playerMABig: { fontSize: 18, fontWeight: '900', marginLeft: 8, minWidth: 60, textAlign: 'right' },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  chipTxt: { fontSize: 10, fontWeight: '800' },

  teamFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, paddingTop: 6, marginTop: 8, gap: 8 },
  footerText: { fontSize: 12, fontWeight: '800' },
  footerDot: { fontSize: 12 },
  bold: { fontWeight: '900' },
});
