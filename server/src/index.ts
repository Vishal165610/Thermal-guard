import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/types';
import { ACTIONS } from '../../shared/actions';
import { ZONE_IDS } from '../../shared/zones';
import { SimulationService } from './service';

const PORT = Number(process.env.PORT ?? 4000);

async function main() {
  const service = new SimulationService();
  await service.init();

  const app = express();
  app.use(cors());
  app.get('/', (_req, res) => {
    res.send('Thermal Guard server is running. Open the dashboard at http://localhost:5173');
  });
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, step: service.sim.step, model: service.forecaster.status });
  });

  const server = http.createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: { origin: '*' },
  });

  const broadcast = () => io.emit('snapshot', service.snapshot());

  io.on('connection', (socket) => {
    socket.emit('snapshot', service.snapshot());

    socket.on('scenario:set', ({ scenario, zoneId }) => {
      const valid = ['normal', 'cooling-failure', 'machine-overheating', 'fire'];
      if (!valid.includes(scenario)) return;
      const zone = zoneId && ZONE_IDS.includes(zoneId) ? zoneId : undefined;
      service.setScenario(scenario, zone);
      console.log(`[scenario] ${scenario}${zone ? ` @ ${zone}` : ''} at step ${service.sim.step}`);
      broadcast();
    });
    socket.on('simulation:reset', () => {
      service.reset();
      console.log('[reset] simulation restored');
      broadcast();
    });
    socket.on('action:apply', ({ actionId, zoneId, faultId }) => {
      if (!ACTIONS.some((a) => a.id === actionId)) return;
      const zone = zoneId && ZONE_IDS.includes(zoneId) ? zoneId : undefined;
      service.applyAction(actionId, zone, typeof faultId === 'string' ? faultId : undefined);
      console.log(`[action] ${actionId}${zone ? ` @ ${zone}` : ''} at step ${service.sim.step}`);
      broadcast();
    });
    socket.on('simulation:control', (p) => {
      service.control(p ?? {});
      schedule();
      broadcast();
    });
    socket.on('alert:ack', ({ id }) => {
      service.acknowledge(id);
      broadcast();
    });
  });

  // The step interval depends on the playback speed, so we re-schedule whenever it changes.
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!service.paused) {
        service.tick();
        broadcast();
      }
      schedule();
    }, service.tickIntervalMs());
  }
  schedule();

  server.listen(PORT, () => {
    console.log(`Thermal Guard server on http://localhost:${PORT}`);
    console.log(`Forecast model: ${service.forecaster.status.state} - ${service.forecaster.status.message}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
