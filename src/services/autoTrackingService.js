// src/services/autoTrackingService.js
// Coordinator for automated stat-tracking.
// Listens to games/{gameId}/auto_events (status='pending') and, based on thresholds,
// either ingests directly (logShot with source:'auto') or pushes to a review queue.
// Also exposes setAutoMode() and a helper listenCameras().

import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  setDoc,
  updateDoc,
  addDoc,
  runTransaction,
  getDoc,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { logShot, listenToGame } from './gameService';
import { loadCurrentChallenge, shotMatchesRule, normalizeShotKey } from './challengeRules';
import { listenRoster } from './playerService';

/* ----------------------------------------------------------------------------
Schema (suggested; works with this coordinator)

games/{gameId}/auto_events/{eventId}:
{
  type: 'shot',
  playerId: string,
  team?: 'A'|'B',
  shotType: 'mid'|'long'|'gamechanger'|'bonus_mid'|'bonus_long'|'bonus_gc'|'bonus',
  made: boolean,
  moneyball?: boolean,
  confidence: number,        // 0..1
  zone?: 'corner'|'wing'|'elbow'|'top'|'gc',
  shotKey?: string,          // e.g. 'mid_corner', 'long_top', 'gc'
  spotNumber?: number,       // 1..18
  startSpotId?: string|null,
  shotSpotId?: string|null,
  sourceCamera?: string,     // deviceId
  ts: Timestamp,
  status?: 'pending'|'processing'|'ingested'|'queued'|'ignored'|'blocked'|'disabled',
  error?: string
}

games/{gameId}/review_queue/{reviewId}:
{
  eventId,
  playerId, shotType, made, moneyball,
  confidence, zone, shotKey, spotNumber, startSpotId, shotSpotId,
  sourceCamera,
  reason: 'low_confidence'|'blocked'|'bad_shape'|'rule_violation'|...,
  createdAt, createdBy
}

games/{gameId}:
{
  autoMode: {
    enabled: boolean,
    ingestThreshold: number, // default 0.85
    reviewThreshold: number, // default 0.65
    gateByClock: boolean,    // default true
    updatedAt, updatedBy
  }
}
---------------------------------------------------------------------------- */

// ---- Public API -------------------------------------------------------------

/**
 * Persist Auto-Mode config on the game doc.
 */
export const setAutoMode = async (
  gameId,
  {
    enabled,
    ingestThreshold = 0.85,
    reviewThreshold = 0.65,
    gateByClock = true,
  }
) => {
  const i = clamp01(ingestThreshold);
  const r = clamp01(reviewThreshold);
  if (r > i) {
    throw new Error('reviewThreshold must be ≤ ingestThreshold');
  }
  await updateDoc(doc(db, 'games', gameId), {
    autoMode: {
      enabled: !!enabled,
      ingestThreshold: i,
      reviewThreshold: r,
      gateByClock: !!gateByClock,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid || 'unknown',
    },
  });
};

/**
 * Launch the event consumer. Returns a stop() function.
 * Safe to call once per StatEntryScreen mount.
 */
export const startAutoCoordinator = (gameId) => {
  if (!gameId) return () => {};

  // ✅ FIX: collect all unsubs here
  const stoppers = [];

  // Live game state for gating
  let latestGame = null;
  const stopGame = listenToGame(gameId, (g) => {
    latestGame = g;
  });
  stoppers.push(() => stopGame && stopGame());

  // Roster → jersey number map
  let jerseyMap = {};
  const stopRoster = listenRoster(gameId, (_items, map) => {
    jerseyMap = map || {};
  });
  stoppers.push(() => stopRoster && stopRoster());

  // Wherever you resolve a candidate from camera events:
  function resolvePlayerIdFromCandidate(cand) {
    // prefer explicit playerId if detector gave one
    if (cand.playerId) return cand.playerId;

    // try jersey number
    const j = Number(cand.jerseyNumber);
    if (Number.isFinite(j) && jerseyMap[j] && jerseyMap[j].length) {
      // if multiple players share number, pick the one on the detected team (if provided)
      if (cand.team && jerseyMap[j].length > 1) {
        const list = jerseyMap[j].filter((pid) =>
          (
            ((latestGame?.teamAIds || []).includes(pid) && cand.team === 'A') ||
            ((latestGame?.teamBIds || []).includes(pid) && cand.team === 'B')
          )
        );
        if (list.length) return list[0];
      }
      return jerseyMap[j][0];
    }
    return null;
  }

  // Listen to pending events (oldest first). Feel free to tune the limit.
  const evCol = collection(db, 'games', gameId, 'auto_events');
  const qy = query(evCol, where('status', '==', 'pending'), orderBy('ts', 'asc'), limit(50));

  const stopEvents = onSnapshot(qy, (snap) => {
    snap
      .docChanges()
      .filter((c) => c.type === 'added')
      .forEach((c) => {
        const ref = c.doc.ref;
        // process each event in its own microtask to avoid blocking the snapshot thread
        setTimeout(() => safeProcessEvent(gameId, ref, latestGame), 0);
      });
  });
  stoppers.push(() => stopEvents && stopEvents());

  // ✅ Return a single cleanup that calls all unsubs
  return () => {
    stoppers.forEach((fn) => {
      try { fn && fn(); } catch {}
    });
  };
};

/**
 * Optional: live camera roster for UI status bars.
 */
export const listenCameras = (gameId, cb) => {
  const col = collection(db, 'games', gameId, 'cameras');
  return onSnapshot(col, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
};

// ---- Internal helpers -------------------------------------------------------

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

/**
 * Idempotent, transactionally claim an event for processing.
 * Returns the event snapshot data after claiming (or throws if already taken).
 */
const claimEvent = async (gameId, eventRef) => {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(eventRef);
    if (!snap.exists()) throw new Error('Event not found');
    const ev = snap.data();
    const st = ev.status || 'pending';
    if (st !== 'pending') throw new Error('Already handled');
    tx.update(eventRef, {
      status: 'processing',
      processingBy: auth.currentUser?.uid || 'system',
      processingAt: serverTimestamp(),
    });
  });
  const after = await getDoc(eventRef);
  return { id: after.id, ...after.data() };
};

const safeProcessEvent = async (gameId, eventRef, latestGame) => {
  let ev;
  try {
    ev = await claimEvent(gameId, eventRef);
  } catch {
    // Someone else took it — fine.
    return;
  }

  try {
    // Gate on autoMode present/enabled
    const gameSnap = await getDoc(doc(db, 'games', gameId));
    if (!gameSnap.exists()) throw new Error('Game not found');
    const game = gameSnap.data() || {};
    const auto = game.autoMode || {
      enabled: false,
      ingestThreshold: 0.85,
      reviewThreshold: 0.65,
      gateByClock: true,
    };

    if (!auto.enabled) {
      await updateDoc(eventRef, { status: 'disabled' });
      return;
    }

    // Pre-gate by clock/paused (also enforced in gameService)
    if (auto.gateByClock) {
      const g = latestGame || game;
      const clockOk =
        g?.status === 'live' && g?.clockRunning === true && g?.paused !== true;
      if (!clockOk) {
        await updateDoc(eventRef, {
          status: 'blocked',
          error: 'Clock not running or game paused',
          blockedAt: serverTimestamp(),
        });
        return;
      }
    }

    // Validate event shape
    const basicOk =
      ev?.type === 'shot' &&
      typeof ev?.playerId === 'string' &&
      typeof ev?.shotType === 'string' &&
      typeof ev?.made === 'boolean' &&
      typeof ev?.confidence === 'number';

    if (!basicOk) {
      const reviewId = await pushToReviewQueue(gameId, ev, eventRef.id, 'bad_shape');
      await updateDoc(eventRef, {
        status: 'queued',
        reviewId,
        queuedAt: serverTimestamp(),
      });
      return;
    }

    const conf = clamp01(ev.confidence);
    const ingestTh = clamp01(game.autoMode?.ingestThreshold ?? 0.85);
    const reviewTh = clamp01(game.autoMode?.reviewThreshold ?? 0.65);

    // Decide path
    if (conf >= ingestTh) {
      await ingestShot(gameId, ev, eventRef);
      return;
    }
    if (conf >= reviewTh) {
      const reviewId = await pushToReviewQueue(gameId, ev, eventRef.id, 'low_confidence');
      await updateDoc(eventRef, {
        status: 'queued',
        reviewId,
        queuedAt: serverTimestamp(),
      });
      return;
    }

    // Too low, ignore
    await updateDoc(eventRef, {
      status: 'ignored',
      ignoredAt: serverTimestamp(),
    });
  } catch (e) {
    await updateDoc(eventRef, {
      status: 'blocked',
      error: String(e?.message || e),
      blockedAt: serverTimestamp(),
    });
  }
};

const pushToReviewQueue = async (gameId, ev, eventId, reason) => {
  const ref = await addDoc(collection(db, 'games', gameId, 'review_queue'), {
    eventId,
    reason,
    playerId: ev.playerId ?? null,
    team: ev.team ?? null,
    shotType: ev.shotType ?? null,
    made: ev.made ?? null,
    moneyball: !!ev.moneyball,
    confidence: clamp01(ev.confidence ?? 0),
    zone: ev.zone ?? null,
    shotKey: deriveShotKey(ev.shotType, ev.zone, ev.shotKey),
    spotNumber: ev.spotNumber ?? null,
    startSpotId: ev.startSpotId ?? null,
    shotSpotId: ev.shotSpotId ?? null,
    sourceCamera: ev.sourceCamera ?? null,
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser?.uid || 'system',
  });
  return ref.id;
};

const ingestShot = async (gameId, ev, eventRef) => {
  // Load game + current challenge for rule check
  const gameSnap = await getDoc(doc(db, 'games', gameId));
  const challenge = await loadCurrentChallenge(gameSnap);

  // Build a canonical key for the rule system
  const key = normalizeShotKey(ev.shotType, ev.zone, ev.shotKey);

  // If there is a rule and it doesn't match, send to review
  const ruleRes = shotMatchesRule(challenge, {
    shotType: ev.shotType,
    zone: ev.zone,
    shotKey: key,
  });
  if (!ruleRes.ok) {
    const reviewId = await pushToReviewQueue(gameId, { ...ev, shotKey: key }, eventRef.id, 'rule_violation');
    await updateDoc(eventRef, {
      status: 'queued',
      reviewId,
      error: ruleRes.reason || 'rule_violation',
      queuedAt: serverTimestamp(),
    });
    return;
  }

  try {
    await logShot(gameId, {
      playerId: ev.playerId,
      shotType: ev.shotType,
      made: !!ev.made,
      moneyball: !!ev.moneyball,

      source: 'auto',
      confidence: clamp01(ev.confidence ?? 0),
      evidence: ev.sourceCamera ? { camera: ev.sourceCamera, eventId: eventRef.id } : { eventId: eventRef.id },

      zone: ev.zone ?? null,
      shotKey: key,
      spotNumber: ev.spotNumber ?? null,
      startSpotId: ev.startSpotId ?? null,
      shotSpotId: ev.shotSpotId ?? null,
    });

    await updateDoc(eventRef, {
      status: 'ingested',
      ingestedAt: serverTimestamp(),
      ingestedBy: auth.currentUser?.uid || 'system',
    });
  } catch (e) {
    const reviewId = await pushToReviewQueue(gameId, { ...ev, shotKey: key }, eventRef.id, 'blocked');
    await updateDoc(eventRef, {
      status: 'queued',
      reviewId,
      error: String(e?.message || e),
      queuedAt: serverTimestamp(),
    });
  }
};

// Derive a descriptive key when the detector didn’t provide one.
const deriveShotKey = (shotType, zone, provided) => {
  if (provided) return provided;
  if (!shotType) return null;
  if (shotType === 'gamechanger' || shotType === 'bonus_gc') return 'gc';
  const range =
    shotType === 'mid' || shotType === 'bonus_mid'
      ? 'mid'
      : shotType === 'long' || shotType === 'bonus_long'
      ? 'long'
      : null;
  if (!range) return null;
  const z = zone || 'unknown';
  return `${range}_${z}`; // e.g. "mid_corner", "long_top"
};
