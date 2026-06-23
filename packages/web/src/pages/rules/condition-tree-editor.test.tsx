// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  type ConditionNode,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  StateValueType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConditionTreeEditor } from './condition-tree-editor';

const LEAF: ConditionNode = {
  kind: ConditionNodeKind.Leaf,
  left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
  operator: NumericOperator.Gt,
  right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
};

const EMPTY_AND: ConditionNode = { kind: ConditionNodeKind.And, children: [] };

/** Mount the editor with an internal state harness so we can observe edits. */
function Harness({ initial }: { initial: ConditionNode }): ReactNode {
  const [tree, setTree] = useState<ConditionNode>(initial);
  return (
    <Theme>
      <div data-testid="snapshot">{JSON.stringify(tree)}</div>
      <ConditionTreeEditor value={tree} onChange={setTree} indicators={[]} />
    </Theme>
  );
}

function snapshot(): ConditionNode {
  return JSON.parse(screen.getByTestId('snapshot').textContent ?? 'null');
}

describe('ConditionTreeEditor', () => {
  afterEach(() => {
    cleanup();
  });

  it('appends a leaf to the root group when "+ Leaf" is clicked', async () => {
    render(<Harness initial={EMPTY_AND} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Leaf' }));

    expect(snapshot()).toEqual({
      kind: ConditionNodeKind.And,
      children: [LEAF],
    });
  });

  it('appends a nested empty group when "+ Group" is clicked', async () => {
    render(<Harness initial={EMPTY_AND} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Group' }));

    expect(snapshot()).toEqual({
      kind: ConditionNodeKind.And,
      children: [{ kind: ConditionNodeKind.And, children: [] }],
    });
  });

  it('flips the root group from AND to OR via the segmented control', async () => {
    render(<Harness initial={{ kind: ConditionNodeKind.And, children: [LEAF] }} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('radio', { name: 'OR' }));

    expect(snapshot()).toEqual({
      kind: ConditionNodeKind.Or,
      children: [LEAF],
    });
  });

  it('removes a nested child via the Remove button', async () => {
    const initial: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [
        LEAF,
        {
          kind: ConditionNodeKind.Or,
          children: [LEAF],
        },
      ],
    };
    render(<Harness initial={initial} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Remove OR group at 2' }));

    expect(snapshot()).toEqual({
      kind: ConditionNodeKind.And,
      children: [LEAF],
    });
  });

  it('supports nesting and editing a leaf via the deeper "+ Leaf" button', async () => {
    const initial: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [{ kind: ConditionNodeKind.Or, children: [] }],
    };
    render(<Harness initial={initial} />);
    const user = userEvent.setup();

    const innerLeafButton = screen.getAllByRole('button', { name: 'Leaf' })[1];
    if (!innerLeafButton) throw new Error('inner Leaf button not found');
    await user.click(innerLeafButton);

    expect(snapshot()).toEqual({
      kind: ConditionNodeKind.And,
      children: [{ kind: ConditionNodeKind.Or, children: [LEAF] }],
    });
  });

  it('shows an inline "needs at least one child" hint when a group has no children', () => {
    render(<Harness initial={EMPTY_AND} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This group needs at least one child.');
  });
});
