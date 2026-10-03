import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { mergeAll, modNorm, parseInteger, parseModulus, CrtError, egcd } from "../src/math";
import { solve, verifyCandidate, rangeCount } from "../src/solver";
import { Store } from "../src/store";

const C = (r: string, m: string) => ({ residue: r, modulus: m });

test("互素: x≡2 mod 3, x≡3 mod 5 => x≡8 mod 15", () => {
  const r = solve([C("2", "3"), C("3", "5")]);
  assert.equal(r.solvable, true);
  assert.equal(r.residue, "8");
  assert.equal(r.modulus, "15");
});

test("非互素: x≡4 mod 6, x≡6 mod 8 => x≡22 mod 24", () => {
  const r = solve([C("4", "6"), C("6", "8")]);
  assert.equal(r.solvable, true);
  assert.equal(r.residue, "22");
  assert.equal(r.modulus, "24");
});

test("冲突: x≡1 mod 4, x≡2 mod 6 指出 gcd 与整除检查", () => {
  const r = solve([C("1", "4"), C("2", "6")]);
  assert.equal(r.solvable, false);
  const c = r.conflict as { gcd: string; diff: string; index: number };
  assert.equal(c.gcd, "2");
  assert.equal(c.diff, "1");
  assert.equal(c.index, 1);
});

test("负余数规范化", () => {
  const r = solve([C("-2", "6")]);
  assert.equal(r.residue, "4");
  assert.equal(modNorm(-2n, 6n), 4n);
});

test("大于安全整数的值", () => {
  const big = "9007199254740993"; // 2^53 + 1
  const r = solve([C(big, "100000000000000000000000000000003")]);
  assert.equal(r.residue, big);
  const v = verifyCandidate([C(big, "7")], "90071992547409931234567890123456789");
  assert.equal(typeof v.satisfied, "boolean");
});

test("模数一不增加限制；空条件表示所有整数", () => {
  const r = solve([C("0", "1"), C("5", "7")]);
  assert.equal(r.residue, "5");
  assert.equal(r.modulus, "7");
  const empty = solve([]);
  assert.equal(empty.residue, "0");
  assert.equal(empty.modulus, "1");
});

test("重复与冗余条件不改变解集", () => {
  const a = solve([C("4", "6"), C("6", "8")]);
  const b = solve([C("4", "6"), C("6", "8"), C("4", "6"), C("22", "24")]);
  assert.equal(a.residue, b.residue);
  assert.equal(a.modulus, b.modulus);
});

test("嵌套模数: x≡3 mod 4 与 x≡3 mod 8 => x≡3 mod 8", () => {
  const r = solve([C("3", "4"), C("3", "8")]);
  assert.equal(r.residue, "3");
  assert.equal(r.modulus, "8");
});

test("错误码: 零模数 / 负模数 / 非法整数 / 资源上限", () => {
  assert.throws(() => parseModulus("0", "m"), (e: CrtError) => e.code === "ZERO_MODULUS");
  assert.throws(() => parseModulus("-5", "m"), (e: CrtError) => e.code === "NEGATIVE_MODULUS");
  assert.throws(() => parseInteger("12a", "v"), (e: CrtError) => e.code === "INVALID_INTEGER");
  assert.throws(() => parseInteger("1".repeat(1001), "v"), (e: CrtError) => e.code === "LIMIT_EXCEEDED");
});

test("区间查询: 数量、首项、末项；空区间与负区间", () => {
  const cs = [C("4", "6"), C("6", "8")]; // x ≡ 22 mod 24
  const r = rangeCount(cs, "0", "100");
  assert.equal(r.first, "22");
  assert.equal(r.last, "94");
  assert.equal(r.count, "4");
  const empty = rangeCount(cs, "0", "21");
  assert.equal(empty.count, "0");
  assert.equal(empty.first, null);
  const neg = rangeCount(cs, "-50", "-1");
  assert.equal(neg.first, "-50");
  assert.equal(neg.last, "-2");
  assert.equal(neg.count, "3");
});

test("顺序调整不改变规范化结果", () => {
  const base = [C("4", "6"), C("6", "8"), C("2", "5")];
  const r1 = solve(base);
  const r2 = solve([base[2], base[0], base[1]]);
  const r3 = solve([base[1], base[2], base[0]]);
  assert.equal(r1.residue, r2.residue);
  assert.equal(r1.modulus, r2.modulus);
  assert.equal(r1.residue, r3.residue);
});

test("小模数暴力枚举交叉校对", () => {
  let s = 42;
  const rng = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const gcdB = (a: bigint, b: bigint): bigint => (b ? gcdB(b, a % b) : a);
  for (let trial = 0; trial < 200; trial++) {
    const n = 1 + Math.floor(rng() * 4);
    const cs = Array.from({ length: n }, () => {
      const m = 1 + Math.floor(rng() * 12);
      const r = Math.floor(rng() * 20) - 10; // 含负余数
      return { residue: String(r), modulus: String(m) };
    });
    const report = solve(cs);
    const norm = cs.map((c) => ({ r: modNorm(BigInt(c.residue), BigInt(c.modulus)), m: BigInt(c.modulus) }));
    const period = norm.reduce((acc, c) => (acc / gcdB(acc, c.m)) * c.m, 1n);
    const solutions: bigint[] = [];
    for (let x = 0n; x < period; x++) {
      if (norm.every((c) => modNorm(x, c.m) === c.r)) solutions.push(x);
    }
    if (solutions.length === 0) {
      assert.equal(report.solvable, false, `应为冲突: ${JSON.stringify(cs)}`);
    } else {
      assert.equal(report.solvable, true, `应可解: ${JSON.stringify(cs)}`);
      assert.equal(report.modulus, period.toString());
      assert.equal(report.residue, solutions[0].toString());
      const v = verifyCandidate(cs, report.residue!);
      assert.equal(v.satisfied, true);
    }
  }
});

test("egcd 正确性", () => {
  for (const [a, b] of [[12n, 8n], [7n, 3n], [100n, 35n], [1n, 1n]]) {
    const { g, x, y } = egcd(a, b);
    assert.equal(a * x + b * y, g);
  }
});

test("坏输入不写成功报告；重启后可复核历史", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crt-test-"));
  const dbPath = path.join(dir, "t.db");
  let store = new Store(dbPath);
  const { id } = store.createCase("demo", [C("4", "6"), C("6", "8")]);
  const v = store.getVersion(id);
  const ok = solve(v.constraints);
  store.saveReport(id, v.versionId, "solve", { version: v.version }, ok);
  assert.throws(() => solve([C("abc", "6")]), (e: CrtError) => e.code === "INVALID_INTEGER");
  store.close();
  store = new Store(dbPath); // 模拟重启
  const reports = store.listReports(id) as unknown as { kind: string; result: { residue: string } }[];
  assert.equal(reports.length, 1);
  assert.equal(reports[0].result.residue, "22");
  store.addVersion(id, [C("2", "3")]); // 编辑产生新版本
  const reports2 = store.listReports(id) as unknown as { result: { residue: string } }[];
  assert.equal(reports2[0].result.residue, "22"); // 历史报告不变
  store.deleteCase(id);
  const reports3 = store.listReports(id);
  assert.equal(reports3.length, 1); // 删除算例后历史报告保留
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
