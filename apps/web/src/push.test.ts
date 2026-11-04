import { describe, expect, it } from 'vitest';
import { deviceLabel, urlBase64ToUint8Array } from './push.ts';

describe('push helpers', () => {
  it('decodes base64url VAPID keys', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID_-8'))).toEqual([1, 2, 3, 255, 239]);
  });

  it('labels devices from the user agent', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; vivo)')).toBe('Android');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
  });
});
