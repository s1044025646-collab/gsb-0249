// 纯 BigInt 整数运算：扩展欧几里得、规范化、同余合并（广义中国剩余定理）。

export class CrtError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "CrtError";
  }
}

export const MAX_DIGITS = 1000; // 十进制字符串最大长度（资源上限）
export const MAX_CONSTRAINTS = 1000; // 单次条件数量上限

/** 严格解析十进制整数字符串，允许前导 +/-。 */
export function parseInteger(input: unknown, field: string): bigint {
  if (typeof input !== "string") {
    throw new CrtError("INVALID_INTEGER", `${field} 必须是十进制整数字符串`);
  }
  const s = input.trim();
  if (!/^[+-]?\d+$/.test(s)) {
    throw new CrtError("INVALID_INTEGER", `${field} 不是合法的十进制整数: "${input}"`);
  }
  if (s.replace(/^[+-]/, "").length > MAX_DIGITS) {
    throw new CrtError("LIMIT_EXCEEDED", `${field} 超过最大长度 ${MAX_DIGITS} 位`);
  }
  return BigInt(s);
}

/** 校验模数：必须是正整数字符串。 */
export function parseModulus(input: unknown, field: string): bigint {
  if (typeof input === "string" && /^-\d+$/.test(input.trim())) {
    throw new CrtError("NEGATIVE_MODULUS", `${field} 模数不能为负: "${input}"`);
  }
  const m = parseInteger(input, field);
  if (m === 0n) {
    throw new CrtError("ZERO_MODULUS", `${field} 模数不能为零`);
  }
  if (m < 0n) {
    throw new CrtError("NEGATIVE_MODULUS", `${field} 模数不能为负`);
  }
  return m;
}

/** 数学意义上的取模，结果恒在 [0, m)。 */
export function modNorm(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

export function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

export function lcm(a: bigint, b: bigint): bigint {
  return (a / gcd(a, b)) * b;
}

/** 扩展欧几里得：返回 { g, x, y } 使 a*x + b*y = g = gcd(a,b)，g >= 0。 */
export function egcd(a: bigint, b: bigint): { g: bigint; x: bigint; y: bigint } {
  let oldR = a, r = b;
  let oldS = 1n, s = 0n;
  let oldT = 0n, t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  if (oldR < 0n) {
    oldR = -oldR; oldS = -oldS; oldT = -oldT;
  }
  return { g: oldR, x: oldS, y: oldT };
}

/** a 在模 m 下的逆元（要求 gcd(a,m)=1，m>1）。 */
export function modInverse(a: bigint, m: bigint): bigint {
  const { g, x } = egcd(modNorm(a, m), m);
  if (g !== 1n) {
    throw new CrtError("NO_INVERSE", `${a} 在模 ${m} 下不存在逆元`);
  }
  return modNorm(x, m);
}

export interface MergeStep {
  index: number;            // 本次合并使用的条件序号（从 0 开始）
  residue: string;          // 该条件规范化后的余数
  modulus: string;          // 该条件的模数
  prevResidue: string;      // 已有结果的余数
  prevModulus: string;      // 已有结果的模数
  gcd: string;              // gcd(prevModulus, modulus)
  diff: string;             // residue - prevResidue
  divisible: boolean;       // gcd 是否整除 diff
  resultResidue?: string;   // 合并成功后的最小非负余数
  resultModulus?: string;   // 合并成功后的新模数（最小公倍数）
}

export interface MergeOk {
  ok: true;
  residue: bigint;
  modulus: bigint;
  steps: MergeStep[];
}

export interface MergeConflict {
  ok: false;
  steps: MergeStep[];
  conflict: {
    index: number;          // 发生冲突的条件序号
    residue: string;
    modulus: string;
    prevResidue: string;
    prevModulus: string;
    gcd: string;
    diff: string;
    reason: string;
  };
}

/**
 * 合并 x ≡ r1 (mod m1) 与 x ≡ r2 (mod m2)。
 * 成功返回最小非负余数与 lcm 模数；失败返回 null（由调用方组装冲突说明）。
 */
export function mergePair(
  r1: bigint, m1: bigint, r2: bigint, m2: bigint
): { residue: bigint; modulus: bigint } | null {
  const g = gcd(m1, m2);
  const diff = r2 - r1;
  if (diff % g !== 0n) return null;
  const m1p = m1 / g;
  const m2p = m2 / g;
  // t ≡ (diff/g) * (m1p)^-1 (mod m2p)
  const t = m2p === 1n ? 0n : modNorm((diff / g) * modInverse(m1p, m2p), m2p);
  const modulus = m1p * m2p * g; // = lcm(m1, m2)
  return { residue: modNorm(r1 + m1 * t, modulus), modulus };
}

export interface Constraint {
  residue: bigint; // 已规范化
  modulus: bigint;
}

/** 逐条合并全部条件；空条件表示全体整数（x ≡ 0 mod 1）。 */
export function mergeAll(constraints: Constraint[]): MergeOk | MergeConflict {
  const steps: MergeStep[] = [];
  let r = 0n;
  let m = 1n;
  for (let i = 0; i < constraints.length; i++) {
    const { residue, modulus } = constraints[i];
    const g = gcd(m, modulus);
    const diff = residue - r;
    const divisible = diff % g === 0n;
    const step: MergeStep = {
      index: i,
      residue: residue.toString(),
      modulus: modulus.toString(),
      prevResidue: r.toString(),
      prevModulus: m.toString(),
      gcd: g.toString(),
      diff: diff.toString(),
      divisible,
    };
    if (!divisible) {
      steps.push(step);
      return {
        ok: false,
        steps,
        conflict: {
          index: i,
          residue: residue.toString(),
          modulus: modulus.toString(),
          prevResidue: r.toString(),
          prevModulus: m.toString(),
          gcd: g.toString(),
          diff: diff.toString(),
          reason: `余数之差 ${diff} 不能被 gcd(${m}, ${modulus}) = ${g} 整除`,
        },
      };
    }
    const merged = mergePair(r, m, residue, modulus)!;
    r = merged.residue;
    m = merged.modulus;
    step.resultResidue = r.toString();
    step.resultModulus = m.toString();
    steps.push(step);
  }
  return { ok: true, residue: r, modulus: m, steps };
}

/** 闭区间 [lo, hi] 内 x ≡ r (mod m) 的解数量、首项、末项。 */
export function rangeQuery(
  r: bigint, m: bigint, lo: bigint, hi: bigint
): { count: bigint; first: bigint | null; last: bigint | null } {
  if (lo > hi) return { count: 0n, first: null, last: null };
  // first >= lo: r + m*ceil((lo-r)/m)
  const ceilDiv = (a: bigint, b: bigint) => {
    const q = a / b;
    return a % b === 0n ? q : q + (a > 0n ? 1n : 0n);
  };
  const floorDiv = (a: bigint, b: bigint) => {
    const q = a / b;
    return a % b === 0n ? q : q - (a < 0n ? 1n : 0n);
  };
  const kFirst = ceilDiv(lo - r, m);
  const kLast = floorDiv(hi - r, m);
  if (kFirst > kLast) return { count: 0n, first: null, last: null };
  return {
    count: kLast - kFirst + 1n,
    first: r + m * kFirst,
    last: r + m * kLast,
  };
}
