// Keeps installed apps on the current version. A PWA otherwise runs its old code until it is fully
// closed, and an old version cannot read data types added later.
import { registerSW } from 'virtual:pwa-register';

/** Delay after the app is hidden before reloading, so pending saves (300-400 ms debounce) finish. */
const RELOAD_DELAY_MS = 1000;

export function setupAppUpdates() {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Look for a new version whenever the app comes back to the screen.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update().catch(() => undefined);
      });
    },
  });

  if (!('serviceWorker' in navigator)) return;
  const hadController = navigator.serviceWorker.controller !== null;
  let waiting = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first install also fires this; only a replaced worker means new code.
    if (!hadController || waiting) return;
    waiting = true;
    // Reload while the user is not looking, never in the middle of typing.
    const reloadWhenHidden = () => {
      if (document.visibilityState !== 'hidden') return;
      setTimeout(() => document.visibilityState === 'hidden' && location.reload(), RELOAD_DELAY_MS);
    };
    document.addEventListener('visibilitychange', reloadWhenHidden);
    reloadWhenHidden();
  });
}
