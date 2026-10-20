import type { Room } from '@colyseus/core';
import { sessionPolicy } from '../../../shared/SessionPolicy';

/** Transport heartbeats and unchanged input packets are not user activity. */
export class RoomInactivity {
  private readonly activity = new Map<string, number>();
  private readonly expiring = new Set<string>();
  constructor(private readonly room: Pick<Room, 'clock' | 'clients' | 'onMessage'>) {
    room.onMessage('session:activity', (client, raw: unknown) => { if (raw === null) this.touch(client.sessionId); });
    room.clock.setInterval(() => this.check(), 1000);
  }
  join(id: string): void { this.activity.set(id, this.room.clock.elapsedTime); this.expiring.delete(id); }
  touch(id: string): void { if (this.activity.has(id) && !this.expiring.has(id)) this.activity.set(id, this.room.clock.elapsedTime); }
  input(id: string, next: { active: boolean; f: number; r: number; y: number; p: number; j?: boolean; c?: boolean; s?: boolean }, previous: { y: number; p: number; c?: boolean; s?: boolean }): void {
    if (next.active && (next.f !== 0 || next.r !== 0 || next.j || next.c !== previous.c || next.s !== previous.s ||
      Math.abs(next.y - previous.y) > .001 || Math.abs(next.p - previous.p) > .001)) this.touch(id);
  }
  check(now = this.room.clock.elapsedTime): void {
    for (const client of this.room.clients) {
      const last = this.activity.get(client.sessionId);
      if (last === undefined || now - last < sessionPolicy.idleMs || this.expiring.has(client.sessionId)) continue;
      this.expiring.add(client.sessionId);
      client.leave(sessionPolicy.idleCloseCode, 'Inactive for 5 minutes');
    }
  }
  remove(id: string): void { this.activity.delete(id); this.expiring.delete(id); }
}
