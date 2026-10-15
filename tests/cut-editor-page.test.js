// tests/cut-editor-page.test.js —— 裁剪排版页（V91）：单位 / 吸附 / 不出布 / 单件也能排多片
//
// 2026-09-30 V91 用户把这一屏的规矩补全了：
//   ① 「一件成品也可能用一个物料里的**两块布**」⇒ 从成品编辑进来也能加片（默认 1 片）
//   ② 「**不能拖出布片范围**，拖到边上吸住就不能再往外拖」⇒ 裁片永远待在布内
//   ③ 「吸附不仅要贴布的 4 条边，布不规则时**每一条边**都要能吸」⇒ 轮廓的每一条都算
//   ④ 单位还是"自己选"，但**内部与回传一律厘米**（这一屏的 cm/m 只是"你怎么填"）
//
// ⚠️ V85 那条「裁片能拖出布外、出界画红虚线」被 ② 取代了 —— 红色仍然留着，
//    但现在只在"这一片比布还大"或"压在布已有的缺口上"时出现。
const stub = require('./wx-stub.js');
const { test, group, ok, equal, near } = require('./harness.js');
const { loadPage } = require('./page-helper.js');
const store = require('../utils/store.js');
const util = require('../utils/util.js');

const CUT = '../pages/cut-editor/cut-editor.js';

// 一块面料 + 两块布：A 35×80（小、紧配）、B 100×80（大）
function seedFabric() {
  stub.resetStorage();
  store.ensureSeed();
  const m = store.saveMaterial({ name: '米白纯棉平布', materialCategoryId: 'mc_fabric', unit: '米' });
  store.inbound(m.id, 0, { length: 35, width: 80, total: 28 }, '入库A');
  store.inbound(m.id, 0, { length: 100, width: 80, total: 80 }, '入库B');
  const fab = store.getMaterial(m.id);
  return { fab, small: fab.pieces[0], big: fab.pieces[1] };
}

// 从成品编辑进来（?id=…&len=…&wid=…）
function openSingle(matId, len, wid) {
  const cut = loadPage(CUT);
  const out = { emitted: [] };
  cut.channel = {
    on: (ev, fn) => { out.onEvent = ev; out.feed = fn; },
    emit: (ev, d) => { out.emitted.push({ ev: ev, d: d }); }
  };
  cut.onLoad({ id: matId, len: len, wid: wid });
  out.page = cut;
  return out;
}

// 把第 no 片拖到布内 (xCm, yCm) 处（按屏幕位移换算 —— 拖动是靠 px 算的）
function dragTo(page, no, xCm, yCm) {
  const p = page.parts.find(q => q.no === no);
  const bd = page.data.boards.find(b => b.pieceId === p.pieceId);
  const per = page.pxPerCmOf(bd.sc);
  page.onPieceDown({ currentTarget: { dataset: { no: no } }, touches: [{ clientX: 500, clientY: 500 }] });
  page.onPieceMove({
    touches: [{
      clientX: 500 + (xCm - p.at.x) * per,
      clientY: 500 - (yCm - p.at.y) * per      // 屏幕 y 向下 = 布上的 y 向上
    }]
  });
  page.onPieceUp();
}

group('裁剪排版页 · 从成品编辑进来（单件起排）');

test('★ ① 默认 1 片，但能加片 ——「一件成品也可能用一个物料里的两块布」', () => {
  const { fab } = seedFabric();
  const p = openSingle(fab.id, 30, 20);
  const page = p.page;
  equal(page.data.queueMode, false, '不是生产流程来的（回传走 onCutChosen）');
  equal(page.data.parts.length, 1, '默认 1 片');
  equal(page.data.qty, 1, '1 件');
  equal(page.data.parts[0].noSize, false, '带着尺寸进来 → 不用重新填');
  equal(page.data.parts[0].noFit, false, '要自动落在放得下的那块布上');
  page.addPiece();
  equal(page.parts.length, 2, '加了一片');
  equal(page.parts[1].pieceNo, page.parts[0].pieceNo, '★ 加的那片跟原片**同一件**（这就是"一件用两块布"）');
  equal(page.data.qty, 1, '件数不受影响');
});

test('★ ② 「就这样裁」回传这一行的**全部片**（每片带自己的布和摆放）', () => {
  const { fab } = seedFabric();
  const p = openSingle(fab.id, 30, 20);
  const page = p.page;
  page.addPiece();
  page.confirm();
  const got = p.emitted.filter(e => e.ev === 'onCutChosen').pop();
  ok(got, '要回传 onCutChosen');
  equal(got.d.schemes.length, 2, '两片都在里面');
  ok(got.d.schemes[0].pieceId, '每片带自己的布');
  ok(got.d.schemes[0].at, '每片带自己的摆放');
  equal(got.d.materialId, fab.id, '整包还带着物料');
});

test('★ ③ 单位：默认厘米；切到米只换"显示语言"，**内部与回传一律厘米**', () => {
  const { fab } = seedFabric();
  const p = openSingle(fab.id, 30, 20);
  const page = p.page;
  equal(page.data.unit, 'cm', '默认厘米（用户指定过）');
  page.pickUnit({ currentTarget: { dataset: { u: 'm' } } });
  equal(page.data.unit, 'm');
  near(Number(page.data.parts[0].len), 0.3, 0.001, '界面上显示 0.3（米）');
  near(page.parts[0].len, 30, 0.01, '★ 内部仍是 30cm —— 账的口径一个字不动');
  page.setPartLen({ currentTarget: { dataset: { i: 0 } }, detail: { value: '0.5' } });
  near(page.parts[0].len, 50, 0.01, '按米填 0.5 → 内部 50cm');
  page.confirm();
  const got = p.emitted.filter(e => e.ev === 'onCutChosen').pop();
  near(got.d.schemes[0].length, 50, 0.01, '★ 回传的是厘米（不是 0.5）');
});

test('④ 空尺寸不炸：清空、乱字符都不抛异常，且不许确认', () => {
  const { fab } = seedFabric();
  const p = openSingle(fab.id, 0, 0);
  const page = p.page;
  equal(page.data.parts[0].noSize, true, '没填尺寸 → 标"填尺寸"');
  equal(page.data.canConfirm, false, '没填尺寸不许确认');
  page.setPartLen({ currentTarget: { dataset: { i: 0 } }, detail: { value: 'abc' } });
  equal(page.data.canConfirm, false, '乱字符当没填，不抛异常');
  page.confirm();
  equal(p.emitted.length, 0, '不许悄悄回传');
});

group('裁剪排版页 · 拖动吸附与不出布（V91）');

test('★ ⑤ 拖到布边就**停住**，拖不出布（不是"出界画红虚线"了）', () => {
  const { fab } = seedFabric();
  const p = openSingle(fab.id, 30, 20);      // 布 A = 35×80
  const page = p.page;
  dragTo(page, 1, -999, -999);               // 往左下角猛拖
  equal(page.parts[0].at.x, 0, '停在这块布的左边（不许为负）');
  equal(page.parts[0].at.y, 0, '停在布的底边');
  dragTo(page, 1, 999, 999);                 // 往右上角猛拖
  near(page.parts[0].at.x, 35 - 30, 0.01, '最多到「布长 − 片长」');
  near(page.parts[0].at.y, 80 - 20, 0.01, '最多到「布宽 − 片宽」');
  const b = page.data.boards[0];
  const c = b.cuts[0];
  ok(c.green.length > 0 && c.red.length === 0, '整片都在布内 ⇒ 应当全绿');
});

test('★ ⑥ 吸附：贴近布的外框边 → 自动吸上去（差一点点也对齐）', () => {
  const { fab } = seedFabric();
  const p = openSingle(fab.id, 30, 20);
  const page = p.page;
  dragTo(page, 1, 0.4, 7.5);                 // 离左边只差 0.4cm、其它方向随便
  equal(page.parts[0].at.x, 0, '横向上被吸到布的左边（x=0）');
  dragTo(page, 1, 2, 79.6);                  // 离"布宽 − 片宽 = 60"很远，但离右上角……
  near(page.parts[0].at.y, 80 - 20, 0.01, '贴到布的上边（y = 布宽 − 片宽）');
});

test('★ ⑦ 吸附：布**不规则**时，缺口的边也要能吸（用户原话）', () => {
  const { fab, small } = seedFabric();
  // 先在这块布上裁一刀，裁出一个缺口（右下角挖掉 30×20 → 边在 x=5/y=60 处）
  store.cutFabric(fab.id, small.id, 20, 30, '测试', false, null, { x: 15, y: 0 });
  const p = openSingle(fab.id, 10, 10);
  const page = p.page;
  const sh = store.pieceShape(store.getMaterial(fab.id).pieces[0]);
  equal(sh.holes.length, 1, '这块布现在有一个缺口');
  const h = sh.holes[0];
  // 把裁片拖到"贴着缺口左边"的位置附近 → 应当吸到缺口的边（h.x / h.x + h.length 之类）
  const want = h.x;
  dragTo(page, 1, want + 0.3, h.y + h.width + 8);
  equal(page.parts[0].at.x, want, '横向上吸到缺口的边（不是只认外框）');
});

test('★ ⑧ 吸附：贴近**别的裁片** → 也吸，两片紧挨着不留缝', () => {
  const { fab } = seedFabric();
  const p = openSingle(fab.id, 30, 20);
  const page = p.page;
  page.addPiece();                            // 两片：片 1 在 (0,0)，片 2 在 (0,20)
  const first = page.parts[0];
  const second = page.parts[1];
  equal(second.at.y, 20, '第二片自动排在片 1 上面（贴住）');
  // 先把第二片拖开，再往片 1 的上边贴过去（差 0.5cm）
  dragTo(page, second.no, 40, 40);
  dragTo(page, second.no, first.at.x, 20.5);
  near(page.parts[1].at.y, 20, 0.01, '★ 吸到片 1 的上边（贴住另一个裁片）');
});

group('裁剪排版页 · 每片可以自己转 90°（V93）');

test('★ ⑫ 点「转90°」：这一片转过来放，回传带 rotate=true', () => {
  const { fab } = seedFabric();
  const p = openSingle(fab.id, 30, 20);
  const page = p.page;
  equal(page.parts[0].rot, false, '默认不转（系统先按不转摆）');

  page.rotPart({ currentTarget: { dataset: { i: 0 } } });

  equal(page.parts[0].rot, true, '★ 转过来放 —— 布有织向，方向该由用户说了算');
  equal(page.data.parts[0].rot, true, '界面上那一行也要跟着亮起来');
  const bd = page.data.boards.find(b => b.pieceId === page.parts[0].pieceId);
  near(bd.cuts[0].boxW / bd.sc, 20, 0.5, '占位宽度变成 20（长宽对调）');
  near(bd.cuts[0].boxH / bd.sc, 30, 0.5, '占位高度变成 30');
  ok(page.data.canConfirm, '转过来照样放得下 → 不影响确认');

  page.confirm();
  const got = p.emitted.filter(e => e.ev === 'onCutChosen').pop();
  equal(got.d.schemes[0].rotate, true, '★ 回传要带 rotate —— 不带的话扣料时会被当成没转');
  near(got.d.schemes[0].length, 30, 0.01, 'length/width 仍是**成品那行**的长宽（不随转 90° 变）');
  near(got.d.schemes[0].width, 20, 0.01);
});

test('⑬ 再点一次转回来（是个开关，不是单向的）', () => {
  const { fab } = seedFabric();
  const p = openSingle(fab.id, 30, 20);
  const page = p.page;
  const at0 = Object.assign({}, page.parts[0].at);
  page.rotPart({ currentTarget: { dataset: { i: 0 } } });
  page.rotPart({ currentTarget: { dataset: { i: 0 } } });
  equal(page.parts[0].rot, false, '两下转回原样');
  near(page.parts[0].at.x, at0.x, 0.01, '位置也回到原来那套（不越转越乱）');
  near(page.parts[0].at.y, at0.y, 0.01);
});

test('★ ⑭ 转不开就不硬转：还按原来的方向放，并说一句（不静默）', () => {
  const { fab } = seedFabric();
  // 34×78：只有「不转」放得下（转到 78×34 就超过这块布的长边 35）
  const p = openSingle(fab.id, 34, 78);
  const page = p.page;
  const before = page.parts[0].pieceId;
  stub.toasts.length = 0;

  page.rotPart({ currentTarget: { dataset: { i: 0 } } });

  equal(page.parts[0].rot, false, '转不开 → 保持原来的方向');
  equal(page.parts[0].pieceId, before, '也不把它偷偷挪到别的布上（用户选的是这块布）');
  ok(stub.toasts.length > 0, '要说一句 —— 无反馈的按钮比没有按钮更伤人（V88 的规矩）');
  equal(page.data.canConfirm, true, '照样能确认（没把它弄坏）');
});

test('⑮ 正方形 / 没填尺寸时点转，只是说一句，不崩', () => {
  const { fab } = seedFabric();
  const sq = openSingle(fab.id, 20, 20).page;
  stub.toasts.length = 0;
  sq.rotPart({ currentTarget: { dataset: { i: 0 } } });
  ok(stub.toasts.length > 0, '正方形转不转都一样 → 说一句');
  equal(sq.parts[0].rot, false, '不留下一个没意义的状态');

  const blank = openSingle(fab.id, 0, 0).page;
  stub.toasts.length = 0;
  blank.rotPart({ currentTarget: { dataset: { i: 0 } } });
  ok(stub.toasts.length > 0, '还没填尺寸 → 说一句"先填长宽"');
});

group('裁剪排版页 · 红了不许确认（V94）');

// 一块 100×80 的布 + 左下角一个 20×30 的缺口 → 把片拖上去就是红的
function redSetup() {
  const { fab, big } = seedFabric();
  store.cutFabric(fab.id, big.id, 20, 30, '测试', false, null, { x: 15, y: 0 });
  const p = openSingle(fab.id, 30, 20);
  const page = p.page;
  page.pickBoard({ currentTarget: { dataset: { id: big.id } } });   // 挪到带缺口那块大布上
  return { p, page, big };
}

test('★ ⑯ 拖到缺口上 → 这一片标红，而且**不许确认**', () => {
  const { page } = redSetup();
  equal(page.data.canConfirm, true, '刚挪过去是绿的（系统会找空位）');
  equal(page.data.parts[0].red, false, '这时候没标红');

  dragTo(page, 1, 17, 2);                     // 拖到缺口上（会自动吸到缺口边）

  const cut = page.data.boards[0].cuts[0];
  equal(cut.ok, false, '压在缺口上 ⇒ 这一片有红块');
  ok(cut.red.length > 0, '要真的画出红块（不然用户不知道为什么挡住他）');
  equal(page.data.parts[0].red, true, '★ 那一行也要标出来 —— 得让他知道是哪一片');
  equal(page.data.canConfirm, false,
    '★ 红了就不许确认 —— 这正是用户问的「剪裁区都红了，还能点用这块料？」');
});

test('★ ⑰ 拖回绿区 → 又能确认了（不是一红就废）', () => {
  const { page } = redSetup();
  dragTo(page, 1, 17, 2);
  equal(page.data.canConfirm, false, '先确认它确实被拦住了');

  dragTo(page, 1, 60, 60);                    // 拖到空地

  equal(page.data.boards[0].cuts[0].ok, true, '全绿了');
  equal(page.data.parts[0].red, false, '标红也撤掉');
  equal(page.data.canConfirm, true, '★ 又能确认了 —— 拦的是"这一刀裁不出来"，不是"你做错了"');
});

test('★ ⑱ 红了点确认：**不回传** + 说一句人话（不许静默）', () => {
  const { p, page } = redSetup();
  dragTo(page, 1, 17, 2);
  stub.toasts.length = 0;

  page.confirm();

  equal(p.emitted.length, 0,
    '★ 红了不许回传 —— 否则扣料时那一刀会按**系统自己找的位置**裁下去，账面看不出来（V87/V90 同款坑）');
  ok(stub.toasts.length > 0, '要说一句 —— 点了没反应比报错更让人恼火（V88 的规矩）');
});

group('裁剪排版页 · 画布（V86 定的规矩不能丢）');

test('⑨ 画布容器 = 布 + 四周留白；布上的片要按 left/top 摆（世界 y 朝上 → 屏幕朝下）', () => {
  const { fab } = seedFabric();
  const p = openSingle(fab.id, 30, 20);
  const page = p.page;
  const b = page.data.boards[0];
  ok(b.wrapW > b.w && b.wrapH > b.h, '容器比布大一圈（留白 pad）');
  const c = b.cuts[0];
  // 片摆在布的左下角 → 屏幕上应贴着布的**下沿**（top 大），而不是上沿
  const expectTop = b.pad + b.h - (page.parts[0].at.y * b.sc + c.boxH);
  near(c.boxTop, expectTop, 1.5, 'y 必须翻转（V86 之后一律 left/top 定位）');
});

test('⑩ 绿 + 红 恒等于整块裁片（拖到哪都守恒）', () => {
  const { fab } = seedFabric();
  const p = openSingle(fab.id, 30, 20);
  const page = p.page;
  const areaOf = (rs) => (rs || []).reduce((s, r) => s + r.w * r.h, 0);
  const b = page.data.boards[0];
  const cm2 = (px) => px / (b.sc * b.sc);
  const sum = cm2(areaOf(b.cuts[0].green) + areaOf(b.cuts[0].red));
  ok(Math.abs(sum - 600) < 4, '绿 + 红 该等于 30×20 = 600cm²（实际 ' + Math.round(sum) + '）');
});

test('⑪ 画布区一个字都不许放（文字必被拖出来的裁片压住 —— 用户连着两轮的投诉）', () => {
  const fs = require('fs');
  const path = require('path');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/cut-editor/cut-editor.wxml'), 'utf8');
  const pick = (s) => s.slice(s.indexOf('<view class="canvas"'), s.indexOf('board-tag'));
  // ⚠️ 注入法自检：往画布那段里塞个 <text>，必须能被抓出来（否则这条守卫没有牙）
  ok(pick('<view class="canvas"><text>提示</text></view><view class="board-tag">x').indexOf('<text') >= 0,
    '自检失败：往画布里塞文字没被检出');
  const seg = pick(wxml);
  ok(seg.length > 0, '模板里要有 .canvas 区块');
  ok(seg.indexOf('<text') < 0, '画布区里不许有任何 <text> —— 它随时会被拖动的裁片压住');
  ok(wxml.indexOf('board-tag') >= 0, '布的说明放在**画布之外**的 board-tag 里');
});


// ============================================================
// V113c（用户 2026-10-04 真机截图）两件事：
//   ①「我这还没输入尺寸呢，怎么就说放不下了」——
//     sheetsFit() 对 0×0 恒 false，而换布卡文案是二值的 ⇒ 一进来全员「✕ 放不下」。
//     placePart 的口径早就是「尺寸没填先挂着、不占位」（252 行注释），换布卡没跟上。
//   ②「这个布片还是好小啊 明明可以放大居中」——
//     BOARD_W=480 是 V90「并排多块」时代的遗产；V111 改纵向堆叠后**宽度才是稀缺维度**，
//     480 只吃满屏宽的 64%，剩下 270rpx 白白空着。
// ============================================================

group('裁剪排版页 · 未填尺寸不判放不下 + 布块放大（V113c）');

test('★ ⑲ 没填尺寸时，换布卡必须是"不判断"态，不许说「✕ 放不下」', () => {
  const { fab } = seedFabric();
  const cut = loadPage(CUT);
  cut.onLoad({ id: fab.id });          // 不带 len/wid —— 用户进来第一眼的状态
  const pieces = cut.data.pieces;
  ok(pieces.length > 0, '前置：物料有在库布片');
  equal(pieces[0].sized, false, '★ 没填尺寸 ⇒ sized = false（进入"不判断"态）');
  equal(pieces[0].fits, false, 'fits 此时无意义，保持 false');

  // 填上尺寸后必须恢复判断
  cut.parts[0].len = 30; cut.parts[0].wid = 20;
  cut.renderParts();
  equal(cut.data.pieces[0].sized, true, '填了尺寸 ⇒ sized = true');
  equal(cut.data.pieces[0].fits, true, '30×20 放进 35×80 —— 必须判「✓ 放得下」');

  // 静态：文案三态 —— 未填尺寸给中性提示，✕ 放不下只允许出现在 sized 分支里
  const fs = require('fs');
  const path = require('path');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/cut-editor/cut-editor.wxml'), 'utf8');
  ok(/wx:if="\{\{item\.sized\}\}"/.test(wxml),
    '★ 「✓放得下 / ✕放不下」必须包在 item.sized 分支里 —— 没填尺寸不许下结论');
  ok(wxml.indexOf('填尺寸后判断') >= 0, '没填尺寸时要给中性提示（告诉用户为什么现在不下结论）');

  // 注入法自检：用「旧版二值写法」喂上面的判据 —— 它必须判不出
  //（否则说明判据在空转：无论文件长什么样都能过）
  const legacyLine = '<text class="strip-fit {{item.fits ? \'ok\' : \'bad\'}}">'
    + '{{item.fits ? \'✓ 放得下\' : \'✕ 放不下\'}}</text>';
  ok(!/wx:if="\{\{item\.sized\}\}"/.test(legacyLine),
    '自检失败：旧版二值写法不该通过「必须有 sized 分支」的判据 —— 这条守卫没有牙');
});

test('★ ⑳ 宽布要放大到吃满屏宽（500×150 不能缩成一小条）', () => {
  stub.resetStorage();
  store.ensureSeed();
  const m = store.saveMaterial({ name: '宽布测试', materialCategoryId: 'mc_fabric', unit: '米' });
  store.inbound(m.id, 0, { length: 500, width: 150, total: 1 }, '入库');
  const cut = loadPage(CUT);
  cut.onLoad({ id: m.id });
  const b = cut.data.boards[0];
  ok(b, '前置：布块要渲染出来（没尺寸也先挂在这块布上）');
  ok(b.w >= 600, '★ 500cm 宽的布块要 ≥600rpx（480 上限是"并排时代"遗产，只吃屏宽 64%）'
    + '实际 ' + b.w + 'rpx');
  ok(b.w <= 750, '不许超出屏幕宽');
  ok(b.h > 0 && b.h <= 380 + 0.5, '高度仍要守上限（' + b.h + '）');
});

test('★ ㉑ 再次编辑：把已存的裁剪方案**原位**带回来（V120）', () => {
  // 用户 2026-10-06：「同一块布剪两片 点就这样裁 为什么再打开之后是一片」
  //   + 补充：「保存成品之后 存的再编辑时布片也是 1 片」。
  // 根因：裁剪页单件入口**每次只建一片**，不读 BOM 行上已存的 chosenSchemes ⇒ 界面永远显示 1 片；
  //   在这个状态下再点一次「就这样裁」还会把原方案**整体覆盖**成 1 片（那才真丢）。
  const { fab, big } = seedFabric();
  const o = openSingle(fab.id, 50, 40);
  ok(o.feed, '裁剪页要在 onLoad 里注册「已存方案」的监听（上游把方案递进来）');
  equal(o.page.parts.length, 1, '前置：没有方案时仍旧默认一片（老行为不能变）');

  // 上游把已存的两片方案递进来（同一块布、两个位置，其中一片转了 90°）
  o.feed({
    schemes: [
      { materialId: fab.id, length: 50, width: 40, pieceId: big.id, rotate: false, at: { x: 5, y: 5 } },
      { materialId: fab.id, length: 50, width: 40, pieceId: big.id, rotate: true, at: { x: 60, y: 5 } }
    ]
  });
  equal(o.page.parts.length, 2, '★ 两片都要回来（用户报的就是"再打开只剩一片"）');
  equal(o.page.parts[0].pieceId, big.id, '用的是原来那块布');
  equal(o.page.parts[0].at.x, 5, '位置照旧 —— 不许重排（用户摆好的位置）');
  equal(o.page.parts[0].at.y, 5, '位置照旧');
  equal(o.page.parts[1].rot, true, '转没转照旧');
  equal(o.page.parts[1].at.x, 60, '第二片位置照旧');

  // 空方案 = 保持默认一片（第一次进来 / 从物料详情进来）
  const o2 = openSingle(fab.id, 50, 40);
  o2.feed({ schemes: [] });
  equal(o2.page.parts.length, 1, '没有已存方案 ⇒ 仍然默认一片');
});

test('★ ㉒ 两个入口都要把已存方案递进去（防止以后只改一处）', () => {
  // 「选择物料」与行内「剪裁」是两条独立的路，都进同一个裁剪页 —— 少改一条，
  // 用户从那一条进去时又会看到"只剩一片"（V114a 的"同源两处要一起改"同一类坑）。
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/products/edit.js'), 'utf8');
  equal(src.split("emit('passSchemes'").length - 1, 2,
    '「选择物料」与行内「剪裁」两个入口都要 emit passSchemes');
  ok(src.indexOf('schemesOfRow(') >= 0, '取"某行已存方案"的逻辑要抽成一个 helper（两处共用）');
  ok(src.indexOf('b.chosenSchemes') >= 0, 'helper 必须读 BOM 行上的 chosenSchemes —— 方案是**已存的**，不许凭空造');
  const cut = fs.readFileSync(path.join(__dirname, '../pages/cut-editor/cut-editor.js'), 'utf8');
  ok(cut.indexOf("on('passSchemes'") >= 0, '裁剪页要监听 passSchemes');
  ok(cut.indexOf('initSchemes(payload)') >= 0, '裁剪页要有 initSchemes 做原位回填');
  ok(cut.indexOf('autoPlaceAll') > 0 && cut.indexOf('initSchemes(payload)') > 0,
    '回填走 initSchemes（不重排），autoPlaceAll 只在没有方案时兜底');
});
