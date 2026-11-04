// Hybrid logical clock. An HLC string sorts in time order with plain string comparison:
//   "<13-digit wall ms>-<4-hex counter>-<device id>"
// The device id at the end breaks ties, so two devices never produce equal timestamps.
export type Hlc = string;

const MAX_COUNTER = 0xffff;
const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HLC_PATTERN = /^(\d{13})-([0-9a-f]{4})-([A-Za-z0-9_-]{1,64})$/;

export interface HlcParts {
  ms: number;
  counter: number;
  deviceId: string;
}

export function isDeviceId(value: string): boolean {
  return DEVICE_ID.test(value);
}

export function formatHlc({ ms, counter, deviceId }: HlcParts): Hlc {
  return `${String(ms).padStart(13, '0')}-${counter.toString(16).padStart(4, '0')}-${deviceId}`;
}

export function parseHlc(hlc: string): HlcParts | null {
  const m = HLC_PATTERN.exec(hlc);
  if (!m) return null;
  return { ms: Number(m[1]), counter: parseInt(m[2]!, 16), deviceId: m[3]! };
}

export function isHlc(value: string): boolean {
  return HLC_PATTERN.test(value);
}

/** Negative if a is older than b, positive if newer, 0 if equal. `null` (never written) is oldest. */
export function compareHlc(a: Hlc | null | undefined, b: Hlc | null | undefined): number {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a < b ? -1 : 1;
}

export interface ClockState {
  ms: number;
  counter: number;
}

export class HlcClock {
  private ms: number;
  private counter: number;

  constructor(
    readonly deviceId: string,
    private readonly wallClock: () => number = Date.now,
    state: ClockState = { ms: 0, counter: 0 },
  ) {
    if (!isDeviceId(deviceId)) throw new Error(`Invalid device id: ${deviceId}`);
    this.ms = state.ms;
    this.counter = state.counter;
  }

  /** A new timestamp, strictly greater than every timestamp this clock has issued or received. */
  now(): Hlc {
    const wall = this.wallClock();
    if (wall > this.ms) {
      this.ms = wall;
      this.counter = 0;
    } else {
      this.bump();
    }
    return formatHlc({ ms: this.ms, counter: this.counter, deviceId: this.deviceId });
  }

  /** Moves the clock past a timestamp seen from another device. Invalid input is ignored. */
  receive(hlc: Hlc): void {
    const parts = parseHlc(hlc);
    if (!parts) return;
    if (parts.ms > this.ms) {
      this.ms = parts.ms;
      this.counter = parts.counter;
    } else if (parts.ms === this.ms && parts.counter > this.counter) {
      this.counter = parts.counter;
    }
  }

  state(): ClockState {
    return { ms: this.ms, counter: this.counter };
  }

  private bump() {
    if (this.counter >= MAX_COUNTER) {
      this.ms += 1;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
  }
}
