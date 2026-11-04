import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { Login } from './pages/Login.tsx';
import { Home } from './pages/Home.tsx';

type State = 'loading' | 'in' | 'out' | 'offline';

export function App() {
  const [state, setState] = useState<State>('loading');

  useEffect(() => {
    api
      .session()
      .then((s) => setState(s.authenticated ? 'in' : 'out'))
      .catch(() => setState('offline'));
  }, []);

  if (state === 'loading') return null;
  if (state === 'offline') {
    return (
      <main className="center">
        <p>Server tidak terjangkau. Mode offline penuh hadir di sprint 1.</p>
      </main>
    );
  }
  if (state === 'out') return <Login onLogin={() => setState('in')} />;
  return <Home onLogout={() => setState('out')} />;
}
