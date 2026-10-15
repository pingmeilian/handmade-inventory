// pages/settings/listEditor.js —— 通用列表配置编辑（M1-05 / M1-07 / M1-15）
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');

const CONFIG = {
  // ⚠️ 命名说明（2026-09-27）：界面叫「物料分类」，但代码键仍是 materialCategory /
  //    MATERIAL_CATEGORIES —— 键名牵动已存数据与迁移，改键风险远大于收益，
  //    故只改**面向用户的名字**。搜代码找不到「物料分类」时，看这里。
  //    改名原因：原名「物料大类」与「手作空间」同形，用户反馈容易混。
  materialCategory: { label: '物料分类', hasUnit: true, hasAttrs: true, hasFabricWidth: true },
  productCategory: { label: '品类', hasPack: true, hasHourly: true },
  // ⚠️ 下面两个 type 目前**全项目没有任何入口**（2026-09-27 核查确认）：
  //    属性实际是在编辑「物料分类」时改的（materialCategory 的 hasAttrs）。
  //    保留为预留能力，去留待定 —— 删之前请先确认没有别处依赖。
  materialAttr: { label: '物料自定义属性' },
  productAttr: { label: '成品自定义属性' },
  // 这两个 label 与「预设设置」页的入口文案保持一致（2026-09-27 统一改名）
  unit: { label: '计量单位' },
  platform: { label: '排单平台' }
};

function isFabricCategory(x) {
  return !!(x && x.isFabric);
}

// 根据属性维度名返回更贴切的预设值 placeholder（避免出现「示例」）
function optionPlaceholder(dimensionName) {
  const n = (dimensionName || '').trim();
  if (n.indexOf('颜色') >= 0) return '如 红色、蓝色';
  if (n.indexOf('材质') >= 0) return '如 纯棉、亚麻';
  if (n.indexOf('花纹') >= 0) return '如 条纹、波点';
  return '输入预设值';
}

// 将用户输入拆成多个预设值：支持中文顿号「、」、逗号「，」「,」及空白分隔，去空去重
function splitPresetValues(raw) {
  return (raw || '')
    .split(/[、，,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

const ATTR_NAME_PLACEHOLDER = '如 颜色、材质、花纹';

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  onShow() { themePage.apply(this); },   // 主题（V97）

  data: {
    type: '', label: '',
    hasUnit: false, hasAttrs: false, hasPack: false, hasFabricWidth: false, hasHourly: false,
    list: [],
    showSheet: false, editItem: null,
    showPrompt: false, promptTitle: '', promptValue: '', promptPlaceholder: '',
    promptMode: '', promptIndexI: -1, promptIndexJ: -1
  },

  onLoad(options) {
    const type = options.type || 'unit';
    const cfg = CONFIG[type] || CONFIG.unit;
    this.setData({ type, label: cfg.label, hasUnit: !!cfg.hasUnit, hasAttrs: !!cfg.hasAttrs, hasPack: !!cfg.hasPack, hasFabricWidth: !!cfg.hasFabricWidth, hasHourly: !!cfg.hasHourly });
    // 标题栏跟随 type（2026-09-27）：json 里写死的「配置编辑」太模糊，
    // 用户从「预设设置」点进来后不知道自己在编辑哪一类。项目里 loss/edit 也是这么做的。
    wx.setNavigationBarTitle({ title: cfg.label });
    this.reload();
  },

  reload() {
    const list = store.getList(this.data.type).map(x => {
      let sub = '';
      if (this.data.hasUnit) sub = '单位：' + (x.defaultUnit || '—');
      if (this.data.hasPack) sub = '包¥' + (x.packaging || 0) + ' 运¥' + (x.shipping || 0) + ' 目标' + Math.round((x.targetProfit || 0) * 100) + '%';
      if (this.data.hasHourly && (x.hourlyWage != null)) sub += (sub ? ' · ' : '') + '时薪¥' + x.hourlyWage;
      if (this.data.hasAttrs) {
        const dims = (x.attrDimensions || []).map(d => (d && typeof d === 'object') ? d.name : d);
        sub = '属性：' + (dims.join('、') || '无');
      }
      if (this.data.hasFabricWidth && isFabricCategory(x)) sub += (sub ? ' · ' : '') + '幅宽' + (x.defaultFabricWidth == null ? '—' : util.fromCm(x.defaultFabricWidth, 'm')) + 'm';
      return { id: x.id, name: x.name, sub: sub };
    });
    this.setData({ list });
  },

  blankItem() {
    return { id: '', name: '', isFabric: false, defaultUnit: '', attrDimensions: [], packaging: '', shipping: '', targetProfit: '', defaultFabricWidth: '', hourlyWage: '' };
  },

  openAdd() { this.setData({ showSheet: true, editItem: this.blankItem() }); },
  openEdit(e) {
    const id = e.currentTarget.dataset.id;
    const x = store.getList(this.data.type).find(v => v.id === id);
    if (!x) return;
    this.setData({
      showSheet: true,
      editItem: {
        id: x.id, name: x.name, isFabric: !!x.isFabric,
        defaultUnit: x.defaultUnit || '',
        // 属性：{name, options[]} 对象数组，兼容旧字符串数组格式
        attrDimensions: (x.attrDimensions || []).map(d => {
          if (typeof d === 'string') return { name: d, options: [] };
          return { name: d.name || '', options: (d.options || []).slice() };
        }),
        packaging: x.packaging == null ? '' : String(x.packaging),
        shipping: x.shipping == null ? '' : String(x.shipping),
        targetProfit: x.targetProfit == null ? '' : String(Math.round(x.targetProfit * 100)),
        defaultFabricWidth: x.defaultFabricWidth == null ? '' : String(util.fromCm(x.defaultFabricWidth, 'm')),
        hourlyWage: x.hourlyWage == null ? '' : String(x.hourlyWage)
      }
    });
  },
  closeSheet() { this.setData({ showSheet: false }); },
  noop() {},

  // ===== 通用 prompt 弹窗（替代原生 wx.showModal editable） =====
  openPrompt({ title, value = '', placeholder = '', mode, i = -1, j = -1 }) {
    this.setData({ showPrompt: true, promptTitle: title, promptValue: value, promptPlaceholder: placeholder, promptMode: mode, promptIndexI: i, promptIndexJ: j });
  },
  closePrompt() { this.setData({ showPrompt: false }); },
  onPromptInput(e) { this.setData({ promptValue: e.detail.value }); },
  confirmPrompt() {
    const v = (this.data.promptValue || '').trim();
    const mode = this.data.promptMode;
    const i = this.data.promptIndexI;
    const j = this.data.promptIndexJ;
    this.closePrompt();
    if (!v) return;
    const dims = this.data.editItem.attrDimensions.slice();
    if (mode === 'addAttr') {
      dims.push({ name: v, options: [] });
      this.setData({ ['editItem.attrDimensions']: dims });
    } else if (mode === 'modifyAttrName') {
      dims[i].name = v;
      this.setData({ ['editItem.attrDimensions']: dims });
    } else if (mode === 'addOption') {
      // 支持一次性输入多个预设值，用「、」连接，输完自动拆分去重
      const vals = splitPresetValues(v);
      if (vals.length) {
        const exist = dims[i].options || [];
        const merged = exist.slice();
        vals.forEach(val => { if (merged.indexOf(val) < 0) merged.push(val); });
        dims[i].options = merged;
        this.setData({ ['editItem.attrDimensions']: dims });
      }
    } else if (mode === 'modifyOption') {
      dims[i].options[j] = v;
      this.setData({ ['editItem.attrDimensions']: dims });
    }
  },

  onName(e) { this.setData({ ['editItem.name']: e.detail.value }); },
  onFabricSwitch() { this.setData({ ['editItem.isFabric']: !this.data.editItem.isFabric }); },
  onUnit(e) { this.setData({ ['editItem.defaultUnit']: e.detail.value }); },

  // ===== 属性（一级）管理：点 ⋯ 弹菜单 =====
  openAttrMenu(e) {
    const i = e.currentTarget.dataset.i;
    const dims = this.data.editItem.attrDimensions;
    if (!dims[i]) return;
    const max = dims.length - 1;
    const items = ['修改名称'];
    if (i > 0) items.push('上移');
    if (i < max) items.push('下移');
    items.push('删除');
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const sel = items[res.tapIndex];
        if (sel === '修改名称') this.modifyAttrName(i);
        else if (sel === '上移') this.moveAttr(i, -1);
        else if (sel === '下移') this.moveAttr(i, 1);
        else if (sel === '删除') this.removeAttr(i);
      }
    });
  },
  modifyAttrName(i) {
    const cur = (this.data.editItem.attrDimensions[i] || {}).name || '';
    this.openPrompt({ title: '修改属性名', value: cur, placeholder: ATTR_NAME_PLACEHOLDER, mode: 'modifyAttrName', i });
  },
  moveAttr(i, dir) {
    const dims = this.data.editItem.attrDimensions.slice();
    const j = i + dir;
    if (j < 0 || j >= dims.length) return;
    const t = dims[i]; dims[i] = dims[j]; dims[j] = t;
    this.setData({ ['editItem.attrDimensions']: dims });
  },
  async removeAttr(i) {
    const name = (this.data.editItem.attrDimensions[i] || {}).name || '未命名';
    const ok = await util.confirm('删除属性', '确认删除「' + name + '」及其所有预设值？', '删除');
    if (!ok) return;
    const dims = this.data.editItem.attrDimensions.slice();
    dims.splice(i, 1);
    this.setData({ ['editItem.attrDimensions']: dims });
  },
  addAttr() {
    this.openPrompt({ title: '添加属性', placeholder: ATTR_NAME_PLACEHOLDER, mode: 'addAttr' });
  },

  // ===== 预设值（二级）管理：点 chip 弹菜单 =====
  openOptionMenu(e) {
    const i = e.currentTarget.dataset.i;
    const j = e.currentTarget.dataset.j;
    const opts = this.data.editItem.attrDimensions[i].options;
    const max = opts.length - 1;
    const items = ['修改'];
    if (j > 0) items.push('上移');
    if (j < max) items.push('下移');
    items.push('删除');
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const sel = items[res.tapIndex];
        if (sel === '修改') this.modifyOption(i, j);
        else if (sel === '上移') this.moveOption(i, j, -1);
        else if (sel === '下移') this.moveOption(i, j, 1);
        else if (sel === '删除') this.removeOption(i, j);
      }
    });
  },
  modifyOption(i, j) {
    const cur = this.data.editItem.attrDimensions[i].options[j] || '';
    const dimName = this.data.editItem.attrDimensions[i].name;
    this.openPrompt({ title: '修改预设值', value: cur, placeholder: optionPlaceholder(dimName), mode: 'modifyOption', i, j });
  },
  moveOption(i, j, dir) {
    const dims = this.data.editItem.attrDimensions.slice();
    const opts = dims[i].options.slice();
    const k = j + dir;
    if (k < 0 || k >= opts.length) return;
    const t = opts[j]; opts[j] = opts[k]; opts[k] = t;
    dims[i].options = opts;
    this.setData({ ['editItem.attrDimensions']: dims });
  },
  async removeOption(i, j) {
    const v = this.data.editItem.attrDimensions[i].options[j] || '';
    const ok = await util.confirm('删除预设值', '确认删除「' + v + '」？', '删除');
    if (!ok) return;
    const dims = this.data.editItem.attrDimensions.slice();
    dims[i].options.splice(j, 1);
    this.setData({ ['editItem.attrDimensions']: dims });
  },
  addOption(e) {
    const i = e.currentTarget.dataset.i;
    this.openPrompt({ title: '添加预设值', placeholder: '可输入多个预设值，用、连接', mode: 'addOption', i });
  },

  onPack(e) { this.setData({ ['editItem.packaging']: e.detail.value }); },
  onShip(e) { this.setData({ ['editItem.shipping']: e.detail.value }); },
  onTarget(e) { this.setData({ ['editItem.targetProfit']: e.detail.value }); },
  onFabricWidth(e) { this.setData({ ['editItem.defaultFabricWidth']: e.detail.value }); },
  onHourlyWage(e) { this.setData({ ['editItem.hourlyWage']: e.detail.value }); },

  saveSheet() {
    if (this._saving) return;   // 防双击：上一次保存尚未结束（重复点按会建出重复记录）
    this._saving = true;
    setTimeout(() => { this._saving = false; }, 800);
    const it = this.data.editItem;
    const name = (it.name || '').trim();
    if (!name) { util.toast('请填写名称'); return; }
    const item = { id: it.id, name };
    if (this.data.hasUnit) item.defaultUnit = it.defaultUnit || '个';
    if (this.data.hasAttrs) {
      item.attrDimensions = (it.attrDimensions || [])
        .filter(d => (d.name || '').trim())
        .map(d => ({ name: d.name.trim(), options: (d.options || []).map(s => s.trim()).filter(Boolean) }));
    }
    if (this.data.hasPack) {
      item.packaging = Number(it.packaging || 0);
      item.shipping = Number(it.shipping || 0);
      item.targetProfit = (Number(it.targetProfit || 0)) / 100;
    }
    if (this.data.hasFabricWidth) {
      item.isFabric = !!it.isFabric;
      if (item.isFabric) {
        const fw = Number(it.defaultFabricWidth || 0);
        item.defaultFabricWidth = fw > 0 ? util.toCm(fw, 'm') : null;
      } else {
        item.defaultFabricWidth = null;
      }
    }
    if (this.data.hasHourly) {
      const hw = Number(it.hourlyWage || 0);
      item.hourlyWage = hw > 0 ? hw : null;
    }
    store.saveListItem(this.data.type, item);
    util.toast('已保存', 'success');
    this.setData({ showSheet: false });
    this.reload();
  },

  async remove(e) {
    const id = e.currentTarget.dataset.id;
    const type = this.data.type;
    let warn = '确认删除该项？';
    // M-4 / M1-14：删除被引用的品类时，先将其引用对象归入「未分类」，避免孤儿引用
    if (type === 'productCategory') {
      const refs = store.getProducts().filter(p => p.productCategoryId === id).length;
      if (refs > 0) warn = '该项已被 ' + refs + ' 个成品引用，删除后这些成品将归入「其他（未分类）」，确认删除？';
    } else if (type === 'materialCategory') {
      const refs = store.getMaterials().filter(m => m.materialCategoryId === id).length;
      if (refs > 0) warn = '该项已被 ' + refs + ' 个物料引用，删除后这些物料将归入「其他（未分类）」，确认删除？';
    }
    const ok = await util.confirm('删除', warn, '删除');
    if (!ok) return;
    try {
      if (type === 'productCategory') store.reassignProductCategoryRefs(id);
      else if (type === 'materialCategory') store.reassignMaterialCategoryRefs(id);
      store.removeListItem(type, id);
    } catch (err) {
      // 破坏性操作失败必须告知"没删成"，不能静默无反应
      util.toast(err && err.msg ? err.msg : '删除失败，请重试');
    }
    this.reload();
  }
});
