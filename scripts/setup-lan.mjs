import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { certificateNames, localDirectory } from './lan-utils.mjs';

const toolsDirectory = resolve(localDirectory, 'tools');
const caDirectory = resolve(localDirectory, 'ca');
export const certificatePath = resolve(localDirectory, 'https.pem');
export const keyPath = resolve(localDirectory, 'https-key.pem');
export const rootCAPath = resolve(localDirectory, 'rootCA.pem');

async function download(url, destination, checksum, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (checksum && createHash('sha256').update(data).digest('hex') !== checksum) throw new Error('Tool checksum mismatch. Nothing was installed.');
  await writeFile(destination, data, { mode: 0o600 });
}

export async function ensureTools() {
  await mkdir(toolsDirectory, { recursive: true, mode: 0o700 });
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const mkcert = process.env.MKCERT_BIN || resolve(toolsDirectory, `mkcert${suffix}`);
  const livekit = process.env.LIVEKIT_BIN || resolve(toolsDirectory, `livekit-server${suffix}`);
  if (!existsSync(mkcert)) {
    if (!['darwin', 'linux', 'win32'].includes(process.platform) || !['arm64', 'x64'].includes(process.arch)) throw new Error('Install mkcert and set MKCERT_BIN.');
    const platform = process.platform === 'win32' ? 'windows' : process.platform;
    const arch = process.arch === 'x64' ? 'amd64' : 'arm64';
    console.log('[SDP] Downloading official mkcert v1.4.4 into .local/tools (no global installation).');
    await download(`https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-${platform}-${arch}${suffix}`, mkcert);
    await chmod(mkcert, 0o700);
  }
  if (!existsSync(livekit)) {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Install LiveKit Server from https://docs.livekit.io/transport/self-hosting/local/ and set LIVEKIT_BIN to its executable path.');
    const major = Number(execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).split('.')[0]);
    const bottleName = major >= 26 ? 'arm64_tahoe' : 'arm64_sequoia';
    console.log('[SDP] Downloading the official Homebrew LiveKit bottle (SHA-256 checked; Homebrew is not required).');
    const formula = await (await fetch('https://formulae.brew.sh/api/formula/livekit.json')).json();
    const bottle = formula.bottle?.stable?.files?.[bottleName];
    if (!bottle || bottle.cellar !== ':any_skip_relocation' || formula.dependencies.length) throw new Error('No standalone LiveKit bottle available. Install LiveKit and set LIVEKIT_BIN.');
    const auth = await (await fetch('https://ghcr.io/token?service=ghcr.io&scope=repository:homebrew/core/livekit:pull')).json();
    const archive = resolve(toolsDirectory, 'livekit.tar.gz');
    await download(bottle.url, archive, bottle.sha256, { Authorization: `Bearer ${auth.token}` });
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    const executable = entries.find((name) => name.endsWith('/bin/livekit-server'));
    if (!executable || executable.includes('..')) throw new Error('Unexpected LiveKit archive.');
    execFileSync('tar', ['-xzf', archive, '-C', toolsDirectory, executable]);
    await copyFile(resolve(toolsDirectory, executable), livekit);
    await chmod(livekit, 0o700);
  }
  return { mkcert, livekit };
}

export async function ensureCertificates(mkcert) {
  await mkdir(caDirectory, { recursive: true, mode: 0o700 });
  const names = certificateNames();
  let valid = false;
  if (existsSync(certificatePath) && existsSync(keyPath)) {
    const certificate = new X509Certificate(await readFile(certificatePath));
    valid = Date.parse(certificate.validTo) > Date.now() + 86400000 && names.every((name) =>
      name.includes(':') || /^[\d.]+$/.test(name) ? certificate.checkIP(name) : certificate.checkHost(name));
  }
  const env = { ...process.env, CAROOT: caDirectory };
  if (!valid) execFileSync(mkcert, ['-cert-file', certificatePath, '-key-file', keyPath, ...names], { env, stdio: 'inherit' });
  await chmod(keyPath, 0o600);
  await chmod(resolve(caDirectory, 'rootCA-key.pem'), 0o600);
  await copyFile(resolve(caDirectory, 'rootCA.pem'), rootCAPath);
  return { env, names };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { mkcert } = await ensureTools();
    const { env } = await ensureCertificates(mkcert);
    if (process.argv.includes('--trust')) {
      if (process.platform === 'darwin') {
        execFileSync('security', ['add-trusted-cert', '-r', 'trustRoot', '-k', resolve(homedir(), 'Library/Keychains/login.keychain-db'), rootCAPath], { stdio: 'inherit' });
      } else execFileSync(mkcert, ['-install'], { env, stdio: 'inherit' });
      console.log('[SDP] CA trust installed on THIS computer. Restart the browser.');
    } else console.log('[SDP] Certificates generated. Run npm run trust:lan to trust the CA on this computer.');
    console.log(`[SDP] Share ONLY this public certificate with the second computer: ${rootCAPath}`);
    console.log('[SDP] Never share rootCA-key.pem, https-key.pem, or LiveKit secrets. See LAN.md.');
  } catch (error) { console.error(`[SDP] ${error.message}`); process.exitCode = 1; }
}
