import {
  type ConditionNode,
  ConditionNodeKind,
  NumericOperator,
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

/**
 * The recursive condition-tree editor — walks a {@link ConditionNode} and
 * renders the group / leaf affordances:
 *
 * - Every `And` / `Or` group shows an AND ↔ OR toggle, a "+ Leaf" / "+ Group"
 *   pair, and a Remove button next to each child.
 * - Every leaf is a placeholder card — the operand and operator pickers land
 *   in #170 and #171; they'll replace the placeholder via the same path-based
 *   mutate helpers.
 *
 * Tree edits are immutable: every action returns a new tree to `onChange` so
 * the form holds a fresh reference.
 *
 * @param value    - The current tree.
 * @param onChange - Receives the next tree after any edit.
 */
export function ConditionTreeEditor({
  value,
  onChange,
}: {
  value: ConditionNode;
  onChange: (next: ConditionNode) => void;
}): ReactNode {
  return <NodeView path={[]} node={value} root={value} onChange={onChange} />;
}

/** A neutral starter leaf — overwritten by the operand/operator picker (#170–#171). */
const PLACEHOLDER_LEAF: ConditionNode = {
  kind: ConditionNodeKind.Leaf,
  left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
  operator: NumericOperator.Gt,
  right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
};

/** A neutral starter group — empty so the user picks the first child themselves. */
const EMPTY_GROUP: ConditionNode = { kind: ConditionNodeKind.And, children: [] };

function NodeView({
  path,
  node,
  root,
  onChange,
}: {
  path: number[];
  node: ConditionNode;
  root: ConditionNode;
  onChange: (next: ConditionNode) => void;
}): ReactNode {
  if (node.kind === ConditionNodeKind.Leaf) {
    return (
      <Card variant="surface">
        <Text size="2" color="gray">
          {/* Lazy: operand / operator picker lands with #170–#171; the
              persisted leaf shape is intact so saves still round-trip. */}
          Leaf — operand &amp; operator picker lands in #170–#171.
        </Text>
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
            onValueChange={(next) => {
              const replaced: ConditionNode = {
                kind: next === 'and' ? ConditionNodeKind.And : ConditionNodeKind.Or,
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
                    children: [...node.children, PLACEHOLDER_LEAF],
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
                    children: [...node.children, EMPTY_GROUP],
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
          // biome-ignore lint/suspicious/noArrayIndexKey: condition children are positional; no stable id available.
          <Flex key={index} gap="2" align="start">
            <Box flexGrow="1">
              <NodeView path={[...path, index]} node={child} root={root} onChange={onChange} />
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
 * Return a new tree with the subtree at `path` replaced by `next`. Empty path
 * replaces the root.
 */
function replaceAt(
  tree: ConditionNode,
  path: readonly number[],
  next: ConditionNode,
): ConditionNode {
  if (path.length === 0) return next;
  if (tree.kind === ConditionNodeKind.Leaf) return tree;
  const [head, ...rest] = path;
  if (head === undefined) return tree;
  const children = tree.children.map((child, index) =>
    index === head ? replaceAt(child, rest, next) : child,
  );
  return { ...tree, children };
}

/**
 * Return a new tree with the node at `path` removed from its parent's
 * children. No-op for an empty path (root cannot remove itself).
 */
function removeAt(tree: ConditionNode, path: readonly number[]): ConditionNode {
  if (path.length === 0) return tree;
  if (tree.kind === ConditionNodeKind.Leaf) return tree;
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

/** A short, screen-reader-friendly label for a node (used in aria-label text). */
function labelFor(node: ConditionNode): string {
  if (node.kind === ConditionNodeKind.Leaf) return 'leaf';
  return node.kind === ConditionNodeKind.And ? 'AND group' : 'OR group';
}

/** A 1-based dotted path ("1.2.1") for the aria-label so each Remove is unique. */
function describePath(path: readonly number[]): string {
  return path.map((index) => index + 1).join('.');
}
