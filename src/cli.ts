#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from './errors';
import {
  deleteCase,
  getCase,
  getReport,
  getVersion,
  listCases,
  listReports,
  listVersions,
  openDatabase,
} from './db';
import {
  analyzeAndReport,
  enumerateAndReport,
  importCase,
  importVersion,
  rangeAndReport,
  verifyAndReport,
} from './service';
import { createAppServer, listen } from './server';

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) flags.set(key, 'true');
      else {
        flags.set(key, next);
        index += 1;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function readJsonInput(flags: Map<string, string>, field = 'input'): Record<string, unknown> {
  const inline = flags.get('json');
  if (inline) return JSON.parse(inline) as Record<string, unknown>;
  const file = flags.get(field);
  if (!file) throw new AppError('INVALID_ARGUMENT', `需要 --${field} 文件路径或 --json`);
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const dataDir = process.env.CRT_DATA_DIR ?? join(process.cwd(), 'data');
  const db = openDatabase(join(dataDir, 'congruence.sqlite'));

  switch (command) {
    case 'solve':
    case 'merge': {
      const body = readJsonInput(flags);
      print(analyzeAndReport(db, body.constraints, body.limits));
      break;
    }
    case 'verify': {
      const body = readJsonInput(flags);
      print(verifyAndReport(db, body.constraints, body.candidates, body.limits));
      break;
    }
    case 'range': {
      const body = readJsonInput(flags);
      print(rangeAndReport(db, body.constraints, body.lower, body.upper, body.limits));
      break;
    }
    case 'enumerate': {
      const body = readJsonInput(flags);
      print(enumerateAndReport(db, body.constraints, body.limits));
      break;
    }
    case 'import': {
      const body = readJsonInput(flags);
      print(importCase(db, flags.get('name') ?? (body.name as string), body.constraints, body.limits));
      break;
    }
    case 'cases':
      print({ cases: listCases(db, flags.get('include-deleted') === 'true') });
      break;
    case 'case':
      print(getCase(db, Number(positional[0])));
      break;
    case 'delete-case':
      deleteCase(db, Number(positional[0]));
      print({ deleted: true });
      break;
    case 'versions':
      print({ versions: listVersions(db, Number(positional[0])) });
      break;
    case 'version':
      print(getVersion(db, Number(positional[0]), Number(positional[1] ?? flags.get('version'))));
      break;
    case 'add-version': {
      const body = readJsonInput(flags);
      print(importVersion(db, Number(positional[0]), body.constraints, body.limits));
      break;
    }
    case 'export': {
      const version = getVersion(db, Number(positional[0]), Number(positional[1]));
      const payload = JSON.stringify(version, null, 2);
      if (flags.get('output')) writeFileSync(flags.get('output')!, payload, 'utf8');
      else process.stdout.write(`${payload}\n`);
      break;
    }
    case 'reports':
      print({ reports: listReports(db, Number(flags.get('limit') ?? 50)) });
      break;
    case 'report':
      print(getReport(db, Number(positional[0])));
      break;
    case 'serve': {
      const server = createAppServer();
      const port = await listen(server, Number(flags.get('port') ?? process.env.PORT ?? 0));
      console.log(`http://127.0.0.1:${port}`);
      break;
    }
    default:
      console.log(`
用法: crt <command> [--input file.json] [--json '{...}']
命令:
  solve          合并同余条件并输出逐步说明
  verify         核验候选整数
  range          查询闭区间数量、首项、末项
  enumerate      在一个公共周期内枚举小模数解
  import         保存命名算例首版本
  add-version    为算例追加不可变版本
  cases          列出算例
  case <id>      查看算例
  versions <id>  列出版本
  version <id> <version> 查看版本
  export <id> <version> --output file.json
  reports        列出成功报告
  report <id>    复核历史报告
  delete-case <id> 软删除当前算例但保留历史报告
  serve          启动 HTTP API；--port 可指定端口，默认空闲端口
`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof AppError) {
    console.error(JSON.stringify({ error: { code: error.code, message: error.message, details: error.details } }, null, 2));
  } else if (error instanceof SyntaxError) {
    console.error(JSON.stringify({ error: { code: 'INVALID_JSON', message: error.message } }, null, 2));
  } else {
    console.error(JSON.stringify({ error: { code: 'INVALID_ARGUMENT', message: String(error) } }, null, 2));
  }
  process.exitCode = 1;
});
