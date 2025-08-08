// src/services/statService.js
const empty = () => ({ makes: 0, attempts: 0 });

export const computeStatsFromLogs = (logs) => {
  const byPlayer = new Map();
  logs.forEach(l => {
    if (!l.playerId || !('made' in l)) return;
    const p = l.playerId;
    if (!byPlayer.has(p)) {
      byPlayer.set(p, { mid: empty(), long: empty(), bonus: empty(), gamechanger: empty() });
    }
    const entry = byPlayer.get(p);
    const bucket = entry[l.shotType];
    if (!bucket) return;
    bucket.attempts += 1;
    if (l.made) bucket.makes += 1;
  });

  const out = {};
  for (const [pid, v] of byPlayer.entries()) {
    const overallAttempts = v.mid.attempts + v.long.attempts;
    const overallMakes = v.mid.makes + v.long.makes;
    out[pid] = {
      mid: { ...v.mid, pct: v.mid.attempts ? (v.mid.makes / v.mid.attempts) * 100 : 0 },
      long: { ...v.long, pct: v.long.attempts ? (v.long.makes / v.long.attempts) * 100 : 0 },
      bonus: { ...v.bonus, pct: v.bonus.attempts ? (v.bonus.makes / v.bonus.attempts) * 100 : 0 },
      gamechanger: { ...v.gamechanger, pct: v.gamechanger.attempts ? (v.gamechanger.makes / v.gamechanger.attempts) * 100 : 0 },
      overall: {
        makes: overallMakes,
        attempts: overallAttempts,
        pct: overallAttempts ? (overallMakes / overallAttempts) * 100 : 0
      }
    };
  }
  return out;
};
