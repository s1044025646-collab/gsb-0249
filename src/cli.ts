// 命令行入口：serve / solve / verify / range / case 管理 / import / export / demo。
import * as fs from "node:fs";
import { Store } from "./store";
import { startServer } from "./api";
import { solve, verifyCandidate, rangeCount } from "./solver";
import { CrtError } from "./math";

function print(x: unknown) {
  console.log(JSON.stringify(x, null, 2));
}

function readJsonArg(arg: string): unknown {
  // 支持内联 JSON 或 @文件路径
  if (arg.startsWith("@")) {
    return JSON.parse(fs.readFileSync(arg.slice(1), "utf8"));
  }
  return JSON.parse(arg);
}

const USAGE = `用法: node dist/src/cli.js <命令> [参数]
  serve [--port N]                        启动 HTTP 服务（默认自动选择空闲端口）
  solve '<constraints-json>'              直接合并条件
  verify '<constraints-json>' <value>     核验候选整数
  range '<constraints-json>' <lo> <hi>    闭区间解计数
  create <name> '<constraints-json>'      新建算例
  list                                    列出算例
  show <caseId>                           查看算例最新版本
  update <caseId> '<constraints-json>'    编辑算例（产生新版本）
  versions <caseId>                       列出版本
  solve-case <caseId> [version]           求解并保存报告
  verify-case <caseId> <value>            核验并保存报告
  range-case <caseId> <lo> <hi>           区间查询并保存报告
  reports <caseId>                        列出历史报告
  export <caseId>                         导出算例 JSON
  import <file>                           导入算例 JSON
  delete <caseId>                         删除算例（历史报告保留）
  demo                                    运行内置演示
constraints-json 形如: '[{"residue":"4","modulus":"6"}]'，也可用 @文件.json
`;

function runDemo() {
  const show = (title: string, constraints: unknown) => {
    console.log(`\n=== ${title} ===`);
    console.log("条件:", JSON.stringify(constraints));
    const r = solve(constraints);
    if (r.solvable) {
      console.log(`可解: x ≡ ${r.residue} (mod ${r.modulus})`);
    } else {
      console.log("冲突:", JSON.stringify(r.conflict, null, 2));
    }
    console.log("步骤:", JSON.stringify(r.steps, null, 2));
    return r;
  };

  show("互素示例: x≡2 (mod 3), x≡3 (mod 5)", [
    { residue: "2", modulus: "3" },
    { residue: "3", modulus: "5" },
  ]);
  show("非互素示例: x≡4 (mod 6), x≡6 (mod 8)", [
    { residue: "4", modulus: "6" },
    { residue: "6", modulus: "8" },
  ]);
  show("不可同时成立: x≡1 (mod 4), x≡2 (mod 6)", [
    { residue: "1", modulus: "4" },
    { residue: "2", modulus: "6" },
  ]);
  const v = verifyCandidate(
    [{ residue: "4", modulus: "6" }, { residue: "6", modulus: "8" }], "22");
  console.log("\n核验 x=22:", JSON.stringify(v, null, 2));
  const rg = rangeCount(
    [{ residue: "4", modulus: "6" }, { residue: "6", modulus: "8" }], "0", "100");
  console.log("\n区间 [0,100]:", JSON.stringify(rg, null, 2));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const store = new Store();
  try {
    switch (cmd) {
      case "serve": {
        const pIdx = args.indexOf("--port");
        const port = pIdx >= 0 ? Number(args[pIdx + 1]) : Number(process.env.PORT ?? 0);
        const { port: actual } = await startServer(store, port);
        console.log(`服务已启动: http://127.0.0.1:${actual}`);
        return; // 保持进程
      }
      case "solve": return print(solve(readJsonArg(args[0])));
      case "verify": return print(verifyCandidate(readJsonArg(args[0]), args[1]));
      case "range": return print(rangeCount(readJsonArg(args[0]), args[1], args[2]));
      case "create": return print(store.createCase(args[0], readJsonArg(args[1])));
      case "list": return print(store.listCases());
      case "show": {
        const id = Number(args[0]);
        return print({ ...store.getCase(id), ...store.getVersion(id) });
      }
      case "update": return print({ version: store.addVersion(Number(args[0]), readJsonArg(args[1])) });
      case "versions": return print(store.listVersions(Number(args[0])));
      case "solve-case": {
        const id = Number(args[0]);
        const v = store.getVersion(id, args[1] === undefined ? undefined : Number(args[1]));
        const result = solve(v.constraints);
        const reportId = store.saveReport(id, v.versionId, "solve", { version: v.version }, result);
        return print({ reportId, version: v.version, ...result });
      }
      case "verify-case": {
        const id = Number(args[0]);
        const v = store.getVersion(id);
        const result = verifyCandidate(v.constraints, args[1]);
        const reportId = store.saveReport(id, v.versionId, "verify",
          { version: v.version, value: args[1] }, result);
        return print({ reportId, version: v.version, ...result });
      }
      case "range-case": {
        const id = Number(args[0]);
        const v = store.getVersion(id);
        const result = rangeCount(v.constraints, args[1], args[2]);
        const reportId = store.saveReport(id, v.versionId, "range",
          { version: v.version, lo: args[1], hi: args[2] }, result);
        return print({ reportId, version: v.version, ...result });
      }
      case "reports": return print(store.listReports(Number(args[0])));
      case "export": {
        const id = Number(args[0]);
        const c = store.getCase(id);
        const versions = (store.listVersions(id) as unknown as { constraints_json: string }[])
          .map((v) => ({ ...v, constraints: JSON.parse(v.constraints_json), constraints_json: undefined }));
        return print({ name: c.name, versions });
      }
      case "import": {
        const data = JSON.parse(fs.readFileSync(args[0], "utf8")) as
          { name: string; versions: { constraints: unknown }[] };
        const { id } = store.createCase(data.name, data.versions[0].constraints);
        for (let i = 1; i < data.versions.length; i++) store.addVersion(id, data.versions[i].constraints);
        return print({ id, versions: data.versions.length });
      }
      case "delete": {
        store.deleteCase(Number(args[0]));
        return print({ deleted: Number(args[0]), note: "历史报告保留" });
      }
      case "demo": return runDemo();
      default:
        console.log(USAGE);
        if (cmd) process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof CrtError) {
      console.error(`错误 [${err.code}]: ${err.message}`);
      process.exitCode = 2;
    } else {
      throw err;
    }
  } finally {
    if (cmd !== "serve") store.close();
  }
}

main();
