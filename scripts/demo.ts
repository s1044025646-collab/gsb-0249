import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDatabase } from '../src/db';
import { analyzeAndReport, rangeAndReport, verifyAndReport } from '../src/service';

const dataDir = join(process.cwd(), 'data');
mkdirSync(dataDir, { recursive: true });
const db = openDatabase(join(dataDir, 'demo.sqlite'));

const examples = [
  {
    title: '互素模数：x=2 mod 3, x=3 mod 5',
    constraints: [
      { modulus: '3', remainder: '2' },
      { modulus: '5', remainder: '3' },
    ],
  },
  {
    title: '非互素模数：x=4 mod 6, x=6 mod 8',
    constraints: [
      { modulus: '6', remainder: '4' },
      { modulus: '8', remainder: '6' },
    ],
  },
  {
    title: '冲突条件：x=4 mod 6, x=2 mod 9',
    constraints: [
      { modulus: '6', remainder: '4' },
      { modulus: '9', remainder: '2' },
    ],
  },
];

for (const example of examples) {
  console.log(`\n=== ${example.title} ===`);
  console.log(JSON.stringify(analyzeAndReport(db, example.constraints), null, 2));
}

const nonCoprime = examples[1].constraints;
console.log('\n=== 核验候选 22 与 46 ===');
console.log(JSON.stringify(verifyAndReport(db, nonCoprime, ['22', '46']), null, 2));
console.log('\n=== 查询闭区间 [0, 100] ===');
console.log(JSON.stringify(rangeAndReport(db, nonCoprime, '0', '100'), null, 2));
console.log('\n演示数据库：data/demo.sqlite');
