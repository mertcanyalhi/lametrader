import { type IndicatorInstance, RulesV2, StateValueType } from '@lametrader/core';
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
  LeafEditorV2,
} from './leaf-editor-v2.js';

/**
 * The recursive v2 condition-tree editor — walks a {@link RulesV2.ConditionNode}
 * and renders the group / leaf affordances:
 *
 * - Every `And` / `Or` group shows an AND ↔ OR toggle, a `+ Leaf` / `+ Group`
 *   pair, and a `Remove` IconButton next to each child (root excluded).
 * - Every leaf delegates to {@link LeafEditorV2}.
 *
 * Tree edits are immutable: every action returns a new tree to `onChange` so
 * the form holds a fresh reference.
 */
export function ConditionTreeEditorV2({
  value,
  onChange,
  indicators,
  instancePeriods,
  knownStateKeys,
}: {
  value: RulesV2.ConditionNode;
  onChange: (next: RulesV2.ConditionNode) => void;
  indicators: IndicatorInstance[];
  instancePeriods: InstancePeriods;
  knownStateKeys: KnownStateKeys;
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
    />
  );
}

/** A neutral starter leaf — `Price > Literal(0)`, overwritten by the picker. */
const PLACEHOLDER_LEAF: RulesV2.ConditionNode = {
  kind: RulesV2.ConditionNodeKind.Leaf,
  leaf: {
    family: RulesV2.LeafConditionFamily.Comparison,
    operator: RulesV2.ComparisonOperator.Gt,
    left: { kind: RulesV2.OperandKind.Price },
    right: { kind: RulesV2.OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
  },
};

/** A neutral starter group — empty so the user picks the first child. */
const EMPTY_GROUP: RulesV2.ConditionNode = {
  kind: RulesV2.ConditionNodeKind.And,
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
}: {
  path: number[];
  node: RulesV2.ConditionNode;
  root: RulesV2.ConditionNode;
  onChange: (next: RulesV2.ConditionNode) => void;
  indicators: IndicatorInstance[];
  instancePeriods: InstancePeriods;
  knownStateKeys: KnownStateKeys;
}): ReactNode {
  if (node.kind === RulesV2.ConditionNodeKind.Leaf) {
    return (
      <Card variant="surface">
        <LeafEditorV2
          value={node.leaf}
          onChange={(nextLeaf) =>
            onChange(
              replaceAt(root, path, {
                kind: RulesV2.ConditionNodeKind.Leaf,
                leaf: applyBoolShortcut(nextLeaf),
              }),
            )
          }
          indicators={indicators}
          instancePeriods={instancePeriods}
          knownStateKeys={knownStateKeys}
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
            onValueChange={(next) =>
              onChange(
                replaceAt(root, path, {
                  ...node,
                  kind:
                    next === 'and' ? RulesV2.ConditionNodeKind.And : RulesV2.ConditionNodeKind.Or,
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
function replaceAt(
  root: RulesV2.ConditionNode,
  path: number[],
  next: RulesV2.ConditionNode,
): RulesV2.ConditionNode {
  if (path.length === 0) return next;
  if (root.kind === RulesV2.ConditionNodeKind.Leaf) return root;
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
  node: Extract<
    RulesV2.ConditionNode,
    { kind: RulesV2.ConditionNodeKind.And | RulesV2.ConditionNodeKind.Or }
  >,
  child: RulesV2.ConditionNode,
): RulesV2.ConditionNode {
  return { ...node, children: [...node.children, child] };
}

/** Remove the child at `index` from an And/Or node. */
function removeChild(
  node: Extract<
    RulesV2.ConditionNode,
    { kind: RulesV2.ConditionNodeKind.And | RulesV2.ConditionNodeKind.Or }
  >,
  index: number,
): RulesV2.ConditionNode {
  return { ...node, children: node.children.filter((_, i) => i !== index) };
}
