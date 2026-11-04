import { useCallback, useEffect, useState } from 'react';
import { api, isOfflineError } from './api.ts';
import { Login } from './pages/Login.tsx';
import { WorkspaceProvider } from './data/workspace.tsx';
import { Workspace } from './workspace/Workspace.tsx';

type State = 'loading' | 'in' | 'out' | 'offline';

/** Set after a successful login. Lets the app open from local data when the server cannot be reached. */
const SIGNED_IN_KEY = 'nonstop:signedIn';

export function App() {
  const [state, setState] = useState<State>('loading');

  const signIn = useCallback(() => {
    localStorage.setItem(SIGNED_IN_KEY, '1');
    setState('in');
  }, []);
  const signOut = useCallback(() => {
    localStorage.removeItem(SIGNED_IN_KEY);
    setState('out');
  }, []);

  useEffect(() => {
    api
      .session()
      .then((s) => (s.authenticated ? signIn() : signOut()))
      .catch((err) => {
        if (isOfflineError(err) && localStorage.getItem(SIGNED_IN_KEY)) setState('in');
        else setState('offline');
      });
  }, [signIn, signOut]);

  if (state === 'loading') return null;
  if (state === 'offline') {
    return (
      <main className="center">
        <p>Server tidak terjangkau. Login sekali saat online, setelah itu NonsTop bisa dipakai offline.</p>
      </main>
    );
  }
  if (state === 'out') return <Login onLogin={signIn} />;
  return (
    <WorkspaceProvider onUnauthorized={signOut}>
      <Workspace onLogout={signOut} />
    </WorkspaceProvider>
  );
}
