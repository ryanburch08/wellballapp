// src/services/gameService.js
// Minimal game service for MVP + two-tracker flow
// Assumes src/services/firebase.js exports { auth, db }

/* ------------------------------------------------------------------ */
/* Data model (MVP)
games/{gameId} = {
  createdBy, roles: { main, secondary|null },
  teamAIds: [uid], teamBIds: [uid],
  sequenceId, sequenceChallengeIds: [challengeId, ...],
  currentChallengeIndex: 0,
  matchScore: { A:0, B:0 },
  challengeScore: { A:0, B:0 },
  challengeWon: null | { team, atIndex, pointsForWin, scoreA, scoreB, winLogId?, ts }

  // Bonus mode flag used by UI to switch buttons and routing
  bonusActive: false,

  clockSeconds: 90,
  clockRunning: false,
  lastStartAt: Timestamp|null,

  trackerLocks: { A: { uid, updatedAt } | null, B: { uid, updatedAt } | null },

  status: 'lobby' | 'live' | 'ended',
  createdAt
}
games/{gameId}/logs/{logId}   // shot actions + meta
games/{gameId}/trackers/{uid} // presence: { team, role, lastSeen }
/* ------------------------------------------------------------------ */

import {
  collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp,
  setDoc, updateDoc, deleteDoc, runTransaction, where, orderBy, limit
} from 'firebase/firestore';
import { auth, db } from './firebase';

/* ========================= Presence & Locks ========================= */

// Subscribe to all trackers in this game
export const listenTrackers = (gameId, cb) => {
  const col = collection(db, 'games', gameId, 'trackers');
  return onSnapshot(col, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
};

// Keep my heartbeat/update lastSeen
export const heartbeat = async (gameId) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const ref = doc(db, 'games', gameId, 'trackers', uid);
  await setDoc(ref, { lastSeen: serverTimestamp() }, { merge: true });

  // Refresh lock timestamp if I still own it
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

// Set my preferred team (or update)
export const joinAsTracker = async (gameId, team) => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  if (!['A','B'].includes(team)) throw new Error('Invalid team');
  const ref = doc(db, 'games', gameId, 'trackers', uid);
  await setDoc(ref, { team, lastSeen: serverTimestamp() }, { merge: true });
};

// Leave (remove my tracker doc) and release my lock if I hold one
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

// Main explicitly assign/clear a team lock
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

// Non-main tries to claim a free team (best effort)
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

// Watch my assignment (presence doc)
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
  sequenceId,
  sequenceChallengeIds,
  clockSeconds = 90,
  secondaryKeeper = null,
  eventId = null,
}) => {
  const creator = auth.currentUser?.uid || 'unknown';
  const ref = doc(collection(db, 'games'));
  await setDoc(ref, {
    createdBy: creator,
    roles: { main: creator, secondary: secondaryKeeper },
    teamAIds,
    teamBIds,
    sequenceId,
    sequenceChallengeIds,
    currentChallengeIndex: 0,
    matchScore: { A: 0, B: 0 },
    challengeScore: { A: 0, B: 0 },
    challengeWon: null,
    bonusActive: false,

    clockSeconds,
    clockRunning: false,
    lastStartAt: null,

    trackerLocks: { A: null, B: null },
    eventId,
    status: 'live',
    createdAt: serverTimestamp(),
  });
  return ref.id;
};

export const listenToGame = (gameId, cb) =>
  onSnapshot(doc(db, 'games', gameId), snap => cb(snap.exists() ? ({ id: snap.id, ...snap.data() }) : null));

export const listenToLogs = (gameId, cb, team = null) => {
  let qy = query(collection(db, 'games', gameId, 'logs'), orderBy('ts', 'desc'), limit(100));
  if (team) qy = query(collection(db, 'games', gameId, 'logs'), where('team', '==', team), orderBy('ts', 'desc'), limit(100));
  return onSnapshot(qy, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
};

/* ========================= Scoring Helpers ========================= */

const shotPoints = ({ shotType, made, moneyball }) => {
  if (!made) return 0;
  if (shotType === 'gamechanger') return 5;
  if (shotType === 'mid' || shotType === 'long') return moneyball ? 2 : 1;
  if (shotType === 'bonus') return 1; // bonus makes contribute to MATCH score
  return 0;
};

const playerTeamKey = (game, playerId) => {
  if (game.teamAIds?.includes(playerId)) return 'A';
  if (game.teamBIds?.includes(playerId)) return 'B';
  return null;
};

/* ========================= Shots & Undo ========================= */

// Log a shot and update scores atomically
export const logShot = async (gameId, { playerId, shotType, made, moneyball = false }) => {
  const uid = auth.currentUser?.uid || 'unknown';
  const gameRef = doc(db, 'games', gameId);
  const logsRef = collection(db, 'games', gameId, 'logs');

  await runTransaction(db, async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists()) throw new Error('Game not found');
    const game = gameSnap.data();

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

    const pts = Number(shotPoints({ shotType, made, moneyball })) || 0;
    const isBonusShot = shotType === 'bonus';

    // Pre-read challenge meta if this could win
    let target = 0;
    let pointsForWin = 0;
    if (!isBonusShot && made) {
      const currentChallengeId = game.sequenceChallengeIds?.[game.currentChallengeIndex];
      if (currentChallengeId) {
        const challSnap = await tx.get(doc(db, 'challenges', currentChallengeId));
        if (challSnap.exists()) {
          const chall = challSnap.data();
          target = Number(chall?.targetScore ?? 0) || 0;
          pointsForWin = Number(chall?.pointsForWin ?? 1) || 0;
        }
      }
    }

    const curMatch = (k) => Number(game.matchScore?.[k] ?? 0) || 0;
    const curChal  = (k) => Number(game.challengeScore?.[k] ?? 0) || 0;

    const updates = {};
    if (made) {
      if (isBonusShot) {
        // BONUS → MATCH
        updates[`matchScore.${teamKey}`] = curMatch(teamKey) + pts;
      } else {
        // NORMAL → CHALLENGE
        updates[`challengeScore.${teamKey}`] = curChal(teamKey) + pts;
      }
    }

    // Challenge win check only for non-bonus made shots
    let wonNow = null;
    let winLogRef = null;
    if (made && !isBonusShot && target > 0) {
      const newChallengeScore = curChal(teamKey) + pts;
      if (newChallengeScore >= target) {
        updates[`matchScore.${teamKey}`] =
          (updates[`matchScore.${teamKey}`] ?? curMatch(teamKey)) + pointsForWin;

        // Create the win log now and capture its ID
        winLogRef = doc(logsRef);
        wonNow = {
          team: teamKey,
          atIndex: Number(game.currentChallengeIndex ?? 0),
          scoreA: teamKey === 'A' ? newChallengeScore : curChal('A'),
          scoreB: teamKey === 'B' ? newChallengeScore : curChal('B'),
          pointsForWin,
          winLogId: winLogRef.id,
          ts: serverTimestamp(),
        };
        updates['challengeWon'] = wonNow;
      }
    }

    if (Object.keys(updates).length > 0) tx.update(gameRef, updates);

    // Write attempt log
    const attemptRef = doc(logsRef);
    tx.set(attemptRef, {
      playerId, shotType, made, moneyball,
      team: teamKey,
      challengeIndex: game.currentChallengeIndex,
      ts: serverTimestamp(),
    });

    // Write the win log if we had a win
    if (wonNow && winLogRef) {
      tx.set(winLogRef, {
        type: 'challenge_win',
        byPlayerId: playerId,
        team: teamKey,
        challengeIndex: game.currentChallengeIndex,
        pointsForWin: wonNow.pointsForWin,
        ts: serverTimestamp(),
        tag: 'GameWinner',
      });
    }
  });
};

// For MVP we require a specific log to undo
export const undoLastActionForPlayer = async () => {
  throw new Error('For MVP, pass a specific logId to undo using deleteLogAndReverse');
};

// Delete a log and reverse its scoring (also reverts wins + removes win log)
export const deleteLogAndReverse = async (gameId, log) => {
  const gameRef = doc(db, 'games', gameId);
  const logRef  = doc(db, 'games', gameId, 'logs', log.id);

  let needFallbackWinCleanup = false;
  let fallbackTeam = null;
  let fallbackIndex = null;

  await runTransaction(db, async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists()) throw new Error('Game not found');
    const game = gameSnap.data();

    const { shotType, made, moneyball, team, challengeIndex } = log;
    const pts = Number(shotPoints({ shotType, made, moneyball })) || 0;

    const curMatch = (k) => Number(game.matchScore?.[k] ?? 0) || 0;
    const curChal  = (k) => Number(game.challengeScore?.[k] ?? 0) || 0;

    const updates = {};

    // Reverse the attempt contribution
    if (made) {
      if (shotType === 'bonus') {
        updates[`matchScore.${team}`] = Math.max(0, curMatch(team) - pts);
      } else {
        updates[`challengeScore.${team}`] = Math.max(0, curChal(team) - pts);
      }
    }

    // Was this the winning shot? If so, revert the win AND delete its win log.
    const cw = game.challengeWon || null;
    const wasWinningShot =
      !!cw &&
      made === true &&
      shotType !== 'bonus' &&
      cw.team === team &&
      Number(cw.atIndex ?? -1) === Number(challengeIndex ?? -2);

    if (wasWinningShot) {
      const pfw = Number(cw.pointsForWin ?? 0) || 0;
      updates[`matchScore.${team}`] = Math.max(0, (updates[`matchScore.${team}`] ?? curMatch(team)) - pfw);
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

    // Finally, delete the attempt log itself
    tx.delete(logRef);
  });

  // Fallback cleanup (for old games without winLogId)
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
};

/* ========================= Bonus / End / Clock ========================= */

// Simple flag setter for bonus mode
export const toggleBonusRound = async (gameId, on) =>
  updateDoc(doc(db, 'games', gameId), { bonusActive: !!on });

// High-level helpers used by the UI:
// startBonusMode: stop clock, set 3:00, mark bonusActive true. Do not auto-start.
export const startBonusMode = async (gameId) => {
  await stopClock(gameId);
  await setClockSeconds(gameId, 180);
  await toggleBonusRound(gameId, true);
};

// endBonusMode: simply flip the flag and leave clock as-is
export const endBonusMode = async (gameId) => {
  await toggleBonusRound(gameId, false);
};

export const endGame = async (gameId) =>
  updateDoc(doc(db, 'games', gameId), { status: 'ended' });

// Set absolute clock seconds (does not start it)
export const setClockSeconds = async (gameId, seconds) => {
  const secs = Math.max(0, Number(seconds) || 0);
  await updateDoc(doc(db, 'games', gameId), { clockSeconds: secs });
};

// Start the clock: mark running + lastStartAt
export const startClock = async (gameId) => {
  await updateDoc(doc(db, 'games', gameId), {
    clockRunning: true,
    lastStartAt: serverTimestamp(),
  });
};

// Stop the clock: compute remaining, stop, clear lastStartAt
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

// Reset the clock to a value and stop it
export const resetClockSeconds = async (gameId, seconds) => {
  const secs = Math.max(0, Number(seconds) || 0);
  await updateDoc(doc(db, 'games', gameId), {
    clockSeconds: secs,
    clockRunning: false,
    lastStartAt: null,
  });
};

/* ========================= Challenge Progression ========================= */

// Advance to the next challenge; clears current challenge scores and win
export const advanceToNextChallenge = async (gameId) => {
  const gameRef = doc(db, 'games', gameId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error('Game not found');
    const g = snap.data() || {};
    const cur = Number(g.currentChallengeIndex ?? 0);
    const total = Number(g.sequenceChallengeIds?.length ?? 1);
    const next = Math.min(cur + 1, Math.max(0, total - 1));
    tx.update(gameRef, {
      currentChallengeIndex: next,
      challengeScore: { A: 0, B: 0 },
      challengeWon: null,
    });
  });
};
