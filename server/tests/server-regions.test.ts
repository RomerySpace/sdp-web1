import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerRegions, migrateLegacySession, normalizeServerEndpoint, selectServerRegion, serverSessionKeys, verifyServerRegion } from '../../src/network/ServerRegions';
import { serverRegion } from '../src/config/ServerRegion';

const origin = 'https://sdp.example';
test('Frankfurt remains the only enabled region until USA has a distinct secure endpoint and an explicit flag', () => {
  const base = createServerRegions({}, origin);
  assert.equal(base[0].endpoint, `${origin}/multiplayer`); assert.equal(base[1].available, false);
  assert.equal(selectServerRegion(base, 'us').id, 'eu');
  const configured = { VITE_SDP_SERVER_URL: 'https://eu.example', VITE_SDP_US_SERVER_URL: 'https://us.example' };
  assert.equal(createServerRegions(configured, origin)[1].available, false);
  const enabled = createServerRegions({ ...configured, VITE_SDP_US_ENABLED: 'true' }, origin);
  assert.equal(enabled[1].available, true); assert.equal(selectServerRegion(enabled, 'us').endpoint, 'https://us.example');
  assert.equal(createServerRegions({ ...configured, VITE_SDP_US_ENABLED: 'true', VITE_SDP_US_SERVER_URL: 'wss://eu.example/' }, origin)[1].available, false);
  for (const value of ['http://us.example', 'https://user:secret@us.example', 'https://us.example?token=secret', 'javascript:alert(1)'])
    assert.equal(createServerRegions({ ...configured, VITE_SDP_US_ENABLED: 'true', VITE_SDP_US_SERVER_URL: value }, origin)[1].available, false);
  assert.equal(normalizeServerEndpoint('ws://localhost:1234/', 'http://localhost:5173'), 'http://localhost:1234');
});

test('reservations are endpoint-scoped; legacy credentials migrate once to the original EU endpoint and never to USA', () => {
  const regions = createServerRegions({ VITE_SDP_US_ENABLED: 'true', VITE_SDP_US_SERVER_URL: 'https://us.example' }, origin);
  const eu = serverSessionKeys(regions[0].endpoint!), us = serverSessionKeys(regions[1].endpoint!);
  assert.notEqual(eu.admission, us.admission); assert.notEqual(eu.reconnect, us.reconnect);
  assert.notEqual(eu.admission, serverSessionKeys('https://other-eu.example').admission);
  assert.equal(createServerRegions({ VITE_SDP_SERVER_URL: 'https://eu.example', VITE_SDP_EU_SERVER_URL: 'https://eu.example/' }, origin)[0].legacySession, true);
  assert.equal(createServerRegions({ VITE_SDP_SERVER_URL: 'https://eu.example', VITE_SDP_EU_SERVER_URL: 'https://new-eu.example' }, origin)[0].legacySession, false);
  const data = new Map([['sdp:admission', 'old-visit'], ['sdp:reconnect', 'old-room-token']]);
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  migrateLegacySession(storage, regions[1]); assert.equal(storage.getItem(us.admission), null);
  migrateLegacySession(storage, regions[0]); assert.equal(storage.getItem(eu.admission), 'old-visit');
  assert.equal(storage.getItem(eu.reconnect), 'old-room-token'); assert.equal(storage.getItem('sdp:admission'), null);
  storage.setItem('sdp:admission', 'must-not-migrate-again'); migrateLegacySession(storage, regions[0]);
  assert.equal(storage.getItem(eu.admission), 'old-visit'); assert.equal(storage.getItem(us.reconnect), null);
});

test('explicit regional endpoints fail closed when offline or mislabeled instead of joining another region', async () => {
  const original = globalThis.fetch;
  const us = createServerRegions({ VITE_SDP_US_ENABLED: 'true', VITE_SDP_US_SERVER_URL: 'https://us.example' }, origin)[1];
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ status: 'ok', region: 'eu' }));
    await assert.rejects(() => verifyServerRegion(us), /does not match/);
    globalThis.fetch = async () => new Response(JSON.stringify({ status: 'ok', region: 'us' }));
    await verifyServerRegion(us);
    globalThis.fetch = async () => { throw new Error('Offline'); };
    await assert.rejects(() => verifyServerRegion(us), /unavailable/);
  } finally { globalThis.fetch = original; }
  assert.equal(serverRegion(), 'eu'); assert.equal(serverRegion('us'), 'us');
  assert.throws(() => serverRegion('invalid'), /SDP_REGION/);
});
