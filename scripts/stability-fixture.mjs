import { monitorEventLoopDelay } from 'node:perf_hooks';
import { shooterFixture } from '../server/tests/shooter-fixture.ts';
import { admission } from '../server/src/communication/Admission.ts';

// Local child process only: no public diagnostics endpoint or cloud credentials.
if (!process.send) throw new Error('Start this fixture through test:stability.');
admission.enabled = true;
admission.capacity = Number(process.env.SDP_TEST_CAPACITY);
const fixture = await shooterFixture();
const delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable();
let cpu = process.cpuUsage(), sampled = performance.now();
process.on('message', async message => {
  if (message.type === 'sample') {
    const now = performance.now(), used = process.cpuUsage(cpu);
    const rooms = message.rooms.map(id => fixture.room(id)).filter(Boolean).map(room => ({
      id: room.roomId, players: room.state.players.size, online: room.state.online, tick: room.state.tick,
    }));
    process.send({ type: 'sample', request: message.request, at: now, rooms,
      rssMiB: process.memoryUsage().rss / 1024 ** 2,
      cpuOneCorePercent: (used.user + used.system) / ((now - sampled) * 1000) * 100,
      loopP95Ms: delay.percentile(95) / 1e6, loopMaxMs: delay.max / 1e6 });
    cpu = process.cpuUsage(); sampled = now; delay.reset();
  } else if (message.type === 'stop') {
    delay.disable(); await fixture.server.gracefullyShutdown(false); process.exit(0);
  }
});
process.on('disconnect', () => process.exit(1));
process.send({ type: 'ready', port: fixture.port });
