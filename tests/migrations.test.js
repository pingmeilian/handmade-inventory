// tests/migrations.test.js —— Day 5 任务 5.1/5.2
// 5.1：getMaterials 把迁移检查移出热路径（启动时 runMigrations 一次搞定）
// 5.2：11 个迁移收拢进 services/migrations.js，加 schema 版本门（已是最新版本 → 直接短路）
const { test, group, ok, equal } = require('./harness.js');
const stub = require('./wx-stub.js');
const storage = require('../services/storage.js');
const { KEYS } = require('../services/keys.js');
const store = require('../utils/store.js');
const migrations = require('../services/migrations.js');

group('任务 5.1 · getMaterials 热路径');

test('调用 getMaterials 不再设置迁移标记（每次调用零迁移开销）', () => {
  stub.resetStorage();
  store.ensureSeed();
  store.getMaterials();
  store.getMaterials();
  equal(storage.get(KEYS.MIGRATED_V1, false), false, 'MIGRATED_V1 不应被 getMaterials 触发');
  equal(storage.get(KEYS.MIGRATED_V2, false), false, 'MIGRATED_V2 不应被 getMaterials 触发');
});

test('迁移仍在启动时执行：runMigrations 后标记齐全、旧结构数据被修正', () => {
  stub.resetStorage();
  store.ensureSeed();
  storage.set(KEYS.MATERIALS, [
    { id: 'm_old', name: '老棉布', isFabric: true, price: 10, quantity: 2, attrs: { '颜色': '红' } }
  ]);
  store.runMigrations();
  equal(storage.get(KEYS.MIGRATED_V1, false), true);
  const m = store.getMaterial('m_old');
  ok(Array.isArray(m.photos), 'photos 已补齐');
  ok(m.attrGroups && m.attrGroups.length === 1, '平铺 attrs 已转 attrGroups');
  ok(m.totalValue != null, 'totalValue 已按旧模型推算（10 × 2）');
});

group('任务 5.2 · 迁移收拢 + schema 版本门');

test('services/migrations.js 存在：SCHEMA_VERSION 为数字，runAll 为函数', () => {
  ok(typeof migrations.SCHEMA_VERSION === 'number' && migrations.SCHEMA_VERSION > 0);
  ok(typeof migrations.runAll === 'function');
});

test('版本门：已是最新版本 → 短路，单步迁移都不执行', () => {
  stub.resetStorage();
  store.ensureSeed();
  storage.set(KEYS.SCHEMA_VERSION, migrations.SCHEMA_VERSION);
  storage.set(KEYS.MIGRATED_V1, false); // 故意让单步守卫处于「未迁移」态
  storage.set(KEYS.MATERIALS, [{ id: 'm_old2', name: '旧料', attrs: { '颜色': '蓝' } }]);
  store.runMigrations();
  equal(storage.get(KEYS.MIGRATED_V1, false), false, '版本门短路，未执行任何单步迁移');
  equal(storage.get(KEYS.MATERIALS, [])[0].attrGroups, undefined, '数据未被改动');
});

test('版本门：版本落后 → 全量迁移，并写入最新版本号', () => {
  stub.resetStorage();
  store.ensureSeed();
  storage.set(KEYS.MATERIALS, [{ id: 'm_old3', name: '旧料', attrs: { '颜色': '蓝' } }]);
  store.runMigrations();
  equal(storage.get(KEYS.SCHEMA_VERSION, 0), migrations.SCHEMA_VERSION, '版本号已落盘');
  ok(storage.get(KEYS.MATERIALS, [])[0].attrGroups.length === 1, '旧数据已被迁移');
});

test('幂等：连跑两次，数据分毫不变', () => {
  stub.resetStorage();
  store.ensureSeed();
  storage.set(KEYS.MATERIALS, [{ id: 'x', name: 'x', attrs: { '颜色': '蓝' } }]);
  store.runMigrations();
  const a = JSON.stringify(storage.get(KEYS.MATERIALS, []));
  store.runMigrations();
  const b = JSON.stringify(storage.get(KEYS.MATERIALS, []));
  equal(a, b);
});

test('校准迁移仍可用：账面与流水不一致时补「期初校准」流水', () => {
  stub.resetStorage();
  store.ensureSeed();
  // 有入库流水的物料
  storage.set(KEYS.MATERIALS, [
    { id: 'm_cal', name: '校准料', categoryId: 'bc_default', quantity: 10, totalValue: 9999, photos: [], keywords: '', attrGroups: [] }
  ]);
  storage.set(KEYS.FLOWS, [
    { id: 'f_cal', categoryId: 'bc_default', materialId: 'm_cal', materialName: '校准料', type: 'in', qty: 10, unitCost: 0, totalPrice: 300, balance: 10, source: 'inbound', date: '2026-01-01', createdAt: 1 }
  ]);
  store.runMigrations();
  const flows = storage.get(KEYS.FLOWS, []);
  const calib = flows.filter((f) => f.source === 'calibration');
  ok(calib.length === 1, '应补一条期初校准流水，实际 ' + calib.length);
  ok(Math.abs(calib[0].totalPrice - 9699) < 0.01, '校准金额 = |9999 - 300|');
});

// ===============================================================
// 2026-09-27（V73）迁移：老流水备注订正
//
// 背景：V72 之前，排单交付的流水备注写的是 '排单#' + c.id（内部随机串 cm_k3j9f2），
// 用户在导出/页面上看到的就是一串乱码。V72 只修了**写入侧**（新记录），
// 设备上**已有的老记录仍是脏的** —— 用户复看时反馈"中间还是乱码"。
// 处置：迁移时反查排单拿客户名重写备注，并把来源从 'manual'/'cut' 订正为 'commission'。
// ===============================================================
group('迁移 · 老流水备注订正（排单交付乱码）');

// 模拟真实升级路径：先跑一次迁移（落定版本与各步标记），再塞进"旧代码写的"流水，
// 然后把版本退回 1 —— 老设备就是这个状态，下次启动只触发新增的那一步。
function upgradeWithLegacyFlow(legacyRemarkOf, src, opts) {
  const o = opts || {};
  stub.resetStorage();
  store.ensureSeed();
  store.runMigrations();                      // 落定 MIGRATED_* 与 SCHEMA_VERSION

  let cid = 'cm_already_gone';
  if (!o.commissionGone) {
    const c = store.saveCommission({
      productId: 'p_x', qty: 5, dueDate: '2026-01-01',
      client: o.client === undefined ? '王小姐' : o.client
    });
    cid = c.id;
  }

  const flows = [
    { id: 'f_old', categoryId: 'bc_default', materialId: 'm_x', materialName: '测试布',
      type: 'out', qty: 1, balance: 9, remark: legacyRemarkOf(cid), source: src,
      createdAt: 1, date: '2026-01-02' }
  ];
  (o.extraFlows || []).forEach((f) => flows.push(f));
  storage.set(KEYS.FLOWS, flows);
  // ⚠️ 必须同时把"版本 + 本步守卫"都退回去：真实的老设备上，这一步**从来没跑过**
  //    （版本是 1，且 MIGRATED_FLOW_REMARK 这个键根本不存在）。
  //    只退版本不退守卫的话，上面那次 runMigrations 已经把这个步骤"跑过了"，
  //    第二次进来会被守卫挡住 —— 测试就成了假的（踩过一次）。
  storage.set(KEYS.SCHEMA_VERSION, 1);
  storage.set(KEYS.MIGRATED_FLOW_REMARK, false);
  store.runMigrations();

  return { cid: cid, flows: storage.get(KEYS.FLOWS, []) };
}

test('★ 老的「排单#<内部id> 交付」→ 客户名，来源改「排单履约」', () => {
  const r = upgradeWithLegacyFlow((id) => '排单#' + id + ' 交付', 'manual');
  const f = r.flows[0];
  equal(f.remark, '排单交付 · 王小姐', '备注应订正成客户名');
  ok(f.remark.indexOf(r.cid) < 0, '备注里不得再出现内部 id —— 用户看到的就是乱码');
  equal(f.source, 'commission',
    '来源应改回「排单履约」：否则导出仍显示「手动 / 成品裁剪」，与事实不符；' +
    '而且 source=manual 会让物料页误给一个「撤销」按钮（撤销交付该走排单侧，直接冲流水会让排单余量错乱）');
});

test('撤销交付返还 → 「排单交付撤销 · 客户」', () => {
  const r = upgradeWithLegacyFlow((id) => '排单#' + id + ' 撤销交付返还', 'manual');
  equal(r.flows[0].remark, '排单交付撤销 · 王小姐');
});

test('排单已被删除 → 「未记录客户」（不回退成 id，也不留空）', () => {
  const r = upgradeWithLegacyFlow((id) => '排单#' + id + ' 交付', 'manual', { commissionGone: true });
  equal(r.flows[0].remark, '排单交付 · 未记录客户');
});

test('排单没填客户 → 「未记录客户」', () => {
  const r = upgradeWithLegacyFlow((id) => '排单#' + id + ' 交付', 'manual', { client: '' });
  equal(r.flows[0].remark, '排单交付 · 未记录客户');
});

test('幂等：再跑一次迁移不会重复改写（客户名不会被追加两遍）', () => {
  const r = upgradeWithLegacyFlow((id) => '排单#' + id + ' 交付', 'manual');
  const after = r.flows[0].remark;
  // 连守卫也清掉，逼这一步**真跑一遍**（否则"没变"只是因为被守卫拦住，证明不了幂等）
  storage.set(KEYS.SCHEMA_VERSION, 1);
  storage.set(KEYS.MIGRATED_FLOW_REMARK, false);
  store.runMigrations();
  equal(storage.get(KEYS.FLOWS, [])[0].remark, after,
    '第二次跑不得再改一次 —— 重写后已不匹配「排单#」写法，天然可重跑');
});

test('不误伤：非「排单#」开头的备注（手工出库 / 成品扣料 / 冲销）原样保留', () => {
  const keep = [
    { id: 'f_a', remark: '成品《测试布包》BOM 扣减', source: 'cut' },
    { id: 'f_b', remark: '领料：排单#cm_x 交付', source: 'manual' },   // id 在中间，不是系统写法
    { id: 'f_c', remark: '冲销：排单#cm_x 交付', source: 'reversal' },
    { id: 'f_d', remark: '', source: 'manual' }
  ].map((x) => Object.assign({
    categoryId: 'bc_default', materialId: 'm_x', materialName: '测试布',
    type: 'out', qty: 1, balance: 9, createdAt: 1, date: '2026-01-02'
  }, x));

  const r = upgradeWithLegacyFlow((id) => '排单#' + id + ' 交付', 'manual', { extraFlows: keep });
  keep.forEach((orig) => {
    const now = r.flows.find((f) => f.id === orig.id);
    equal(now.remark, orig.remark, orig.id + ' 的备注被误改了');
    equal(now.source, orig.source, orig.id + ' 的来源被误改了');
  });
});

group('V145 · 材质预设：出厂值 + 给老数据补齐');

// 本地小助手（本文件原先没有）：比对数组内容
function sameList(a, b, msg) { equal((a || []).join('、'), (b || []).join('、'), msg); }

test('★ V145 出厂预设：三个新增项都在，且涤纶紧跟纯棉、另两项落末尾', () => {
  const presets = store.getAttrPresets('材质');
  ['双层纱', '纱卡', '涤纶'].forEach((n) => {
    ok(presets.indexOf(n) >= 0, '出厂「材质」里要有「' + n + '」');
  });
  equal(presets[presets.indexOf('纯棉') + 1], '涤纶', '★ 涤纶紧跟在纯棉之后（用户明确要求）');
  sameList(presets.slice(-2), ['双层纱', '纱卡'], '双层纱 / 纱卡 追加在末尾（未指定位置 ⇒ 少动既有顺序）');
  equal(presets.filter((n) => n === '涤纶').length, 1, '不能重复');
});

test('★★ V145 迁移：给**已有**的「材质」维度补三项（只改出厂值对老用户不生效）', () => {
  stub.resetStorage();
  store.ensureSeed();
  // 模拟老用户的数据：材质还是旧的五项，别的维度也有内容
  storage.set(KEYS.MATERIAL_CATEGORIES, [
    { id: 'mc_fabric', name: '面料', categoryId: 'bc_default', isFabric: true, attrDimensions: [
      { name: '颜色', options: ['粉色', '蓝色'] },
      { name: '材质', options: ['纯棉', '粗布', '棉麻'] }
    ] },
    { id: 'mc_label', name: '布标', categoryId: 'bc_default', attrDimensions: [
      { name: '颜色', options: ['黑色'] }
    ] }
  ]);
  store.runMigrations();

  const cats = store.getListAll('materialCategory');
  const fabric = cats.filter((c) => c.id === 'mc_fabric')[0];
  const mat = fabric.attrDimensions.filter((d) => d.name === '材质')[0];
  sameList(mat.options, ['纯棉', '涤纶', '粗布', '棉麻', '双层纱', '纱卡'],
    '★ 涤纶插在纯棉后、双层纱/纱卡追加末尾，**用户已有项的内容与顺序一个字不动**');
  const color = fabric.attrDimensions.filter((d) => d.name === '颜色')[0];
  sameList(color.options, ['粉色', '蓝色'], '别的维度不许碰');
  const label = cats.filter((c) => c.id === 'mc_label')[0];
  sameList(label.attrDimensions[0].options, ['黑色'], '没有「材质」维度的大类不许碰');
});

test('★ V145 迁移：只补一次 —— 用户之后删掉的不会再被"补"回来', () => {
  stub.resetStorage();
  store.ensureSeed();
  storage.set(KEYS.MATERIAL_CATEGORIES, [
    { id: 'mc_fabric', name: '面料', categoryId: 'bc_default', isFabric: true, attrDimensions: [
      { name: '材质', options: ['纯棉', '粗布'] }
    ] }
  ]);
  store.runMigrations();
  let mat = store.getListAll('materialCategory')[0].attrDimensions[0];
  ok(mat.options.indexOf('纱卡') >= 0, '第一次跑：补上了');

  // 用户后来自己把「纱卡」删了；把版本号退回 0 逼整条迁移链重跑
  storage.set(KEYS.MATERIAL_CATEGORIES, [
    { id: 'mc_fabric', name: '面料', categoryId: 'bc_default', isFabric: true, attrDimensions: [
      { name: '材质', options: ['纯棉', '涤纶', '粗布', '双层纱'] }
    ] }
  ]);
  storage.set(KEYS.SCHEMA_VERSION, 0);
  store.runMigrations();
  mat = store.getListAll('materialCategory')[0].attrDimensions[0];
  equal(mat.options.indexOf('纱卡'), -1,
    '★ 幂等标记生效：用户删掉的选项不会"复活"（改用户数据只许补一次）');
});

test('★ V145 收口：材质预设只有一份（页面不许再抄一张表）', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  // ⚠️ 查源码锚点前先剥掉注释 —— 否则会被"注释里提到了这件事"骗到（V143 踩过）
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .filter((l) => l.trim().indexOf('//') !== 0).join('\n');

  const edit = stripComments(read('pages/materials/edit.js'));
  ok(edit.indexOf("'材质'") < 0,
    '★ 编辑页不许再自带一份材质预设（改一处漏一处，会出现"预设页有、编辑页没有"）');
  ok(edit.indexOf('store.getAttrPresets(') >= 0, '维度选项为空时要从 store 唯一源兜底');
});

test('★★ V145 迁移纪律绊线：加/删迁移步骤必须同时升 SCHEMA_VERSION', () => {
  // 为什么要有这条：migrations.js 的纪律写着"新增迁移步骤时 SCHEMA_VERSION 必须 +1"，
  // 但在这条之前**没有任何东西在看**。忘了升版本号不会报错 —— 后果是
  // runAll 的版本门直接短路，**老用户那边新迁移永远不跑**，功能静默不生效
  //（V145 这次就差点踩：材质选项补不上，用户会以为"根本没加"）。
  // 这条断言的作用是"绊线"：步骤数或版本号一改就红，逼作者显式确认。
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'services/migrations.js'), 'utf8');
  const at = src.indexOf('const STEPS = [');
  ok(at >= 0, '找不到 STEPS 数组 —— 锚点漂了就更新这条');
  const block = src.slice(at, src.indexOf('];', at));
  const steps = block.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l.indexOf('//') !== 0 && l.indexOf('const STEPS') !== 0)
    .length;

  equal(steps, 15,
    '★ 迁移步骤数变了 ⇒ 请确认 SCHEMA_VERSION 也 +1 了，然后把这行的 15 改成新值');
  equal(migrations.SCHEMA_VERSION, 6,
    '★ SCHEMA_VERSION 变了（或该变没变）⇒ 老用户的版本门会决定新迁移跑不跑，改完记得同步这行');
});
