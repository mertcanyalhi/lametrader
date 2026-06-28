import { type IndicatorInstance, Period, RulesV2, StateValueType } from '@lametrader/core';
import {
  Box,
  Button,
  Card,
  Flex,
  IconButton,
  SegmentedControl,
  Select,
  Text,
  TextField,
  Tooltip,
} from '@radix-ui/themes';
import { Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { OperandPickerV2, operandV2ValueType } from './operand-picker.js';
import { familyForOperatorV2, OperatorPickerV2, validOperatorsV2For } from './operator-picker.js';

/** A neutral starter leaf — Comparison `Price > 0`, the form's safe default. */
const PLACEHOLDER_LEAF_V2: RulesV2.ConditionNode = {
  kind: RulesV2.ConditionNodeKind.Leaf,
  leaf: {
    family: RulesV2.LeafConditionFamily.Comparison,
    operator: RulesV2.ComparisonOperator.Gt,
    left: { kind: RulesV2.OperandKind.Price },
    right: { kind: RulesV2.OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
  },
};

/** A neutral starter group — empty so the user picks the first child themselves. */
const EMPTY_GROUP_V2: RulesV2.ConditionNode = {
  kind: RulesV2.ConditionNodeKind.And,
  children: [],
};

/**
 * Build a field-path key for one operand inside the condition tree, matching
 * the v2 API's `fields[].path` shape (e.g. `condition.children[0].leaf.right`).
 */
function fieldPath(
  base: 'left' | 'right' | 'lower' | 'upper' | 'threshold' | 'lookbackBars',
  path: readonly number[],
): string {
  const childrenPath = path.map((index) => `children[${index}]`).join('.');
  const prefix = childrenPath === '' ? 'condition' : `condition.${childrenPath}`;
  return `${prefix}.leaf.${base}`;
}

/**
 * The recursive v2 condition-tree editor — walks a {@link RulesV2.ConditionNode}
 * and renders the group / leaf affordances. Every leaf renders its operand /
 * operator pickers per the family discriminator (Comparison / Crossing / State
 * → binary; Channel → ternary; Moving → unary + scalar tuple).
 *
 * Tree edits are immutable: every action returns a new tree to `onChange`.
 */
export function ConditionTreeEditorV2({
  value,
  onChange,
  indicators,
  profileId,
  symbolId,
  fieldErrors,
}: {
  value: RulesV2.ConditionNode;
  onChange: (next: RulesV2.ConditionNode) => void;
  indicators: IndicatorInstance[];
  profileId: string | undefined;
  symbolId: string | undefined;
  /** Per-field validation messages keyed by API path (`condition.children[0].leaf.right`). */
  fieldErrors: Record<string, string>;
}): ReactNode {
  return (
    <NodeView
      path={[]}
      node={value}
      root={value}
      onChange={onChange}
      indicators={indicators}
      profileId={profileId}
      symbolId={symbolId}
      fieldErrors={fieldErrors}
    />
  );
}

function NodeView({
  path,
  node,
  root,
  onChange,
  indicators,
  profileId,
  symbolId,
  fieldErrors,
}: {
  path: number[];
  node: RulesV2.ConditionNode;
  root: RulesV2.ConditionNode;
  onChange: (next: RulesV2.ConditionNode) => void;
  indicators: IndicatorInstance[];
  profileId: string | undefined;
  symbolId: string | undefined;
  fieldErrors: Record<string, string>;
}): ReactNode {
  if (node.kind === RulesV2.ConditionNodeKind.Leaf) {
    return (
      <Card variant="surface">
        <LeafEditor
          path={path}
          leaf={node.leaf}
          onChange={(nextLeaf) =>
            onChange(
              replaceAt(root, path, { kind: RulesV2.ConditionNodeKind.Leaf, leaf: nextLeaf }),
            )
          }
          indicators={indicators}
          profileId={profileId}
          symbolId={symbolId}
          fieldErrors={fieldErrors}
        />
      </Card>
    );
  }
  const isRoot = path.length === 0;
  const isAnd = node.kind === RulesV2.ConditionNodeKind.And;
  return (
    <Card variant="surface">
      <Flex direction="column" gap="2">
        <Flex gap="2" align="center" justify="between">
          <SegmentedControl.Root
            value={isAnd ? 'and' : 'or'}
            onValueChange={(next) => {
              const replaced: RulesV2.ConditionNode = {
                kind: next === 'and' ? RulesV2.ConditionNodeKind.And : RulesV2.ConditionNodeKind.Or,
                children: node.children,
              };
              onChange(replaceAt(root, path, replaced));
            }}
            aria-label={isRoot ? 'Combine root conditions with' : 'Combine group conditions with'}
            size="1"
          >
            <SegmentedControl.Item value="and">AND</SegmentedControl.Item>
            <SegmentedControl.Item value="or">OR</SegmentedControl.Item>
          </SegmentedControl.Root>
          <Flex gap="2">
            <Button
              type="button"
              size="1"
              variant="soft"
              onClick={() =>
                onChange(
                  replaceAt(root, path, {
                    ...node,
                    children: [...node.children, PLACEHOLDER_LEAF_V2],
                  }),
                )
              }
            >
              <Plus size={12} aria-hidden="true" />
              Leaf
            </Button>
            <Button
              type="button"
              size="1"
              variant="soft"
              onClick={() =>
                onChange(
                  replaceAt(root, path, {
                    ...node,
                    children: [...node.children, EMPTY_GROUP_V2],
                  }),
                )
              }
            >
              <Plus size={12} aria-hidden="true" />
              Group
            </Button>
          </Flex>
        </Flex>
        {node.children.length === 0 ? (
          <Text size="1" color="red" role="alert">
            This group needs at least one child.
          </Text>
        ) : null}
        {node.children.map((child, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: condition children are positional.
          <Flex key={index} gap="2" align="start">
            <Box flexGrow="1">
              <NodeView
                path={[...path, index]}
                node={child}
                root={root}
                onChange={onChange}
                indicators={indicators}
                profileId={profileId}
                symbolId={symbolId}
                fieldErrors={fieldErrors}
              />
            </Box>
            <Tooltip content="Remove">
              <IconButton
                type="button"
                size="1"
                variant="ghost"
                color="gray"
                aria-label={`Remove ${labelFor(child)} at ${describePath([...path, index])}`}
                onClick={() => onChange(removeAt(root, [...path, index]))}
              >
                <Trash2 size={12} aria-hidden="true" />
              </IconButton>
            </Tooltip>
          </Flex>
        ))}
      </Flex>
    </Card>
  );
}

/**
 * The leaf row. Routes by family:
 *
 * - Binary families (Comparison / Crossing / State): left + operator + right.
 * - Channel: left + operator + lower + upper.
 * - Moving: left + operator + threshold + lookbackBars.
 *
 * Bool-operand sugar: when `left`'s value type is `Bool`, the operator + RHS
 * rows are hidden — the leaf is rewritten as a State `Equals` against a
 * `Literal(true)` (per CONTEXT.md Ex.3 and the boundary schema).
 */
function LeafEditor({
  path,
  leaf,
  onChange,
  indicators,
  profileId,
  symbolId,
  fieldErrors,
}: {
  path: number[];
  leaf: RulesV2.LeafCondition;
  onChange: (next: RulesV2.LeafCondition) => void;
  indicators: IndicatorInstance[];
  profileId: string | undefined;
  symbolId: string | undefined;
  fieldErrors: Record<string, string>;
}): ReactNode {
  const leftType = operandV2ValueType(leaf.left);
  const isBoolShortcut = leftType === StateValueType.Bool;

  function setLeft(left: RulesV2.ConditionOperand): void {
    onChange(rebuildLeafForLeft(leaf, left));
  }

  return (
    <Flex direction="column" gap="3">
      <Flex gap="3" align="start" wrap="wrap">
        <Box flexGrow="1" minWidth="220px">
          <OperandPickerV2
            value={leaf.left}
            onChange={setLeft}
            indicators={indicators}
            interval={leaf.interval}
            profileId={profileId}
            symbolId={symbolId}
            ariaLabel="Left operand"
            inlineError={fieldErrors[fieldPath('left', path)]}
          />
        </Box>
        {isBoolShortcut ? null : (
          <Box mt="2">
            <OperatorPickerV2
              value={leaf.operator}
              onChange={(operator) => onChange(rebuildLeafForOperator(leaf, operator))}
              left={leaf.left}
              right={'right' in leaf ? leaf.right : undefined}
              ariaLabel="Operator"
            />
          </Box>
        )}
        {!isBoolShortcut && leaf.family === RulesV2.LeafConditionFamily.Channel ? (
          <Box flexGrow="1" minWidth="220px">
            <OperandPickerV2
              value={leaf.lower}
              onChange={(lower) => onChange({ ...leaf, lower })}
              indicators={indicators}
              interval={leaf.interval}
              profileId={profileId}
              symbolId={symbolId}
              ariaLabel="Lower bound operand"
              inlineError={fieldErrors[fieldPath('lower', path)]}
            />
          </Box>
        ) : null}
        {!isBoolShortcut && leaf.family === RulesV2.LeafConditionFamily.Channel ? (
          <Box flexGrow="1" minWidth="220px">
            <OperandPickerV2
              value={leaf.upper}
              onChange={(upper) => onChange({ ...leaf, upper })}
              indicators={indicators}
              interval={leaf.interval}
              profileId={profileId}
              symbolId={symbolId}
              ariaLabel="Upper bound operand"
              inlineError={fieldErrors[fieldPath('upper', path)]}
            />
          </Box>
        ) : null}
        {!isBoolShortcut && leaf.family === RulesV2.LeafConditionFamily.Moving ? (
          <Flex direction="column" gap="2" flexGrow="1" minWidth="220px">
            <TextField.Root
              type="number"
              aria-label="Moving threshold"
              placeholder="Threshold"
              value={Number.isFinite(leaf.threshold) ? String(leaf.threshold) : ''}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                onChange({ ...leaf, threshold: Number.isFinite(parsed) ? parsed : 0 });
              }}
            />
            {fieldErrors[fieldPath('threshold', path)] ? (
              <Text role="alert" color="red" size="1">
                {fieldErrors[fieldPath('threshold', path)]}
              </Text>
            ) : null}
            <TextField.Root
              type="number"
              aria-label="Moving lookback bars"
              placeholder="Lookback bars"
              value={Number.isFinite(leaf.lookbackBars) ? String(leaf.lookbackBars) : ''}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                onChange({
                  ...leaf,
                  lookbackBars: Number.isInteger(parsed) && parsed > 0 ? parsed : 1,
                });
              }}
            />
            {fieldErrors[fieldPath('lookbackBars', path)] ? (
              <Text role="alert" color="red" size="1">
                {fieldErrors[fieldPath('lookbackBars', path)]}
              </Text>
            ) : null}
          </Flex>
        ) : null}
        {!isBoolShortcut &&
        (leaf.family === RulesV2.LeafConditionFamily.Comparison ||
          leaf.family === RulesV2.LeafConditionFamily.Crossing ||
          leaf.family === RulesV2.LeafConditionFamily.State) ? (
          <Box flexGrow="1" minWidth="220px">
            <OperandPickerV2
              value={leaf.right}
              onChange={(right) => onChange(rebuildLeafForRight(leaf, right))}
              indicators={indicators}
              interval={leaf.interval}
              profileId={profileId}
              symbolId={symbolId}
              ariaLabel="Right operand"
              inlineError={fieldErrors[fieldPath('right', path)]}
            />
          </Box>
        ) : null}
      </Flex>
      <IntervalPicker
        interval={leaf.interval}
        onChange={(interval) => onChange({ ...leaf, interval })}
      />
    </Flex>
  );
}

/**
 * Inline `interval` picker — a small dropdown so OHLCV / IndicatorRef leaves
 * can pick which bar period they read against. `None` clears the interval
 * (the operand is interval-agnostic).
 */
function IntervalPicker({
  interval,
  onChange,
}: {
  interval: Period | undefined;
  onChange: (next: Period | undefined) => void;
}): ReactNode {
  return (
    <Flex gap="2" align="center">
      <Text size="1" color="gray">
        Interval
      </Text>
      <Select.Root
        value={interval === undefined ? 'none' : interval}
        onValueChange={(next) => onChange(next === 'none' ? undefined : (next as Period))}
      >
        <Select.Trigger aria-label="Leaf interval" />
        <Select.Content>
          <Select.Item value="none">None</Select.Item>
          {Object.values(Period).map((value) => (
            <Select.Item key={value} value={value}>
              {value}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Flex>
  );
}

/**
 * Build a new leaf with a different left operand. If the new left's value type
 * is `Bool`, collapse to the bool-operand sugar (State `Equals` against
 * `Literal(true)`). Otherwise re-validate the operator against the new pair
 * and swap to the first valid one if necessary; rebuild the leaf for that
 * operator's family.
 */
function rebuildLeafForLeft(
  leaf: RulesV2.LeafCondition,
  left: RulesV2.ConditionOperand,
): RulesV2.LeafCondition {
  if (operandV2ValueType(left) === StateValueType.Bool) {
    return {
      family: RulesV2.LeafConditionFamily.State,
      operator: RulesV2.StateOperator.Equals,
      left,
      right: {
        kind: RulesV2.OperandKind.Literal,
        value: { type: StateValueType.Bool, value: true },
      },
      interval: leaf.interval,
    };
  }
  // Re-check the current operator's legality against the new (left, right) pair.
  const right = 'right' in leaf ? leaf.right : undefined;
  const valid = validOperatorsV2For(
    operandV2ValueType(left),
    right === undefined ? undefined : operandV2ValueType(right),
  );
  const operator: RulesV2.Operator = valid.includes(leaf.operator)
    ? leaf.operator
    : (valid[0] ?? RulesV2.ComparisonOperator.Gt);
  return rebuildLeafForFamily(leaf, left, operator, familyForOperatorV2(operator));
}

/** Build a new leaf with a different right operand (binary families only). */
function rebuildLeafForRight(
  leaf: RulesV2.LeafCondition,
  right: RulesV2.ConditionOperand,
): RulesV2.LeafCondition {
  if (
    leaf.family !== RulesV2.LeafConditionFamily.Comparison &&
    leaf.family !== RulesV2.LeafConditionFamily.Crossing &&
    leaf.family !== RulesV2.LeafConditionFamily.State
  ) {
    return leaf;
  }
  const valid = validOperatorsV2For(operandV2ValueType(leaf.left), operandV2ValueType(right));
  const operator: RulesV2.Operator = valid.includes(leaf.operator)
    ? leaf.operator
    : (valid[0] ?? RulesV2.ComparisonOperator.Gt);
  return rebuildLeafForFamily(
    { ...leaf, right },
    leaf.left,
    operator,
    familyForOperatorV2(operator),
  );
}

/** Build a new leaf with a different operator; reshape to that operator's family. */
function rebuildLeafForOperator(
  leaf: RulesV2.LeafCondition,
  operator: RulesV2.Operator,
): RulesV2.LeafCondition {
  return rebuildLeafForFamily(leaf, leaf.left, operator, familyForOperatorV2(operator));
}

/**
 * Reshape an existing leaf into the target family — carries the operands the
 * new family needs (left always; right for binary; lower/upper for Channel;
 * threshold/lookbackBars for Moving) and drops the others.
 */
function rebuildLeafForFamily(
  prev: RulesV2.LeafCondition,
  left: RulesV2.ConditionOperand,
  operator: RulesV2.Operator,
  family: RulesV2.LeafConditionFamily,
): RulesV2.LeafCondition {
  const fallbackRight: RulesV2.ConditionOperand =
    'right' in prev
      ? prev.right
      : { kind: RulesV2.OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } };
  const fallbackLower: RulesV2.ConditionOperand =
    'lower' in prev
      ? prev.lower
      : { kind: RulesV2.OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } };
  const fallbackUpper: RulesV2.ConditionOperand =
    'upper' in prev
      ? prev.upper
      : { kind: RulesV2.OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } };
  const fallbackThreshold: number = 'threshold' in prev ? prev.threshold : 0;
  const fallbackLookback: number = 'lookbackBars' in prev ? prev.lookbackBars : 1;
  const interval = prev.interval;
  switch (family) {
    case RulesV2.LeafConditionFamily.Comparison:
      return {
        family,
        operator: operator as RulesV2.ComparisonOperator,
        left,
        right: fallbackRight,
        interval,
      };
    case RulesV2.LeafConditionFamily.Crossing:
      return {
        family,
        operator: operator as RulesV2.CrossingOperator,
        left,
        right: fallbackRight,
        interval,
      };
    case RulesV2.LeafConditionFamily.Channel:
      return {
        family,
        operator: operator as RulesV2.ChannelOperator,
        left,
        lower: fallbackLower,
        upper: fallbackUpper,
        interval,
      };
    case RulesV2.LeafConditionFamily.Moving:
      return {
        family,
        operator: operator as RulesV2.MovingOperator,
        left,
        threshold: fallbackThreshold,
        lookbackBars: fallbackLookback,
        interval,
      };
    case RulesV2.LeafConditionFamily.State:
      return {
        family,
        operator: operator as RulesV2.StateOperator,
        left,
        right: fallbackRight,
        interval,
      };
  }
}

function replaceAt(
  tree: RulesV2.ConditionNode,
  path: readonly number[],
  next: RulesV2.ConditionNode,
): RulesV2.ConditionNode {
  if (path.length === 0) return next;
  if (tree.kind === RulesV2.ConditionNodeKind.Leaf) return tree;
  const [head, ...rest] = path;
  if (head === undefined) return tree;
  const children = tree.children.map((child, index) =>
    index === head ? replaceAt(child, rest, next) : child,
  );
  return { ...tree, children };
}

function removeAt(tree: RulesV2.ConditionNode, path: readonly number[]): RulesV2.ConditionNode {
  if (path.length === 0) return tree;
  if (tree.kind === RulesV2.ConditionNodeKind.Leaf) return tree;
  const [head, ...rest] = path;
  if (head === undefined) return tree;
  if (rest.length === 0) {
    return { ...tree, children: tree.children.filter((_, index) => index !== head) };
  }
  const children = tree.children.map((child, index) =>
    index === head ? removeAt(child, rest) : child,
  );
  return { ...tree, children };
}

function labelFor(node: RulesV2.ConditionNode): string {
  if (node.kind === RulesV2.ConditionNodeKind.Leaf) return 'leaf';
  return node.kind === RulesV2.ConditionNodeKind.And ? 'AND group' : 'OR group';
}

function describePath(path: readonly number[]): string {
  return path.map((index) => index + 1).join('.');
}
