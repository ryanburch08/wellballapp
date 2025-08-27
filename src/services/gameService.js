// src/services/gameService.js
// Full game service: two-tracker, Freestyle/Sequence, bonus round w/ MR/LR/GC,
// shutout ×2 wins, global UI flip for casting, robust undo, and clock helpers.

import {
  collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp,
  setDoc, updateDoc, deleteDoc, runTransaction, where, orderBy, limit
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { shotMatchesRule } from './challengeRules';

/* ------------------------------------------------------------------ */
/* Data model
games/{gameId} = {
  createdBy, roles: { main, secondary|null },
  teamAIds: [uid], teamBIds: [uid],

  // Mode & challenge flow
  mode: 'sequence' | 'freestyle',
  sequenceId: string|null,
  sequenceChallengeIds: [challengeId, ...],  // when mode==='sequence'
  currentChallengeIndex: 0,

  // Freestyle — two supported formats (nested + legacy top-level for compatibility)
  freestyle: { targetScore: number, pointsForWin: number } | null,
  freestyleTarget?: number,      // legacy
  freestyleWorth?: number,       // legacy

  // Scores
  matchScore: { A:0, B:0 },
  challengeScore: { A:0, B:0 },
  challengeWon: null | { team, atIndex, pointsForWin, scoreA, scoreB, winLogId?, shutout?: boolean, ts },

  // UI/UX
  uiFlipSides?: boolean,

  // Specialty usage (resets every challenge)
  specials: {
    A: { moneyUsed: false, gcUsed: false },
    B: { moneyUsed: false, gcUsed: false },
  },

  // Bonus round toggle
  bonusActive: false,
  overtimeCount?: number, // for casting OT helper

  // Clock
  clockSeconds: 90,
  clockRunning: false,
  lastStartAt: Timestamp|null,

  // Two-tracker presence & locks
  trackerLocks: { A: { uid, updatedAt } | null, B: { uid, updatedAt } | null },

  // Dispute / pause
  paused?: boolean,
  pauseMeta?: { by, reason, at },
  disputeLock?: { by, at } | null,

  status: 'lobby' | 'live' | 'ended',
  createdAt
}
games/{gameId}/logs/{logId}   // shot actions + meta
games/{gameId}/trackers/{uid} // presence: { team, role, lastSeen }
--------------------------------------------------------------------- */

/* ========================= Presence & Locks ========================= */

export const listenTrackers = (gameId, cb) => {
  const col = collection(db, 'games', gameId, 'trackers');
  return onSnapshot(col, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
};

export const heartbeat = async (gameId) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const ref = doc(db, 'games', gameId, 'trackers', uid);
  await setDoc(ref, { lastSeen: serverTimestamp() }, { merge: true });

  const gameRef = doc(db, 'games', gameId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) return;
    const g = snap.data() || {};
    const team = g?.trackerLocks?.A?.uid === uid ? 'A'
               : g?.trackerLocks?.B?.uid === uid ? 'B'
               : null;
    if (team) tx.update(gameRef, { [`trackerLocks.${team}.updatedAt`]: serverTimestamp() });
  });
};

export const joinAsTracker = async (gameId, team) => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  const ref = doc(db, 'games', gameId, 'trackers', uid);
  await setDoc(ref, { team, lastSeen: serverTimestamp() }, { merge: true });
};

export const leaveTracking = async (gameId) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const gameRef = doc(db, 'games', gameId);
  const g = (await getDoc(gameRef)).data();
  const myTeam = g?.trackerLocks?.A?.uid === uid ? 'A'
               : g?.trackerLocks?.B?.uid === uid ? 'B'
               : null;

  await Promise.allSettled([
    deleteDoc(doc(db, 'games', gameId, 'trackers', uid)),
    myTeam ? updateDoc(gameRef, { [`trackerLocks.${myTeam}`]: null }) : Promise.resolve(),
  ]);
};

export const setTeamLock = async (gameId, team, uidOrNull) => {
  if (!['A','B'].includes(team)) throw new Error('Invalid team');
  const gameRef = doc(db, 'games', gameId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error('Game not found');
    const locks = (snap.data()?.trackerLocks) || {};
    locks[team] = uidOrNull ? { uid: uidOrNull, updatedAt: serverTimestamp() } : null;
    tx.update(gameRef, { trackerLocks: locks });
  });
};

export const tryClaimTeam = async (gameId, team) => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  if (!['A','B'].includes(team)) throw new Error('Invalid team');
  const gameRef = doc(db, 'games', gameId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error('Game not found');
    const g = snap.data();
    const locks = g.trackerLocks || {};
    const cur = locks[team];
    if (!cur || cur.uid === uid) {
      locks[team] = { uid, updatedAt: serverTimestamp() };
      tx.update(gameRef, { trackerLocks: locks });
    }
  });
};

export const listenMyTrackerAssignment = (gameId, cb) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return () => {};
  const ref = doc(db, 'games', gameId, 'trackers', uid);
  return onSnapshot(ref, snap => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null));
};

/* ========================= Game Lifecycle ========================= */

export const createGame = async ({
  teamAIds,
  teamBIds,
  sequenceId = null,
  sequenceChallengeIds = [],
  clockSeconds = 90,
  secondaryKeeper = null,
  eventId = null,
  mode = 'sequence',
  freestyle = null, // { targetScore, pointsForWin }
}) => {
  const creator = auth.currentUser?.uid || 'unknown';
  const ref = doc(collection(db, 'games'));

  const fsTarget = Number((freestyle && freestyle.targetScore) ?? null);
  const fsWorth  = Number((freestyle && freestyle.pointsForWin) ?? null);

  await setDoc(ref, {
    createdBy: creator,
    roles: { main: creator, secondary: secondaryKeeper },

    teamAIds,
    teamBIds,

    mode,
    sequenceId,
    sequenceChallengeIds,
    currentChallengeIndex: 0,

    freestyle: mode === 'freestyle'
      ? {
          targetScore: Number.isFinite(fsTarget) ? fsTarget : 0,
          pointsForWin: Number.isFinite(fsWorth) ? fsWorth : 0,
        }
      : null,

    // Legacy top-level keys too (StatEntryScreen compatibility)
    freestyleTarget: Number.isFinite(fsTarget) ? fsTarget : 0,
    freestyleWorth:  Number.isFinite(fsWorth)  ? fsWorth  : 0,

    matchScore: { A: 0, B: 0 },
    challengeScore: { A: 0, B: 0 },
    challengeWon: null,

    specials: { A: { moneyUsed: false, gcUsed: false }, B: { moneyUsed: false, gcUsed: false } },

    uiFlipSides: false,

    bonusActive: false,
    overtimeCount: 0,

    clockSeconds,
    clockRunning: false,
    lastStartAt: null,

    trackerLocks: { A: null, B: null },
    paused: false,
    pauseMeta: null,
    disputeLock: null,

    eventId,
    status: 'live',
    createdAt: serverTimestamp(),
  });
  return ref.id;
};

export const listenToGame = (gameId, cb) =>
  onSnapshot(doc(db, 'games', gameId), snap => cb(snap.exists() ? ({ id: snap.id, ...snap.data() }) : null));

export const listenToLogs = (gameId, cb, team = null) => {
  let qy = query(collection(db, 'games', gameId, 'logs'), orderBy('ts', 'desc'), limit(200));
  if (team) qy = query(collection(db, 'games', gameId, 'logs'), where('team', '==', team), orderBy('ts', 'desc'), limit(200));
  return onSnapshot(qy, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
};

/* ========================= Scoring Helpers ========================= */

const shotPoints = ({ shotType, made, moneyball }) => {
  if (!made) return 0;

  // Bonus round variants
  if (shotType === 'bonus_mid')  return 1;
  if (shotType === 'bonus_long') return 2;
  if (shotType === 'bonus_gc')   return 4;

  // Legacy single bonus
  if (shotType === 'bonus') return 1;

  // Normal challenge
  if (shotType === 'gamechanger') return 5;
  if (shotType === 'mid' || shotType === 'long') return moneyball ? 2 : 1;

  return 0;
};

const isBonusType = (t) => t === 'bonus' || (typeof t === 'string' && t.startsWith('bonus_'));

const playerTeamKey = (game, playerId) => {
  if (game.teamAIds?.includes(playerId)) return 'A';
  if (game.teamBIds?.includes(playerId)) return 'B';
  return null;
};

// Get target, pointsForWin, and (optional) shotRule from the current challenge
const getCurrentChallengeMeta = async (tx, game) => {
  if (game.mode === 'freestyle') {
    return {
      target: Number(game?.freestyle?.targetScore ?? 0) || 0,
      pointsForWin: Number(game?.freestyle?.pointsForWin ?? 0) || 0,
      shotRule: game?.freestyle?.shotRule || null, // optional future support
    };
  }
  const currentChallengeId = game.sequenceChallengeIds?.[game.currentChallengeIndex];
  if (!currentChallengeId) return { target: 0, pointsForWin: 0, shotRule: null };
  const challSnap = await tx.get(doc(db, 'challenges', currentChallengeId));
  if (!challSnap.exists()) return { target: 0, pointsForWin: 0, shotRule: null };
  const chall = challSnap.data() || {};
  return {
    target: Number(chall?.targetScore ?? 0) || 0,
    pointsForWin: Number(chall?.pointsForWin ?? 0) || 0,
    shotRule: chall?.shotRule || null,
  };
};

/* ========================= Shots & Undo ========================= */

// Log a shot and update scores atomically
export const logShot = async (gameId, params) => {
  const {
    playerId,
    shotType,
    made,
    moneyball = false,

    // OPTIONAL meta for auto/vision pipeline
    zone = null,            // 'corner'|'wing'|'elbow'|'top'|'gc'
    shotKey = null,         // e.g. 'mid_corner'
    source = 'manual',      // 'manual'|'auto'
    confidence = null,      // number 0..1
    evidence = null,        // any reference/URL/blobId
    startSpotId = null,     // courtSpot id where player started (optional)
    shotSpotId = null,      // courtSpot id where shot released (optional)
    spotNumber = null,      // 1..18 if known
  } = params || {};

  const uid = auth.currentUser?.uid || 'unknown';
  const gameRef = doc(db, 'games', gameId);
  const logsRef = collection(db, 'games', gameId, 'logs');

  await runTransaction(db, async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists()) throw new Error('Game not found');
    const game = gameSnap.data();

    // Clock/paused gating for auto-ingest
    if (source !== 'manual') {
      const clockOk = game.status === 'live' && game.clockRunning === true && game.paused !== true;
      if (!clockOk) {
        throw new Error('Clock not running (or game paused). Auto ingest blocked.');
      }
    }

    // Block any shot after a challenge is marked won (until Next Challenge)
    if (game.challengeWon) {
      throw new Error('Challenge completed. Tap “Next Challenge” to continue.');
    }

    // Ownership / lock check
    const teamKey = playerTeamKey(game, playerId);
    if (!teamKey) throw new Error('Player not in game');

    const lock = game.trackerLocks?.[teamKey];
    const isMain = uid === game.roles?.main;
    if (!isMain) {
      if (!lock || lock.uid !== uid) {
        throw new Error(`You’re not the assigned tracker for Team ${teamKey}`);
      }
    }

    // Bonus usage enforcement
    const bonusShot = isBonusType(shotType);
    if (bonusShot && game.bonusActive !== true) {
      throw new Error('Bonus round is not active.');
    }

    // Specialty usage one per challenge (NORMAL only)
    const specials = game.specials || { A: { moneyUsed: false, gcUsed: false }, B: { moneyUsed: false, gcUsed: false } };
    const willCountMoneyball = !bonusShot && moneyball && (shotType === 'mid' || shotType === 'long');
    if (willCountMoneyball && (specials?.[teamKey]?.moneyUsed === true)) {
      throw new Error(`Team ${teamKey} has already used Moneyball this challenge.`);
    }
    const willUseGC = !bonusShot && (shotType === 'gamechanger');
    if (willUseGC && (specials?.[teamKey]?.gcUsed === true)) {
      throw new Error(`Team ${teamKey} has already used Gamechanger this challenge.`);
    }

    const pts = Number(shotPoints({ shotType, made, moneyball: willCountMoneyball })) || 0;

    // Pre-read challenge meta + enforce shotRule for non-bonus attempts
    let target = 0;
    let pointsForWin = 0;
    let shotRule = null;

    if (!bonusShot) {
      const meta = await getCurrentChallengeMeta(tx, game);
      target = meta.target;
      pointsForWin = meta.pointsForWin;
      shotRule = meta.shotRule || null;

      // If a rule exists, validate this shot (range/zone).
      if (shotRule) {
        // We accept range/zone in the optional second arg from callers (auto-tracking),
        // and degrade gracefully if manual buttons didn’t provide a zone.
        const attemptMeta = {
          shotType,                         // 'mid' | 'long' | 'gamechanger'
          zone: arguments[1]?.zone || null, // 'corner' | 'wing' | 'elbow' | 'top' | 'gc'
          shotKey: arguments[1]?.shotKey || null,
        };
        const check = shotMatchesRule(attemptMeta, shotRule);
        if (!check.ok && shotRule.validation === 'strict') {
          throw new Error('That shot is not allowed by the current challenge.');
        }
        // For 'soft' validation we still allow, but you could tag logs if you want:
        // e.g., add attemptMeta.validationReason = check.reason and save on the log.
      }
    }


    const curMatch = (k) => Number(game.matchScore?.[k] ?? 0) || 0;
    const curChal  = (k) => Number(game.challengeScore?.[k] ?? 0) || 0;

    const updates = {};
    if (made) {
      if (bonusShot) {
        updates[`matchScore.${teamKey}`] = curMatch(teamKey) + pts;
      } else {
        updates[`challengeScore.${teamKey}`] = curChal(teamKey) + pts;
      }
    }

    // Mark specialty usage (NORMAL only)
    if (willCountMoneyball) {
      updates[`specials.${teamKey}.moneyUsed`] = true;
    }
    if (willUseGC) {
      updates[`specials.${teamKey}.gcUsed`] = true;
    }

    // Win check (NORMAL only)
    let wonNow = null;
    let winLogRef = null;
    if (made && !bonusShot && target > 0) {
      const newChallengeScore = curChal(teamKey) + pts;

      if (newChallengeScore >= target) {
        const opp = teamKey === 'A' ? 'B' : 'A';
        const opponentHadZero = curChal(opp) === 0;
        const pfwAward = pointsForWin * (opponentHadZero ? 2 : 1);

        updates[`matchScore.${teamKey}`] =
          (updates[`matchScore.${teamKey}`] ?? curMatch(teamKey)) + pfwAward;

        winLogRef = doc(logsRef);
        wonNow = {
          team: teamKey,
          atIndex: Number(game.currentChallengeIndex ?? 0),
          scoreA: teamKey === 'A' ? newChallengeScore : curChal('A'),
          scoreB: teamKey === 'B' ? newChallengeScore : curChal('B'),
          pointsForWin,                 // base pfw
          shutout: opponentHadZero || false,
          winLogId: winLogRef.id,
          ts: serverTimestamp(),
        };
        updates['challengeWon'] = wonNow;
      }
    }

    if (Object.keys(updates).length > 0) tx.update(gameRef, updates);

    // Write attempt log (include annotations)
    const attemptRef = doc(logsRef);
    tx.set(attemptRef, {
      playerId, shotType, made,
      moneyball: !!moneyball,
      team: teamKey,
      challengeIndex: game.currentChallengeIndex,
      ts: serverTimestamp(),

      // provenance
      source, confidence, evidence,

      // court meta
      zone, shotKey, startSpotId, shotSpotId, spotNumber,

      // rule audit
      ruleCheck: { ok: !!ruleMeta.ok, reason: ruleMeta.reason || null },
    });

    // Win log
    if (wonNow && winLogRef) {
      tx.set(winLogRef, {
        type: 'challenge_win',
        byPlayerId: playerId,
        team: teamKey,
        challengeIndex: game.currentChallengeIndex,
        pointsForWin: wonNow.pointsForWin,
        shutout: !!wonNow.shutout,
        ts: serverTimestamp(),
        tag: 'GameWinner',
      });
    }
  });
};

export const undoLastActionForPlayer = async () => {
  throw new Error('For MVP, pass a specific logId to undo using deleteLogAndReverse');
};

const recomputeSpecialsForChallenge = async (gameId, challengeIndex) => {
  try {
    const logsCol = collection(db, 'games', gameId, 'logs');
    const qy = query(
      logsCol,
      where('challengeIndex', '==', Number(challengeIndex)),
      orderBy('ts', 'asc'),
      limit(400)
    );
    const snap = await getDocs(qy);
    const flags = { A: { moneyUsed: false, gcUsed: false }, B: { moneyUsed: false, gcUsed: false } };
    snap.forEach(d => {
      const l = d.data();
      if (l?.team === 'A' || l?.team === 'B') {
        if (l.moneyball) flags[l.team].moneyUsed = true;
        if (l.shotType === 'gamechanger') flags[l.team].gcUsed = true;
      }
    });
    await updateDoc(doc(db, 'games', gameId), { specials: flags });
  } catch (e) {
    console.warn('recomputeSpecialsForChallenge failed:', e?.message || e);
  }
};

export const deleteLogAndReverse = async (gameId, log) => {
  const gameRef = doc(db, 'games', gameId);
  const logRef  = doc(db, 'games', gameId, 'logs', log.id);

  let needFallbackWinCleanup = false;
  let fallbackTeam = null;
  let fallbackIndex = null;
  let challengeIndexForSpecials = null;

  await runTransaction(db, async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists()) throw new Error('Game not found');
    const game = gameSnap.data();

    const { shotType, made, moneyball, team, challengeIndex } = log;
    const pts = Number(shotPoints({ shotType, made, moneyball })) || 0;
    challengeIndexForSpecials = Number(challengeIndex ?? 0);

    const curMatch = (k) => Number(game.matchScore?.[k] ?? 0) || 0;
    const curChal  = (k) => Number(game.challengeScore?.[k] ?? 0) || 0;

    const updates = {};

    if (made) {
      if (isBonusType(shotType)) {
        updates[`matchScore.${team}`] = Math.max(0, curMatch(team) - pts);
      } else {
        updates[`challengeScore.${team}`] = Math.max(0, curChal(team) - pts);
      }
    }

    const cw = game.challengeWon || null;
    const wasWinningShot =
      !!cw &&
      made === true &&
      !isBonusType(shotType) &&
      cw.team === team &&
      Number(cw.atIndex ?? -1) === Number(challengeIndex ?? -2);

    if (wasWinningShot) {
      const basePfw = Number(cw.pointsForWin ?? 0) || 0;
      const pfwApplied = basePfw * (cw.shutout ? 2 : 1);
      updates[`matchScore.${team}`] = Math.max(0, (updates[`matchScore.${team}`] ?? curMatch(team)) - pfwApplied);
      updates['challengeWon'] = null;

      if (cw.winLogId) {
        const winLogDoc = doc(db, 'games', gameId, 'logs', cw.winLogId);
        tx.delete(winLogDoc);
      } else {
        needFallbackWinCleanup = true;
        fallbackTeam = team;
        fallbackIndex = Number(challengeIndex ?? 0);
      }
    }

    if (Object.keys(updates).length > 0) tx.update(gameRef, updates);

    tx.delete(logRef);
  });

  if (needFallbackWinCleanup) {
    try {
      const logsCol = collection(db, 'games', gameId, 'logs');
      const qy = query(
        logsCol,
        where('type', '==', 'challenge_win'),
        where('team', '==', fallbackTeam),
        where('challengeIndex', '==', fallbackIndex),
        orderBy('ts', 'desc'),
        limit(1)
      );
      const snap = await getDocs(qy);
      if (!snap.empty) {
        await deleteDoc(snap.docs[0].ref);
      }
    } catch (e) {
      console.warn('Best-effort win-log cleanup failed (safe to ignore):', e?.message || e);
    }
  }

  if (challengeIndexForSpecials != null) {
    await recomputeSpecialsForChallenge(gameId, challengeIndexForSpecials);
  }
};

/* ========================= Bonus / End / Clock ========================= */

export const startBonusMode = async (gameId) => {
  const gameRef = doc(db, 'games', gameId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error('Game not found');
    const g = snap.data() || {};
    // compute remaining and stop
    const base = Number(g.clockSeconds || 0);
    const last = g.lastStartAt;
    let remaining = base;
    if (g.clockRunning && last) {
      const lastMs = last.toMillis ? last.toMillis() : Date.parse(last);
      const elapsed = Math.max(0, Math.floor((Date.now() - lastMs) / 1000));
      remaining = Math.max(0, base - elapsed);
    }
    tx.update(gameRef, {
      clockSeconds: 180,
      clockRunning: false,
      lastStartAt: null,
      bonusActive: true,
      overtimeCount: 0,
    });
  });
};

export const endBonusMode = async (gameId) =>
  updateDoc(doc(db, 'games', gameId), { bonusActive: false });

export const endGame = async (gameId) =>
  updateDoc(doc(db, 'games', gameId), { status: 'ended' });

export const setClockSeconds = async (gameId, seconds) => {
  const secs = Math.max(0, Number(seconds) || 0);
  await updateDoc(doc(db, 'games', gameId), { clockSeconds: secs });
};

export const startClock = async (gameId) => {
  await updateDoc(doc(db, 'games', gameId), {
    clockRunning: true,
    lastStartAt: serverTimestamp(),
  });
};

export const stopClock = async (gameId) => {
  const gameRef = doc(db, 'games', gameId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error('Game not found');
    const g = snap.data() || {};
    const base = Number(g.clockSeconds || 0);
    const last = g.lastStartAt;
    let remaining = base;
    if (g.clockRunning && last) {
      const lastMs = last.toMillis ? last.toMillis() : Date.parse(last);
      const elapsed = Math.max(0, Math.floor((Date.now() - lastMs) / 1000));
      remaining = Math.max(0, base - elapsed);
    }
    tx.update(gameRef, {
      clockSeconds: remaining,
      clockRunning: false,
      lastStartAt: null,
    });
  });
};

export const resetClockSeconds = async (gameId, seconds) => {
  const secs = Math.max(0, Number(seconds) || 0);
  await updateDoc(doc(db, 'games', gameId), {
    clockSeconds: secs,
    clockRunning: false,
    lastStartAt: null,
  });
};

/* ========================= Freestyle Helpers ========================= */

export const setFreestyleParams = async (gameId, { targetScore, pointsForWin }) => {
  const t = Math.max(0, Number(targetScore) || 0);
  const p = Math.max(0, Number(pointsForWin) || 0);
  await updateDoc(doc(db, 'games', gameId), {
    freestyle: { targetScore: t, pointsForWin: p },
    freestyleTarget: t,
    freestyleWorth: p,
  });
};

/* ========================= Challenge Progression ========================= */

export const advanceToNextChallenge = async (gameId) => {
  const gameRef = doc(db, 'games', gameId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error('Game not found');
    const g = snap.data() || {};
    const cur = Number(g.currentChallengeIndex ?? 0);
    const total = Number(g.sequenceChallengeIds?.length ?? 1);
    const next = g.mode === 'sequence'
      ? Math.min(cur + 1, Math.max(0, total - 1))
      : cur + 1;

    const updates = {
      currentChallengeIndex: next,
      challengeScore: { A: 0, B: 0 },
      challengeWon: null,
      specials: { A: { moneyUsed: false, gcUsed: false }, B: { moneyUsed: false, gcUsed: false } },
      bonusActive: false,
      overtimeCount: 0,
    };

    tx.update(gameRef, updates);
  });
};

/* ========================= Casting UI Helpers ========================= */

export const toggleFlipSides = async (gameId) => {
  const ref = doc(db, 'games', gameId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Game not found');
    const cur = !!snap.data()?.uiFlipSides;
    tx.update(ref, { uiFlipSides: !cur });
  });
};

export const setPaused = async (gameId, paused, reason = '') => {
  const patch = paused
    ? { paused: true, pauseMeta: { by: auth.currentUser?.uid || 'unknown', reason, at: serverTimestamp() }, clockRunning: false, lastStartAt: null }
    : { paused: false, pauseMeta: null, disputeLock: null };
  await updateDoc(doc(db, 'games', gameId), patch);
};

export const claimDispute = async (gameId) => {
  const ref = doc(db, 'games', gameId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Game not found');
    const cur = snap.data()?.disputeLock;
    const now = Date.now();
    const curMs = cur?.at?.toMillis?.() || 0;
    if (!cur || (now - curMs) > 60000 || cur.by === auth.currentUser?.uid) {
      tx.update(ref, { disputeLock: { by: auth.currentUser?.uid || 'unknown', at: serverTimestamp() } });
    } else {
      throw new Error('Another operator is editing a dispute.');
    }
  });
};

export const releaseDispute = async (gameId) =>
  updateDoc(doc(db, 'games', gameId), { disputeLock: null });
