import { runWatchlistRepositoryContract } from '../testing/watchlist-repository.contract.js';
import { InMemoryWatchlistRepository } from './in-memory-watchlist.repository.js';

describe('InMemoryWatchlistRepository', () => {
  runWatchlistRepositoryContract(() => new InMemoryWatchlistRepository());
});
