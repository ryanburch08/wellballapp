// src/services/ingestHelpers.js
import { listenCourtConfig, spotToShotType, spotToMeta } from './courtService';

const cache = new Map(); // gameId -> courtCfg

export const startCourtCfgCache = (gameId) =>
  listenCourtConfig(gameId, (cfg) => cache.set(gameId, cfg));

export const stopCourtCfgCache = (gameId, unsub) => {
  if (typeof unsub === 'function') unsub();
  cache.delete(gameId);
};

// Normalize a raw proposal before enqueue/auto-accept.
export const applyCourtMappingToProposal = (gameId, raw) => {
  const cfg = cache.get(gameId);
  const out = { ...raw };

  // Fill base shotType if missing
  if (!out.shotType && typeof out.spotNumber === 'number') {
    const base = spotToShotType(out.spotNumber, cfg);
    if (base) out.shotType = base;
  }

  // Attach rich meta (zone, shotKey, label) for UI + analytics
  if (typeof out.spotNumber === 'number') {
    const meta = spotToMeta(out.spotNumber, cfg);
    if (meta) {
      out.shotMeta = meta;        // { shotType, zone, shotKey, label }
      // Keep top-level convenience fields too:
      out.shotKey = meta.shotKey; // e.g., 'mid_corner'
      out.zone = meta.zone;       // e.g., 'corner'
    }
  }

  // Map detector boolean to canonical flag
  if (Object.prototype.hasOwnProperty.call(out, 'moneyballDetected')) {
    out.moneyball = !!out.moneyballDetected;
  }

  return out;
};
