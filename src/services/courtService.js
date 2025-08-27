// src/services/courtService.js
import { db } from './firebase';
import {
  doc, setDoc, getDoc, onSnapshot, serverTimestamp
} from 'firebase/firestore';

/**
 * Canonical keys & helpers
 * - shotType: 'mid' | 'long' | 'gamechanger'   (backward-compatible)
 * - zone: 'corner' | 'wing' | 'elbow' | 'top' | 'gc'
 * - shotKey: combines both for clarity, e.g.:
 *   'mid_corner', 'long_corner', 'mid_wing', 'long_wing',
 *   'mid_elbow', 'long_elbow', 'mid_top', 'long_top', 'gamechanger'
 */

export const buildShotKey = (shotType, zone) => {
  if (shotType === 'gamechanger' || zone === 'gc') return 'gamechanger';
  if (!shotType || !zone) return null;
  return `${shotType}_${zone}`;
};

export const toDisplayLabel = (shotKey) => {
  if (shotKey === 'gamechanger') return 'Gamechanger';
  const [st, z] = String(shotKey || '').split('_'); // st: mid/long
  const range = st === 'mid' ? 'Midrange' : st === 'long' ? 'Long-range' : '';
  const zone =
    z === 'corner' ? 'Corner' :
    z === 'wing'   ? 'Wing'   :
    z === 'elbow'  ? 'Elbow'  :
    z === 'top'    ? 'Top'    : '';
  return `${range} ${zone}`.trim();
};

// ----- Default mapping (from your specification) -----
// 1 & 15  = long-range corner
// 2 & 16  = mid-range corner
// 3 & 13  = long-range wing
// 4 & 14  = mid-range wing
// 5 & 11  = long-range elbow
// 6 & 12  = mid-range elbow
// 7 & 9   = long-range top
// 8 & 10  = mid-range top
// 17 & 18 = gamechangers
export const DEFAULT_SPOT_MAP = {
  1:  { shotType: 'long',        zone: 'corner', shotKey: 'long_corner' },
  15: { shotType: 'long',        zone: 'corner', shotKey: 'long_corner' },
  2:  { shotType: 'mid',         zone: 'corner', shotKey: 'mid_corner' },
  16: { shotType: 'mid',         zone: 'corner', shotKey: 'mid_corner' },

  3:  { shotType: 'long',        zone: 'wing',   shotKey: 'long_wing' },
  13: { shotType: 'long',        zone: 'wing',   shotKey: 'long_wing' },
  4:  { shotType: 'mid',         zone: 'wing',   shotKey: 'mid_wing' },
  14: { shotType: 'mid',         zone: 'wing',   shotKey: 'mid_wing' },

  5:  { shotType: 'long',        zone: 'elbow',  shotKey: 'long_elbow' },
  11: { shotType: 'long',        zone: 'elbow',  shotKey: 'long_elbow' },
  6:  { shotType: 'mid',         zone: 'elbow',  shotKey: 'mid_elbow' },
  12: { shotType: 'mid',         zone: 'elbow',  shotKey: 'mid_elbow' },

  7:  { shotType: 'long',        zone: 'top',    shotKey: 'long_top' },
  9:  { shotType: 'long',        zone: 'top',    shotKey: 'long_top' },
  8:  { shotType: 'mid',         zone: 'top',    shotKey: 'mid_top' },
  10: { shotType: 'mid',         zone: 'top',    shotKey: 'mid_top' },

  17: { shotType: 'gamechanger', zone: 'gc',     shotKey: 'gamechanger' },
  18: { shotType: 'gamechanger', zone: 'gc',     shotKey: 'gamechanger' },
};

/* ------------------ NEW: compatibility exports ------------------ */
// These two exports make your court service compatible with the
// Challenge Manager / Sequence Builder and challengeRules utilities.

// Sorted numeric list of valid spot IDs
export const ALL_SPOT_IDS = Object.keys(DEFAULT_SPOT_MAP)
  .map((k) => Number(k))
  .sort((a, b) => a - b);

// Meta by spot id, including a simple 'range' and display label.
// range: 'mid' | 'long' | 'gamechanger'
const rangeFromShotType = (st) => (st === 'mid' || st === 'long') ? st : 'gamechanger';

export const SPOT_META = Object.fromEntries(
  Object.entries(DEFAULT_SPOT_MAP).map(([k, v]) => {
    const id = Number(k);
    const range = rangeFromShotType(v.shotType);
    return [id, {
      id,
      range,              // 'mid'|'long'|'gamechanger'
      label: toDisplayLabel(v.shotKey),
      shotKey: v.shotKey, // e.g. 'mid_corner'
      zone: v.zone,       // 'corner'|'wing'|'elbow'|'top'|'gc'
      shotType: v.shotType,
    }];
  })
);
/* --------------------------------------------------------------- */

// Court config lives at: games/{gameId}/config/court
const courtDocRef = (gameId) => doc(db, 'games', gameId, 'config', 'court');

export const listenCourtConfig = (gameId, cb) => {
  const ref = courtDocRef(gameId);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      cb({ spotMap: DEFAULT_SPOT_MAP, swapSides: false, updatedAt: null });
    } else {
      const data = snap.data() || {};
      // normalize any legacy entries missing shotKey
      const norm = {};
      Object.entries({ ...DEFAULT_SPOT_MAP, ...(data.spotMap || {}) }).forEach(([k, v]) => {
        const st = v?.shotType || DEFAULT_SPOT_MAP[k]?.shotType || null;
        const z  = v?.zone     || DEFAULT_SPOT_MAP[k]?.zone     || null;
        norm[k] = { shotType: st, zone: z, shotKey: buildShotKey(st, z) };
      });
      cb({ ...data, spotMap: norm });
    }
  });
};

export const loadCourtConfig = async (gameId) => {
  const snap = await getDoc(courtDocRef(gameId));
  if (!snap.exists()) return { spotMap: DEFAULT_SPOT_MAP, swapSides: false, updatedAt: null };
  const data = snap.data() || {};
  const norm = {};
  Object.entries({ ...DEFAULT_SPOT_MAP, ...(data.spotMap || {}) }).forEach(([k, v]) => {
    const st = v?.shotType || DEFAULT_SPOT_MAP[k]?.shotType || null;
    const z  = v?.zone     || DEFAULT_SPOT_MAP[k]?.zone     || null;
    norm[k] = { shotType: st, zone: z, shotKey: buildShotKey(st, z) };
  });
  return { ...data, spotMap: norm };
};

export const saveCourtConfig = async (gameId, config) => {
  // Merge with defaults; enforce shotKey
  const merged = { ...DEFAULT_SPOT_MAP, ...(config?.spotMap || {}) };
  const spotMap = {};
  Object.entries(merged).forEach(([k, v]) => {
    const st = v?.shotType || DEFAULT_SPOT_MAP[k]?.shotType || null;
    const z  = v?.zone     || DEFAULT_SPOT_MAP[k]?.zone     || null;
    spotMap[k] = { shotType: st, zone: z, shotKey: buildShotKey(st, z) };
  });

  const clean = {
    spotMap,
    swapSides: !!config?.swapSides,
    updatedAt: serverTimestamp(),
  };
  await setDoc(courtDocRef(gameId), clean, { merge: true });
  return clean;
};

// Backward-compat: returns only the base shotType (mid/long/gamechanger)
export const spotToShotType = (spotNumber, courtCfg) => {
  const s = Number(spotNumber);
  const map = (courtCfg?.spotMap) || DEFAULT_SPOT_MAP;
  return map[s]?.shotType || null;
};

// Rich meta for detectors & review UI
export const spotToMeta = (spotNumber, courtCfg) => {
  const s = Number(spotNumber);
  const map = (courtCfg?.spotMap) || DEFAULT_SPOT_MAP;
  const entry = map[s];
  if (!entry) return null;
  return {
    shotType: entry.shotType,     // 'mid' | 'long' | 'gamechanger'
    zone: entry.zone,             // 'corner' | 'wing' | 'elbow' | 'top' | 'gc'
    shotKey: entry.shotKey,       // e.g., 'mid_corner'
    label: toDisplayLabel(entry.shotKey),
  };
};
