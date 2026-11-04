// Wires the local store and sync engine into React.
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Conflict } from '@nonstop/shared';
import { api, ApiError, isOfflineError } from '../api.ts';
import { indexPages, normalizePage, type PageIndex } from '../model/pages.ts';
import { NonstopDb } from './db.ts';
import { LocalStore } from './store.ts';
import { SyncEngine, UnauthorizedError, type SyncStatus, type SyncTransport } from './sync-engine.ts';

interface Workspace {
  store: LocalStore;
  engine: SyncEngine;
}

const WorkspaceContext = createContext<Workspace | null>(null);

const transport: SyncTransport = {
  push: (ops) => api.syncPush(ops).catch(rethrowUnauthorized),
  pull: (since) => api.syncPull(since).catch(rethrowUnauthorized),
};

function rethrowUnauthorized(err: unknown): never {
  if (err instanceof ApiError && err.status === 401) throw new UnauthorizedError();
  throw err;
}

let shared: Promise<LocalStore> | null = null;
const openStore = () => (shared ??= LocalStore.open(new NonstopDb()));

export function WorkspaceProvider({ onUnauthorized, children }: { onUnauthorized: () => void; children: ReactNode }) {
  const [ws, setWs] = useState<Workspace | null>(null);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void openStore().then((store) => {
      if (cancelled) return;
      const engine = new SyncEngine(store, transport, { isOffline: isOfflineError, onUnauthorized });
      stop = engine.start();
      setWs({ store, engine });
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [onUnauthorized]);

  if (!ws) return null;
  return <WorkspaceContext.Provider value={ws}>{children}</WorkspaceContext.Provider>;
}

function useWorkspace(): Workspace {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error('useWorkspace outside WorkspaceProvider');
  return ws;
}

export const useStore = () => useWorkspace().store;

export function useSyncStatus(): SyncStatus {
  const { engine } = useWorkspace();
  return useSyncExternalStore(engine.subscribe, engine.getStatus);
}

export function useSyncNow(): () => void {
  const { engine } = useWorkspace();
  return () => void engine.sync();
}

/** Live index of all pages. Undefined until the first read from IndexedDB finishes. */
export function usePageIndex(): PageIndex | undefined {
  const { store } = useWorkspace();
  const records = useLiveQuery(() => store.db.page.toArray(), [store]);
  return useMemo(() => (records ? indexPages(records.map(normalizePage)) : undefined), [records]);
}

/** Unresolved conflicts ("other versions") for one page. */
export function usePageConflicts(pageId: string): Conflict[] {
  const { store } = useWorkspace();
  const rows = useLiveQuery(() => store.db.conflict.where('pageId').equals(pageId).toArray(), [store, pageId]);
  return useMemo(
    () => (rows ?? []).filter((c) => c.resolved === false && c.field !== undefined && c.hlc !== undefined) as Conflict[],
    [rows],
  );
}
