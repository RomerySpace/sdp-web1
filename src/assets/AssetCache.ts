import { Cache } from 'three';
Cache.enabled = true;
const buffers = new Map<string, Promise<ArrayBuffer>>();
export const assetCount = (): number => buffers.size;
export function assetBuffer(url: string): Promise<ArrayBuffer> {
  let promise = buffers.get(url);
  if (!promise) {
    promise = fetch(url).then(response => {
      if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error(`Asset unavailable: ${url}`);
      return response.arrayBuffer();
    }).catch(error => { buffers.delete(url); throw error; });
    buffers.set(url, promise);
  }
  return promise;
}
