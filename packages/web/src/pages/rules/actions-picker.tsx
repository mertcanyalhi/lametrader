import {
  type Action,
  ActionKind,
  type NotificationAction,
  NotificationChannel,
  type RemoveGlobalStateAction,
  type RemoveSymbolStateAction,
  type SetGlobalStateAction,
  type SetSymbolStateAction,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
import {
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
import type { KnownStateKeys } from './leaf-editor.js';
import { StateKeyPicker } from './state-key-picker.js';

/**
 * Human-readable label for each {@link ActionKind}.
 *
 * Used by the picker's kind dropdown and the action card header.
 */
export const ACTION_KIND_LABELS: Readonly<Record<ActionKind, string>> = {
  [ActionKind.Notification]: 'Send notification',
  [ActionKind.SetSymbolState]: 'Set symbol state',
  [ActionKind.RemoveSymbolState]: 'Remove symbol state',
  [ActionKind.SetGlobalState]: 'Set global state',
  [ActionKind.RemoveGlobalState]: 'Remove global state',
};

/**
 * The action-list editor — one row per action, with the kind dropdown driving
 * the per-kind form.
 *
 * Append a fresh action via the `+ Add action` button; each row carries a
 * trash IconButton for removal.
 *
 * @param value           - The current action list.
 * @param onChange        - Receives the next list on any edit.
 * @param knownStateKeys  - Symbol-state + global-state keys to seed the
 *                            `SetState` / `RemoveState` key combobox with;
 *                            freetext entry is always allowed.
 */
export function ActionsPicker({
  value,
  onChange,
  knownStateKeys,
  stateKeysLoading,
}: {
  value: Action[];
  onChange: (next: Action[]) => void;
  knownStateKeys: KnownStateKeys;
  stateKeysLoading?: boolean;
}): ReactNode {
  return (
    <Flex direction="column" gap="2">
      {value.map((action, index) => (
        <ActionRow
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id.
          key={index}
          value={action}
          onChange={(next) => onChange(value.map((existing, i) => (i === index ? next : existing)))}
          onRemove={() => onChange(value.filter((_, i) => i !== index))}
          knownStateKeys={knownStateKeys}
          stateKeysLoading={stateKeysLoading}
        />
      ))}
      <Flex>
        <Button
          type="button"
          variant="soft"
          color="gray"
          onClick={() => onChange([...value, defaultAction()])}
        >
          <Plus size={16} aria-hidden="true" />
          Add action
        </Button>
      </Flex>
    </Flex>
  );
}

/** One action card — kind dropdown + the per-kind body + remove button. */
function ActionRow({
  value,
  onChange,
  onRemove,
  knownStateKeys,
  stateKeysLoading,
}: {
  value: Action;
  onChange: (next: Action) => void;
  onRemove: () => void;
  knownStateKeys: KnownStateKeys;
  stateKeysLoading?: boolean;
}): ReactNode {
  return (
    <Card variant="surface">
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2" justify="between">
          <Select.Root
            value={value.kind}
            onValueChange={(next) => onChange(actionFromKind(next as ActionKind, value))}
          >
            <Select.Trigger aria-label="Action kind" />
            <Select.Content>
              {Object.values(ActionKind).map((kind) => (
                <Select.Item key={kind} value={kind}>
                  {ACTION_KIND_LABELS[kind]}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Tooltip content="Remove action">
            <IconButton
              type="button"
              variant="soft"
              color="gray"
              aria-label="Remove action"
              onClick={onRemove}
            >
              <Trash2 size={16} aria-hidden="true" />
            </IconButton>
          </Tooltip>
        </Flex>
        <ActionBody
          value={value}
          onChange={onChange}
          knownStateKeys={knownStateKeys}
          stateKeysLoading={stateKeysLoading}
        />
      </Flex>
    </Card>
  );
}

/** The per-kind form body — the editor renders the right fields per action kind. */
function ActionBody({
  value,
  onChange,
  knownStateKeys,
  stateKeysLoading,
}: {
  value: Action;
  onChange: (next: Action) => void;
  knownStateKeys: KnownStateKeys;
  stateKeysLoading?: boolean;
}): ReactNode {
  switch (value.kind) {
    case ActionKind.Notification:
      return <NotificationBody value={value} onChange={onChange} />;
    case ActionKind.SetSymbolState:
    case ActionKind.SetGlobalState:
      return (
        <SetStateBody
          value={value}
          onChange={onChange}
          knownStateKeys={knownStateKeys}
          stateKeysLoading={stateKeysLoading}
        />
      );
    case ActionKind.RemoveSymbolState:
    case ActionKind.RemoveGlobalState:
      return (
        <RemoveStateBody
          value={value}
          onChange={onChange}
          knownStateKeys={knownStateKeys}
          stateKeysLoading={stateKeysLoading}
        />
      );
  }
}

/** Notification (Telegram-only today) body: destination + template. */
function NotificationBody({
  value,
  onChange,
}: {
  value: NotificationAction;
  onChange: (next: Action) => void;
}): ReactNode {
  const destinations = useTelegramDestinations();
  const options = destinations.data ?? [];
  return (
    <Flex direction="column" gap="2">
      <Flex gap="2" align="center">
        <Text size="2" color="gray">
          Channel
        </Text>
        <Text size="2">Telegram</Text>
      </Flex>
      <Flex gap="2" align="center">
        <Text size="2" color="gray">
          Destination
        </Text>
        <Select.Root
          value={value.destinationName === '' ? undefined : value.destinationName}
          onValueChange={(destinationName) => onChange({ ...value, destinationName })}
        >
          <Select.Trigger aria-label="Telegram destination" placeholder="Pick a destination" />
          <Select.Content>
            {options.map((option) => (
              <Select.Item key={option.name} value={option.name}>
                {option.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>
      <TextArea
        aria-label="Notification template"
        placeholder="Notification template"
        value={value.template}
        onChange={(event) => onChange({ ...value, template: event.target.value })}
      />
    </Flex>
  );
}

/**
 * Set-state body: key (state-key combobox) + value (typed by `value.type` switch).
 *
 * Reuses the {@link StateKeyPicker} so users see suggestions from the same
 * `knownStateKeys` catalog the operand picker reads, with freetext fallback.
 */
function SetStateBody({
  value,
  onChange,
  knownStateKeys,
  stateKeysLoading,
}: {
  value: SetSymbolStateAction | SetGlobalStateAction;
  onChange: (next: Action) => void;
  knownStateKeys: KnownStateKeys;
  stateKeysLoading?: boolean;
}): ReactNode {
  const knownKeys =
    value.kind === ActionKind.SetSymbolState ? knownStateKeys.symbol : knownStateKeys.global;
  const ariaLabel =
    value.kind === ActionKind.SetSymbolState ? 'Symbol state key' : 'Global state key';
  return (
    <Flex direction="column" gap="2">
      <StateKeyPicker
        value={value.key}
        knownKeys={knownKeys}
        ariaLabel={ariaLabel}
        isLoading={stateKeysLoading}
        onChange={(key) => onChange({ ...value, key })}
      />
      <Flex gap="2" align="center">
        <Text size="2" color="gray">
          Value type
        </Text>
        <Select.Root
          value={value.value.type}
          onValueChange={(next) =>
            onChange({ ...value, value: defaultStateValue(next as StateValueType) })
          }
        >
          <Select.Trigger aria-label="State value type" />
          <Select.Content>
            {Object.values(StateValueType).map((type) => (
              <Select.Item key={type} value={type}>
                {type}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>
      <StateValueInput value={value} onChange={onChange} />
    </Flex>
  );
}

/** State-value input — narrow per `value.type`. */
function StateValueInput({
  value,
  onChange,
}: {
  value: SetSymbolStateAction | SetGlobalStateAction;
  onChange: (next: Action) => void;
}): ReactNode {
  switch (value.value.type) {
    case StateValueType.Number:
      return (
        <TextField.Root
          aria-label="State value"
          type="number"
          step="any"
          value={value.value.value}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange({
              ...value,
              value: { type: StateValueType.Number, value: Number.isFinite(parsed) ? parsed : 0 },
            });
          }}
        />
      );
    case StateValueType.Bool:
      return (
        <Switch
          aria-label="State value"
          checked={value.value.value}
          onCheckedChange={(next) =>
            onChange({ ...value, value: { type: StateValueType.Bool, value: next === true } })
          }
        />
      );
    case StateValueType.String:
      return (
        <TextField.Root
          aria-label="State value"
          value={value.value.value}
          onChange={(event) =>
            onChange({
              ...value,
              value: { type: StateValueType.String, value: event.target.value },
            })
          }
        />
      );
    case StateValueType.Enum:
      return (
        <TextField.Root
          aria-label="State value"
          value={value.value.value}
          onChange={(event) =>
            onChange({
              ...value,
              value: { type: StateValueType.Enum, value: event.target.value },
            })
          }
        />
      );
  }
}

/**
 * Remove-state body: just the key, via the shared {@link StateKeyPicker}.
 */
function RemoveStateBody({
  value,
  onChange,
  knownStateKeys,
  stateKeysLoading,
}: {
  value: RemoveSymbolStateAction | RemoveGlobalStateAction;
  onChange: (next: Action) => void;
  knownStateKeys: KnownStateKeys;
  stateKeysLoading?: boolean;
}): ReactNode {
  const knownKeys =
    value.kind === ActionKind.RemoveSymbolState ? knownStateKeys.symbol : knownStateKeys.global;
  const ariaLabel =
    value.kind === ActionKind.RemoveSymbolState ? 'Symbol state key' : 'Global state key';
  return (
    <StateKeyPicker
      value={value.key}
      knownKeys={knownKeys}
      ariaLabel={ariaLabel}
      isLoading={stateKeysLoading}
      onChange={(key) => onChange({ ...value, key })}
    />
  );
}

/**
 * Build a fresh action for a kind change, preserving `key` where it carries
 * over and resetting unrelated fields to defaults.
 */
function actionFromKind(kind: ActionKind, prev: Action): Action {
  switch (kind) {
    case ActionKind.Notification:
      return {
        kind: ActionKind.Notification,
        channel: NotificationChannel.Telegram,
        destinationName: '',
        template: '',
      };
    case ActionKind.SetSymbolState:
    case ActionKind.SetGlobalState:
      return {
        kind,
        key: 'key' in prev ? prev.key : '',
        value: { type: StateValueType.String, value: '' },
      };
    case ActionKind.RemoveSymbolState:
    case ActionKind.RemoveGlobalState:
      return { kind, key: 'key' in prev ? prev.key : '' };
  }
}

/** A neutral default action — used when appending a new row. */
function defaultAction(): Action {
  return {
    kind: ActionKind.Notification,
    channel: NotificationChannel.Telegram,
    destinationName: '',
    template: '',
  };
}

/** A default {@link StateValue} for a given type. */
function defaultStateValue(type: StateValueType): StateValue {
  switch (type) {
    case StateValueType.Number:
      return { type, value: 0 };
    case StateValueType.Bool:
      return { type, value: false };
    case StateValueType.String:
      return { type, value: '' };
    case StateValueType.Enum:
      return { type, value: '' };
  }
}
