// tests/fabric.test.js —— 布料剪裁与物料计量 特征测试（按现行为断言）
const { test, group, ok, equal, near } = require('./harness.js');
const F = require('./fixtures.js');

const store = F.store;

group('面料 · 基本计量');

test('isPieceOffcut：未设幅宽不判定；裸对象（只有 width）按「宽 < 幅宽」退化判定', () => {
  // 口径已于 2026-09-09-29 V81 换新：**看这块布的可用区域宽还等不等于幅宽**（D97）。
  // 下面是"只有 width 的裸对象"的退化路径（老调用方 / 单测用），完整口径见 geometry-model.test.js。
  equal(store.isPieceOffcut({ width: 100 }, 150), true, '100 < 150 → 碎料');
  equal(store.isPieceOffcut({ width: 150 }, 150), false, '等于幅宽 → 整布');
  equal(store.isPieceOffcut({ width: 160 }, 150), false);
  equal(store.isPieceOffcut({ width: 100 }, 0), false, '未设幅宽时不判定');
});

test('fabricArea / fabricCount 只统计在库布片', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[100, 150], [50, 100]] });
  m.pieces.push(F.piece(30, 30, { status: 'out' }));
  F.seedMaterials([m]);

  const db = store.getMaterial(m.id);
  near(store.fabricArea(db), 100 * 150 + 50 * 100, 0.01, '面积为在库布片之和');
  equal(store.fabricCount(db), 2, '已出库布片不计入');
});

test('fabricPieceStats 区分整布与碎料', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[200, 150], [100, 100], [40, 40]] });
  F.seedMaterials([m]);
  const st = store.fabricPieceStats(store.getMaterial(m.id));
  equal(st.whole, 1, '整布 1 片');
  equal(st.offcut, 2, '碎料 2 片');
  equal(st.total, 3);
});

test('stockValue / unitCost：面料按面积，非面料按数量', () => {
  F.reset();
  const fab = F.fabricMaterial({ unitPrice: 0.02, fabricWidth: 150, pieces: [[100, 100]] }); // 面积 10000
  const sim = F.simpleMaterial({ quantity: 50, unitPrice: 3 });
  F.seedMaterials([fab, sim]);

  const f = store.getMaterial(fab.id);
  near(store.stockValue(f), 10000, 0.01);
  near(store.unitCost(f), 0.02, 1e-6, '面料 unitCost = 元/cm²');

  const s = store.getMaterial(sim.id);
  near(store.stockValue(s), 50, 0.01);
  near(store.unitCost(s), 3, 1e-6, '非面料 unitCost = 元/单位');
});

test('unitCost 在库存为 0 时返回 0（不做除零）', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 5 });
  F.seedMaterials([m]);
  equal(store.unitCost(store.getMaterial(m.id)), 0);
});

test('isLowStock 以阈值判定，库存为零算低库存', () => {
  F.reset();
  const low = F.simpleMaterial({ quantity: 1, unitPrice: 1 });
  const hi = F.simpleMaterial({ quantity: 100, unitPrice: 1 });
  F.seedMaterials([low, hi]);
  equal(store.isLowStock(store.getMaterial(low.id)), true);
  equal(store.isLowStock(store.getMaterial(hi.id)), false);
});

group('面料 · canCutTimes 裁剪次数模拟');

test('整布沿长度连续下料', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[200, 150]] });
  F.seedMaterials([m]);
  const db = store.getMaterial(m.id);
  equal(store.canCutTimes(db, 100, 150), 2, '200 长切 100×2');
});

test('允许旋转 90° 才能放下的情形', () => {
  F.reset();
  // 布片 120(长) × 200(宽)：红区 180×100 只能旋转后放下
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[120, 200]] });
  F.seedMaterials([m]);
  const db = store.getMaterial(m.id);
  equal(store.canCutTimes(db, 180, 100), 1);
});

test('不拼接：两块短料拼不出一个长件', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[50, 150], [50, 150]] });
  F.seedMaterials([m]);
  const db = store.getMaterial(m.id);
  equal(store.canCutTimes(db, 100, 100), 0, '两块 50 长不能拼成 100 长');
});

test('碎料与整布混合时仍能算出总次数', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[100, 150], [100, 100]] });
  F.seedMaterials([m]);
  const db = store.getMaterial(m.id);
  equal(store.canCutTimes(db, 90, 90), 2);
});

test('空布片集合返回 0', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [] });
  F.seedMaterials([m]);
  equal(store.canCutTimes(store.getMaterial(m.id), 50, 50), 0);
});

group('面料 · listCutSchemes 方案生成与排序');

test('方案数量：每块可容纳的布片 × 可放置方向', () => {
  F.reset();
  // 整布(100×150) + 碎料(80×80)，红区 50×60（矩形）→ 两种方向都能放，2 块 × 2 方向 = 4
  // 注：重复方案去重看的是**红区**正方形，不是源片正方形；这里红区是矩形的，两个都正常生成 2 个
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[100, 150], [80, 80]] });
  F.seedMaterials([m]);
  const schemes = store.listCutSchemes(m.id, 50, 60);
  equal(schemes.length, 4, '2 块布片 × 2 种方向（红区矩形 → 旋转有效）');
});

test('排序规则：碎料优先 → 面积小者优先 → 剩余整布大者优先', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[100, 150], [80, 80]] });
  F.seedMaterials([m]);
  const schemes = store.listCutSchemes(m.id, 50, 60);

  equal(schemes[0].sourceType, 'offcut', '首位必须是碎料');
  equal(schemes[1].sourceType, 'offcut', '第二位也是碎料');
  equal(schemes[2].sourceType, 'whole', '整布排在碎料之后');
  equal(schemes[3].sourceType, 'whole');
  ok(schemes[0].rl <= schemes[1].rl, '同档内 rl 升序（剩余整布更大）');
});

test('恰好只有首个方案被标记为推荐', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[100, 150], [80, 80]] });
  F.seedMaterials([m]);
  const schemes = store.listCutSchemes(m.id, 50, 60);
  equal(schemes.filter((s) => s.isRecommended).length, 1, '推荐方案有且只有一个');
  equal(schemes[0].isRecommended, true);
});

test('余料计算：切完仍是**一块布**（不再拆成「整布 + 碎料」两片，V81）', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[100, 150]] });
  F.seedMaterials([m]);
  const s = store.listCutSchemes(m.id, 50, 60).find((x) => x.rotate === false);

  // 2026-09-29 V81：布料改成「外框 − 镂空」，一块布裁过之后**还在一块上**（用户 D96）——
  // 方案里给出"挖在哪"（at）与"挖完还剩多少可用"（remainArea），不再给出两块余料的尺寸。
  ok(s.at, '给出挖在哪（页面画图用）');
  near(s.at.x, 0, 0.01);
  near(s.at.y, 0, 0.01);
  near(s.remainArea, 100 * 150 - 50 * 60, 0.01, '挖完剩余可用 = 原面积 − 红区');
  equal(s.source.length, 100, '源仍是这一整块布');
  equal(s.source.width, 150);
});

test('放不下时返回空方案（红区大于所有布片）', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[50, 50]] });
  F.seedMaterials([m]);
  equal(store.listCutSchemes(m.id, 200, 200).length, 0);
});

test('红区尺寸非法时返回空方案', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[100, 150]] });
  F.seedMaterials([m]);
  equal(store.listCutSchemes(m.id, 0, 50).length, 0);
  equal(store.listCutSchemes(m.id, -10, 50).length, 0);
});

test('物料不存在时返回空方案', () => {
  F.reset();
  equal(store.listCutSchemes('m_not_exist', 50, 50).length, 0);
});

group('旋转等价判定 · 取决于红区而非源片（真机反馈 2026-09-13）');

test('★ 关键回归（用户截图场景）：矩形源 80×140 + 方形红 50×50 → 1 个方案', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[80, 140]] });
  F.seedMaterials([m]);
  const schemes = store.listCutSchemes(m.id, 50, 50);
  equal(schemes.length, 1, '红区正方形 → 两种摆法几何等价，只出 1 个方案（用户截图里的 bug 场景）');
  equal(schemes[0].rotate, false);
  // V81：余料不再拆两片 —— 只看"挖在哪、挖完剩多少"（旋转与否几何等价，所以只留一个）
  near(schemes[0].remainArea, 80 * 140 - 50 * 50, 0.01, '挖完剩余可用（与旋转后完全相同）');
  equal(schemes[0].red.length, 50);
  equal(schemes[0].red.width, 50);
});

test('正方形红区 + 任意源片（多种长宽组合）都只出 1 个方案', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[100, 100], [120, 80], [80, 120]] });
  F.seedMaterials([m]);
  const schemes = store.listCutSchemes(m.id, 50, 50);
  equal(schemes.length, 3, '三块源片 × 1 个方案 = 3（红区正方形 → 不出重复）');
  schemes.forEach((s) => equal(s.rotate, false, '保留的都是不旋转'));
});

test('矩形红区 + 矩形源片 → 2 个方案（旋转有效，不去重）', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[100, 150]] });
  F.seedMaterials([m]);
  const schemes = store.listCutSchemes(m.id, 50, 60);
  equal(schemes.length, 2);
  ok(schemes.some((s) => s.rotate === true) && schemes.some((s) => s.rotate === false));
  const reds = schemes.map((s) => s.red.length + 'x' + s.red.width);
  ok(reds.indexOf('50x60') >= 0 && reds.indexOf('60x50') >= 0,
    '矩形红 + 矩形源：两种摆法的红区朝向不同（旋转确实改变了布局）');
});

test('矩形红区 + 正方形源片 → 2 个方案（红区不决定，源片够方也不去重）', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[100, 100]] });
  F.seedMaterials([m]);
  const schemes = store.listCutSchemes(m.id, 50, 60);
  equal(schemes.length, 2, '源片正方形但红区矩形 → 旋转仍然有效，不能去重');
  ok(schemes.some((s) => s.rotate === true) && schemes.some((s) => s.rotate === false));
});

test('近似正方形红（差 0.01）按矩形处理，不去重', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[100, 150]] });
  F.seedMaterials([m]);
  const schemes = store.listCutSchemes(m.id, 50, 50.01);
  equal(schemes.length, 2, '红区长宽不等（差 0.01）→ 不去重');
});

test('多种源片 + 方形红：每块源片只贡献 1 个方案（不重复）', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[80, 140], [100, 100]] });
  F.seedMaterials([m]);
  const schemes = store.listCutSchemes(m.id, 50, 50);
  equal(schemes.length, 2);
  const sources = schemes.map((s) => s.source.length + 'x' + s.source.width);
  equal(sources.length, 2, '输出 2 个方案');
  ok(sources.indexOf('80x140') >= 0, '包含 80×140（用户截图那块）');
  ok(sources.indexOf('100x100') >= 0, '包含 100×100');
});

test('回归保护：长宽都不等的源片 + 不等红 → 2 方案 × N 块（不误杀）', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[100, 150], [80, 80]] });
  F.seedMaterials([m]);
  const schemes = store.listCutSchemes(m.id, 50, 60);
  equal(schemes.length, 4, '2 块源片 × 2 方向 = 4，红区是矩形不去重');
});

test('★ 关键不变量：红区正方形时只 1 个方案，且 remainWhole/offcut 计算正确', () => {
  F.reset();
  const m = F.fabricMaterial({ fabricWidth: 150, unitPrice: 0.01, pieces: [[80, 140]] });
  F.seedMaterials([m]);
  const schemes = store.listCutSchemes(m.id, 50, 50);
  equal(schemes.length, 1, '只有 1 个方案（这是去重的本质）');
  const s = schemes[0];
  near(s.remainArea, 80 * 140 - 50 * 50, 0.01, '挖完剩余可用面积');
  ok(s.at && s.at.x != null && s.at.y != null, '必须给出挖在哪');
  equal(s.red.length, 50);
  equal(s.red.width, 50);
});



