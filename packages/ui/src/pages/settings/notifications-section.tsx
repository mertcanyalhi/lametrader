import { yupResolver } from '@hookform/resolvers/yup';
import { NotificationChannel, type NotificationConfigSummary } from '@lametrader/core';
import {
  AlertDialog,
  Box,
  Button,
  Callout,
  Card,
  Dialog,
  Flex,
  Heading,
  IconButton,
  Select,
  Skeleton,
  Table,
  Text,
  TextField,
  Tooltip,
} from '@radix-ui/themes';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Controller, type SubmitHandler, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-fetch.js';
import {
  type CreateNotificationInput,
  useCreateNotification,
  useDeleteNotification,
  useNotification,
  useNotifications,
  useUpdateNotification,
} from '../../lib/hooks/notifications.js';
import { getLogger } from '../../lib/log.js';
import {
  type CreateNotificationFormValues,
  createNotificationFormSchema,
  type EditNotificationFormValues,
  editNotificationFormSchema,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_CONFIG_LABELS,
} from '../../lib/notification-config-schema.js';

const log = getLogger('notifications-section');

/**
 * The settings page's Notifications section — a generic table (Notification
 * type / Name / Actions) over every configured channel, with create / edit /
 * delete dialogs. Telegram is the only channel today; the table and dialogs are
 * channel-agnostic where they can be. Bot tokens are never read back.
 */
export function NotificationsSection(): ReactNode {
  const query = useNotifications();
  const [addOpen, setAddOpen] = useState(false);
  const [toEdit, setToEdit] = useState<NotificationConfigSummary | null>(null);
  const [toDelete, setToDelete] = useState<NotificationConfigSummary | null>(null);

  return (
    <Card>
      <div className="flex flex-col gap-4 p-2">
        <Flex justify="between" align="center">
          <Heading as="h2" size="3">
            Notifications
          </Heading>
          <Button type="button" variant="soft" onClick={() => setAddOpen(true)}>
            <Plus size={14} aria-hidden="true" />
            Add notification
          </Button>
        </Flex>

        {query.isPending ? (
          <Skeleton height="2rem" />
        ) : query.isError ? (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{query.error.message}</Callout.Text>
          </Callout.Root>
        ) : !Array.isArray(query.data) || query.data.length === 0 ? (
          <Text size="2" color="gray" role="status">
            No notifications configured.
          </Text>
        ) : (
          <Table.Root variant="surface" size="1">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Notification type</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Actions</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {query.data.map((config) => (
                <Table.Row key={config.id}>
                  <Table.Cell>{NOTIFICATION_CHANNEL_LABELS[config.notificationType]}</Table.Cell>
                  <Table.Cell>{config.name}</Table.Cell>
                  <Table.Cell justify="end">
                    <Flex gap="2" justify="end">
                      <Tooltip content="Edit">
                        <IconButton
                          type="button"
                          variant="ghost"
                          color="gray"
                          aria-label={`Edit ${config.name}`}
                          onClick={() => setToEdit(config)}
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip content="Delete">
                        <IconButton
                          type="button"
                          variant="ghost"
                          color="gray"
                          aria-label={`Delete ${config.name}`}
                          onClick={() => setToDelete(config)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </IconButton>
                      </Tooltip>
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </div>

      <AddNotificationDialog open={addOpen} onOpenChange={setAddOpen} />
      {toEdit ? (
        <EditNotificationDialog
          summary={toEdit}
          onOpenChange={(next) => {
            if (!next) setToEdit(null);
          }}
        />
      ) : null}
      {toDelete ? (
        <DeleteNotificationDialog
          summary={toDelete}
          onOpenChange={(next) => {
            if (!next) setToDelete(null);
          }}
        />
      ) : null}
    </Card>
  );
}

function AddNotificationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const create = useCreateNotification();
  const { control, register, handleSubmit, reset, formState, setError } =
    useForm<CreateNotificationFormValues>({
      resolver: yupResolver(createNotificationFormSchema),
      defaultValues: {
        notificationType: NotificationChannel.Telegram,
        name: '',
        botToken: '',
        chatId: '',
      },
      mode: 'onSubmit',
    });
  const nameError = formState.errors.name?.message;
  const botTokenError = formState.errors.botToken?.message;
  const chatIdError = formState.errors.chatId?.message;
  const submitError = formState.errors.root?.message;

  const onSubmit: SubmitHandler<CreateNotificationFormValues> = async (values) => {
    try {
      const saved = await create.mutateAsync(values as CreateNotificationInput);
      toast.success(`Saved ${saved.name}`);
      reset();
      onOpenChange(false);
    } catch (cause) {
      log.warn({ err: cause, name: values.name }, 'add notification failed');
      const message = cause instanceof ApiError ? cause.message : 'Failed to save notification';
      setError('root', { type: 'server', message });
    }
  };

  function handleOpenChange(next: boolean): void {
    if (!next) reset();
    onOpenChange(next);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Add notification</Dialog.Title>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <Flex direction="column" gap="3" mt="3">
            <Box>
              <Text as="label" size="2" weight="medium">
                {NOTIFICATION_CONFIG_LABELS.notificationType}
              </Text>
              <Controller
                control={control}
                name="notificationType"
                render={({ field }) => (
                  <Select.Root value={field.value} onValueChange={field.onChange}>
                    <Select.Trigger aria-label={NOTIFICATION_CONFIG_LABELS.notificationType} />
                    <Select.Content>
                      {Object.values(NotificationChannel).map((channel) => (
                        <Select.Item key={channel} value={channel}>
                          {NOTIFICATION_CHANNEL_LABELS[channel]}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                )}
              />
            </Box>
            <Box>
              <Text as="label" htmlFor="notification-name" size="2" weight="medium">
                {NOTIFICATION_CONFIG_LABELS.name}
              </Text>
              <TextField.Root
                id="notification-name"
                aria-label={NOTIFICATION_CONFIG_LABELS.name}
                aria-invalid={nameError ? true : undefined}
                autoFocus
                {...register('name')}
              />
              {nameError ? (
                <Text role="alert" color="red" size="1">
                  {nameError}
                </Text>
              ) : null}
            </Box>
            <Box>
              <Text as="label" htmlFor="notification-bot-token" size="2" weight="medium">
                {NOTIFICATION_CONFIG_LABELS.botToken}
              </Text>
              <TextField.Root
                id="notification-bot-token"
                aria-label={NOTIFICATION_CONFIG_LABELS.botToken}
                aria-invalid={botTokenError ? true : undefined}
                type="password"
                autoComplete="off"
                {...register('botToken')}
              />
              {botTokenError ? (
                <Text role="alert" color="red" size="1">
                  {botTokenError}
                </Text>
              ) : null}
            </Box>
            <Box>
              <Text as="label" htmlFor="notification-chat-id" size="2" weight="medium">
                {NOTIFICATION_CONFIG_LABELS.chatId}
              </Text>
              <TextField.Root
                id="notification-chat-id"
                aria-label={NOTIFICATION_CONFIG_LABELS.chatId}
                aria-invalid={chatIdError ? true : undefined}
                {...register('chatId')}
              />
              {chatIdError ? (
                <Text role="alert" color="red" size="1">
                  {chatIdError}
                </Text>
              ) : null}
            </Box>
            {submitError ? (
              <Callout.Root color="red" role="alert">
                <Callout.Text>{submitError}</Callout.Text>
              </Callout.Root>
            ) : null}
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray" disabled={create.isPending}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="submit" loading={create.isPending} disabled={create.isPending}>
              Add
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function EditNotificationDialog({
  summary,
  onOpenChange,
}: {
  summary: NotificationConfigSummary;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const query = useNotification(summary.id);

  return (
    <Dialog.Root open={true} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Edit notification</Dialog.Title>
        {query.isPending ? (
          <Skeleton height="8rem" />
        ) : query.isError ? (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{query.error.message}</Callout.Text>
          </Callout.Root>
        ) : (
          <EditNotificationForm
            id={summary.id}
            initial={{ name: query.data.name, botToken: '', chatId: query.data.chatId }}
            onOpenChange={onOpenChange}
          />
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

function EditNotificationForm({
  id,
  initial,
  onOpenChange,
}: {
  id: string;
  initial: EditNotificationFormValues;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const update = useUpdateNotification();
  const { register, handleSubmit, formState, setError } = useForm<EditNotificationFormValues>({
    resolver: yupResolver(editNotificationFormSchema),
    defaultValues: initial,
    mode: 'onSubmit',
  });
  const nameError = formState.errors.name?.message;
  const botTokenError = formState.errors.botToken?.message;
  const chatIdError = formState.errors.chatId?.message;
  const submitError = formState.errors.root?.message;

  const onSubmit: SubmitHandler<EditNotificationFormValues> = async (values) => {
    try {
      const patch = {
        name: values.name,
        chatId: values.chatId,
        // Only send a new bot token when the user typed one — blank keeps the stored one.
        ...(values.botToken.trim() === '' ? {} : { botToken: values.botToken }),
      };
      const saved = await update.mutateAsync({ id, patch });
      toast.success(`Saved ${saved.name}`);
      onOpenChange(false);
    } catch (cause) {
      log.warn({ err: cause, id }, 'edit notification failed');
      const message = cause instanceof ApiError ? cause.message : 'Failed to save notification';
      setError('root', { type: 'server', message });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <Flex direction="column" gap="3" mt="3">
        <Box>
          <Text as="label" htmlFor="edit-notification-name" size="2" weight="medium">
            {NOTIFICATION_CONFIG_LABELS.name}
          </Text>
          <TextField.Root
            id="edit-notification-name"
            aria-label={NOTIFICATION_CONFIG_LABELS.name}
            aria-invalid={nameError ? true : undefined}
            autoFocus
            {...register('name')}
          />
          {nameError ? (
            <Text role="alert" color="red" size="1">
              {nameError}
            </Text>
          ) : null}
        </Box>
        <Box>
          <Text as="label" htmlFor="edit-notification-bot-token" size="2" weight="medium">
            {NOTIFICATION_CONFIG_LABELS.botToken}
          </Text>
          <TextField.Root
            id="edit-notification-bot-token"
            aria-label={NOTIFICATION_CONFIG_LABELS.botToken}
            aria-invalid={botTokenError ? true : undefined}
            type="password"
            autoComplete="off"
            placeholder="Leave blank to keep the current token"
            {...register('botToken')}
          />
          {botTokenError ? (
            <Text role="alert" color="red" size="1">
              {botTokenError}
            </Text>
          ) : null}
        </Box>
        <Box>
          <Text as="label" htmlFor="edit-notification-chat-id" size="2" weight="medium">
            {NOTIFICATION_CONFIG_LABELS.chatId}
          </Text>
          <TextField.Root
            id="edit-notification-chat-id"
            aria-label={NOTIFICATION_CONFIG_LABELS.chatId}
            aria-invalid={chatIdError ? true : undefined}
            {...register('chatId')}
          />
          {chatIdError ? (
            <Text role="alert" color="red" size="1">
              {chatIdError}
            </Text>
          ) : null}
        </Box>
        {submitError ? (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{submitError}</Callout.Text>
          </Callout.Root>
        ) : null}
      </Flex>
      <Flex gap="3" mt="4" justify="end">
        <Dialog.Close>
          <Button type="button" variant="soft" color="gray" disabled={update.isPending}>
            Cancel
          </Button>
        </Dialog.Close>
        <Button type="submit" loading={update.isPending} disabled={update.isPending}>
          Save
        </Button>
      </Flex>
    </form>
  );
}

function DeleteNotificationDialog({
  summary,
  onOpenChange,
}: {
  summary: NotificationConfigSummary;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const remove = useDeleteNotification();

  async function handleConfirm(): Promise<void> {
    try {
      await remove.mutateAsync(summary.id);
      toast.success(`Deleted ${summary.name}`);
      onOpenChange(false);
    } catch (cause) {
      log.warn({ err: cause, id: summary.id }, 'delete notification failed');
      const message = cause instanceof ApiError ? cause.message : 'Failed to delete notification';
      toast.error(message);
    }
  }

  return (
    <AlertDialog.Root open={true} onOpenChange={onOpenChange}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Delete notification</AlertDialog.Title>
        <AlertDialog.Description size="2">
          <Text>
            Delete notification "{summary.name}"? Rules sending to it will fail until you re-add it.
          </Text>
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color="red" onClick={handleConfirm} loading={remove.isPending}>
              Delete
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
