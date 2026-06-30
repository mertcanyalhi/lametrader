/**
 * How a rule selects which symbol(s) it applies to.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 *
 * Three variants per ADR 0016: a single watched symbol, an explicit list, or
 * every watched symbol on the parent profile.
 */
export enum RuleScopeKind {
  /** Applies to one specific watched symbol. */
  Symbol = 'symbol',
  /** Applies to an explicit list of watched symbols. */
  Symbols = 'symbols',
  /** Applies to every watched symbol in the parent profile. */
  AllSymbols = 'allSymbols',
}

/** Rule scoped to one specific watched symbol. */
export interface SymbolRuleScope {
  kind: RuleScopeKind.Symbol;
  /** The watched symbol id this rule applies to. */
  symbolId: string;
}

/** Rule scoped to an explicit list of watched symbols. */
export interface SymbolsRuleScope {
  kind: RuleScopeKind.Symbols;
  /** The watched symbol ids this rule fans out to (one fire per symbol). */
  symbolIds: string[];
}

/** Rule scoped to every watched symbol in the parent profile. */
export interface AllSymbolsRuleScope {
  kind: RuleScopeKind.AllSymbols;
}

/** A rule's scope, discriminated on `kind`. */
export type RuleScope = SymbolRuleScope | SymbolsRuleScope | AllSymbolsRuleScope;
