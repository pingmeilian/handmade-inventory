// tests/cut-editor-queue.test.js —— 裁剪排版页「一批排片」模式（2026-09-30 V90）
//
// 用户连着三句把需求说清（原话）：
//   ① 「增加成品数量，点确定后，当数量大于1的时候，在剪裁界面 可以自定义大小和片数」
//   ② 「不是每一片都是一样的大小，可以每一片自定义长宽」
//   ③ 「不同的裁片也可以选不同的布片放」
// ⇒ V89 那套「做 N 件就一件一件确认 N 次」被**一屏排完**取代：
//   这一屏列出这批要裁的每一片，每片**各自**填长宽、**各自**选布，摆好**一次**点「就这样裁」。
//
// 老约定仍然成立（V78 用户原话：「每一件都由我来剪裁，都由我来确定」）：
//   · 每一片都能单独决定（现在比逐件更彻底 —— 连尺寸都能改）
//   · 同一块布上不许两片叠着 —— 现在是**同屏可见**，比"一件一件"更直观
//   · 全程不落盘（中途取消 = 什么都没发生，真正扣料在 produceProduct）
// 加上 V80 的教训：收不到任务必须给一句人话，**绝不白屏**。
//
// 所以本文件不是"测代码写得对不对"，而是把「用户会看到什么、账会怎么变」跑一遍。
const stub = require('./wx-stub.js');
const { test, group, ok, equal, near } = require('./harness.js');
const { loadPage } = require('./page-helper.js');
const store = require('../utils/store.js');
const util = require('../utils/util.js');
const calc = require('../utils/calc.js');
const fixtures = require('./fixtures.js');

const CUT = '../pages/cut-editor/cut-editor.js';

// 一块面料 + 两块布：A 35×80（小）、B 100×80（大）
function seedFabric() {
  stub.resetStorage();
  store.ensureSeed();
  const m = store.saveMaterial({ name: '米白纯棉平布', materialCategoryId: 'mc_fabric', unit: '米' });
  store.inbound(m.id, 0, { length: 35, width: 80, total: 28 }, '入库A');
  store.inbound(m.id, 0, { length: 100, width: 80, total: 80 }, '入库B');
  const fab = store.getMaterial(m.id);
  return { fab, small: fab.pieces[0], big: fab.pieces[1] };
}

// 开一个「排片模式」的裁剪界面（channel 由测试接管，便于取回传）
function openQueue(matId, qty, len, wid) {
  const queue = [];
  for (let i = 1; i <= qty; i++) {
    queue.push({ pieceNo: i, materialId: matId, materialName: '米白纯棉平布', redLen: len, redWid: wid });
  }
  const cut = loadPage(CUT);
  const out = { emitted: [] };
  cut.channel = {
    on: (ev, fn) => { out.onEvent = ev; out.feed = fn; },
    emit: (ev, d) => { out.emitted.push({ ev: ev, d: d }); }
  };
  cut.onLoad({ mode: 'queue' });
  out.feed({ queue: queue, qty: qty });
  out.page = cut;
  out.queue = queue;
  return out;
}

const tapPart = (page, i) => page.pickPart({ currentTarget: { dataset: { i: i } } });
const setLen = (page, i, v) => page.setPartLen({ currentTarget: { dataset: { i: i } }, detail: { value: String(v) } });
const setWid = (page, i, v) => page.setPartWid({ currentTarget: { dataset: { i: i } }, detail: { value: String(v) } });
const useBoard = (page, id) => page.pickBoard({ currentTarget: { dataset: { id: id } } });

group('裁剪排版页 · 一批排片（数量 > 1 时的裁剪界面）');

test('① 收到队列 → 列出这批要裁的每一片，每片带自己的尺寸', () => {
  const { fab } = seedFabric();
  const q = openQueue(fab.id, 3, 30, 20);
  const page = q.page;
  equal(q.onEvent, 'passQueue', '页面要监听 passQueue（事件名对不上就是白屏）');
  equal(page.data.queueMode, true, '要认 ?mode=queue');
  equal(page.data.qty, 3, '这批 3 件');
  equal(page.data.parts.length, 3, '3 件 × 1 个面料行 = 要裁 3 片');
  page.data.parts.forEach((p, i) => {
    equal(p.no, i + 1, '片号从 1 连续编号');
    near(Number(p.len), 30, 0.01, '默认长 = 成品那行的尺寸（用户可改）');
    near(Number(p.wid), 20, 0.01);
    equal(p.noFit, false, '每片都要自动落在放得下的地方 —— 一进来不该是"没地方放"');
    ok(p.boardLabel, '每片要能看出用的是哪块布');
  });
  equal(page.parts[0].pieceId, page.parts[1].pieceId, '装得下时默认都落在同一块布上（跟紧配优先一致）');
});

test('★ ② 改一片的尺寸 → 只有这片变，别的片一点不动', () => {
  const { fab } = seedFabric();
  const q = openQueue(fab.id, 3, 30, 20);
  const page = q.page;
  setLen(page, 1, 35);
  setWid(page, 1, 25);
  near(page.parts[1].len, 35, 0.01, '第 2 片改成 35');
  near(page.parts[1].wid, 25, 0.01, '第 2 片改成 25');
  near(page.parts[0].len, 30, 0.01, '第 1 片的长不许被带走');
  near(page.parts[0].wid, 20, 0.01, '第 1 片的宽不许被带走');
  near(page.parts[2].len, 30, 0.01, '第 3 片也不许被带走');
});

test('★ ③ 每片可以放在不同的布上（换布只影响这一片）', () => {
  const { fab, small, big } = seedFabric();
  const q = openQueue(fab.id, 3, 30, 20);
  const page = q.page;
  const firstBoard = page.parts[0].pieceId;
  equal(firstBoard, small.id, '默认落在小的那块（紧配优先）');
  tapPart(page, 1);
  useBoard(page, big.id);
  equal(page.parts[1].pieceId, big.id, '第 2 片换到了大布');
  equal(page.parts[0].pieceId, small.id, '第 1 片还在原来那块');
  equal(page.parts[2].pieceId, small.id, '第 3 片还在原来那块');
  // 画布上要同时画出两块布，各自摆着自己那几片
  const ids = page.data.boards.map(b => b.pieceId);
  equal(ids.indexOf(big.id) >= 0, true, '剪裁区要画出大布');
  equal(ids.indexOf(small.id) >= 0, true, '剪裁区要画出小布');
  const onBig = page.data.boards.find(b => b.pieceId === big.id);
  equal(onBig.cuts.length, 1, '大布上只摆着第 2 片');
  const onSmall = page.data.boards.find(b => b.pieceId === small.id);
  equal(onSmall.cuts.length, 2, '小布上摆着第 1、3 片');
});

test('★ ④ 加一片 / 减一片 —— **件数不动**（V91：4 件可以只裁 1 片）', () => {
  // 用户：「增加多个成品，但只需要一大片布，只需要裁一块儿，这种情况该怎么办」
  // ⇒ 件数（做几件）和片数（裁几片）必须是两个数：加减片不动件数，
  //   片数减到 1 就是"这批合起来裁一块大的"（= V74「合起来剪」那件事）。
  const { fab } = seedFabric();
  const q = openQueue(fab.id, 4, 30, 20);
  const page = q.page;
  equal(page.data.qty, 4, '这批 4 件');
  equal(page.parts.length, 4, '默认就排 4 片');
  page.removePiece();
  equal(page.parts.length, 3, '减一片 → 3 片');
  equal(page.data.qty, 4, '★ 件数不许跟着变');
  page.addPiece();
  equal(page.parts.length, 4, '加回来 → 4 片');
  equal(page.data.qty, 4, '件数还是 4');
  page.removePiece(); page.removePiece(); page.removePiece();
  equal(page.parts.length, 1, '一直减到只剩 1 片');
  equal(page.data.qty, 4, '★ 件数仍是 4 —— 这一批就"合起来裁一块"');
  equal(page.data.parts.length, 1, '界面上也只剩一行');
});

test('★ ⑤ 「就这样裁」回传：每片带自己的布、自己的尺寸、自己的摆放', () => {
  const { fab, big } = seedFabric();
  const q = openQueue(fab.id, 2, 30, 20);
  const page = q.page;
  tapPart(page, 1);
  setLen(page, 1, 45);
  useBoard(page, big.id);
  page.confirm();
  const got = q.emitted.filter(e => e.ev === 'onChoose').pop();
  ok(got, '要回传 onChoose（事件名要是 onChoose，入口按它接）');
  const chosen = got.d.chosen;
  equal(Array.isArray(chosen), true, 'chosen 是数组');
  equal(chosen.length, 2, '两件各一条（逐件结构，与 produceProduct 的 perPiece 同构）');
  equal(chosen[0][0].pieceId, page.parts[0].pieceId, '第 1 件：界面上是哪块就回哪块');
  near(chosen[0][0].length, 30, 0.01, '第 1 件尺寸照旧');
  equal(chosen[1][0].pieceId, big.id, '第 2 件：用户换的布要回传');
  near(chosen[1][0].length, 45, 0.01, '第 2 件：用户改的尺寸要回传（不是 BOM 的 30）');
  equal(typeof chosen[0][0].at.x, 'number', '摆放位置要带上');
});

test('⑥ 收不到任务 → 给一句人话，绝不白屏（V80 用户就是看到白屏）', () => {
  const cut = loadPage(CUT);
  cut.channel = { on: () => { }, emit: () => { } };
  cut.onLoad({ mode: 'queue' });
  cut.initQueue({ queue: [], qty: 1 });
  equal(cut.data.loadErr, true, '空队列要置 loadErr');
  equal(cut.data.boards.length, 0, '不要留半截画布');
});

test('⑦ 改大到两块布都装不下 → 这片标出来，且不许确认', () => {
  const { fab } = seedFabric();
  const q = openQueue(fab.id, 2, 30, 20);
  const page = q.page;
  setLen(page, 0, 200);
  setWid(page, 0, 200);
  equal(page.parts[0].pieceId || '', '', '200×200 两块布都装不下 → 这片没有落脚处');
  equal(page.data.parts[0].noFit, true, '界面上要标出"没地方放"');
  equal(page.data.canConfirm, false, '有片没摆好就不许确认');
  page.confirm();
  equal(q.emitted.length, 0, '不许悄悄回传 —— 那会让用户以为排好了');
});

test('⑧ 放不下时自动换一块装得下的布（改大尺寸不要突然变成"没地方放"）', () => {
  const { fab, small, big } = seedFabric();
  const q = openQueue(fab.id, 2, 30, 20);
  const page = q.page;
  equal(page.parts[0].pieceId, small.id, '默认在小布上');
  setLen(page, 0, 60);
  setWid(page, 0, 60);           // 小布 35×80 装不下 60×60，大布 100×80 装得下
  equal(page.parts[0].pieceId, big.id, '自动挪到大布上（而不是留个"没地方放"给用户）');
  equal(page.data.parts[0].noFit, false, '界面上不该标"没地方放"');
});

test('★ ⑩ 同屏多片：每一片都该是**绿的**（摆得下就绿，红=放不下）', () => {
  // V90 的教训：4 片各自摆在不同位置（**排得完全正确**），**画出来却每片全红** ——
  // 绿红那一步把"一整块布"当矩形塞进了 sheets.subtractAll，它静默返回空 ⇒ 一律判"整块放不下"。
  // 所以这条测试不看"排得对不对"，只看"画得对不对"：都摆好了就该全绿。
  const { fab } = seedFabric();
  const q = openQueue(fab.id, 4, 30, 20);
  const page = q.page;
  const b = page.data.boards[0];
  equal(b.cuts.length, 4, '4 片都排在同一块布上');
  b.cuts.forEach((c) => {
    equal(c.ok, true, '片 ' + c.no + ' 摆得下就该是绿的');
    ok(c.green.length > 0, '片 ' + c.no + ' 要有绿块（绿 = 这块料在布上确实存在的那部分）');
    equal(c.red.length, 0, '片 ' + c.no + ' 不该有红块');
  });
});

group('裁剪排版页 · 排片一路走到扣料（端到端）');

test('★★ ⑨ 每片各自改尺寸、各自换布 → 保存时扣的就是各自那块布、各自那么大', () => {
  const { fab, small, big } = seedFabric();
  // 直接塞一条成品（不走 saveProduct —— 它自己也会动料，会把本用例的口径搅混）
  const prod = Object.assign(fixtures.product({ name: '测试成品·排片裁剪' }), {
    bom: [{
      materialId: fab.id, materialName: fab.name, isFabric: true, stockMode: 'piece',
      length: 30, width: 20, area: 600, lenUnit: 'cm', widUnit: 'cm'
    }]
  });
  fixtures.seedProducts([prod]);

  const queue = calc.cutQueueFor(prod.bom, 3, null);
  equal(queue.length, 3, '3 件 × 1 个面料行 = 队列 3 条');

  const q = openQueue(fab.id, 3, 30, 20);
  const page = q.page;
  // 第 2 片：尺寸改成 50×30，并换到大的那块布上
  tapPart(page, 1);
  setLen(page, 1, 50);
  setWid(page, 1, 30);
  useBoard(page, big.id);
  equal(page.parts[1].pieceId, big.id, '第 2 片换到了大布');

  page.confirm();
  const got = q.emitted.filter(e => e.ev === 'onChoose').pop();
  store.produceProduct(prod.id, 3, null, null, null, got.d.chosen);

  const after = store.getMaterial(fab.id).pieces;
  const aS = after.find(p => p.id === small.id);
  const aB = after.find(p => p.id === big.id);
  near(util.round(small.area - aS.area, 2), 1200, 1,
    '小布被挖掉 2 片 30×20 —— 用户没动的那两片照旧');
  near(util.round(big.area - aB.area, 2), 1500, 1,
    '大布被挖掉 1 片 50×30 —— 按**用户改的尺寸**扣，不是 BOM 的 30×20');
});

test('★★ ⑪ 做 4 件、只裁 1 块 → 扣料**只扣一次**（不许按件数补齐）', () => {
  // 用户原话：「也有可能我增加多个成品，但只需要一大片布，只需要裁一块儿」。
  // 危险点：扣料那边如果还按件数循环，这一刀会被补扣成 4 刀，**用料凭空多出来**（账面看不出来）。
  const { fab } = seedFabric();
  const prod = Object.assign(fixtures.product({ name: '测试成品·合起来裁一块' }), {
    bom: [{
      materialId: fab.id, materialName: fab.name, isFabric: true, stockMode: 'piece',
      length: 30, width: 20, area: 600, lenUnit: 'cm', widUnit: 'cm'
    }]
  });
  fixtures.seedProducts([prod]);

  const q = openQueue(fab.id, 4, 30, 20);
  const page = q.page;
  page.removePiece(); page.removePiece(); page.removePiece();   // 4 片减到 1 片
  equal(page.parts.length, 1, '只剩 1 片');
  equal(page.data.qty, 4, '★ 这批仍是 4 件（片数与件数分开）');

  page.confirm();
  const got = q.emitted.filter(e => e.ev === 'onChoose').pop();
  equal(got.d.qty, 4, '回传给生产入口的件数是 4');
  equal(got.d.chosen.length, 1, '只给了 1 刀');

  store.produceProduct(prod.id, 4, null, null, null, got.d.chosen);
  const outs = store.getFlows().filter(x => x.type === 'out');
  equal(outs.length, 1, '★ 只剪了 1 刀 —— 不许按 4 件补齐（补了就是用料凭空多 3 倍）');
});

// ============================================================
// V112 案B：确认按钮当"路标"用 —— 不看完所有物料就不许确认
//
// 用户原话（2026-10-04）：
//   「我发现剪裁界面可以不往右滑，就直接点就这样裁
//     用户可能会忽略第二个物料的剪裁，直接点就这样裁　怎么做比较好」
//
// ⚠️ 真因查实后与用户猜的不一样：**不是"用户会忽略"，是按钮本来就点得下去** ——
//   autoPlaceAll() 已经替所有物料把片摆好了 ⇒ canConfirm 全绿。
//   也就是说"系统替他做了决定"，靠提示语治不好。
//   ⇒ 改成：看过一遍才放行。按钮文案随之变，点了直接跳到下一个没看过的物料。
//
// 📌 这条守卫的形态选择：**不查字符串、真的把场景跑一遍** ——
//   因为"漏看也能确认"这件事只有行为能证明，grep 不到。
// ============================================================

test('★ ⑨ 多物料：没看过的物料不算看过，按钮一直是「还有 N 个物料 ›」（V112）', () => {
  // 两个物料，各有布
  stub.resetStorage();
  store.ensureSeed();
  const a = store.saveMaterial({ name: '粉色亚麻波点11', materialCategoryId: 'mc_fabric', unit: '米' });
  store.inbound(a.id, 0, { length: 500, width: 150, total: 150 }, '入库A');
  const b = store.saveMaterial({ name: '蓝色粗布格纹', materialCategoryId: 'mc_fabric', unit: '米' });
  store.inbound(b.id, 0, { length: 600, width: 200, total: 200 }, '入库B');
  const fa = store.getMaterial(a.id), fb = store.getMaterial(b.id);

  const queue = [
    { pieceNo: 1, materialId: fa.id, materialName: fa.name, redLen: 50, redWid: 40 },
    { pieceNo: 2, materialId: fb.id, materialName: fb.name, redLen: 60, redWid: 30 }
  ];
  const cut = loadPage(CUT);
  const out = { emitted: [] };
  cut.channel = {
    on: (ev, fn) => { out.feed = fn; },
    emit: (ev, d) => { out.emitted.push({ ev: ev, d: d }); }
  };
  cut.onLoad({ mode: 'queue' });
  out.feed({ queue: queue, qty: 2 });

  // ① 停在第 1 屏：第 2 个物料没看过 ⇒ 按钮**不能**是确认态
  equal(cut.data.matGroups.length, 2, '两个物料 = 两屏');
  equal(cut.data.matIdx, 0, '进来停在第 1 屏');
  ok(cut.data.remainCount === 1,
    '★ 还剩 1 个物料没看过（autoPlaceAll 已经替它排好了，所以光看"没红片"拦不住）');
  equal(cut.data.confirmText, '还有 1 个物料 ›', '按钮文案必须是路标，不是「就这样裁」');
  ok(cut.data.canConfirm === false, '★ 还有物料没看过就不许确认');

  // ② 点它 ⇒ 跳到下一个没看过的（不是确认）
  cut.confirm();
  equal(out.emitted.length, 0, '★ 点了不许回传（还没看完）');
  equal(cut.data.matIdx, 1, '点了要跳到第 2 屏');

  // ③ 第 2 屏也看过了 ⇒ 按钮才变回「就这样裁」，点了才回传
  equal(cut.data.remainCount, 0, '两屏都看过 → 不剩了');
  equal(cut.data.confirmText, '就这样裁', '文案回到「就这���裁」');
  ok(cut.data.canConfirm === true, '都看过了才放行');
  cut.confirm();
  equal(out.emitted.length, 1, '★ 看完才回传');
});

test('★ ⑩ 单物料不受影响（按钮始终是「就这样裁」，V112 不能误伤普通单件排版）', () => {
  const { fab } = seedFabric();
  const q = openQueue(fab.id, 2, 30, 20);
  equal(q.page.data.matGroups.length, 1, '只有一个物料 = 一屏');
  equal(q.page.data.remainCount, 0, '单物料没有"没看过的"');
  equal(q.page.data.confirmText, '就这样裁', '单物料直接就是确认按钮');
  ok(q.page.data.canConfirm === true, '单物料照常能确认');
});
