import { Room, type Client } from '@colyseus/core';
import { admission } from '../communication/Admission';

export class SDPAdmission extends Room {
  private readonly tickets = new Map<string, string>();
  private readonly previous = new Map<string, string>();
  onCreate(): void {
    this.autoDispose = false;
    this.maxClients = 600; this.maxMessagesPerSecond = 2;
    this.onMessage('queue:sync', client => { this.previous.delete(client.sessionId); this.sendStatus(client); });
    this.setSimulationInterval(() => { admission.tick(); for (const client of this.clients) this.sendStatus(client); }, 1000);
  }
  onJoin(client: Client, options: { admissionToken?: unknown } = {}): void {
    this.tickets.set(client.sessionId, admission.request(options.admissionToken, client.sessionId));
    this.sendStatus(client);
  }
  onLeave(client: Client): void {
    const token = this.tickets.get(client.sessionId);
    if (token) admission.unwatch(token, client.sessionId);
    this.tickets.delete(client.sessionId); this.previous.delete(client.sessionId);
  }
  private sendStatus(client: Client): void {
    const token = this.tickets.get(client.sessionId), status = token && admission.status(token);
    if (!status) { client.leave(4002, 'Admission expired. Please try again.'); return; }
    const key = JSON.stringify(status);
    if (key !== this.previous.get(client.sessionId)) { client.send('queue:status', status); this.previous.set(client.sessionId, key); }
  }
}
