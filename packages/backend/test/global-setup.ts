import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

/**
 * Jest `globalSetup` for the e2e tier — start the one shared Testcontainers
 * Mongo **and** Redis for the whole run and publish their addresses as
 * `MONGODB_URI` / `REDIS_URL`.
 *
 * This runs in the Jest parent process **before any spec file is imported**,
 * which is the only point early enough to matter: `@nestjs/config` executes its
 * `validate` hook (our `validateEnv`) *synchronously inside*
 * `ConfigModule.forRoot()`, and `forRoot()` is evaluated when `app.module.ts` is
 * imported — before any per-suite `beforeAll`. Setting the vars here means
 * `validateEnv` reads the containers' random mapped ports instead of falling
 * back to the `localhost` defaults. A per-suite `beforeAll` sets them too late.
 *
 * Redis backs the persistent `OncePerBar` latch (#513, ADR-0020); every
 * `AppModule` boot constructs its client, so the container is provisioned for
 * the whole run even though only the latch suites exercise it.
 *
 * `directConnection=true` pins the Mongo driver to this single node rather than
 * having it follow the container's self-advertised replica-set address (`…:27017`).
 *
 * The started containers are stashed on `globalThis` so {@link import('./global-teardown.js')}
 * can stop them — the two hooks run in the same parent process.
 */
export default async function globalSetup(): Promise<void> {
  const mongo = await new MongoDBContainer('mongo:8').start();
  process.env.MONGODB_URI = `${mongo.getConnectionString()}/?directConnection=true`;

  const redis = await new GenericContainer('redis:7').withExposedPorts(6379).start();
  process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

  const store = globalThis as typeof globalThis & {
    __MONGO_CONTAINER__?: StartedMongoDBContainer;
    __REDIS_CONTAINER__?: StartedTestContainer;
  };
  store.__MONGO_CONTAINER__ = mongo;
  store.__REDIS_CONTAINER__ = redis;
}
