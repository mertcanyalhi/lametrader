# Hexagonal architecture with SOLID, kept pragmatic

- Status: superseded by 0018

## Context

The platform has three independent axes of variation: multiple market-data
sources (Binance, Yahoo, more later), multiple delivery surfaces (API, CLI, web),
and the need to run the same analysis logic over both live feeds and historical
replay for backtesting. The prior iteration let I/O concerns leak into logic, and
change decisions produced sloppy, hard-to-reason-about code.

## Decision

Adopt hexagonal architecture (ports & adapters), kept pragmatic — no per-ring
packages, no DDD ceremony, no DI framework. Rings: domain (pure logic), ports
(interfaces the core needs), application (use-cases), adapters (sources, persistence,
delivery). One enforced rule: **adapters -> application -> domain, never the reverse.**
SOLID applied as a consequence (new source = new adapter (OCP); domain depends on
ports not concretions (DIP); narrow ports (ISP); shared contract test per port (LSP)).
Anti-dogma rule: abstract on the second instance, not in anticipation.

## Consequences

- Domain stays pure and deterministically unit-testable; backtest vs live is an
  adapter swap, not a code change.
- Adding a source/store/delivery means writing an adapter, never editing the core.
- Cost: some indirection and the discipline to not over-abstract. Mitigated by the
  "second instance" rule and keeping the structure flat.
