import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';

const dataDir = (relative: string) => fileURLToPath(new URL(`../data/${relative}`, import.meta.url));

const port = Number(process.env.PORT ?? 3001);

const app = await buildApp({
  fastify: { logger: { level: process.env.LOG_LEVEL ?? 'info' } },
  dbFile: process.env.DB_FILE ?? dataDir('car-porter.sqlite'),
  profilesDir: process.env.PROFILES_DIR ?? dataDir('browser-profiles'),
  mockSources: process.env.MOCK_SOURCES === '1',
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close().then(() => process.exit(0)));
}

try {
  await app.listen({ port, host: '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
