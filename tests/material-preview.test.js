// tests/material-preview.test.js —— 物料长按预览的纯数据准备「store.materialPreview」
//
// 背景（2026-09-14 用户需求）：成品编辑页选物料时，长按任一物料弹出预览卡，
// 显示规格 / 尺寸 / 可用数量；面料要列出具体布片清单。
// 目的：让用户在输入用量/面积前就知道这块料的承受范围，避免填超。
//
// 为什么把这个逻辑做成 store 里的纯函数：页面只负责「长按 → 取数据 → 渲染」，
// 数据准备可单测、可复用（将来物料库、裁剪页也可能要同一份口径）。
//
// 规格（与用户确认）：
//   · 弹窗形态：固定卡片（页面决定，此处不管）
//   · 布片清单：最多列 6 片（按面积降序）+ 汇总（共 N 片 / 整布 X / 碎料 Y）
//   · 「承受范围」提示本轮不做
//
// TDD：本文件先写，应当全红（store.materialPreview 尚未实现）。

const { test, group, ok, equal, near } = require('./harness.js');
const F = require('./fixtures.js');

const store = F.store;

// ---------- 非面料 ----------
group('物料预览 · 非面料');

test('非面料：给数量、单位、单价，没有布片清单', () => {
  F.reset();
  const m = F.simpleMaterial({ name: '黑色隐形拉链', unit: '个', quantity: 100, unitPrice: 0.5 });
  F.seedMaterials([m]);

  const pv = store.materialPreview(store.getMaterial(m.id));

  equal(pv.name, '黑色隐形拉链');
  equal(pv.isFabric, false);
  equal(pv.isBatch, false);
  ok(pv.stockText.indexOf('100') >= 0, '可用数量文案应含 100，实际：' + pv.stockText);
  ok(pv.stockText.indexOf('个') >= 0, '应含单位「个」，实际：' + pv.stockText);
  ok(pv.priceSeg.indexOf('¥') >= 0 && pv.priceSeg.indexOf('/个') >= 0, '单价文案，实际：' + pv.priceSeg);
  equal(pv.pieces.length, 0, '非面料无布片清单');
  equal(pv.piecesTotal, 0);
  equal(pv.sizeLine, '', '非面料没有幅宽');
});

// ---------- 面料（按片精确） ----------
group('物料预览 · 面料按片');

function seedFabricWithPieces() {
  F.reset();
  // [200,150] 宽=幅宽 → 整布；[50,90]、[80,50] 窄于幅宽 → 碎料
  const m = F.fabricMaterial({
    name: '米白纯棉平布', fabricWidth: 150, unitPrice: 0.01,
    pieces: [[200, 150], [50, 90], [80, 50]]
  });
  F.seedMaterials([m]);
  return store.materialPreview(store.getMaterial(m.id));
}

test('面料：给出幅宽（尺寸）与单价', () => {
  const pv = seedFabricWithPieces();
  equal(pv.isFabric, true);
  ok(pv.sizeLine.indexOf('150') >= 0, '尺寸行应含幅宽 150，实际：' + pv.sizeLine);
  ok(pv.priceSeg.indexOf('/m²') >= 0, '面料单价按 m²，实际：' + pv.priceSeg);
});

test('面料：可用数量 = 总面积 + 总片数', () => {
  const pv = seedFabricWithPieces();
  // 200×150=30000、50×90=4500、80×50=4000 → 合计 38500 cm² = 3.85 m²
  ok(pv.stockText.indexOf('3.85') >= 0, '应含总面积 3.85，实际：' + pv.stockText);
  ok(pv.stockText.indexOf('3') >= 0, '应含片数 3，实际：' + pv.stockText);
  equal(pv.piecesTotal, 3);
});

test('面料：区分整布与碎料的片数', () => {
  const pv = seedFabricWithPieces();
  equal(pv.wholeCount, 1, '整布 1 片（宽=幅宽）');
  equal(pv.offcutCount, 2, '碎料 2 片（窄于幅宽）');
  ok(pv.stockDetail.indexOf('整布') >= 0 && pv.stockDetail.indexOf('碎料') >= 0, '明细应含整布/碎料，实际：' + pv.stockDetail);
});

test('面料：布片清单按面积降序，每片含长/宽/标签/面积', () => {
  const pv = seedFabricWithPieces();
  equal(pv.pieces.length, 3);
  equal(pv.pieces[0].length, 200, '最大片排第一');
  equal(pv.pieces[0].width, 150);
  equal(pv.pieces[0].tag, '整布');
  near(pv.pieces[0].areaM2, 3, 0.0001, '200×150 = 3 m²');
  equal(pv.pieces[1].length, 50, '次大 50×90');
  equal(pv.pieces[1].tag, '碎料');
  near(pv.pieces[1].areaM2, 0.45, 0.0001);
  equal(pv.pieces[2].length, 80);
  near(pv.pieces[2].areaM2, 0.4, 0.0001);
});

test('面料：布片超过 6 片只列前 6，并给出省略数（松手即关，列表不能滚动）', () => {
  F.reset();
  const many = [];
  for (let i = 0; i < 10; i++) many.push([40 + i, 50]);   // 10 片碎料
  const m = F.fabricMaterial({ name: '碎料很多的花布', fabricWidth: 150, unitPrice: 0.01, pieces: many });
  F.seedMaterials([m]);

  const pv = store.materialPreview(store.getMaterial(m.id));

  equal(pv.pieces.length, 6, '最多列 6 片');
  equal(pv.piecesTotal, 10, '总片数仍是 10（汇总用）');
  equal(pv.piecesHidden, 4, '省略 4 片');
  // 降序：第一片应是最大的 49×50
  equal(pv.pieces[0].length, 49, '按面积降序，最大片在前');
});

test('面料：只统计在库布片（已出库的不算）', () => {
  F.reset();
  const m = F.fabricMaterial({
    name: '有出库片的布', fabricWidth: 150, unitPrice: 0.01,
    pieces: [[200, 150], F.piece(50, 50, { status: 'out' })]
  });
  F.seedMaterials([m]);

  const pv = store.materialPreview(store.getMaterial(m.id));
  equal(pv.piecesTotal, 1, '已出库的片不计入');
  equal(pv.pieces.length, 1);
});

// ---------- 刀口布（按批估量） ----------
group('物料预览 · 刀口布（按批估量）');

test('刀口布：给剩余重量与单价，没有布片清单', () => {
  F.reset();
  const m = F.batchFabricMaterial({ name: '碎花刀口布', batchRemain: 2, batchUnit: 'kg', batchUnitPrice: 12.5 });
  F.seedMaterials([m]);

  const pv = store.materialPreview(store.getMaterial(m.id));

  equal(pv.isFabric, true);
  equal(pv.isBatch, true, '识别为按批估量');
  ok(pv.stockText.indexOf('2') >= 0, '应含剩余 2，实际：' + pv.stockText);
  ok(pv.stockText.indexOf('kg') >= 0, '应含单位 kg，实际：' + pv.stockText);
  ok(pv.priceSeg.indexOf('/kg') >= 0, '单价按 kg，实际：' + pv.priceSeg);
  equal(pv.pieces.length, 0, '刀口布无布片清单（不裁剪）');
  equal(pv.piecesTotal, 0);
});

// ---------- 规格属性 ----------
group('物料预览 · 规格属性');

test('属性：把 attrGroups 转成 标签/值 列表', () => {
  F.reset();
  const m = F.fabricMaterial({
    name: '藏蓝亚麻格子布', fabricWidth: 150, unitPrice: 0.01,
    attrGroups: [{ dimension: '颜色', value: '藏蓝' }, { dimension: '材质', value: '亚麻' }, { dimension: '花纹', value: '格子' }]
  });
  F.seedMaterials([m]);

  const pv = store.materialPreview(store.getMaterial(m.id));

  equal(pv.attrs.length, 3);
  equal(pv.attrs[0].label, '颜色');
  equal(pv.attrs[0].value, '藏蓝');
  equal(pv.attrs[2].label, '花纹');
  equal(pv.attrs[2].value, '格子');
});

test('属性：没有属性时返回空数组，不报错', () => {
  F.reset();
  const m = F.simpleMaterial({ name: '无属性物料', quantity: 5, unitPrice: 1 });
  F.seedMaterials([m]);
  const pv = store.materialPreview(store.getMaterial(m.id));
  equal(pv.attrs.length, 0);
});

test('★ 属性也要限量：卡片高度须可控，否则会把下方布片清单挤出弹层（评审发现）', () => {
  F.reset();
  const many = [];
  for (let i = 0; i < 7; i++) many.push({ dimension: '维度' + i, value: '值' + i });
  const m = F.fabricMaterial({ name: '属性很多的花布', fabricWidth: 150, unitPrice: 0.01, pieces: [[200, 150]], attrGroups: many });
  F.seedMaterials([m]);

  const pv = store.materialPreview(store.getMaterial(m.id));

  equal(pv.attrs.length, 4, '最多列 4 项属性');
  equal(pv.attrsHidden, 3, '其余 3 项给出省略数');
  equal(pv.attrs[0].label, '维度0', '保留前 4 项');
  equal(pv.attrs[3].label, '维度3');
});

test('属性带稳定 key（供 wx:key 用，避免 label 重复导致渲染错乱）', () => {
  F.reset();
  // 两个同名维度 → label 会重复
  const m = F.fabricMaterial({
    name: '同名属性布', fabricWidth: 150, unitPrice: 0.01,
    attrGroups: [{ dimension: '颜色', value: '米白' }, { dimension: '颜色', value: '藏蓝' }]
  });
  F.seedMaterials([m]);
  const pv = store.materialPreview(store.getMaterial(m.id));
  equal(pv.attrs.length, 2);
  ok(pv.attrs[0].key !== pv.attrs[1].key, 'key 必须互不相同，实际：' + pv.attrs[0].key + ' / ' + pv.attrs[1].key);
  equal(pv.attrsHidden, 0, '没超限就没有省略');
});

// ---------- 低库存 ----------
group('物料预览 · 低库存标记');

test('低库存：沿用 store.isLowStock 的口径', () => {
  F.reset();
  const low = F.simpleMaterial({ name: '快没了的拉链', unit: '个', quantity: 2, unitPrice: 0.5, threshold: 10 });
  F.seedMaterials([low]);
  equal(store.materialPreview(store.getMaterial(low.id)).low, true);

  const okMat = F.simpleMaterial({ name: '充足的拉链', unit: '个', quantity: 100, unitPrice: 0.5, threshold: 10 });
  F.seedMaterials([okMat]);
  equal(store.materialPreview(store.getMaterial(okMat.id)).low, false);
});

// ---------- 健壮性 ----------
group('物料预览 · 健壮性');

test('物料不存在 / 空值：返回 null，不抛错', () => {
  F.reset();
  equal(store.materialPreview(null), null);
  equal(store.materialPreview(undefined), null);
  equal(store.materialPreview({}), null, '无 id 的骨架对象也返回 null，避免页面拿到半成品渲染');
});

test('面料但一片都没有：可用数量为 0，清单为空，不崩', () => {
  F.reset();
  const m = F.fabricMaterial({ name: '空布料', fabricWidth: 150, unitPrice: 0.01, pieces: [] });
  F.seedMaterials([m]);

  const pv = store.materialPreview(store.getMaterial(m.id));

  equal(pv.piecesTotal, 0);
  equal(pv.pieces.length, 0);
  ok(pv.stockText.indexOf('0') >= 0, '面积应为 0，实际：' + pv.stockText);
});
