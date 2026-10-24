import { randomUUID } from 'node:crypto';
import { ServerError } from '@colyseus/core';
import { admissionConfig, type AdmissionUpdate } from '../../../shared/Admission';
import { MAX_PLAYERS } from '../../../shared/MultiplayerProtocol';

interface Place { token: string; order: number; admitted: boolean; expires: number; owner?: string; watcher?: string }
export class Admission {
  enabled = false;
  capacity = MAX_PLAYERS;
  private sequence = 0;
  private readonly places = new Map<string, Place>();

  diagnostics(now = Date.now()) {
    const places = [...this.places.values()].filter(place => place.expires > now);
    return { capacity: this.capacity, admitted: places.filter(place => place.admitted).length,
      waiting: places.filter(place => !place.admitted && place.watcher).length,
      reservedWaiting: places.filter(place => !place.admitted && !place.watcher).length };
  }

  request(raw: unknown, watcher: string, now = Date.now()): string {
    this.tick(now);
    const existing = typeof raw === 'string' ? this.places.get(raw) : undefined;
    if (existing?.owner) throw new ServerError(409, 'This visit is already open.');
    if (existing?.watcher && existing.watcher !== watcher) throw new ServerError(409, 'This queue is already open.');
    if (existing) { existing.watcher = watcher; if (!existing.admitted) existing.expires = Infinity; return existing.token; }
    if (this.places.size >= admissionConfig.maxWaiting + this.capacity) throw new ServerError(429, 'The waiting room is full. Please try again shortly.');
    const token = randomUUID();
    this.places.set(token, { token, order: this.sequence++, admitted: false, expires: Infinity, watcher });
    this.tick(now); return token;
  }
  status(token: string): AdmissionUpdate | undefined {
    const p = this.places.get(token); if (!p) return;
    const ahead = [...this.places.values()].filter(other => !other.admitted && other.order <= p.order).length;
    return { token, position: p.admitted ? 0 : ahead, capacity: this.capacity, ready: p.admitted };
  }
  unwatch(token: string, watcher: string, now = Date.now()): void {
    const p = this.places.get(token); if (!p || p.watcher !== watcher) return;
    p.watcher = undefined;
    if (!p.owner) p.expires = now + (p.admitted ? admissionConfig.ticketMs : admissionConfig.reservationSeconds * 1000);
  }
  validate(token: unknown): void {
    if (!this.enabled) return;
    this.tick();
    if (typeof token !== 'string' || !this.places.get(token)?.admitted) throw new ServerError(403, 'Please enter through the waiting room.');
  }
  attach(token: unknown, owner: string): void {
    this.validate(token);
    const p = this.places.get(token as string);
    // A visit still owns its identity when capacity enforcement is disabled.
    if (!p) return;
    if (p.owner && p.owner !== owner) throw new ServerError(409, 'This visit is already open.');
    p.owner = owner; p.expires = Infinity;
  }
  release(owner: string, now = Date.now(), immediate = false): void {
    for (const p of this.places.values()) if (p.owner === owner) {
      p.owner = undefined; p.expires = immediate ? now : now + admissionConfig.ticketMs;
    }
    this.tick(now);
  }
  tick(now = Date.now()): void {
    for (const [token, p] of this.places) if (p.expires <= now) this.places.delete(token);
    let free = this.capacity - [...this.places.values()].filter(p => p.admitted).length;
    for (const p of [...this.places.values()].sort((a, b) => a.order - b.order)) {
      if (!p.admitted && p.watcher && free > 0) { p.admitted = true; p.expires = now + admissionConfig.ticketMs; free--; }
    }
  }
}
// Single-process coordination. Multiple processes/regions need a shared store before enabling a shared capacity.
export const admission = new Admission();
