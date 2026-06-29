import { describe, expect, it } from 'vitest';

import {
  ChannelOperator,
  ComparisonOperator,
  CrossingOperator,
  MovingOperator,
  StateOperator,
} from './operator.types.js';

describe('Operator', () => {
  it('exposes six Comparison members', () => {
    expect(Object.values(ComparisonOperator)).toEqual(['gt', 'lt', 'gte', 'lte', 'eq', 'neq']);
  });

  it('exposes three Crossing members', () => {
    expect(Object.values(CrossingOperator)).toEqual(['crossing', 'crossingUp', 'crossingDown']);
  });

  it('exposes three Channel members', () => {
    expect(Object.values(ChannelOperator)).toEqual([
      'enteringChannel',
      'exitingChannel',
      'insideChannel',
    ]);
  });

  it('exposes four Moving members', () => {
    expect(Object.values(MovingOperator)).toEqual([
      'movingUp',
      'movingDown',
      'movingUpPercent',
      'movingDownPercent',
    ]);
  });

  it('exposes four State members', () => {
    expect(Object.values(StateOperator)).toEqual([
      'equals',
      'notEquals',
      'changesTo',
      'changesFrom',
    ]);
  });
});
