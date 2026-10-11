import { networkInterfaces, hostname } from 'node:os';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const localDirectory = resolve(projectRoot, '.local');

export function lanAddresses() {
  return Object.entries(networkInterfaces())
    .filter(([name]) => !/^(utun|tun|docker|veth|vmnet|bridge)/i.test(name))
    .flatMap(([, addresses]) => addresses || [])
    .filter((address) => address.family === 'IPv4' && !address.internal &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address))
    .map((address) => address.address);
}

export function lanIP() {
  const address = process.env.SDP_LAN_IP || lanAddresses()[0];
  if (!address || isIP(address) !== 4) throw new Error('No LAN IPv4 found. Connect to Wi-Fi or set SDP_LAN_IP in .env.local.');
  return address;
}

export function certificateNames() {
  return [...new Set(['localhost', '127.0.0.1', '::1', hostname(), lanIP(), ...lanAddresses()])];
}

export function port(value, fallback) {
  const result = Number(value || fallback);
  if (!Number.isInteger(result) || result < 1024 || result > 65535) throw new Error('Development ports must be integers between 1024 and 65535.');
  return result;
}
