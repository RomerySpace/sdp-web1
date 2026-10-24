export const admissionConfig = {
  room: 'SDPAdmission',
  reservationSeconds: 120,
  ticketMs: 30000,
  maxWaiting: 500,
  heartbeatMs: 5000,
  statusTimeoutMs: 15000,
} as const;
export interface AdmissionUpdate { token: string; position: number; capacity: number; ready: boolean }
