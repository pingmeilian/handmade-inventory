// pages/materials/detail.js —— 物料详情（M1-03 / M1-04 / M1-11）
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');

// 把一块布的形状缩到缩略图尺寸（纯展示计算，不碰数据）。
// 返回 { w, h, holes:[{ k, left, bottom, w, h }] }，单位 rpx。
//
// ⚠️ 内核坐标原点在**左下角**，页面用 CSS 的 bottom 定位，两者天然对齐 → 不需要翻转 y。
// k 是给 wx:key 用的稳定序号（块内不变，避免渲染错乱）。
function thumbShape(piece, maxW, maxH) {
  const sh = store.pieceShape(piece);
  if (!sh || !(sh.base.length > 0) || !(sh.base.width > 0)) return { w: maxW, h: maxH, holes: [] };
  const s = Math.min(maxW / sh.base.length, maxH / sh.base.width);
  const at = (v) => Math.max(0, util.round(v * s, 1));
  return {
    w: util.round(sh.base.length * s, 1),
    h: util.round(sh.base.width * s, 1),
    holes: sh.holes.map((h, i) => ({
      k: i,
      left: at(h.x), bottom: at(h.y),
      w: Math.max(1, at(h.length)), h: Math.max(1, at(h.width))
    }))
  };
}

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  data: {
    id: '', m: null,
    mcName: '', bcName: '', stockText: '', low: false,
    isFabric: false, isBatch: false, showHeadTh: true, attrList: [], pieces: [],
    flows: [], referencedBy: 0,
    // 图集：先物料实拍图，再订单截图；横向缩略图列表点击预览
    gallery: [],
    piecesExpanded: false, moreExpanded: false, flowsExpanded: false,
    // 布片操作弹窗（盘点调整/销毁）
    showAction: false, actionPiece: null, actionType: '', actionLen: '', actionWid: '', actionRemark: '',
    // 布片放大镜（V113）：长按缩略图 → 全屏按真实比例看这块布的形状与缺口；松手关掉。
    // 起因（用户 2026-10-04）：「布片很大的时候这样就看不清了」——
    //   500×150 的长条布在 130rpx 缩略图里被压成一条细带，看不出有没有缺口。
    zoomOpen: false, zoomShape: null, zoomSize: '', zoomTag: '',
    zoomHoleText: '', zoomHoleN: 0,
    // 出入库操作面板
    showSheet: false, sheetType: '', sheetQty: '', sheetLen: '', sheetWid: '', sheetPrice: '', sheetRemark: '',
    // 刀口布（按批估量）出入库：只填数量，单位 = 片 / kg / g
    sheetIsBatch: false, sheetBatchUnit: '',
    // 盘库：piece 面料浮动布片清单（含 调整尺寸/整块销毁 双 tab）；batch/非面料 填量面板
    showStocktake: false, showStocktakePanel: false,
    stkQty: '', stkUnit: '', stkCurrent: 0, stkPreview: '', stkRemark: '盘库盈亏'
  },

  onLoad(options) {
    this.setData({ id: options.id });
    this.reload();
  },
  onShow() { themePage.apply(this); this.reload(); },

  reload() {
    const m = store.getMaterial(this.data.id);
    if (!m) { util.toast('物料不存在'); return; }
    // 购买平台展示串（兼容旧数据的 supplier 字段）
    m._pfDisplay = ((m.purchaseL1 ? m.purchaseL1 + '/' : '') + (m.purchaseL2 || m.supplier || '')).replace(/^\//, '') || '';
    const mcMap = {}; store.getList('materialCategory').forEach(c => mcMap[c.id] = c.name);
    const bcMap = {}; store.getBusinessCategories().forEach(c => bcMap[c.id] = c.name);
    const fabric = store.isMaterialFabric(m);
    // 面积显示：单位按数值大小自动选 cm² / m²（util.fmtArea，临界值 1m²）——
    // 2026-09-27 V72 起不再由用户手动切单位，见 util.AREA_M2_THRESHOLD 上的说明
    const attrList = (m.attrGroups || []).map(g => ({ key: g.dimension, value: g.value }));
    // 布片清单：一律画**这块布真实的形状**（2026-09-30 V82）——
    // 外框按真实长宽比缩略，**已有缺口照实画出来**。
    // 以前整布画「卷筒」插画、碎料画圆角矩形，都不是这块布的样子（用户真机反馈：
    // 「不要这种整卷了变成实际几何图形，不管是整布还是碎布」）。
    const rawPieces = (m.pieces || []).map(p => {
      // V113b：长按放大要用**原始布片**重算形状 —— 原始数据按 id 存实例字段
      //（不上 data：不进 setData 负载），展示条目只保留"画列表要用的字段"。
      this._rawPieceById = this._rawPieceById || {};
      this._rawPieceById[p.id] = p;
      const isOffcut = store.isPieceOffcut(p, m.fabricWidth);
      return {
        id: p.id, length: p.length, width: p.width, rawArea: p.area,
        isOffcut,
        tag: isOffcut ? '碎料' : '整布',
        tagClass: isOffcut ? 'tag-soft' : 'tag-success',
        shape: thumbShape(p, 130, 120),      // 清单里的大缩略图
        shapeSm: thumbShape(p, 44, 44)       // 盘库弹层里的小缩略图
      };
    });
    const pieces = rawPieces
      .sort((a, b) => (a.isOffcut === b.isOffcut ? b.rawArea - a.rawArea : (a.isOffcut ? 1 : -1)))
      .map(p => {
        const o = {
          ...p,
          area: util.fmtArea(p.rawArea),
          lengthText: util.round(p.length, 0),
          widthText: util.round(p.width, 0)
        };
        return o;
      });
    const currentUnit = store.unitCost(m); // 当前加权单价（面料=元/cm²，非面料=元/单位；刀口布=元/kg或元/片）
    const isBatchMat = fabric && m.stockMode === 'batch';
    const flows = store.getFlows().filter(f => f.materialId === m.id)
      .sort((a, b) => b.createdAt - a.createdAt).map(f => {
        // 数量与单位统一走 store.flowDisplay（页面与导出唯一口径）：
        //   按批估量(byBatch → kg/片) / 布料面积(byArea → 按临界值自动 cm²/m²) / 普通数量(each)
        const d = store.flowDisplay(f);
        const unitLabel = d.unit ? (' ' + d.unit) : '';
        const total = Number(f.totalPrice) || 0;
        let priceText = '';
        if (f.priceMode || total > 0) {
          const label = f.type === 'in' ? '¥' : '成本 ¥';
          priceText = total > 0 ? (label + util.money(total)) : (label + '—');
        }
        // 结余物料资产 = 结余数量 × 当前加权单价
        const asset = util.round(currentUnit * (f.balance || 0), 2);
        const assetText = util.money(asset);
        // 操作类型：销毁 / 盘盈 / 盘亏 / 入库 / 出库 / 冲销
        let typeText = f.type === 'in' ? '入库' : '出库';
        let typeClass = f.type === 'in' ? 'text-success' : 'text-danger';
        if (f.source === 'destroy') { typeText = '盘亏'; }
        else if (f.source === 'stocktake') { typeText = f.type === 'in' ? '盘盈' : '盘亏'; }
        // 红冲：原流水标记「已冲销」，红冲流水本身显示「冲销」（均不可再撤销）
        const isReversal = f.source === 'reversal';
        if (isReversal) { typeText = '冲销'; typeClass = 'text-3'; }
        else if (f.undone) { typeText += '（已冲销）'; typeClass = 'text-3'; }
        return {
          id: f.id,
          date: f.date, typeText, typeClass,
          qtyText: (f.type === 'in' ? '+' : '-') + d.qty + unitLabel,
          priceText: priceText,
          balance: d.balance + unitLabel,
          assetText: assetText,
          remark: f.remark || '',
          canUndo: !isReversal && !f.undone &&
            (f.source === 'manual' || f.source === 'destroy' || f.source === 'stocktake')
        };
      });
    const referencedBy = store.getProducts().filter(p => (p.bom || []).some(b => b.materialId === m.id)).length;
    const avgPerBase = store.unitCost(m);
    const avgPrice = fabric ? util.money(util.round(avgPerBase * 10000, 2)) : util.money(util.round(avgPerBase, 4));
    const avgUnit = isBatchMat ? store.displayUnit(m.batchUnit) : (fabric ? 'm²' : (m.unit || '单位'));

    // 图集：先全部物料实拍图，再接全部采购订单截图
    const gallery = (m.photos || []).map(src => ({ src: src, type: 'photo' }))
      .concat((m.orderImages || []).map(src => ({ src: src, type: 'order' })));

    this.setData({
      gallery,
      m, mcName: mcMap[m.materialCategoryId] || '其他', bcName: bcMap[m.categoryId] || '',
      isFabric: fabric,
      stockText: isBatchMat
        ? (util.round(store.stockValue(m), 2) + ' ' + store.displayUnit(m.batchUnit))
        : (fabric ? (util.fmtArea(store.fabricArea(m)) + ' · ' + store.fabricCount(m) + '片') : (util.round(store.stockValue(m), 2) + ' ' + (m.unit || ''))),
      low: store.isLowStock(m), attrList, pieces, flows, referencedBy, avgPrice, avgUnit,
      isBatch: isBatchMat,
      // 刀口布（按批估量）无面积口径，隐藏「预警阈值」行
      showHeadTh: !isBatchMat,
      thresholdText: fabric
        ? util.fmtArea(m.threshold || 0)
        : ((m.threshold == null ? '默认 5' : m.threshold) + ' ' + (m.unit || ''))
    });
  },

  goEdit() { util.navTo({ url: '/pages/materials/edit?id=' + this.data.id }); },
  noop() {},

  // ---- 布片放大镜（V113）----
  // 长按缩略图 → 全屏看这块布的**真实形状**（外框 + 已有的缺口）。
  //
  // 为什么必须是"放大"而不是"修小图"：长宽比是 500:150 这种极端值时，
  // 缩略图按真实比例缩完必然是一条细带 —— 缩略图的职责是"扫一眼认出是哪块"，
  // 看清细节是另一个职责，用同一张图承担两者只会两头不讨好。
  //
  // ⚠️ 为什么用 longpress 而不是 click：这行右边还有「···」和状态标签，
  //    触点上要分清"看形状"还是"操作"；长按 + 松手即关 = 零学习成本、也不误触。
  //    （长按事件在小程序里**自带 350ms 判定 + 轻微震动反馈**，用户不会觉得没反应）
  onZoomPiece(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const p = (this.data.pieces || [])[idx];
    if (!p) return;
    // ⚠️ V113b 修（用户真机截图「都这样了，还未被裁剪呢」）：必须用**原始布片**重算。
    //   `data.pieces` 里是展示条目 —— reload 时 map 出来的，**没有 base/holes**
    //   （只有画列表要用的 shape/shapeSm/tag 等）。拿它去 thumbShape → asSheet
    //   会走"没有 base 就按长宽拼矩形"的回退分支 ⇒ holes 恒空 ⇒
    //   **裁过的布放大后也显示"整布/未被裁剪"**，跟缩略图（reload 时用原始数据算的）自相矛盾。
    const raw = (this._rawPieceById || {})[p.id] || p;
    // 放大图用**大面积**重算（屏宽 × 屏高的 0.7 倍留边）—— 与列表里那张 130rpx 是同一函数、不同上限
    const sh = thumbShape(raw, 460, 560);
    // ⚠️ **别默认每块布都有缺口**（V113 修：用户真机看到整布放大后"哪有缺口"）：
    //   `holes` 只在**这块布被裁过之后**才有值（`store.cutSheetPiece` 才往里塞），
    //   整布的 holes 恒为空数组。所以放大层要**按实际有没有缺口给不同的说明** ——
    //   整布说"未被裁剪"（这本身是有用信息：它还是整幅的），有缺口才报几处。
    const holeN = (sh.holes || []).length;
    this.setData({
      zoomOpen: true,
      zoomShape: sh,
      zoomSize: p.lengthText + '×' + p.widthText + 'cm',
      zoomTag: p.tag || '',
      zoomHoleText: holeN > 0 ? ('已裁 ' + holeN + ' 处') : '未被裁剪',
      zoomHoleN: holeN
    });
  },

  // 松手就关（touchend / touchcancel 都兜住 —— 手指滑出屏幕也算松手）
  closeZoom() {
    if (this.data.zoomOpen) this.setData({ zoomOpen: false });
  },
  // onToggleAreaUnit 已删除（2026-09-27 V72）：布片/流水的面积单位按数值大小自动选，
  // 用户不用再猜该看 cm² 还是 m²。口径收在 util.fmtArea / store.flowDisplay，与导出一致。

  // 点击任意图片全屏预览（预览列表 = 实拍图 + 订单截图的合并顺序）
  previewPhoto(e) {
    const idx = Number(e.currentTarget.dataset.i);
    const gallery = this.data.gallery || [];
    if (!gallery.length) return;
    const urls = gallery.map(x => x.src);
    wx.previewImage({ current: gallery[idx] ? gallery[idx].src : urls[0], urls: urls });
  },

  // 折叠展开：布片 / 更多信息 / 库存流水
  togglePieces() { this.setData({ piecesExpanded: !this.data.piecesExpanded }); },
  toggleMore() { this.setData({ moreExpanded: !this.data.moreExpanded }); },
  toggleFlows() { this.setData({ flowsExpanded: !this.data.flowsExpanded }); },

  // 打开出入库面板：按物料类型准备字段（刀口布只需「数量」，单位随 片/kg/g）
  _openSheet(type) {
    const m = this.data.m || {};
    const isBatch = !!this.data.isBatch;
    this.setData({
      showSheet: true, sheetType: type,
      sheetQty: '', sheetLen: '', sheetWid: '', sheetPrice: '', sheetRemark: '',
      sheetIsBatch: isBatch,
      sheetBatchUnit: isBatch ? store.displayUnit(m.batchUnit) : ''
    });
  },
  openIn() { this._openSheet('in'); },
  // 出库（2026-10-02 V96 改造）：
  //   · **常规面料** → 进裁剪排版界面：由用户指定**哪片布、摆在哪**，
  //     摆好点「就这样裁」即出库（形状 + 哪片布 + 哪个位置，三件齐全）。
  //     改造前这里只让填一个"裁剪面积"，扣在哪由系统自己挑 —— 违反用户立的规矩。
  //   · 辅料（按数量）/ 刀口布（按批估量）没有形状可言 → 仍走弹层。
  openOut() {
    const d = this.data, m = d.m || {};
    if (d.isFabric && !d.isBatch) {
      const live = (m.pieces || []).filter(p => p.status === 'in');
      if (!live.length) { util.toast('这块面料没有在库布片，出不了库'); return; }
      util.navTo({
        url: '/pages/cut-editor/cut-editor?id=' + m.id,
        events: {
          onCutChosen: (data) => {
            try {
              const r = store.outboundCut(m.id, data && data.schemes, '出库');
              util.toast('已出库 ' + util.fmtArea(r.consumedArea), 'success');
              this.reload();
            } catch (err) { util.toast(err.msg || '出库失败'); }
          }
        }
      });
      return;
    }
    this._openSheet('out');
  },
  closeSheet() { this.setData({ showSheet: false }); },

  onSheetQty(e) { this.setData({ sheetQty: e.detail.value }); },
  onSheetLen(e) { this.setData({ sheetLen: e.detail.value }); },
  onSheetWid(e) { this.setData({ sheetWid: e.detail.value }); },
  onSheetPrice(e) { this.setData({ sheetPrice: e.detail.value }); },
  onSheetRemark(e) { this.setData({ sheetRemark: e.detail.value }); },

  confirmSheet() {
    const d = this.data, m = d.m;
    const remark = d.sheetRemark || (d.sheetType === 'in' ? '入库' : '出库');
    // 三类物料：① 非面料（按数量）② 刀口布按批估量（按 片/kg/g）③ 常规面料（按长宽 / 裁剪面积）
    const isBatch = !!d.sheetIsBatch;
    const batchUnitText = d.sheetBatchUnit || store.displayUnit(m.batchUnit);
    try {
      if (d.sheetType === 'in') {
        if (!d.isFabric) {
          const q = Number(d.sheetQty);
          if (!(q > 0)) { util.toast('请输入大于0的数量'); return; }
          store.inbound(m.id, q, d.sheetPrice === '' ? null : Number(d.sheetPrice), remark);
        } else if (isBatch) {
          // 刀口布入库：片数 / 重量 + 本次总价（留空则按现均价折算）
          const q = Number(d.sheetQty);
          if (!(q > 0)) { util.toast('请输入大于0的' + batchUnitText); return; }
          store.inbound(m.id, q, d.sheetPrice === '' ? null : Number(d.sheetPrice), remark);
        } else {
          const l = Number(d.sheetLen), w = Number(d.sheetWid);
          if (!(l > 0 && w > 0)) { util.toast('请输入布片长、宽'); return; }
          store.inbound(m.id, 0, { length: l, width: w, total: d.sheetPrice === '' ? undefined : Number(d.sheetPrice) }, remark);
        }
      } else {
        if (!d.isFabric) {
          const q = Number(d.sheetQty);
          if (!(q > 0)) { util.toast('请输入大于0的数量'); return; }
          store.outbound(m.id, q, remark);
        } else if (isBatch) {
          // 刀口布出库：片数 / 重量
          const q = Number(d.sheetQty);
          if (!(q > 0)) { util.toast('请输入大于0的' + batchUnitText); return; }
          store.outbound(m.id, q, remark);
        } else {
          // 常规面料出库已经改走裁剪排版界面（见 openOut），不该走到这里。
          // 真走到了就**明确报错**，别静默什么都不做（"无反馈"比"报错"更伤人 —— V88）。
          throw { code: 'ROUTE', msg: '面料出库请到裁剪界面选好布和位置' };
        }
      }
      util.toast('已记录', 'success');
      this.setData({ showSheet: false });
      this.reload();
    } catch (err) {
      util.toast(err.msg || '操作失败');
    }
  },

  // ===== 盘库入口 =====
  // 出库右侧「盘库」：piece 面料 → 浮动布片清单（双 tab）；batch/非面料 → 填量面板
  openStocktakeEntry() {
    const m = this.data.m;
    if (this.data.isFabric && m.stockMode !== 'batch') {
      this.setData({ showStocktake: true });
      return;
    }
    const isBatch = this.data.isFabric && m.stockMode === 'batch';
    const cur = isBatch ? (m.batchRemain || 0) : (m.quantity || 0);
    const unit = isBatch ? store.displayUnit(m.batchUnit) : (m.unit || '');
    this.setData({
      showStocktakePanel: true, stkQty: String(util.round(cur, 2)), stkUnit: unit,
      stkCurrent: cur, stkRemark: '盘库盈亏', stkPreview: ''
    });
  },
  closeStocktake() { this.setData({ showStocktake: false }); },
  closeStocktakePanel() { this.setData({ showStocktakePanel: false }); },
  // 浮动清单：整布/碎料均支持「调整尺寸」和「整块销毁」
  stkAdjust(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const piece = this.data.pieces[idx];
    if (!piece) return;
    this.setData({ showStocktake: false });
    this.openStocktake(piece);
  },
  stkDestroy(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const piece = this.data.pieces[idx];
    if (!piece) return;
    this.setData({ showStocktake: false });
    this.confirmDestroy(piece);
  },
  onStkQty(e) { this.setData({ stkQty: e.detail.value }); this._computeStkPreview(); },
  onStkRemark(e) { this.setData({ stkRemark: e.detail.value }); },
  _computeStkPreview() {
    const cur = Number(this.data.stkCurrent);
    const actual = Number(this.data.stkQty);
    const unit = this.data.stkUnit;
    if (!(actual >= 0)) { this.setData({ stkPreview: '请输入有效数量' }); return; }
    const m = this.data.m;
    const unitCost = (this.data.isFabric && m.stockMode === 'batch') ? (m.batchUnitPrice || 0) : store.unitCost(m);
    const delta = util.round(actual - cur, 2);
    const valDelta = util.round(unitCost * delta, 2);
    const tag = delta > 0 ? '盘盈' : (delta < 0 ? '盘亏' : '无差异');
    const valText = (valDelta >= 0 ? '+' : '-') + util.money(Math.abs(valDelta));
    this.setData({ stkPreview: `当前 ${util.round(cur, 2)}${unit} → 实测 ${actual}${unit}　${tag} ${Math.abs(delta)}${unit}　价值 ${valText}` });
  },
  confirmStocktakePanel() {
    const actual = Number(this.data.stkQty);
    if (!(actual >= 0)) { util.toast('请输入实际库存'); return; }
    try {
      store.stocktakeMaterial(this.data.m.id, actual, this.data.stkRemark || '盘库盈亏');
      util.toast('已盘库', 'success');
      this.setData({ showStocktakePanel: false });
      this.reload();
    } catch (err) { util.toast(err.msg || '盘库失败'); }
  },

  // ===== 布片操作：碎料销毁 / 整布盘点调整 =====
  openPieceActions(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const piece = this.data.pieces[idx];
    if (!piece) return;
    const items = ['盘点调整尺寸', '整块销毁'];
    wx.showActionSheet({
      itemList: items,
      itemColor: '#A9765C',
      success: (res) => {
        if (res.tapIndex < 0) return;
        if (res.tapIndex === 0) this.openStocktake(piece);
        else this.confirmDestroy(piece);
      }
    });
  },
  confirmDestroy(piece) {
    const m = this.data.m;
    const unit = store.unitCost(m);
    const cost = util.round(unit * piece.rawArea, 2);
    wx.showModal({
      title: '确认整块销毁',
      content: `销毁 ${piece.lengthText}×${piece.widthText}cm 碎料（${piece.area}），成本约 ¥${util.money(cost)}，确定吗？`,
      confirmText: '销毁',
      confirmColor: '#E15B53',
      success: (res) => {
        if (!res.confirm) return;
        try {
          store.destroyPiece(m.id, piece.id, '整块销毁');
          util.toast('已销毁', 'success');
          this.reload();
        } catch (err) { util.toast(err.msg || '销毁失败'); }
      }
    });
  },
  openStocktake(piece) {
    this.setData({
      showAction: true,
      actionPiece: piece,
      actionType: 'stocktake',
      actionLen: String(piece.lengthText),
      actionWid: String(piece.widthText),
      actionRemark: '盘点调整'
    });
  },
  closeAction() { this.setData({ showAction: false, actionPiece: null, actionType: '', actionLen: '', actionWid: '', actionRemark: '' }); },
  onActionLen(e) { this.setData({ actionLen: e.detail.value }); },
  onActionWid(e) { this.setData({ actionWid: e.detail.value }); },
  onActionRemark(e) { this.setData({ actionRemark: e.detail.value }); },
  confirmStocktake() {
    const d = this.data;
    const piece = d.actionPiece;
    if (!piece || d.actionType !== 'stocktake') return;
    const l = Number(d.actionLen), w = Number(d.actionWid);
    if (!(l > 0 && w > 0)) { util.toast('请输入有效的长和宽'); return; }
    try {
      store.stocktakePiece(d.m.id, piece.id, l, w, d.actionRemark || '盘点调整');
      util.toast('已调整', 'success');
      this.closeAction();
      this.reload();
    } catch (err) { util.toast(err.msg || '调整失败'); }
  },

  // 撤销手动入库/出库流水（反向恢复库存）
  undoFlow(e) {
    const id = e.currentTarget.dataset.id;
    util.confirm('撤销该流水', '反向恢复库存，面料将恢复形状或加回余料', '撤销').then(ok => {
      if (!ok) return;
      try { store.undoFlow(id); util.toast('已撤销', 'success'); this.reload(); }
      catch (err) { util.toast(err.msg || '操作失败'); }
    });
  },
  async del() {
    const ok = await util.confirm('删除物料', '删除后不可恢复，且被成品引用的物料无法删除', '删除');
    if (!ok) return;
    try {
      store.removeMaterial(this.data.id);
      util.toast('已删除', 'success');
      setTimeout(() => wx.navigateBack(), 400);
    } catch (err) {
      util.toast(err.msg || '删除失败');
    }
  },

  copyUrl(e) {
    const url = e.currentTarget.dataset.url;
    // 走 util.copyText：空链接 / 写入失败 / 同步异常 都有提示（旧的裸调用失败时是完全静默的）
    util.copyText(url, { okText: '链接已复制', failText: '复制失败，可长按链接手动复制' });
  }
});
