# 整数同余条件合并与冲突解释后端

基于 TypeScript + Node.js + SQLite（`node:sqlite` 内置模块，零原生依赖）的本地后端，
提供 HTTP API 与 CLI，用于合并一组 `x ≡ r (mod m)` 形式的整数同余条件，
输出全部解的紧凑表示（最小非负余数 + 最小公倍数模数）或明确的冲突说明。

## 特性

- 自实现扩展欧几里得算法与广义中国剩余定理，支持**非互素模数**，全程 BigInt，不转 Number
- 逐条合并并输出每一步的余数、模数、gcd、余数差与整除检查结论
- 冲突时指出发生冲突的条件序号、gcd 与不可整除的余数差
- 所有整数以十进制字符串输入输出，支持负余数（自动规范化到 `[0, m)`）与任意大整数
- 候选整数逐项代回核验；闭区间有界查询只返回数量、首项、末项
- 空条件表示全体整数（`x ≡ 0 mod 1`）；模数 1 不增加限制；重复/冗余条件不改变解集
- SQLite 保存算例、约束版本与求解报告快照；编辑产生新版本，删除算例不影响历史报告

## 环境要求

- Windows 本地，Node.js ≥ 22（使用内置 `node:sqlite`，开发时为实验特性，会有警告但不影响功能）
- 不需要 Docker / WSL / 外部服务

## 常用命令

```powershell
npm install     # 安装开发依赖（typescript、@types/node）
npm run build   # 编译到 dist/
npm test        # 构建并运行全部测试
npm start       # 启动 HTTP 服务（默认自动选择空闲端口）
npm run demo    # 运行内置演示（互素 / 非互素 / 冲突 / 核验 / 区间）
```

数据保存在项目内 `data/congruence.db`。

## HTTP API

启动：`node dist/src/cli.js serve --port 8080`（`--port 0` 或省略则自动选空闲端口，
也可用环境变量 `PORT`）。启动后控制台打印实际端口。

所有整数均为十进制字符串。统一错误格式：`{"error":{"code":"...","message":"..."}}`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/solve` | 直接合并 `{constraints:[{residue,modulus}...]}` |
| POST | `/verify` | 核验 `{constraints, value}` |
| POST | `/range` | 区间计数 `{constraints, lo, hi}`（闭区间） |
| POST | `/cases` | 新建算例 `{name, constraints}` |
| GET | `/cases` | 列出算例 |
| GET | `/cases/:id` | 查看算例最新版本 |
| PUT | `/cases/:id/constraints` | 编辑约束（产生新版本，历史不变） |
| GET | `/cases/:id/versions` | 列出全部版本 |
| POST | `/cases/:id/solve` | 求解并保存报告（可指定 `version`） |
| POST | `/cases/:id/verify` | 核验并保存报告 `{value}` |
| POST | `/cases/:id/range` | 区间查询并保存报告 `{lo, hi}` |
| GET | `/cases/:id/reports` | 列出历史报告 |
| GET | `/cases/:id/export` | 导出算例 JSON |
| POST | `/import` | 导入算例 `{name, versions:[{constraints}]}` |
| DELETE | `/cases/:id` | 删除算例（历史报告保留） |
| GET | `/reports/:id` | 查看单个报告快照 |

### 错误码

| 错误码 | 含义 |
| --- | --- |
| `INVALID_INTEGER` | 非法十进制整数字符串 |
| `ZERO_MODULUS` | 模数为零 |
| `NEGATIVE_MODULUS` | 模数为负 |
| `LIMIT_EXCEEDED` | 超过资源上限（整数 1000 位 / 条件 1000 条 / 请求体 1MB） |
| `VALIDATION` | 其他参数校验失败 |
| `BAD_JSON` | 请求体不是合法 JSON |
| `NOT_FOUND` | 算例 / 版本 / 报告 / 路由不存在 |

## CLI

```
node dist/src/cli.js solve '[{"residue":"4","modulus":"6"},{"residue":"6","modulus":"8"}]'
node dist/src/cli.js verify '[{"residue":"4","modulus":"6"}]' "22"
node dist/src/cli.js range  '[{"residue":"4","modulus":"6"}]' "0" "100"
node dist/src/cli.js create 我的算例 '[{"residue":"2","modulus":"3"}]'
node dist/src/cli.js solve-case 1        # 求解并保存报告
node dist/src/cli.js export 1 > case.json
node dist/src/cli.js import case.json
node dist/src/cli.js demo
```

约束 JSON 也可写 `@文件路径` 从文件读取。完整子命令列表见 `node dist/src/cli.js`。

## 算法说明

逐条合并：已有 `x ≡ r1 (mod m1)` 与新条件 `x ≡ r2 (mod m2)`，
令 `g = gcd(m1, m2)`。若 `g ∤ (r2 - r1)` 则冲突，报告该条件序号、gcd 与余数差；
否则用扩展欧几里得求 `(m1/g)` 在模 `(m2/g)` 下的逆元，得
`x ≡ r1 + m1·t (mod lcm(m1,m2))`，其中 `t ≡ (r2-r1)/g · (m1/g)⁻¹ (mod m2/g)`，
余数规范化为最小非负值。空条件从 `x ≡ 0 (mod 1)` 出发，因此天然表示全体整数。

## 项目结构

```
src/math.ts     扩展欧几里得、gcd/lcm、规范化、合并、区间计数（纯 BigInt）
src/solver.ts   输入校验、求解报告、候选核验、区间查询
src/store.ts    SQLite 持久化（算例 / 版本 / 不可变报告）
src/api.ts      HTTP API（node:http，零外部依赖）
src/cli.ts      命令行入口与内置演示
test/           node:test 测试（含暴力枚举交叉校对）
```

## 已知限制

- `node:sqlite` 在 Node 22/25 中仍为实验特性，启动时有 ExperimentalWarning
- 仅支持一元线性同余 `x ≡ r (mod m)`，不含多项式或通用表达式
- 区间查询只返回数量/首项/末项，不展开解列表
