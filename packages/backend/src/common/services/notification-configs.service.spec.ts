import { ConfigKey, NotificationChannel } from '@lametrader/core';
import {
  NotificationConfigConflictError,
  NotificationConfigError,
  NotificationConfigNotFoundError,
} from '../domain/notification-config.js';
import { InMemoryConfigRepository } from '../persistence/in-memory-config.repository.js';
import { NotificationConfigsService } from './notification-configs.service.js';

/** Build a fresh service over an empty in-memory config repo. */
function service(): { svc: NotificationConfigsService; repo: InMemoryConfigRepository } {
  const repo = new InMemoryConfigRepository();
  return { svc: new NotificationConfigsService(repo), repo };
}

/** A valid Telegram create payload. */
function telegram(overrides: Partial<Record<'name' | 'botToken' | 'chatId', string>> = {}) {
  return {
    notificationType: NotificationChannel.Telegram,
    name: 'main',
    botToken: 'TOKEN-1',
    chatId: '123',
    ...overrides,
  };
}

describe('NotificationConfigsService', () => {
  it('list returns an empty array when nothing is stored', async () => {
    expect(await service().svc.list()).toEqual([]);
  });

  it('create assigns an id, trims fields, persists, and returns the view (no bot token)', async () => {
    const { svc } = service();
    const created = await svc.create(telegram({ name: '  main  ', chatId: ' 123 ' }));
    expect(created).toEqual({
      id: expect.any(String),
      notificationType: NotificationChannel.Telegram,
      name: 'main',
      chatId: '123',
    });
  });

  it('create persists so the config is retrievable by its id (incl. the stored bot token)', async () => {
    const { svc } = service();
    const created = await svc.create(telegram({ botToken: ' TOKEN-1 ' }));
    expect({
      view: await svc.get(created.id),
      found: await svc.findByName('main'),
    }).toEqual({
      view: {
        id: created.id,
        notificationType: NotificationChannel.Telegram,
        name: 'main',
        chatId: '123',
      },
      found: {
        id: created.id,
        notificationType: NotificationChannel.Telegram,
        name: 'main',
        botToken: 'TOKEN-1',
        chatId: '123',
      },
    });
  });

  it('create rejects a blank name with NotificationConfigError', async () => {
    await expect(service().svc.create(telegram({ name: '   ' }))).rejects.toBeInstanceOf(
      NotificationConfigError,
    );
  });

  it('create rejects a blank botToken with NotificationConfigError', async () => {
    await expect(service().svc.create(telegram({ botToken: '' }))).rejects.toBeInstanceOf(
      NotificationConfigError,
    );
  });

  it('create rejects a blank chatId with NotificationConfigError', async () => {
    await expect(service().svc.create(telegram({ chatId: '' }))).rejects.toBeInstanceOf(
      NotificationConfigError,
    );
  });

  it('create rejects an over-length name with NotificationConfigError', async () => {
    await expect(service().svc.create(telegram({ name: 'x'.repeat(61) }))).rejects.toBeInstanceOf(
      NotificationConfigError,
    );
  });

  it('create rejects a duplicate name with NotificationConfigConflictError', async () => {
    const { svc } = service();
    await svc.create(telegram());
    await expect(svc.create(telegram({ chatId: '999' }))).rejects.toBeInstanceOf(
      NotificationConfigConflictError,
    );
  });

  it('list returns the common-shape summaries in insertion order (no bot token, no chat id)', async () => {
    const { svc } = service();
    const a = await svc.create(telegram({ name: 'main', chatId: '1' }));
    const b = await svc.create(telegram({ name: 'alerts', chatId: '2' }));
    expect(await svc.list()).toEqual([
      { id: a.id, notificationType: NotificationChannel.Telegram, name: 'main' },
      { id: b.id, notificationType: NotificationChannel.Telegram, name: 'alerts' },
    ]);
  });

  it('get throws NotificationConfigNotFoundError for an unknown id', async () => {
    await expect(service().svc.get('ghost')).rejects.toBeInstanceOf(
      NotificationConfigNotFoundError,
    );
  });

  it('update merges the given fields, keeps the omitted bot token, and returns the view', async () => {
    const { svc } = service();
    const created = await svc.create(telegram());
    const updated = await svc.update(created.id, { name: 'renamed', chatId: '456' });
    expect({
      updated,
      found: await svc.findByName('renamed'),
    }).toEqual({
      updated: {
        id: created.id,
        notificationType: NotificationChannel.Telegram,
        name: 'renamed',
        chatId: '456',
      },
      found: {
        id: created.id,
        notificationType: NotificationChannel.Telegram,
        name: 'renamed',
        botToken: 'TOKEN-1',
        chatId: '456',
      },
    });
  });

  it('update rejects renaming onto another config’s name with NotificationConfigConflictError', async () => {
    const { svc } = service();
    await svc.create(telegram({ name: 'main' }));
    const other = await svc.create(telegram({ name: 'alerts', chatId: '2' }));
    await expect(svc.update(other.id, { name: 'main' })).rejects.toBeInstanceOf(
      NotificationConfigConflictError,
    );
  });

  it('update throws NotificationConfigNotFoundError for an unknown id', async () => {
    await expect(service().svc.update('ghost', { name: 'x' })).rejects.toBeInstanceOf(
      NotificationConfigNotFoundError,
    );
  });

  it('remove deletes the config by id', async () => {
    const { svc } = service();
    const created = await svc.create(telegram());
    await svc.remove(created.id);
    expect(await svc.list()).toEqual([]);
  });

  it('remove throws NotificationConfigNotFoundError for an unknown id', async () => {
    await expect(service().svc.remove('ghost')).rejects.toBeInstanceOf(
      NotificationConfigNotFoundError,
    );
  });

  it('findByName returns null for an unknown name', async () => {
    expect(await service().svc.findByName('ghost')).toBeNull();
  });

  it('persists the array under ConfigKey.Notifications', async () => {
    const { svc, repo } = service();
    const created = await svc.create(telegram());
    expect(await repo.get(ConfigKey.Notifications)).toEqual([
      {
        id: created.id,
        notificationType: NotificationChannel.Telegram,
        name: 'main',
        botToken: 'TOKEN-1',
        chatId: '123',
      },
    ]);
  });

  it('list throws NotificationConfigError when the stored value is not an array', async () => {
    const { svc, repo } = service();
    await repo.set(ConfigKey.Notifications, { not: 'an array' });
    await expect(svc.list()).rejects.toBeInstanceOf(NotificationConfigError);
  });

  it('list throws NotificationConfigError when an entry is missing required fields', async () => {
    const { svc, repo } = service();
    await repo.set(ConfigKey.Notifications, [{ id: 'x', name: 'main', botToken: 'T' }]);
    await expect(svc.list()).rejects.toBeInstanceOf(NotificationConfigError);
  });
});
