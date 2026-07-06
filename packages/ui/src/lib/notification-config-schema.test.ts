import { yupResolver } from '@hookform/resolvers/yup';
import { NotificationChannel } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import {
  type CreateNotificationFormValues,
  createNotificationFormSchema,
  type EditNotificationFormValues,
  editNotificationFormSchema,
} from './notification-config-schema';

/**
 * Tests for the notification-config forms' Yup schemas, exercised through
 * `yupResolver` exactly as the forms use them. Each case asserts the per-field
 * messages react-hook-form would surface.
 */
describe('notification config schemas', () => {
  const options = { fields: {}, shouldUseNativeValidation: false } as const;

  describe('create schema', () => {
    const resolve = yupResolver(createNotificationFormSchema);

    async function fieldMessages(values: CreateNotificationFormValues): Promise<{
      name?: string;
      botToken?: string;
      chatId?: string;
    }> {
      const result = await resolve(values, undefined, options);
      return {
        name: result.errors.name?.message,
        botToken: result.errors.botToken?.message,
        chatId: result.errors.chatId?.message,
      };
    }

    it('accepts a valid create payload', async () => {
      const values: CreateNotificationFormValues = {
        notificationType: NotificationChannel.Telegram,
        name: 'main',
        botToken: 'TOKEN-1',
        chatId: '123',
      };
      const result = await resolve(values, undefined, options);
      expect(result).toEqual({ values, errors: {} });
    });

    it('flags blank required fields on each field', async () => {
      expect(
        await fieldMessages({
          notificationType: NotificationChannel.Telegram,
          name: '  ',
          botToken: '',
          chatId: '',
        }),
      ).toEqual({
        name: 'Name is required.',
        botToken: 'Bot token is required.',
        chatId: 'Chat ID is required.',
      });
    });
  });

  describe('edit schema', () => {
    const resolve = yupResolver(editNotificationFormSchema);

    async function fieldMessages(values: EditNotificationFormValues): Promise<{
      name?: string;
      botToken?: string;
      chatId?: string;
    }> {
      const result = await resolve(values, undefined, options);
      return {
        name: result.errors.name?.message,
        botToken: result.errors.botToken?.message,
        chatId: result.errors.chatId?.message,
      };
    }

    it('accepts a valid edit payload with a blank (optional) bot token', async () => {
      const result = await resolve(
        { name: 'main', botToken: '', chatId: '123' },
        undefined,
        options,
      );
      expect(result).toEqual({ values: { name: 'main', botToken: '', chatId: '123' }, errors: {} });
    });

    it('flags a blank name and chat id but not the optional bot token', async () => {
      expect(await fieldMessages({ name: ' ', botToken: '', chatId: '' })).toEqual({
        name: 'Name is required.',
        botToken: undefined,
        chatId: 'Chat ID is required.',
      });
    });
  });
});
