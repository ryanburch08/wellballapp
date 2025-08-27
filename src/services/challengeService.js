// src/services/challengeService.js
import {
  collection, doc, setDoc, updateDoc, getDoc, getDocs,
  query, where, orderBy, limit, serverTimestamp, deleteDoc
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { DEFAULT_SPOT_MAP, spotToMeta } from './courtService';
// We only rely on the public API of challengeRules (no need to import DEFAULT_SHOT_RULE from there)
import { describeRule } from './challengeRules';

/* ----------------------------------------------------------------------------
Data stored:

challenges/{id} = {
  name, description,
  difficulty: 'easy'|'normal'|'hard',
  targetScore: number,              // challenge target
  pointsForWin: number,             // match points awarded on win
  shotRule: {                       // pattern-based rule (matches challengeRules.js)
    mode: 'allow'|'deny',
    items: string[],                // e.g. ['mid_*','long_corner','gamechanger']
    validation: 'none'|'soft'|'strict',
    requireRange: boolean,
    requireZone: boolean
  },
  // convenience: tags used for filtering lists
  tags: { ranges: ('mid'|'long'|'gc')[], spots: number[] },
  active: boolean,
  createdBy, createdAt, updatedAt
}

sequences/{id} = {
  name, description,
  challengeIds: string[], challengeCount: number,
  createdBy, createdAt, updatedAt
}
---------------------------------------------------------------------------- */

// ---------------------------- Defaults & Helpers ----------------------------

// Default rule: allow anything, validate softly, only require range (zone optional).
export const DEFAULT_SHOT_RULE = {
  mode: 'allow',
  items: [],              // empty + validation!=='none' means "any shot allowed" in our challengeRules
  validation: 'soft',
  requireRange: true,
  requireZone: false,
};

// Build a fast lookup of all spot ids and their meta from DEFAULT_SPOT_MAP
const ALL_SPOT_IDS = Object.keys(DEFAULT_SPOT_MAP).map((n) => Number(n));

// Turn a spot id → shotKey ('mid_corner', 'long_wing', 'gamechanger')
const spotIdToShotKey = (id) => {
  const m = spotToMeta(id, { spotMap: DEFAULT_SPOT_MAP });
  return m?.shotKey || null;
};

// Does a pattern (like 'mid_*', 'long_elbow', 'gamechanger') match a shotKey?
const patternMatchesShotKey = (pattern, shotKey) => {
  if (!pattern || !shotKey) return false;
  if (pattern === 'gamechanger') return shotKey === 'gamechanger';
  if (pattern === 'mid_*') return shotKey.startsWith('mid_');
  if (pattern === 'long_*') return shotKey.startsWith('long_');
  // exact
  return pattern === shotKey;
};

// Convert selected spot ids → pattern list
// - we keep exact patterns for exact zones
// - automatically add 'gamechanger' if a GC spot appears
// - optionally compress to wildcards if staff picked "all" spots of a range (small optimization)
const spotsToItems = (spotIds) => {
  const keys = new Set();
  (spotIds || []).forEach((id) => {
    const key = spotIdToShotKey(Number(id));
    if (key) keys.add(key);
  });

  // If staff selected ALL mid zones, compress to 'mid_*' (same for long)
  const allMid = ALL_SPOT_IDS
    .map((id) => spotIdToShotKey(id))
    .filter((k) => k && k.startsWith('mid_'));
  const allLong = ALL_SPOT_IDS
    .map((id) => spotIdToShotKey(id))
    .filter((k) => k && k.startsWith('long_'));

  const selectedMid = Array.from(keys).filter((k) => k.startsWith('mid_'));
  const selectedLong = Array.from(keys).filter((k) => k.startsWith('long_'));
  const selectedGC = Array.from(keys).includes('gamechanger');

  const items = new Set();

  if (selectedMid.length === allMid.length) {
    items.add('mid_*');
  } else {
    selectedMid.forEach((k) => items.add(k));
  }

  if (selectedLong.length === allLong.length) {
    items.add('long_*');
  } else {
    selectedLong.forEach((k) => items.add(k));
  }

  if (selectedGC) items.add('gamechanger');

  return Array.from(items);
};

// Convert pattern list back → concrete spot ids (handy for tags)
const itemsToSpots = (items) => {
  if (!Array.isArray(items) || !items.length) return [];
  const out = [];
  ALL_SPOT_IDS.forEach((id) => {
    const key = spotIdToShotKey(id);
    if (items.some((p) => patternMatchesShotKey(p, key))) out.push(id);
  });
  return out;
};

// Normalize any incoming "shotRule" from UI:
// - If it already looks like a pattern-based rule, clean it
// - If it looks like a legacy { allowedSpotIds, ... }, convert to pattern rule
export const normalizeShotRule = (raw = {}) => {
  // Legacy path: allowedSpotIds → items
  if (Array.isArray(raw.allowedSpotIds) || typeof raw.requireRange === 'string') {
    const items = spotsToItems(raw.allowedSpotIds || []);
    // Map legacy "requireRange" ('any'|'mid'|'long') to booleans:
    //  - we keep requireRange true (so range is required)
    //  - items list itself already enforces which ranges are allowed
    let requireZone = !!raw.requireZone; // legacy UIs sometimes toggle this
    return {
      mode: 'allow',
      items,
      validation: raw.validation === 'none' ? 'none' : raw.validation === 'strict' ? 'strict' : 'soft',
      requireRange: raw.requireRange !== false, // default true
      requireZone,
    };
  }

  // Pattern-based rule path
  const mode = raw?.mode === 'deny' ? 'deny' : 'allow';
  const items = Array.isArray(raw?.items) ? raw.items.map(String) : [];
  const validation = raw?.validation === 'none' ? 'none' : raw?.validation === 'strict' ? 'strict' : 'soft';
  const requireRange = raw?.requireRange !== false; // default true
  const requireZone = !!raw?.requireZone;

  return { mode, items, validation, requireRange, requireZone };
};

// Build filter tags from a rule so staff can search by range/spot
const deriveTags = (rule) => {
  const ranges = new Set();
  // infer ranges from items
  (rule.items || []).forEach((p) => {
    if (p === 'gamechanger') ranges.add('gc');
    else if (p.startsWith('mid_') || p === 'mid_*') ranges.add('mid');
    else if (p.startsWith('long_') || p === 'long_*') ranges.add('long');
  });
  // If nothing was specified and validation isn't 'none', default to both ranges.
  if (!ranges.size && rule.validation !== 'none') {
    ranges.add('mid'); ranges.add('long');
  }
  // derive concrete spots for convenience filters
  const spots = itemsToSpots(rule.items || []);
  return { ranges: Array.from(ranges), spots };
};

// ------------------------------- Challenges -------------------------------

const challengesCol = collection(db, 'challenges');

export const createChallenge = async (data) => {
  const uid = auth.currentUser?.uid || 'unknown';

  const {
    name = '',
    description = '',
    difficulty = 'normal',
    targetScore = 0,
    pointsForWin = 1,
    shotRule = DEFAULT_SHOT_RULE,
    active = true,
  } = data || {};

  if (!name.trim()) throw new Error('Challenge name is required');

  const cleanRule = normalizeShotRule(shotRule);
  const tags = deriveTags(cleanRule);

  const ref = doc(challengesCol);
  await setDoc(ref, {
    name: String(name).trim(),
    description: String(description || ''),
    difficulty: ['easy','normal','hard'].includes(difficulty) ? difficulty : 'normal',
    targetScore: Math.max(0, Number(targetScore) || 0),
    pointsForWin: Math.max(0, Number(pointsForWin) || 0),
    shotRule: cleanRule,
    tags,
    active: !!active,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    // a friendly explanation helpful in admin UIs
    shotRuleDescription: describeRule(cleanRule),
  });

  return ref.id;
};

export const updateChallenge = async (id, updates) => {
  const patch = { ...updates };
  if (patch.shotRule) {
    patch.shotRule = normalizeShotRule(patch.shotRule);
    patch.tags = deriveTags(patch.shotRule);
    patch.shotRuleDescription = describeRule(patch.shotRule);
  }
  patch.updatedAt = serverTimestamp();
  await updateDoc(doc(db, 'challenges', id), patch);
};

export const deleteChallenge = async (id) => {
  await deleteDoc(doc(db, 'challenges', id));
};

export const getChallenge = async (id) => {
  const s = await getDoc(doc(db, 'challenges', id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
};

// filters: { difficulty?: 'easy'|'normal'|'hard', range?: 'mid'|'long'|'gc', activeOnly?: boolean }
export const listChallenges = async (filters = {}) => {
  let q = challengesCol;
  const clauses = [];
  if (filters.difficulty && ['easy','normal','hard'].includes(filters.difficulty)) {
    clauses.push(where('difficulty', '==', filters.difficulty));
  }
  if (filters.activeOnly) clauses.push(where('active', '==', true));

  if (clauses.length === 1) q = query(q, clauses[0], orderBy('name'), limit(200));
  else if (clauses.length > 1) q = query(q, clauses[0], clauses[1], orderBy('name'), limit(200));
  else q = query(q, orderBy('name'), limit(200));

  const snap = await getDocs(q);
  let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (filters.range && ['mid','long','gc'].includes(filters.range)) {
    items = items.filter((c) => (c?.tags?.ranges || []).includes(filters.range));
  }
  return items;
};

// ------------------------------- Sequences --------------------------------

const sequencesCol = collection(db, 'sequences');

export const createSequence = async ({ name, description = '', challengeIds = [] }) => {
  const uid = auth.currentUser?.uid || 'unknown';
  if (!name?.trim()) throw new Error('Sequence name is required');
  const ids = Array.isArray(challengeIds) ? challengeIds.filter(Boolean) : [];
  const ref = doc(sequencesCol);
  await setDoc(ref, {
    name: String(name).trim(),
    description: String(description || ''),
    challengeIds: ids,
    challengeCount: ids.length,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
};

export const updateSequence = async (id, updates) => {
  const patch = { ...updates };
  if (Array.isArray(patch.challengeIds)) {
    patch.challengeIds = patch.challengeIds.filter(Boolean);
    patch.challengeCount = patch.challengeIds.length;
  }
  patch.updatedAt = serverTimestamp();
  await updateDoc(doc(db, 'sequences', id), patch);
};

export const deleteSequence = async (id) => {
  await deleteDoc(doc(db, 'sequences', id));
};

export const getSequence = async (id) => {
  const s = await getDoc(doc(db, 'sequences', id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
};

export const listSequences = async () => {
  const snap = await getDocs(query(sequencesCol, orderBy('name'), limit(200)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};
