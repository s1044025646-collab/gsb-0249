// SQLite 持久化：算例、约束版本、求解报告快照（报告不可变）。
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { CrtError } from "./math";

export const DATA_DIR = path.join(process.cwd(), "data");
export const DB_PATH = path.join(DATA_DIR, "congruence.db");

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string = DB_PATH) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL REFERENCES cases(id),
        version INTEGER NOT NULL,
        constraints_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(case_id, version)
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        version_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        params_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  close() { this.db.close(); }

  createCase(name: string, constraints: unknown): { id: number; version: number } {
    if (typeof name !== "string" || name.trim() === "") {
      throw new CrtError("VALIDATION", "name 必须是非空字符串");
    }
    const info = this.db.prepare("INSERT INTO cases (name) VALUES (?)").run(name.trim());
    const id = Number(info.lastInsertRowid);
    const version = this.addVersion(id, constraints);
    return { id, version };
  }

  addVersion(caseId: number, constraints: unknown): number {
    this.getCase(caseId); // 确认存在
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(version), 0) AS v FROM versions WHERE case_id = ?"
    ).get(caseId) as { v: number };
    const version = row.v + 1;
    this.db.prepare(
      "INSERT INTO versions (case_id, version, constraints_json) VALUES (?, ?, ?)"
    ).run(caseId, version, JSON.stringify(constraints));
    return version;
  }

  listCases() {
    return this.db.prepare(`
      SELECT c.id, c.name, c.created_at,
        (SELECT MAX(version) FROM versions WHERE case_id = c.id) AS latest_version
      FROM cases c ORDER BY c.id
    `).all();
  }

  getCase(id: number) {
    const row = this.db.prepare("SELECT * FROM cases WHERE id = ?").get(id);
    if (!row) throw new CrtError("NOT_FOUND", `算例 ${id} 不存在`);
    return row as { id: number; name: string; created_at: string };
  }

  deleteCase(id: number) {
    this.getCase(id);
    // 只删除算例与当前版本链；历史报告保留，标记 case_id 仍可追溯
    this.db.prepare("DELETE FROM versions WHERE case_id = ?").run(id);
    this.db.prepare("DELETE FROM cases WHERE id = ?").run(id);
  }

  getVersion(caseId: number, version?: number): { version: number; constraints: unknown; versionId: number } {
    this.getCase(caseId);
    const row = version === undefined
      ? this.db.prepare(
          "SELECT * FROM versions WHERE case_id = ? ORDER BY version DESC LIMIT 1"
        ).get(caseId)
      : this.db.prepare(
          "SELECT * FROM versions WHERE case_id = ? AND version = ?"
        ).get(caseId, version);
    if (!row) throw new CrtError("NOT_FOUND", `算例 ${caseId} 的版本 ${version ?? "最新"} 不存在`);
    const r = row as { id: number; version: number; constraints_json: string };
    return { version: r.version, constraints: JSON.parse(r.constraints_json), versionId: r.id };
  }

  listVersions(caseId: number) {
    this.getCase(caseId);
    return this.db.prepare(
      "SELECT id, version, constraints_json, created_at FROM versions WHERE case_id = ? ORDER BY version"
    ).all(caseId);
  }

  /** 保存报告快照。kind: solve | verify | range。 */
  saveReport(caseId: number, versionId: number, kind: string, params: unknown, result: unknown): number {
    const info = this.db.prepare(
      "INSERT INTO reports (case_id, version_id, kind, params_json, result_json) VALUES (?, ?, ?, ?, ?)"
    ).run(caseId, versionId, kind, JSON.stringify(params), JSON.stringify(result));
    return Number(info.lastInsertRowid);
  }

  listReports(caseId: number) {
    return this.db.prepare(
      "SELECT id, case_id, version_id, kind, params_json, result_json, created_at FROM reports WHERE case_id = ? ORDER BY id"
    ).all(caseId).map((r) => {
      const row = r as { params_json: string; result_json: string } & Record<string, unknown>;
      return { ...row, params: JSON.parse(row.params_json), result: JSON.parse(row.result_json),
               params_json: undefined, result_json: undefined };
    });
  }

  getReport(reportId: number) {
    const row = this.db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId) as
      { params_json: string; result_json: string } & Record<string, unknown> | undefined;
    if (!row) throw new CrtError("NOT_FOUND", `报告 ${reportId} 不存在`);
    return { ...row, params: JSON.parse(row.params_json), result: JSON.parse(row.result_json),
             params_json: undefined, result_json: undefined };
  }
}
