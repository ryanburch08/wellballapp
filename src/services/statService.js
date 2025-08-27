// src/services/statService.js
// Computes per-player stats from logs.
// Overall% = (mid + long) only, including moneyball attempts.
// Also returns separate buckets for moneyball, bonus (total + sub-buckets), and gamechanger.

const initBucket = () => ({ makes: 0, attempts: 0, pct: 0 });

const recalcPct = (b) => {
  const att = b.attempts || 0;
  b.pct = att > 0 ? (100 * (b.makes || 0)) / att : 0;
  return b;
};

const isBonusType = (t) => t === 'bonus' || (typeof t === 'string' && t.startsWith('bonus_'));

export const computeStatsFromLogs = (logs = []) => {
  // logs are array of { playerId, shotType, made, moneyball, ... }
  const byPlayer = {};

  const ensure = (pid) => {
    if (!byPlayer[pid]) {
      byPlayer[pid] = {
        // Overall = mid + long (moneyball still counts inside those)
        overall: initBucket(),
        mid: initBucket(),
        long: initBucket(),

        // Moneyball subset of mid/long
        moneyball: initBucket(),

        // Gamechanger (normal, non-bonus)
        gamechanger: initBucket(),

        // Bonus: total + sub-buckets
        bonus: initBucket(),       // all bonus_* and legacy 'bonus'
        bonusMid: initBucket(),    // bonus_mid (+ legacy 'bonus')
        bonusLong: initBucket(),   // bonus_long
        bonusGc: initBucket(),     // bonus_gc
      };
    }
    return byPlayer[pid];
  };

  for (const l of logs) {
    if (typeof l?.made === 'undefined') continue; // skip system logs (e.g., challenge_win)
    const pid = l?.playerId;
    if (!pid) continue; // guard: some system logs may not have playerId
    const s = ensure(pid);
    const made = !!l.made;
    const t = l.shotType;

    // Normal challenge shots
    if (t === 'mid' || t === 'long') {
      const bucket = t === 'mid' ? s.mid : s.long;
      bucket.attempts += 1; if (made) bucket.makes += 1;

      // overall = mid + long only
      s.overall.attempts += 1; if (made) s.overall.makes += 1;

      // moneyball subset (only applies to mid/long)
      if (l.moneyball) {
        s.moneyball.attempts += 1; if (made) s.moneyball.makes += 1;
      }
      continue;
    }

    // Gamechanger (normal, not bonus variant)
    if (t === 'gamechanger') {
      s.gamechanger.attempts += 1; if (made) s.gamechanger.makes += 1;
      continue;
    }

    // Bonus family
    if (isBonusType(t)) {
      // Total bonus bucket
      s.bonus.attempts += 1; if (made) s.bonus.makes += 1;

      // Sub-buckets
      if (t === 'bonus' || t === 'bonus_mid') {
        s.bonusMid.attempts += 1; if (made) s.bonusMid.makes += 1;
      } else if (t === 'bonus_long') {
        s.bonusLong.attempts += 1; if (made) s.bonusLong.makes += 1;
      } else if (t === 'bonus_gc') {
        s.bonusGc.attempts += 1; if (made) s.bonusGc.makes += 1;
      }
      continue;
    }
  }

  // Recalculate pct for all buckets
  Object.values(byPlayer).forEach(p => {
    recalcPct(p.overall);
    recalcPct(p.mid);
    recalcPct(p.long);
    recalcPct(p.moneyball);
    recalcPct(p.gamechanger);
    recalcPct(p.bonus);
    recalcPct(p.bonusMid);
    recalcPct(p.bonusLong);
    recalcPct(p.bonusGc);
  });

  return byPlayer;
};
