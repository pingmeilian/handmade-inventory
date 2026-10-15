// tests/geometry-model.test.js —— 布料几何模型（V81 切模型）
//
// 背景（D88~D97，用户三次真机反馈换来的口径）：
//   ① 一块布 = 一个几何整体（入库是矩形；裁过是不规则形状，**仍是一块**）
//   ② 裁剪**永远不拆块** —— 只有「重新入库」或「用户明确要求拆开」才会多出一块
//   ③ 「整布 / 碎布」= **这块布的宽还等不等于幅宽**（不是"裁没裁过"）
//      · 裁掉一角、形状不规则，但宽仍是幅宽 → **整布**（还能横着取整幅宽的长条）
//      · 沿长边裁掉一条 → 宽不再等于幅宽 → **碎布**
//   ④ 面积口径一个字不变（账不能动）；跨分界线的长条必须取得出来
const { test, group, ok, equal, near } = require('./harness.js');
const F = require('./fixtures.js');

const store = F.store;
const sheets = require('../utils/sheets.js');
const storage = require('../services/storage.js');
const { KEYS } = require('../services/keys.js');

// 造数用的是"新装用户"路径（schema 版本直接写最新），迁移会被版本门短路。
// 这一组要验的正是**老用户升级**，所以把版本退回去、清掉幂等标记，逼迁移真跑一遍。
function asLegacy() {
  storage.set(KEYS.SCHEMA_VERSION, 2);
  storage.set(KEYS.MIGRATED_FABRIC_SHEETS, false);
}

// 入库一整块布（走真实入库路径：写 in 流水 → 库存总值由流水派生，不能凭空塞数据）
function inboundSheet(len, wid, total, fw) {
  const f = F.fabricMaterial({ name: '棉布', pieces: [], unitPrice: 0, fabricWidth: fw || 150 });
  F.seedMaterials([f]);
  store.inbound(f.id, 0, { length: len, width: wid, total: total });
  return f.id;
}

group('布料几何模型 · 一块布就是一个几何整体');

test('① 入库一块布 = 一块（带 base，无镂空）', () => {
  F.reset();
  const id = inboundSheet(240, 150, 360);
  const m = store.getMaterial(id);
  equal(store.fabricCount(m), 1, '入库一次 → 一块布');
  const p = (m.pieces || [])[0];
  ok(p.base && Math.abs(p.base.length - 240) < 0.01, '带外框 base（新模型）');
  equal((p.holes || []).length, 0, '刚入库没有镂空');
  near(p.area, 240 * 150, 0.01, '可用面积 = 外框面积（口径与旧模型一致）');
  near(store.fabricArea(m), 36000, 0.01);
});

test('★ ② 裁掉一角后：**还是一块布**（不拆成「整布 + 碎料」两片）', () => {
  F.reset();
  const id = inboundSheet(240, 150, 360);
  const before = store.getMaterial(id);
  const r = store.cutFabric(id, before.pieces[0].id, 38, 83, '裁一件', false, null);

  const m = store.getMaterial(id);
  equal(store.fabricCount(m), 1, '裁剪**不许**改变块数 —— 一块布永远是一块布');
  const p = m.pieces[0];
  equal(p.holes.length, 1, '裁走的部分记成 1 个镂空');
  near(store.fabricArea(m), 240 * 150 - 38 * 83, 0.01, '可用面积 = 外框 − 镂空');
  near(r.consumedArea, 38 * 83, 0.01, '扣掉的还是这块红区的面积');
});

test('★ ③ 跨分界取料：裁掉一角后，230×20 的长条**取得出来**（旧模型是 0）', () => {
  F.reset();
  const id = inboundSheet(240, 150, 360);
  const m0 = store.getMaterial(id);
  store.cutFabric(id, m0.pieces[0].id, 38, 83, '裁一件', false, null);

  const m = store.getMaterial(id);
  // 缺口在 x∈[0,38]、y∈[0,83]；y∈[83,150] 那条横带仍是完整的 240 宽（高 67）
  equal(store.canCutTimes(m, 230, 20), 3,
    '能剪 3 条（那条 240×67 的完整横带里，20 高放得下 3 条）—— 旧模型把布拆成两片，两片都装不下 230 长 ⇒ 0');
  equal(store.canCutTimes(m, 230, 67), 1, '67 高：正好用掉那条完整横带 → 1 条');
});

test('③b 判定没放松：红区压在缺口上就该报不行', () => {
  F.reset();
  const id = inboundSheet(240, 150, 360);
  const m0 = store.getMaterial(id);
  store.cutFabric(id, m0.pieces[0].id, 38, 83, '裁一件', false, null);
  const m = store.getMaterial(id);

  // 缺口在 x∈[0,38]、y∈[0,83]。240×150 的整块布裁掉它之后：
  //   要取 240 宽 × 150 高的料 → 必须覆盖缺口 → 不行
  equal(store.canCutTimes(m, 240, 150), 0, '整块尺寸的料取不出来（缺了一角）');
  equal(store.canCutTimes(m, 240, 100), 0, '240 宽必须用满整个 x 范围 → 也压到缺口');
  // 但 240×67 可以放在 y∈[83,150]
  equal(store.canCutTimes(m, 240, 67), 1, '240×67 放在缺口上方那条完整横带里 → 行');
});

test('④ 全幅宽横截面还在 → 仍算「整布」；沿长边裁窄了 → 才算「碎布」', () => {
  F.reset();
  const id = inboundSheet(240, 150, 360);
  const m0 = store.getMaterial(id);
  equal(store.isPieceOffcut(m0.pieces[0], 150), false, '刚入库 → 整布');

  store.cutFabric(id, m0.pieces[0].id, 38, 83, '裁一角', false, null);
  const m1 = store.getMaterial(id);
  equal(store.isPieceOffcut(m1.pieces[0], 150), false,
    '裁掉一角：形状不规则，但宽仍 = 幅宽 → **仍是整布**（用户 D97 明确）');
});

test('④b 沿长边裁掉一条 → 宽不再等于幅宽 → 碎布', () => {
  F.reset();
  const id = inboundSheet(240, 150, 360);
  const m0 = store.getMaterial(id);
  // 从最上面（y∈[130,150]）挖走一条 240×20（贯通整个长） ⇒ 剩下的宽只有 130
  store.cutFabric(id, m0.pieces[0].id, 240, 20, '裁一条', false, null);
  const m1 = store.getMaterial(id);
  near(store.fabricArea(m1), 240 * 130, 0.01, '面积 = 240×130');
  equal(store.isPieceOffcut(m1.pieces[0], 150), true,
    '宽只剩 130 < 幅宽 150 → 碎布（再也不能横着取整幅宽的长条）');
});

test('⑤ 迁移：老数据里被拆开的「整布 202×150 + 碎料 38×67」还原成**一块带缺口的布**', () => {
  F.reset();
  // 老模型裁掉 38×83 一角后的产物（宽度仍=幅宽的 + 窄的）
  const m = F.fabricMaterial({
    fabricWidth: 150, unitPrice: 0.01,
    pieces: [[202, 150], [38, 67]]
  });
  F.seedMaterials([m]);
  asLegacy();
  store.runMigrations();

  const db = store.getMaterial(m.id);
  equal(store.fabricCount(db), 1, '两片在实物上是一块布 → 迁移后合并成一块');
  near(store.fabricArea(db), 202 * 150 + 38 * 67, 0.01, '★ 面积逐 cm² 一致（迁移动不得账）');
  const p = db.pieces[0];
  equal(p.holes.length, 1, '还原出 1 个镂空（= 当初裁走的那一块）');
  near(p.base.length, 240, 0.01, '外框 = 240');
  near(p.base.width, 150, 0.01, '外框宽 = 幅宽');
  equal(store.isPieceOffcut(p, 150), false, '合并后宽 = 幅宽 → 整布');
  // 迁移的收益：跨那条分界线的长条取得出来了（迁移前是两片，两片都装不下 230 长 ⇒ 0）
  equal(store.canCutTimes(db, 230, 20), 3, '迁移后长条取得出来（3 条）');
});

test('⑤b 迁移不误合：两块各是完整幅宽的布（两次入库）保持两块', () => {
  F.reset();
  const m = F.fabricMaterial({
    fabricWidth: 150, unitPrice: 0.01,
    pieces: [[200, 150], [100, 150]]
  });
  F.seedMaterials([m]);
  asLegacy();
  store.runMigrations();
  const db = store.getMaterial(m.id);
  equal(store.fabricCount(db), 2, '两块宽度都 = 幅宽 ⇒ 各自独立，不许合并');
  near(store.fabricArea(db), 200 * 150 + 100 * 150, 0.01);
});

test('⑤c 迁移幂等：跑两次结果一样（不会把一块布再切成两片）', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[202, 150], [38, 67]] });
  F.seedMaterials([m]);
  asLegacy();
  store.runMigrations();
  const once = JSON.stringify((store.getMaterial(m.id).pieces || []).length);
  store.runMigrations();
  const twice = JSON.stringify((store.getMaterial(m.id).pieces || []).length);
  equal(twice, once, '第二次迁移不得改动');
  near(store.fabricArea(store.getMaterial(m.id)), 202 * 150 + 38 * 67, 0.01);
});

group('布料几何模型 · 账不许动');

test('⑥ 裁剪后加权均价不变（元/cm²），库存总值按面积等比下降', () => {
  F.reset();
  const id = inboundSheet(240, 150, 360);          // 36000cm² → 0.01 元/cm²
  const m0 = store.getMaterial(id);
  near(store.unitCost(m0), 0.01, 1e-9, '初始均价 0.01 元/cm²');

  store.cutFabric(id, m0.pieces[0].id, 38, 83, '裁一件', false, null);
  const m1 = store.getMaterial(id);
  near(store.unitCost(m1), 0.01, 1e-9, '★ 裁剪不改变均价（旧模型同样如此）');
  near(store.stockValue(m1), 36000 - 38 * 83, 0.01, '库存 = 剩余可用面积');
});

test('⑦ 同物料多块布：各块分别算，件数相加（第二块能接上）', () => {
  F.reset();
  const f = F.fabricMaterial({ name: '棉布', pieces: [], unitPrice: 0, fabricWidth: 150 });
  F.seedMaterials([f]);
  store.inbound(f.id, 0, { length: 240, width: 150, total: 360 });   // 布① 240×150 → 放得下 2 件 90×150
  store.inbound(f.id, 0, { length: 120, width: 150, total: 180 });   // 布② 120×150 → 放得下 1 件

  const m = store.getMaterial(f.id);
  equal(store.fabricCount(m), 2, '两次入库 = 两块布');
  equal(store.canCutTimes(m, 90, 150), 3, '布① 2 件 + 布② 1 件 = 3 件（不是只数第一块）');
  equal(store.canCutTimes(m, 130, 150), 1, '130 宽只有布①放得下 1 件（240/130 = 1）');
});

test('⑧ 兼容：直接塞进 storage 的老矩形片（没跑迁移）也能正常读', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[100, 150], [50, 100]] });
  F.seedMaterials([m]);                             // 不走迁移
  const db = store.getMaterial(m.id);
  near(store.fabricArea(db), 100 * 150 + 50 * 100, 0.01, '老数据面积照旧');
  equal(store.fabricCount(db), 2);
  equal(store.isPieceOffcut(db.pieces[0], 150), false, '100×150：宽=幅宽 → 整布');
  equal(store.isPieceOffcut(db.pieces[1], 150), true, '50×100：宽<幅宽 → 碎料');
});

test('⑨ 脏数据不炸：没有 pieces / 空数组 / 破字段', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0, pieces: [] });
  F.seedMaterials([m]);
  const db = store.getMaterial(m.id);
  near(store.fabricArea(db), 0, 0.01);
  equal(store.fabricCount(db), 0);
  equal(store.canCutTimes(db, 100, 100), 0);
  equal(store.isPieceOffcut({}, 150), false, '空对象 → 不判定为碎料（不抛）');
  equal(sheets.freeArea(null), 0);
});


group('布料几何模型 · 页面渲染用的形状描述（V82）');

test('⑩ pieceShape：刚入库的布 → 一个矩形、没有洞', () => {
  F.reset();
  const id = inboundSheet(240, 150, 360);
  const m = store.getMaterial(id);
  const sh = store.pieceShape(m.pieces[0]);
  ok(sh, '老矩形片 / 新 sheet 都要能转出形状');
  near(sh.base.length, 240, 0.01);
  near(sh.base.width, 150, 0.01);
  equal(sh.holes.length, 0, '没裁过 → 没有洞');
  equal(sh.used, false);
  near(sh.area, 36000, 0.01);
});

test('★ ⑪ pieceShape：裁掉一角后 → 外框仍是 240×150，带一个洞（**页面据此画出缺口**）', () => {
  F.reset();
  const id = inboundSheet(240, 150, 360);
  const m0 = store.getMaterial(id);
  store.cutFabric(id, m0.pieces[0].id, 38, 83, '裁一件', false, null);

  const m = store.getMaterial(id);
  const sh = store.pieceShape(m.pieces[0]);
  near(sh.base.length, 240, 0.01, '外框不变 —— 这块布还是 240×150 的');
  near(sh.base.width, 150, 0.01);
  equal(sh.holes.length, 1, '一个洞 = 裁走的那块');
  equal(sh.used, true, '裁过 → 页面可以标「裁过」');
  // 洞的坐标在**左下角**原点（内核约定）；页面用 bottom 定位即可，不必翻转
  near(sh.holes[0].x, 0, 0.01);
  near(sh.holes[0].y, 0, 0.01);
  near(sh.holes[0].length, 38, 0.01);
  near(sh.holes[0].width, 83, 0.01);
  near(sh.area, 240 * 150 - 38 * 83, 0.01, '可用面积 = 外框 − 洞');
});

test('⑫ pieceShape：给的是**原始尺寸**（cm），缩放交给页面；坐标不越出外框', () => {
  F.reset();
  const id = inboundSheet(100, 80, 80);
  const m0 = store.getMaterial(id);
  store.cutFabric(id, m0.pieces[0].id, 30, 20, '裁', false, null);
  const sh = store.pieceShape(store.getMaterial(id).pieces[0]);
  sh.holes.forEach((h) => {
    ok(h.x >= -0.01 && h.y >= -0.01, '洞不能跑到外框外（x/y 非负）');
    ok(h.x + h.length <= sh.base.length + 0.01, '洞不能超出外框右边');
    ok(h.y + h.width <= sh.base.width + 0.01, '洞不能超出外框上边');
  });
});

test('⑬ pieceShape：老矩形片（无 base）也画得出来 —— 直接当一块矩形布', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[100, 100], [40, 30]] });
  F.seedMaterials([m]);
  const db = store.getMaterial(m.id);
  const a = store.pieceShape(db.pieces[0]);
  near(a.base.length, 100, 0.01);
  near(a.base.width, 100, 0.01);
  equal(a.holes.length, 0, '老数据没有洞信息 → 当完整矩形画');
  near(a.area, 10000, 0.01);
});

test('⑭ pieceShape：脏数据返回 null，不抛（页面按"画不出来"处理）', () => {
  equal(store.pieceShape(null), null);
  equal(store.pieceShape(undefined), null);
  equal(store.pieceShape({}), null);
  equal(store.pieceShape({ length: 0, width: 0 }), null);
  equal(store.pieceShape({ length: -5, width: 10 }), null);
});

test('⑮ 页面要用的字段齐全（含给 wx:key 用的稳定序号）', () => {
  F.reset();
  const id = inboundSheet(200, 100, 200);
  const m0 = store.getMaterial(id);
  store.cutFabric(id, m0.pieces[0].id, 20, 30, 'a', false, null);
  store.cutFabric(id, m0.pieces[0].id, 40, 10, 'b', false, null);
  const sh = store.pieceShape(store.getMaterial(id).pieces[0]);
  equal(sh.holes.length, 2, '两次裁剪 → 两个洞');
  equal(typeof sh.base.length, 'number');
  equal(typeof sh.area, 'number');
  equal(typeof sh.used, 'boolean');
  sh.holes.forEach((h) => { equal(typeof h.x, 'number'); equal(typeof h.y, 'number'); });
});

// ---------------------------------------------------------------
// 2026-10-01（V94）。用户真机截图：「剪裁区都红了，还能点用这块料？」
//
// 红 = 这一片超出了布边 / 压在已有缺口上 ⇒ **那一刀根本裁不出来**。
// 真正危险的还不是"能点"，而是点下去之后会发生什么 ——
// `cutFabric` 拿到你摆的 at、发现放不下，会**自己换个位置裁掉**：
//     if (!target) target = sheets.placeNext(sh, rl, rw);
// 流水里记的是**系统挑的位置**（cutAt/target），用户在界面上摆的跟账上裁的不是一个地方，
// 而两块布面积一样、金额一样 —— **账面一点看不出来**。
// 这跟 V87（选了布被顶掉）、V90（改了尺寸被顶掉）是同一类坑，第三次。
// ⇒ 用户给了 at 就必须按它来；放不下就**报错**，把问题还给用户（回界面重新排）。
// 界面那一层已经先拦住了（红了不许确认），这里是**兜底**：任何入口走到这儿都不能静默改位置。
// ---------------------------------------------------------------

group('布料几何模型 · 用户指定的裁剪位置（2026-10-01 V94）');

test('★ ⑯ 用户给了 at 就按它裁（不偏不倚）', () => {
  F.reset();
  const id = inboundSheet(240, 150, 360);
  const pid = store.getMaterial(id).pieces[0].id;

  const r = store.cutFabric(id, pid, 38, 83, '按我摆的裁', false, null, { x: 100, y: 20 });

  const p = store.getMaterial(id).pieces[0];
  equal(p.holes.length, 1, '一刀一个洞');
  near(p.holes[0].x, 100, 0.01, '挖在用户摆的那个位置（不许自己挪）');
  near(p.holes[0].y, 20, 0.01);
  near(r.consumedArea, 38 * 83, 0.01, '扣的还是这一块红区的面积');
});

test('★ ⑰ 用户给的 at 放不下（压在缺口上 / 超出布边）→ 报错，不许自己换个位置裁', () => {
  F.reset();
  const id = inboundSheet(240, 150, 360);
  const pid = store.getMaterial(id).pieces[0].id;
  store.cutFabric(id, pid, 38, 83, '先裁一刀', false, null, { x: 0, y: 0 });   // 左下角留个缺口

  let err = null;
  try { store.cutFabric(id, pid, 20, 20, '压在缺口上', false, null, { x: 5, y: 5 }); }
  catch (e) { err = e; }
  ok(err, '★ 压在缺口上必须报错 —— 静默换个位置裁，账上记的就不是用户摆的地方了');
  equal(err.code, 'FIT');

  const p = store.getMaterial(id).pieces[0];
  equal(p.holes.length, 1, '报错后不许留下第二刀（改动分毫未生效）');
  near(store.fabricArea(store.getMaterial(id)), 240 * 150 - 38 * 83, 0.01, '库存面积也没动');
  equal(store.getFlows().filter(x => x.type === 'out').length, 1, '流水也不许多一笔');

  let err2 = null;
  try { store.cutFabric(id, pid, 20, 20, '出界', false, null, { x: 235, y: 145 }); }
  catch (e) { err2 = e; }
  ok(err2 && err2.code === 'FIT', '超出布边同样要报错');
});

test('⑱ 不给 at（自动裁剪）→ 老口径不变：自己找位置', () => {
  F.reset();
  const id = inboundSheet(240, 150, 360);
  const pid = store.getMaterial(id).pieces[0].id;

  const r = store.cutFabric(id, pid, 38, 83, '自动', false, null);

  near(r.consumedArea, 38 * 83, 0.01, '自动路径照旧能裁（这条是零回归的保证）');
  equal(store.getMaterial(id).pieces[0].holes.length, 1);
});
