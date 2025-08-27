// src/services/challengeRules.js

/**
 * Challenge shot rules:
 * {
 *   mode: 'allow' | 'deny',         // default 'allow'
 *   items: ['mid_*','long_corner','gamechanger', ...],  // patterns
 *   validation: 'none' | 'soft' | 'strict',             // default 'soft'
 *   requireRange: boolean,          // default true
 *   requireZone: boolean,           // default false (manual entries often lack zone)
 * }
 *
 * Shot object we check:
 * { shotType: 'mid'|'long'|'gamechanger', zone?: 'corner'|'wing'|'elbow'|'top'|'gc', shotKey?: 'mid_corner'|... }
 *
 * Matching rules:
 *  - 'gamechanger' matches GC.
 *  - 'mid_*' means any mid zone; 'long_*' means any long zone.
 *  - 'mid_corner' or 'long_elbow' etc. are precise zone+range.
 */

import { spotToMeta } from './courtService';

const WILDS = new Set(['mid_*', 'long_*', 'gamechanger']);

const normRule = (r) => ({
  mode: r?.mode === 'deny' ? 'deny' : 'allow',
  items: Array.isArray(r?.items) ? r.items.map(String) : [],
  validation: r?.validation === 'strict' ? 'strict' : r?.validation === 'none' ? 'none' : 'soft',
  requireRange: r?.requireRange !== false, // default true
  requireZone: !!r?.requireZone,           // default false
});

const shotToKey = (s) => {
  if (s?.shotType === 'gamechanger') return 'gamechanger';
  if (!s?.shotType) return null;
  return s?.zone ? `${s.shotType}_${s.zone}` : `${s.shotType}_*`;
};

const matchOne = (pattern, shot) => {
  if (pattern === 'gamechanger') return shot?.shotType === 'gamechanger';
  if (pattern === 'mid_*') return shot?.shotType === 'mid';
  if (pattern === 'long_*') return shot?.shotType === 'long';
  // exact zone
  if (!shot?.zone) return false; // needs zone to match exact
  return `${shot.shotType}_${shot.zone}` === pattern;
};

export const shotMatchesRule = (shot, rawRule, { degradeWhenZoneUnknown = true } = {}) => {
  const rule = normRule(rawRule);
  // If validation disabled or no items → allow.
  if (rule.validation === 'none' || rule.items.length === 0) {
    return { ok: true, reason: null, matched: null };
  }

  // Range guard (if required)
  if (rule.requireRange && !shot?.shotType) {
    // no range given
    if (rule.validation === 'strict') {
      return { ok: false, reason: 'missing_range', matched: false };
    }
    return { ok: true, reason: 'missing_range_soft', matched: false };
  }

  // Zone guard (optional)
  const needsExactZone = rule.items.some(it => !WILDS.has(it) && it !== 'gamechanger');
  const zoneUnknown = !shot?.zone && shot?.shotType !== 'gamechanger';

  if (needsExactZone && zoneUnknown) {
    // If we can degrade (treat as wildcard mid_* or long_*), try that.
    if (degradeWhenZoneUnknown) {
      const assumed = { shotType: shot.shotType, zone: undefined };
      const matchedWildcard = rule.items.some(it => matchOne(it, assumed));
      if (matchedWildcard) {
        // allowed by wildcard; still mark as partial
        return { ok: true, reason: 'zone_unknown_but_range_ok', matched: true };
      }
      // range fails the allowlist, or hits denylist → treat as mismatch but soft unless strict
      return rule.validation === 'strict'
        ? { ok: false, reason: 'zone_required_but_unknown', matched: false }
        : { ok: true, reason: 'zone_required_but_unknown_soft', matched: false };
    }
    // No degrade allowed
    return rule.validation === 'strict'
      ? { ok: false, reason: 'zone_required_but_unknown', matched: false }
      : { ok: true, reason: 'zone_required_but_unknown_soft', matched: false };
  }

  // Pattern evaluation
  const allowed = rule.mode === 'allow';
  const anyMatch = rule.items.some(it => matchOne(it, shot));

  if (allowed) {
    // Allowlist: must match one
    if (anyMatch) return { ok: true, reason: null, matched: true };
    return rule.validation === 'strict'
      ? { ok: false, reason: 'not_in_allowlist', matched: false }
      : { ok: true, reason: 'not_in_allowlist_soft', matched: false };
  } else {
    // Denylist: must NOT match any
    if (anyMatch) {
      return rule.validation === 'strict'
        ? { ok: false, reason: 'in_denylist', matched: false }
        : { ok: true, reason: 'in_denylist_soft', matched: false };
    }
    return { ok: true, reason: null, matched: true };
  }
};

export const describeRule = (rawRule) => {
  const r = normRule(rawRule);
  if (r.validation === 'none' || r.items.length === 0) return 'Any shot allowed';
  const join = r.items.join(', ');
  const base = r.mode === 'allow' ? `Allowed: ${join}` : `Denied: ${join}`;
  const extra = [];
  if (r.requireZone) extra.push('zone required');
  if (r.requireRange) extra.push('range required');
  if (r.validation !== 'soft') extra.push(r.validation);
  return [base, extra.length ? `(${extra.join(', ')})` : ''].filter(Boolean).join(' ');
};

/* ========================= NEW: conveniences & presets ========================= */

/** Normalize a shot input (spotId | shot object) into {shotType, zone?, shotKey?} */
export const ensureShotObject = (input, courtCfg) => {
  // If a spot id was passed in, resolve via court map:
  if (typeof input === 'number' || (typeof input === 'string' && /^\d+$/.test(input))) {
    const meta = spotToMeta(Number(input), courtCfg);
    if (!meta) return null;
    return { shotType: meta.shotType, zone: meta.zone, shotKey: meta.shotKey };
  }

  // If a partial shot object was passed:
  if (input && typeof input === 'object') {
    const s = { ...input };
    // Derive shotType/zone from shotKey if missing
    if (!s.shotType && typeof s.shotKey === 'string') {
      if (s.shotKey === 'gamechanger') s.shotType = 'gamechanger';
      else {
        const [st, z] = s.shotKey.split('_');
        s.shotType = st || s.shotType;
        s.zone = z || s.zone;
      }
    }
    // Derive shotKey if missing
    if (!s.shotKey) s.shotKey = shotToKey(s);
    return { shotType: s.shotType, zone: s.zone, shotKey: s.shotKey };
  }

  return null;
};

/** Evaluate a whole challenge doc (with .shotRule) against a shot */
export const shotMatchesChallenge = (challengeDoc, shot, opts) => {
  const rule = challengeDoc?.shotRule || null;
  const normShot = ensureShotObject(shot, opts?.courtCfg);
  return shotMatchesRule(normShot, rule, opts);
};

/** Turn strings/arrays/objects into a valid rule object */
export const coerceShotRule = (ruleLike) => {
  // Already an object → normalize
  if (ruleLike && typeof ruleLike === 'object' && !Array.isArray(ruleLike)) {
    return normRule(ruleLike);
  }

  // Comma-separated string → items
  if (typeof ruleLike === 'string') {
    const key = ruleLike.trim().toLowerCase();
    if (key === 'any' || key === 'none') {
      return { mode: 'allow', items: [], validation: 'none', requireRange: true, requireZone: false };
    }
    if (key === 'mid' || key === 'mid_*') return normRule({ mode: 'allow', items: ['mid_*'] });
    if (key === 'long' || key === 'long_*') return normRule({ mode: 'allow', items: ['long_*'] });
    if (key === 'gc' || key === 'gamechanger') return normRule({ mode: 'allow', items: ['gamechanger'], requireRange: false });
    if (key === 'no_gc') return normRule({ mode: 'deny', items: ['gamechanger'] });

    const items = key.split(',').map(s => s.trim()).filter(Boolean);
    return normRule({ mode: 'allow', items });
  }

  // Array of patterns
  if (Array.isArray(ruleLike)) {
    return normRule({ mode: 'allow', items: ruleLike });
  }

  // Fallback: allow anything (validation none)
  return { mode: 'allow', items: [], validation: 'none', requireRange: true, requireZone: false };
};

/** Human-short label for a rule (good for chips/tooltips) */
export const describeRuleShort = (rawRule) => {
  const r = normRule(rawRule);
  if (r.validation === 'none' || r.items.length === 0) return 'Any';
  const base = r.mode === 'allow' ? r.items.join(', ') : `No: ${r.items.join(', ')}`;
  const flags = [];
  if (r.requireZone) flags.push('zone');
  if (r.validation === 'strict') flags.push('strict');
  return flags.length ? `${base} (${flags.join('·')})` : base;
};

/** Handy presets for common challenges */
export const RULE_PRESETS = {
  ANY_SHOT:          { mode: 'allow', items: [], validation: 'none', requireRange: true,  requireZone: false },

  MID_ONLY:          { mode: 'allow', items: ['mid_*'], validation: 'soft', requireRange: true,  requireZone: false },
  LONG_ONLY:         { mode: 'allow', items: ['long_*'], validation: 'soft', requireRange: true,  requireZone: false },
  GC_ONLY:           { mode: 'allow', items: ['gamechanger'], validation: 'soft', requireRange: false, requireZone: false },

  NO_GC_DENY:        { mode: 'deny',  items: ['gamechanger'], validation: 'soft', requireRange: true,  requireZone: false },

  CORNERS_ONLY:      { mode: 'allow', items: ['mid_corner', 'long_corner'], validation: 'soft', requireRange: true, requireZone: true },
  WINGS_ONLY:        { mode: 'allow', items: ['mid_wing', 'long_wing'],     validation: 'soft', requireRange: true, requireZone: true },
  ELBOWS_ONLY:       { mode: 'allow', items: ['mid_elbow','long_elbow'],    validation: 'soft', requireRange: true, requireZone: true },
  TOP_ONLY:          { mode: 'allow', items: ['mid_top','long_top'],        validation: 'soft', requireRange: true, requireZone: true },

  MID_CORNER_ONLY:   { mode: 'allow', items: ['mid_corner'],  validation: 'soft', requireRange: true, requireZone: true },
  LONG_CORNER_ONLY:  { mode: 'allow', items: ['long_corner'], validation: 'soft', requireRange: true, requireZone: true },
  MID_WING_ONLY:     { mode: 'allow', items: ['mid_wing'],    validation: 'soft', requireRange: true, requireZone: true },
  LONG_WING_ONLY:    { mode: 'allow', items: ['long_wing'],   validation: 'soft', requireRange: true, requireZone: true },
  MID_ELBOW_ONLY:    { mode: 'allow', items: ['mid_elbow'],   validation: 'soft', requireRange: true, requireZone: true },
  LONG_ELBOW_ONLY:   { mode: 'allow', items: ['long_elbow'],  validation: 'soft', requireRange: true, requireZone: true },
  MID_TOP_ONLY:      { mode: 'allow', items: ['mid_top'],     validation: 'soft', requireRange: true, requireZone: true },
  LONG_TOP_ONLY:     { mode: 'allow', items: ['long_top'],    validation: 'soft', requireRange: true, requireZone: true },
};
