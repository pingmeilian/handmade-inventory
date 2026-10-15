// pages/loss/edit.js —— 损耗录入/编辑（按 type 适配耗材/资产/工具/维修/其它支出）
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');

const TITLES = {
  consumable: { add: '添加耗材', edit: '编辑耗材' },
  asset: { add: '添加资产', edit: '编辑资产' },
  tool: { add: '添加工具', edit: '编辑工具' },
  // 2026-10-10 V131：其它支出（快递费/摊位费/电费…）—— 既不是物料也不是机器/工具/耗材
  other: { add: '添加其它支出', edit: '编辑其它支出' },
  assetRepair: { add: '记录维修', edit: '记录维修' },
  assetRepairEdit: { add: '编辑维修', edit: '编辑维修' }
};

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  onShow() { themePage.apply(this); },   // 主题（V97）

  data: {
    type: 'consumable', id: '', isEdit: false, assetName: '', assetId: '', repairIdx: '',
    // 耗材
    name: '', spec: '', quantity: '', totalPrice: '', unitPriceHint: '',
    // 资产
    originalValue: '', lifeMonths: '', depreHint: '',
    // 工具
    price: '',
    // 其它支出（V131）：只有金额与备注 —— 没有数量、没有状态、不摊销
    amount: '', note: '',
    // 维修
    repairDate: '', repairFee: '', repairNote: '',
    // 通用日期
    inDate: '',
    // 主题日期选择器（替代原生 mode="date"）
    dpIn: false, dpRepair: false
  },

  onLoad(options) {
    const type = options.type || 'consumable';
    const today = util.today();
    this.setData({ type, inDate: today, repairDate: today });
    if (type === 'assetRepairEdit') {
      this.setData({ assetId: options.assetId, repairIdx: options.idx });
      this.loadRepair(options.assetId, options.idx);
    } else if (options.id) {
      this.load(options.id, type);
    }
    const t = TITLES[type] || TITLES.consumable;
    wx.setNavigationBarTitle({ title: t.edit || t.add });
  },
  loadRepair(assetId, idx) {
    const a = store.getAsset(assetId);
    if (!a) return util.toast('资产不存在');
    const r = (a.repairs || [])[Number(idx)];
    if (!r) return util.toast('维修记录不存在');
    this.setData({ assetName: a.name, repairDate: r.date, repairFee: String(r.fee), repairNote: r.note || '' });
  },

  load(id, type) {
    if (type === 'assetRepair') {
      const a = store.getAsset(id);
      if (a) this.setData({ id, assetName: a.name });
      return;
    }
    this.setData({ id, isEdit: true });
    if (type === 'consumable') {
      const c = store.getConsumable(id);
      if (!c) return util.toast('耗材不存在');
      this.setData({ name: c.name, spec: c.spec || '', quantity: String(c.quantity), totalPrice: String(c.totalPrice), inDate: c.inDate || util.today() });
      this.recalcUnit();
    } else if (type === 'asset') {
      const a = store.getAsset(id);
      if (!a) return util.toast('资产不存在');
      this.setData({ name: a.name, originalValue: String(a.originalValue), lifeMonths: String(a.lifeMonths), inDate: a.inDate || util.today() });
      this.recalcDepre();
    } else if (type === 'tool') {
      const t = store.getTool(id);
      if (!t) return util.toast('工具不存在');
      this.setData({ name: t.name, price: String(t.price), inDate: t.inDate || util.today() });
    } else if (type === 'other') {
      const o = store.getOtherExpense(id);
      if (!o) return util.toast('记录不存在');
      this.setData({ name: o.name, amount: String(o.amount), note: o.note || '', inDate: o.date || util.today() });
    }
  },

  // 输入
  onName(e) { this.setData({ name: e.detail.value }); },
  onSpec(e) { this.setData({ spec: e.detail.value }); },
  onQuantity(e) { this.setData({ quantity: e.detail.value }); this.recalcUnit(); },
  onTotalPrice(e) { this.setData({ totalPrice: e.detail.value }); this.recalcUnit(); },
  onOriginalValue(e) { this.setData({ originalValue: e.detail.value }); this.recalcDepre(); },
  onLifeMonths(e) { this.setData({ lifeMonths: e.detail.value }); this.recalcDepre(); },
  onPrice(e) { this.setData({ price: e.detail.value }); },
  onAmount(e) { this.setData({ amount: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },
  onInDate(e) { this.setData({ inDate: e.detail.value }); },
  onRepairDate(e) { this.setData({ repairDate: e.detail.value }); },
  // 主题日期选择器开关（替代原生 picker mode="date"）
  openInDate() { this.setData({ dpIn: true }); },
  openRepairDate() { this.setData({ dpRepair: true }); },
  closeDate() { this.setData({ dpIn: false, dpRepair: false }); },
  onRepairFee(e) { this.setData({ repairFee: e.detail.value }); },
  onRepairNote(e) { this.setData({ repairNote: e.detail.value }); },

  recalcUnit() {
    const q = Number(this.data.quantity), t = Number(this.data.totalPrice);
    if (q > 0 && t > 0) this.setData({ unitPriceHint: util.money(util.round(t / q, 4)) });
    else this.setData({ unitPriceHint: '' });
  },
  recalcDepre() {
    const v = Number(this.data.originalValue), life = Number(this.data.lifeMonths);
    if (v > 0 && life > 0) this.setData({ depreHint: util.money(util.round(v / life, 2)) });
    else this.setData({ depreHint: '' });
  },

  save() {
    if (this._saving) return;   // 防双击：上一次保存尚未结束（重复点按会建出重复记录）
    this._saving = true;
    setTimeout(() => { this._saving = false; }, 800);
    const d = this.data;
    if (d.type === 'assetRepair' || d.type === 'assetRepairEdit') {
      const fee = Number(d.repairFee);
      if (!(fee > 0)) { util.toast('请填写维修费'); return; }
      if (d.type === 'assetRepairEdit') {
        store.updateRepair(d.assetId, Number(d.repairIdx), { date: d.repairDate, fee, note: d.repairNote });
        util.toast('已更新维修', 'success');
      } else {
        store.addAssetRepair(d.id, { date: d.repairDate, fee, note: d.repairNote });
        util.toast('已记录维修', 'success');
      }
      setTimeout(() => wx.navigateBack(), 400);
      return;
    }

    const name = d.name.trim();
    if (!name) { util.toast('请填写名称'); return; }

    if (d.type === 'consumable') {
      const q = Number(d.quantity), t = Number(d.totalPrice);
      if (!(q > 0)) { util.toast('请填写数量'); return; }
      if (!(t > 0)) { util.toast('请填写总价'); return; }
      store.saveConsumable({
        id: d.id, name, spec: d.spec, quantity: util.round(q, 2), totalPrice: util.round(t, 2),
        inDate: d.inDate
      });
    } else if (d.type === 'asset') {
      const v = Number(d.originalValue), life = Number(d.lifeMonths);
      if (!(v > 0)) { util.toast('请填写原值'); return; }
      if (!(life > 0)) { util.toast('请填写预计寿命(月)'); return; }
      store.saveAsset({
        id: d.id, name, originalValue: util.round(v, 2), lifeMonths: Math.round(life),
        inDate: d.inDate
      });
    } else if (d.type === 'tool') {
      const p = Number(d.price);
      if (!(p > 0)) { util.toast('请填写买价'); return; }
      store.saveTool({ id: d.id, name, price: util.round(p, 2), inDate: d.inDate });
    } else if (d.type === 'other') {
      // 其它支出：只要金额；名称也必填（否则累计总账里那行会没有出处）
      const amt = Number(d.amount);
      if (!(amt > 0)) { util.toast('请填写金额'); return; }
      store.saveOtherExpense({
        id: d.id, name, amount: util.round(amt, 2), note: d.note || '', date: d.inDate
      });
    }
    util.toast('已保存', 'success');
    setTimeout(() => wx.navigateBack(), 400);
  }
});
