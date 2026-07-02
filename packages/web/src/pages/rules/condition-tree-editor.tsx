import {
  type Action,
  ComparisonOperator,
  type ConditionNode,
  ConditionNodeKind,
  type IndicatorInstance,
  LeafConditionFamily,
  OperandKind,
  StateValueType,
} from '@lametrader/core';
import {
  Box,
  Button,
  Card,
  Flex,
  IconButton,
  SegmentedControl,
  Text,
  Tooltip,
} from '@radix-ui/themes';
import { Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  applyBoolShortcut,
  type InstancePeriods,
  type KnownStateKeys,
  LeafEditor,
} from './leaf-editor.js';
import type { IndicatorStateKeysByKey } from './operand-picker.js';

/**
 * The recursive condition-tree editor — walks a {@link ConditionNode}
 * and renders the group / leaf affordances:
 *
 * - Every `And` / `Or` group shows an AND ↔ OR toggle, a `+ Leaf` / `+ Group`
 *   pair, and a `Remove` IconButton next to each child (root excluded).
 * - Every leaf delegates to {@link LeafEditor}.
 *
 * Tree edits are immutable: every action returns a new tree to `onChange` so
 * the form holds a fresh reference.
 */
export function ConditionTreeEditor({
  value,
  onChange,
  indicators,
  instancePeriods,
  knownStateKeys,
  stateKeysLoading,
  indicatorStateKeysByKey,
  priorActions = [],
}: {
  value: ConditionNode;
  onChange: (next: ConditionNode) => void;
  indicators: IndicatorInstance[];
  instancePeriods: InstancePeriods;
  knownStateKeys: KnownStateKeys;
  /** Whether the state-key catalogs are still loading — shown in the pickers. */
  stateKeysLoading?: boolean;
  /**
   * Per-indicator-definition state-key catalog — feeds the `IndicatorRef`
   * operand's state-key combobox. Threaded straight through to every
   * `<OperandPicker>` a leaf renders.
   */
  indicatorStateKeysByKey?: IndicatorStateKeysByKey;
  /**
   * Actions declared on the same rule — fed into each leaf so the RHS literal
   * input can infer its type from a matching `SetState` action's `value.type`
   * when the LHS is a state ref paired with `Equals` (issue #428 item 8).
   */
  priorActions?: Action[];
}): ReactNode {
  return (
    <NodeView
      path={[]}
      node={value}
      root={value}
      onChange={onChange}
      indicators={indicators}
      instancePeriods={instancePeriods}
      knownStateKeys={knownStateKeys}
      stateKeysLoading={stateKeysLoading}
      indicatorStateKeysByKey={indicatorStateKeysByKey}
      priorActions={priorActions}
    />
  );
}

/** A neutral starter leaf — `Price > Literal(0)`, overwritten by the picker. */
const PLACEHOLDER_LEAF: ConditionNode = {
  kind: ConditionNodeKind.Leaf,
  leaf: {
    family: LeafConditionFamily.Comparison,
    operator: ComparisonOperator.Gt,
    left: { kind: OperandKind.Price },
    right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
  },
};

/** A neutral starter group — empty so the user picks the first child. */
const EMPTY_GROUP: ConditionNode = {
  kind: ConditionNodeKind.And,
  children: [],
};

function NodeView({
  path,
  node,
  root,
  onChange,
  indicators,
  instancePeriods,
  knownStateKeys,
  stateKeysLoading,
  indicatorStateKeysByKey,
  priorActions,
}: {
  path: number[];
  node: ConditionNode;
  root: ConditionNode;
  onChange: (next: ConditionNode) => void;
  indicators: IndicatorInstance[];
  instancePeriods: InstancePeriods;
  knownStateKeys: KnownStateKeys;
  stateKeysLoading: boolean | undefined;
  indicatorStateKeysByKey: IndicatorStateKeysByKey | undefined;
  priorActions: Action[];
}): ReactNode {
  if (node.kind === ConditionNodeKind.Leaf) {
    return (
      <Card variant="surface">
        <LeafEditor
          value={node.leaf}
          onChange={(nextLeaf) =>
            onChange(
              replaceAt(root, path, {
                kind: ConditionNodeKind.Leaf,
                leaf: applyBoolShortcut(nextLeaf),
              }),
            )
          }
          indicators={indicators}
          instancePeriods={instancePeriods}
          knownStateKeys={knownStateKeys}
          stateKeysLoading={stateKeysLoading}
          indicatorStateKeysByKey={indicatorStateKeysByKey}
          priorActions={priorActions}
        />
      </Card>
    );
  }
  const isRoot = path.length === 0;
  const isAnd = node.kind === ConditionNodeKind.And;
  return (
    <Card variant="surface">
      <Flex direction="column" gap="2">
        <Flex gap="2" align="center" justify="between">
          <SegmentedControl.Root
            value={isAnd ? 'and' : 'or'}
            onValueChange={(next) =>
              onChange(
                replaceAt(root, path, {
                  ...node,
                  kind: next === 'and' ? ConditionNodeKind.And : ConditionNodeKind.Or,
                }),
              )
            }
          >
            <SegmentedControl.Item value="and">AND</SegmentedControl.Item>
            <SegmentedControl.Item value="or">OR</SegmentedControl.Item>
          </SegmentedControl.Root>
          <Flex gap="2">
            <Button
              type="button"
              variant="soft"
              color="gray"
              onClick={() => onChange(replaceAt(root, path, addChild(node, PLACEHOLDER_LEAF)))}
            >
              <Plus size={14} aria-hidden="true" /> Leaf
            </Button>
            <Button
              type="button"
              variant="soft"
              color="gray"
              onClick={() => onChange(replaceAt(root, path, addChild(node, EMPTY_GROUP)))}
            >
              <Plus size={14} aria-hidden="true" /> Group
            </Button>
          </Flex>
        </Flex>
        {node.children.length === 0 ? (
          <Text size="2" color="gray">
            Empty group — add a leaf or a nested group.
          </Text>
        ) : (
          <Flex direction="column" gap="2">
            {node.children.map((child, index) => (
              <Flex
                // biome-ignore lint/suspicious/noArrayIndexKey: children have no stable id.
                key={index}
                gap="2"
                align="start"
              >
                <Box flexGrow="1">
                  <NodeView
                    path={[...path, index]}
                    node={child}
                    root={root}
                    onChange={onChange}
                    indicators={indicators}
                    instancePeriods={instancePeriods}
                    knownStateKeys={knownStateKeys}
                    stateKeysLoading={stateKeysLoading}
                    indicatorStateKeysByKey={indicatorStateKeysByKey}
                    priorActions={priorActions}
                  />
                </Box>
                {isRoot && node.children.length === 1 ? null : (
                  <Tooltip content="Remove">
                    <IconButton
                      type="button"
                      variant="soft"
                      color="gray"
                      aria-label="Remove child"
                      onClick={() => onChange(replaceAt(root, path, removeChild(node, index)))}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </IconButton>
                  </Tooltip>
                )}
              </Flex>
            ))}
          </Flex>
        )}
      </Flex>
    </Card>
  );
}

/**
 * Replace the node at `path` inside `root` with `next`. Path indexes through
 * each successive `children` array; an empty path is the root itself.
 */
function replaceAt(root: ConditionNode, path: number[], next: ConditionNode): ConditionNode {
  if (path.length === 0) return next;
  if (root.kind === ConditionNodeKind.Leaf) return root;
  const [head, ...rest] = path;
  if (head === undefined) return root;
  return {
    ...root,
    children: root.children.map((child, index) =>
      index === head ? replaceAt(child, rest, next) : child,
    ),
  };
}

/** Append a child to an And/Or node. */
function addChild(
  node: Extract<ConditionNode, { kind: ConditionNodeKind.And | ConditionNodeKind.Or }>,
  child: ConditionNode,
): ConditionNode {
  return { ...node, children: [...node.children, child] };
}

/** Remove the child at `index` from an And/Or node. */
function removeChild(
  node: Extract<ConditionNode, { kind: ConditionNodeKind.And | ConditionNodeKind.Or }>,
  index: number,
): ConditionNode {
  return { ...node, children: node.children.filter((_, i) => i !== index) };
}
