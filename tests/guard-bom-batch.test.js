// tests/guard-bom-batch.test.js —— 「面料 / 刀口布」判定唯一入口的防回归守卫
//
// 背景（2026-09-12 真机反馈）：BOM 行有两种面料口径 ——
//   · 按片面料（piece）：按长×宽算面积、需要排裁剪
//   · 按批估量 / 刀口布（batch）：按「每件用量(kg/片)」扣料，**不裁剪、不计面积**
// 但历史上到处手写 `b.isFabric` 就当「要裁剪的面料」，漏掉 batch，
// 同一个根因连出 6 个 bug：
//   ① 成品编辑保存被「请先完成裁剪」拦住（用户报的）
//   ② 生产时强制弹剪裁选择器（生产页 + 清单页两处）
//   ③ 保存/生产时给刀口布写下长宽与 fabricRects 红区 → 脏数据回灌，下次编辑又被拦
//   ④ 排单交付漏扣料（按面积算是 0）
//   ⑤ 退产 / 撤销交付凭空生成假「余料片」，账实不符
//   ⑥ 详情页与 CSV 把刀口布规格显示成面积（0cm²）
//
// 修法是把判定收口到 calc（bomLineNeedsCut / pendingCutLines / cutQueueFor / bomLineSpec）
// 与 util.bomIsBatchLine。本守卫就是防止「第 7 次」再冒出来：谁再手写判定，测试直接红。
//
// 行为层用例见 tests/bom-batch.test.js 与 tests/bom-batch-produce.test.js（这一份只管源码扫描）。

const path = require('path');
const fs = require('fs');
const { test, group, ok, equal } = require('./harness.js');

const ROOT = path.join(__dirname, '..');

function walk(dir, out) {
  fs.readdirSync(dir).forEach((f) => {
    if (f === 'node_modules' || f === '.git') return;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.js$/.test(f)) out.push(p);
  });
  return out;
}

// 去掉注释，避免「注释里提到 isFabric」造成假阳性（本次修复的注释里就有大量 isFabric）
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function sourceFiles() {
  return walk(ROOT, [])
    .filter((p) => {
      const rel = path.relative(ROOT, p).replace(/\\/g, '/');
      return rel.indexOf('tests/') !== 0 && rel.indexOf('tools/') !== 0 && rel.indexOf('.workbuddy/') !== 0;
    })
    .map((p) => ({ rel: path.relative(ROOT, p).replace(/\\/g, '/'), code: stripComments(fs.readFileSync(p, 'utf8')) }));
}

group('刀口布 · 判定唯一入口（源码扫描守卫）');

test('「裁剪任务」对象只允许在 utils/calc.js 里构造 —— 页面不得自己拼 redLen/redWid', () => {
  // cut-picker 页面只消费外部传入的任务（读 t.redLen），不算构造
  const ALLOW = ['utils/calc.js', 'pages/cut-picker/cut-picker.js'];
  const offenders = [];
  sourceFiles().forEach(({ rel, code }) => {
    if (ALLOW.indexOf(rel) >= 0) return;
    // cut-picker 页面只消费外部传入的任务（读 t.redLen），不算构造；
    // 负向断言排除 `useRotate ? redLen : redWid` 这类三元读值（store 内部裁剪取源）
    if (/redLen\s*:(?!\s*redWid)/.test(code) || /redWid\s*:(?!\s*redLen)/.test(code)) offenders.push(rel);
  });
  equal(
    offenders.length, 0,
    '以下文件在手工拼装裁剪任务（刀口布会被误判成需要裁剪）：' + offenders.join('、') + ' —— 请改走 calc.cutQueueFor()'
  );
});

test('不得用「isFabric + 长/宽」手写裁剪判定（calc 之外）', () => {
  // 按行匹配：同一行里同时出现 isFabric 与 .length/.width 且是 && / || 组合。
  // 不含换行是刻意的 —— 跨行匹配会把「表单字段映射」这类正常代码也扫进来（假阳性）。
  const patterns = [
    /isFabric\s*(?:&&|\|\|)[^\n;]*\.(?:length|width)/,
    /\.(?:length|width)[^\n;]*(?:&&|\|\|)[^\n;]*isFabric/,
    // 换个变量名（const fabric = b.isFabric || …）也绕不过去：
    // 「把长宽当 >0 判据」这件事本身只允许出现在 calc 的裁剪判定里
    /Number\(\s*b\.(?:length|width)\s*\|\|\s*0\s*\)/
  ];
  const offenders = [];
  sourceFiles().forEach(({ rel, code }) => {
    if (rel === 'utils/calc.js') return;
    if (patterns.some((re) => re.test(code))) offenders.push(rel);
  });
  equal(
    offenders.length, 0,
    '以下文件手写了「面料即要裁剪」的判定，漏掉按批估量（刀口布）：' + offenders.join('、') +
    ' —— 请改走 calc.bomLineNeedsCut() / calc.pendingCutLines() / calc.cutQueueFor()'
  );
});

test('「按批估量」判定只有一处实现：util.bomIsBatchLine（calc 只是转发）', () => {
  const util = sourceFiles().find((x) => x.rel === 'utils/util.js');
  const calc = sourceFiles().find((x) => x.rel === 'utils/calc.js');
  ok(util && /function bomIsBatchLine/.test(util.code), 'util.js 应有 bomIsBatchLine');
  ok(calc && /util\.bomIsBatchLine\(/.test(calc.code), 'calc.js 的 bomLineIsBatch 应转发到 util，避免两套口径');
  // store.js 必须也走这个判定（不能自己写 m.stockMode === 'batch' 当裁剪口径）
  const store = sourceFiles().find((x) => x.rel === 'utils/store.js');
  ok(store && /util\.bomIsBatchLine\(/.test(store.code), 'store.js 的物料账务也应走 util.bomIsBatchLine');
});

test('两个生产入口必须共用 calc.cutQueueFor（防止只修一处）', () => {
  ['pages/products/instances.js', 'pages/products/list.js'].forEach((rel) => {
    const f = sourceFiles().find((x) => x.rel === rel);
    ok(f, '缺少文件 ' + rel);
    ok(/calc\.cutQueueFor\(/.test(f.code), rel + ' 应改用 calc.cutQueueFor() 生成裁剪队列');
  });
});

test('成品编辑保存的裁剪校验必须走 calc.pendingCutLines', () => {
  const f = sourceFiles().find((x) => x.rel === 'pages/products/edit.js');
  ok(f, '缺少 pages/products/edit.js');
  ok(/calc\.pendingCutLines\(/.test(f.code), '编辑页保存校验应改用 calc.pendingCutLines()');
});
