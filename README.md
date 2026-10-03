# 整数同余条件合并与冲突解释后端

本项目是仅包含 API 与 CLI 的 Windows 本地后端，用于分析一元整数同余条件：

```text
x = r (mod m)
```

所有整数均以十进制字符串输入输出，内部使用 `bigint`。项目自行实现扩展欧几里得算法和广义中国剩余定理，不调用现成同余求解器。

## 功能

- 合并正整数模数，支持非互素模数。
- 负余数自动规范化为最小非负余数。
- 空条件表示所有整数，即 `x = 0 mod 1`。
- 模数 `1`、重复条件、嵌套模数不会额外限制结果。
- 冲突时返回冲突条件、两侧当前结果、差值、`gcd` 和整除检查说明。
- 逐步记录合并前余数/模数、入条件、`gcd`、差值、LCM 和合并结果。
- 候选整数可逐项代回原始条件核验。
- 区间查询仅返回闭区间内解的数量、首项和末项，不展开巨大列表。
- 小模数可在一个完整公共周期内枚举，便于与暴力求余校对。
- SQLite 保存约束快照、参数和成功报告；报告不可变。
- 删除算例为软删除，旧报告仍可复核；编辑通过追加版本完成。

## 环境与安装

需要 Windows 本地 Node.js 22+（开发验证使用 Node.js 25.5.0）。SQLite 使用 Node 内置 `node:sqlite`，不需要 Docker、WSL、原生编译工具链或外部服务。

```powershell
npm install
npm run build
npm test
npm run demo
```

## 启动服务

默认选择本机空闲端口：

```powershell
npm start
```

指定端口：

```powershell
$env:PORT="8080"; npm start
```

也可以直接使用 CLI：

```powershell
npx tsx src/cli.ts serve --port 8080
```

数据默认位于项目内 `data/congruence.sqlite`，可用 `CRT_DATA_DIR` 改变目录。

## API 示例

### 合并

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8080/api/solve `
  -ContentType 'application/json' `
  -Body '{"constraints":[{"modulus":"6","remainder":"4"},{"modulus":"8","remainder":"6"}]}'
```

结果为：

```json
{ "remainder": "22", "modulus": "24" }
```

### 核验候选

```json
POST /api/verify
{
  "constraints": [{ "modulus": "6", "remainder": "4" }],
  "candidates": ["22", "-2"]
}
```

### 区间查询

```json
POST /api/range
{
  "constraints": [
    { "modulus": "6", "remainder": "4" },
    { "modulus": "8", "remainder": "6" }
  ],
  "lower": "0",
  "upper": "100"
}
```

### 算例、版本和报告

- `POST /api/import`：保存命名算例首版本。
- `GET /api/cases`：列出算例。
- `POST /api/cases/{id}/versions`：追加新版本，不覆盖旧版本。
- `GET /api/cases/{id}/versions/{version}`：导出指定快照。
- `DELETE /api/cases/{id}`：软删除算例，历史报告保留。
- `GET /api/reports/{id}`：复核历史成功报告。

其他接口：`GET /health`、`POST /api/enumerate`、`GET /api/reports`。

## CLI 示例

```powershell
npx tsx src/cli.ts solve --input examples/non-coprime.json
npx tsx src/cli.ts verify --input examples/verify.json
npx tsx src/cli.ts range --input examples/range.json
npx tsx src/cli.ts import --name "非互素例子" --input examples/non-coprime.json
npx tsx src/cli.ts cases
npx tsx src/cli.ts versions 1
npx tsx src/cli.ts export 1 1 --output data/export-v1.json
npx tsx src/cli.ts report 1
```

构建后也可运行：

```powershell
node dist/cli.js solve --input examples/non-coprime.json
```

## 输入格式与限制

条件格式：

```json
{
  "constraints": [
    { "modulus": "8", "remainder": "6", "label": "x 除以 8 余 6" }
  ]
}
```

合法整数是可选正负号加十进制数字，不接受小数、科学计数法、十六进制或 `Number` 类型。

默认资源上限：

- 最多 100 个条件。
- 单个整数最多 180 位十进制数字。
- 合并 LCM 最多 4096 比特。
- 枚举公共周期最多 100000。
- 最多核验 1000 个候选。

可在请求中提供：

```json
"limits": {
  "maxConditions": 100,
  "maxDecimalDigits": 180,
  "maxLcmBits": 4096,
  "maxEnumerationPeriod": "100000",
  "maxCandidates": 1000
}
```

## 错误码

- `INVALID_JSON`：请求体不是合法 JSON。
- `INVALID_INTEGER`：非法十进制整数字符串。
- `MODULUS_ZERO`：模数为零。
- `MODULUS_NEGATIVE`：模数为负。
- `INVALID_CONSTRAINTS`：条件数组结构非法。
- `INVALID_RANGE`：区间下界大于上界等。
- `RESOURCE_LIMIT_EXCEEDED`：超过条件数、位数、LCM 或枚举上限。
- `CASE_NOT_FOUND`、`VERSION_NOT_FOUND`、`REPORT_NOT_FOUND`：历史对象不存在。
- `NAME_CONFLICT`：命名算例重复。

参数校验失败不会写入报告；可成功计算但无解的冲突会保存为 `conflict` 报告，方便重启后复核。CLI 对错误输出 JSON，进程退出码为 1。

## 数学说明

已有结果 `x = r1 mod m1` 与下一条件 `x = r2 mod m2` 合并时，令：

```text
g = gcd(m1, m2)
```

可解的充要条件是：

```text
g | (r2 - r1)
```

不满足时无整数解。满足时，新的模数为：

```text
lcm(m1, m2) = m1 * m2 / g
```

代码在 `m1/g` 与 `m2/g` 互素后，通过扩展欧几里得求得逆元，并返回最小非负余数。全程使用 `bigint`，不会把大整数转换为 `number` 计算逆元。

## 已验证场景

`npm test` 覆盖：

- `x=2 mod 3`、`x=3 mod 5` 得 `x=8 mod 15`。
- `x=4 mod 6`、`x=6 mod 8` 得 `x=22 mod 24`。
- 非互素冲突条件及 `gcd` 不整除差值说明。
- 负余数、大于 `Number.MAX_SAFE_INTEGER` 的值、模数一、重复条件、嵌套模数。
- 不含解区间、区间计数、首项和末项。
- 调整输入顺序后的规范化结果一致。
- 完整公共周期暴力枚举校对。
- 坏输入不产生成功报告，SQLite 重开后历史报告仍可复核。

## 范围限制

仅支持一元同余，不支持多项式、通用表达式、同余不等式、布尔组合、多变量系统或密码协议。区间查询只统计 `x = r mod m` 这一线性解族；不枚举超大周期。
