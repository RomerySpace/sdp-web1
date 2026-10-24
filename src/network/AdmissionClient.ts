import { Client, type Room } from '@colyseus/sdk';
import { admissionConfig, type AdmissionUpdate } from '../../shared/Admission';

export class AdmissionClient {
  private waiting?: Room;
  private cancel?: () => void;
  private generation = 0;
  token = '';
  constructor(private readonly client: Client, private readonly storageKey = 'sdp:admission') {
    try { this.token = sessionStorage.getItem(this.storageKey) || ''; } catch {}
  }
  async enter(update: (position: number) => void, displayName?: string): Promise<string> {
    const generation = this.generation;
    const room = await this.client.joinOrCreate(admissionConfig.room, { admissionToken: this.token || undefined, displayName });
    if (generation !== this.generation) { await room.leave(); throw new Error('Entry cancelled.'); }
    this.waiting = room; room.reconnection.enabled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<string>((resolve, reject) => {
        const watch = () => {
          clearTimeout(watchdog);
          watchdog = setTimeout(() => {
            reject(new Error('Waiting room stopped responding. Reconnecting without losing your place.'));
            room.connection.close();
          }, admissionConfig.statusTimeoutMs);
        };
        this.cancel = () => reject(new Error('Entry cancelled.'));
        room.onMessage<AdmissionUpdate>('queue:status', status => {
          if (!status || typeof status.token !== 'string' || !status.token || !Number.isInteger(status.position) || status.position < 0 ||
            typeof status.ready !== 'boolean' || status.ready !== (status.position === 0)) return;
          watch();
          this.token = status.token;
          try { sessionStorage.setItem(this.storageKey, this.token); } catch {}
          update(status.position);
          if (status.ready) resolve(this.token);
        });
        room.onLeave(() => reject(new Error('Waiting room disconnected. Reconnecting without losing your place.')));
        room.onError(() => reject(new Error('Waiting room unavailable.')));
        watch();
        room.send('queue:sync');
      });
    } finally {
      clearTimeout(watchdog);
      this.cancel = undefined; this.waiting = undefined;
      // A missing leave acknowledgement must not block an already granted entry.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([room.leave().catch(() => {}), new Promise<void>(resolve => {
          timer = setTimeout(resolve, 1000);
        })]);
      } finally {
        clearTimeout(timer);
        if (room.connection.isOpen) room.connection.close();
      }
    }
  }
  stop(): void { this.generation++; this.cancel?.(); if (this.waiting) void this.waiting.leave().catch(() => {}); }
}
