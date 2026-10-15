// pages/materials/edit.js —— 物料新增 / 编辑（M1-03）
const app = getApp();
const store = require('../../utils/store.js');
const state = require('../../services/state.js');
const util = require('../../utils/util.js');
const privacy = require('../../utils/privacy.js');
const UNIT_PRESETS = store.getUnitPresets();

const WIDTH_PRESETS_M = ['0.9', '1.1', '1.4', '1.5', '1.6', '1.8']; // 单位 m

// 允许小数的连续计量单位（长度/重量/容量等），不在此列的默认按整数计
const CONTINUOUS_UNITS = /^(m|米|cm|厘米|mm|毫米|g|克|kg|千克|斤|两|磅|lb|oz|盎司|ml|毫升|l|升)$/i;
function isIntegerUnit(unit) {
  return !CONTINUOUS_UNITS.test(String(unit || '').trim());
}
// ⚠️ 2026-10-12（V145）：这里曾经**又抄了一份** ATTR_PRESETS 当兜底 —— 已删掉，改用
//    `store.getAttrPresets(dim)`（唯一源）。为什么必须收口：
//    属性维度的 options 存在用户数据里，store 那份是"出厂值 + 用户没填过时的兜底"，
//    两处各写一份必然漂 —— 改了一处、另一处还拿旧列表，就会出现
//    "预设页有新选项、编辑页却选不到"这种看不懂的现象。

// 从在用布片里推断「长」（cm）：取最长的一片。
// 为什么需要：早期数据/纯补货入库的物料没有独立的 fabricLength 字段（inbound 只写 fabricWidth），
// 编辑页若把它留空并当必填，用户就会被迫现编一个数 —— 违反「进入即带数据、不要求重填」。
// 返回 null 表示确实推不出来（例如布已用完），此时编辑态也不阻断保存。
function fabricLengthFromPieces(m) {
  const ps = (m && m.pieces) || [];
  let max = 0;
  ps.forEach((p) => { const L = Number(p && p.length) || 0; if (L > max) max = L; });
  return max > 0 ? max : null;
}
// 购买平台：一级分类（可扩展，目前仅「供应商」）；二级为具体渠道预设
const PLATFORM_L1 = ['供应商'];
const PLATFORM_L2 = ['抖音商店', '抖音直播间', '淘宝', '拼多多', '1688', '小红书', '线下'];

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  onShow() {
    themePage.apply(this);   // 主题（V97）
    // 原生 <switch> 的 color 是**组件属性**，吃不到 CSS 变量 ⇒ 必须从主题 token 取**色值**传下去。
    // （V127：原先这里写死 color="#C28E72" —— 换主题时开关不变色，违反"色值走主题变量"）
    this.setData({ switchColor: themePage.tokens().primary });
  },

  data: {
    id: '', isEdit: false,
    bcIndex: 0, bcList: [],
    mcIndex: 0, mcList: [],
    isFabric: false,                  // 是否面料（从物料分类读取）
    stockMode: 'piece',               // piece(按片精确) | batch(按批估量·刀口布)
    showBatch: false,                 // 录入界面「按批估量」开关
    batchUnit: 'kg',                  // 批次计量单位：kg | g | piece（内部存储值，展示时 piece→「片」）
    batchTotal: '',                   // 批次总量（kg / g / 片）
    batchUnitPrice: '',               // 反算单价（元/kg 或 元/片，仅显示）
    editBatchRemain: null,            // 编辑态：存量副本（kg↔g 切换时按 1000 换算）
    editBatchPrice: null,             // 编辑态：单价副本（kg↔g 切换时按 1000 换算）
    // ⚠️ V145：`presets: ATTR_PRESETS` 原来放这儿，但**模板里从没用过**（全项目搜过）——
    //    属于"算了没人用"的字段，已删。维度预设要在 wxml 用的话，从
    //    `attrGroups[].options` 取（那是**这个分类的真实预设**，优先级高于出厂值）。
    widthPresets: WIDTH_PRESETS_M,
    photos: [],                       // 本地持久化路径数组
    keywords: '',                     // 用户输入的“关键词”
    generatedName: '',                // 属性+关键词拼接后的名称（只读）
    unit: '',
    unitIndex: 0,
    unitPresets: UNIT_PRESETS,
    totalPrice: '',                   // 本次总价（元）
    calcPrice: '',                    // 反算出的均价（新建态）
    avgPrice: '',                     // 当前均价（编辑态只读）
    avgUnit: '',
    stockValueText: '',               // 库存总值（编辑态只读展示，账本口径）
    showPriceFields: true,            // 新建态显示总价/数量；编辑态只读均价
    fabricLength: '',                 // 面料长（显示值，按 fabricLenUnit）
    fabricWidth: '1.5',                // 面料幅宽（显示值，按 fabricWidUnit）
    fabricLenUnit: 'm',               // 长输入单位：默认 m（大布按 m 方便）
    fabricWidUnit: 'm',               // 幅宽输入单位：默认 m
    widthMode: 'preset',              // preset | custom
    widthPresetIndex: 3,              // 默认 1.5m
    widthPresets: WIDTH_PRESETS_M,    // 幅宽预设（m）
    threshold: '',
    attrGroups: [],                   // [{dimension,value}] 层级属性
    // 购买平台（两级）
    purchaseL1: '供应商', purchaseL2: '',
    platformL1: PLATFORM_L1, platformL1Index: 0,
    platformL2: PLATFORM_L2, platformL2Index: -1,
    shopName: '',                     // 店铺名
    productUrl: '',                   // 商品链接
    remark: '',
    orderImages: [],                  // 订单截图（持久化路径，独立于物料照片）
    qty: '',                          // 非面料初始数量（必填，可小数）
    qtyInteger: true,                  // 当前单位是否为整数单位（个/颗/条等 vs 米/kg 等）
    picker: { show: false, title: '', options: [], rangeKey: '', value: 0, field: '' }
  },

  onLoad(options) {
    const bcList = store.getBusinessCategories();
    const mcList = store.getList('materialCategory');
    const cur = state.getCurrentSpace();
    const bcIndex = Math.max(0, bcList.findIndex(c => c.id === cur));
    this.setData({ bcList, mcList, bcIndex });
    if (options.id) {
      this.loadMaterial(options.id, bcList);
    } else {
      this.applyMcTemplate(0, mcList);
      this.setData({ isEdit: false, showPriceFields: true, avgPrice: '', avgUnit: this.data.unit });
    }
  },

  loadMaterial(id, bcList) {
    const m = store.getMaterial(id);
    if (!m) { util.toast('物料不存在'); return; }
    const mcList = this.data.mcList;
    const bcIndex = Math.max(0, bcList.findIndex(c => c.id === m.categoryId));
    const mcIndex = Math.max(0, mcList.findIndex(c => c.id === m.materialCategoryId));
    // 防呆：物料引用的大类可能已被删除（或预设被清空）——mc 为 undefined 时
    // 下面取 mc.attrDimensions 会抛错，onLoad 中断，表单停在空白（看起来像新增模式）。
    // 兜底 = 空维度模板，基本信息照常回填。（2026-09-12 真机反馈，全局同类隐患排查后仅此 1 处）
    const mc = mcList[mcIndex] || { attrDimensions: [], defaultUnit: '' };
    const savedGroups = (m.attrGroups || []);
    const attrGroups = (mc.attrDimensions || []).map(d => {
      const dim = typeof d === 'string' ? d : (d.name || '');
      const opts = typeof d === 'string' ? [] : (d.options || []);
      const options = opts.length ? opts : store.getAttrPresets(dim);
      const saved = savedGroups.find(g => g.dimension === dim);
      return { dimension: dim, options: options, value: saved ? saved.value : '' };
    });
    const fabric = store.isMaterialFabric(m);
    const isBatchMat = m.stockMode === 'batch';
    // 「长」的回填：优先记录里的字段；没有则从在用布片推断（历史数据/纯补货入库的物料没有该字段）
    const lenCm = m.fabricLength != null ? m.fabricLength : fabricLengthFromPieces(m);

    // 单位：若历史数据的单位不在预设里，则临时追加以保证可回显
    const unit = m.unit || '';
    const unitPresets = this.data.unitPresets.slice();
    let unitIndex = unitPresets.indexOf(unit);
    if (unitIndex < 0 && unit) { unitPresets.push(unit); unitIndex = unitPresets.length - 1; }

    let widthMode = 'custom', widthPresetIndex = 3;
    const w = m.fabricWidth; // 内部 cm
    if (w != null) {
      const idx = WIDTH_PRESETS_M.indexOf(String(util.round(w / 100, 1)));
      if (idx >= 0) { widthMode = 'preset'; widthPresetIndex = idx; }
    }

    this.setData({
      id: m.id, isEdit: true, showPriceFields: false,
      bcIndex, mcIndex,
      isFabric: fabric,
      photos: (m.photos || []).slice(),
      keywords: m.keywords || '',
      generatedName: m.name || '',
      unit: unit, unitIndex: unitIndex, unitPresets: unitPresets,
      totalPrice: m.totalPrice == null ? '' : String(m.totalPrice),
      calcPrice: m.price == null ? '' : String(m.price),
      fabricLength: lenCm == null ? '' : String(util.fromCm(lenCm, 'm')),
      fabricWidth: w == null ? '' : String(util.fromCm(w, 'm')),
      fabricLenUnit: 'm', fabricWidUnit: 'm',
      widthMode, widthPresetIndex,
      threshold: m.threshold == null ? '' : String(m.threshold),
      attrGroups: attrGroups,
      purchaseL1: m.purchaseL1 || '供应商',
      purchaseL2: m.purchaseL2 || m.supplier || '',
      platformL1Index: Math.max(0, PLATFORM_L1.indexOf(m.purchaseL1 || '供应商')),
      platformL2Index: PLATFORM_L2.indexOf(m.purchaseL2 || m.supplier || ''),
      shopName: m.shopName || '',
      productUrl: m.productUrl || '',
      remark: m.remark || '',
      orderImages: (m.orderImages || []).slice(),
      stockMode: m.stockMode || 'piece',
      showBatch: m.stockMode === 'batch',
      batchUnit: m.batchUnit || 'kg',
      batchTotal: m.batchTotal == null ? '' : String(m.batchTotal),
      batchUnitPrice: m.batchUnitPrice == null ? '' : String(m.batchUnitPrice),
      // 编辑态：本地副本，用于 kg↔g 切换时换算存量与单价（不直接改 store 里的物料对象）
      editBatchRemain: m.batchRemain != null ? m.batchRemain : null,
      editBatchPrice: m.batchUnitPrice != null ? m.batchUnitPrice : null,
      avgPrice: isBatchMat ? util.money(util.round(m.batchUnitPrice || 0, 2)) : (fabric ? util.money(util.round(store.unitCost(m) * 10000, 2)) : util.money(util.round(store.unitCost(m), 4))),
      avgUnit: isBatchMat ? store.displayUnit(m.batchUnit) : (fabric ? 'm²' : (m.unit || '单位')),
      // 编辑态只读展示的账面库存总值（与详情页/成本统计同源：物料记录的 totalValue）
      // 目的：让「进编辑页就能看到总价」成立，同时明确它是账本口径、不在此处修改
      stockValueText: util.money(util.round(m.totalValue || 0, 2))
    });
    if (fabric && w == null && mc) this.applyDefaultFabricWidth(mc);
    this.refreshName();
  },

  applyMcTemplate(mcIndex, mcList) {
    const mc = mcList[mcIndex];
    if (!mc) return;
    const attrGroups = (mc.attrDimensions || []).map(d => {
      const dim = typeof d === 'string' ? d : (d.name || '');
      const opts = typeof d === 'string' ? [] : (d.options || []);
      const options = opts.length ? opts : store.getAttrPresets(dim);
      return { dimension: dim, options: options, value: '' };
    });
    const unit = mc.defaultUnit || '';
    const unitIndex = Math.max(0, UNIT_PRESETS.indexOf(unit));
    // 面料与否**只看分类上的显式标记**（V127）。
    // 旧代码写的是 `store.isMaterialFabricByCategory ? … : (!!mc.isFabric || /面料/.test(mc.name))`
    // —— 那个函数**全项目不存在**，所以这一行永远走后面的回退，等于"按名字猜"还活着。
    // 用户拍板：「哪里需要系统自己去匹配」⇒ 只认标记。
    const isFabric = !!mc.isFabric;
    this.setData({
      unit: unit,
      unitIndex: unitIndex,
      isFabric: isFabric,
      qtyInteger: isIntegerUnit(unit),
      attrGroups: attrGroups,
      avgUnit: unit, avgPrice: ''
    });
    if (isFabric) this.applyDefaultFabricWidth(mc);
    this.refreshName();
    this.recalcPrice();
  },

  applyDefaultFabricWidth(mc) {
    if (!mc) return;
    let w;
    if (mc.defaultFabricWidth) {
      w = util.round(util.fromCm(mc.defaultFabricWidth, 'm'), 2);
    } else {
      // 物料分类未设默认幅宽时，兜底使用当前选中的预设值（默认 1.5m）
      w = Number(WIDTH_PRESETS_M[this.data.widthPresetIndex]);
    }
    const idx = WIDTH_PRESETS_M.indexOf(String(w));
    this.setData({
      fabricWidth: String(w),
      fabricWidUnit: 'm',
      widthMode: idx >= 0 ? 'preset' : 'custom',
      widthPresetIndex: idx >= 0 ? idx : this.data.widthPresetIndex
    });
  },

  refreshName() {
    const name = store.buildMaterialName(this.data.attrGroups, this.data.keywords);
    this.setData({ generatedName: name });
  },

  onMcChange(e) {
    const idx = Number(e.detail.value);
    this.setData({ mcIndex: idx });
    this.applyMcTemplate(idx, this.data.mcList);
  },
  onKeywords(e) { this.setData({ keywords: e.detail.value }); this.refreshName(); },
  onUnitChange(e) {
    const idx = Number(e.detail.value);
    const unit = this.data.unitPresets[idx];
    this.setData({ unitIndex: idx, unit: unit, avgUnit: unit, qtyInteger: isIntegerUnit(unit) });
    this.recalcPrice();
  },

  // ===== 通用主题选择器（替代原生 picker） =====
  openPicker(field, title, options, rangeKey, value) {
    this.setData({ picker: { show: true, field, title, options, rangeKey, value: value || 0 } });
  },
  closePicker() { this.setData({ 'picker.show': false }); },
  onPickerConfirm(e) {
    const idx = e.detail.value;
    const field = this.data.picker.field;
    this.setData({ 'picker.show': false });
    if (field === 'mc') {
      this.setData({ mcIndex: idx });
      this.applyMcTemplate(idx, this.data.mcList);
    } else if (field === 'unit') {
      const unit = this.data.unitPresets[idx];
      this.setData({ unitIndex: idx, unit: unit, avgUnit: unit, qtyInteger: isIntegerUnit(unit) });
      this.recalcPrice();
    } else if (field === 'pfL1') {
      this.setData({ platformL1Index: idx, purchaseL1: this.data.platformL1[idx] });
    } else if (field === 'pfL2') {
      this.setData({ platformL2Index: idx, purchaseL2: this.data.platformL2[idx] });
    }
  },
  openMcPicker() { this.openPicker('mc', '选择物料分类', this.data.mcList, 'name', this.data.mcIndex); },
  openUnitPicker() { this.openPicker('unit', '选择单位', this.data.unitPresets, '', this.data.unitIndex); },
  openPfL1Picker() { if (this.data.platformL1.length <= 1) return; this.openPicker('pfL1', '选择平台分类', this.data.platformL1, '', this.data.platformL1Index); },
  openPfL2Picker() { this.openPicker('pfL2', '选择购买渠道', this.data.platformL2, '', Math.max(0, this.data.platformL2Index)); },

  onTotalPrice(e) { this.setData({ totalPrice: e.detail.value }); this.recalcPrice(); },
  onFabricLength(e) { this.setData({ fabricLength: e.detail.value }); this.recalcPrice(); },
  onFabricWidth(e) { this.setData({ fabricWidth: e.detail.value, widthMode: 'custom' }); this.recalcPrice(); },
  onWidthPreset(e) {
    const idx = Number(e.detail.value);
    this.setData({ widthMode: 'preset', widthPresetIndex: idx, fabricWidth: WIDTH_PRESETS_M[idx], fabricWidUnit: 'm' });
    this.recalcPrice();
  },
  onQuickWidth(e) {
    const v = e.currentTarget.dataset.v;
    const idx = WIDTH_PRESETS_M.indexOf(v);
    this.setData({
      fabricWidth: v,
      widthMode: idx >= 0 ? 'preset' : 'custom',
      widthPresetIndex: idx >= 0 ? idx : this.data.widthPresetIndex,
      fabricWidUnit: 'm'
    });
    this.recalcPrice();
  },
  onToggleLenUnit() {
    const u = this.data.fabricLenUnit === 'm' ? 'cm' : 'm';
    const v = this.data.fabricLength;
    this.setData({ fabricLenUnit: u, fabricLength: v === '' ? '' : String(util.fromCm(util.toCm(v, this.data.fabricLenUnit), u)) });
    this.recalcPrice();
  },
  onToggleWidUnit() {
    const u = this.data.fabricWidUnit === 'm' ? 'cm' : 'm';
    const v = this.data.fabricWidth;
    this.setData({ fabricWidUnit: u, fabricWidth: v === '' ? '' : String(util.fromCm(util.toCm(v, this.data.fabricWidUnit), u)) });
    this.recalcPrice();
  },
  onWidthModeCustom() { this.setData({ widthMode: 'custom', fabricWidth: '' }); this.recalcPrice(); },
  onThreshold(e) { this.setData({ threshold: e.detail.value }); },
  onPfL1(e) {
    const idx = Number(e.detail.value);
    this.setData({ platformL1Index: idx, purchaseL1: PLATFORM_L1[idx] });
  },
  onPfL2(e) {
    const idx = Number(e.detail.value);
    this.setData({ platformL2Index: idx, purchaseL2: PLATFORM_L2[idx] });
  },
  onPfL2Custom(e) { this.setData({ purchaseL2: e.detail.value, platformL2Index: -1 }); },
  onShopName(e) { this.setData({ shopName: e.detail.value }); },
  onProductUrl(e) { this.setData({ productUrl: e.detail.value }); },
  copyUrl(e) {
    const url = e.currentTarget.dataset.url;
    // 走 util.copyText：空链接 / 写入失败 / 同步异常 都有提示（旧的裸调用失败时是完全静默的）。
    // 兜底说清楚"长按输入框"—— 这一页的链接就在上面的输入框里，不是只读文本
    util.copyText(url, { okText: '链接已复制', failText: '复制失败，可长按输入框里的链接手动复制' });
  },
  onRemark(e) { this.setData({ remark: e.detail.value }); },
  onQty(e) { this.setData({ qty: e.detail.value }); this.recalcPrice(); },
  onToggleBatch(e) {
    const on = e.detail ? e.detail.value : !this.data.showBatch;
    this.setData({ showBatch: on, stockMode: on ? 'batch' : 'piece' });
    this.recalcPrice();
  },
  // 计量方式切换：片 / kg / g
  // kg↔g 同属重量，按 1000 换算「表单总量」以及编辑态的「当前存量」与「单价」；与「片」互切属不同量纲，不换算
  onBatchUnit(e) {
    const u = e.currentTarget.dataset.u;
    const prev = this.data.batchUnit;
    if (u === prev) return;
    const isWeight = (x) => x === 'kg' || x === 'g';
    if (isWeight(prev) && isWeight(u)) {
      const factor = (prev === 'kg' && u === 'g') ? 1000 : 0.001; // kg→g 乘 1000；g→kg 除 1000
      const bt = Number(this.data.batchTotal) || 0;
      const nextTotal = bt > 0 ? util.round(bt * factor, 3) : 0;
      const remain = this.data.editBatchRemain;
      const price = this.data.editBatchPrice;
      this.setData({
        batchUnit: u,
        batchTotal: nextTotal > 0 ? String(nextTotal) : '',
        // 存量随单位放大/缩小；单价反向换算（元/kg ↔ 元/g）
        editBatchRemain: remain != null ? util.round(remain * factor, 3) : remain,
        editBatchPrice: price != null ? util.round(price / factor, 6) : price
      });
    } else {
      this.setData({ batchUnit: u });
    }
    this.recalcPrice();
  },
  onBatchTotal(e) { this.setData({ batchTotal: e.detail.value }); this.recalcPrice(); },

  onAttrVal(e) {
    const i = e.detail.ds.i;
    const attrGroups = this.data.attrGroups.slice();
    attrGroups[i].value = e.detail.value;
    this.setData({ attrGroups });
    this.refreshName();
  },
  onAttrPreset(e) {
    const i = e.currentTarget.dataset.i;
    const v = e.currentTarget.dataset.v;
    const attrGroups = this.data.attrGroups.slice();
    attrGroups[i].value = v;
    this.setData({ attrGroups });
    this.refreshName();
  },

  recalcPrice() {
    const total = Number(this.data.totalPrice);
    if (!(total > 0)) { this.setData({ calcPrice: '' }); return; }
    if (this.data.showBatch || this.data.stockMode === 'batch') {
      const bt = Number(this.data.batchTotal);
      const u = store.displayUnit(this.data.batchUnit); // piece 显示为「片」
      if (bt > 0) this.setData({ calcPrice: String(util.round(total / bt, 4)), avgUnit: u });
      else this.setData({ calcPrice: '', avgUnit: u });
      return;
    }
    if (this.data.isFabric) {
      const l = util.toCm(this.data.fabricLength, this.data.fabricLenUnit);
      const w = util.toCm(this.data.fabricWidth, this.data.fabricWidUnit);
      if (l > 0 && w > 0) {
        const areaSqm = (l * w) / 10000;
        this.setData({ calcPrice: String(util.round(total / areaSqm, 4)) });
      } else {
        this.setData({ calcPrice: '' });
      }
    } else {
      const q = Number(this.data.qty);
      if (q > 0) this.setData({ calcPrice: String(util.round(total / q, 4)) });
      else this.setData({ calcPrice: '' });
    }
  },

  /* ===== 照片：拍照 / 从相册选择 ===== */
  takePhoto() { this.openMedia(['camera']); },
  chooseFromAlbum() { this.openMedia(['album']); },
  openMedia(sourceType) {
    const remain = 9 - (this.data.photos || []).length;
    if (remain <= 0) { util.toast('最多 9 张照片'); return; }
    privacy.authorize(() => {
      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sourceType,
        success: async (res) => {
          const paths = [];
          for (const t of (res.tempFiles || [])) {
            try { paths.push(await store.savePhoto(t.tempFilePath)); }
            catch (e) { util.toast((e && (e.msg || e.message)) || '图片保存失败'); }
          }
          if (paths.length) this.setData({ photos: this.data.photos.concat(paths) });
        },
        fail: (err) => {
          const msg = (err && err.errMsg) || '';
          if (msg.indexOf('cancel') >= 0 || msg.indexOf('deny') >= 0) {
            util.toast('已取消选择');
          } else if (msg.indexOf('auth') >= 0 || msg.indexOf('Privacy') >= 0) {
            util.toast('请先同意隐私政策，并在公众平台配置《隐私保护指引》');
            setTimeout(() => { try { wx.openSetting && wx.openSetting(); } catch (e) {} }, 800);
          } else {
            util.toast('无法打开：' + (msg.split(':')[1] || '请重试'));
          }
        }
      });
    });
  },
  previewPhoto(e) {
    const idx = Number(e.currentTarget.dataset.i);
    wx.previewImage({ current: this.data.photos[idx], urls: this.data.photos });
  },
  delPhoto(e) {
    const i = Number(e.currentTarget.dataset.i);
    const photos = this.data.photos.slice();
    photos.splice(i, 1);
    this.setData({ photos });
  },

  /* ===== 订单截图：上传 / 预览 / 删除 ===== */
  chooseOrderImg() {
    const remain = 3 - (this.data.orderImages || []).length;
    if (remain <= 0) { util.toast('最多 3 张订单截图'); return; }
    privacy.authorize(() => {
      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: async (res) => {
          const paths = [];
          for (const t of (res.tempFiles || [])) {
            try { paths.push(await store.savePhoto(t.tempFilePath)); }
            catch (e) { util.toast((e && (e.msg || e.message)) || '图片保存失败'); }
          }
          if (paths.length) this.setData({ orderImages: this.data.orderImages.concat(paths) });
        },
        fail: (err) => {
          const msg = (err && err.errMsg) || '';
          if (msg.indexOf('cancel') >= 0 || msg.indexOf('deny') >= 0) util.toast('已取消选择');
          else if (msg.indexOf('auth') >= 0 || msg.indexOf('Privacy') >= 0) {
            util.toast('请先同意隐私政策，并在公众平台配置《隐私保护指引》');
            setTimeout(() => { try { wx.openSetting && wx.openSetting(); } catch (e) {} }, 800);
          } else util.toast('无法打开：' + (msg.split(':')[1] || '请重试'));
        }
      });
    });
  },
  previewOrderImg(e) {
    const idx = Number(e.currentTarget.dataset.i);
    wx.previewImage({ current: this.data.orderImages[idx], urls: this.data.orderImages });
  },
  delOrderImg(e) {
    const i = Number(e.currentTarget.dataset.i);
    const arr = this.data.orderImages.slice();
    arr.splice(i, 1);
    this.setData({ orderImages: arr });
  },

  save() {
    if (this._saving) return;   // 防双击：上一次保存尚未结束（重复点按会建出重复记录）
    this._saving = true;
    setTimeout(() => { this._saving = false; }, 800);
    const d = this.data;
    const isNew = !d.id;
    const em = d.id ? store.getMaterial(d.id) : null;
    const bc = d.bcList[d.bcIndex];
    const mc = d.mcList[d.mcIndex];
    if (!bc || !mc) { util.toast('请选择手作空间与物料分类'); return; }

    const name = store.buildMaterialName(d.attrGroups, d.keywords).trim();
    if (!name) { util.toast('请填写关键词，属性+关键词将生成物料名称'); return; }
    if (name.length > 30) { util.toast('生成的名称不能超过 30 个字'); return; }
    if (store.isNameDuplicate(name, d.id)) {
      util.toast('名称“' + name + '”已存在，请更换关键词');
      return;
    }
    const remark = d.remark || '';
    if (remark.length > 200) { util.toast('备注不能超过 200 个字'); return; }

    // ⚠️ 「本次总价」只属于「新增（初始入库）」场景。
    //    编辑态这个输入框是被隐藏的（showPriceFields=false → 「总价*」整行不渲染），
    //    若在此无条件校验，就会弹出「请输入本次总价」而用户根本找不到这个框 —— 编辑直接卡死。
    //    （2026-09-12 真机反馈：物料详情点编辑 → 保存 → 永远提示「请输入本次总价」）
    //    所以：编辑态既不校验它，也不用它反算任何数值。
    const totalPrice = isNew ? (d.totalPrice === '' ? 0 : Number(d.totalPrice)) : 0;
    if (isNew && !(totalPrice > 0)) { util.toast('请输入本次总价'); return; }

    const fabric = d.isFabric;
    const isBatch = fabric && (d.showBatch || d.stockMode === 'batch');
    let price = 0, fabricLength = null, fabricWidth = null;
    let batchUnitPrice = 0, bt = 0;
    if (fabric && !isBatch) {
      // 幅宽默认兜底 1.5m：若用户未选/未填，仍用界面高亮的默认值
      const fabricWidthVal = d.fabricWidth === '' ? WIDTH_PRESETS_M[d.widthPresetIndex] : d.fabricWidth;
      const l = util.toCm(d.fabricLength, d.fabricLenUnit), w = util.toCm(fabricWidthVal, d.fabricWidUnit);
      // 长/幅宽只在「新增」时是必要输入（要据此算均价）。
      // 编辑态若历史数据本就没有这两项，绝不能逼用户现编一个数 ——
      // 那种「进来就要求重填已有信息」正是本次反馈的问题（2026-09-12）。
      // 编辑态留空时沿用记录原值（没有就保持没有），不阻断保存。
      if (isNew && !(l > 0 && w > 0)) { util.toast('面料需填写长与幅宽'); return; }
      fabricLength = l > 0 ? util.round(l, 2) : (em && em.fabricLength != null ? em.fabricLength : null);
      fabricWidth = w > 0 ? util.round(w, 2) : (em && em.fabricWidth != null ? em.fabricWidth : null);
      // 均价仅新增时由总价反算；编辑态沿用账本里的值（见下方「不碰 price」）
      if (isNew) price = util.round(totalPrice / ((l * w) / 10000), 4);
    } else if (isBatch) {
      // 按批估量（刀口布）：总量是既有数据（编辑态已回填），必须保留
      bt = Number(d.batchTotal);
      if (!(bt > 0)) { util.toast('按批估量请填写总量（' + store.displayUnit(d.batchUnit) + '）'); return; }
      if (isNew) batchUnitPrice = util.round(totalPrice / bt, 4);
    } else {
      // 数量仅新增态需要（编辑态库存已存在；改库存请走详情页「盘点」）
      const q = Number(d.qty);
      if (isNew && !(q > 0)) { util.toast('请填写数量才能计算单价'); return; }
      if (isNew && d.qtyInteger && !Number.isInteger(q)) { util.toast('当前单位「' + (d.unit || '个') + '」为计数单位，请填整数数量'); return; }
      if (isNew) price = q > 0 ? util.round(totalPrice / q, 4) : 0;
    }

    // ★ 以现有记录为基底再覆盖表单字段（编辑态）：
    //   saveMaterial 内部是 list[i] = m 的**整体替换**，若只拿表单字段拼对象，
    //   任何表单管不到的字段（历史遗留 / 将来新增的字段）都会被静默删除。
    //   这样「保存只改所动之处」才是结构性成立的，而不是靠逐字段手工保留。
    const nextStockMode = isBatch ? 'batch' : (fabric ? 'piece' : 'each');
    const m = em ? Object.assign({}, em) : {};
    Object.assign(m, {
      id: d.id || '',
      name: name,
      keywords: d.keywords.trim(),
      categoryId: bc.id,
      materialCategoryId: mc.id,
      unit: d.unit || mc.defaultUnit || '个',
      stockMode: nextStockMode,
      fabricLength: (fabric && !isBatch) ? fabricLength : null,
      fabricWidth: (fabric && !isBatch) ? fabricWidth : null,
      batchUnit: isBatch ? d.batchUnit : undefined,
      batchTotal: isBatch ? util.round(bt, 3) : undefined,
      // 编辑态沿用本地副本（可能已随 kg↔g 换算），新建态直接以总量作为初始库存
      batchRemain: isBatch ? (isNew ? util.round(bt, 3) : (d.editBatchRemain != null ? util.round(d.editBatchRemain, 3) : util.round(bt, 3))) : undefined,
      batchUnitPrice: isBatch ? (isNew ? batchUnitPrice : (d.editBatchPrice != null ? d.editBatchPrice : batchUnitPrice)) : undefined,
      threshold: d.threshold === '' ? null : Number(d.threshold),
      attrGroups: d.attrGroups.filter(g => g.dimension && String(g.value).trim()).map(g => ({ dimension: g.dimension, value: g.value })),
      photos: d.photos || [],
      purchaseL1: d.purchaseL1, purchaseL2: d.purchaseL2, shopName: d.shopName, productUrl: d.productUrl,
      orderImages: d.orderImages || [],
      remark: remark
    });
    // 数量 / 布片清单是「库存本体」，改资料时不应被动到。
    // 只在库存形态真的变了（新建 / 面料↔非面料 / 按批估量开关）才重设，否则保持原值。
    if (em && em.stockMode === nextStockMode && !!em.isFabric === !!fabric) {
      // 库存形态未变：原样保留（基底已带，不写即为不改）
    } else {
      m.quantity = nextStockMode === 'each' ? (em ? (em.quantity || 0) : 0) : 0;
      m.pieces = nextStockMode === 'piece' ? (em ? (em.pieces || []) : []) : [];
    }
    if (isNew) {
      // 「本次总价」只写进新建的记录；编辑态保持原值不动（不重算、不覆盖）
      m.totalPrice = util.round(totalPrice, 2);
      // 库存总值（totalValue）：非面料/按片面料由下方 inbound 流水建立；
      // 按批估量（刀口布）不走 inbound（inbound 对面料按 pieces 几何算），所以直接以总价作为初始库存价值。
      m.totalValue = isBatch ? util.round(totalPrice, 2) : 0;
      m.price = price;
    } else {
      // 编辑态：库存总值（totalValue）与均价缓存（price）一律**不碰** —— 它们是账本口径，
      // 由出入库流水维护（inbound 对面料写的是「元/m²」，非面料写「元/单位」）。
      //
      // ⚠️ 历史 bug（2026-09-12 排查编辑页时发现）：这里曾写 m.price = store.unitCost(em)，
      //    而 unitCost 对面料返回「元/cm²」——与 inbound 的「元/m²」差 10000 倍。
      //    也就是说：每从编辑页保存一次，面料的单价就被缩小一万倍（CSV 导出的「单价」列因此全错）。
      //    修法就是「不改动」—— 不改动才是真正的保留，也才符合「保存只改所动之处」。
    }

    store.saveMaterial(m);

    if (isNew) {
      try {
        if (!fabric) {
          store.inbound(m.id, Number(d.qty), d.totalPrice, '初始入库');
        } else if (!isBatch) {
          store.inbound(m.id, 0, { length: fabricLength, width: fabricWidth, total: d.totalPrice }, '初始入库');
        }
        // batch 新建：batchRemain / totalValue 已在 m 中直接赋值，不调 inbound（inbound 对面料走 pieces 几何）
      } catch (err) {
        util.toast('数量录入失败：' + (err.msg || '请检查数值'));
      }
    }

    util.toast('已保存', 'success');
    setTimeout(() => wx.navigateBack(), 400);
  }
});
