import { yupResolver } from '@hookform/resolvers/yup';
import {
  type FieldDescriptor,
  FieldType,
  PriceSource,
  type StateFieldDescriptor,
} from '@lametrader/core';
import { Box, Button, Flex, Select, Text } from '@radix-ui/themes';
import { type ReactNode, useMemo } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { FieldLabel } from '../../../components/field-label.js';
import { buildIndicatorInputsSchema } from '../../../lib/indicator-inputs-schema.js';

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
 * Validation uses react-hook-form + a Yup schema built at render time from the
 * `inputs[]` descriptors (`buildIndicatorInputsSchema`) — same convention as
 * the static schemas under `lib/*-schema.ts`, see ADR 0011 + `packages/ui/CLAUDE.md`
 * Forms section. Field errors render inline; `errorMessage` carries the parent's
 * server-side failure above the footer.
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
  const schema = useMemo(() => buildIndicatorInputsSchema(inputs), [inputs]);
  const defaultValues = useMemo(() => {
    const next: Record<string, unknown> = {};
    for (const descriptor of inputs) {
      next[descriptor.key] = initialFor(descriptor, initialValues);
    }
    return next;
  }, [inputs, initialValues]);
  const { register, handleSubmit, setValue, watch, formState } = useForm<Record<string, unknown>>({
    resolver: yupResolver(schema),
    defaultValues,
    mode: 'onSubmit',
  });

  const onValid: SubmitHandler<Record<string, unknown>> = (values) => {
    onSubmit({ inputs: values });
  };

  return (
    <form onSubmit={handleSubmit(onValid)} noValidate>
      <Flex direction="column" gap="3">
        {inputs.map((descriptor) => (
          <InputRow
            key={descriptor.key}
            descriptor={descriptor}
            value={watch(descriptor.key)}
            register={register}
            onSelect={(next) =>
              setValue(descriptor.key, next, { shouldDirty: true, shouldValidate: true })
            }
            error={formState.errors[descriptor.key]?.message as string | undefined}
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

/** Register shape from react-hook-form, narrowed to the props the row needs. */
type RegisterFn = ReturnType<typeof useForm<Record<string, unknown>>>['register'];

/**
 * One descriptor's row: a labeled control whose kind is chosen from the
 * descriptor's `type`. The wrapping `<label>`/`Text as="label"` ties the
 * descriptor's `label` to the control for accessible-name resolution.
 *
 * Number fields are registered with react-hook-form so the form state and the
 * Yup-resolved value stay in sync; Source/Enum fields are driven through
 * `setValue` (Radix `<Select>` isn't a native input, so it's controlled).
 */
function InputRow({
  descriptor,
  value,
  register,
  onSelect,
  error,
}: {
  descriptor: FieldDescriptor;
  value: unknown;
  register: RegisterFn;
  onSelect: (next: string) => void;
  error: string | undefined;
}): ReactNode {
  const inputId = `indicator-input-${descriptor.key}`;
  const errorId = error ? `${inputId}-error` : undefined;
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
        min={descriptor.min}
        max={descriptor.max}
        step={descriptor.integer ? 1 : descriptor.step}
        defaultValue={String(value ?? '')}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={`${CONTROL_WIDTH_CLASS} block rounded-md border border-[var(--gray-a6)] bg-[var(--color-surface)] px-3 py-1.5 text-right text-sm text-[var(--gray-12)]`}
        {...register(descriptor.key)}
      />
    ) : descriptor.type === FieldType.Source ? (
      <Select.Root value={String(value)} onValueChange={onSelect}>
        <Select.Trigger aria-label={descriptor.label} className={CONTROL_WIDTH_CLASS} />
        <Select.Content>
          {Object.values(PriceSource).map((source) => (
            <Select.Item key={source} value={source}>
              {source}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    ) : (
      <Select.Root value={String(value)} onValueChange={onSelect}>
        <Select.Trigger aria-label={descriptor.label} className={CONTROL_WIDTH_CLASS} />
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
    <Flex direction="column" gap="1">
      <Flex align="center" justify="between" gap="3">
        <Box>{labelNode}</Box>
        {control}
      </Flex>
      {error ? (
        <Text id={errorId} role="alert" color="red" size="1" align="right">
          {error}
        </Text>
      ) : null}
    </Flex>
  );
}

/** Important to win over Radix Themes' own `rt-SelectTrigger` width rules. */
const CONTROL_WIDTH_CLASS = '!w-40';
