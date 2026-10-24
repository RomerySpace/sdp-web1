import { Room, type Client } from '@colyseus/core';
import { admission } from '../communication/Admission';
import { socialDirectory } from '../communication/SocialDirectory';
import { admissionConfig } from '../../../shared/Admission';

export class SDPAdmission extends Room {
  static async onAuth(_token: string, options: { admissionToken?: unknown; displayName?: unknown } = {}): Promise<boolean> {
    socialDirectory.checkName(options.displayName, options.admissionToken);
    return true;
  }
  private readonly tickets = new Map<string, string>();
  private readonly previous = new Map<string, string>();
  private readonly sentAt = new Map<string, number>();
  onCreate(): void {
    this.autoDispose = false;
    this.maxClients = 600; this.maxMessagesPerSecond = 2;
    this.onMessage('queue:sync', client => { this.previous.delete(client.sessionId); this.sendStatus(client); });
    this.setSimulationInterval(() => { admission.tick(); for (const client of this.clients) this.sendStatus(client); }, 1000);
  }
  onJoin(client: Client, options: { admissionToken?: unknown; displayName?: unknown } = {}): void {
    socialDirectory.checkName(options.displayName, options.admissionToken);
    this.tickets.set(client.sessionId, admission.request(options.admissionToken, client.sessionId));
    this.sendStatus(client);
  }
  onLeave(client: Client): void {
    const token = this.tickets.get(client.sessionId);
    if (token) admission.unwatch(token, client.sessionId);
    this.tickets.delete(client.sessionId); this.previous.delete(client.sessionId); this.sentAt.delete(client.sessionId);
  }
  private sendStatus(client: Client): void {
    const token = this.tickets.get(client.sessionId), status = token && admission.status(token);
    if (!status) { client.leave(4002, 'Admission expired. Please try again.'); return; }
    const key = JSON.stringify(status);
    const now = this.clock.elapsedTime;
    if (key !== this.previous.get(client.sessionId) || now - (this.sentAt.get(client.sessionId) ?? -Infinity) >= admissionConfig.heartbeatMs) {
      client.send('queue:status', status); this.previous.set(client.sessionId, key); this.sentAt.set(client.sessionId, now);
    }
  }
}
