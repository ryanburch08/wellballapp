// src/services/cameraService.js
import {
  addDoc, collection, doc, onSnapshot, serverTimestamp, updateDoc, query, orderBy
} from 'firebase/firestore';
import { db, auth } from './firebase';

/** Roles you expect for full auto capture (edit as needed) */
export const REQUIRED_ROLES = ['rim_top', 'baseline_left', 'baseline_right'];

/** Subscribe to all cameras in a game */
export const listenCameras = (gameId, cb) => {
  const col = collection(db, 'games', gameId, 'cameras');
  // order is just for stable rendering; presence is what matters
  const qy = query(col, orderBy('name', 'asc'));
  return onSnapshot(qy, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cb(items);
  });
};

/** Update camera state (status: 'idle'|'ready'|'streaming'|'error', etc.) */
export const markCameraState = async (gameId, cameraId, patch = {}) => {
  await updateDoc(doc(db, 'games', gameId, 'cameras', cameraId), {
    ...patch,
    lastSeen: serverTimestamp(),
  });
};

/** Register a new camera document (if you want to create programmatically) */
export const registerCamera = async (gameId, { name, role, notes = '' }) => {
  const ref = await addDoc(collection(db, 'games', gameId, 'cameras'), {
    name: name || 'Unnamed',
    role: role || 'rim_top',
    notes,
    createdAt: serverTimestamp(),
    registeredBy: auth.currentUser?.uid || 'unknown',
    calibrated: false,
    status: 'idle',  // idle | ready | streaming | error
    lastSeen: null,
  });
  return ref.id;
};

/** Start a lightweight heartbeat for THIS device (call from a camera client screen) */
const _hbTimers = {};
export const startCameraHeartbeat = (gameId, cameraId, { status = 'ready' } = {}) => {
  const ref = doc(db, 'games', gameId, 'cameras', cameraId);
  const tick = async () => {
    try {
      await updateDoc(ref, { status, lastSeen: serverTimestamp() });
    } catch {}
  };
  // initial pulse + interval
  tick();
  stopCameraHeartbeat(cameraId);
  _hbTimers[cameraId] = setInterval(tick, 4000);
  return () => stopCameraHeartbeat(cameraId);
};

export const stopCameraHeartbeat = (cameraId) => {
  if (_hbTimers[cameraId]) {
    clearInterval(_hbTimers[cameraId]);
    delete _hbTimers[cameraId];
  }
};

/** Helper: compute online + readiness */
export const computeReadiness = (cameras, {
  requiredRoles = REQUIRED_ROLES,
  offlineAfterMs = 10000,
  nowMs = Date.now(),
} = {}) => {
  const byRole = {};
  const onlineByRole = new Set();
  const details = cameras.map((c) => {
    const lastMs = c?.lastSeen?.toMillis ? c.lastSeen.toMillis() : (c?.lastSeen ? Date.parse(c.lastSeen) : 0);
    const online = !!lastMs && (nowMs - lastMs) < offlineAfterMs;
    if (c?.role) {
      byRole[c.role] = byRole[c.role] || [];
      byRole[c.role].push(c);
      if (online) onlineByRole.add(c.role);
    }
    const ready = online && (c?.status === 'ready' || c?.status === 'streaming') && (!!c?.calibrated || c?.calibrated === true);
    return { ...c, online, ready };
  });

  const missing = requiredRoles.filter((r) => !onlineByRole.has(r));
  const allReady = requiredRoles.every((r) => {
    const list = byRole[r] || [];
    return list.some((c) => {
      const lastMs = c?.lastSeen?.toMillis ? c.lastSeen.toMillis() : (c?.lastSeen ? Date.parse(c.lastSeen) : 0);
      const online = !!lastMs && (nowMs - lastMs) < offlineAfterMs;
      return online && (c?.status === 'ready' || c?.status === 'streaming') && (!!c?.calibrated || c?.calibrated === true);
    });
  });

  return { details, missing, allReady, byRole };
};
