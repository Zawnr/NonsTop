// Minimal client-side router on top of the History API.
import { useSyncExternalStore } from 'react';

export type Route = { name: 'home' } | { name: 'page'; id: string } | { name: 'trash' } | { name: 'settings' } | { name: 'quick' };

const listeners = new Set<() => void>();
window.addEventListener('popstate', () => listeners.forEach((l) => l()));

export function parseRoute(path: string): Route {
  const page = /^\/p\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  if (page) return { name: 'page', id: page[1]! };
  if (path === '/trash') return { name: 'trash' };
  if (path === '/settings') return { name: 'settings' };
  /** Quick note (F-50): the PWA shortcut opens this path. */
  if (path === '/quick') return { name: 'quick' };
  return { name: 'home' };
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  if (path === location.pathname) return;
  if (opts.replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  listeners.forEach((l) => l());
}

export const pagePath = (id: string) => `/p/${id}`;

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function useRoute(): Route {
  return parseRoute(usePath());
}
