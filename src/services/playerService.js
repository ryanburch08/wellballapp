// src/services/playerService.js
// Per-game roster helpers: jersey numbers + face photos.
// Docs live at: games/{gameId}/roster/{playerId}
// { jerseyNumber: number|null, faceUrl: string|null, updatedAt, createdAt, createdBy }

import {
  collection, doc, setDoc, updateDoc, getDoc, getDocs,
  onSnapshot, serverTimestamp, writeBatch
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage, auth } from './firebase';

// ---- internals ----
const rosterCol = (gameId) => collection(db, 'games', gameId, 'roster');
const rosterDoc = (gameId, playerId) => doc(db, 'games', gameId, 'roster', playerId);

const ensureRosterDoc = async (gameId, playerId) => {
  const r = rosterDoc(gameId, playerId);
  const snap = await getDoc(r);
  if (!snap.exists()) {
    await setDoc(r, {
      jerseyNumber: null,
      faceUrl: null,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || 'unknown',
      updatedAt: serverTimestamp(),
    });
  }
  return r;
};

// ---- public API ----

/**
 * Subscribe full roster.
 * cb(itemsArray, jerseyMapByNumber)
 */
export const listenRoster = (gameId, cb) => {
  return onSnapshot(rosterCol(gameId), (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const jerseyMap = {};
    for (const it of items) {
      const n = Number(it.jerseyNumber);
      if (Number.isFinite(n)) {
        if (!jerseyMap[n]) jerseyMap[n] = [];
        jerseyMap[n].push(it.id);
      }
    }
    cb(items, jerseyMap);
  });
};

export const getRoster = async (gameId) => {
  const snap = await getDocs(rosterCol(gameId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

/**
 * Ensure roster docs exist for a list of players (no overwrites).
 */
export const ensureRosterDocsForPlayers = async (gameId, playerIds = []) => {
  const ids = Array.isArray(playerIds) ? playerIds.filter(Boolean) : [];
  for (const pid of ids) {
    // sequential to avoid excessive writes; roster is small
    // (you can batch if you prefer, but this keeps behavior simple)
    await ensureRosterDoc(gameId, pid);
  }
};

/**
 * Set/clear jersey number for one player.
 */
export const setJerseyNumber = async (gameId, playerId, jerseyNumber) => {
  await ensureRosterDoc(gameId, playerId);
  const n = jerseyNumber == null || jerseyNumber === ''
    ? null
    : Math.max(0, Number(jerseyNumber) || 0);
  await updateDoc(rosterDoc(gameId, playerId), {
    jerseyNumber: n,
    updatedAt: serverTimestamp(),
  });
};

/**
 * Optional: bulk set jersey numbers in one go.
 * map: { [playerId]: number|null }
 */
export const setJerseyNumbersBulk = async (gameId, map = {}) => {
  const batch = writeBatch(db);
  for (const [playerId, val] of Object.entries(map)) {
    const refDoc = rosterDoc(gameId, playerId);
    const n = val == null || val === '' ? null : Math.max(0, Number(val) || 0);
    batch.set(refDoc, {
      jerseyNumber: n,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
};

/**
 * Save/replace a face photo from a local file URI (Expo camera/image-picker)
 */
export const saveFacePhoto = async (gameId, playerId, localUri) => {
  if (!localUri) throw new Error('No photo selected');

  // Fetch file into a Blob (Expo-friendly)
  const res = await fetch(localUri);
  const blob = await res.blob();

  const path = `games/${gameId}/faces/${playerId}.jpg`;
  const sref = ref(storage, path);
  await uploadBytes(sref, blob, { contentType: 'image/jpeg' });
  const url = await getDownloadURL(sref);

  await ensureRosterDoc(gameId, playerId);
  await updateDoc(rosterDoc(gameId, playerId), {
    faceUrl: url,
    updatedAt: serverTimestamp(),
  });

  // Optional: also backfill a profile doc if you keep one
  // try {
  //   const pRef = doc(db, 'profiles', playerId);
  //   const pSnap = await getDoc(pRef);
  //   const hasFace = pSnap.exists() && !!pSnap.data()?.faceUrl;
  //   if (!hasFace) await setDoc(pRef, { faceUrl: url, updatedAt: serverTimestamp() }, { merge: true });
  // } catch {}
  return url;
};

/**
 * Remove face photo: clears faceUrl and deletes the storage object.
 */
export const removeFacePhoto = async (gameId, playerId) => {
  const path = `games/${gameId}/faces/${playerId}.jpg`;
  const sref = ref(storage, path);

  // Best-effort delete; ignore missing files
  try { await deleteObject(sref); } catch (_) {}

  await ensureRosterDoc(gameId, playerId);
  await updateDoc(rosterDoc(gameId, playerId), {
    faceUrl: null,
    updatedAt: serverTimestamp(),
  });
};

/**
 * Find players that currently have the given jersey number.
 * Returns array of playerIds.
 */
export const findPlayersByJersey = async (gameId, jerseyNumber) => {
  const n = Number(jerseyNumber);
  if (!Number.isFinite(n)) return [];
  const items = await getRoster(gameId);
  return items.filter(it => Number(it.jerseyNumber) === n).map(it => it.id);
};

/**
 * Utility for UI: detect duplicate jersey numbers.
 * Pass the `items` array from listenRoster/getRoster.
 * Returns an object like { 23: ['uidA','uidB'], 11: ['uidX','uidY','uidZ'] }
 */
export const computeJerseyConflicts = (items = []) => {
  const map = {};
  for (const it of items) {
    const n = Number(it.jerseyNumber);
    if (Number.isFinite(n)) {
      if (!map[n]) map[n] = [];
      map[n].push(it.id);
    }
  }
  // keep only duplicates
  Object.keys(map).forEach(k => {
    if (map[k].length < 2) delete map[k];
  });
  return map;
};
