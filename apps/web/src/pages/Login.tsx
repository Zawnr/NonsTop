import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api.ts';

const MESSAGES: Record<string, string> = {
  wrong_password: 'Password salah.',
  too_many_attempts: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.',
};

export function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onLogin();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(MESSAGES[code] ?? 'Tidak bisa terhubung ke server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center">
      <form className="card login" onSubmit={submit}>
        <img src="/icons/icon-192.png" alt="" width={56} height={56} />
        <h1>NonsTop</h1>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || password === ''}>
          {busy ? 'Masuk…' : 'Masuk'}
        </button>
      </form>
    </main>
  );
}
