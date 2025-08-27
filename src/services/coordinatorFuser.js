// src/services/coordinatorFuser.js
import { submitProposal } from './autoTrackingService';
import { md5 } from './hashTiny';

const TIME_WINDOW_MS = 320;
const toBonusType = (zone) => zone === 'mid' ? 'bonus_mid' : zone === 'long' ? 'bonus_long' : 'bonus_gc';

export function fuseEventsToProposals({ game, events, rosterMap={}, thresholds={} }) {
  const buckets = new Map();
  for (const ev of events) {
    if (!ev.ballTrackId || !ev.t) continue;
    const key = `${ev.ballTrackId}|${Math.round(ev.t / TIME_WINDOW_MS)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(ev);
  }

  const proposals = [];
  for (const group of buckets.values()) {
    const rim = group.find(g => g.kind === 'net' || g.kind === 'rim');
    const shooters = group.filter(g => g.kind === 'release');
    if (!shooters.length) continue;

    const jerseyCounts = {};
    for (const s of shooters) if (s.jerseyNo)
      jerseyCounts[s.jerseyNo] = (jerseyCounts[s.jerseyNo] || 0) + (s?.conf?.shooter || 0.5);

    const bestJersey = Object.entries(jerseyCounts).sort((a,b) => b[1]-a[1])[0]?.[0];
    const shooterEv = bestJersey
      ? shooters.find(s => s.jerseyNo === bestJersey) || shooters[0]
      : shooters[0];

    const mapped = bestJersey ? rosterMap[bestJersey] : null;
    const playerId = mapped?.playerId || shooterEv.playerId || null;
    const team = mapped?.team || shooterEv.team || null;

    const zoneEv = shooters.slice().sort((a,b) => (b?.conf?.zone||0)-(a?.conf?.zone||0))[0];
    let zone = zoneEv?.zone || 'mid';
    const spotId = zoneEv?.spotId || null;

    const made = rim ? (rim.kind === 'net') : !!group.find(g=>g.kind==='net');
    const moneyball = shooters.some(s => s.moneyball && (s?.conf?.moneyball ?? 0) >= (thresholds.moneyball || 0.6));
    const shotType = game?.bonusActive ? toBonusType(zone) : zone;

    const conf = {
      shooter: shooterEv?.conf?.shooter ?? 0.6,
      outcome: rim ? (rim?.conf?.outcome ?? 0.99) : 0.7,
      zone: zoneEv?.conf?.zone ?? 0.7,
      moneyball: moneyball ? 0.9 : 0.1,
    };
    const overall = 0.4*conf.shooter + 0.4*conf.outcome + 0.2*conf.zone;

    const t = Math.min(...group.map(g => g.t));
    const shotId = md5(`${t}|${shooterEv?.playerTrackId||'p?'}|${group[0].ballTrackId}|${zone}|${made?'1':'0'}`);

    proposals.push({
      shotId, t, playerId, team, shotType, made, moneyball, zone, spotId,
      confidence: { overall, ...conf },
      evidence: { cams: [...new Set(group.map(g=>g.sourceCam))], clipPaths: group.map(g=>g.clipPath).filter(Boolean) }
    });
  }
  return proposals;
}

export async function ingestFused({ gameId, proposals, ingestThreshold=0.85 }) {
  for (const p of proposals) {
    if ((p?.confidence?.overall ?? 0) >= ingestThreshold) {
      await submitProposal(gameId, p.shotId, p); // coordinator writes proposal; operator can auto-accept or review
    }
  }
}
