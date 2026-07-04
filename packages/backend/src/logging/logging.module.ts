import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfig } from '../config/app-config.types.js';

/**
 * Structured application + request logging via `nestjs-pino`.
 *
 * Replaces the hand-rolled `engine/src/log.ts`: the root logger's level comes
 * from the validated {@link AppConfig.logLevel}, and every record carries a
 * `{ app: 'server' }` base field (as the engine's root logger did).
 * Modules obtain a scoped child logger by injecting `PinoLogger` and calling
 * `setContext(scope)` (or `@InjectPinoLogger(scope)`), mirroring the engine's
 * `getLogger(scope)` — the `{ context }` binding is pino's `{ scope }`.
 *
 * Per-scope level overrides ({@link AppConfig.logScopes}) are validated at boot
 * but not yet applied to child loggers; that lands when the rule-engine modules
 * that need the fine-grained gating are ported.
 */
export const LoggingModule = LoggerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppConfig, true>) => ({
    pinoHttp: {
      level: config.get('logLevel', { infer: true }),
      base: { app: 'server' },
    },
  }),
});
