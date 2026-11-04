import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Login } from './Login.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

describe('Login', () => {
  it('calls onLogin after a successful login', async () => {
    mockFetch(200, { authenticated: true });
    const onLogin = vi.fn();
    render(<Login onLogin={onLogin} />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Masuk' }));
    await vi.waitFor(() => expect(onLogin).toHaveBeenCalled());
  });

  it('shows a message for a wrong password', async () => {
    mockFetch(401, { error: 'wrong_password' });
    render(<Login onLogin={() => {}} />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Masuk' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Password salah.');
  });
});
