import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError } from './errors';
import { defaultLimits, ResourceLimits } from './limits';

export interface SavedVersion {
  id: number;
  caseId: number;
  version: number;
  constraints: unknown;
  limits: ResourceLimits;
  createdAt: string;
}

export interface SavedReport {
  id: number;
  caseId: number | null;
  versionId: number | null;
  kind: string;
  request: unknown;
  response: unknown;
  createdAt: string;
}

export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS case_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      constraints_json TEXT NOT NULL,
      limits_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(case_id, version)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER REFERENCES cases(id) ON DELETE SET NULL,
      version_id INTEGER REFERENCES case_versions(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      request_json TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapVersion(row: Record<string, unknown>): SavedVersion {
  return {
    id: row.id as number,
    caseId: row.case_id as number,
    version: row.version as number,
    constraints: JSON.parse(row.constraints_json as string),
    limits: JSON.parse(row.limits_json as string) as ResourceLimits,
    createdAt: row.created_at as string,
  };
}

export function createCase(
  db: DatabaseSync,
  name: string,
  constraints: unknown,
  limits: ResourceLimits = defaultLimits,
): SavedVersion {
  const insertCase = db.prepare(
    'INSERT INTO cases (name, created_at, updated_at, deleted_at) VALUES (?, ?, ?, NULL)',
  );
  const insertVersion = db.prepare(
    `INSERT INTO case_versions (case_id, version, constraints_json, limits_json, created_at)
     VALUES (?, 1, ?, ?, ?)`,
  );
  try {
    const result = insertCase.run(name, nowIso(), nowIso());
    const caseId = Number(result.lastInsertRowid);
  insertVersion.run(caseId, stringifyJson(constraints), stringifyJson(limits), nowIso());
    return getVersion(db, caseId, 1);
  } catch (error) {
    if ((error as Error).message?.includes('UNIQUE')) {
      throw new AppError('NAME_CONFLICT', `算例名称已存在：${name}`);
    }
    throw error;
  }
}

export function addVersion(
  db: DatabaseSync,
  caseId: number,
  constraints: unknown,
  limits: ResourceLimits = defaultLimits,
): SavedVersion {
  const caseRow = db
    .prepare('SELECT id, deleted_at FROM cases WHERE id = ?')
    .get(caseId) as Record<string, unknown> | undefined;
  if (!caseRow) throw new AppError('CASE_NOT_FOUND', `算例不存在：${caseId}`);
  if (caseRow.deleted_at) throw new AppError('CASE_NOT_FOUND', `算例已删除：${caseId}`);

  const nextRow = db
    .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM case_versions WHERE case_id = ?')
    .get(caseId) as { next_version: number };
  const version = Number(nextRow.next_version);
  db.prepare(
    `INSERT INTO case_versions (case_id, version, constraints_json, limits_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(caseId, version, stringifyJson(constraints), stringifyJson(limits), nowIso());
  db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(nowIso(), caseId);
  return getVersion(db, caseId, version);
}

export function listCases(db: DatabaseSync, includeDeleted = false) {
  const rows = db
    .prepare(
      `SELECT id, name, created_at, updated_at, deleted_at FROM cases
       ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'}
       ORDER BY id DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }));
}

export function getCase(db: DatabaseSync, caseId: number) {
  const row = db
    .prepare(
      'SELECT id, name, created_at, updated_at, deleted_at FROM cases WHERE id = ? AND deleted_at IS NULL',
    )
    .get(caseId) as Record<string, unknown> | undefined;
  if (!row) throw new AppError('CASE_NOT_FOUND', `算例不存在：${caseId}`);
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listVersions(db: DatabaseSync, caseId: number): SavedVersion[] {
  getCase(db, caseId);
  return (
    db
      .prepare(
        `SELECT * FROM case_versions WHERE case_id = ? ORDER BY version DESC`,
      )
      .all(caseId) as Array<Record<string, unknown>>
  ).map(mapVersion);
}

export function getVersion(db: DatabaseSync, caseId: number, version: number): SavedVersion {
  const row = db
    .prepare('SELECT * FROM case_versions WHERE case_id = ? AND version = ?')
    .get(caseId, version) as Record<string, unknown> | undefined;
  if (!row) throw new AppError('VERSION_NOT_FOUND', `版本不存在：算例 ${caseId}，版本 ${version}`);
  return mapVersion(row);
}

export function deleteCase(db: DatabaseSync, caseId: number): void {
  getCase(db, caseId);
  db.prepare('UPDATE cases SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
    nowIso(),
    nowIso(),
    caseId,
  );
}

export function saveReport(
  db: DatabaseSync,
  kind: string,
  request: unknown,
  response: unknown,
  refs: { caseId?: number; versionId?: number } = {},
): SavedReport {
  const result = db
    .prepare(
      `INSERT INTO reports (case_id, version_id, kind, request_json, response_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      refs.caseId ?? null,
      refs.versionId ?? null,
      kind,
      stringifyJson(request),
      stringifyJson(response),
      nowIso(),
    );
  return getReport(db, Number(result.lastInsertRowid));
}

function mapReport(row: Record<string, unknown>): SavedReport {
  return {
    id: row.id as number,
    caseId: (row.case_id as number | null) ?? null,
    versionId: (row.version_id as number | null) ?? null,
    kind: row.kind as string,
    request: JSON.parse(row.request_json as string),
    response: JSON.parse(row.response_json as string),
    createdAt: row.created_at as string,
  };
}

export function getReport(db: DatabaseSync, reportId: number): SavedReport {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new AppError('REPORT_NOT_FOUND', `报告不存在：${reportId}`);
  return mapReport(row);
}

export function listReports(db: DatabaseSync, limit = 50): SavedReport[] {
  return (
    db.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT ?').all(limit) as Array<
      Record<string, unknown>
    >
  ).map(mapReport);
}
