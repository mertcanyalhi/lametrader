import { RulesV2, type StateValue, StateValueType } from '@lametrader/core';
import {
  Box,
  Button,
  Card,
  Flex,
  IconButton,
  Select,
  Switch,
  Text,
  TextArea,
  TextField,
  Tooltip,
} from '@radix-ui/themes';
import { Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTelegramDestinations } from '../../lib/hooks/telegram.js';

/**
 * The v2 actions list editor — renders one card per action:
 *
 * - `Notification` (Telegram-only at v2 launch) — channel dropdown +
 *   destination picker + multi-line template editor.
 * - `Set*State` / `Remove*State` — op + scope dropdowns + key + value editor.
 *
 * "Add" buttons append a fresh row of each kind.
 */
export function ActionsEditorV2({
  value,
  onChange,
}: {
  value: RulesV2.Action[];
  onChange: (next: RulesV2.Action[]) => void;
}): ReactNode {
  function update(index: number, next: RulesV2.Action): void {
    onChange(value.map((action, i) => (i === index ? next : action)));
  }
  function remove(index: number): void {
    onChange(value.filter((_, i) => i !== index));
  }
  return (
    <Flex direction="column" gap="2">
      {value.length === 0 ? (
        <Text size="1" color="red" role="alert">
          Actions require at least one entry.
        </Text>
      ) : null}
      {value.map((action, index) =>
        action.kind === RulesV2.ActionKind.Notification ? (
          <NotificationCard
            // biome-ignore lint/suspicious/noArrayIndexKey: actions are positional; no stable id.
            key={index}
            index={index}
            action={action}
            update={update}
            remove={remove}
          />
        ) : (
          <StateActionCard
            // biome-ignore lint/suspicious/noArrayIndexKey: actions are positional; no stable id.
            key={index}
            index={index}
            action={action}
            update={update}
            remove={remove}
          />
        ),
      )}
      <Flex gap="2">
        <Button
          type="button"
          size="1"
          variant="soft"
          onClick={() =>
            onChange([
              ...value,
              {
                kind: RulesV2.ActionKind.SetSymbolState,
                key: '',
                value: { type: StateValueType.Number, value: 0 },
              },
            ])
          }
        >
          <Plus size={12} aria-hidden="true" />
          Add state action
        </Button>
        <Button
          type="button"
          size="1"
          variant="soft"
          onClick={() =>
            onChange([
              ...value,
              {
                kind: RulesV2.ActionKind.Notification,
                channel: RulesV2.NotificationChannel.Telegram,
                destinationName: '',
                template: '',
              },
            ])
          }
        >
          <Plus size={12} aria-hidden="true" />
          Add notification
        </Button>
      </Flex>
    </Flex>
  );
}

function NotificationCard({
  index,
  action,
  update,
  remove,
}: {
  index: number;
  action: RulesV2.NotificationAction;
  update: (index: number, next: RulesV2.Action) => void;
  remove: (index: number) => void;
}): ReactNode {
  const destinations = useTelegramDestinations();
  const names = destinations.data ?? [];
  return (
    <Card variant="surface">
      <Flex direction="column" gap="2">
        <Flex align="center" justify="between" gap="2">
          <Text size="2" weight="medium">
            Notification
          </Text>
          <Tooltip content="Remove">
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              aria-label={`Remove action ${index + 1}`}
              onClick={() => remove(index)}
            >
              <Trash2 size={14} aria-hidden="true" />
            </IconButton>
          </Tooltip>
        </Flex>
        <Select.Root
          value={action.channel}
          onValueChange={(next) =>
            update(index, { ...action, channel: next as RulesV2.NotificationChannel.Telegram })
          }
        >
          <Select.Trigger aria-label={`Action ${index + 1} channel`} />
          <Select.Content>
            <Select.Item value={RulesV2.NotificationChannel.Telegram}>Telegram</Select.Item>
          </Select.Content>
        </Select.Root>
        <Select.Root
          value={action.destinationName === '' ? undefined : action.destinationName}
          onValueChange={(next) => update(index, { ...action, destinationName: next })}
        >
          <Select.Trigger
            placeholder="Pick a destination"
            aria-label={`Action ${index + 1} destination`}
          />
          <Select.Content>
            {names.map((destination) => (
              <Select.Item key={destination.name} value={destination.name}>
                {destination.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <TextArea
          aria-label={`Action ${index + 1} template`}
          placeholder="Message template (multi-line)"
          value={action.template}
          onChange={(event) => update(index, { ...action, template: event.target.value })}
        />
        <Text size="1" color="gray">
          Available variables: {'{symbolId}'}, {'{ruleId}'}, {'{ts}'}.
        </Text>
      </Flex>
    </Card>
  );
}

function StateActionCard({
  index,
  action,
  update,
  remove,
}: {
  index: number;
  action: Exclude<RulesV2.Action, RulesV2.NotificationAction>;
  update: (index: number, next: RulesV2.Action) => void;
  remove: (index: number) => void;
}): ReactNode {
  const op = isSetKind(action.kind) ? 'set' : 'remove';
  const scope = isSymbolScope(action.kind) ? 'symbol' : 'global';
  return (
    <Card variant="surface">
      <Flex gap="2" align="center">
        <Flex gap="2" align="center" wrap="wrap" flexGrow="1">
          <Select.Root
            value={op}
            onValueChange={(next) =>
              update(index, swapKindOrScope(action, { op: next as 'set' | 'remove' }))
            }
          >
            <Select.Trigger aria-label={`Action ${index + 1} operation`} />
            <Select.Content>
              <Select.Item value="set">Set</Select.Item>
              <Select.Item value="remove">Remove</Select.Item>
            </Select.Content>
          </Select.Root>
          <Select.Root
            value={scope}
            onValueChange={(next) =>
              update(index, swapKindOrScope(action, { scope: next as 'symbol' | 'global' }))
            }
          >
            <Select.Trigger aria-label={`Action ${index + 1} scope`} />
            <Select.Content>
              <Select.Item value="symbol">Symbol state</Select.Item>
              <Select.Item value="global">Global state</Select.Item>
            </Select.Content>
          </Select.Root>
          <Box className="min-w-28 flex-1">
            <TextField.Root
              placeholder="State key"
              aria-label={`Action ${index + 1} key`}
              value={action.key}
              onChange={(event) =>
                update(index, { ...action, key: event.target.value } as RulesV2.Action)
              }
            />
          </Box>
          {op === 'set' && 'value' in action ? (
            <>
              <Text size="2" color="gray" aria-hidden="true">
                =
              </Text>
              <Select.Root
                value={action.value.type}
                onValueChange={(next) =>
                  update(index, {
                    ...action,
                    value: defaultStateValue(next as StateValueType),
                  } as RulesV2.Action)
                }
              >
                <Select.Trigger aria-label={`Action ${index + 1} value type`} />
                <Select.Content>
                  <Select.Item value={StateValueType.Number}>Number</Select.Item>
                  <Select.Item value={StateValueType.String}>String</Select.Item>
                  <Select.Item value={StateValueType.Bool}>Boolean</Select.Item>
                  <Select.Item value={StateValueType.Enum}>Enum</Select.Item>
                </Select.Content>
              </Select.Root>
              <Box className="min-w-28 flex-1">
                <ValueInput index={index} action={action} update={update} />
              </Box>
            </>
          ) : null}
        </Flex>
        <Tooltip content="Remove">
          <IconButton
            type="button"
            variant="ghost"
            color="gray"
            aria-label={`Remove action ${index + 1}`}
            onClick={() => remove(index)}
          >
            <Trash2 size={14} aria-hidden="true" />
          </IconButton>
        </Tooltip>
      </Flex>
    </Card>
  );
}

function ValueInput({
  index,
  action,
  update,
}: {
  index: number;
  action: (RulesV2.SetSymbolStateAction | RulesV2.SetGlobalStateAction) & { value: StateValue };
  update: (index: number, next: RulesV2.Action) => void;
}): ReactNode {
  const v = action.value;
  switch (v.type) {
    case StateValueType.Number:
      return (
        <TextField.Root
          type="number"
          aria-label={`Action ${index + 1} value`}
          value={Number.isFinite(v.value) ? String(v.value) : ''}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            update(index, {
              ...action,
              value: { type: StateValueType.Number, value: Number.isFinite(parsed) ? parsed : 0 },
            });
          }}
        />
      );
    case StateValueType.Bool:
      return (
        <Box>
          <Switch
            aria-label={`Action ${index + 1} value`}
            checked={v.value}
            onCheckedChange={(checked) =>
              update(index, {
                ...action,
                value: { type: StateValueType.Bool, value: checked === true },
              })
            }
          />
        </Box>
      );
    case StateValueType.String:
    case StateValueType.Enum:
      return (
        <TextField.Root
          aria-label={`Action ${index + 1} value`}
          value={v.value}
          onChange={(event) =>
            update(index, { ...action, value: { type: v.type, value: event.target.value } })
          }
        />
      );
  }
}

function isSetKind(kind: RulesV2.ActionKind): boolean {
  return kind === RulesV2.ActionKind.SetSymbolState || kind === RulesV2.ActionKind.SetGlobalState;
}

function isSymbolScope(kind: RulesV2.ActionKind): boolean {
  return (
    kind === RulesV2.ActionKind.SetSymbolState || kind === RulesV2.ActionKind.RemoveSymbolState
  );
}

function swapKindOrScope(
  action: Exclude<RulesV2.Action, RulesV2.NotificationAction>,
  patch: { op?: 'set' | 'remove'; scope?: 'symbol' | 'global' },
): RulesV2.Action {
  const op = patch.op ?? (isSetKind(action.kind) ? 'set' : 'remove');
  const scope = patch.scope ?? (isSymbolScope(action.kind) ? 'symbol' : 'global');
  const kind = kindFor(op, scope);
  const key = action.key;
  if (op === 'set') {
    const value = 'value' in action ? action.value : defaultStateValue(StateValueType.Number);
    return { kind, key, value } as RulesV2.Action;
  }
  return { kind, key } as RulesV2.Action;
}

function kindFor(op: 'set' | 'remove', scope: 'symbol' | 'global'): RulesV2.ActionKind {
  if (op === 'set' && scope === 'symbol') return RulesV2.ActionKind.SetSymbolState;
  if (op === 'set' && scope === 'global') return RulesV2.ActionKind.SetGlobalState;
  if (op === 'remove' && scope === 'symbol') return RulesV2.ActionKind.RemoveSymbolState;
  return RulesV2.ActionKind.RemoveGlobalState;
}

function defaultStateValue(type: StateValueType): StateValue {
  switch (type) {
    case StateValueType.Number:
      return { type: StateValueType.Number, value: 0 };
    case StateValueType.Bool:
      return { type: StateValueType.Bool, value: false };
    case StateValueType.Enum:
      return { type: StateValueType.Enum, value: '' };
    case StateValueType.String:
      return { type: StateValueType.String, value: '' };
  }
}
