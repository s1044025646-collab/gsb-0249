import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeAndReport, importCase } from './service';
import { deleteCase, getReport, listReports, openDatabase } from './db';

const tempDir = mkdtempSync(join(tmpdir(), 'crt-'));
const dbPath = join(tempDir, 'test.sqlite');

afterEach(() => {
  // 同一数据库重开由连接缓存之外的文件状态完成；测试结束无需删除临时目录。
});

describe('SQLite 快照和历史报告', () => {
  it('坏输入不写成功报告，重启后仍能复核报告', () => {
    const db = openDatabase(dbPath);
    const before = listReports(db).length;
    expect(() => analyzeAndReport(db, [{ modulus: '0', remainder: '1' }])).toThrow();
    expect(listReports(db).length).toBe(before);

    const answer = analyzeAndReport(db, [
      { modulus: '6', remainder: '4' },
      { modulus: '8', remainder: '6' },
    ]);
    const savedCase = importCase(db, '非互素例子', [
      { modulus: '6', remainder: '4' },
      { modulus: '8', remainder: '6' },
    ]);
    db.close();

    const reopened = openDatabase(dbPath);
    expect(getReport(reopened, answer.reportId).response).toMatchObject({
      solution: { remainder: '22', modulus: '24' },
    });
    expect(savedCase.version).toBe(1);
    deleteCase(reopened, savedCase.caseId);
    expect(getReport(reopened, answer.reportId).response).toBeTruthy();
    reopened.close();
  });
});
