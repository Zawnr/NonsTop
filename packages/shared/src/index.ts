export * from './hlc.ts';
export * from './merge.ts';
export * from './sync.ts';
// Contracts shared by the web client and the server.
// Every request body the server accepts is validated with these schemas.
import { z } from 'zod';

export const loginRequest = z.object({
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const pushSubscriptionRequest = z.object({
  // Push services are always HTTPS. Rejecting other schemes stops the server from posting to arbitrary hosts.
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
  deviceLabel: z.string().max(100).optional(),
});
export type PushSubscriptionRequest = z.infer<typeof pushSubscriptionRequest>;

export interface SessionInfo {
  authenticated: boolean;
}

export interface HealthInfo {
  ok: true;
  version: string;
}

export interface PushPublicKey {
  publicKey: string;
}

export interface PushTestResult {
  sent: number;
  failed: number;
}
