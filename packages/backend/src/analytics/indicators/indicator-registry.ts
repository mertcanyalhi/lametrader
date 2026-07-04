import type { IndicatorDefinition, IndicatorModule } from '@lametrader/core';

/**
 * A look-up table of {@link IndicatorModule}s keyed by definition `key`.
 *
 * Built once at the composition root (the {@link IndicatorsModule} provides it via `defaultIndicators`) and injected into anything that needs to look an indicator up — there is no module-level singleton.
 *
 * Tests build a fresh `IndicatorRegistry` and register exactly the modules they exercise.
 */
export class IndicatorRegistry {
  /** Registered modules keyed by definition.key. */
  private readonly modules = new Map<string, IndicatorModule>();

  /**
   * Register a module.
   *
   * Re-registering the same key replaces the previous module.
   */
  register(module: IndicatorModule): void {
    this.modules.set(module.definition.key, module);
  }

  /**
   * The definitions of every registered module.
   *
   * Returns metadata only — never the `compute` function — so the result is JSON-serializable.
   */
  list(): IndicatorDefinition[] {
    return [...this.modules.values()].map((module) => module.definition);
  }

  /**
   * One module by key, or `null` if none is registered for that key.
   */
  get(key: string): IndicatorModule | null {
    return this.modules.get(key) ?? null;
  }
}
