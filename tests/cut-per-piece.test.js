// tests/cut-per-piece.test.js —— 逐件确认裁剪（2026-09-29 V78）
//
// 用户原话：
//   「我说的一件一件，是每一件都由我来剪裁，都由我来确定
//     不是只确定一件剪裁，其他的都跟他一样」
// ⇒ 做 N 件就要让用户确认 N 次：每一件自己选「从哪块布剪、怎么摆」，
//   而不是"选一次、后面几件自动沿用"。
//
// 为什么必须有「影子布片」：第 2 件的可选方案依赖第 1 件剪完后的状态 ——
//   不能一次把 N 件的方案全列出来（会把已经被剪没的片也列进去）。
//
// 本文件覆盖支撑它的纯逻辑；选片页的逐件流程另有守卫盯着。
const { test, group, ok, equal, near } = require('./harness.js');
const F = require('./fixtures.js');

const store = F.store;

group('逐件确认裁剪 · 影子布片（纯函数）');

test('① applyCutToPieces：从指定片挖掉红区，返回新集合，**原数组一动不动**', () => {
  F.reset();
  const f = F.fabricMaterial({ name: '棉布', pieces: [[240, 150]], unitPrice: 0.01, fabricWidth: 150 });
  F.seedMaterials([f]);
  const before = store.getMaterial(f.id).pieces.slice();
  const big = before[0];

  const next = store.applyCutToPieces(before, big.id, 38, 83, 150);

  equal(before.length, 1, '纯函数：原集合不能被改动（否则影子预览会污染真库存）');
  // 2026-09-29 V81：裁剪**不拆块** —— 剪一刀之后还是这一块布，只是多了个镂空（用户 D96）
  equal(next.length, 1, '剪一刀还是**一块**布（不拆成「整布 + 碎料」）');
  equal(next[0].id, big.id, '还是原来那一块（id 不变，老流水的 cutSourceId 仍有指向）');
  equal(next[0].holes.length, 1, '多了一个镂空 = 裁走的那块');
  near(next[0].area, 240 * 150 - 38 * 83, 0.01, '可用面积 = 外框 − 镂空');
});

test('② applyCutToPieces：片不存在时返回 null（调用方据此回退）', () => {
  const r = store.applyCutToPieces([{ id: 'x', length: 10, width: 10, status: 'in' }], 'nope', 5, 5, 10);
  equal(r, null, '找不到就返回 null，不能悄悄返回空集合');
});

test('★ ③ 影子是累积的：逐件剪下去，布真的会用完 —— 这正是「逐件」与「选一次沿用」的分水岭', () => {
  F.reset();
  const f = F.fabricMaterial({ name: '棉布', pieces: [[100, 100]], unitPrice: 0.01, fabricWidth: 100 });
  F.seedMaterials([f]);
  let shadow = store.getMaterial(f.id).pieces.slice();

  // 第 1 件
  const s1 = store.listCutSchemes(f.id, 38, 83, shadow);
  ok(s1.length > 0, '第 1 件：100×100 能剪出 38×83');
  shadow = store.applyCutToPieces(shadow, s1[0].pieceId, s1[0].red.length, s1[0].red.width, 100);

  // 第 2 件
  const s2 = store.listCutSchemes(f.id, 38, 83, shadow);
  ok(s2.length > 0, '第 2 件：剪剩的大片还能再剪一件');
  shadow = store.applyCutToPieces(shadow, s2[0].pieceId, s2[0].red.length, s2[0].red.width, 100);

  // 第 3 件
  const s3 = store.listCutSchemes(f.id, 38, 83, shadow);
  equal(s3.length, 0,
    '第 3 件：100×100 的布本来就只够两件 —— 影子模拟必须算得出来（列不出方案就不能让他选）');
});

test('④ listCutSchemes 不传影子时，读的还是真库存（老用法零回归）', () => {
  F.reset();
  const f = F.fabricMaterial({ name: '棉布', pieces: [[100, 100]], unitPrice: 0.01, fabricWidth: 100 });
  F.seedMaterials([f]);
  const real = store.listCutSchemes(f.id, 38, 83);
  const withEmptyShadow = store.listCutSchemes(f.id, 38, 83, []);
  ok(real.length > 0, '不传影子 → 按真库存列方案');
  equal(withEmptyShadow.length, 0, '传了空影子 → 就按空库存算（不是回退到真库存）');
});

group('逐件确认裁剪 · 执行时按件取方案');

// 一片大布 + 一片碎料，两件分别从不同的片剪 —— 用户逐件选的就是这个
function twoPieces() {
  const f = F.fabricMaterial({
    name: '棉布', pieces: [[200, 150], [60, 90]], unitPrice: 0.01, fabricWidth: 150
  });
  F.seedMaterials([f]);
  const p = F.product({
    name: '包',
    bom: [{ materialId: f.id, materialName: f.name, isFabric: true, length: 38, width: 83, area: 3154 }]
  });
  F.seedProducts([p]);
  const m = store.getMaterial(f.id);
  return {
    f, p,
    big: m.pieces.find(x => x.length === 200),
    small: m.pieces.find(x => x.length === 60)
  };
}

test('★ ⑤ 第 1 件从大布剪、第 2 件从碎料剪 —— 执行时真的各用各的', () => {
  F.reset();
  const { f, p, big, small } = twoPieces();

  store.produceProduct(p.id, 2, [
    [{ materialId: f.id, pieceId: big.id, length: 38, width: 83, rotate: false }],
    [{ materialId: f.id, pieceId: small.id, length: 38, width: 83, rotate: false }]
  ]);

  const outs = store.getFlows().filter(x => x.type === 'out');
  equal(outs.length, 2, '2 件 = 2 笔扣料');
  equal(outs[0].cutSourceId, big.id, '第 1 件用的是大布（用户选的）');
  equal(outs[1].cutSourceId, small.id, '第 2 件用的是碎料（用户选的）—— 这就是「逐件」');
});

test('★ ⑥ V91 改了口径：逐件方案里某件**没给就是不剪**（不再回退自动补）', () => {
  // ⚠️ 这条在 V91 之前是反的（"那件没给 → 回退自动取最优"）。改口径的原因：
  //    用户明确要「做 4 件、但只需要一大片布、只裁一块」—— 那一屏里**片数可以比件数少**，
  //    所以 perPiece 里某件为空 = 用户不打算给这件单独裁，**不是**"漏填要替他补上"。
  //    若还按件数补齐，"只裁一块"会被补扣成 4 块，用料凭空多出来（账面看不出来）。
  F.reset();
  const { f, p, big } = twoPieces();

  store.produceProduct(p.id, 2, [
    [{ materialId: f.id, pieceId: big.id, length: 38, width: 83, rotate: false }],
    []
  ]);

  const outs = store.getFlows().filter(x => x.type === 'out');
  equal(outs.length, 1, '★ 只按用户给的刀数扣（1 刀），不再按件数补齐');
  equal(outs[0].cutSourceId, big.id, '扣的就是用户选的那块');
});

test('⑦ 不传任何方案 → 与以前完全一致（零回归）', () => {
  F.reset();
  const { p } = twoPieces();
  store.produceProduct(p.id, 2);
  const outs = store.getFlows().filter(x => x.type === 'out');
  equal(outs.length, 2, '照旧剪 2 刀');
  near(store.getProduct(p.id).sellableStock, 2, 1e-9, '成品照旧入账 2 件');
});


test('⑧ 逐件选择走第 6 个参数（perPiece）—— 页面回传的就是这个形状', () => {
  // V80 热修：页面（逐件确认）回传的是 chosen[第几件][第几个面料行]。
  // 入口把它当第 6 个参数传下来 —— 扣料侧必须真的读它，
  // 否则「用户每件选的方案」会被静默丢掉，退回系统自动取片（行为对不上却没有任何报错）。
  F.reset();
  const { f, p, big, small } = twoPieces();

  const picks = [
    [{ materialId: f.id, pieceId: big.id, length: 38, width: 83, rotate: false }],
    [{ materialId: f.id, pieceId: small.id, length: 38, width: 83, rotate: false }]
  ];
  store.produceProduct(p.id, 2, null, null, null, picks);

  const outs = store.getFlows().filter(x => x.type === 'out');
  equal(outs.length, 2, '2 件 = 2 笔扣料');
  equal(outs[0].cutSourceId, big.id, '第 1 件用大布（用户选的）');
  equal(outs[1].cutSourceId, small.id, '第 2 件用碎料（用户选的）—— 第 6 个参数必须生效');
});
