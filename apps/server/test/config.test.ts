import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.ts';

const base = { NONSTOP_PASSWORD_HASH: 'h', VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k' };

describe('config', () => {
  it('names missing variables', () => {
    expect(() => loadConfig({})).toThrow(/NONSTOP_PASSWORD_HASH, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY/);
  });

  it('applies safe defaults', () => {
    const c = loadConfig(base);
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(8787);
    expect(c.backupHour).toBe(3);
  });

  it('rejects bad values', () => {
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, BACKUP_HOUR: '24' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, COOKIE_SECURE: 'yes' })).toThrow(ConfigError);
  });
});
