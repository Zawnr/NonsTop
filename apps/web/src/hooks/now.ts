// The current time, refreshed on every minute (or faster), for countdowns on screen.
import { useEffect, useState } from 'react';

export function useNow(stepMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      // Wake just after the next step boundary, so "5 menit" turns into "4 menit" on the minute.
      timer = setTimeout(() => (setNow(new Date()), schedule()), stepMs - (Date.now() % stepMs) + 50);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [stepMs]);
  return now;
}
