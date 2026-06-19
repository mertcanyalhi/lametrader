import {
  type FieldDescriptor,
  FieldType,
  PriceSource,
  type StateFieldDescriptor,
} from '@lametrader/core';
import { Box, Button, Flex, Select, Text } from '@radix-ui/themes';
import { type ReactNode, useState } from 'react';
import { FieldLabel } from '../../../components/field-label.js';

/** Props for the descriptor-driven inputs form. */
export interface IndicatorInputsFormProps {
  /** The indicator's input descriptors — drives field rendering. */
  inputs: readonly FieldDescriptor[];
  /** The indicator's state descriptors (unused in this form, kept for shape parity). */
  state: readonly StateFieldDescriptor[];
  /** Pre-filled values keyed by descriptor key (an empty object on create). */
  initialValues: Record<string, unknown>;
  /** Fires with the validated input values when the form is submitted. */
  onSubmit: (payload: { inputs: Record<string, unknown> }) => void;
  /** Optional inline error message rendered above the footer (e.g. server 400). */
  errorMessage?: string | null;
  /** Optional cancel callback — when provided, a Cancel button is rendered. */
  onCancel?: () => void;
  /** Label for the submit button (defaults to "Save"). */
  submitLabel?: string;
  /** When true, the submit button shows the loading spinner and is disabled. */
  submitting?: boolean;
}

/**
 * Resolve the initial value for one descriptor: pre-fill from `initialValues`
 * (e.g. an existing instance's inputs) when present, else from the descriptor's
 * own `default`, else a type-appropriate empty value.
 */
function initialFor(descriptor: FieldDescriptor, initialValues: Record<string, unknown>): unknown {
  if (descriptor.key in initialValues) return initialValues[descriptor.key];
  if (descriptor.default !== undefined) return descriptor.default;
  if (descriptor.type === FieldType.Number) return '';
  if (descriptor.type === FieldType.Source) return PriceSource.Close;
  return descriptor.options[0]?.value;
}

/**
 * Descriptor-driven form: walks `inputs[]` and renders one row per descriptor
 * (Number → native number input; Source → Radix `<Select>` over `PriceSource`;
 * Enum → Radix `<Select>` over the descriptor's options).
 *
 * On submit, dispatches the typed `inputs` payload to the parent — the parent
 * owns the mutation (so it can route POST vs PUT and surface server errors).
 */
export function IndicatorInputsForm({
  inputs,
  initialValues,
  onSubmit,
  errorMessage,
  onCancel,
  submitLabel = 'Save',
  submitting = false,
}: IndicatorInputsFormProps): ReactNode {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const next: Record<string, unknown> = {};
    for (const descriptor of inputs) {
      next[descriptor.key] = initialFor(descriptor, initialValues);
    }
    return next;
  });

  function handleChange(key: string, value: unknown): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    const normalized: Record<string, unknown> = {};
    for (const descriptor of inputs) {
      const raw = values[descriptor.key];
      if (descriptor.type === FieldType.Number) {
        normalized[descriptor.key] = raw === '' ? Number.NaN : Number(raw);
      } else {
        normalized[descriptor.key] = raw;
      }
    }
    onSubmit({ inputs: normalized });
  }

  return (
    <form onSubmit={handleSubmit}>
      <Flex direction="column" gap="3">
        {inputs.map((descriptor) => (
          <InputRow
            key={descriptor.key}
            descriptor={descriptor}
            value={values[descriptor.key]}
            onChange={(next) => handleChange(descriptor.key, next)}
          />
        ))}
      </Flex>
      {errorMessage ? (
        <Text role="alert" color="red" size="2" mt="3" as="p">
          {errorMessage}
        </Text>
      ) : null}
      <Flex gap="3" mt="4" justify="end">
        {onCancel ? (
          <Button type="button" variant="soft" color="gray" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" loading={submitting} disabled={submitting}>
          {submitLabel}
        </Button>
      </Flex>
    </form>
  );
}

/**
 * One descriptor's row: a labeled control whose kind is chosen from the
 * descriptor's `type`. The wrapping `<label>`/`Text as="label"` ties the
 * descriptor's `label` to the control for accessible-name resolution.
 */
function InputRow({
  descriptor,
  value,
  onChange,
}: {
  descriptor: FieldDescriptor;
  value: unknown;
  onChange: (next: unknown) => void;
}): ReactNode {
  const inputId = `indicator-input-${descriptor.key}`;
  const labelNode = descriptor.description ? (
    <FieldLabel
      label={descriptor.label}
      hint={descriptor.description}
      hintLabel={`About ${descriptor.label}`}
      htmlFor={descriptor.type === FieldType.Number ? inputId : undefined}
    />
  ) : (
    <Text
      as="label"
      htmlFor={descriptor.type === FieldType.Number ? inputId : undefined}
      size="2"
      weight="medium"
    >
      {descriptor.label}
    </Text>
  );
  const control =
    descriptor.type === FieldType.Number ? (
      <input
        id={inputId}
        type="number"
        value={String(value ?? '')}
        min={descriptor.min}
        max={descriptor.max}
        step={descriptor.integer ? 1 : descriptor.step}
        onChange={(event) => onChange(event.target.value)}
        className="w-32 rounded-md border border-[var(--gray-a6)] bg-[var(--color-surface)] px-3 py-1.5 text-right text-sm text-[var(--gray-12)]"
      />
    ) : descriptor.type === FieldType.Source ? (
      <Select.Root value={String(value)} onValueChange={onChange}>
        <Select.Trigger aria-label={descriptor.label} className="w-32" />
        <Select.Content>
          {Object.values(PriceSource).map((source) => (
            <Select.Item key={source} value={source}>
              {source}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    ) : (
      <Select.Root value={String(value)} onValueChange={onChange}>
        <Select.Trigger aria-label={descriptor.label} className="w-40" />
        <Select.Content>
          {descriptor.options.map((option) => (
            <Select.Item key={option.value} value={option.value}>
              {option.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    );
  return (
    <Flex align="center" justify="between" gap="3">
      <Box>{labelNode}</Box>
      <Box>{control}</Box>
    </Flex>
  );
}
