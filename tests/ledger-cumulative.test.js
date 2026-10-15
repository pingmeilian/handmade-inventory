// tests/ledger-cumulative.test.js —— 「累计总账」（总计消费 / 总计收入）· 2026-10-10 V131
//
// 用户需求（原话）：
//   「我还想做两个数值，就是总计消费和总计收入，也就是我从最开始直到现在，
//     所有的物料损耗、机器等等一系列的消费都算上。收入呢，就是我收入我囊中的钱卖出去的等等」
// 用户拍板（2026-10-10 13:41 / 13:45）：
//   ① 消费口径 **A（累计投入/现金）与 B（累计已耗/成本）都要**；
//   ② 「其它支出」入口 **要**；
//   ③ 排单**不算全额收入，只有「已交付」的那一截算**；
//   ④ 放在 **「我的」页**；主数字用 **A**。
//
// 本文件盯的是**口径**（最容易悄悄错的地方），不是"函数有没有被调用"。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal, near } = require('./harness.js');
const F = require('./fixtures.js');

const store = F.store;
const util = F.util;
const stat = require('../utils/stat.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripWxml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const K = store.KEYS;

// 固定区间：让"至今"变成可复现的数字（否则折旧/摊销会随真实日期漂）
const RANGE = { from: '2026-01-01', to: '2026-01-31' };

function flow(over) {
  return Object.assign({
    id: util.uid('f'), categoryId: 'bc_default', date: '2026-01-10',
    materialId: 'm_x', materialName: 'X', type: 'in', qty: 1, totalPrice: 0
  }, over);
}
function cm(over) {
  return Object.assign({
    id: util.uid('cm'), categoryId: 'bc_default', qty: 1, deliveredQty: 0,
    price: 0, status: 'active', productId: 'p_x'
  }, over);
}

group('累计总账 · 收入（售出 + 排单已交付）');

test('★ ① 收入 = 售出全额 + 排单**只算已交付那一截**', () => {
  F.reset();
  F.seedProducts([
    F.product({ name: 'A', sales: [{ id: 's1', qty: 2, price: 100, date: '2026-01-05' }] }),
    F.product({ name: 'B', sales: [{ id: 's2', qty: 1, price: 50, date: '2026-01-06' }] })
  ]);
  store.set(K.COMMISSIONS, [
    cm({ id: 'cm1', qty: 3, deliveredQty: 1, price: 100, status: 'active' }), // 只算 1 件 = 100
    cm({ id: 'cm2', qty: 5, deliveredQty: 0, price: 200, status: 'active' }), // 一件没交 ⇒ 0
    cm({ id: 'cm3', qty: 2, deliveredQty: 2, price: 30, status: 'done' })     // 全交完 = 60
  ]);

  const t = stat.cumulativeTotals(RANGE);
  equal(t.income.sales, 250, '售出 = 2×100 + 1×50');
  equal(t.income.commission, 160, '排单 = 1×100（只算已交付）+ 2×30；未交付的 5 件一分不算');
  equal(t.income.total, 410, '收入合计 410');

  // 注入法自检：若按"整单 qty"算，数字必须不同 —— 否则这条断言证明不了任何事
  const naive = 3 * 100 + 5 * 200 + 2 * 30;
  ok(naive !== t.income.commission,
    '自检失败：已交付口径与整单口径算出了同一个数 ⇒ 这组数据证明不了"只算已交付"');
});

test('② 排单没有交付记录（无 deliveredQty 字段）时按 0 计，不许当成"全交"', () => {
  F.reset();
  store.set(K.COMMISSIONS, [cm({ id: 'cm1', qty: 4, price: 500, status: 'active' })]);
  const t = stat.cumulativeTotals(RANGE);
  equal(t.income.commission, 0, '老数据没有 deliveredQty ⇒ 视为未交付（保守，不虚报收入）');
});

group('累计总账 · 消费 A（累计投入 / 现金）');

test('★ ③ A = 物料采购 + 耗材 + 资产原值 + 工具 + 维修 + 其它支出', () => {
  F.reset();
  F.seedFlows([
    flow({ type: 'in', source: 'manual', totalPrice: 500, date: '2026-01-05' }),
    flow({ type: 'in', source: 'manual', totalPrice: 300, date: '2026-01-20' })
  ]);
  store.set(K.CONSUMABLES, [{
    id: 'cs1', categoryId: 'bc_default', name: '线', quantity: 10, totalPrice: 80,
    status: 'stock', inDate: '2026-01-05', useDate: null, outDate: null
  }]);
  const asset = store.saveAsset({ categoryId: 'bc_default', name: '缝纫机', originalValue: 1200, lifeMonths: 12, inDate: '2026-01-03' });
  store.saveTool({ categoryId: 'bc_default', name: '剪刀', price: 60, inDate: '2026-01-04' });
  store.addAssetRepair(asset.id, { date: '2026-01-20', fee: 150, note: '换梭芯' });
  store.saveOtherExpense({ categoryId: 'bc_default', name: '快递费', amount: 40, date: '2026-01-25' });

  const t = stat.cumulativeTotals(RANGE);
  equal(t.spendA.material, 800, '物料采购 = 500 + 300');
  equal(t.spendA.consumable, 80, '耗材按买价全额进 A');
  equal(t.spendA.asset, 1200, '资产按**原值**进 A（不是折旧）');
  equal(t.spendA.tool, 60, '工具按买价进 A');
  equal(t.spendA.repair, 150, '维修费单独一项（原值里不含它）');
  equal(t.spendA.other, 40, '其它支出（本轮新增的入口）');
  equal(t.spendA.total, 2330, 'A 合计 = 800+80+1200+60+150+40');
});

test('★★ ④ A 只认「真采购」—— type:\'in\' 但 source≠manual 的一律不计', () => {
  F.reset();
  F.seedFlows([
    flow({ type: 'in', source: 'manual', totalPrice: 1000 }),      // ✅ 真采购（入库/补货）
    flow({ type: 'in', source: 'stocktake', totalPrice: 999 }),    // ❌ 盘盈：对账修正，不是花钱
    flow({ type: 'in', source: 'calibration', totalPrice: 888 }),  // ❌ 一次性库存校准
    flow({ type: 'in', source: 'reversal', totalPrice: 777 }),     // ❌ 冲销
    flow({ type: 'in', source: 'cut', totalPrice: 666 }),          // ❌ 成品撤销生产·退料
    flow({ type: 'in', source: 'commission', totalPrice: 555 })    // ❌ 撤销交付·退料
  ]);

  const t = stat.cumulativeTotals(RANGE);
  equal(t.spendA.material, 1000, '六笔里只有 source=manual 那一笔算采购');

  // 注入法自检：naive（只看 type==='in'）必须得到另一个数，否则守卫没有牙
  const naive = 1000 + 999 + 888 + 777 + 666 + 555;
  ok(naive !== t.spendA.material,
    '自检失败：naive 求和与正确口径相同 ⇒ 这组数据证明不了"必须看 source"');
});

group('累计总账 · 消费 B（累计已耗 / 成本）');

test('★ ⑤ B = 净出库的物料 + 耗材摊销 + 资产折旧 + 工具支出；退料应**减少** B', () => {
  F.reset();
  F.seedFlows([
    flow({ type: 'out', source: 'cut', totalPrice: 300, date: '2026-01-08' }),
    flow({ type: 'out', source: 'destroy', totalPrice: 50, date: '2026-01-09' }),
    flow({ type: 'out', source: 'stocktake', totalPrice: 20, date: '2026-01-10' }),
    flow({ type: 'out', source: 'commission', totalPrice: 130, date: '2026-01-11' }),
    flow({ type: 'in', source: 'cut', totalPrice: 60, date: '2026-01-12' }),      // 退料 ⇒ 抵消
    flow({ type: 'in', source: 'manual', totalPrice: 999, date: '2026-01-13' })   // 采购 ⇒ 不进 B
  ]);
  store.set(K.CONSUMABLES, [{
    id: 'cs1', categoryId: 'bc_default', name: '线', quantity: 10, totalPrice: 100,
    status: 'out', inDate: '2026-01-01', useDate: '2026-01-01', outDate: '2026-01-10'
  }]);
  store.saveAsset({ categoryId: 'bc_default', name: '缝纫机', originalValue: 1200, lifeMonths: 12, inDate: '2025-12-01' });
  store.saveTool({ categoryId: 'bc_default', name: '剪刀', price: 300, inDate: '2026-01-15' });

  const t = stat.cumulativeTotals(RANGE);
  equal(t.spendB.material, 440, '净出库 = (300+50+20+130) − 60 退料 = 440；采购的 999 不算');
  equal(t.spendB.consumableAmort, 100, '耗材 100 元 / 10 天 × 10 天 = 全部摊完');
  equal(t.spendB.depreciation, 100, '月折旧 1200/12 = 100（入库月 2025-12 不提，1 月整月 100）');
  equal(t.spendB.toolExpense, 300, '工具购入当月一次确认');
  equal(t.spendB.total, 940, 'B 合计 = 物料 440 + 摊销 500');
});

test('★ ⑥ A 与 B 是两个数：A 是"买进来"、B 是"用出去"，两者相减 = 还在库存里的料', () => {
  F.reset();
  F.seedFlows([
    flow({ type: 'in', source: 'manual', totalPrice: 1000, date: '2026-01-02' }),
    flow({ type: 'out', source: 'cut', totalPrice: 250, date: '2026-01-08' })
  ]);
  const t = stat.cumulativeTotals(RANGE);
  equal(t.spendA.material, 1000, '买进来 1000');
  equal(t.spendB.material, 250, '用出去 250');
  equal(t.spendA.material - t.spendB.material, 750, '差额 = 还躺在库存里的料');

  // 注入法自检：把 A 和 B 写成同一个数必须能被抓住
  ok(t.spendA.total !== t.spendB.total, '自检失败：A 与 B 竟然相等 ⇒ 一旦实现里写成同一个口径，这条守卫没有牙');
});

group('累计总账 · 界面与入口（结构守卫）');

test('⑦ 「其它支出」有数据层、有入口、且进了备份清单', () => {
  const keys = read('services/keys.js');
  ok(/OTHER_EXPENSES:\s*'bm_/.test(keys), 'keys.js 应有 OTHER_EXPENSES 键');
  // ⚠️ 不能用 `keys.split('DATA_KEYS')[1]` —— 注释里也出现过这个词（BACKUP_SNAPSHOTS 那条），
  //    会被切到错误的位置。精确取 `const DATA_KEYS = [ ... ]` 的字面量。
  const dm = /const DATA_KEYS\s*=\s*\[([\s\S]*?)\]/.exec(keys);
  ok(!!dm, 'keys.js 里找不到 DATA_KEYS 数组');
  ok(/KEYS\.OTHER_EXPENSES/.test(dm[1]),
    '★ 新键必须进 DATA_KEYS —— 否则备份/导出会漏掉用户的支出记录');

  const loss = stripComments(read('services/loss.js'));
  ['getOtherExpenses', 'getOtherExpensesOf', 'saveOtherExpense', 'removeOtherExpense'].forEach((fn) => {
    ok(loss.indexOf('function ' + fn) >= 0, 'services/loss.js 应有 ' + fn + '()');
  });

  const idx = stripComments(read('pages/loss/index.js'));
  ok(/key:\s*'other'/.test(idx), '损耗页分段里要有「其它支出」这一段');

  const edit = stripComments(read('pages/loss/edit.js'));
  ok(/type === 'other'/.test(edit) || /'other'/.test(edit), 'loss/edit.js 要有 other 类型的保存分支');
  ok(/saveOtherExpense/.test(edit), '★ 保存分支必须真的调用 saveOtherExpense，不能只是有个 if');

  const wxml = stripWxml(read('pages/loss/edit.wxml'));
  ok(/other/.test(wxml), 'loss/edit.wxml 要有「其它支出」的表单块');
});

test('⑧ 「我的」页有累计总账卡，且能跳到明细页（新页已注册）', () => {
  const app = JSON.parse(read('app.json'));
  ok(app.pages.indexOf('pages/ledger/ledger') >= 0, 'new page 必须在 app.json 注册');

  ['js', 'json', 'wxml', 'wxss'].forEach((ext) => {
    ok(fs.existsSync(path.join(ROOT, 'pages/ledger/ledger.' + ext)),
      'pages/ledger/ledger.' + ext + ' 四件套要齐');
  });

  const mineWxml = stripWxml(read('pages/mine/mine.wxml'));
  ok(/累计总账/.test(mineWxml), '「我的」页要有「累计总账」这张卡');
  ok(/总计消费/.test(mineWxml) && /总计收入/.test(mineWxml), '卡上要同时有两个数字');
  ok(/bindtap="goLedger"/.test(mineWxml) || /ledger\/ledger/.test(mineWxml), '卡要能点进明细页');

  const mineJs = stripComments(read('pages/mine/mine.js'));
  ok(/cumulativeTotals/.test(mineJs), '★ mine.js 要调 cumulativeTotals（否则卡上是死数）');

  // 主数字按用户拍板用 A
  const ledgerWxml = stripWxml(read('pages/ledger/ledger.wxml'));
  ok(/累计投入/.test(ledgerWxml), '★ 明细页要按拍板把 A（累计投入）作为主数字文案');
  ok(/累计已耗|已耗成本/.test(ledgerWxml), '★ B 也要在页面上（用户要求两个口径都显示）');
});
