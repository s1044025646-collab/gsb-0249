import { AppError } from './errors';
import { defaultLimits, ResourceLimits } from './limits';
import {
  ConstraintInput,
  MergeStep,
  NormalizedConstraint,
  RangeResult,
  SolveResult,
  VerificationItem,
} from './types';

const decimalPattern = /^[+-]?\d+$/;

export function parseDecimalInteger(value: unknown, fieldName = 'value'): bigint {
  if (typeof value !== 'string' || !decimalPattern.test(value)) {
    throw new AppError(
      'INVALID_INTEGER',
      `${fieldName} 必须是十进制整数字符串`,
      { received: String(value) },
    );
  }
  try {
    return BigInt(value);
  } catch {
    throw new AppError('INVALID_INTEGER', `${fieldName} 不是合法十进制整数`, { received: value });
  }
}

export function assertDecimalLength(value: unknown, fieldName: string, limits: ResourceLimits) {
  if (typeof value !== 'string' || !decimalPattern.test(value)) return;
  checkDecimalLength(value, fieldName, limits);
}

function positiveMod(value: bigint, modulus: bigint): bigint {
  const result = value % modulus;
  return result < 0n ? result + modulus : result;
}

function bitLength(value: bigint): number {
  let current = value < 0n ? -value : value;
  let bits = 0;
  while (current > 0n) {
    current >>= 1n;
    bits += 1;
  }
  return bits;
}

function checkDecimalLength(value: string, fieldName: string, limits: ResourceLimits) {
  const digits = value.replace(/[+-]/, '');
  if (digits.replace(/^0+/, '').length > limits.maxDecimalDigits) {
    throw new AppError(
      'RESOURCE_LIMIT_EXCEEDED',
      `${fieldName} 超过允许的 ${limits.maxDecimalDigits} 位十进制数字`,
    );
  }
}

export function normalizeConstraints(
  input: unknown,
  limits: ResourceLimits,
): NormalizedConstraint[] {
  if (!Array.isArray(input)) {
    throw new AppError('INVALID_CONSTRAINTS', 'constraints 必须是数组');
  }
  if (input.length > limits.maxConditions) {
    throw new AppError(
      'RESOURCE_LIMIT_EXCEEDED',
      `条件数量不能超过 ${limits.maxConditions}`,
    );
  }

  return input.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new AppError('INVALID_CONSTRAINTS', `第 ${index + 1} 个条件必须是对象`);
    }
    const constraint = item as ConstraintInput;
    checkDecimalLength(constraint.modulus ?? '', 'modulus', limits);
    checkDecimalLength(constraint.remainder ?? '', 'remainder', limits);

    const modulus = parseDecimalInteger(constraint.modulus, `constraints[${index}].modulus`);
    const originalRemainder = parseDecimalInteger(
      constraint.remainder,
      `constraints[${index}].remainder`,
    );

    if (modulus === 0n) {
      throw new AppError('MODULUS_ZERO', `第 ${index + 1} 个条件的模数不能为零`, { index });
    }
    if (modulus < 0n) {
      throw new AppError('MODULUS_NEGATIVE', `第 ${index + 1} 个条件的模数必须为正整数`, {
        index,
        modulus: constraint.modulus,
      });
    }

    return {
      index,
      label: typeof constraint.label === 'string' ? constraint.label : undefined,
      modulus: modulus.toString(),
      originalRemainder: originalRemainder.toString(),
      remainder: positiveMod(originalRemainder, modulus).toString(),
    };
  });
}

export function extendedGcd(a: bigint, b: bigint): { gcd: bigint; x: bigint; y: bigint } {
  let oldR = a;
  let r = b;
  let oldS = 1n;
  let s = 0n;
  let oldT = 0n;
  let t = 1n;

  while (r !== 0n) {
    const quotient = oldR / r;
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
    [oldT, t] = [t, oldT - quotient * t];
  }

  return { gcd: oldR, x: oldS, y: oldT };
}

function modularInverse(value: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n;
  const result = extendedGcd(value, modulus);
  if (result.gcd !== 1n) {
    throw new AppError('INVALID_ARGUMENT', '模数逆元不存在');
  }
  return positiveMod(result.x, modulus);
}

export function solveCongruences(
  constraintsInput: unknown,
  limits: ResourceLimits,
): SolveResult {
  const constraints = normalizeConstraints(constraintsInput, limits);
  const steps: MergeStep[] = [];
  let currentRemainder = 0n;
  let currentModulus = 1n;

  for (const incoming of constraints) {
    const nextRemainder = BigInt(incoming.remainder);
    const nextModulus = BigInt(incoming.modulus);
    const previousRemainder = currentRemainder;
    const previousModulus = currentModulus;
    const { gcd } = extendedGcd(currentModulus, nextModulus);
    const difference = nextRemainder - currentRemainder;
    const dividesDifference = positiveMod(difference, gcd) === 0n;
    const stepNumber = steps.length + 1;

    if (!dividesDifference) {
      const step: MergeStep = {
        step: stepNumber,
        before: { remainder: previousRemainder.toString(), modulus: previousModulus.toString() },
        incoming,
        gcd: gcd.toString(),
        difference: difference.toString(),
        dividesDifference: false,
        check: `gcd(${currentModulus}, ${nextModulus}) = ${gcd} 不能整除余数差 ${difference}，条件冲突`,
      };
      steps.push(step);
      return {
        solvable: false,
        solution: { remainder: currentRemainder.toString(), modulus: currentModulus.toString() },
        normalizedConstraints: constraints,
        steps,
        conflict: {
          conflict: true,
          step: stepNumber,
        existing: { remainder: previousRemainder.toString(), modulus: previousModulus.toString() },
          incoming,
          gcd: gcd.toString(),
          difference: difference.toString(),
          check: step.check,
        },
      };
    }

    const reducedCurrent = currentModulus / gcd;
    const reducedNext = nextModulus / gcd;
    const differenceQuotient = difference / gcd;
    const lcm = reducedCurrent * nextModulus;

    if (bitLength(lcm) > limits.maxLcmBits) {
      throw new AppError(
        'RESOURCE_LIMIT_EXCEEDED',
        `合并后的最小公倍数超过 ${limits.maxLcmBits} 位`,
      );
    }

    const multiplier =
      reducedNext === 1n
        ? 0n
        : positiveMod(differenceQuotient * modularInverse(reducedCurrent, reducedNext), reducedNext);
    currentRemainder = positiveMod(currentRemainder + currentModulus * multiplier, lcm);
    currentModulus = lcm;

    steps.push({
      step: stepNumber,
      before: {
        remainder: previousRemainder.toString(),
        modulus: previousModulus.toString(),
      },
      incoming,
      gcd: gcd.toString(),
      difference: difference.toString(),
      dividesDifference: true,
      differenceQuotient: differenceQuotient.toString(),
      lcm: lcm.toString(),
      after: { remainder: currentRemainder.toString(), modulus: currentModulus.toString() },
      check: `gcd(${previousModulus}, ${nextModulus}) = ${gcd} 整除 ${difference}，可合并为 x = ${currentRemainder} mod ${currentModulus}`,
    });
  }

  return {
    solvable: true,
    solution: { remainder: currentRemainder.toString(), modulus: currentModulus.toString() },
    normalizedConstraints: constraints,
    steps,
    conflict: null,
  };
}

export function verifyCandidates(
  constraintsInput: unknown,
  candidatesInput: unknown,
  limits: ResourceLimits,
): { allSatisfied: boolean; items: VerificationItem[] } {
  if (!Array.isArray(candidatesInput)) {
    throw new AppError('INVALID_ARGUMENT', 'candidates 必须是十进制整数字符串数组');
  }
  if (candidatesInput.length > limits.maxCandidates) {
    throw new AppError('RESOURCE_LIMIT_EXCEEDED', `候选数量不能超过 ${limits.maxCandidates}`);
  }
  const constraints = normalizeConstraints(constraintsInput, limits);
  const candidates = candidatesInput.map((value, index) => {
    assertDecimalLength(value, `candidates[${index}]`, limits);
    return parseDecimalInteger(value, `candidates[${index}]`);
  });
  const items: VerificationItem[] = [];

  for (const candidate of candidates) {
    for (const constraint of constraints) {
      const modulus = BigInt(constraint.modulus);
      const expected = BigInt(constraint.remainder);
      const actual = positiveMod(candidate, modulus);
      items.push({
        index: constraint.index,
        label: constraint.label,
        candidate: candidate.toString(),
        modulus: constraint.modulus,
        expectedRemainder: expected.toString(),
        actualRemainder: actual.toString(),
        satisfied: actual === expected,
      });
    }
  }

  return { allSatisfied: items.every((item) => item.satisfied), items };
}

function floorDiv(value: bigint, divisor: bigint): bigint {
  if (value >= 0n) return value / divisor;
  return -((-value + divisor - 1n) / divisor);
}

function ceilDiv(value: bigint, divisor: bigint): bigint {
  return -floorDiv(-value, divisor);
}

export function queryRange(
  solution: { remainder: string; modulus: string },
  lowerInput: unknown,
  upperInput: unknown,
  limits: ResourceLimits = defaultLimits,
): RangeResult {
  const remainder = parseDecimalInteger(solution.remainder, 'solution.remainder');
  const modulus = parseDecimalInteger(solution.modulus, 'solution.modulus');
  if (modulus <= 0n) throw new AppError('INVALID_ARGUMENT', 'solution.modulus 必须为正整数');
  const normalizedRemainder = positiveMod(remainder, modulus);
  assertDecimalLength(lowerInput, 'lower', limits);
  assertDecimalLength(upperInput, 'upper', limits);
  const lower = parseDecimalInteger(lowerInput, 'lower');
  const upper = parseDecimalInteger(upperInput, 'upper');
  if (lower > upper) throw new AppError('INVALID_RANGE', 'lower 不能大于 upper');

  const lowestIndex = ceilDiv(lower - normalizedRemainder, modulus);
  const highestIndex = floorDiv(upper - normalizedRemainder, modulus);
  if (lowestIndex > highestIndex) {
    return { lower: lower.toString(), upper: upper.toString(), count: '0', first: null, last: null };
  }

  return {
    lower: lower.toString(),
    upper: upper.toString(),
    count: (highestIndex - lowestIndex + 1n).toString(),
    first: (normalizedRemainder + modulus * lowestIndex).toString(),
    last: (normalizedRemainder + modulus * highestIndex).toString(),
  };
}

export function enumeratePeriod(
  solution: { remainder: string; modulus: string },
  limits: ResourceLimits,
): string[] {
  const modulus = BigInt(solution.modulus);
  const remainder = BigInt(solution.remainder);
  if (modulus > limits.maxEnumerationPeriod) {
    throw new AppError('RESOURCE_LIMIT_EXCEEDED', '公共周期过大，不能直接枚举');
  }
  const values: string[] = [];
  for (let value = positiveMod(remainder, modulus); value < modulus; value += modulus) {
    values.push(value.toString());
  }
  return values;
}
