import type { EventLog, RuleEventEntry } from '@lametrader/core';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { EVENT_LOG } from '../common/interfaces/event-log.token.js';
import type { StreamHub } from '../common/services/stream-hub.js';
import { RULE_EVENT_STREAM } from './stream.tokens.js';

/**
 * Bridges the shared rule-event log to the rule-event `/stream` hub — the
 * server-side equivalent of the old `api/main.ts` `onRuleEvent` sink.
 *
 * On bootstrap it subscribes to {@link EventLog.onAppend} and republishes only
 * the **symbol-side** mirror (`target.kind === 'symbol'`) to the
 * {@link RULE_EVENT_STREAM} hub keyed by symbol id, so each subscribed socket
 * sees every fire that touched that symbol. The rule-side mirror reaches no
 * chart consumer today and is dropped.
 *
 * **DORMANT at boot.** Registering the listener has no effect until an append
 * happens; the only production writer is the (dormant) rule engine, so no frame
 * is published until the cutover stage (#490) starts it. The listener is
 * detached on shutdown.
 */
@Injectable()
export class RuleEventStreamBridge implements OnApplicationBootstrap, OnModuleDestroy {
  /** The event-log unsubscribe handle, retained so it can be removed on shutdown. */
  private unsubscribe?: () => void;

  /**
   * @param eventLog - the shared mirrored rule-event log (the append source).
   * @param hub - the rule-event hub each socket subscribes to (keyed by symbol id).
   */
  constructor(
    @Inject(EVENT_LOG) private readonly eventLog: EventLog,
    @Inject(RULE_EVENT_STREAM) private readonly hub: StreamHub<RuleEventEntry>,
  ) {}

  /**
   * Wire the symbol-side append → hub publish once the app has bootstrapped.
   */
  onApplicationBootstrap(): void {
    this.unsubscribe = this.eventLog.onAppend((entry, target) => {
      if (target.kind === 'symbol') this.hub.publish(target.symbolId, entry);
    });
  }

  /**
   * Detach the append listener on shutdown so a closed app leaves no dangling
   * subscription on the shared event log.
   */
  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
