// src/services/reviewQueueService.js
import {
  collection, doc, getDoc, updateDoc, serverTimestamp, runTransaction
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { logShot } from './gameService';

const markResolved = async (gameId, reviewId, patch = {}) => {
  await updateDoc(doc(db, 'games', gameId, 'review_queue', reviewId), {
    resolved: true,
    resolvedAt: serverTimestamp(),
    resolvedBy: auth.currentUser?.uid || 'unknown',
    ...patch,
  });
};

export const approveReviewItem = async (gameId, reviewId) => {
  const ref = doc(db, 'games', gameId, 'review_queue', reviewId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Review item not found');
  const r = snap.data();

  await logShot(gameId, {
    playerId: r.playerId,
    shotType: r.shotType,
    made: !!r.made,
    moneyball: !!r.moneyball,

    source: 'review',
    confidence: r.confidence ?? null,
    evidence: { reviewId },

    zone: r.zone ?? null,
    shotKey: r.shotKey ?? null,
    spotNumber: r.spotNumber ?? null,
    startSpotId: r.startSpotId ?? null,
    shotSpotId: r.shotSpotId ?? null,
  });

  await markResolved(gameId, reviewId, { decision: 'approved' });
};

export const editAndApproveReviewItem = async (gameId, reviewId, patchFields) => {
  // patchFields may include playerId, shotType, made, moneyball, zone, shotKey, etc.
  const ref = doc(db, 'games', gameId, 'review_queue', reviewId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Review item not found');
  const r = { ...snap.data(), ...patchFields };

  await logShot(gameId, {
    playerId: r.playerId,
    shotType: r.shotType,
    made: !!r.made,
    moneyball: !!r.moneyball,

    source: 'review_edit',
    confidence: r.confidence ?? null,
    evidence: { reviewId, edited: true },

    zone: r.zone ?? null,
    shotKey: r.shotKey ?? null,
    spotNumber: r.spotNumber ?? null,
    startSpotId: r.startSpotId ?? null,
    shotSpotId: r.shotSpotId ?? null,
  });

  await markResolved(gameId, reviewId, { decision: 'approved_edit', editPatch: patchFields });
};

export const rejectReviewItem = async (gameId, reviewId, reason = 'rejected') => {
  await markResolved(gameId, reviewId, { decision: 'rejected', rejectReason: reason });
};
