import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { writeRuntimeReadyFile } from './runtime-readiness.js';

const config = loadConfig();
const app = await buildApp({
  databasePath: config.databasePath,
  runtimeIdentity: { lane: config.lane, instanceId: config.instanceId, ...(config.buildId ? { buildId: config.buildId } : {}) },
  captureRetentionDays: config.captureRetentionDays,
  ...(config.lane === 'api-test' && config.testControlSecret
    ? { testControl: { secret: config.testControlSecret } }
    : {}),
  ...(config.householdId && config.accessToken
    ? { authorization: {
        householdId: config.householdId,
        accessToken: config.accessToken,
        ...(config.pairingCode ? { pairingCode: config.pairingCode } : {}),
        ...(config.pairingExpiresAt ? { pairingExpiresAt: config.pairingExpiresAt } : {}),
      } }
    : {}),
});

try {
  const origin = await app.listen({ host: config.host, port: config.port });
  const readyFile = process.env.DUCKWORTH_READY_FILE?.trim();
  if (readyFile) writeRuntimeReadyFile(readyFile, {
    origin,
    lane: config.lane,
    instanceId: config.instanceId,
    pid: process.pid,
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
