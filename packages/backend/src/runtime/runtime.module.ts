import { Module } from '@nestjs/common';
import { CandlesModule } from '../candles/candles.module.js';
import { IndicatorsModule } from '../indicators/indicators.module.js';
import { RulesModule } from '../rules/rules.module.js';
import { StreamModule } from '../stream/stream.module.js';
import { LiveCascadeService } from './live-cascade.service.js';

/**
 * The runtime activation module — the single seam that turns the relocated-but-
 * dormant live producers on at cutover.
 *
 * It sits **above** every producer module so it can inject all four collaborators
 * the {@link LiveCascadeService} fans a polled candle across — the
 * {@link CandlesModule}'s `PollingService`, the {@link IndicatorsModule}'s
 * `IndicatorService`, the {@link StreamModule}'s `QuoteStreamService`, and the
 * {@link RulesModule}'s `RuleEngineService`. Those modules can't import each
 * other's producers without cycling (indicators / stream / rules all import
 * candles), so this module is where the acyclic graph finally converges — the
 * Nest equivalent of the old `connectServices` composition root, which wired the
 * same fan-out in one flat scope.
 *
 * It provides and exports the {@link LiveCascadeService} so `main.ts` can resolve
 * it and call `start()` once the server is listening. The module itself starts
 * nothing on import — activation is an explicit `main.ts`-only call, keeping the
 * `AppModule` graph the e2e suites build fully dormant.
 */
@Module({
  imports: [CandlesModule, IndicatorsModule, StreamModule, RulesModule],
  providers: [LiveCascadeService],
  exports: [LiveCascadeService],
})
export class RuntimeModule {}
