// pages/cut-editor/cut-editor.js —— 裁剪排版（四区带）· 选料与裁剪合并成一步
//
// 2026-09-30 V83（用户 D102 / D103 / D105 定稿）：四区带 —— 布片选择 / 剪裁区 / 尺寸输入 / 确认
// 2026-09-30 V84：气泡 / 拖出布外画虚线 / 选中发光 / 单位换算
// 2026-09-30 V85：裁片不许跑出画布容器 / 输入框看得出能填 / 单位自己选（默认厘米）
// 2026-09-30 V86：**画布区一个字不放**（它随时会被拖动，任何文字都可能被压住）；画布按窗口自适应
// 2026-09-30 V90：一屏排完 —— 列出这批要裁的每一片，各片自填长宽、各自选布
//
// 2026-09-30 V91（用户三句话把这一屏的形态说全了）：
//   ① 「一件成品也可能用一个物料里的**两块布**，多片也要放到成品编辑的物料选择剪裁区」
//      ⇒ **两种进入方式合并成同一套代码**（不再有"单件模式"那套平行实现）：
//         · ?mode=queue（生产流程：做 N 件）→ 初始 N 片，回传 onChoose（逐件结构）
//         · ?id=…（成品编辑：选一块料）→ 初始 1 片，回传 onCutChosen（这一行用的**全部**片）
//   ② 「增加多个成品，但只需要一大片布、只裁一块怎么办」⇒ **件数与片数分开**：
//        顶上是「做 N 件」（件数），③ 区是「要裁 M 片」（片数）—— 加减片不动件数。
//        于是"4 件合起来裁一块"就是把片数减到 1（正是 V74「合起来剪」那件事）。
//        ⚠️ 扣料也跟着改：**给了逐件选择就按它扣，不再按件数补齐**（否则 4 件只裁 1 块会被补扣 3 次）。
//   ③ 「吸附要贴布的每一条边；布不规则时每条边都要能吸」「不能拖出布片范围」
//      ⇒ 吸附对象 = **布的整条轮廓**（外框 4 条 + 每个缺口 4 条 + 同屏别的裁片 4 条），
//        且 x/y 两个方向、裁片的"左/右边"与"右/左边"都算；拖到布边就停住，出不去。
//
// ⚠️ 记账时点：**这里不扣料**。点确定 = 这几块料选好了；真正扣料在保存成品 / produceProduct 时。
// ⚠️ 画布区一个字都不放（V86 铁律）：所有文字都在片列表 / 布片卡 / 底部那几行。
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const sheets = require('../../utils/sheets.js');

// V113c：480 是「并排多块」时代的遗产 —— V111 改**纵向堆叠**后，宽度才是稀缺维度，
// 480 只吃满屏宽的 64%（用户真机：「明明可以放大居中 为什么要放这么小」）。
// 660 = 750 − 2×28(pad) − 两侧各留 17rpx 呼吸；.board-stack 已把布块水平居中。
// ⚠️ 高度上限另看 BOARD_H_MAX —— 宽布吃宽度、方布吃高度，各守各的。
const BOARD_W = 660;      // 画布：**布本身**的宽度上限（rpx）
const BOARD_H_MAX = 380;  // 布本身的高度上限（rpx）
const BOARD_H_MIN = 200;  // 再挤也让布有这么高，不然没法看
const PAD_MAX = 80;       // 布四周的留白上限（rpx）
const PAD_MIN = 44;
const PAD_SMALL = 28;     // 并排多块布时的留白
const BOARD_GAP = 22;     // 并排时布与布的间隔（rpx）
const TH_W = 150;         // 布片选择区里的缩略图上限（rpx）
const TH_H = 110;
const CHROME_H = 700;     // 上下那些区大约吃掉的 rpx（单件）
const CHROME_H_MULTI = 1000;  // 排片模式还多一块「片列表」，更吃高度
const SNAP_RPX = 14;      // 吸附阈值：手指离轮廓线 14rpx 以内就吸（按屏幕算 ⇒ 布大布小手感一致）

// 画布可用高度（rpx）：按窗口高度算，保证整块画布放得下。
// ⚠️ 结果**缓存**：拖动时每帧都会 refresh，而 getWindowInfo 是同步桥调用。
let _availCache = {};
function canvasAvail(chrome) {
  const key = chrome || CHROME_H;
  if (_availCache[key] > 0) return _availCache[key];
  let info = {};
  try {
    info = (wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync && wx.getSystemInfoSync())) || {};
  } catch (e) { info = {}; }
  const w = Number(info.windowWidth) || 375;
  const h = Number(info.windowHeight) || 667;
  const winRpx = Math.round(h * 750 / w);
  _availCache[key] = Math.max(360, Math.min(760, winRpx - key));
  return _availCache[key];
}

// 把一个形状缩到给定尺寸（纯展示）。
// ⚠️ 坐标一律 **left / top**：世界坐标 y 朝上，这里一次性翻过来（V86 定的，别再引回 bottom 锚定）。
function scaleShape(shape, maxW, maxH) {
  if (!shape || !(shape.base.length > 0) || !(shape.base.width > 0)) return null;
  const s = Math.min(maxW / shape.base.length, maxH / shape.base.width);
  const at = (v) => Math.max(0, util.round(v * s, 2));
  const box = { w: util.round(shape.base.length * s, 1), h: util.round(shape.base.width * s, 1) };
  return {
    scale: s, w: box.w, h: box.h,
    holes: shape.holes.map((h, i) => ({
      k: i,
      left: at(h.x),
      top: util.round(box.h - (h.y + h.width) * s, 1),   // 翻转 y
      w: Math.max(1, at(h.length)), h: Math.max(1, at(h.width))
    }))
  };
}

// 屏幕偏移(px) → 布上的 cm 偏移（世界 y 向上，屏幕 y 向下 ⇒ 取反）
function pxDeltaToCm(dpx, dpy, pxPerCm) {
  if (!(pxPerCm > 0)) return { x: 0, y: 0 };
  return { x: dpx / pxPerCm, y: -dpy / pxPerCm };
}

function clampAt(v, lo, hi) {
  v = Number(v) || 0;
  // 上下限颠倒（裁片比布还大）→ 居中最稳
  if (lo > hi) return util.round((lo + hi) / 2, 2);
  return util.round(Math.min(hi, Math.max(lo, v)), 2);
}

// 一块布当前能不能放下 len×wid（不指定位置 → 交给几何内核找；正着放不下再试转 90°）
function sheetsFit(shape, len, wid) {
  if (!(len > 0) || !(wid > 0)) return false;
  if (sheets.placeNext(shape, len, wid)) return true;
  return util.round(len, 2) !== util.round(wid, 2) && !!sheets.placeNext(shape, wid, len);
}

// ---- 吸附（V91 用户：「贴布的每一条边；布不规则时每条边都要能吸」）----
//
// 规则一句话：**裁片的某条边，对齐轮廓的某条边**。
//   · 轮廓 = 外框 base 的 4 条边 + **每个缺口 holes 的 4 条边** + **同屏别的裁片的 4 条边**
//   · 一个障碍物 [s, s+span] 在某一轴上给出 4 个对齐位置：
//       s            （裁片的"下/左"边贴障碍物的"下/左"边）
//       s + span     （裁片的"下/左"边贴障碍物的"上/右"边）
//       s − size     （裁片的"上/右"边贴障碍物的"下/左"边）
//       s + span − size（裁片的"上/右"边贴障碍物的"上/右"边）
//   · size = 裁片在这一轴上的长度（x 用长、y 用宽）
// 上一版只取了「外框两端 + 缺口起点」，且只吸裁片的左/下边 —— 两头都漏，这里补全。
function snapAxis(shape, others, size, axis) {
  const pts = [];
  const kS = axis === 'x' ? 'x' : 'y';
  const kL = axis === 'x' ? 'length' : 'width';
  const base = (shape && shape.base) || null;
  if (base) pts.push(0, util.round(base[kL] - size, 2));
  const put = (o) => {
    if (!o) return;
    const s = util.round(o[kS], 2), span = util.round(o[kL], 2);
    pts.push(s, util.round(s + span, 2), util.round(s - size, 2), util.round(s + span - size, 2));
  };
  ((shape && shape.holes) || []).forEach(put);
  (others || []).forEach(put);
  return pts.filter((v) => isFinite(v));
}

// 离候选点 tol（cm）以内就吸过去。tol 由调用方按屏幕距离换算 ⇒ 布大布小手感一致
// （上一版写死 3cm：布 1 米时几乎没感觉、布 38cm 时又太贪）。
function snapVal(v, pts, tol) {
  let best = v, bd = tol;
  (pts || []).forEach((p) => {
    const d = Math.abs(v - p);
    if (d < bd) { bd = d; best = p; }
  });
  return best;
}

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  onShow() { themePage.apply(this); },   // 主题（V97）

  data: {
    // ---- 这一屏的全部状态（V91 起单件/多件共用同一套）----
    queueMode: false,  // true = 生产流程来的（回传 onChoose）；false = 成品编辑来的（回传 onCutChosen）
    qty: 1,            // **做几件**（件数）—— 与"片数"分开，见文件头 ②
    parts: [],         // 渲染视图：这次要裁的每一片（真数据在实例的 this.parts）
    pieces: [],        // ① 换布区：当前这一片可选的布（含"放得下"判定）
    boards: [],        // ② 剪裁区：用到的那几块布，各自摆着自己那几片
    active: 0,         // 当前在改哪一片
    // ---- V111：剪裁区**按物料分屏**（用户：「所有不同的布都放在一个界面 非常小不好操作」
    //      「分不清到底哪块儿布是哪块儿 只有一个尺寸」）----
    // 为什么单开一组：一屏只画**当前物料**的布块 ⇒ 布块能用**整宽**。
    //   老算法是 `可用宽 ÷ 布块数`（那是给"并排"用的），可布局其实是纵向堆叠
    //   ⇒ 白白被除一次，这才是"非常小"的技术根因（V111 一起修）。
    matIdx: 0,         // 当前在看第几个物料（swiper 的 current）
    matGroups: [],     // 按物料分好组的布块：一屏一组
    curMat: {},        // 当前物料的元信息（名 / 照片 / 第几个 / 共几个 / 这个物料要裁几片）
    // ---- V112：确认按钮当路标用（案B）----
    matSeen: [],        // 已经看过的物料 id —— 用户**滑过**才算看过，看过才放行
    remainCount: 0,     // 还剩几个没看（= 按钮上那个 N）
    confirmText: '就这样裁',   // 按钮文案：多物料时变成「还有 N 个物料 ›」
    unit: 'cm',        // 输入单位：'cm' | 'm'（**内部与回传一律 cm**，这里只管"用户怎么填"）
    canConfirm: false, // 每一片都摆好、都填了尺寸，才让确认
    loadErr: false,    // 收不到任务 / 物料不存在 → 给一句人话，绝不白屏（V80 的教训）
    dragging: false
  },

  onLoad(options) {
    const opt = options || {};
    this.shadow = {};    // { materialId: 影子布片[] } —— 算"这块布上还剩哪儿能用"（全程不落盘）
    this.parts = [];     // 这批要裁的每一片（真数据；data.parts 是它的渲染视图）
    this.matIds = [];    // 涉及到的物料（保持顺序）
    const ch = this.channel || (this.getOpenerEventChannel && this.getOpenerEventChannel());
    this.channel = ch;

    // ① 生产流程：任务由上一个页面通过 passQueue 送进来（做 N 件）
    if (opt.mode === 'queue') {
      this.queueMode = true;
      this.setData({ queueMode: true });
      if (ch && ch.on) ch.on('passQueue', (payload) => this.initQueue(payload));
      return;
    }

    // ② 成品编辑：「选择物料」点一块布 / 行内「剪裁」——**单件起排**（可以再加片：
    //    用户 2026-09-30「一件成品也可能用一个物料里的两块布」）
    const id = opt.id;
    const m = id ? store.getMaterial(id) : null;
    if (!m) { this.setData({ loadErr: true }); return; }
    this.parts = [{
      no: 1, pieceNo: 1,
      materialId: id, materialName: m.name,
      len: opt.len ? util.round(opt.len, 2) : 0,    // cm（0 = 还没填）
      wid: opt.wid ? util.round(opt.wid, 2) : 0,
      rot: false, at: { x: 0, y: 0 }, pieceId: null
    }];
    this.matIds = [id];
    this.setData({ qty: 1, loadErr: false, active: 0 });
    this.autoPlaceAll();
    this.renderParts();
    // ⭐ V120：上游若带了这一行**已存的裁剪方案**（再次编辑那条路），把它**原位**带回来 ——
    //   用户 2026-10-06：「同一张布剪两片…再打开之后是一片」+「保存成品之后再编辑时布片也是 1 片」。
    //   ⚠️ 先按默认一片兜底、再监听：上游万一没递（物料详情等老入口）也照旧能用。
    if (ch && ch.on) ch.on('passSchemes', (payload) => this.initSchemes(payload));
  },

  // ---- 初始化：把队列展开成"这批要裁的每一片" ----
  // 队列 = 件 × 面料行，展开后每条就是一片；每片**各自**记自己的尺寸 / 布 / 位置。
  initQueue(payload) {
    const queue = (payload && payload.queue) || [];
    const qty = Math.max(1, Number(payload && payload.qty) || 1);
    if (!queue.length) { this.setData({ loadErr: true }); return; }
    this.parts = queue.map((t, i) => ({
      no: i + 1,
      pieceNo: Math.max(1, Number(t.pieceNo) || 1),
      materialId: t.materialId,
      materialName: t.materialName || '',
      len: util.round(t.redLen, 2),      // cm —— 只是**预填**，用户能改
      wid: util.round(t.redWid, 2),
      rot: false,
      at: { x: 0, y: 0 },
      pieceId: null
    }));
    this.matIds = [];
    this.parts.forEach((p) => {
      if (this.matIds.indexOf(p.materialId) < 0) this.matIds.push(p.materialId);
    });
    this.setData({ qty: qty, loadErr: false, active: 0 });
    this.syncNavTitle();
    this.autoPlaceAll();
    this.renderParts();
  },

  // V120：把上游带回来的**已存裁剪方案**恢复成 parts（每片一项）。
  //   · 用哪块布 / 转没转 / 摆在哪**全部照旧** —— 用户上次摆好的位置，绝不能重排
  //     （所以这里**不调 autoPlaceAll**，只把影子/缺口重算一遍）。
  //   · 收到空方案 = 保持 onLoad 建的默认一片（第一次进来 / 从物料详情进来）。
  initSchemes(payload) {
    const list = ((payload && payload.schemes) || []).filter((s) => s && s.pieceId);
    if (!list.length) return;
    this.parts = list.map((s, i) => {
      const mm = store.getMaterial(s.materialId) || {};
      return {
        no: i + 1, pieceNo: 1,
        materialId: s.materialId, materialName: mm.name || '',
        len: util.round(s.length, 2), wid: util.round(s.width, 2),
        rot: !!s.rotate,
        at: (s.at && s.at.x != null && s.at.y != null) ? { x: s.at.x, y: s.at.y } : { x: 0, y: 0 },
        pieceId: s.pieceId
      };
    });
    this.matIds = [];
    this.parts.forEach((pp) => { if (this.matIds.indexOf(pp.materialId) < 0) this.matIds.push(pp.materialId); });
    this.setData({ active: 0 });
    this.rebuildShadow(-1);
    this.renderParts();
  },

  // V120：把上游带回来的**已存裁剪方案**恢复成 parts（每片一项）。
  //   · 用哪块布 / 转没转 / 摆在哪**全部照旧** —— 用户上次摆好的位置，绝不能重排
  //     （所以这里**不调 autoPlaceAll**，只把影子/缺口重算一遍）。
  //   · 收到空方案 = 保持 onLoad 建的默认一片（第一次进来 / 从物料详情进来）。
  initSchemes(payload) {
    const list = ((payload && payload.schemes) || []).filter((s) => s && s.pieceId);
    if (!list.length) return;
    this.parts = list.map((s, i) => {
      const mm = store.getMaterial(s.materialId) || {};
      return {
        no: i + 1, pieceNo: 1,
        materialId: s.materialId, materialName: mm.name || '',
        len: util.round(s.length, 2), wid: util.round(s.width, 2),
        rot: !!s.rotate,
        at: (s.at && s.at.x != null && s.at.y != null) ? { x: s.at.x, y: s.at.y } : { x: 0, y: 0 },
        pieceId: s.pieceId
      };
    });
    this.matIds = [];
    this.parts.forEach((pp) => { if (this.matIds.indexOf(pp.materialId) < 0) this.matIds.push(pp.materialId); });
    this.setData({ active: 0 });
    this.rebuildShadow(-1);
    this.renderParts();
  },

  // 影子复位 = 各物料当前布片的副本，再把"除 skip 之外的所有片"的占位挖掉。
  // 这样后面找位置的片看到的才是"这块布上还剩哪儿能用"—— 同一块布上不会两片叠着。
  rebuildShadow(skip) {
    this.shadow = {};
    this.matIds.forEach((mid) => {
      const m = store.getMaterial(mid);
      this.shadow[mid] = ((m && m.pieces) || []).slice();
    });
    this.parts.forEach((p, i) => {
      if (i === skip || !p.pieceId || !(p.len > 0) || !(p.wid > 0)) return;
      const m = store.getMaterial(p.materialId);
      const fw = (m && m.fabricWidth) || 0;
      const L = p.rot ? p.wid : p.len, W = p.rot ? p.len : p.wid;
      const next = store.applyCutToPieces(this.shadow[p.materialId], p.pieceId, L, W, fw, p.at);
      if (next) this.shadow[p.materialId] = next;
    });
  },

  // 给一片找落脚处：优先 preferId 那块布，不行就按顺序找一块放得下的；都不行 → pieceId = null。
  //
  // 试**方向**的顺序（V93）：
  //   · 默认（不传 preferRot）：先不转、放不下才转 —— 布有织向，能不动就不动
  //   · 用户明确点了「转 90°」（preferRot = true）：先按**他要的那个方向**试，
  //     在这块布上实在放不下才退回另一个方向（退回时调用方会告诉他一声，**不静默**）
  // ⚠️ 方向是**每块布分别**试的：用户选的这块布放不下、另一块能放下，那就换一块布
  //    （与"没位置就找别的布"同一个口径）。
  placePart(p, preferId, preferRot) {
    const m = store.getMaterial(p.materialId);
    const fw = (m && m.fabricWidth) || 0;
    const list = (this.shadow[p.materialId] || []).filter(x => x.status === 'in');
    // 尺寸还没填：先挂到布上（不占位），等填了尺寸再正式排位置 —— 别一进来就"没地方放"。
    // ⚠️ preferId 也得认：否则"换布"在尺寸为空时会被无视，永远挂回第一块布
    //    （跨页测试 ⑤ 抓过这个）。
    if (!(p.len > 0) || !(p.wid > 0)) {
      const hit = preferId ? list.find(x => x.id === preferId) : null;
      const pickOne = hit || list[0] || null;
      p.pieceId = pickOne ? pickOne.id : null;
      p.at = { x: 0, y: 0 };
      return !!pickOne;
    }
    const order = [];
    if (preferId) {
      const hit = list.find(x => x.id === preferId);
      if (hit) order.push(hit);
    }
    list.forEach((x) => { if (order.indexOf(x) < 0) order.push(x); });

    // 正方形只有一个方向，转不转一样 —— 别把同一件事试两遍
    const square = util.round(p.len, 2) === util.round(p.wid, 2);
    const rots = square ? [false] : (preferRot ? [!!p.rot, !p.rot] : [false, true]);
    for (let i = 0; i < order.length; i++) {
      const pc = order[i];
      const sh = store.pieceShape(pc);
      if (!sh) continue;
      for (let ri = 0; ri < rots.length; ri++) {
        const rot = rots[ri];
        const L = rot ? p.wid : p.len, W = rot ? p.len : p.wid;
        const spot = sheets.placeNext(sh, L, W);
        if (!spot) continue;
        p.pieceId = pc.id;
        p.rot = rot;
        p.at = { x: util.round(spot.x, 2), y: util.round(spot.y, 2) };
        const next = store.applyCutToPieces(this.shadow[p.materialId], pc.id, L, W, fw, p.at);
        if (next) this.shadow[p.materialId] = next;
        return true;
      }
    }
    p.pieceId = null;
    p.at = { x: 0, y: 0 };
    return false;
  },

  autoPlaceAll() {
    this.rebuildShadow(-1);
    this.parts.forEach((p) => {
      p.pieceId = null;
      this.placePart(p, null);
    });
    this.rebuildShadow(-1);
  },

  // 导航栏标题：把「做 N 件」放进标题行（V112 用户：「做2件 放在最上面，剪裁排版后边」）
  // ⚠️ 为什么必须用运行时 API：navigationBarTitleText 是**打包时定死**的，写不进动态件数。
  //    只有 queueMode（做 N 件）才带件数；单物料那次就是一件，不必显示。
  // 📌 与「运行时改不动的值由默认主题迁就它」那条同源：**打包期定死的，只能靠能改的那个 API**。
  syncNavTitle() {
    if (typeof wx === 'undefined' || typeof wx.setNavigationBarTitle !== 'function') return;
    const n = this.queueMode ? Math.max(1, Number(this.data.qty) || 1) : 1;
    const t = n > 1 ? ('裁剪排版 · ' + n + '件') : '裁剪排版';
    this.__navTitle = t;
    wx.setNavigationBarTitle({ title: t });
  },

  // 物料清单 = 实际 parts 里出现过的物料（按首次出现排序）。
  // ⚠️ 每次渲染都重算：加减片会改变这个集合 —— 删掉某物料的最后一片，它就不该再占一屏。
  //    （onLoad / initQueue 里那份只是初始值，不能当唯一真相。）
  syncMatIds() {
    const ids = [];
    this.parts.forEach((p) => { if (ids.indexOf(p.materialId) < 0) ids.push(p.materialId); });
    this.matIds = ids;
  },

  // ---- 渲染收口 ----
  renderParts() {
    // 物料清单以**实际 parts** 为准（加减片会变）—— 别用 onLoad 时那份快照
    this.syncMatIds();
    const matIds = this.matIds;
    const idx = Math.max(0, Math.min(Number(this.data.matIdx) || 0, Math.max(0, matIds.length - 1)));
    const act = this.parts[this.data.active] || this.parts[0] || null;
    // ① 换布区：当前这一片所属物料的在库布片，按**这一片**的尺寸判"放得下/放不下"
    // ⚠️ V113c：尺寸还没填时**不许下结论** —— sheetsFit 对 0×0 恒 false，
    //   换布卡会一进来就全员「✕ 放不下」（用户真机：「我这还没输入尺寸呢，怎么就说放不下了」）。
    //   placePart 的口径早就是「尺寸没填先挂着、不占位」，这里跟它对齐：
    //   没填尺寸 ⇒ sized = false，换布卡给中性提示「填尺寸后判断」。
    const pieces = [];
    if (act) {
      const sized = !!(act.len > 0 && act.wid > 0);
      const m = store.getMaterial(act.materialId);
      ((m && m.pieces) || []).filter(x => x.status === 'in').forEach((x) => {
        const shape = store.pieceShape(x);
        pieces.push({
          id: x.id,
          label: util.round(x.length, 0) + '×' + util.round(x.width, 0),
          offcut: store.isPieceOffcut(x, m.fabricWidth),
          sized: sized,
          fits: sized && !!(shape && sheetsFit(shape, act.len, act.wid)),
          on: x.id === act.pieceId,
          thumb: scaleShape(shape, TH_W, TH_H),
          shape: shape
        });
      });
    }
    const unit = this.data.unit;
    const show = (p, key) => {
      if (p[key + 'Raw'] != null) return p[key + 'Raw'];
      const cm = p[key];
      if (!(cm > 0)) return '';
      // 内部一律 cm；要按米显示时现换（只是"显示语言"，账的口径一个字不动）
      return String(unit === 'cm' ? util.round(cm, 2) : util.round(util.fromCm(cm, unit), 4));
    };
    // ⚠️ 先算画布（绿/红就出在这里），再据此判定「这一片是不是放不下」（V94）——
    //    红 = 这一片**超出布边 / 压在已有缺口上** ⇒ 那一刀根本裁不出来，必须进确认闸。
    //    用户真机截图问的就是这件事：「剪裁区都红了，还能点用这块料？」
    //    （原先 canConfirm 只判「填了尺寸 + 有布」，红压根没进闸）
    // ② 剪裁区：**按物料分组** —— swiper 一屏一个物料，屏内是它的布块（纵向堆叠）
    const groups = matIds.map((mid, k) => {
      const m = store.getMaterial(mid) || {};
      // V112：没照片时用「物料名首字 + 分类色」占位（store.materialThumb = 与物料列表同一口径）
      const th = store.materialThumb(m);
      return {
        matId: mid,
        matName: m.name || '',
        photo: th.photo,              // 物料详情里的那张照片（同物料列表页字段）
        placeholder: th.placeholder,  // 没图时显示的首字
        phColor: th.color,            // 占位底色（物料分类色）
        phInk: th.ink,                // 占位墨色
        no: k + 1,
        total: matIds.length,
        boards: this.buildBoards(mid)        // ★ 只算这个物料的
      };
    });
    const cur = groups[idx] || null;
    // 红片统计要**跨物料**扫 —— "放不下"是全局判定，跟当前在看哪个物料无关
    const redOf = {};
    groups.forEach((g) => {
      (g.boards || []).forEach((bd) => {
        (bd.cuts || []).forEach((c) => { if (!c.ok) redOf[c.no] = true; });
      });
    });
    const parts = this.parts.map((p, i) => {
      const noSize = !(p.len > 0) || !(p.wid > 0);
      const noFit = !noSize && !p.pieceId;
      const red = !noSize && !noFit && !!redOf[p.no];
      return {
        no: p.no,
        pieceNo: p.pieceNo,
        materialName: p.materialName,
        len: show(p, 'len'),
        wid: show(p, 'wid'),
        boardLabel: noFit ? '没地方放' : (red ? '放不下' : this.boardLabel(p.pieceId)),
        rot: !!p.rot,                     // 「转 90°」这一行的开关状态（V93）
        active: i === this.data.active,
        noSize: noSize,
        noFit: noFit,
        red: red,
        bad: noFit || red,                // 行标红（wxml 只认一个类）
        // V111：这一片属不属于**当前正在看**的那个物料（片列表只列当前物料的片）
        inCurMat: !!cur && p.materialId === cur.matId
      };
    });
    const curView = parts.filter(x => x.inCurMat);
    // ---- V112 案B：确认按钮本身就是路标 ----
    // ⚠️ 这条为什么要专门做（用户 2026-10-04：「可以不往右滑就直接点就这样裁
    //    用户可能会忽略第二个物料的剪裁」）——
    //    查实根因不是"用户会忽略"，而是 **autoPlaceAll() 已经替第二个物料排好了**：
    //    队列展开成 parts → 自动给所有片摆位置 → canConfirm 全绿 → 按钮点得下去。
    //    也就是说"系统替他做了决定"，靠提示语是治不好的。
    // ⇒ 改成「**看过一遍才放行**」：记录已看过的物料，还剩 N 个没看时按钮就叫
    //   「还有 N 个物料 ›」，点了直接跳到下一个没看���；全看过了才变回「就这样裁」。
    //    📌 这样"记得还有第二个"这件事**不靠用户记**，按钮本身一直在说。
    const seen = (this.data.matSeen || []).slice();
    if (cur && seen.indexOf(cur.matId) < 0) seen.push(cur.matId);   // 正在看的就是看过了
    const remain = groups.filter(g => seen.indexOf(g.matId) < 0);
    const allOk = parts.length > 0 && parts.every(x => !x.noFit && !x.noSize && !x.red);

    this.setData({
      pieces: pieces,
      // ⚠️ `boards` 保留成「**当前物料的**布块」（不是全部）—— 旧逻辑与既有测试都读它；
      //    "全部物料的"那份在 `matGroups` 里（swiper 一屏一个）。
      boards: cur ? cur.boards : [],
      matGroups: groups,
      matIdx: idx,
      matSeen: seen,
      // 按钮三态：多物料且还有没看的 → 「还有 N 个物料 ›」；否则 →「就这样裁」
      remainCount: remain.length,
      confirmText: remain.length > 0 ? ('还有 ' + remain.length + ' 个物料 ›') : '就这样裁',
      // ⚠️ 只有"全都看过了"才让确认 —— 这才是把 autoPlaceAll 替用户做的决定收回来的地方
      canConfirm: allOk && remain.length === 0,
      curMat: cur ? {
        matId: cur.matId, matName: cur.matName, photo: cur.photo,
        placeholder: cur.placeholder, phColor: cur.phColor, phInk: cur.phInk,
        no: cur.no, total: cur.total, partCount: curView.length,
        // 这个物料自己好没好（标题行显示用）；**全局放行**仍然只看 canConfirm
        ok: curView.length > 0 && curView.every(x => !x.bad && !x.noSize)
      } : {},
      parts: parts
    });
    // 标题里的件数跟着 qty 走 —— 只在**真的变了**时才调原生 API（setNavigationBarTitle
    // 是跨线程调用，拖动裁片时每帧都 renderParts，不能无条件调）
    if (this.__navTitle !== undefined) {
      const n = this.queueMode ? Math.max(1, Number(this.data.qty) || 1) : 1;
      const want = n > 1 ? ('裁剪排版 · ' + n + '件') : '裁剪排版';
      if (want !== this.__navTitle) this.syncNavTitle();
    }
  },

  // 拖动时只重算剪裁区（片列表 / 换布区都没变，不必跟着重复 setData —— setData 是过桥的）
  refreshBoards() {
    const idx = Number(this.data.matIdx) || 0;
    const mid = (this.matIds || [])[idx];
    const bs = this.buildBoards(mid);
    const patch = { boards: bs };
    // ⚠️ 画面读的是 `matGroups`（swiper 里那一屏），所以这里**必须同时**更新它 ——
    //    只更新 `boards` 的话，拖动时绿/红块根本不动（"改一处要联动另一处"的老坑，V83 踩过）。
    if (this.data.matGroups && this.data.matGroups[idx]) {
      patch['matGroups[' + idx + '].boards'] = bs;
    }
    this.setData(patch);
  },

  // 这块布属于哪个物料 / 它的形状（板子和标签都要用）
  pieceRef(pieceId) {
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (p.pieceId !== pieceId) continue;
      const m = store.getMaterial(p.materialId);
      const pc = ((m && m.pieces) || []).find(x => x.id === pieceId);
      if (pc) return { pc: pc, matId: p.materialId, shape: store.pieceShape(pc) };
    }
    return null;
  },

  boardLabel(pid) {
    if (!pid) return '没地方放';
    const ref = this.pieceRef(pid);
    return ref ? util.round(ref.pc.length, 0) + '×' + util.round(ref.pc.width, 0) : '—';
  },

  // ② 剪裁区：用到的那几块布**纵向堆叠**（布多了也不横着挤），各自摆着自己那几片
  buildBoards(matId) {
    const ids = [];
    this.parts.forEach((p) => {
      if (matId && p.materialId !== matId) return;      // ★ V111：只算**这个物料**的布块
      if (p.pieceId && ids.indexOf(p.pieceId) < 0) ids.push(p.pieceId);
    });
    if (!ids.length) return [];
    const n = ids.length;
    const avail = canvasAvail(CHROME_H_MULTI);
    const pad = PAD_SMALL;
    // ⚠️ V111 修「非常小」：布块是**纵向堆叠**的（`.board-stack` 是竖着的 flex）
    //   ⇒ 宽度该用**整宽**（BOARD_W），而不是 `可用宽 ÷ 布块数`（那个除法是"并排"才需要的）。
    //   上一版两处叠在一起：横向先被除 n、纵向又各占一段 ⇒ **双重挤压**，
    //   两块布就已经小到不好拖（用户真机截图就是这个）。
    //   现在只按**高度**分配：每块分到 `(可用高 − 上下留白 − 块间间隙) ÷ 块数`。
    const maxW = BOARD_W;
    const maxH = Math.max(120, Math.min(BOARD_H_MAX,
      (avail - 2 * pad - (n - 1) * BOARD_GAP) / n));
    const out = [];
    ids.forEach((pid, k) => {
      const ref = this.pieceRef(pid);
      if (!ref || !ref.shape) return;
      const shape = ref.shape;
      // 等比缩放到"既不超宽也不超高" —— 取小的那个比例 = **尽量占满剪裁区**
      //（用户：「布块尽量占满剪裁区 居中 不超边界」）
      const sc = Math.min(maxW / shape.base.length, maxH / shape.base.width);
      const bw = util.round(shape.base.length * sc, 1);
      const bh = util.round(shape.base.width * sc, 1);
      const holes = (scaleShape(shape, bw, bh) || {}).holes || [];
      const mine = [];
      this.parts.forEach((p, i) => { if (p.pieceId === pid) mine.push({ p: p, i: i }); });

      const cuts = mine.map((it) => {
        const p = it.p;
        const L = p.rot ? p.wid : p.len, W = p.rot ? p.len : p.wid;
        // ⚠️ 同一块布上**别的片**占的地方，要当作"已有缺口"从这块布上扣掉再算绿红。
        //    不扣的话两片叠着也会显示绿色 —— 用户以为排得下，落盘时才发现挤不下。
        const others = mine.filter(o => o.i !== it.i).map(o => sheets.rect({
          x: o.p.at.x, y: o.p.at.y,
          length: o.p.rot ? o.p.wid : o.p.len,
          width: o.p.rot ? o.p.len : o.p.wid
        }));
        // ⚠️ 这里**只能**自己拼 `{ base, holes }`，不能调 sheets.subtractAll ——
        //    那个函数的契约是「**矩形入参 → 矩形数组出参**」；把"一整块布"塞进去，
        //    它取不到长宽会**静默返回空数组**，于是 splitByFree 拿到 base:null、
        //    一律判"整块放不下" ⇒ **每一片都整块标红**（V90 就是这么错的；测试 ⑩ 钉着）。
        const sh = others.length
          ? { base: shape.base, holes: (shape.holes || []).concat(others) }
          : shape;
        const sp = (L > 0 && W > 0)
          ? sheets.splitByFree(sh, { x: p.at.x, y: p.at.y, length: L, width: W })
          : { ok: false, green: [], red: [] };
        const toView = (rs) => (rs || []).map((r, k) => {
          const hh = Math.max(1, util.round(r.width * sc, 1));
          return {
            k: k,
            left: util.round(pad + r.x * sc, 1),
            top: util.round(pad + bh - (r.y * sc + hh), 1),   // 世界 y 朝上 → 屏幕朝下
            w: Math.max(1, util.round(r.length * sc, 1)),
            h: hh
          };
        });
        return {
          no: p.no, active: it.i === this.data.active, ok: !!sp.ok,
          green: toView(sp.green), red: toView(sp.red),
          boxLeft: util.round(pad + p.at.x * sc, 1),
          boxTop: util.round(pad + bh - (p.at.y * sc + W * sc), 1),
          boxW: Math.max(1, util.round(L * sc, 1)),
          boxH: Math.max(1, util.round(W * sc, 1))
        };
      });

      const offcut = store.isPieceOffcut(ref.pc, (store.getMaterial(ref.matId) || {}).fabricWidth);
      out.push({
        pieceId: pid, matId: ref.matId,
        label: util.round(ref.pc.length, 0) + '×' + util.round(ref.pc.width, 0),
        // V111：每块布的身份标识。⚠️ 布片**在数据里没有名字**（只有长/宽/状态/位置），
        //   所以这里给一个「**仅供这一屏显示**」的序号 —— 按它在这个物料里的顺序排，
        //   不落盘、也不会因为拖动而变；同一物料两块布尺寸一样时也能分清。
        tag: '布片 ' + (k + 1) + ' · ' + util.round(ref.pc.length, 0) + '×' +
             util.round(ref.pc.width, 0) + ' · ' + (offcut ? '碎料' : '整布'),
        w: bw, h: bh, sc: sc, pad: pad,
        cmW: shape.base.length, cmH: shape.base.width,
        holes: holes,
        wrapW: util.round(bw + 2 * pad, 1),
        wrapH: util.round(bh + 2 * pad, 1),
        cuts: cuts
      });
    });
    return out;
  },

  // ---- 交互 ----
  // 左右滑剪裁区 = **换物料**（V111 用户：「剪裁区左右滑是区分不同的物料」）。
  // ⚠️ 这是"物料"那一层；①区那排布片卡是"布片"那一层（同一物料内换布）—— 别混。
  onMatSwipe(e) {
    const i = Number((e.detail || {}).current);
    this.goMat(isFinite(i) ? i : 0);
  },

  // 切到第 i 个物料：顺手把"当前在改的那一片"对齐过去。
  // 为什么必须一起动：①区（换布）列的是**active 那一片所属物料**的布片 ——
  //   两者不同一个物料，就会出现"看着 A 物料的布、其实在改 B 物料的片"。
  goMat(i) {
    const ids = this.matIds || [];
    if (!ids.length) return;
    const idx = Math.max(0, Math.min(Number(i) || 0, ids.length - 1));
    let a = Number(this.data.active) || 0;
    const ap = this.parts[a];
    if (!ap || ap.materialId !== ids[idx]) {
      const k = this.parts.findIndex(p => p.materialId === ids[idx]);
      if (k >= 0) a = k;
    }
    this.setData({ matIdx: idx, active: a });
    this.renderParts();
  },

  // 跳到**下一个还没看过的物料**（V112 案B 的按钮行为）。
  // 找法：从当前这一屏往后找，找不到就从 0 开始绕一圈 —— 保证一定能跳到一个没看过的。
  goNextUnseen() {
    const ids = this.matIds || [];
    if (ids.length < 2) return;
    const seen = this.data.matSeen || [];
    const cur = Number(this.data.matIdx) || 0;
    for (let k = 1; k <= ids.length; k++) {
      const j = (cur + k) % ids.length;
      if (seen.indexOf(ids[j]) < 0) { this.goMat(j); return; }
    }
  },

  pickPart(e) {
    const i = Number((e.currentTarget.dataset || {}).i);
    const p = this.parts[i];
    if (!p || i === this.data.active) return;
    // 点的那一片若属于**别的物料** ⇒ 连剪裁区一起切过去（否则列表说 A、画布画 B）
    const mi = (this.matIds || []).indexOf(p.materialId);
    if (mi >= 0 && mi !== this.data.matIdx) {
      this.setData({ matIdx: mi, active: i });
      this.renderParts();
      return;
    }
    this.setData({ active: i });
    this.renderParts();
  },

  setPartLen(e) { this.editSize(e, 'len'); },
  setPartWid(e) { this.editSize(e, 'wid'); },
  // 改一片的尺寸：**只动这一片**，然后给它重新找位置。
  // 原处放不下了就自动找别的布（别动不动就"没地方放" —— 那等于把麻烦丢回给用户）。
  editSize(e, key) {
    const i = Number((e.currentTarget.dataset || {}).i);
    const p = this.parts[i];
    if (!p) return;
    const raw = ((e.detail || {}).value == null) ? '' : String((e.detail || {}).value);
    const v = Number(raw);
    // ⚠️ 内部一律换算成 **cm**（几何、扣料、回传都用它）；raw 只是"用户输入的原样"，用于回填显示
    p[key === 'len' ? 'lenRaw' : 'widRaw'] = raw;
    p[key] = v > 0 ? util.round(util.toCm(v, this.data.unit), 2) : 0;
    this.rebuildShadow(i);
    this.placePart(p, p.pieceId);
    this.rebuildShadow(-1);
    if (this.data.active !== i) this.setData({ active: i });
    this.renderParts();
  },

  // ---- 每片自己转 90°（V93）----
  // 布有织向：摆哪个方向是**用户的决定**（用户 D103：「剪裁区不是两个方案，是我随意拖动旋转」）。
  // 系统只在"用户没表态"时才自动兜（先不转、放不下才转）。
  // ⚠️ 是个**开关**：再点一次转回来。转不开时**不硬转**，回到原来的方向并说一句。
  rotPart(e) {
    const i = Number((e.currentTarget.dataset || {}).i);
    const p = this.parts[i];
    if (!p) return;
    if (!(p.len > 0) || !(p.wid > 0)) { util.toast('先填这一片的长和宽'); return; }
    if (util.round(p.len, 2) === util.round(p.wid, 2)) { util.toast('正方形，转不转都一样'); return; }

    const want = !p.rot;
    p.rot = want;
    this.rebuildShadow(i);
    const placed = this.placePart(p, p.pieceId, true);
    this.rebuildShadow(-1);
    if (this.data.active !== i) this.setData({ active: i });

    if (!placed) util.toast('这块布放不下，换一块布或改改尺寸');
    else if (p.rot !== want) util.toast('这个方向在这块布上放不下，还是按原来的方向放的');
    this.renderParts();
  },

  // 单位切换：**只换"显示语言"**，内部与回传仍是 cm（账的口径一个字不动）
  pickUnit(e) {
    const nu = (e.currentTarget.dataset || {}).u;
    if ((nu !== 'cm' && nu !== 'm') || nu === this.data.unit) return;
    this.parts.forEach((p) => {
      ['len', 'wid'].forEach((k) => {
        const cm = p[k];
        p[k + 'Raw'] = cm > 0 ? String(util.round(util.fromCm(cm, nu), 4)) : '';
      });
    });
    this.setData({ unit: nu });
    this.renderParts();
  },

  // ① 换布：把**当前这一片**挪到点的那块布上（那块布放不下就不动，说一句）
  pickBoard(e) {
    const id = (e.currentTarget.dataset || {}).id;
    const i = Number(this.data.active) || 0;
    const p = this.parts[i];
    if (!p || !id || p.pieceId === id) return;
    const keep = { pieceId: p.pieceId, at: Object.assign({}, p.at), rot: p.rot };
    this.rebuildShadow(i);
    if (!this.placePart(p, id)) {
      p.pieceId = keep.pieceId; p.at = keep.at; p.rot = keep.rot;
      util.toast(util.round(p.len, 0) + '×' + util.round(p.wid, 0) + ' 放不进那块布');
    }
    this.rebuildShadow(-1);
    this.renderParts();
  },

  // ---- 片数（与**件数**分开：加减片不动件数 —— V91 用户要的「做 4 件只裁一块」）----
  // 加一片：继承当前这一片的物料与尺寸、并留在**同一件**里
  //（「一件成品也可能用一个物料里的两块布」就是靠这个）
  addPiece() {
    const src = this.parts[this.data.active] || this.parts[0];
    if (!src) return;
    let maxNo = 0;
    this.parts.forEach((p) => { maxNo = Math.max(maxNo, p.no); });
    const np = {
      no: maxNo + 1,
      pieceNo: src.pieceNo,
      materialId: src.materialId,
      materialName: src.materialName,
      len: src.len, wid: src.wid,
      rot: false, at: { x: 0, y: 0 }, pieceId: null
    };
    this.rebuildShadow(-1);
    this.parts.push(np);
    this.placePart(np, src.pieceId);
    this.rebuildShadow(-1);
    this.setData({ active: this.parts.length - 1 });
    this.renderParts();
    util.toast('加了一片（第 ' + np.pieceNo + ' 件）');
  },

  removePiece() {
    if (this.parts.length <= 1) { util.toast('至少留一片'); return; }
    const act = this.data.active;
    this.parts.splice(act, 1);
    this.parts.forEach((p, i) => { p.no = i + 1; });
    this.setData({ active: Math.min(act, this.parts.length - 1) });
    this.rebuildShadow(-1);
    this.renderParts();
  },

  // 按在片上 = 选中它 + 开始拖它
  onPieceDown(e) {
    const no = Number((e.currentTarget.dataset || {}).no);
    const i = this.parts.findIndex(p => p.no === no);
    if (i < 0) return;
    const p = this.parts[i];
    const t = e.touches && e.touches[0];
    const bd = (this.data.boards || []).find(b => b.pieceId === p.pieceId) || null;
    // 拖动时要吸附/避开的"别的裁片"（同一块布上除自己以外的片）
    const others = [];
    this.parts.forEach((q, k) => {
      if (k === i || q.pieceId !== p.pieceId) return;
      if (!(q.len > 0) || !(q.wid > 0)) return;
      others.push(sheets.rect({
        x: q.at.x, y: q.at.y,
        length: q.rot ? q.wid : q.len,
        width: q.rot ? q.len : q.wid
      }));
    });
    const ref = p.pieceId ? this.pieceRef(p.pieceId) : null;
    this.drag = {
      i: i, sx: t ? t.clientX : 0, sy: t ? t.clientY : 0,
      ax: p.at.x, ay: p.at.y,
      sc: bd ? bd.sc : 1,
      shape: ref ? ref.shape : null,
      others: others,
      snapCm: (bd && bd.sc > 0) ? (SNAP_RPX / bd.sc) : 0
    };
    if (this.data.active !== i) this.setData({ active: i });
    this.setData({ dragging: true });
    this.renderParts();
  },

  onPieceMove(e) {
    if (!this.drag) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const p = this.parts[this.drag.i];
    if (!p) return;
    const per = this.pxPerCmOf(this.drag.sc);
    const d = pxDeltaToCm(t.clientX - this.drag.sx, t.clientY - this.drag.sy, per);
    let nx = this.drag.ax + d.x, ny = this.drag.ay + d.y;
    // 吸附：贴布的外框 / 贴缺口 / 贴**别的裁片** —— 轮廓的每一条边（V91）
    const L = p.rot ? p.wid : p.len, W = p.rot ? p.len : p.wid;
    if (this.drag.shape && this.drag.snapCm > 0) {
      nx = snapVal(nx, snapAxis(this.drag.shape, this.drag.others, L, 'x'), this.drag.snapCm);
      ny = snapVal(ny, snapAxis(this.drag.shape, this.drag.others, W, 'y'), this.drag.snapCm);
    }
    p.at = { x: util.round(nx, 1), y: util.round(ny, 1) };
    this.clampPart(p, this.drag.sc);
    this.refreshBoards();
  },

  // ⚠️ 松手时必须**整套重算**（不只是画布）：拖动会改变"这一片是否压在缺口上"，
  //    片列表的标红与「就这样裁」的置灰都跟着它（V94）。
  //    以前只 setData({dragging:false})，行状态就停在拖之前了 —— 这正是本项目第 N 次
  //    「改一处要联动另一处」的坑（V83 的教训）。
  onPieceUp() {
    if (!this.drag) return;
    this.drag = null;
    this.setData({ dragging: false });
    this.renderParts();
  },

  // 布上 1cm = 多少屏幕 px（sc 是 rpx/cm，rpx → px 要按窗口宽折算）
  pxPerCmOf(sc) {
    if (!(sc > 0)) return 1;
    const winW = (wx.getSystemInfoSync && wx.getSystemInfoSync().windowWidth) || 375;
    return sc * winW / 750;
  },

  // ⚠️ 裁片必须**整个待在布内**（V91 用户：「拖到边上吸住，就不能再往外拖了」）。
  //    上一版允许拖到画布留白里（"出界画红虚线"，V84 要的）—— 现在按用户新要求收回来。
  //    裁片本身比布还大时上下限会颠倒，clampAt 会把它居中，红色部分照旧显示。
  clampPart(p, sc) {
    const bd = (this.data.boards || []).find(b => b.pieceId === p.pieceId);
    if (!bd) return;
    const L = p.rot ? p.wid : p.len, W = p.rot ? p.len : p.wid;
    p.at = {
      x: clampAt(p.at.x, 0, util.round(bd.cmW - L, 2)),
      y: clampAt(p.at.y, 0, util.round(bd.cmH - W, 2))
    };
  },

  cancel() { wx.navigateBack(); },

  // 回传的一条"这一片怎么裁"（两种模式共用同一种形状）
  pickOf(p) {
    return {
      materialId: p.materialId, materialName: p.materialName,
      length: util.round(p.len, 2), width: util.round(p.wid, 2),
      pieceId: p.pieceId, rotate: !!p.rot,
      at: { x: util.round(p.at.x, 2), y: util.round(p.at.y, 2) }
    };
  },

  // 全程**不落盘**：真正扣料在 produceProduct / saveProduct ⇒ 中途取消 = 什么都没发生
  confirm() {
    // ⚠️ V112 案B：还有物料没看过 → 这按钮是"路标"，不是"确认"。点了带他去下一个。
    //    （必须放在所有尺寸校验**之前**：autoPlaceAll 已经替所有物料排好，
    //      若先校验尺寸就会一路走到最后、按钮反而变成了真确认。）
    if (this.data.remainCount > 0) { this.goNextUnseen(); return; }
    const noSize = this.parts.filter(p => !(p.len > 0) || !(p.wid > 0));
    if (noSize.length) { util.toast('还有 ' + noSize.length + ' 片没填长宽'); return; }
    const bad = this.parts.filter(p => !p.pieceId);
    if (bad.length) { util.toast('还有 ' + bad.length + ' 片没摆好（没有能放下的布）'); return; }
    // ⚠️ V94：红了（超出布边 / 压在已有缺口上）= **这一刀根本裁不出来**，不许往下走。
    //    按钮虽然已经置灰，但这道闸必须自带判断 —— 置灰只是"看得见"，拦不拦得住看这里。
    //    （真让它过去的话，扣料时那一刀会按系统自己找的位置裁下去，账面看不出来）
    const red = (this.data.parts || []).filter(x => x.red);
    if (red.length) {
      util.toast('第 ' + red.map(x => x.no).join('、') + ' 片压在缺口上或超出布边，拖回绿色区域再确认');
      return;
    }
    const schemes = this.parts.map(p => this.pickOf(p));
    const ch = this.channel || (this.getOpenerEventChannel && this.getOpenerEventChannel());
    if (ch && ch.emit) {
      if (this.queueMode) {
        // 生产流程：按**件号**分组（与 produceProduct 的 perPiece 同构）。
        // ⚠️ 一件可以有多片（这一行要几块布），所以每组是**数组里的数组**。
        const groups = {};
        this.parts.forEach((p) => {
          const k = Math.max(1, p.pieceNo);
          if (!groups[k]) groups[k] = [];
          groups[k].push(this.pickOf(p));
        });
        const perPiece = Object.keys(groups).map(Number).sort((a, b) => a - b).map(k => groups[k]);
        ch.emit('onChoose', { chosen: perPiece, qty: this.data.qty });
      } else {
        // 成品编辑：把这一行用到的**全部**片整包给他（V91 起可以是多片 —— 一件用两块布）
        ch.emit('onCutChosen', {
          materialId: schemes[0].materialId,
          materialName: schemes[0].materialName,
          schemes: schemes
        });
      }
    } else {
      // ⚠️ V124：**通道不通 = 回传无门**，绝不能像以前那样"页面正常关掉、什么都不说、什么都不做"。
      //    用户 2026-10-08 真机反馈：「点完就这样裁之后就结束了，结束之后发现成品数量也没加上」
      //    —— 他自己都没意识到是"结果没送回去"，因为屏幕上**一个字都没有**。
      //    为什么用 alert（弹窗）不用 toast：2 秒 toast 正是这条链路上一次"提示被吞掉"的形态
      //    （V123 的教训），而这种失败用户必须看见。
      //    为什么**不** navigateBack：用户刚排好的片还在这一屏，留着它就能重试；
      //    静默关掉等于把他的工作量一起丢掉（那正是本次 bug 最伤人的地方）。
      util.alert('裁剪结果没保存', '没找到接收裁剪结果的页面，请返回上一页重新进入再试');
      return;
    }
    wx.navigateBack();
  }
});
