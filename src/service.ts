import { DatabaseSync } from 'node:sqlite';
import { AppError } from './errors';
import { defaultLimits, ResourceLimits } from './limits';
import { enumeratePeriod, queryRange, solveCongruences, verifyCandidates } from './congruence';
import { addVersion, createCase, saveReport } from './db';

export function resolveLimits(input: unknown): ResourceLimits {
  if (input === undefined) return defaultLimits;
  if (!input || typeof input !== 'object') return defaultLimits;
  const source = input as Partial<ResourceLimits>;
  const integer = (value: unknown, name: string, fallback: number): number => {
    if (value === undefined) return fallback;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new AppError('INVALID_ARGUMENT', `limits.${name} 必须是正整数`);
    }
    return parsed;
  };
  const bigInteger = (value: unknown, name: string, fallback: bigint): bigint => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
      throw new AppError('INVALID_ARGUMENT', `limits.${name} 必须是正整数`);
    }
    try {
      const parsed = BigInt(value);
      if (parsed <= 0n) throw new Error();
      return parsed;
    } catch {
      throw new AppError('INVALID_ARGUMENT', `limits.${name} 必须是正整数`);
    }
  };
  return {
    maxConditions: integer(source.maxConditions, 'maxConditions', defaultLimits.maxConditions),
    maxDecimalDigits: integer(
      source.maxDecimalDigits,
      'maxDecimalDigits',
      defaultLimits.maxDecimalDigits,
    ),
    maxLcmBits: integer(source.maxLcmBits, 'maxLcmBits', defaultLimits.maxLcmBits),
    maxEnumerationPeriod: bigInteger(
      source.maxEnumerationPeriod,
      'maxEnumerationPeriod',
      defaultLimits.maxEnumerationPeriod,
    ),
    maxCandidates: integer(source.maxCandidates, 'maxCandidates', defaultLimits.maxCandidates),
  };
}

export function analyzeAndReport(db: DatabaseSync, constraints: unknown, limitsInput?: unknown) {
  const limits = resolveLimits(limitsInput);
  const result = solveCongruences(constraints, limits);
  const report = saveReport(db, result.solvable ? 'solve' : 'conflict', { constraints, limits }, result);
  return { ...result, reportId: report.id };
}

export function verifyAndReport(
  db: DatabaseSync,
  constraints: unknown,
  candidates: unknown,
  limitsInput?: unknown,
) {
  const limits = resolveLimits(limitsInput);
  const result = verifyCandidates(constraints, candidates, limits);
  const report = saveReport(db, 'verify', { constraints, candidates, limits }, result);
  return { ...result, reportId: report.id };
}

export function rangeAndReport(
  db: DatabaseSync,
  constraints: unknown,
  lower: unknown,
  upper: unknown,
  limitsInput?: unknown,
) {
  const limits = resolveLimits(limitsInput);
  const solved = solveCongruences(constraints, limits);
  if (!solved.solvable) {
    const report = saveReport(db, 'conflict-range', { constraints, lower, upper, limits }, solved);
    return { solvable: false, conflict: solved.conflict, reportId: report.id };
  }
  const range = queryRange(solved.solution, lower, upper, limits);
  const report = saveReport(db, 'range', { constraints, lower, upper, limits }, range);
  return { solvable: true, solution: solved.solution, range, reportId: report.id };
}

export function enumerateAndReport(
  db: DatabaseSync,
  constraints: unknown,
  limitsInput?: unknown,
) {
  const limits = resolveLimits(limitsInput);
  const solved = solveCongruences(constraints, limits);
  if (!solved.solvable) return { solvable: false as const, values: [] as string[] };
  const values = enumeratePeriod(solved.solution, limits);
  return { solvable: true as const, solution: solved.solution, values };
}

export function importCase(
  db: DatabaseSync,
  name: unknown,
  constraints: unknown,
  limitsInput?: unknown,
) {
  const limits = resolveLimits(limitsInput);
  solveCongruences(constraints, limits);
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('INVALID_ARGUMENT:name 必须是非空字符串');
  }
  return createCase(db, name.trim(), constraints, limits);
}

export function importVersion(
  db: DatabaseSync,
  caseId: number,
  constraints: unknown,
  limitsInput?: unknown,
) {
  const limits = resolveLimits(limitsInput);
  solveCongruences(constraints, limits);
  return addVersion(db, caseId, constraints, limits);
}
