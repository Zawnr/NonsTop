import { describe, expect, it } from 'vitest';
import { compareHlc, formatHlc, HlcClock, parseHlc } from '../src/hlc.ts';

describe('HlcClock', () => {
  it('formats sortable timestamps', () => {
    const a = formatHlc({ ms: 999, counter: 15, deviceId: 'a' });
    expect(a).toBe('0000000000999-000f-a');
    expect(parseHlc(a)).toEqual({ ms: 999, counter: 15, deviceId: 'a' });
    expect(parseHlc('nope')).toBeNull();
  });

  it('is strictly increasing even when the wall clock stands still or goes back', () => {
    let wall = 1000;
    const clock = new HlcClock('dev1', () => wall);
    const seen = [clock.now(), clock.now()];
    wall = 500; // clock moved backwards
    seen.push(clock.now());
    wall = 2000;
    seen.push(clock.now());
    for (let i = 1; i < seen.length; i++) expect(compareHlc(seen[i], seen[i - 1])).toBeGreaterThan(0);
  });

  it('moves past timestamps received from a device with a faster clock', () => {
    const slow = new HlcClock('slow', () => 1000);
    const fast = new HlcClock('fast', () => 5000);
    const remote = fast.now();
    slow.receive(remote);
    expect(compareHlc(slow.now(), remote)).toBeGreaterThan(0);
  });

  it('ignores invalid received timestamps', () => {
    const clock = new HlcClock('d', () => 10);
    clock.receive('garbage');
    expect(clock.state()).toEqual({ ms: 0, counter: 0 });
  });

  it('rolls the counter over into the next millisecond', () => {
    const clock = new HlcClock('d', () => 10, { ms: 10, counter: 0xffff });
    expect(parseHlc(clock.now())).toMatchObject({ ms: 11, counter: 0 });
  });

  it('breaks ties between devices by device id', () => {
    const a = new HlcClock('a', () => 10).now();
    const b = new HlcClock('b', () => 10).now();
    expect(compareHlc(a, b)).toBeLessThan(0);
    expect(compareHlc(null, a)).toBeLessThan(0);
    expect(compareHlc(a, a)).toBe(0);
  });

  it('restores from saved state', () => {
    const first = new HlcClock('d', () => 10);
    const last = first.now();
    const restored = new HlcClock('d', () => 5, first.state());
    expect(compareHlc(restored.now(), last)).toBeGreaterThan(0);
  });
});
