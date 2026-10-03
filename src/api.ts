// HTTP API（node:http，零外部依赖）。所有整数均以十进制字符串传输。
import * as http from "node:http";
import { CrtError } from "./math";
import { solve, verifyCandidate, rangeCount } from "./solver";
import { Store } from "./store";

function json(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) reject(new CrtError("LIMIT_EXCEEDED", "请求体超过 1MB 上限"));
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new CrtError("BAD_JSON", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const body = req.method === "POST" || req.method === "PUT" ? await readBody(req) : {};
      const b = body as Record<string, unknown>;

      // 无状态直接计算
      if (req.method === "POST" && url.pathname === "/solve") {
        return json(res, 200, solve(b.constraints));
      }
      if (req.method === "POST" && url.pathname === "/verify") {
        return json(res, 200, verifyCandidate(b.constraints, b.value));
      }
      if (req.method === "POST" && url.pathname === "/range") {
        return json(res, 200, rangeCount(b.constraints, b.lo, b.hi));
      }

      // 算例管理
      if (req.method === "GET" && url.pathname === "/cases") {
        return json(res, 200, store.listCases());
      }
      if (req.method === "POST" && url.pathname === "/cases") {
        const { id, version } = store.createCase(String(b.name ?? ""), b.constraints ?? []);
        return json(res, 201, { id, version });
      }
      if (req.method === "POST" && url.pathname === "/import") {
        // 导入格式：{ name, versions: [{constraints}] }
        const data = b as { name?: string; versions?: { constraints: unknown }[] };
        if (!data.name || !Array.isArray(data.versions) || data.versions.length === 0) {
          throw new CrtError("VALIDATION", "导入格式需要 name 与非空 versions 数组");
        }
        const { id } = store.createCase(data.name, data.versions[0].constraints);
        for (let i = 1; i < data.versions.length; i++) {
          store.addVersion(id, data.versions[i].constraints);
        }
        return json(res, 201, { id, versions: data.versions.length });
      }

      if (parts[0] === "cases" && parts.length >= 2) {
        const id = Number(parts[1]);
        if (!Number.isInteger(id)) throw new CrtError("VALIDATION", "算例 id 非法");
        const sub = parts[2];

        if (req.method === "GET" && parts.length === 2) {
          const c = store.getCase(id);
          const v = store.getVersion(id);
          return json(res, 200, { ...c, version: v.version, constraints: v.constraints });
        }
        if (req.method === "DELETE" && parts.length === 2) {
          store.deleteCase(id);
          return json(res, 200, { deleted: id, note: "历史报告保留" });
        }
        if (req.method === "PUT" && sub === "constraints") {
          // 编辑即产生新版本，旧版本与历史报告不受影响
          const version = store.addVersion(id, b.constraints ?? []);
          return json(res, 200, { id, version });
        }
        if (req.method === "GET" && sub === "versions") {
          return json(res, 200, store.listVersions(id));
        }
        if (req.method === "POST" && sub === "solve") {
          const v = store.getVersion(id, b.version === undefined ? undefined : Number(b.version));
          const result = solve(v.constraints);
          const reportId = store.saveReport(id, v.versionId, "solve",
            { version: v.version }, result);
          return json(res, 200, { reportId, version: v.version, ...result });
        }
        if (req.method === "POST" && sub === "verify") {
          const v = store.getVersion(id, b.version === undefined ? undefined : Number(b.version));
          const result = verifyCandidate(v.constraints, b.value);
          const reportId = store.saveReport(id, v.versionId, "verify",
            { version: v.version, value: b.value }, result);
          return json(res, 200, { reportId, version: v.version, ...result });
        }
        if (req.method === "POST" && sub === "range") {
          const v = store.getVersion(id, b.version === undefined ? undefined : Number(b.version));
          const result = rangeCount(v.constraints, b.lo, b.hi);
          const reportId = store.saveReport(id, v.versionId, "range",
            { version: v.version, lo: b.lo, hi: b.hi }, result);
          return json(res, 200, { reportId, version: v.version, ...result });
        }
        if (req.method === "GET" && sub === "reports") {
          return json(res, 200, store.listReports(id));
        }
        if (req.method === "GET" && sub === "export") {
          const c = store.getCase(id);
          const versions = (store.listVersions(id) as unknown as { constraints_json: string }[])
            .map((v) => ({ ...v, constraints: JSON.parse(v.constraints_json), constraints_json: undefined }));
          return json(res, 200, { name: c.name, versions });
        }
      }

      if (parts[0] === "reports" && parts.length === 2 && req.method === "GET") {
        return json(res, 200, store.getReport(Number(parts[1])));
      }

      json(res, 404, { error: { code: "NOT_FOUND", message: "路由不存在" } });
    } catch (err) {
      if (err instanceof CrtError) {
        json(res, 400, { error: { code: err.code, message: err.message } });
      } else {
        json(res, 500, { error: { code: "INTERNAL", message: String(err) } });
      }
    }
  });
}

/** 启动服务；port 为 0 或未提供时由系统分配空闲端口。 */
export function startServer(store: Store, port = 0): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(store);
    server.listen(port, () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : port });
    });
  });
}
