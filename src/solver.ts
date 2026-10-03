// 求解服务：输入校验、合并、候选核验、区间查询。
import {
  CrtError, Constraint, MAX_CONSTRAINTS,
  mergeAll, modNorm, parseInteger, parseModulus, rangeQuery,
} from "./math";

export interface RawConstraint {
  residue: unknown;
  modulus: unknown;
}

export function normalizeConstraints(raw: unknown): Constraint[] {
  if (!Array.isArray(raw)) {
    throw new CrtError("VALIDATION", "constraints 必须是数组");
  }
  if (raw.length > MAX_CONSTRAINTS) {
    throw new CrtError("LIMIT_EXCEEDED", `条件数量超过上限 ${MAX_CONSTRAINTS}`);
  }
  return raw.map((c, i) => {
    if (typeof c !== "object" || c === null) {
      throw new CrtError("VALIDATION", `第 ${i} 条条件必须是对象 {residue, modulus}`);
    }
    const { residue, modulus } = c as RawConstraint;
    const m = parseModulus(modulus, `constraints[${i}].modulus`);
    const r = modNorm(parseInteger(residue, `constraints[${i}].residue`), m);
    return { residue: r, modulus: m };
  });
}

export interface SolveReport {
  solvable: boolean;
  residue?: string;
  modulus?: string;
  steps: unknown[];
  conflict?: unknown;
}

export function solve(rawConstraints: unknown): SolveReport {
  const constraints = normalizeConstraints(rawConstraints);
  const result = mergeAll(constraints);
  if (result.ok) {
    return {
      solvable: true,
      residue: result.residue.toString(),
      modulus: result.modulus.toString(),
      steps: result.steps,
    };
  }
  return { solvable: false, steps: result.steps, conflict: result.conflict };
}

export interface VerifyItem {
  index: number;
  residue: string;
  modulus: string;
  remainder: string;
  satisfied: boolean;
}

export function verifyCandidate(rawConstraints: unknown, rawValue: unknown) {
  const constraints = normalizeConstraints(rawConstraints);
  const value = parseInteger(rawValue, "value");
  const items: VerifyItem[] = constraints.map((c, i) => {
    const rem = modNorm(value, c.modulus);
    return {
      index: i,
      residue: c.residue.toString(),
      modulus: c.modulus.toString(),
      remainder: rem.toString(),
      satisfied: rem === c.residue,
    };
  });
  return { value: value.toString(), satisfied: items.every((it) => it.satisfied), items };
}

export function rangeCount(rawConstraints: unknown, rawLo: unknown, rawHi: unknown) {
  const report = solve(rawConstraints);
  const lo = parseInteger(rawLo, "lo");
  const hi = parseInteger(rawHi, "hi");
  if (lo > hi) {
    throw new CrtError("VALIDATION", "区间下界不能大于上界");
  }
  if (!report.solvable) {
    return { solvable: false, lo: lo.toString(), hi: hi.toString(), conflict: report.conflict };
  }
  const q = rangeQuery(BigInt(report.residue!), BigInt(report.modulus!), lo, hi);
  return {
    solvable: true,
    lo: lo.toString(),
    hi: hi.toString(),
    residue: report.residue,
    modulus: report.modulus,
    count: q.count.toString(),
    first: q.first === null ? null : q.first.toString(),
    last: q.last === null ? null : q.last.toString(),
  };
}
