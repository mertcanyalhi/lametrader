import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';

/**
 * Jest `globalSetup` for the e2e tier — start the one shared Testcontainers
 * Mongo for the whole run and publish its address as `MONGODB_URI`.
 *
 * This runs in the Jest parent process **before any spec file is imported**,
 * which is the only point early enough to matter: `@nestjs/config` executes its
 * `validate` hook (our `validateEnv`) *synchronously inside*
 * `ConfigModule.forRoot()`, and `forRoot()` is evaluated when `app.module.ts` is
 * imported — before any per-suite `beforeAll`. Setting `MONGODB_URI` here means
 * `validateEnv` reads the container's random mapped port instead of falling back
 * to the `localhost:27017` default. A per-suite `beforeAll` sets it too late.
 *
 * `directConnection=true` pins the driver to this single node rather than having
 * it follow the container's self-advertised replica-set address (`…:27017`).
 *
 * The started container is stashed on `globalThis` so {@link import('./global-teardown.js')}
 * can stop it — the two hooks run in the same parent process.
 */
export default async function globalSetup(): Promise<void> {
  const container = await new MongoDBContainer('mongo:8').start();
  process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;
  (
    globalThis as typeof globalThis & { __MONGO_CONTAINER__?: StartedMongoDBContainer }
  ).__MONGO_CONTAINER__ = container;
}
