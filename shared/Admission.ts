export const admissionConfig = {
  room: 'SDPAdmission',
  reservationSeconds: 120,
  ticketMs: 30000,
  maxWaiting: 500,
} as const;
export interface AdmissionUpdate { token: string; position: number; capacity: number; ready: boolean }
