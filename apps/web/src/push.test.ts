import { describe, expect, it } from 'vitest';
import { deviceLabel, sameKey, urlBase64ToUint8Array } from './push.ts';

describe('push helpers', () => {
  it('decodes base64url VAPID keys', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID_-8'))).toEqual([1, 2, 3, 255, 239]);
  });

  it('detects a subscription made with a different VAPID key', () => {
    const key = new Uint8Array([1, 2, 3]);
    expect(sameKey(new Uint8Array([1, 2, 3]).buffer, key)).toBe(true);
    expect(sameKey(new Uint8Array([1, 2, 4]).buffer, key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
  });

  it('labels devices from the user agent', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; vivo)')).toBe('Android');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
  });
});
