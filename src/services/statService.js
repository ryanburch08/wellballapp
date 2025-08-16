// src/services/statService.js
// Computes per-player stats from logs.
// Overall% = (mid + long) only, including moneyball attempts.
// Also returns separate buckets for moneyball and bonus and gamechanger.

const initBucket = () => ({ makes: 0, attempts: 0, pct: 0 });

const recalcPct = (b) => {
  const att = b.attempts || 0;
  b.pct = att > 0 ? (100 * (b.makes || 0)) / att : 0;
  return b;
};

export const computeStatsFromLogs = (logs = []) => {
  // logs are array of { playerId, shotType, made, moneyball, ... }
  const byPlayer = {};

  const ensure = (pid) => {
    if (!byPlayer[pid]) {
      byPlayer[pid] = {
        overall: initBucket(),    // mid + long (incl. moneyball)
        mid: initBucket(),
        long: initBucket(),
        moneyball: initBucket(),  // subset of mid/long with moneyball flag
        bonus: initBucket(),
        gamechanger: initBucket(),
      };
    }
    return byPlayer[pid];
  };

  for (const l of logs) {
    if (typeof l.made === 'undefined') continue; // skip system logs
    const pid = l.playerId;
    const s = ensure(pid);
    const made = !!l.made;

    if (l.shotType === 'mid' || l.shotType === 'long') {
      // per type
      const bucket = l.shotType === 'mid' ? s.mid : s.long;
      bucket.attempts += 1;
      if (made) bucket.makes += 1;

      // overall mid+long
      s.overall.attempts += 1;
      if (made) s.overall.makes += 1;

      // moneyball subset
      if (l.moneyball) {
        s.moneyball.attempts += 1;
        if (made) s.moneyball.makes += 1;
      }
    } else if (l.shotType === 'bonus') {
      s.bonus.attempts += 1;
      if (made) s.bonus.makes += 1;
    } else if (l.shotType === 'gamechanger') {
      s.gamechanger.attempts += 1;
      if (made) s.gamechanger.makes += 1;
    }
  }

  // pct for all buckets
  Object.values(byPlayer).forEach(p => {
    recalcPct(p.overall);
    recalcPct(p.mid);
    recalcPct(p.long);
    recalcPct(p.moneyball);
    recalcPct(p.bonus);
    recalcPct(p.gamechanger);
  });

  return byPlayer;
};
