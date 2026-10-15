// tests/origin.test.js —— 面料「出处」口径（2026-10-02 V95）
//
// 用户立的规矩：「有面积肯定就有形状…哪怕面积只算一个数字，都要关联到它的形状
// 和来自哪片布的哪个位置。所有的布不管在哪里都要这样要求，这样才能从头到尾
// 所有的流程能追溯」。
//
// 所以这个文件盯的不是算法，而是**口径**：
//   ① 一处出处必须"说全"三件事（形状 / 哪片布 / 哪个位置），说不全就不许当有出处；
//   ② 形状非法的输入**不许被编造成一个矩形**；
//   ③ 认洞必须认准（退料时要靠它把料填回原位置）。
const { test, group, ok, equal, near } = require('./harness.js');
const origin = require('../utils/origin.js');

group('面料出处 · 构造与归一化');

test('① mk：坐标与尺寸归一化到两位小数，面积缺省时按矩形算出来', () => {
  const o = origin.mk({
    materialId: 'm1', pieceId: 'fp1', way: 'cut',
    rect: { x: 1.004, y: 2.006, length: 30.005, width: 20.004 }
  });
  equal(o.materialId, 'm1');
  equal(o.pieceId, 'fp1');
  equal(o.way, 'cut');
  near(o.rect.x, 1, 0.001);
  near(o.rect.y, 2.01, 0.001);
  near(o.rect.length, 30.01, 0.001);
  near(o.area, 600.2, 0.05, '没给 area 时按矩形算（30.01×20 = 600.2）');
});

test('② 面积以「账」为准：显式给了 area 就用它，不被矩形面积覆盖', () => {
  // 按面积扣的那条路，账上扣的是 take；挖出来的洞是近似矩形 —— 两者可以差一点点，
  // 但**账必须是 take**（否则退料时加回来的钱对不上）
  const o = origin.mk({
    materialId: 'm1', pieceId: 'fp1', way: 'area',
    rect: { x: 0, y: 0, length: 10, width: 10 }, area: 99.5
  });
  equal(o.area, 99.5, '显式 area 优先');
  near(o.rect.length * o.rect.width, 100, 1e-6, '矩形仍是那个矩形（形状照实记）');
});

test('③ 形状非法 ⇒ rect 为 null，但**不丢掉面积**（宁可说没有形状，也不编一个）', () => {
  ['length 缺失', 'width 为 0', '负尺寸'].forEach((msg) => {});
  equal(origin.rect(null), null);
  equal(origin.rect({ x: 0, y: 0, length: 10 }), null, '缺 width → 形状非法');
  equal(origin.rect({ x: 0, y: 0, length: 0, width: 10 }), null, '长度 0 → 形状非法');
  equal(origin.rect({ x: 0, y: 0, length: -5, width: 10 }), null, '负尺寸 → 形状非法');
  const o = origin.mk({ materialId: 'm1', way: 'legacy', rect: null, area: 12.5 });
  equal(o.rect, null);
  equal(o.area, 12.5, '面积还在 —— 老记录就是"有面积、没形状"，不许假装有');
});

group('面料出处 · 说得全不全');

test('④ isValid：按 way 分档 —— 只有一个面积，不许冒充"有出处"', () => {
  // ⚠️ 注入法自检：这正是改造前的老写法（只有 materialId + 一个数），必须被判为不合法
  const legacyStyle = { materialId: 'm1', area: 100 };
  ok(!origin.isValid(legacyStyle), '自检失败：光有 materialId + 面积也被当成有出处了 —— 这条守卫没有牙');

  ok(origin.isValid(origin.mk({
    materialId: 'm1', pieceId: 'fp1', way: 'cut', rect: { x: 0, y: 0, length: 10, width: 10 }
  })), '按形状裁：片 + 位置齐了 → 合法');

  ok(!origin.isValid(origin.mk({
    materialId: 'm1', way: 'cut', rect: { x: 0, y: 0, length: 10, width: 10 }
  })), '按形状裁但没说哪片布 → 不合法');

  ok(!origin.isValid(origin.mk({
    materialId: 'm1', pieceId: 'fp1', way: 'cut', rect: null, area: 100
  })), '按形状裁却没有位置 → 不合法');

  ok(origin.isValid(origin.mk({
    materialId: 'm1', way: 'batch', lots: [{ lotId: 'lot1', qty: 2 }], area: 2
  })), '刀口布：有批次明细 → 合法');

  ok(!origin.isValid(origin.mk({
    materialId: 'm1', way: 'batch', lots: [], area: 2
  })), '刀口布：没批次明细 → 不合法（那还是"只有一个数"）');

  ok(origin.isValid(origin.mk({
    materialId: 'm1', way: 'legacy', area: 100
  })), '历史记录：明说"无出处"、面积在 → 合法（诚实即可）');

  ok(!origin.isValid(origin.mk({ way: 'cut', rect: { x: 0, y: 0, length: 1, width: 1 } })),
    '连物料都没说 → 不合法');
});

test('⑤ 整片被用掉时：rect 为空、必须带整片快照（否则还原不回来）', () => {
  const snap = { id: 'fp1', base: { x: 0, y: 0, length: 30, width: 20 }, holes: [], area: 600, status: 'in' };
  ok(origin.isValid(origin.mk({ materialId: 'm1', pieceId: 'fp1', way: 'whole', area: 600, pieceBefore: snap })),
    '整片 + 快照 → 合法');
  ok(!origin.isValid(origin.mk({ materialId: 'm1', pieceId: 'fp1', way: 'whole', area: 600 })),
    '整片但没快照 → 不合法（说明"还原不回去"这件事没被如实标出来）');
});

group('面料出处 · 认洞（退料填回原位置要靠它）');

test('⑥ sameRect：同一个洞认得出来，差一点点就是另一个洞', () => {
  const a = { x: 0, y: 0, length: 30, width: 20 };
  ok(origin.sameRect(a, { x: 0, y: 0, length: 30, width: 20 }), '完全一致');
  ok(origin.sameRect(a, { x: 0.001, y: 0, length: 30, width: 20 }), '0.001 的误差算同一个（链路 round 过）');
  ok(!origin.sameRect(a, { x: 0.5, y: 0, length: 30, width: 20 }), '错开 0.5cm 就是另一个位置了');
  ok(!origin.sameRect(a, { x: 0, y: 20, length: 30, width: 20 }), 'y 不同 → 另一个洞');
  ok(!origin.sameRect(a, { x: 0, y: 0, length: 30, width: 25 }), '尺寸不同 → 另一个洞');
  ok(!origin.sameRect(a, null), '空的一方不算相等');
});

test('⑦ same：同一片布的同一个位置才算"同一处出处"（换片就不算）', () => {
  const mk = (pieceId, x) => origin.mk({
    materialId: 'm1', pieceId: pieceId, way: 'cut', rect: { x: x, y: 0, length: 10, width: 10 }
  });
  ok(origin.same(mk('fp1', 0), mk('fp1', 0)), '同一片同一处 → 是');
  ok(!origin.same(mk('fp1', 0), mk('fp2', 0)), '换了一片布 → 不是同一处');
  ok(!origin.same(mk('fp1', 0), mk('fp1', 10)), '同一片但位置不同 → 不是同一处');
});

group('面料出处 · 给人看的话');

test('⑧ label：说法要能落到"哪一片的哪个位置"，不许含糊', () => {
  const cut = origin.mk({
    materialId: 'm1', pieceId: 'fp1', way: 'cut', rect: { x: 5, y: 10, length: 30, width: 20 }
  });
  ok(cut && origin.label(cut).indexOf('30×20') >= 0, '要说得出形状，实际：' + origin.label(cut));
  ok(origin.label(cut).indexOf('(5, 10)') >= 0, '要说得出位置，实际：' + origin.label(cut));

  const legacy = origin.mk({ materialId: 'm1', way: 'legacy', area: 100 });
  ok(origin.label(legacy).indexOf('无出处') >= 0, '老记录要明说"无出处"，实际：' + origin.label(legacy));

  const batch = origin.mk({ materialId: 'm1', way: 'batch', lots: [{ lotId: 'l1', qty: 2 }], area: 2 });
  ok(origin.label(batch).indexOf('批次') >= 0, '刀口布要说"按批"，实际：' + origin.label(batch));

  const detach = origin.mk({
    materialId: 'm1', way: 'detach', rect: { x: 0, y: 0, length: 10, width: 10 }, area: 100
  });
  ok(origin.label(detach).indexOf('原片已不在') >= 0, '兜底那条要**明说**不是填回原洞，实际：' + origin.label(detach));
});

test('⑨ areaOf：没矩形时也拿得到面积（导出/对账要用）', () => {
  equal(origin.areaOf(origin.mk({ materialId: 'm1', way: 'legacy', area: 33.336 })), 33.34);
  equal(origin.areaOf(null), 0);
  equal(origin.areaOf(origin.mk({
    materialId: 'm1', pieceId: 'p', way: 'cut', rect: { x: 0, y: 0, length: 3, width: 4 }
  })), 12);
});
