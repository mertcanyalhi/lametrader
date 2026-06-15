import { describe } from 'vitest';
import { InMemoryWatchlistRepository } from './in-memory-watchlist-repository.js';
import { runWatchlistRepositoryContract } from './testing/watchlist-repository.contract.js';

describe('InMemoryWatchlistRepository', () => {
  runWatchlistRepositoryContract(() => new InMemoryWatchlistRepository());
});
