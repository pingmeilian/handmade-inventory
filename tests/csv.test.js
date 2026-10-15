// tests/csv.test.js —— 导出功能特征测试（重点：红冲在导出中可辨识）
const { test, group, ok, equal, near } = require('./harness.js');
const F = require('./fixtures.js');

const store = F.store;
const util = F.util;
const csv = require('../utils/csv.js');

group('CSV · 通用');

test('buildCSV 带 BOM 且单元格可转义', () => {
  const out = csv.buildCSV(['名称', '备注'], [['棉布, 白色', '含"引号"']]);
  ok(out.charCodeAt(0) === 0xfeff, '应以 BOM 开头，保证 Excel 中文不乱码');
  ok(out.indexOf('"棉布, 白色"') >= 0, '含逗号的单元格应加引号');
  ok(out.indexOf('"含""引号"""') >= 0, '内部引号应双写转义');
});

test('buildCSV 用 CRLF 分行（Excel 兼容）', () => {
  const out = csv.buildCSV(['a'], [['1'], ['2']]);
  equal(out.indexOf('\r\n') > 0, true);
});

group('CSV · 流水导出');

test('导出流水包含表头与全部记录', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  store.outbound(m.id, 2);

  const out = csv.exportFlows();
  ok(out.indexOf('时间,手作空间,物料,单位,类型,变动量,结余,来源,关联成品,备注') >= 0,
    '表头应存在（2026-09-27 V72：去掉重复的「日期」列、补上「单位」列；改表头就会红）');
  equal(out.trim().split('\r\n').length, 3, '表头 + 2 条流水');
});

test('⭐ 红冲后导出：原流水标注「已冲销」，红冲行来源为「冲销」', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  const original = store.getFlows()[0];
  store.undoFlow(original.id);

  const out = csv.exportFlows();
  ok(out.indexOf('[已冲销]') >= 0, '被冲销的原流水应在备注中标注');
  ok(out.indexOf('冲销') >= 0, '红冲行的来源应显示为「冲销」');
  ok(out.indexOf('reversal') < 0, '不应出现未翻译的英文来源值');
  equal(out.trim().split('\r\n').length, 3, '表头 + 原流水 + 红冲行，两笔都在（审计链完整）');
});

test('⭐ 导出中不出现任何未映射的英文来源（destroy / stocktake 已一并修复）', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);
  store.outbound(m.id, 2);
  store.undoFlow(store.getFlows()[0].id);

  const out = csv.exportFlows();
  ['manual', 'reversal', 'destroy', 'stocktake', 'cut', 'sale', 'commission'].forEach((k) => {
    ok(out.indexOf(k) < 0, '不应出现英文来源键名：' + k);
  });
});

group('CSV · 物料与成品导出');

test('物料导出含关键列', () => {
  F.reset();
  F.seedMaterials([F.simpleMaterial({ quantity: 3, unitPrice: 7 })]);
  const out = csv.exportMaterials();
  ok(out.indexOf('名称') >= 0 && out.indexOf('当前库存') >= 0);
});

test('成品导出可正常生成', () => {
  F.reset();
  F.seedProducts([F.product({ name: '测试布包' })]);
  const out = csv.exportProducts();
  ok(out.indexOf('测试布包') >= 0);
});

group('CSV · 成品出入库导出（V70）');

test('成品出入库表有固定表头；无数据时只有表头', () => {
  F.reset();
  const out = csv.exportProductFlows();
  const lines = out.replace(/^\ufeff/, '').split('\r\n').filter(Boolean);
  equal(lines.length, 1, '无数据时应只有表头一行（不能凭空造行）');
  equal(lines[0], '日期,手作空间,成品,类型,数量,单价,金额,利润,买家');
});

test('物料出入库表补了「关联成品」列（追溯的答案就在这一列）', () => {
  // flows.relatedProductId 一直记着「这笔料是为哪个成品扣的」，但导出时没露出来。
  // 用户要的全链路追溯，在导出侧就靠这一列。
  F.reset();
  const out = csv.exportFlows();
  const head = out.replace(/^\ufeff/, '').split('\r\n')[0];
  ok(head.indexOf('关联成品') >= 0, '应含「关联成品」列 —— 它回答「这笔料用在哪款成品」');
});

// ===============================================================
// 2026-09-27（V72）用户对导出做的一轮微调，逐条对应：
//   ① 「物料出入库怎么有两个时间」        → 两列写的是同一个值，合并成一列（带时分）
//   ② 「加个单位」                        → 补「单位」列
//   ③ 「为什么有的关联成品是空着的」      → 非成品扣料本就为空；成品被删要显式提示
//   ④ 「排单交付中间为什么是一堆乱码」    → 备注写了内部 id（c_xxx），改写客户名 + 来源改「排单履约」
//   ⑤ 「成品出入库再加一个利润」          → 补「利润」列
//   ⑥ 「成品表在库的商品和样品分成两列」  → 一列拆两列
//   ⑦ 面积单位按临界值自动切换            → 见 util.test.js；导出侧同步
// ===============================================================
group('CSV · 物料出入库 · 时间只留一列 + 单位（V72）');

test('★ 不再有两个时间：时间/日期 只保留一列，且带上时分', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);

  const raw = csv.exportFlows().replace(/^\ufeff/, '');
  const cols = raw.split('\r\n')[0].split(',');
  const timeCols = cols.filter((c) => c.indexOf('时间') >= 0 || c.indexOf('日期') >= 0);
  equal(timeCols.length, 1,
    '时间/日期 只能有一列 —— 之前两列写的是同一个值（流水日期就是写入当天），纯重复');

  const first = raw.split('\r\n')[1].split(',')[0];
  ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(first),
    '时间应精确到分，实际「' + first + '」—— 否则同一秒录入的多笔流水没法排序');
});

test('★ 补了「单位」列：数量不再是光秃秃的数字', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0, unit: '卷' });
  F.seedMaterials([m]);
  store.inbound(m.id, 10, 100);

  const rows = csv.exportFlows().replace(/^\ufeff/, '').split('\r\n');
  const cols = rows[0].split(',');
  const i = cols.indexOf('单位');
  ok(i >= 0, '应有「单位」列');
  equal(rows[1].split(',')[i], '卷', '应取物料自己的单位');
});

test('★ 面料面积流水按临界值自动换算，且同一行「变动量/结余」同单位（才可比）', () => {
  F.reset();
  const f = F.fabricMaterial({ pieces: [[200, 100]] });   // 200×100 = 20000cm² = 2m²
  F.seedMaterials([f]);
  store.outbound(f.id, 12000);                            // 出 12000cm²

  const rows = csv.exportFlows().replace(/^\ufeff/, '').split('\r\n');
  const cols = rows[0].split(',');
  const row = rows[1].split(',');
  equal(row[cols.indexOf('单位')], 'm²', '12000cm² 已超过临界值，应换成 m²');
  equal(row[cols.indexOf('变动量')], '1.2', '12000cm² → 1.2');
  equal(row[cols.indexOf('结余')], '0.8', '结余跟变动量同一单位，否则一行里两个口径没法比');
});

test('面积流水未过临界值时仍用 cm²（小碎料换 m² 会变成 0.00xx，更难看）', () => {
  F.reset();
  const f = F.fabricMaterial({ pieces: [[100, 80]] });    // 8000cm²
  F.seedMaterials([f]);
  store.outbound(f.id, 50);                              // 出 50cm²（< 0.01m² 的临界值）

  const cols = csv.exportFlows().replace(/^\ufeff/, '').split('\r\n')[0].split(',');
  const row = csv.exportFlows().replace(/^\ufeff/, '').split('\r\n')[1].split(',');
  equal(row[cols.indexOf('单位')], 'cm²');
  equal(row[cols.indexOf('变动量')], '50');
});

group('CSV · 关联成品 / 排单交付文案（V72）');

test('★ 关联成品：有则填成品名；成品已删除显式提示；非成品扣料留空（不是漏记）', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  const p = F.product({ name: '测试布包' });
  F.seedMaterials([m]); F.seedProducts([p]);

  const base = {
    materialId: m.id, materialName: m.name, categoryId: 'bc_default',
    type: 'out', qty: 1, balance: 9, source: 'cut'
  };
  F.seedFlows([
    Object.assign({}, base, { id: 'f_3', remark: '成品扣料', relatedProductId: p.id, createdAt: 3000, date: '2026-01-03' }),
    Object.assign({}, base, { id: 'f_2', remark: '成品扣料', relatedProductId: 'p_gone', createdAt: 2000, date: '2026-01-02' }),
    Object.assign({}, base, { id: 'f_1', remark: '入库', type: 'in', createdAt: 1000, date: '2026-01-01' })
  ]);

  const rows = csv.exportFlows().replace(/^\ufeff/, '').split('\r\n');
  const i = rows[0].split(',').indexOf('关联成品');
  ok(i >= 0, '应有「关联成品」列');
  equal(rows[1].split(',')[i], '测试布包', '有成品就填名字 —— 这就是「这块料用在哪」的答案');
  ok(rows[2].split(',')[i].indexOf('已删除') >= 0,
    '成品被删了要写出来，不能静默留空 —— 否则用户以为「漏记了」');
  equal(rows[3].split(',')[i], '',
    '入库/盘点这类本来就没有关联成品，留空是正常的（不是丢失数据）');
});

test('★ 排单交付：来源显示「排单履约」，备注写客户名而不是内部 id', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 100, unitPrice: 1 });
  const p = F.product({ name: '测试布包', bom: [{ materialId: m.id, usage: 2 }] });
  F.seedMaterials([m]); F.seedProducts([p]);
  const c = store.saveCommission({ productId: p.id, qty: 5, client: '王小姐', dueDate: util.today() });
  store.assignCommission(c.id, 5);

  const out = csv.exportFlows();
  ok(out.indexOf('排单履约') >= 0,
    '来源应为「排单履约」—— 这个标签早就定义好了，只是从来没人写进去过（一直错标成「成品裁剪」）');
  ok(out.indexOf('排单#') < 0, '备注不该写「排单#c_xxxx」这种内部 id —— 用户看到的就是一串乱码');
  ok(out.indexOf(c.id) < 0, '内部 id 不得出现在导出里');
  ok(out.indexOf('王小姐') >= 0, '备注应写客户名，人才看得懂');
});

test('排单没填客户时，备注给出「未记录客户」而不是空白或 undefined', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 100, unitPrice: 1 });
  const p = F.product({ name: '测试布包', bom: [{ materialId: m.id, usage: 2 }] });
  F.seedMaterials([m]); F.seedProducts([p]);
  const c = store.saveCommission({ productId: p.id, qty: 5, dueDate: util.today() });
  store.assignCommission(c.id, 5);

  const out = csv.exportFlows();
  ok(out.indexOf('undefined') < 0, '不能出现 undefined');
  ok(out.indexOf('未记录客户') >= 0, '没填客户要有可读的兜底文案');
});

group('CSV · 成品出入库 · 利润列（V72）');

test('★ 销售行有利润 = 数量 ×（售价 − 当时单件成本）', () => {
  F.reset();
  const p = F.product({
    name: '测试布包', sellableStock: 2, price: 40,
    productions: [{ id: 'pr1', qty: 2, cost: 30, unitCost: 15, date: '2026-01-01' }]
  });
  F.seedProducts([p]);
  store.sellProduct(p.id, 2, 40, '2026-01-05', '王小姐');

  const lines = csv.exportProductFlows().replace(/^\ufeff/, '').split('\r\n');
  const i = lines[0].split(',').indexOf('利润');
  ok(i >= 0, '成品出入库应有「利润」列');
  const sale = lines.find((l) => l.indexOf('销售') >= 0).split(',');
  equal(sale[i], '50', '2 件 × (40 − 15) = 50');
});

test('生产行没有利润可言 → 留空，而不是填 0', () => {
  F.reset();
  const p = F.product({
    name: '测试布包', productions: [{ id: 'pr1', qty: 2, cost: 30, unitCost: 15, date: '2026-01-01' }]
  });
  F.seedProducts([p]);

  const lines = csv.exportProductFlows().replace(/^\ufeff/, '').split('\r\n');
  const i = lines[0].split(',').indexOf('利润');
  const prod = lines.find((l) => l.indexOf('生产') >= 0).split(',');
  equal(prod[i], '', '生产只是做出来，还没卖 —— 填 0 会被误读成「这批白干」');
});

test('老数据没有成本快照 → 利润留空，不能算成「售价全赚」', () => {
  F.reset();
  const p = F.product({
    name: '测试布包', sellableStock: 1,
    sales: [{ id: 'ps1', qty: 1, price: 40, date: '2026-01-05' }]   // 无 costSnapshot
  });
  F.seedProducts([p]);

  const lines = csv.exportProductFlows().replace(/^\ufeff/, '').split('\r\n');
  const i = lines[0].split(',').indexOf('利润');
  const sale = lines.find((l) => l.indexOf('销售') >= 0).split(',');
  equal(sale[i], '', '没成本就别硬算利润 —— 算出「40」比留空更糟');
});

group('CSV · 成品表 · 在库拆两列 / 物料表面积自适应（V72）');

test('★ 成品表：在库拆成「商品在库」「样品在库」两列', () => {
  F.reset();
  F.seedProducts([F.product({ name: '测试布包', sellableStock: 3, sampleStock: 1 })]);

  const lines = csv.exportProducts().replace(/^\ufeff/, '').split('\r\n');
  const cols = lines[0].split(',');
  const iSell = cols.indexOf('商品在库'), iSample = cols.indexOf('样品在库');
  ok(iSell >= 0 && iSample >= 0, '应拆成两列（合成一列时 Excel 里没法按商品/样品分别筛选）');
  ok(cols.indexOf('在库(商品/样品)') < 0, '旧的一列写法应消失');
  equal(lines[1].split(',')[iSell], '3');
  equal(lines[1].split(',')[iSample], '1');
});

test('★ 物料表：面料总面积按临界值自动选单位，不再是 38500 这种大数', () => {
  F.reset();
  F.seedMaterials([
    F.fabricMaterial({ name: '大布', pieces: [[200, 100]] }),   // 20000cm²
    F.fabricMaterial({ name: '中布', pieces: [[20, 15]] }),     // 300cm²
    F.fabricMaterial({ name: '碎布', pieces: [[5, 8]] }),       // 40cm²
    F.simpleMaterial({ name: '纽扣', quantity: 5, unitPrice: 1 })
  ]);

  const lines = csv.exportMaterials().replace(/^\ufeff/, '').split('\r\n');
  const cols = lines[0].split(',');
  const i = cols.indexOf('面料总面积');
  ok(i >= 0, '表头应为「面料总面积」—— 单位交给数值自己决定，不再写死 cm²');
  ok(lines[1].split(',')[i] === '2 m²', '大布 20000cm² → 2 m²，实际 ' + lines[1].split(',')[i]);
  ok(lines[2].split(',')[i] === '0.03 m²', '中布 300cm² → 0.03 m²（已过 0.01m² 临界值），实际 ' + lines[2].split(',')[i]);
  ok(lines[3].split(',')[i] === '40 cm²', '碎布 40cm² 保持 cm²（换 m² 会变成 0.004，更难读），实际 ' + lines[3].split(',')[i]);
  equal(lines[4].split(',')[i], '', '非面料不该有面积值');
});
