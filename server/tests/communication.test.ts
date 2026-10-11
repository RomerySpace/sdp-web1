import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { TokenVerifier } from 'livekit-server-sdk';
import { validateChatText, validVoiceRequest } from '../../shared/CommunicationProtocol';
import { ChatPolicy } from '../src/communication/ChatPolicy';
import { VoiceSessions } from '../src/communication/VoiceSessions';

test('chat rejects empty, oversized and forged payloads without interpreting HTML', () => {
  assert.equal(validateChatText('  \n '), null);
  assert.equal(validateChatText({ message: 'forged', senderId: 'someone-else' }), null);
  assert.equal(validateChatText('x'.repeat(501)), null);
  assert.equal(validateChatText(' <script>alert(1)</script> '), '<script>alert(1)</script>');
  assert.equal(validateChatText(' hi\u0000 '), 'hi');
});

test('chat limits bursts per sender and refills independently', () => {
  const policy = new ChatPolicy();
  for (let i = 0; i < 5; i++) assert.equal(policy.accept('one', 'hello', 0), 'hello');
  assert.equal(policy.accept('one', 'hello', 0), null);
  assert.equal(policy.accept('two', 'hello', 0), 'hello');
  assert.equal(policy.accept('one', 'hello', 500), 'hello');
});

test('voice requests cannot choose an identity or room', () => {
  assert.equal(validVoiceRequest({ requestId: 'request-one' }), true);
  assert.equal(validVoiceRequest({ requestId: 'request-one', identity: 'other' }), false);
  assert.equal(validVoiceRequest({ requestId: 'request-one', room: 'other' }), false);
  assert.equal(validVoiceRequest(null), false);
});

test('voice tokens are short-lived and restricted to the server-owned room/session/microphone', async () => {
  const previous = { key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET };
  const key = 'local-test';
  const secret = randomBytes(48).toString('base64url');
  process.env.LIVEKIT_API_KEY = key; process.env.LIVEKIT_API_SECRET = secret;
  try {
    const sessions = new VoiceSessions('room-one');
    const access = await sessions.access('session-one', 'VISITOR 01', 'request-one');
    const claims = await new TokenVerifier(key, secret).verify(access.token!);
    assert.equal(claims.sub, 'session-one');
    assert.equal(claims.video?.room, 'sdp-room-one');
    assert.equal(claims.video?.roomJoin, true);
    assert.equal(claims.video?.canPublishData, false);
    assert.deepEqual((claims.video as unknown as { canPublishSources: string[] }).canPublishSources, ['microphone']);
    assert.equal(claims.video?.roomAdmin, undefined);
    assert.ok(claims.exp! - claims.nbf! <= 60);
  } finally {
    if (previous.key === undefined) delete process.env.LIVEKIT_API_KEY; else process.env.LIVEKIT_API_KEY = previous.key;
    if (previous.secret === undefined) delete process.env.LIVEKIT_API_SECRET; else process.env.LIVEKIT_API_SECRET = previous.secret;
  }
});
