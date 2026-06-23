import { describe } from 'vitest';
import { InMemoryTelegramDestinationsRepository } from './in-memory-telegram-destinations-repository.js';
import { runTelegramDestinationsRepositoryContract } from './testing/telegram-destinations-repository.contract.js';

describe('InMemoryTelegramDestinationsRepository (contract)', () => {
  runTelegramDestinationsRepositoryContract(() => new InMemoryTelegramDestinationsRepository());
});
