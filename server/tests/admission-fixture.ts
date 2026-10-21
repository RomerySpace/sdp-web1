import type { Client } from '@colyseus/sdk';
import type { AdmissionUpdate } from '../../shared/Admission';
export async function admissionOptions(client: Client): Promise<{ admissionToken: string }> {
  const queue = await client.joinOrCreate('SDPAdmission');
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test admission timed out.')), 5000);
      queue.onMessage<AdmissionUpdate>('queue:status', status => {
        if (status.ready) { clearTimeout(timer); resolve({ admissionToken: status.token }); }
      });
      queue.send('queue:sync');
    });
  } finally { await queue.leave(); }
}
