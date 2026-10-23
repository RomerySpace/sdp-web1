export const socialConfig = { invitationMs: 45000, loadingGraceMs: 180000, cooldownMs: 5000, maxPending: 8, nameConflictCode: 409 } as const;
export type SocialMode = 'LIMBO' | 'SHOOTER';
export interface RoomInvitation { id: string; fromId: string; fromSessionId: string; fromName: string; roomId: string; mode: SocialMode; expiresAt: number }
export interface SocialResult { requestId: string; ok: boolean; message?: string; mode?: SocialMode; invitationId?: string; reservation?: unknown }
