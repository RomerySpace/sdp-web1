import { Client, type Room } from '@colyseus/sdk';
import { admissionConfig, type AdmissionUpdate } from '../../shared/Admission';

export class AdmissionClient {
  private waiting?: Room;
  private cancel?: () => void;
  private generation = 0;
  token = '';
  constructor(private readonly client: Client) {
    try { this.token = sessionStorage.getItem('sdp:admission') || ''; } catch {}
  }
  async enter(update: (position: number) => void): Promise<string> {
    const generation = this.generation;
    const room = await this.client.joinOrCreate(admissionConfig.room, { admissionToken: this.token || undefined });
    if (generation !== this.generation) { await room.leave(); throw new Error('Entry cancelled.'); }
    this.waiting = room; room.reconnection.enabled = false;
    try {
      return await new Promise<string>((resolve, reject) => {
        this.cancel = () => reject(new Error('Entry cancelled.'));
        room.onMessage<AdmissionUpdate>('queue:status', status => {
          if (typeof status.token !== 'string' || !Number.isInteger(status.position)) return;
          this.token = status.token;
          try { sessionStorage.setItem('sdp:admission', this.token); } catch {}
          update(status.position);
          if (status.ready) resolve(this.token);
        });
        room.onLeave(() => reject(new Error('Waiting room disconnected. Reconnecting without losing your place.')));
        room.onError(() => reject(new Error('Waiting room unavailable.')));
        room.send('queue:sync');
      });
    } finally {
      this.cancel = undefined; this.waiting = undefined;
      await room.leave().catch(() => {});
    }
  }
  stop(): void { this.generation++; this.cancel?.(); if (this.waiting) void this.waiting.leave().catch(() => {}); }
}
