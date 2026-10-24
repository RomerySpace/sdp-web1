import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRouter, matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LOBBY_NAME, MAX_PLAYERS, SIMULATION_HZ } from '../../shared/MultiplayerProtocol';
import { SDPLobby } from './rooms/SDPLobby';
import { SDPShooterRoom } from './rooms/SDPShooterRoom';
import { SHOOTER_ROOM } from '../../shared/ShooterProtocol';
import { OriginPolicy } from './config/OriginPolicy';
import { liveKitURLs } from './config/LiveKitConfig';
import { admission } from './communication/Admission';
import { SDPAdmission } from './rooms/SDPAdmission';
import { admissionConfig } from '../../shared/Admission';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { serverRegion } from './config/ServerRegion';

process.on('uncaughtExceptionMonitor', error => console.error('[SDP] Fatal process error', error));
process.on('exit', code => console.error('[SDP] Process exit', code));
const loopDelay = monitorEventLoopDelay({ resolution: 50 });
loopDelay.enable();
setInterval(() => {
  console.log('[SDP] Runtime', { uptimeSeconds: Math.round(process.uptime()),
    memory: process.memoryUsage(), eventLoopMaxMs: Math.round(loopDelay.max / 1e6) });
  loopDelay.reset();
}, 30000).unref();

const port = Number(process.env.PORT || 2567);
const host = process.env.HOST || '0.0.0.0';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');

const origins = new OriginPolicy();
const region = serverRegion();
const capacity = Number(process.env.SDP_VISITOR_CAPACITY || MAX_PLAYERS);
if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) throw new Error('SDP_VISITOR_CAPACITY must be between 1 and 1000.');
admission.enabled = true; admission.capacity = capacity;
const voiceConfigured = Boolean(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
if (Boolean(process.env.LIVEKIT_API_KEY) !== Boolean(process.env.LIVEKIT_API_SECRET)) {
  throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must both be set on the backend.');
}
if (voiceConfigured) liveKitURLs();
matchMaker.controller.getCorsHeaders = (headers) => ({ 'Access-Control-Allow-Origin': origins.corsOrigin(headers.get('origin')) });
const transport = new WebSocketTransport({
  pingInterval: 2000, pingMaxRetries: 2, maxPayload: 4096,
  verifyClient: (info: { origin: string }) => origins.allows(info.origin),
});
transport.getExpressApp().get('/health', (request: IncomingMessage, response: ServerResponse) => {
  if (!origins.allows(request.headers.origin)) { response.writeHead(403); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origins.corsOrigin(request.headers.origin || null), 'Vary': 'Origin', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ status: 'ok', room: LOBBY_NAME, capacity: MAX_PLAYERS, simulationHz: SIMULATION_HZ,
    region, voice: voiceConfigured ? 'configured' : 'unconfigured' }));
});
const server = new Server({
  transport,
  greet: false,
});
server.define(LOBBY_NAME, SDPLobby);
server.define(admissionConfig.room, SDPAdmission);
server.define('SDPLobby', SDPLobby);
server.define(SHOOTER_ROOM, SDPShooterRoom);
server.router = createRouter({}, {
  onRequest: (request) => {
    if (!origins.allows(request.headers.get('origin'))) return new Response('Origin is not allowed.', { status: 403 });
  },
});
const listeningError = new Promise<never>((_resolve, reject) => {
  transport.server!.once('error', reject);
});
try {
  await Promise.race([server.listen(port, host), listeningError]);
  console.log(`[SDP] Multiplayer ready: http://${host}:${port} | ${LOBBY_NAME} | ${MAX_PLAYERS} players | ${SIMULATION_HZ} Hz`);
  console.log(`[SDP] Voice ${voiceConfigured ? 'configured (connection is verified by the browser)' : 'unconfigured: add LiveKit credentials to the backend'}.`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`[SDP] Port ${port} is busy. Change PORT in server/.env and VITE_SDP_SERVER_URL in .env.local, then restart.`);
  } else console.error('[SDP] Server could not start:', error);
  process.exit(1);
}
