import { useSyncExternalStore } from 'react';
import { player, type PlayerSnapshot } from '../lib/player';

export function usePlayer(): PlayerSnapshot {
  return useSyncExternalStore((cb) => {
    const off = player.subscribe(cb);
    return () => {
      off();
    };
  }, player.getSnapshot);
}
