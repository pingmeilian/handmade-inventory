// pages/products/edit.js —— 成品新增 / 编辑（M1-06 / M1-07 / M1-09 / M1-16）
const app = getApp();
const store = require('../../utils/store.js');
const state = require('../../services/state.js');
const calc = require('../../utils/calc.js');
const util = require('../../utils/util.js');
const privacy = require('../../utils/privacy.js');
const palette = require('../../utils/palette.js');

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  onShow() {
    themePage.apply(this);   // 主题（V97）
    // 原生 <switch> 的 color 是**组件属性**，吃不到 CSS 变量 ⇒ 从主题 token 取色值传下去。
    // （V127：原先写死 color="#C28E72" —— 换主题时开关不变色，违反"色值走主题变量"）
    this.setData({ switchColor: themePage.tokens().primary });
  },

  data: {
    id: '', isEdit: false,
    bcIndex: 0, bcList: [],
    pcIndex: 0, pcList: [],
    photos: [],
    name: '',
    // V137：成品备注（**没有对应的输入框**）。它只做一件事：在「由灵感 / 想做转入」时
    //   记下出处，并原样存回 —— 不做成可见字段，免得改变现有界面。
    //   ⚠️ 必须同时进 loadProduct（否则编辑老成品时会把已有备注覆盖成空串：
    //      saveProduct 是 `Object.assign({}, old, p)`，显式给了空串就等于删除）。
    notes: '',
    nature: 'merchandise',   // merchandise（商品，产生利润）| sample（样品，仅成本）
    saleStatus: 'unsold',
    bom: [],
    matIndex: 0, matList: [], matAll: [],
    showMatPicker: false, pickerBomIndex: -1, matSearch: '', matFilterMcId: 'all', matPickerGroups: [],
    matPreview: null,   // 长按物料时的预览数据（松手即清空）
    includeLabor: false,
    laborMode: 'perPiece',
    laborFeePerPiece: '', hourlyRate: '', laborHours: '',
    packaging: '', shipping: '',
    dispMaterial: '0.00', dispProfit: '0.00', dispPackaging: '0.00', dispShipping: '0.00',
    dispPrice: '0.00', dispRate: '—',
    linkedCommissions: [],
    tutorial: { title: '', steps: [] },
    // ⛔ 图文教程暂不上架（2026-10-09 · 台账 V126）：改成 true 就恢复这一整块编辑区。
    //    ⚠️ 本页的教程**数据链路必须保留**（loadProduct 回填 + buildProduct 写回）——
    //       一旦哪个字段没被写回，保存就会把已有教程清空（同 V122 那个白名单坑）。
    //       所以这里只遮 UI、不动任何 tutorial 逻辑。detail.js 有同名开关，两处要一起改。
    showTutorial: false,
    tutCollapsed: false,
    tutBomMats: [],          // 本成品 BOM 物料（供步骤勾选，仅限这些）
    dragStep: -1,            // 步骤拖拽中索引
    dragImg: { step: -1, idx: -1 }, // 图片拖拽中（步骤内）
    stepRects: [],           // 拖拽时步骤行位置
    imgPreview: { show: false, step: -1, idx: -1, urls: [] }, // 自定义全屏预览
    picker: { show: false, title: '', options: [], rangeKey: '', value: 0, field: '' }
  },

  onLoad(options) {
    const bcList = store.getBusinessCategories();
    const pcList = store.getList('productCategory');
    const mcList = store.getList('materialCategory');
    const cur = state.getCurrentSpace();
    const bcIndex = Math.max(0, bcList.findIndex(c => c.id === cur));
    const allMats = store.getMaterials();
    const matAll = allMats.map(m => this._wrapMaterial(m));
    const matList = allMats.filter(m => (m.categoryId || 'bc_default') === cur).map(m => this._wrapMaterial(m));
    this.setData({ bcList, pcList, mcList, bcIndex, matAll, matList });
    if (options.template) {
      this.loadProduct(options.template, bcList, true);
      return;
    }
    if (options.id) {
      this.loadProduct(options.id, bcList, false);
      return;
    }
    // V137：从「灵感 / 想做」转过来（`?from=inspiration|want&sid=<源记录 id>`）。
    //   用户拍板：**不要进来就把成品建出来**，而是把名称 / 图片 / 教程等填进这张表单，
    //   由用户自己选物料、点保存才算建成品。
    //   ⚠️ 本页 save() 本来就有「请至少添加一项物料(BOM)」的校验 —— 这正是用户要的效果：
    //      没选料就存不下去，不会再出现"成品保存了、物料一栏全空"。
    const from = options.from === 'want' || options.from === 'inspiration' ? options.from : '';
    const sid = from ? String(options.sid || '') : '';
    this._source = sid ? { kind: from, id: sid } : null;
    const pc = pcList[0];
    this.setData({
      packaging: pc ? String(pc.packaging || 0) : '0',
      shipping: pc ? String(pc.shipping || 0) : '0',
      hourlyRate: pc && pc.hourlyWage != null ? String(pc.hourlyWage) : ''
    });
    if (this._source) this.applySourceDraft();
    this.recompute();
  },

  // 把来源（灵感 / 想做）的信息填进表单。
  // ⚠️ 取不到来源（记录被删了 / 参数是脏的）⇒ 什么都不做，按"普通新建"继续 ——
  //    绝不半填：半填会让用户以为信息带过来了，实际漏了。
  applySourceDraft() {
    const draft = store.buildProductDraftFromSource(this._source.kind, this._source.id);
    if (!draft) { this._source = null; return; }
    const tut = draft.tutorial || { title: '', steps: [] };
    this.setData({
      name: draft.name || '',
      notes: draft.notes || '',
      photos: (draft.photos || []).slice(),
      // 教程步骤要补齐界面用的两个字段（与 loadProduct 的回填口径一致）
      tutorial: {
        title: tut.title || '',
        steps: (tut.steps || []).map(s => ({
          id: s.id || util.uid('st'),
          title: s.title || '', body: s.body || '',
          images: (s.images || []).map(im => ({ path: im.path || im, remark: im.remark || '' })),
          mats: (s.mats || []).slice(),
          pageBreak: !!s.pageBreak,
          _open: false, _matSel: []
        }))
      }
    });
    this.syncTutBomMats();
  },

  _wrapMaterial(m) {
    const mcList = store.getList('materialCategory');
    const mc = mcList.find(c => c.id === m.materialCategoryId);
    // 无图占位块配色：随物料分类走（与成品品类用同一套色板）
    const cc = palette.colorOf(mcList, m.materialCategoryId, 0);
    // 展示口径与物料库列表一致（余量 / 单价），供选择器行内显示
    const br = store.materialBrief(m);
    return {
      id: m.id,
      name: m.name,
      keywords: m.keywords || '',
      placeholder: (m.name || '物').slice(0, 1),
      color: cc.bg,
      ink: cc.inkSoft,
      unit: m.unit || '',
      isFabric: br.isFabric,
      stockText: br.stockText,
      priceSeg: br.priceSeg,
      low: store.isLowStock(m),
      stockMode: m.stockMode || 'piece', // piece（按片精确）| batch（按批估量/刀口布）
      batchUnit: m.batchUnit || 'kg',
      price: m.price || 0,
      thumb: (m.photos || [])[0] || '',
      categoryId: m.categoryId,
      materialCategoryId: m.materialCategoryId,
      materialCategoryName: mc ? mc.name : '其他'
    };
  },

  loadProduct(id, bcList, asTemplate) {
    const p = store.getProduct(id);
    if (!p) { util.toast('成品不存在'); return; }
    const bcIndex = Math.max(0, bcList.findIndex(c => c.id === p.categoryId));
    const pcIndex = Math.max(0, this.data.pcList.findIndex(c => c.id === p.productCategoryId));
    const pc = this.data.pcList[pcIndex] || {};
    const materials = store.getMaterials();
    // 先把 BOM 涉及但不在当前 matList 的物料补充进去，避免循环里 setData
    const missingIds = new Set();
    (p.bom || []).forEach(b => { if (b.materialId && !this.data.matList.some(x => x.id === b.materialId)) missingIds.add(b.materialId); });
    const missing = materials.filter(m => missingIds.has(m.id)).map(m => this._wrapMaterial(m));
    const displayList = missing.length ? this.data.matList.concat(missing) : this.data.matList;
    if (missing.length) this.setData({ matList: displayList });
    const bom = (p.bom || []).map(b => {
      const m = materials.find(x => x.id === b.materialId);
      const fabric = b.isFabric != null ? b.isFabric : (m ? store.isMaterialFabric(m) : false);
      const stockMode = (fabric && m) ? (m.stockMode || 'piece') : 'piece';
      const isBatch = fabric && stockMode === 'batch'; // 按批估量（刀口布）
      const matSel = displayList.findIndex(x => x.id === b.materialId);
      return {
        materialId: b.materialId, materialName: b.materialName, isFabric: fabric, stockMode,
        unit: m ? (m.unit || '') : '', priceSnapshot: b.priceSnapshot || 0,
        usage: fabric ? '' : String(b.usage || ''),
        batchUsage: isBatch ? String(b.batchUsage || '') : '',
        // ★ 刀口布不裁剪、不计面积 → 长宽一律留空。旧数据里可能残留长宽（历史版本落库），
        //   若照搬回填，保存时又会弹出「请先完成裁剪」（2026-09-12 真机反馈的循环根因）
        length: (fabric && !isBatch) ? String(util.fromCm(b.length || 0, 'cm')) : '',
        width: (fabric && !isBatch) ? String(util.fromCm(b.width || 0, 'cm')) : '',
        batchUnitText: m ? store.displayUnit(m.batchUnit) : '',
        lenUnit: 'cm', widUnit: 'cm',
        area0: isBatch ? 0 : (b.area || 0),
        // V122：片清单必须回填 —— 原来这里是字段白名单、没有它 ⇒ 一保存再打开，
        //   多片方案就永久丢了（用户「保存成品后打开该成品也只有一片布」）。
        chosenSchemes: (!isBatch && Array.isArray(b.chosenSchemes)) ? b.chosenSchemes : [],
        matSel: Math.max(0, matSel)
      };
    });
    const linked = store.getCommissions().filter(c => c.productId === p.id)
      .map(c => ({ id: c.id, name: c.client || '排单', remain: util.round((c.qty || 0) - (c.deliveredQty || 0), 2), status: c.status }));
    const tut = p.tutorial || {};
    const steps = (tut.steps || []).map(s => ({
      id: s.id || util.uid('st'),
      title: s.title || '', body: s.body || '',
      images: (s.images || []).map(im => ({ path: im.path || im, remark: im.remark || '' })),
      mats: (s.mats || []).slice(),
      pageBreak: !!s.pageBreak,
      _open: false, _matSel: []
    }));
    this.setData({
      id: asTemplate ? '' : p.id, isEdit: !asTemplate,
      bcIndex, pcIndex,
      photos: (p.photos || []).slice(),
      name: asTemplate ? (p.name + '（副本）') : p.name,
      notes: p.notes || '',   // V137：必须回填，否则编辑保存时会被空串覆盖（见 data.notes 注释）
      nature: p.nature || 'merchandise',
      saleStatus: p.saleStatus || 'unsold',
      bom,
      includeLabor: !!p.includeLabor, laborMode: p.laborMode || 'perPiece',
      laborFeePerPiece: p.laborFeePerPiece == null ? '' : String(p.laborFeePerPiece),
      hourlyRate: p.hourlyRate == null ? '' : String(p.hourlyRate),   // 注意字段名是 hourlyRate（曾误写成 hourRate，界面上会显示 "undefined"）
      laborHours: p.laborHours == null ? '' : String(p.laborHours),
      packaging: p.packaging != null ? String(p.packaging) : String(pc.packaging || 0),
      shipping: p.shipping != null ? String(p.shipping) : String(pc.shipping || 0),
      linkedCommissions: linked,
      tutorial: { title: tut.title || '', steps },
      tutCollapsed: false
    });
    this.syncTutBomMats();
    this.recompute();
  },

  matUnit(mid) {
    const m = store.getMaterial(mid); return m ? (m.unit || '') : '';
  },

  noop() {},
  onPcChange(e) {
    const pcIndex = Number(e.detail.value);
    const pc = this.data.pcList[pcIndex] || {};
    this.setData({ pcIndex, packaging: String(pc.packaging || 0), shipping: String(pc.shipping || 0), hourlyRate: pc.hourlyWage != null ? String(pc.hourlyWage) : this.data.hourlyRate });
    this.recompute();
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
    if (field === 'pc') this.onPcChange({ detail: { value: idx } });
  },
  openPcPicker() { this.openPicker('pc', '选择品类', this.data.pcList, 'name', this.data.pcIndex); },

  onName(e) { this.setData({ name: e.detail.value }); },
  onNature(e) {
    const v = e.currentTarget.dataset.v;
    // 两态：商品（产生利润）/ 样品（仅成本）
    this.setData({ nature: v === 'sample' ? 'sample' : 'merchandise' });
    this.recompute();
  },
  onSaleStatus(e) { this.setData({ saleStatus: e.currentTarget.dataset.v }); },
  onPackaging(e) { this.setData({ packaging: e.detail.value }); this.recompute(); },
  onShipping(e) { this.setData({ shipping: e.detail.value }); this.recompute(); },
  onIncludeLabor(e) { this.setData({ includeLabor: e.detail.value }); this.recompute(); },
  onLaborMode(e) { this.setData({ laborMode: e.currentTarget.dataset.v }); this.recompute(); },
  onLaborFee(e) { this.setData({ laborFeePerPiece: e.detail.value }); this.recompute(); },
  onHourlyRate(e) { this.setData({ hourlyRate: e.detail.value }); this.recompute(); },
  onLaborHours(e) { this.setData({ laborHours: e.detail.value }); this.recompute(); },

  // 步骤物料勾选范围严格限定为本成品 BOM 列表
  syncTutBomMats() {
    const mats = (this.data.bom || []).filter(b => b.materialId).map(b => ({ id: b.materialId, name: b.materialName }));
    const steps = (this.data.tutorial.steps || []).map(s => {
      s._matSel = mats.map(m => (s.mats || []).includes(m.id));
      return s;
    });
    this.setData({ tutBomMats: mats, tutorial: { title: this.data.tutorial.title, steps } });
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

  /* ===== BOM 行 ===== */
  addBom() {
    this.setData({ bom: this.data.bom.concat([{ materialId: '', materialName: '', isFabric: false, stockMode: 'piece', unit: '', priceSnapshot: 0, usage: '', batchUsage: '', length: '', width: '', lenUnit: 'cm', widUnit: 'cm', matSel: 0 }]) });
    this.syncTutBomMats();
  },
  delBom(e) {
    const i = e.currentTarget.dataset.i; const bom = this.data.bom.slice(); bom.splice(i, 1);
    this.setData({ bom }); this.recompute(); this.syncTutBomMats();
  },
  /* ===== BOM 物料选择器（弹窗 + 搜索 + 按物料分类分块） ===== */
  openMatPicker(e) {
    const i = Number(e.currentTarget.dataset.i);
    this.setData({ showMatPicker: true, pickerBomIndex: i, matSearch: '', matFilterMcId: 'all', matPreview: null });
    this.updatePickerGroups('', 'all');
  },
  closeMatPicker() {
    this.setData({ showMatPicker: false, pickerBomIndex: -1, matSearch: '', matPreview: null });
  },
  // 长按物料 → 立即预览（规格 / 尺寸 / 可用数量 / 面料的布片清单）
  // ⚠️ 必须实时取库：不能用 this.data.matAll（那是进入页面时的快照，
  //    用户刚补货/刚裁掉一片时预览会显示过期数字）
  onMatPreview(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ matPreview: store.materialPreview(store.getMaterial(id)) || null });
  },
  // 松手 / 手势被打断 → 收起预览。不打断选择：微信规定 longpress 触发后同手势的 tap 不再触发，
  // 所以长按预览不会误选物料；正常点按依旧走 selectMat。
  onMatPreviewEnd() {
    if (this.data.matPreview) this.setData({ matPreview: null });
  },
  // 页面被切走（来电 / 切后台 / 跳转）时收起预览：按住期间被切走，平台不一定会补 touchcancel，
  // 不清理的话卡片会残留到下一次触摸（评审发现）
  onHide() {
    if (this.data.matPreview) this.setData({ matPreview: null });
  },
  onMatSearch(e) {
    this.setData({ matSearch: e.detail.value });
    this.updatePickerGroups(e.detail.value, this.data.matFilterMcId);
  },
  onMatFilterMc(e) {
    const mcId = e.currentTarget.dataset.id;
    this.setData({ matFilterMcId: mcId });
    this.updatePickerGroups(this.data.matSearch, mcId);
  },
  updatePickerGroups(keyword, mcId) {
    const kw = (keyword || '').trim().toLowerCase();
    const all = this.data.matAll;
    const filtered = all.filter(m => {
      if (mcId && mcId !== 'all' && m.materialCategoryId !== mcId) return false;
      if (!kw) return true;
      return (m.name || '').toLowerCase().includes(kw) || (m.keywords || '').toLowerCase().includes(kw);
    });
    const groups = [];
    const mcList = store.getList('materialCategory');
    mcList.forEach(mc => {
      const items = filtered.filter(m => m.materialCategoryId === mc.id);
      if (items.length) groups.push({ mcId: mc.id, mcName: mc.name, items });
    });
    // 兜底：未匹配到任何物料分类（历史数据）
    const other = filtered.filter(m => !mcList.some(mc => mc.id === m.materialCategoryId));
    if (other.length) groups.push({ mcId: 'other', mcName: '其他', items: other });
    this.setData({ matPickerGroups: groups });
  },
  selectMat(e) {
    const matId = e.currentTarget.dataset.id;
    const m = this.data.matAll.find(x => x.id === matId);
    if (!m) return;
    // 2026-09-30 V83：**面料按片**的料，点一下**不是直接选中**，而是进「裁剪排版」——
    // 把「选料」和「裁剪」两步并成一步（用户 D101：「相当于把选择布料和剪裁本来两个步骤
    // 两个界面合成了一步」）。在那边输入长宽、拖好位置、点"就这样裁" = 这块料就选好了；
    // **真正扣料仍发生在保存成品时**，与既有口径一致。
    // 其它物料（拉链 / 珠饰 / 刀口布…）没有排版可言，仍直接选中。
    if (m.isFabric && (m.stockMode || 'piece') === 'piece') {
      util.navTo({
        url: '/pages/cut-editor/cut-editor?id=' + matId,
        events: {
          // ⚠️ 回传的尺寸**一律是厘米**（V85）：裁剪界面上的 cm/m 只是"输入方式"，
          //    进 BOM 前统一换算。原因：下游有 8 处按厘米直接读 b.length / b.width。
          // ⚠️ 回传的是**这一行用到的全部片**（V91）：一件成品的一个面料行可能用两块布，
          //    所以是 schemes 数组（每项带 pieceId / rotate / at —— 缺了它
          //    ①保存被拦 ②扣料时用户选的布会被系统自己挑的顶掉）。
          onCutChosen: (d) => { this.applyMatToBom(matId, (d && d.schemes) || []); }
        },
        // ⭐ V120：这一行**原来就有**裁剪方案时（重新编辑），把它递进裁剪页**原位回填** ——
        //   否则界面只显示默认一片，用户会以为"上次排的两片丢了"，再确认一次还会把方案覆盖成一片。
        success: (res) => {
          if (res && res.eventChannel) {
            res.eventChannel.emit('passSchemes', { schemes: this.schemesOfRow(this.data.pickerBomIndex) });
          }
        }
      });
      return;
    }
    this.applyMatToBom(matId);
  },

  // V120：取某一 BOM 行**已存**的裁剪方案（没有就空数组）—— 给裁剪页"原位回填"用。
  //   chosenSchemes 是数组（一件的一个面料行可以用两块布，逐片记 pieceId/rotate/at）。
  schemesOfRow(i) {
    const b = (i >= 0 && this.data.bom[i]) || null;
    return (b && Array.isArray(b.chosenSchemes)) ? b.chosenSchemes : [];
  },

  // 把物料落到当前 BOM 行（可带裁剪方案）—— 原 selectMat 的主体，两个入口共用
  // schemes（可选）：裁剪界面回传的**这一行用到的全部片**
  //   [{ length, width, pieceId, rotate, at }, …]。
  //   传了 = **用户已经在裁剪界面选好每块布、摆在哪** ⇒ 记成这行的裁剪方案（chosenSchemes）。
  //   V91 起是**数组**（一件成品的一个面料行可以用两块布，每块各扣一次）；
  //   空数组 / 不传 = 只选了物料、还没裁剪。
  // rowIdx（可选）：落到第几行。不传就用选择器打开时记下的 pickerBomIndex
  //   （行内「剪裁」按钮是从某一行直接进来的，那时没有选择器，必须显式给行号）
  applyMatToBom(matId, schemes, rowIdx) {
    const m = this.data.matAll.find(x => x.id === matId);
    if (!m) return;
    const i = (rowIdx == null || rowIdx < 0) ? this.data.pickerBomIndex : rowIdx;
    if (!(i >= 0) || !this.data.bom[i]) return;
    const bom = this.data.bom.slice();
    // 保证 matList 包含该物料，方便行内显示
    let matSel = this.data.matList.findIndex(x => x.id === matId);
    let newList = null;
    if (matSel < 0) {
      newList = this.data.matList.concat(m);
      matSel = newList.length - 1;
    }
    bom[i].matSel = matSel;
    bom[i].materialId = m.id;
    bom[i].materialName = m.name;
    bom[i].isFabric = m.isFabric;
    bom[i].stockMode = m.stockMode || 'piece'; // 面料细分：按片精确 / 按批估量(刀口布)
    bom[i].unit = m.unit;
    bom[i].priceSnapshot = m.price;
    delete bom[i].chosenScheme; // 换了物料，原裁剪排版失效
    // ⭐ 在裁剪界面点「就这样裁」= 这行的**裁剪方案已定** ⇒ 落下 chosenSchemes（V87 / V91）。
    //   ① 不落 → `calc.pendingCutLines` 认为这行"没选方案"，保存时弹「请先完成裁剪」（真机反馈）
    //   ② 不落 → 保存 / 生产时找不到方案 ⇒ `pickCutSource` **自己挑一块布**，
    //      **用户在界面上选的那块布、摆的位置全被丢掉**（账面上看不出来）
    //   V91 起是**数组**：一件成品的一个面料行可以用两块布（每块各扣一次料）。
    //   字段口径：length/width = 红区尺寸（cm，**不随转 90° 变**）；
    //   rotate + pieceId + at = 摆放信息（at 用布内坐标 cm、原点左下，与几何内核一致）。
    const cutList = (Array.isArray(schemes) ? schemes : []).filter(s => s && s.pieceId);
    if (cutList.length) {
      // BOM 行的长宽 = **主片**（第一片）的尺寸；其余片记在 chosenSchemes 里
      bom[i].length = util.round(cutList[0].length, 2);
      bom[i].width = util.round(cutList[0].width, 2);
      bom[i].chosenSchemes = cutList.map(s => ({
        materialId: matId,
        length: util.round(s.length, 2),
        width: util.round(s.width, 2),
        pieceId: s.pieceId,
        rotate: !!s.rotate,
        at: (s.at && s.at.x != null && s.at.y != null)
          ? { x: util.round(s.at.x, 2), y: util.round(s.at.y, 2) } : null
      }));
      delete bom[i].chosenScheme;   // 老的单数字段退役，别两套并存
    }
    const patch = { bom, showMatPicker: false, pickerBomIndex: -1, matSearch: '', matPreview: null };
    if (newList) patch.matList = newList;
    this.setData(patch);
    this.recompute();
    this.syncTutBomMats();
  },

  // 保留旧事件名占位，防止 wxml 历史绑定报错（实际已改用 openMatPicker）
  onBomMat(e) { },
  onBomUsage(e) { const i = e.currentTarget.dataset.i; const bom = this.data.bom.slice(); bom[i].usage = e.detail.value; this.setData({ bom }); this.recompute(); },
  onBomBatchUsage(e) { const i = e.currentTarget.dataset.i; const bom = this.data.bom.slice(); bom[i].batchUsage = e.detail.value; this.setData({ bom }); this.recompute(); },
  // 改了长宽 ⇒ 原裁剪方案失效（尺寸变了，方案是按老尺寸排的），一并清掉
  onBomLen(e) { const i = e.currentTarget.dataset.i; const bom = this.data.bom.slice(); bom[i].length = e.detail.value; delete bom[i].chosenScheme; delete bom[i].chosenSchemes; this.setData({ bom }); this.recompute(); },
  onBomWid(e) { const i = e.currentTarget.dataset.i; const bom = this.data.bom.slice(); bom[i].width = e.detail.value; delete bom[i].chosenScheme; delete bom[i].chosenSchemes; this.setData({ bom }); this.recompute(); },
  // 单行面料：选好物料且长宽齐全后，单独进入该面料的裁剪排版（不等整成品保存后再操作）
  // 2026-09-30 V89：改走新的裁剪排版页（与「选择物料」进的是**同一个界面**）——
  //   用户要求「所有的剪裁都换成现在这种」，旧的方案卡片选择器（cut-picker）已删。
  goCutLayout(e) {
    const i = Number(e.currentTarget.dataset.i);
    const b = this.data.bom[i];
    if (!b || !b.materialId || !b.length || !b.width) return; // 长宽未齐时按钮置灰，不会进这里
    const redLen = util.round(util.toCm(b.length, b.lenUnit || 'cm'), 2);
    const redWid = util.round(util.toCm(b.width, b.widUnit || 'cm'), 2);
    util.navTo({
      // 尺寸带过去当初始值（cm），进去之后可改 —— 改完按「就这样裁」重新落方案
      url: '/pages/cut-editor/cut-editor?id=' + b.materialId + '&len=' + redLen + '&wid=' + redWid,
      events: {
        onCutChosen: (d) => {
          // 与「选择物料」那条路完全同构：落 chosenSchemes（每块布 / 转没转 / 摆在哪）
          this.applyMatToBom(b.materialId, (d && d.schemes) || [], i);
          util.toast('裁剪方案已记录', 'success');
        }
      },
      // ⭐ V120：这一行已存的方案原样递进去（再次编辑时**原位**带回来，不再只显示一片）
      success: (res) => {
        if (res && res.eventChannel) {
          res.eventChannel.emit('passSchemes', { schemes: this.schemesOfRow(i) });
        }
      }
    });
  },
  onToggleBomLenUnit(e) {
    const i = Number(e.currentTarget.dataset.i);
    const bom = this.data.bom.slice();
    const oldU = bom[i].lenUnit; const newU = oldU === 'm' ? 'cm' : 'm';
    const v = bom[i].length;
    bom[i].lenUnit = newU;
    bom[i].length = v === '' ? '' : String(util.fromCm(util.toCm(v, oldU), newU));
    this.setData({ bom }); this.recompute();
  },
  onToggleBomWidUnit(e) {
    const i = Number(e.currentTarget.dataset.i);
    const bom = this.data.bom.slice();
    const oldU = bom[i].widUnit; const newU = oldU === 'm' ? 'cm' : 'm';
    const v = bom[i].width;
    bom[i].widUnit = newU;
    bom[i].width = v === '' ? '' : String(util.fromCm(util.toCm(v, oldU), newU));
    this.setData({ bom }); this.recompute();
  },

  /* ===== 图文教程 ===== */
  onTutTitle(e) { this.setData({ 'tutorial.title': e.detail.value }); },
  toggleTutCollapsed() { this.setData({ tutCollapsed: !this.data.tutCollapsed }); },

  _newStep(extra) {
    return Object.assign({ id: util.uid('st'), title: '', body: '', images: [], mats: [], pageBreak: false, _open: true, _matSel: this.data.tutBomMats.map(() => false) }, extra || {});
  },
  addStep() {
    const steps = this.data.tutorial.steps.concat([this._newStep()]);
    this.setData({ 'tutorial.steps': steps });
  },
  toggleStepOpen(e) {
    const i = Number(e.currentTarget.dataset.i);
    const steps = this.data.tutorial.steps.slice();
    steps[i]._open = !steps[i]._open;
    this.setData({ 'tutorial.steps': steps });
  },
  onStepTitle(e) {
    const i = Number(e.currentTarget.dataset.i);
    const steps = this.data.tutorial.steps.slice();
    steps[i].title = e.detail.value;
    this.setData({ 'tutorial.steps': steps });
  },
  onStepBody(e) {
    const i = Number(e.currentTarget.dataset.i);
    const steps = this.data.tutorial.steps.slice();
    steps[i].body = e.detail.value;
    this.setData({ 'tutorial.steps': steps });
  },
  // 步骤图片：拍照 / 相册多选
  chooseStepImage(e) {
    const i = Number(e.currentTarget.dataset.i);
    const remain = 18 - (this.data.tutorial.steps[i].images || []).length;
    if (remain <= 0) { util.toast('单步最多 18 张图'); return; }
    privacy.authorize(() => {
      wx.chooseMedia({
        count: remain, mediaType: ['image'], sourceType: ['album', 'camera'],
        success: async (res) => {
          const imgs = [];
          for (const t of (res.tempFiles || [])) {
            try { imgs.push({ path: await store.savePhoto(t.tempFilePath), remark: '' }); } catch (e) { util.toast((e && (e.msg || e.message)) || '图片保存失败'); }
          }
          if (imgs.length) {
            const steps = this.data.tutorial.steps.slice();
            steps[i].images = steps[i].images.concat(imgs);
            this.setData({ 'tutorial.steps': steps });
          }
        },
        fail: (err) => {
          const msg = (err && err.errMsg) || '';
          if (msg.indexOf('cancel') >= 0 || msg.indexOf('deny') >= 0) util.toast('已取消选择');
          else if (msg.indexOf('auth') >= 0) util.toast('请先在公众平台配置《隐私保护指引》');
          else util.toast('无法打开：' + (msg.split(':')[1] || '请重试'));
        }
      });
    });
  },
  delStepImage(e) {
    const i = Number(e.currentTarget.dataset.i), j = Number(e.currentTarget.dataset.j);
    const steps = this.data.tutorial.steps.slice();
    steps[i].images.splice(j, 1);
    this.setData({ 'tutorial.steps': steps });
  },
  previewStepImage(e) {
    const i = Number(e.currentTarget.dataset.i), j = Number(e.currentTarget.dataset.j);
    const urls = (this.data.tutorial.steps[i].images || []).map(im => im.path);
    this.setData({ imgPreview: { show: true, step: i, idx: j, urls } });
  },
  onPreviewChange(e) {
    const idx = e.detail.current;
    this.setData({ 'imgPreview.idx': idx });
  },
  closeImgPreview() {
    this.setData({ imgPreview: { show: false, step: -1, idx: -1, urls: [] } });
  },
  onImgRemark(e) {
    const i = Number(e.currentTarget.dataset.i), j = Number(e.currentTarget.dataset.j);
    const steps = this.data.tutorial.steps.slice();
    steps[i].images[j].remark = e.detail.value;
    this.setData({ 'tutorial.steps': steps });
  },
  toggleStepMat(e) {
    const i = Number(e.currentTarget.dataset.i), mid = e.currentTarget.dataset.mid;
    const steps = this.data.tutorial.steps.slice();
    const mats = steps[i].mats.slice();
    const k = mats.indexOf(mid);
    if (k >= 0) mats.splice(k, 1); else mats.push(mid);
    steps[i].mats = mats;
    steps[i]._matSel = this.data.tutBomMats.map(m => mats.includes(m.id));
    this.setData({ 'tutorial.steps': steps });
  },
  copyStep(e) {
    const i = Number(e.currentTarget.dataset.i);
    const src = this.data.tutorial.steps[i];
    const copy = {
      id: util.uid('st'), title: src.title, body: src.body,
      images: (src.images || []).map(im => ({ path: im.path, remark: im.remark || '' })),
      mats: (src.mats || []).slice(), pageBreak: false,
      _open: true, _matSel: src._matSel ? src._matSel.slice() : this.data.tutBomMats.map(() => false)
    };
    const steps = this.data.tutorial.steps.slice();
    steps.splice(i + 1, 0, copy);
    this.setData({ 'tutorial.steps': steps });
    util.toast('已复制工序', 'success');
  },
  collectStep(e) {
    const i = Number(e.currentTarget.dataset.i);
    const s = this.data.tutorial.steps[i];
    const added = store.addCollectedStep({ title: s.title, body: s.body });
    if (!added) util.toast('空工序无法收藏');
    else util.toast('已收藏，可在其他成品插入', 'success');
  },
  insertCollected() {
    const list = store.getCollectedSteps();
    if (!list.length) { util.toast('暂无收藏工序'); return; }
    wx.showActionSheet({
      itemList: list.map(x => (x.title || '未命名') + (x.body ? ' · ' + x.body.slice(0, 8) : '')),
      success: (res) => {
        const c = list[res.tapIndex];
        const steps = this.data.tutorial.steps.concat([this._newStep({ title: c.title, body: c.body })]);
        this.setData({ 'tutorial.steps': steps });
        util.toast('已插入收藏工序', 'success');
      }
    });
  },
  togglePageBreak(e) {
    const i = Number(e.currentTarget.dataset.i);
    const steps = this.data.tutorial.steps.slice();
    steps[i].pageBreak = !steps[i].pageBreak;
    this.setData({ 'tutorial.steps': steps });
  },
  delStep(e) {
    const i = Number(e.currentTarget.dataset.i);
    const steps = this.data.tutorial.steps.slice();
    steps.splice(i, 1);
    this.setData({ 'tutorial.steps': steps });
  },

  /* ---- 步骤拖拽排序（长按激活，touchmove 实时换位）---- */
  onStepLongPress(e) {
    const i = Number(e.currentTarget.dataset.i);
    const q = wx.createSelectorQuery().in(this);
    q.selectAll('.step-card').boundingClientRect();
    q.selectViewport().scrollOffset();
    q.exec((res) => {
      this.stepRects = (res[0] || []).map(r => ({ top: r.top, bottom: r.bottom, h: r.height }));
      this.setData({ dragStep: i });
    });
  },
  onStepDragMove(e) {
    if (this.data.dragStep < 0) return;
    const y = e.touches[0].clientY;
    const rects = this.stepRects || [];
    let target = rects.findIndex(r => y >= r.top && y <= r.bottom);
    if (target < 0) {
      if (y < rects[0].top) target = 0;
      else target = rects.length - 1;
    }
    if (target !== this.data.dragStep) {
      const steps = this.data.tutorial.steps.slice();
      const [m] = steps.splice(this.data.dragStep, 1);
      steps.splice(target, 0, m);
      this.setData({ 'tutorial.steps': steps, dragStep: target });
      // 重新测量位置
      const q = wx.createSelectorQuery().in(this);
      q.selectAll('.step-card').boundingClientRect();
      q.exec((r2) => { this.stepRects = (r2[0] || []).map(x => ({ top: x.top, bottom: x.bottom })); });
    }
  },
  onStepDragEnd() { this.setData({ dragStep: -1 }); this.stepRects = []; },

  /* ---- 图片拖拽排序（仅同一步骤内，独立于步骤拖拽）---- */
  onImgLongPress(e) {
    const i = Number(e.currentTarget.dataset.i), j = Number(e.currentTarget.dataset.j);
    const q = wx.createSelectorQuery().in(this);
    q.selectAll('.step-img-row').boundingClientRect();
    q.exec((res) => {
      this.imgRects = (res[0] || []).map(r => ({ top: r.top, bottom: r.bottom }));
      this.setData({ dragImg: { step: i, idx: j } });
    });
  },
  onImgDragMove(e) {
    const di = this.data.dragImg;
    if (di.step < 0) return;
    const y = e.touches[0].clientY;
    const rects = this.imgRects || [];
    let target = rects.findIndex(r => y >= r.top && y <= r.bottom);
    if (target < 0) target = rects.length - 1;
    if (target !== di.idx) {
      const steps = this.data.tutorial.steps.slice();
      const imgs = steps[di.step].images.slice();
      const [m] = imgs.splice(di.idx, 1);
      imgs.splice(target, 0, m);
      steps[di.step].images = imgs;
      this.setData({ 'tutorial.steps': steps, dragImg: { step: di.step, idx: target } });
      const q = wx.createSelectorQuery().in(this);
      q.selectAll('.step-img-row').boundingClientRect();
      q.exec((r2) => { this.imgRects = (r2[0] || []).map(x => ({ top: x.top, bottom: x.bottom })); });
    }
  },
  onImgDragEnd() { this.setData({ dragImg: { step: -1, idx: -1 } }); this.imgRects = []; },

  // 预览 / 导出：把当前编辑态快照存入全局，供预览/导出页读取（无需先保存）
  _tutorialSnapshot() {
    const d = this.data;
    const matNames = {};
    (d.bom || []).forEach(b => { if (b.materialId) matNames[b.materialId] = b.materialName; });
    return {
      name: d.name || '未命名成品',
      photos: d.photos || [],
      nature: d.nature,
      price: (d.dispPrice ? Number(d.dispPrice.replace(/,/g, '')) : 0),
      bom: (d.bom || []).map(b => ({ materialName: b.materialName, isFabric: b.isFabric, stockMode: b.stockMode, batchUsage: b.batchUsage, batchUnit: b.batchUnit, length: b.length, width: b.width, unit: b.unit })),
      tutorial: {
        title: d.tutorial.title || (d.name ? d.name + ' 制作教程' : ''),
        steps: (d.tutorial.steps || []).filter(s => (s.title || '').trim() || (s.body || '').trim() || (s.images || []).length || (s.mats || []).length)
          .map(s => ({
            id: s.id, title: s.title, body: s.body,
            images: (s.images || []).map(im => ({ path: im.path, remark: im.remark || '' })),
            mats: (s.mats || []).map(id => matNames[id] || '物料'),
            pageBreak: !!s.pageBreak
          }))
      }
    };
  },
  openTutorialPreview() {
    const app = getApp();
    app.globalData.tutDraft = this._tutorialSnapshot();
    util.navTo({ url: '/pages/products/tutorial-export?mode=preview' });
  },
  openTutorialExport() {
    const app = getApp();
    app.globalData.tutDraft = this._tutorialSnapshot();
    util.navTo({ url: '/pages/products/tutorial-export?mode=export' });
  },

  /* ===== 定价（单一正向计算器：售价 = 物料 + 人工 + 包装 + 运费） ===== */
  buildProduct() {
    const d = this.data;
    const materials = store.getMaterials();
    const bom = d.bom
      // 未选物料的空行不入库（UI 已隐藏其用量输入，这里再兜一道，避免脏数据留在成品上）
      .filter(b => !!b.materialId)
      .map(b => {
        const m = materials.find(x => x.id === b.materialId);
        const fabric = b.isFabric != null ? b.isFabric : (m ? store.isMaterialFabric(m) : false);
        const stockMode = (fabric && m) ? (m.stockMode || 'piece') : 'piece';
        // ⚠️ 刀口布（按批估量）不裁剪、不计面积：长宽/面积一律归零，否则脏数据回灌 →
        //    下次打开编辑页长宽被回填 → 保存时又被「请先完成裁剪」拦住（2026-09-12 真机反馈死循环）
        const isBatch = fabric && stockMode === 'batch';
        const lenCm = isBatch ? 0 : util.toCm(b.length || 0, b.lenUnit || 'cm');
        const widCm = isBatch ? 0 : util.toCm(b.width || 0, b.widUnit || 'cm');
        // V122：一个物料可以用**多块布**（每块各裁一片）—— 面积必须是**各片之和**。
        //   用户 2026-10-06：「物料清单里还是只有一片布的长宽…也只扣一片布」。
        //   片清单来自裁剪页落下的 chosenSchemes；老数据没有它就退回单矩形口径（行为不变）。
        const pieceList = (!isBatch && Array.isArray(b.chosenSchemes))
          ? b.chosenSchemes.filter(x => x && Number(x.length) > 0 && Number(x.width) > 0)
          : [];
        const sumArea = pieceList.reduce((t, x) => t + Number(x.length) * Number(x.width), 0);
        const area = (fabric && !isBatch)
          ? util.round(pieceList.length ? sumArea
            : ((lenCm > 0 && widCm > 0) ? lenCm * widCm : (Number(b.area0 || 0))), 2)
          : 0;
        const line = {
          materialId: b.materialId, materialName: b.materialName, isFabric: fabric,
          priceSnapshot: b.priceSnapshot, usage: fabric ? 0 : Number(b.usage || 0), area: area,
          length: (fabric && !isBatch) ? util.round(lenCm, 2) : 0,
          width: (fabric && !isBatch) ? util.round(widCm, 2) : 0,
          stockMode: stockMode,
          batchUsage: isBatch ? Number(b.batchUsage || 0) : 0
        };
        // V122：片清单原样带进成品记录 —— 下游（saveProduct 逐片扣 / 生产 / 回填）都靠它。
        if (pieceList.length) {
          line.chosenSchemes = pieceList.map(x => ({
            materialId: b.materialId,
            length: util.round(Number(x.length), 2),
            width: util.round(Number(x.width), 2),
            pieceId: x.pieceId,
            rotate: !!x.rotate,
            at: (x.at && x.at.x != null && x.at.y != null) ? { x: x.at.x, y: x.at.y } : null
          }));
        }
        const r = calc.bomLineCost(line, m);
        line.cost = r.cost;
        return line;
      });
    const pc = d.pcList[d.pcIndex] || {};
    const p = {
      nature: d.nature, bom,
      includeLabor: d.includeLabor, laborMode: d.laborMode,
      laborFeePerPiece: Number(d.laborFeePerPiece || 0), hourlyRate: Number(d.hourlyRate || 0), laborHours: Number(d.laborHours || 0),
      price: 0, targetProfit: pc.targetProfit || 0,
      packaging: d.nature === 'merchandise' ? (Number(d.packaging) || 0) : 0,
      shipping: d.nature === 'merchandise' ? (Number(d.shipping) || 0) : 0
    };
    const c = calc.computeProduct(p);
    p.price = c.price; // 售价正向自动算出
    return { p, c };
  },

  recompute() {
    const { p, c } = this.buildProduct();
    // V122：给每行补"片摘要" —— 一个物料用多块布时列表必须看得见（用户报
    //   「裁完之后回到成品编辑界面，物料清单里还是只有一片布的长宽」）。
    //   只在真的变了才 setData（避免每次重算都整表重渲染）。
    let bomChanged = false;
    const bom = this.data.bom.map((b) => {
      const pl = (Array.isArray(b.chosenSchemes) ? b.chosenSchemes : [])
        .filter(x => x && Number(x.length) > 0 && Number(x.width) > 0);
      const txt = pl.length > 1
        ? pl.length + ' 片 · ' + pl.map(x => util.round(x.length, 0) + '×' + util.round(x.width, 0) + 'cm').join(' + ')
        : '';
      if (b.pieceText === txt) return b;
      bomChanged = true;
      return Object.assign({}, b, { pieceText: txt });
    });
    const patch = {
      dispMaterial: util.money(c.materialCost),
      dispProfit: util.money(c.profit),
      dispPackaging: util.money(c.packaging),
      dispShipping: util.money(c.shipping),
      dispPrice: util.money(c.price),
      dispRate: c.profitRate == null ? '—' : util.percent(c.profitRate)
    };
    if (bomChanged) patch.bom = bom;
    this.setData(patch);
  },

  goCommission() { util.navTo({ url: '/pages/commission/edit?productId=' + (this.data.id || '') }); },

  save() {
    if (this._saving) return;   // 防双击：上一次保存尚未结束（重复点按会建出重复记录）
    this._saving = true;
    setTimeout(() => { this._saving = false; }, 800);
    const d = this.data;
    const name = (d.name || '').trim();
    if (!name) { util.toast('请填写成品名称'); return; }
    // 只统计「已选物料」的行：未选物料的空行不入库，不该让它凑数绕过校验
    const validBomCount = (d.bom || []).filter(b => !!b.materialId).length;
    if (!validBomCount) { util.toast('请至少添加一项物料(BOM)'); return; }
    // 按批估量（刀口布）面料必须填每件用量
    const badBatch = d.bom.find(b => b.isFabric && b.stockMode === 'batch' && !(Number(b.batchUsage) > 0));
    if (badBatch) { util.toast('请填写刀口布《' + (badBatch.materialName || '面料') + '》的每件用量'); return; }
    if (d.includeLabor && d.laborMode === 'perHour') {
      if (!(Number(d.laborHours) > 0)) { util.toast('按工时计费需填写大于 0 的耗时'); return; }
    }
    // 面料裁剪校验：本轮回填/新增或改了尺寸的面料行必须点「剪裁」选好方案；
    // 尺寸未变的旧面料行沿用上次已保存的裁剪，放行（避免编辑时被迫重剪每条）。
    // ⚠️ 刀口布（按批估量）不裁剪 —— 判定统一走 calc.pendingCutLines，不再手写 `b.isFabric`
    //    （2026-09-12 真机反馈：BOM 含刀口布时被错误要求剪裁，成品根本存不下去）
    const oldP = d.isEdit ? store.getProduct(d.id) : null;
    const oldRects = (oldP && oldP.fabricRects) || {};
    const unCut = calc.pendingCutLines(d.bom, oldRects);
    if (unCut.length) {
      wx.showModal({
        title: '请先完成裁剪',
        content: `还有 ${unCut.length} 个面料已填尺寸但还没定裁剪方案，点「去剪裁」直接排版。`,
        showCancel: false,
        confirmText: '去剪裁',
        // ⚠️ 按钮必须真的跳（V87）：原来**没有 success 回调** ⇒ 点了「去剪裁」什么都不会发生
        //    （用户看到的是"点完还让我去剪裁"，再点一下又没反应）
        success: (r) => {
          if (!r || !r.confirm) return;
          // ⚠️ 判定必须走同一个入口 calc.bomLineNeedsCut —— 别在这里手写「面料 + 有长宽」
          //    （那会把刀口布也算进来；守卫 guard-bom-batch 就是盯着这件事的）
          const i = (d.bom || []).findIndex(b =>
            !(b.chosenSchemes && b.chosenSchemes.length) && !b.chosenScheme &&
            b.length && b.width &&
            calc.bomLineNeedsCut(b) && unCut.indexOf(b.materialName || '面料') >= 0);
          if (i >= 0) this.goCutLayout({ currentTarget: { dataset: { i: i } } });
        }
      });
      return;
    }
    const { p } = this.buildProduct();
    const pc = d.pcList[d.pcIndex] || {};
    if (!pc.id) { util.toast('请选择成品品类'); return; }
    const prod = {
      id: d.id || '',
      name: name,
      categoryId: d.bcList[d.bcIndex].id,
      productCategoryId: pc.id,
      photos: d.photos || [],
      notes: d.notes || '',   // V137：出处标记（由灵感 / 想做转入）原样存回
      nature: d.nature,
      saleStatus: d.saleStatus,
      price: p.price, targetProfit: pc.targetProfit || 0,
      includeLabor: d.includeLabor, laborMode: d.laborMode,
      laborFeePerPiece: Number(d.laborFeePerPiece || 0), hourlyRate: Number(d.hourlyRate || 0), laborHours: Number(d.laborHours || 0),
      packaging: d.nature === 'merchandise' ? (Number(d.packaging) || 0) : 0,
      shipping: d.nature === 'merchandise' ? (Number(d.shipping) || 0) : 0,
      bom: p.bom,
      tutorial: {
        title: (d.tutorial.title || '').trim() || (d.name ? d.name + ' 制作教程' : ''),
        steps: (d.tutorial.steps || [])
          .filter(s => (s.title || '').trim() || (s.body || '').trim() || (s.images || []).length || (s.mats || []).length)
          .map(s => ({
            id: s.id,
            title: (s.title || '').trim(),
            body: (s.body || '').trim(),
            images: (s.images || []).map(im => ({ path: im.path, remark: (im.remark || '').trim() })),
            mats: (s.mats || []).slice(),
            pageBreak: !!s.pageBreak
          }))
      },
      sales: d.isEdit ? (store.getProduct(d.id).sales || []) : []
    };
    // 面料裁剪方案在 BOM 行「剪裁」按钮里逐个选定（chosenScheme）；
    // 填了尺寸却未剪裁的行已在上方 showModal 拦截，不会走到这里——故此处仅并入已选方案，不再弹窗。
    const rowChosen = this.collectRowChosen();
    try {
      const saved = store.saveProduct(prod, rowChosen.length ? { chosenSchemes: rowChosen } : undefined);
      // V137：**保存成功之后**才把来源标「已完成」+ 回填关联成品。
      //   用户拍板的就是这条口径：中途退出（或保存被校验拦下）⇒ 来源仍是"待填坑"，
      //   不会出现"显示已完成、却没有成品"的假状态。
      if (saved && this._source) {
        store.markSourceConverted(this._source.kind, this._source.id, saved.id);
      }
      util.toast('已保存', 'success');
      if (this._source) {
        // 从灵感 / 想做转过来：保存后直接落到成品详情（沿用改造前的落点，别让用户自己找）
        this._source = null;
        setTimeout(() => wx.redirectTo({ url: '/pages/products/detail?id=' + saved.id }), 400);
        return;
      }
      setTimeout(() => wx.navigateBack(), 400);
    } catch (err) { this._saveErr(err); }
  },

  // 收集已在行内单独排版（点「就这样裁」）的面料方案，直接并入保存，不再进通用选择器。
  // V91：一行可能是**多片**（一件成品的一个面料行用两块布）—— 展开成扁平的方案数组
  // （与 store 那边按 materialId 认的口径一致；老的单数 chosenScheme 也兼容读）。
  collectRowChosen() {
    const out = [];
    (this.data.bom || []).forEach((b) => {
      if (!b || !b.isFabric) return;
      const list = (b.chosenSchemes && b.chosenSchemes.length)
        ? b.chosenSchemes
        : (b.chosenScheme ? [b.chosenScheme] : []);
      list.forEach((s) => {
        out.push({
          materialId: s.materialId,
          length: s.length,
          width: s.width,
          pieceId: s.pieceId,
          rotate: s.rotate,
          at: s.at || null
        });
      });
    });
    return out;
  },

  _saveErr(err) {
    if (err && err.code === 'SHORT') {
      const first = err.shortages && err.shortages[0];
      util.toast('物料不足：' + (first ? (first.name + ' 缺 ' + first.lack) : err.msg));
    } else {
      util.toast(err.msg || '保存失败');
    }
  }
});
