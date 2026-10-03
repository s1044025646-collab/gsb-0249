import { describe, expect, it } from 'vitest';
import {
  enumeratePeriod,
  queryRange,
  solveCongruences,
  verifyCandidates,
} from './congruence';
import { defaultLimits } from './limits';

describe('广义中国剩余定理', () => {
  it('合并互素模数', () => {
    const result = solveCongruences(
      [
        { modulus: '3', remainder: '2' },
        { modulus: '5', remainder: '3' },
      ],
      defaultLimits,
    );
    expect(result.solvable).toBe(true);
    expect(result.solution).toEqual({ remainder: '8', modulus: '15' });
  });

  it('合并非互素模数并解释 gcd 检查', () => {
    const result = solveCongruences(
      [
        { modulus: '6', remainder: '4' },
        { modulus: '8', remainder: '6' },
      ],
      defaultLimits,
    );
    expect(result.solution).toEqual({ remainder: '22', modulus: '24' });
    expect(result.steps[1].gcd).toBe('2');
    expect(result.steps[1].dividesDifference).toBe(true);
    expect(result.steps[1].check).toContain('gcd(6, 8) = 2');
  });

  it('说明无法同时成立的条件', () => {
    const result = solveCongruences(
      [
        { modulus: '6', remainder: '4' },
        { modulus: '9', remainder: '2' },
      ],
      defaultLimits,
    );
    expect(result.solvable).toBe(false);
    expect(result.conflict).toMatchObject({ gcd: '3', difference: '-2' });
  });

  it('规范化负余数、空条件和模数一', () => {
    expect(solveCongruences([], defaultLimits).solution).toEqual({ remainder: '0', modulus: '1' });
    const result = solveCongruences(
      [
        { modulus: '1', remainder: '0' },
        { modulus: '6', remainder: '-1' },
      ],
      defaultLimits,
    );
    expect(result.normalizedConstraints[1].remainder).toBe('5');
    expect(result.solution).toEqual({ remainder: '5', modulus: '6' });
  });

  it('保持大于安全整数的十进制精度', () => {
    const huge = '9007199254740993';
    const result = solveCongruences(
      [
        { modulus: huge, remainder: '123456789012345678901' },
        { modulus: huge, remainder: '123456789012345678901' },
      ],
      defaultLimits,
    );
    expect(result.solution.remainder).not.toBe('NaN');
    expect(BigInt(result.solution.modulus)).toBe(BigInt(huge));
  });

  it('重复和嵌套模数不改变结果', () => {
    const conditions = [
      { modulus: '12', remainder: '2' },
      { modulus: '6', remainder: '2' },
      { modulus: '4', remainder: '2' },
      { modulus: '12', remainder: '2' },
    ];
    expect(solveCongruences(conditions, defaultLimits).solution).toEqual({
      remainder: '2',
      modulus: '12',
    });
  });

  it('调整条件顺序得到同一规范化结果', () => {
    const one = [
      { modulus: '8', remainder: '6' },
      { modulus: '6', remainder: '4' },
      { modulus: '5', remainder: '2' },
    ];
    const two = [...one].reverse();
    expect(solveCongruences(one, defaultLimits).solution).toEqual(
      solveCongruences(two, defaultLimits).solution,
    );
  });

  it('有界区间返回数量、首项和末项，不展开列表', () => {
    const solved = solveCongruences(
      [
        { modulus: '6', remainder: '4' },
        { modulus: '8', remainder: '6' },
      ],
      defaultLimits,
    );
    expect(queryRange(solved.solution, '0', '23')).toEqual({
      lower: '0',
      upper: '23',
      count: '1',
      first: '22',
      last: '22',
    });
    expect(queryRange(solved.solution, '0', '21').count).toBe('0');
  });

  it('在完整周期内枚举并与直接求余校对', () => {
    const conditions = [
      { modulus: '6', remainder: '4' },
      { modulus: '8', remainder: '6' },
      { modulus: '5', remainder: '2' },
    ];
    const solved = solveCongruences(conditions, defaultLimits);
    const values = enumeratePeriod(solved.solution, defaultLimits).map(BigInt);
    const expected: bigint[] = [];
    for (let value = 0n; value < BigInt(solved.solution.modulus); value += 1n) {
      if (value % 6n === 4n && value % 8n === 6n && value % 5n === 2n) expected.push(value);
    }
    expect(values).toEqual(expected);
    const verification = verifyCandidates(conditions, values.map(String), defaultLimits);
    expect(verification.allSatisfied).toBe(true);
  });

  it.each([
    [{ modulus: '0', remainder: '1' }, 'MODULUS_ZERO'],
    [{ modulus: '-3', remainder: '1' }, 'MODULUS_NEGATIVE'],
    [{ modulus: '3', remainder: '1.5' }, 'INVALID_INTEGER'],
  ])('拒绝坏输入 %#', (condition, code) => {
    try {
      solveCongruences([condition], defaultLimits);
      throw new Error('应当抛出校验错误');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(code);
    }
  });
});
