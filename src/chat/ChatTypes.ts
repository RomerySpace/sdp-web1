import type { Position } from '../network/NetworkAdapter';
import type { RoomChatMessage } from '../../shared/CommunicationProtocol';

export type ChatMessage = RoomChatMessage;

export function isWithinProximity(a: Position, b: Position, distance: number): boolean {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2 <= distance ** 2;
}
