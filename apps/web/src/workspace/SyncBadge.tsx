import { useSyncNow, useSyncStatus } from '../data/workspace.tsx';

const LABEL = {
  synced: 'Tersinkron',
  pending: 'Menunggu',
  offline: 'Offline',
  error: 'Error sinkron',
} as const;

/** Sync status (F-62): tersinkron, menunggu, or error. Click to sync now. */
export function SyncBadge() {
  const status = useSyncStatus();
  const sync = useSyncNow();
  const pending = status.pending > 0 ? ` · ${status.pending} menunggu` : '';
  const label = status.state === 'pending' ? `Menunggu${status.pending ? ` (${status.pending})` : ''}` : `${LABEL[status.state]}${status.state === 'synced' ? '' : pending}`;
  return (
    <button className={`sync-badge sync-${status.state}`} onClick={sync} title="Sinkron sekarang" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      <span data-testid="sync-status">{label}</span>
    </button>
  );
}
