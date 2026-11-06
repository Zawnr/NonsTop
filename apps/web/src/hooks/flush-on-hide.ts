// Saves held-back edits when they could otherwise be lost: the component unmounts, the app goes
// to the background (a phone may kill it there without warning), or the page is closed.
import { useEffect, useRef } from 'react';

export function useFlushOnHide(flush: () => void) {
  const latest = useRef(flush);
  latest.current = flush;
  useEffect(() => {
    const run = () => latest.current();
    const onHidden = () => document.visibilityState === 'hidden' && run();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', run);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', run);
      run();
    };
  }, []);
}
