import { Cloud, CloudOff, LoaderCircle, TriangleAlert } from 'lucide-react';
import { syncNow, useSync } from '../sync/sync';
import { useUI } from '../store/ui';
import { relativeTime } from '../lib/dates';

export function SyncBadge() {
  const { status, message, lastSync } = useSync();
  const openSettings = () => useUI.getState().set({ settingsOpen: true });

  if (status === 'off')
    return (
      <button className="sync-badge off" onClick={openSettings} title="Sync is off. Set it up in Settings.">
        <CloudOff size={15} />
      </button>
    );
  const title =
    status === 'syncing' ? 'Syncing…' : message || (lastSync ? `Synced ${relativeTime(lastSync)}` : 'Waiting to sync');
  return (
    <button className={`sync-badge ${status}`} onClick={() => syncNow()} title={`${title}. Click to sync now.`}>
      {status === 'syncing' ? (
        <LoaderCircle size={15} className="spin" />
      ) : status === 'idle' ? (
        <Cloud size={15} />
      ) : status === 'offline' ? (
        <CloudOff size={15} />
      ) : (
        <TriangleAlert size={15} />
      )}
    </button>
  );
}
