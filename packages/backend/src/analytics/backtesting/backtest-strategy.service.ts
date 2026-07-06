import type { BacktestStrategy, BacktestStrategyRepository } from '@lametrader/core';
import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import {
  BacktestStrategyConflictError,
  BacktestStrategyNotFoundError,
  parseBacktestStrategyFields,
} from '../../common/domain/backtest-strategy.js';

/**
 * Injectable id generator + clock for {@link BacktestStrategyService}, so tests
 * are deterministic. Both default for production (nanoid / `Date.now`).
 */
export interface BacktestStrategyServiceOptions {
  /** Generate a new strategy id; defaults to nanoid. */
  newId?: () => string;
  /** Current epoch ms; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Application use-case for managing {@link BacktestStrategy}s.
 *
 * A strategy is a named, symbol-agnostic entry/exit definition reused across
 * runs. Depends only on the {@link BacktestStrategyRepository} port; the
 * {@link AnalyticsModule} injects the concrete adapter, and unit tests build it
 * directly over the in-memory fake.
 *
 * Deleting a strategy does **not** cascade to saved backtests — each backtest
 * carries its own embedded strategy snapshot, so it stays meaningful after its
 * source strategy is edited or removed.
 */
@Injectable()
export class BacktestStrategyService {
  /** Id generator (injectable; defaults to nanoid). */
  private readonly newId: () => string;
  /** Current clock (injectable; defaults to `Date.now`). */
  private readonly now: () => number;

  /**
   * @param strategies - the strategy persistence port.
   * @param options - injectable id generator and clock.
   */
  constructor(
    private readonly strategies: BacktestStrategyRepository,
    options: BacktestStrategyServiceOptions = {},
  ) {
    this.newId = options.newId ?? (() => nanoid());
    this.now = options.now ?? Date.now;
  }

  /**
   * List all strategies.
   */
  list(): Promise<BacktestStrategy[]> {
    return this.strategies.list();
  }

  /**
   * Get one strategy by id.
   *
   * @throws {@link BacktestStrategyNotFoundError} when no strategy has that id.
   */
  get(id: string): Promise<BacktestStrategy> {
    return this.getStored(id);
  }

  /**
   * Create a strategy from an input (validated + defaulted).
   *
   * Generates the id and timestamps.
   *
   * @throws {@link BacktestStrategyError} on invalid fields.
   * @throws {@link BacktestStrategyConflictError} when the name is already in use.
   */
  async create(input: unknown): Promise<BacktestStrategy> {
    const fields = parseBacktestStrategyFields(input);
    await this.assertNameAvailable(fields.name);
    const ts = this.now();
    const strategy: BacktestStrategy = {
      id: this.newId(),
      ...fields,
      createdAt: ts,
      updatedAt: ts,
    };
    await this.strategies.save(strategy);
    return strategy;
  }

  /**
   * Fully replace a strategy's mutable fields (PUT).
   *
   * Preserves `id` and `createdAt`; bumps `updatedAt`.
   *
   * @throws {@link BacktestStrategyNotFoundError} when the id is unknown.
   * @throws {@link BacktestStrategyError} / {@link BacktestStrategyConflictError}
   * on invalid input.
   */
  async replace(id: string, input: unknown): Promise<BacktestStrategy> {
    const existing = await this.getStored(id);
    const fields = parseBacktestStrategyFields(input);
    await this.assertNameAvailable(fields.name, id);
    const updated: BacktestStrategy = { ...existing, ...fields, updatedAt: this.now() };
    await this.strategies.save(updated);
    return updated;
  }

  /**
   * Delete a strategy by id. Does not cascade to saved backtests.
   *
   * @throws {@link BacktestStrategyNotFoundError} when the id is unknown.
   */
  async remove(id: string): Promise<void> {
    await this.getStored(id);
    await this.strategies.remove(id);
  }

  /**
   * Read one strategy or throw {@link BacktestStrategyNotFoundError}.
   */
  private async getStored(id: string): Promise<BacktestStrategy> {
    const strategy = await this.strategies.get(id);
    if (!strategy) {
      throw new BacktestStrategyNotFoundError(`backtest strategy not found: ${id}`);
    }
    return strategy;
  }

  /**
   * Throw {@link BacktestStrategyConflictError} when `name` is used by a strategy
   * other than `exceptId`.
   */
  private async assertNameAvailable(name: string, exceptId?: string): Promise<void> {
    const all = await this.strategies.list();
    if (all.some((strategy) => strategy.name === name && strategy.id !== exceptId)) {
      throw new BacktestStrategyConflictError(`backtest strategy name already in use: ${name}`);
    }
  }
}
