import { type Action, ActionKind, type StateValue, StateValueType } from '@lametrader/core';
import {
  Box,
  Button,
  Card,
  Flex,
  IconButton,
  RadioGroup,
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
 * The actions list editor — renders one card per state-write action and
 * leaves NotifyTelegram actions in place as a stub card (the dedicated
 * Telegram editor lands with #175). Add appends a fresh
 * `SetSymbolState { key: '', value: number 0 }` row.
 */
export function ActionsEditor({
  value,
  onChange,
}: {
  value: Action[];
  onChange: (next: Action[]) => void;
}): ReactNode {
  function update(index: number, next: Action): void {
    onChange(value.map((action, i) => (i === index ? next : action)));
  }
  function remove(index: number): void {
    onChange(value.filter((_, i) => i !== index));
  }
  function append(): void {
    onChange([
      ...value,
      {
        kind: ActionKind.SetSymbolState,
        key: '',
        value: { type: StateValueType.Number, value: 0 },
      },
    ]);
  }
  return (
    <Flex direction="column" gap="2">
      {value.length === 0 ? (
        <Text size="1" color="red" role="alert">
          Actions require at least one entry.
        </Text>
      ) : null}
      {value.map((action, index) =>
        action.kind === ActionKind.NotifyTelegram ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: actions are positional; no stable id.
          <TelegramCard key={index} index={index} action={action} update={update} remove={remove} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: actions are positional; no stable id.
          <ActionCard key={index} index={index} action={action} update={update} remove={remove} />
        ),
      )}
      <Flex gap="2">
        <Button type="button" size="1" variant="soft" onClick={append}>
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
              { kind: ActionKind.NotifyTelegram, destinationName: '', template: '' },
            ])
          }
        >
          <Plus size={12} aria-hidden="true" />
          Add telegram notification
        </Button>
      </Flex>
    </Flex>
  );
}

function TelegramCard({
  index,
  action,
  update,
  remove,
}: {
  index: number;
  action: Action & { kind: ActionKind.NotifyTelegram };
  update: (index: number, next: Action) => void;
  remove: (index: number) => void;
}): ReactNode {
  const destinations = useTelegramDestinations();
  const names = destinations.data ?? [];
  return (
    <Card variant="surface">
      <Flex direction="column" gap="2">
        <Flex align="center" justify="between" gap="2">
          <Text size="2" weight="medium">
            Telegram notification
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
          Available variables: {'{symbol}'}, {'{left}'}, {'{right}'}, {'{operator}'}, {'{ts}'}.
        </Text>
      </Flex>
    </Card>
  );
}

function ActionCard({
  index,
  action,
  update,
  remove,
}: {
  index: number;
  action: Action;
  update: (index: number, next: Action) => void;
  remove: (index: number) => void;
}): ReactNode {
  const op = isSetKind(action.kind) ? 'set' : 'remove';
  const scope = isSymbolScope(action.kind) ? 'symbol' : 'global';
  const key = 'key' in action ? action.key : '';
  return (
    <Card variant="surface">
      <Flex direction="column" gap="2">
        <Flex align="center" justify="between" gap="2">
          <RadioGroup.Root
            value={op}
            onValueChange={(next) =>
              update(index, swapKindOrScope(action, { op: next as 'set' | 'remove' }))
            }
            aria-label={`Action ${index + 1} operation`}
          >
            <RadioGroup.Item value="set">Set</RadioGroup.Item>
            <RadioGroup.Item value="remove">Remove</RadioGroup.Item>
          </RadioGroup.Root>
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
        <RadioGroup.Root
          value={scope}
          onValueChange={(next) =>
            update(index, swapKindOrScope(action, { scope: next as 'symbol' | 'global' }))
          }
          aria-label={`Action ${index + 1} scope`}
        >
          <RadioGroup.Item value="symbol">Symbol state</RadioGroup.Item>
          <RadioGroup.Item value="global">Global state</RadioGroup.Item>
        </RadioGroup.Root>
        <TextField.Root
          placeholder="State key"
          aria-label={`Action ${index + 1} key`}
          value={key}
          onChange={(event) => update(index, { ...action, key: event.target.value } as Action)}
        />
        {op === 'set' && 'value' in action ? (
          <SetValueEditor index={index} action={action} update={update} />
        ) : null}
      </Flex>
    </Card>
  );
}

function SetValueEditor({
  index,
  action,
  update,
}: {
  index: number;
  action: Action & { value: StateValue };
  update: (index: number, next: Action) => void;
}): ReactNode {
  return (
    <Flex direction="column" gap="2">
      <Select.Root
        value={action.value.type}
        onValueChange={(next) =>
          update(index, {
            ...action,
            value: defaultStateValue(next as StateValueType),
          } as Action)
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
      <ValueInput index={index} action={action} update={update} />
    </Flex>
  );
}

function ValueInput({
  index,
  action,
  update,
}: {
  index: number;
  action: Action & { value: StateValue };
  update: (index: number, next: Action) => void;
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
            } as Action);
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
              } as Action)
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
            update(index, {
              ...action,
              value: { type: v.type, value: event.target.value },
            } as Action)
          }
        />
      );
  }
}

function isSetKind(kind: ActionKind): boolean {
  return kind === ActionKind.SetSymbolState || kind === ActionKind.SetGlobalState;
}

function isSymbolScope(kind: ActionKind): boolean {
  return kind === ActionKind.SetSymbolState || kind === ActionKind.RemoveSymbolState;
}

function swapKindOrScope(
  action: Action,
  patch: { op?: 'set' | 'remove'; scope?: 'symbol' | 'global' },
): Action {
  const op = patch.op ?? (isSetKind(action.kind) ? 'set' : 'remove');
  const scope = patch.scope ?? (isSymbolScope(action.kind) ? 'symbol' : 'global');
  const kind = kindFor(op, scope);
  const key = 'key' in action ? action.key : '';
  if (op === 'set') {
    const value = 'value' in action ? action.value : defaultStateValue(StateValueType.Number);
    return { kind, key, value } as Action;
  }
  return { kind, key } as Action;
}

function kindFor(op: 'set' | 'remove', scope: 'symbol' | 'global'): ActionKind {
  if (op === 'set' && scope === 'symbol') return ActionKind.SetSymbolState;
  if (op === 'set' && scope === 'global') return ActionKind.SetGlobalState;
  if (op === 'remove' && scope === 'symbol') return ActionKind.RemoveSymbolState;
  return ActionKind.RemoveGlobalState;
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
