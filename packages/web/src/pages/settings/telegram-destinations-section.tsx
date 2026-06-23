import { yupResolver } from '@hookform/resolvers/yup';
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
  Skeleton,
  Table,
  Text,
  TextField,
  Tooltip,
} from '@radix-ui/themes';
import { Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-fetch.js';
import {
  type TelegramDestinationSummary,
  useDeleteTelegramDestination,
  useTelegramDestinations,
  useUpsertTelegramDestination,
} from '../../lib/hooks/telegram.js';
import { getLogger } from '../../lib/log.js';
import {
  TELEGRAM_DESTINATION_LABELS,
  type TelegramDestinationFormValues,
  telegramDestinationFormSchema,
} from '../../lib/telegram-destination-schema.js';

const log = getLogger('telegram-destinations-section');

/**
 * The settings page's Telegram destinations section — list + Add dialog +
 * Delete confirm. Bot tokens are never read back from the server; the table
 * shows only name + chat id (matches `GET /notification/telegram/destinations`).
 *
 * The Settings page is the home for every future notification-channel
 * section; add a sibling component for the next adapter alongside this one.
 */
export function TelegramDestinationsSection(): ReactNode {
  const query = useTelegramDestinations();
  const [addOpen, setAddOpen] = useState(false);
  const [toDelete, setToDelete] = useState<TelegramDestinationSummary | null>(null);

  return (
    <Card>
      <div className="flex flex-col gap-4 p-2">
        <Flex justify="between" align="center">
          <Heading as="h2" size="3">
            Telegram destinations
          </Heading>
          <Button type="button" variant="soft" onClick={() => setAddOpen(true)}>
            <Plus size={14} aria-hidden="true" />
            Add destination
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
            No destinations configured.
          </Text>
        ) : (
          <Table.Root variant="surface" size="1">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Chat id</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Actions</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {query.data.map((destination) => (
                <Table.Row key={destination.name}>
                  <Table.Cell>{destination.name}</Table.Cell>
                  <Table.Cell>{destination.chatId}</Table.Cell>
                  <Table.Cell justify="end">
                    <Tooltip content="Delete">
                      <IconButton
                        type="button"
                        variant="ghost"
                        color="gray"
                        aria-label={`Delete ${destination.name}`}
                        onClick={() => setToDelete(destination)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </IconButton>
                    </Tooltip>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </div>

      <AddTelegramDestinationDialog open={addOpen} onOpenChange={setAddOpen} />
      {toDelete ? (
        <DeleteTelegramDestinationDialog
          destination={toDelete}
          onOpenChange={(next) => {
            if (!next) setToDelete(null);
          }}
        />
      ) : null}
    </Card>
  );
}

function AddTelegramDestinationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const upsert = useUpsertTelegramDestination();
  const { register, handleSubmit, reset, formState, setError } =
    useForm<TelegramDestinationFormValues>({
      resolver: yupResolver(telegramDestinationFormSchema),
      defaultValues: { name: '', botToken: '', chatId: '' },
      mode: 'onSubmit',
    });
  const nameError = formState.errors.name?.message;
  const botTokenError = formState.errors.botToken?.message;
  const chatIdError = formState.errors.chatId?.message;
  const submitError = formState.errors.root?.message;

  const onSubmit: SubmitHandler<TelegramDestinationFormValues> = async (values) => {
    try {
      const saved = await upsert.mutateAsync(values);
      toast.success(`Saved ${saved.name}`);
      reset();
      onOpenChange(false);
    } catch (cause) {
      log.warn({ err: cause, name: values.name }, 'add telegram destination failed');
      const message = cause instanceof ApiError ? cause.message : 'Failed to save destination';
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
        <Dialog.Title>Add Telegram destination</Dialog.Title>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <Flex direction="column" gap="3" mt="3">
            <Box>
              <Text as="label" htmlFor="telegram-destination-name" size="2" weight="medium">
                {TELEGRAM_DESTINATION_LABELS.name}
              </Text>
              <TextField.Root
                id="telegram-destination-name"
                aria-label={TELEGRAM_DESTINATION_LABELS.name}
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
              <Text as="label" htmlFor="telegram-destination-bot-token" size="2" weight="medium">
                {TELEGRAM_DESTINATION_LABELS.botToken}
              </Text>
              <TextField.Root
                id="telegram-destination-bot-token"
                aria-label={TELEGRAM_DESTINATION_LABELS.botToken}
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
              <Text as="label" htmlFor="telegram-destination-chat-id" size="2" weight="medium">
                {TELEGRAM_DESTINATION_LABELS.chatId}
              </Text>
              <TextField.Root
                id="telegram-destination-chat-id"
                aria-label={TELEGRAM_DESTINATION_LABELS.chatId}
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
              <Button type="button" variant="soft" color="gray" disabled={upsert.isPending}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="submit" loading={upsert.isPending} disabled={upsert.isPending}>
              Add
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function DeleteTelegramDestinationDialog({
  destination,
  onOpenChange,
}: {
  destination: TelegramDestinationSummary;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const remove = useDeleteTelegramDestination();

  async function handleConfirm(): Promise<void> {
    try {
      await remove.mutateAsync(destination.name);
      toast.success(`Deleted ${destination.name}`);
      onOpenChange(false);
    } catch (cause) {
      log.warn({ err: cause, name: destination.name }, 'delete telegram destination failed');
      const message = cause instanceof ApiError ? cause.message : 'Failed to delete destination';
      toast.error(message);
    }
  }

  return (
    <AlertDialog.Root open={true} onOpenChange={onOpenChange}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Delete destination</AlertDialog.Title>
        <AlertDialog.Description size="2">
          <Text>
            Delete destination "{destination.name}"? Rules sending to it will fail until you re-add
            it.
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
