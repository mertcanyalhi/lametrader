import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { CandlesModule } from './candles/candles.module.js';
import { CommonModule } from './common/common.module.js';
import { ConfigModule } from './config/config.module.js';
import { validateEnv } from './config/env.validation.js';
import { IndicatorsModule } from './indicators/indicators.module.js';
import { LiveCascadeService } from './live-cascade.service.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';
import { RulesModule } from './rules/rules.module.js';
import { StateModule } from './state/state.module.js';
import { StreamModule } from './stream/stream.module.js';
import { SymbolsModule } from './symbols/symbols.module.js';

/**
 * The application root module — the composition root of the Nest monolith.
 *
 * Wires the cross-cutting glue every feature module plugs into: validated
 * environment configuration ({@link NestConfigModule}, global), structured
 * logging, the root Mongo connection, the health endpoint, and — the keystone
 * for every resource — the app-wide HTTP contract: a global {@link DomainExceptionFilter}
 * (domain error → status mapping + uniform `{ error, fields }` envelope) and a
 * global `ValidationPipe` (DTO validation emitting the same envelope).
 *
 * Feature modules: {@link ConfigModule} (`/config`),
 * {@link NotificationsModule} (`/config/notifications/telegram`),
 * {@link ProfilesModule} (`/profiles` + attached indicators),
 * {@link CandlesModule} (`/symbols/:id/candles` + `/backfill`; owns the shared
 * candle store), {@link SymbolsModule} (`/instruments` + `/symbols`; imports
 * {@link ProfilesModule} for the symbol-removal → profile-prune cascade and
 * {@link CandlesModule} for the candle store), {@link StateModule}
 * (`/profiles/:profileId/state/global` + `/symbols/:id/state` reads; owns the
 * shared state store), {@link IndicatorsModule} (`/indicators` catalog +
 * `/symbols/:id/indicators/:key` compute; owns the shared indicator registry),
 * {@link RulesModule} (`/rules` CRUD + `/rules/:id/events` +
 * `/symbols/:id/rule-events[/count]`; owns the shared rule store and hosts the
 * relocated rule engine as a dormant provider), and {@link StreamModule} (the
 * multiplexed `GET (WS) /stream` gateway carrying candle / indicator / quote /
 * rule-event subscriptions, with the producer→hub topology wired but dormant).
 *
 * The {@link LiveCascadeService} is provided here at the composition root — not
 * in a context module — because it injects producers from every context, so it
 * cannot sit in the leaf {@link CommonModule} without reversing the module
 * graph. `main.ts` resolves it and starts it once the server is listening,
 * wiring the poll→producers + indicator→rule cascades and starting the loop.
 * Nothing starts on import, so this graph stays dormant when the e2e suites
 * build it.
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    // The dynamic-timeout registry the (dormant) candle PollingService drives;
    // `forRoot` registers the global SchedulerRegistry. No decorator-based jobs.
    ScheduleModule.forRoot(),
    CommonModule,
    ConfigModule,
    NotificationsModule,
    ProfilesModule,
    CandlesModule,
    SymbolsModule,
    StateModule,
    IndicatorsModule,
    RulesModule,
    StreamModule,
  ],
  providers: [LiveCascadeService],
})
export class AppModule {}
