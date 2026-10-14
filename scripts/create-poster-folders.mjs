import { readFile, mkdir } from 'node:fs/promises';
const project = new URL('../', import.meta.url);
const { slots } = JSON.parse(await readFile(new URL('public/ads/carteles-por-zonas/zonas.json', project), 'utf8'));
for (const slot of slots) {
  if (!/^public\/ads\/carteles-por-zonas\/[a-z0-9-]+\/[a-z0-9-]+$/.test(slot.folder)) throw new Error('Ruta de carpeta inválida');
  await mkdir(new URL(slot.folder + '/', project), { recursive: true });
}
console.log(slots.length + ' carpetas preparadas; se conservan los archivos existentes.');
