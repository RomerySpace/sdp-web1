import type { ConnectionStatus } from '../../shared/MultiplayerProtocol';

const labels = { connecting: 'Connecting', connected: 'Connected', disconnected: 'Disconnected' };

export class ConnectionIndicator {
  readonly element = document.createElement('div');
  private readonly stateLabel = document.createElement('span');
  private readonly population = document.createElement('span');

  constructor(container: HTMLElement) {
    this.element.className = 'connection-indicator';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
    this.element.append(this.stateLabel, this.population);
    container.prepend(this.element);
  }

  update(status: ConnectionStatus): void {
    this.element.dataset.connection = status.state;
    this.stateLabel.textContent = status.queuePosition ? `Waiting · ${status.queuePosition} in queue` : labels[status.state];
    this.population.textContent = `ONLINE: ${status.online} / ${status.capacity}`;
    this.element.title = status.roomId ? `SDPLobby ${status.roomId}` : labels[status.state];
  }
}
