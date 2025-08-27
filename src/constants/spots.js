// src/constants/spots.js
export const SPOTS = [
  // Long-range
  { id: 1,  label: 'LR Corner (L)',  zone: 'long',  side: 'left'  },
  { id: 3,  label: 'LR Wing (L)',    zone: 'long',  side: 'left'  },
  { id: 5,  label: 'LR Elbow (L)',   zone: 'long',  side: 'left'  },
  { id: 7,  label: 'LR Top (L)',     zone: 'long',  side: 'left'  },
  { id: 9,  label: 'LR Top (R)',     zone: 'long',  side: 'right' },
  { id: 11, label: 'LR Elbow (R)',   zone: 'long',  side: 'right' },
  { id: 13, label: 'LR Wing (R)',    zone: 'long',  side: 'right' },
  { id: 15, label: 'LR Corner (R)',  zone: 'long',  side: 'right' },

  // Mid-range
  { id: 2,  label: 'MR Corner (L)',  zone: 'mid',   side: 'left'  },
  { id: 4,  label: 'MR Wing (L)',    zone: 'mid',   side: 'left'  },
  { id: 6,  label: 'MR Elbow (L)',   zone: 'mid',   side: 'left'  },
  { id: 8,  label: 'MR Top (L)',     zone: 'mid',   side: 'left'  },
  { id: 10, label: 'MR Top (R)',     zone: 'mid',   side: 'right' },
  { id: 12, label: 'MR Elbow (R)',   zone: 'mid',   side: 'right' },
  { id: 14, label: 'MR Wing (R)',    zone: 'mid',   side: 'right' },
  { id: 16, label: 'MR Corner (R)',  zone: 'mid',   side: 'right' },

  // Game changers
  { id: 17, label: 'Game Changer (L)', zone: 'gamechanger', side: 'left'  },
  { id: 18, label: 'Game Changer (R)', zone: 'gamechanger', side: 'right' },
];

export const zoneToShotType = (zone, bonusActive) => {
  if (!bonusActive) return zone; // 'mid'|'long'|'gamechanger'
  return zone === 'mid' ? 'bonus_mid' : zone === 'long' ? 'bonus_long' : 'bonus_gc';
};
