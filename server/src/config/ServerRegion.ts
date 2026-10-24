export function serverRegion(value = process.env.SDP_REGION): 'eu' | 'us' {
  const id = value?.trim().toLowerCase() || 'eu';
  if (id !== 'eu' && id !== 'us') throw new Error('SDP_REGION must be eu or us.');
  return id;
}
