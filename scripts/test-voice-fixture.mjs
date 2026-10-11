import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function voiceFixture(root) {
  const directory = resolve(root, '.local');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, 'test-voice.wav');
  const rate = 48000;
  const count = rate * 4;
  const wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const time = i / rate;
    const envelope = 0.4 + 0.25 * Math.sin(time * Math.PI * 6);
    const sample = envelope * (0.5 * Math.sin(time * Math.PI * 280) + 0.3 * Math.sin(time * Math.PI * 560) + 0.2 * Math.sin(time * Math.PI * 840));
    wav.writeInt16LE(Math.round(sample * 24000), 44 + i * 2);
  }
  writeFileSync(path, wav, { mode: 0o600 });
  return path;
}
