// src/hooks/useAutoCoordinator.js
import { useEffect, useRef } from 'react';
import { listenAutoEvents, submitProposal } from '../services/autoTrackingService';
import { fuseEventsToProposals, ingestFused } from '../services/coordinatorFuser';

export default function useAutoCoordinator({ game, gameId, rosterMap }) {
  const bufferRef = useRef([]);

  useEffect(() => {
    if (!gameId) return;
    const off = listenAutoEvents(gameId, (evs) => { bufferRef.current = evs; });
    const interval = setInterval(async () => {
      if (!game || game.paused || !game.autoMode?.enabled) return;
      const proposals = fuseEventsToProposals({ game, events: bufferRef.current, rosterMap, thresholds:{} });
      await ingestFused({ gameId, proposals, ingestThreshold: game.autoMode?.ingestThreshold ?? 0.85 });
    }, 800);
    return () => { off && off(); clearInterval(interval); };
  }, [gameId, game, rosterMap]);
}
