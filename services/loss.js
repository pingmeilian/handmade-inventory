// services/loss.js —— 损耗（耗材 / 资产 / 工具）与月度/日度聚合（Day 3 任务 3.2 切片一）
// 三类损耗统一记录关键节点日期：入库① / 开始使用② / 出库③ / 报废③ / 换新③
// 耗材：status stock(库存备用) → inUse(使用中) → out(已出库)；单价=总价÷数量
// 资产：status inUse(在用) / scrapped(已报废)；维修费计入成本基数一起折旧
// 工具：status inUse(能用) / replaced(已报废)；不折旧，只换不修
//
// 依赖约定：只依赖 util / storage / keys / state（叶子模块，无反向依赖）
// utils/store.js 保留同名薄壳转发，页面层调用点零改动。

const util = require('../utils/util.js');
const storage = require('./storage.js');
const { KEYS } = require('./keys.js');
const state = require('./state.js');

const get = storage.get;
const set = storage.set;
const uid = util.uid;
// 当前手作空间（统一走状态层）
const currentSpace = state.getCurrentSpace;

/* ===================== 损耗（耗材 / 资产 / 工具） ===================== */
// 三类损耗统一记录关键节点日期：入库① / 开始使用② / 出库③ / 报废③ / 换新③
// 耗材：status stock(库存备用) → inUse(使用中) → out(已出库)；单价=总价÷数量
// 资产：status inUse(在用) / scrapped(已报废)；维修费计入成本基数一起折旧
// 工具：status inUse(能用) / replaced(已报废)；不折旧，只换不修

function getConsumables() { return get(KEYS.CONSUMABLES, []); }
// 按当前手作空间过滤（默认当前空间），供损耗计算与列表页使用
function getConsumablesOf(categoryId) { const cid = categoryId || currentSpace(); return get(KEYS.CONSUMABLES, []).filter(x => (x.categoryId || 'bc_default') === cid); }
function getConsumable(id) { return getConsumables().find(x => x.id === id); }
function consumableUnitPrice(c) {
  const q = Number(c.quantity) || 0;
  if (q <= 0) return 0;
  return util.round((Number(c.totalPrice) || 0) / q, 4);
}
function saveConsumable(c) {
  c.categoryId = c.categoryId || currentSpace();
  const list = getConsumables();
  if (!c.id) {
    c.id = uid('cs');
    c.inDate = c.inDate || util.today();
    c.status = 'stock'; c.useDate = null; c.outDate = null;
    c.createdAt = util.today();
    list.push(c);
  } else {
    const i = list.findIndex(x => x.id === c.id);
    if (i >= 0) {
      const old = list[i];
      // 编辑时保留状态相关节点日期，不被表单覆盖
      list[i] = Object.assign({}, old, c, { status: old.status, useDate: old.useDate, outDate: old.outDate });
    } else list.push(c);
  }
  const item = list.find(x => x.id === c.id) || c;
  item.updatedAt = util.today();
  set(KEYS.CONSUMABLES, list);
  return item;
}
function startUseConsumable(id) {
  const list = getConsumables(); const i = list.findIndex(x => x.id === id);
  if (i < 0) throw { code: 'NO', msg: '耗材不存在' };
  list[i].status = 'inUse'; list[i].useDate = util.today();
  set(KEYS.CONSUMABLES, list);
  return list[i];
}
function outConsumable(id) {
  const list = getConsumables(); const i = list.findIndex(x => x.id === id);
  if (i < 0) throw { code: 'NO', msg: '耗材不存在' };
  if (list[i].status === 'stock') list[i].useDate = util.today(); // 未点开始使用则补记
  list[i].status = 'out'; list[i].outDate = util.today();
  set(KEYS.CONSUMABLES, list);
  return list[i];
}
function removeConsumable(id) { set(KEYS.CONSUMABLES, getConsumables().filter(x => x.id !== id)); }
// 撤回「开始使用」：有父记录则删子回加父；整批转则自身回库存备用
function undoStartUseConsumable(id) {
  const list = getConsumables(); const i = list.findIndex(x => x.id === id);
  if (i < 0) throw { code: 'NO', msg: '耗材不存在' };
  const r = list[i];
  if (r.parentId) {
    const p = list.find(x => x.id === r.parentId);
    if (p) {
      p.quantity = util.round((Number(p.quantity) || 0) + (Number(r.quantity) || 0), 2);
      p.totalPrice = util.round((Number(p.totalPrice) || 0) + (Number(r.totalPrice) || 0), 2);
    }
    list.splice(i, 1);
  } else {
    r.status = 'stock'; r.useDate = null; r.outDate = null;
  }
  set(KEYS.CONSUMABLES, list);
  return true;
}
// 撤回「出库」：有父记录则删子回加父并恢复出库前状态；整批出库则自身回退
function undoOutConsumable(id) {
  const list = getConsumables(); const i = list.findIndex(x => x.id === id);
  if (i < 0) throw { code: 'NO', msg: '耗材不存在' };
  const r = list[i];
  if (r.parentId) {
    const p = list.find(x => x.id === r.parentId);
    if (p) {
      p.quantity = util.round((Number(p.quantity) || 0) + (Number(r.quantity) || 0), 2);
      p.totalPrice = util.round((Number(p.totalPrice) || 0) + (Number(r.totalPrice) || 0), 2);
      p.status = r.prevStatus || 'stock';
    }
    list.splice(i, 1);
  } else {
    r.status = r.prevStatus || 'stock'; r.outDate = null;
  }
  set(KEYS.CONSUMABLES, list);
  return true;
}

// 耗材「开始使用」按数量拆分：本次数量 < 库存量时，自动拆出一条「使用中」新记录，原记录留剩余量
function splitStartUseConsumable(id, qty) {
  const list = getConsumables(); const i = list.findIndex(x => x.id === id);
  if (i < 0) throw { code: 'NO', msg: '耗材不存在' };
  const item = list[i];
  if (item.status !== 'stock') return item; // 只有库存备用可拆
  const cur = Number(item.quantity) || 0;
  qty = Number(qty);
  if (!(qty > 0)) throw { code: 'BAD', msg: '数量需大于 0' };
  const useQty = Math.min(qty, cur);
  const today = util.today();
  const old = Object.assign({}, item);
  if (useQty >= cur) {
    item.status = 'inUse'; item.useDate = today;
  } else {
    const ratio = useQty / cur;
    const splitTotal = util.round((Number(old.totalPrice) || 0) * ratio, 2);
    item.quantity = util.round(cur - useQty, 2);
    item.totalPrice = util.round((Number(old.totalPrice) || 0) - splitTotal, 2);
    const newOne = Object.assign({}, old, {
      id: uid('cs'), status: 'inUse', useDate: today, outDate: null,
      quantity: util.round(useQty, 2), totalPrice: splitTotal,
      createdAt: today, updatedAt: today,
      parentId: old.id, prevStatus: 'stock' // 溯源父记录，便于撤回
    });
    list.push(newOne);
  }
  set(KEYS.CONSUMABLES, list);
  return item;
}
// 耗材「出库」按数量拆分：本次数量 < 当前量时，拆出一条「已出库」新记录，原记录留剩余量继续可用
function splitOutConsumable(id, qty) {
  const list = getConsumables(); const i = list.findIndex(x => x.id === id);
  if (i < 0) throw { code: 'NO', msg: '耗材不存在' };
  const item = list[i];
  if (item.status === 'stock') item.useDate = util.today(); // 未点开始使用则补记
  if (item.status === 'out') return item;
  const cur = Number(item.quantity) || 0;
  qty = Number(qty);
  if (!(qty > 0)) throw { code: 'BAD', msg: '数量需大于 0' };
  const outQty = Math.min(qty, cur);
  const today = util.today();
  const old = Object.assign({}, item);
  if (outQty >= cur) {
    item.prevStatus = item.status; // 记录出库前状态（stock 或 inUse），便于撤回
    item.status = 'out'; item.outDate = today;
  } else {
    const ratio = outQty / cur;
    const splitTotal = util.round((Number(old.totalPrice) || 0) * ratio, 2);
    item.quantity = util.round(cur - outQty, 2);
    item.totalPrice = util.round((Number(old.totalPrice) || 0) - splitTotal, 2);
    const newOne = Object.assign({}, old, {
      id: uid('cs'), status: 'out', useDate: old.useDate, outDate: today,
      quantity: util.round(outQty, 2), totalPrice: splitTotal,
      createdAt: today, updatedAt: today,
      parentId: old.id, prevStatus: old.status // 溯源父记录与出库前状态，便于撤回
    });
    list.push(newOne);
  }
  set(KEYS.CONSUMABLES, list);
  return item;
}

function getAssets() { return get(KEYS.ASSETS, []); }
function getAssetsOf(categoryId) { const cid = categoryId || currentSpace(); return get(KEYS.ASSETS, []).filter(x => (x.categoryId || 'bc_default') === cid); }
function getAsset(id) { return getAssets().find(x => x.id === id); }
function assetRepairTotal(a) { return util.round((a.repairs || []).reduce((s, r) => s + (Number(r.fee) || 0), 0), 2); }
function assetMonthlyDepreciation(a) {
  const life = Number(a.lifeMonths) || 0;
  if (life <= 0) return 0;
  const base = (Number(a.originalValue) || 0) + assetRepairTotal(a);
  return util.round(base / life, 2);
}
function saveAsset(a) {
  a.categoryId = a.categoryId || currentSpace();
  const list = getAssets();
  if (!a.id) {
    a.id = uid('as');
    a.inDate = a.inDate || util.today();
    a.status = 'inUse'; a.scrapDate = null; a.repairs = a.repairs || [];
    a.createdAt = util.today();
    list.push(a);
  } else {
    const i = list.findIndex(x => x.id === a.id);
    if (i >= 0) {
      const old = list[i];
      // 编辑时保留状态节点与维修记录，不被表单覆盖
      list[i] = Object.assign({}, old, a, { status: old.status, scrapDate: old.scrapDate, repairs: old.repairs });
    } else list.push(a);
  }
  const item = list.find(x => x.id === a.id) || a;
  item.updatedAt = util.today();
  set(KEYS.ASSETS, list);
  return item;
}
function addAssetRepair(id, repair) {
  const list = getAssets(); const i = list.findIndex(x => x.id === id);
  if (i < 0) throw { code: 'NO', msg: '资产不存在' };
  list[i].repairs = list[i].repairs || [];
  list[i].repairs.push({ date: repair.date || util.today(), fee: Number(repair.fee) || 0, note: repair.note || '' });
  set(KEYS.ASSETS, list);
  return list[i];
}
function updateRepair(assetId, idx, repair) {
  const list = getAssets(); const i = list.findIndex(x => x.id === assetId);
  if (i < 0) throw { code: 'NO', msg: '资产不存在' };
  const repairs = list[i].repairs || [];
  if (idx < 0 || idx >= repairs.length) throw { code: 'BAD', msg: '该维修记录不存在' };
  repairs[idx] = {
    date: repair.date || repairs[idx].date || util.today(),
    fee: Number(repair.fee) || 0,
    note: repair.note || ''
  };
  set(KEYS.ASSETS, list);
  return list[i];
}
function deleteRepair(assetId, idx) {
  const list = getAssets(); const i = list.findIndex(x => x.id === assetId);
  if (i < 0) throw { code: 'NO', msg: '资产不存在' };
  const repairs = list[i].repairs || [];
  if (idx < 0 || idx >= repairs.length) throw { code: 'BAD', msg: '该维修记录不存在' };
  repairs.splice(idx, 1);
  set(KEYS.ASSETS, list);
  return list[i];
}
function scrapAsset(id) {
  const list = getAssets(); const i = list.findIndex(x => x.id === id);
  if (i < 0) throw { code: 'NO', msg: '资产不存在' };
  list[i].status = 'scrapped'; list[i].scrapDate = util.today();
  set(KEYS.ASSETS, list);
  return list[i];
}
function unscrapAsset(id) {
  const list = getAssets(); const i = list.findIndex(x => x.id === id);
  if (i < 0) throw { code: 'NO', msg: '资产不存在' };
  list[i].status = 'inUse'; list[i].scrapDate = null;
  set(KEYS.ASSETS, list);
  return list[i];
}
function removeAsset(id) { set(KEYS.ASSETS, getAssets().filter(x => x.id !== id)); }

function getTools() { return get(KEYS.TOOLS, []); }
function getToolsOf(categoryId) { const cid = categoryId || currentSpace(); return get(KEYS.TOOLS, []).filter(x => (x.categoryId || 'bc_default') === cid); }
function getTool(id) { return getTools().find(x => x.id === id); }
function saveTool(t) {
  t.categoryId = t.categoryId || currentSpace();
  const list = getTools();
  if (!t.id) {
    t.id = uid('tl');
    t.inDate = t.inDate || util.today();
    t.status = 'inUse'; t.replaceDate = null;
    t.createdAt = util.today();
    list.push(t);
  } else {
    const i = list.findIndex(x => x.id === t.id);
    if (i >= 0) {
      const old = list[i];
      list[i] = Object.assign({}, old, t, { status: old.status, replaceDate: old.replaceDate });
    } else list.push(t);
  }
  const item = list.find(x => x.id === t.id) || t;
  item.updatedAt = util.today();
  set(KEYS.TOOLS, list);
  return item;
}
function replaceTool(id) {
  const list = getTools(); const i = list.findIndex(x => x.id === id);
  if (i < 0) throw { code: 'NO', msg: '工具不存在' };
  list[i].status = 'replaced'; list[i].replaceDate = util.today();
  set(KEYS.TOOLS, list);
  return list[i];
}
// 工具「换新」：旧工具标记已报废，并生成一条新工具记录，新买价即新成本（不再凭空消失）
function replaceToolWith(id, payload) {
  const list = getTools(); const i = list.findIndex(x => x.id === id);
  if (i < 0) throw { code: 'NO', msg: '工具不存在' };
  const old = list[i];
  old.status = 'replaced'; old.replaceDate = payload.inDate || util.today();
  const newOne = {
    id: uid('tl'),
    name: payload.name && String(payload.name).trim() ? String(payload.name).trim() : old.name,
    price: util.round(Number(payload.price) || 0, 2),
    inDate: payload.inDate || util.today(),
    status: 'inUse', replaceDate: null,
    createdAt: util.today(), updatedAt: util.today()
  };
  old.replacedBy = newOne.id; // 记录新工具，便于撤销换新
  list.push(newOne);
  set(KEYS.TOOLS, list);
  return { old, newTool: newOne };
}
// 撤销工具「换新」：删除新工具记录，旧件恢复为能用（冲销当月工具支出）
function undoReplaceTool(oldId, newId) {
  const list = getTools();
  const ni = list.findIndex(x => x.id === newId);
  const oi = list.findIndex(x => x.id === oldId);
  if (ni >= 0) list.splice(ni, 1);
  if (oi >= 0) { list[oi].status = 'inUse'; list[oi].replaceDate = null; list[oi].replacedBy = null; }
  set(KEYS.TOOLS, list);
  return true;
}
function removeTool(id) { set(KEYS.TOOLS, getTools().filter(x => x.id !== id)); }

/* ===================== 其它支出（2026-10-10 V131） =====================
   为什么单开一类：累计总账要答「我一共投进去多少钱」，而有些开销既不是物料
   （没有库存、不入库出库），也不是机器/工具/耗材（不走折旧或摊销）——
   快递费、摊位费、电费、包装袋… 它们**只有"花了多少"这一个事实**。
   ⇒ 结构刻意做到最简：名称 + 金额 + 日期 + 备注。没有状态流转、没有摊销。
   ⚠️ 注意与「耗材」的区别：耗材有数量与单价、要按月分摊；其它支出**当期全额**计入。 */
function getOtherExpenses() { return get(KEYS.OTHER_EXPENSES, []); }
function getOtherExpensesOf(categoryId) {
  const cid = categoryId || currentSpace();
  return get(KEYS.OTHER_EXPENSES, []).filter(x => (x.categoryId || 'bc_default') === cid);
}
function getOtherExpense(id) { return getOtherExpenses().find(x => x.id === id); }
function saveOtherExpense(o) {
  o.categoryId = o.categoryId || currentSpace();
  const list = getOtherExpenses();
  if (!o.id) {
    o.id = uid('ox');
    o.date = o.date || util.today();
    o.createdAt = util.today();
    list.push(o);
  } else {
    const i = list.findIndex(x => x.id === o.id);
    if (i >= 0) list[i] = Object.assign({}, list[i], o);
    else list.push(o);
  }
  const item = list.find(x => x.id === o.id) || o;
  item.updatedAt = util.today();
  set(KEYS.OTHER_EXPENSES, list);
  return item;
}
function removeOtherExpense(id) { set(KEYS.OTHER_EXPENSES, getOtherExpenses().filter(x => x.id !== id)); }
// 区间内的其它支出合计（date 落在 [start,end] 的闭区间）
function otherExpenseIn(start, end) {
  return util.round(getOtherExpensesOf().reduce((s, o) => {
    if (!o.date) return s;
    if (start && o.date < start) return s;
    if (end && o.date > end) return s;
    return s + (Number(o.amount) || 0);
  }, 0), 2);
}

/* ===================== 损耗月度聚合（Step2 核心，供看板 / 成品分摊参考） ===================== */
// 月份边界：返回该月首日(start)与末日(end)，格式 YYYY-MM-DD
function monthRange(year, month) {
  const m = Number(month);
  const days = new Date(Number(year), m, 0).getDate();
  const mm = ('0' + m).slice(-2);
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${('0' + days).slice(-2)}` };
}
// 日期字符串 -> 月份序号（年*12 + 月-1），便于区间比较
function monthIndex(dateStr) {
  if (!dateStr) return null;
  const parts = String(dateStr).split('-');
  if (parts.length < 2) return null;
  return Number(parts[0]) * 12 + (Number(parts[1]) - 1);
}
// 耗材摊销：仅统计已出库(有 useDate+outDate)的耗材，按其使用区间落在当月内的天数比例分摊（方案A 递延+回溯）
// ⚠️ V136：`categoryId` 可选（不传 = 当前手作空间，与改动前完全一致）。
//    加它的原因：累计总账要按**指定的**空间算，不能偷偷依赖"当前空间"这个全局状态。
function consumableAmortForMonth(year, month, categoryId) {
  const { start, end } = monthRange(year, month);
  let sum = 0;
  getConsumablesOf(categoryId).forEach(c => {
    if (c.status !== 'out' || !c.useDate || !c.outDate) return;
    const totalDays = util.diffDays(c.useDate, c.outDate) + 1;
    if (totalDays <= 0) return;
    const daily = (Number(c.totalPrice) || 0) / totalDays;
    const segStart = c.useDate < start ? start : c.useDate;
    const segEnd = c.outDate > end ? end : c.outDate;
    if (segStart <= segEnd) {
      const d = util.diffDays(segStart, segEnd) + 1;
      sum += daily * d;
    }
  });
  return util.round(sum, 2);
}
// 资产折旧：入库次月起逐月计提，直到报废月（报废月计入）；月折旧=(原值+维修合计)/寿命月
// ⚠️ V136：`categoryId` 可选（不传 = 当前手作空间），理由同 consumableAmortForMonth。
function assetDepreciationForMonth(year, month, categoryId) {
  const mIdx = Number(year) * 12 + (Number(month) - 1);
  let sum = 0;
  getAssetsOf(categoryId).forEach(a => {
    const inIdx = monthIndex(a.inDate);
    if (inIdx == null || mIdx <= inIdx) return; // 入库当月不提
    if (a.status === 'scrapped' && a.scrapDate) {
      const sIdx = monthIndex(a.scrapDate);
      if (sIdx != null && mIdx > sIdx) return; // 报废后不提
    }
    sum += assetMonthlyDepreciation(a);
  });
  return util.round(sum, 2);
}
// 工具支出：工具在当月购入(inDate 落在当月)即确认成本（含换新生成的新工具）
// ⚠️ V136：`categoryId` 可选（不传 = 当前手作空间），理由同 consumableAmortForMonth。
function toolExpenseForMonth(year, month, categoryId) {
  const { start, end } = monthRange(year, month);
  let sum = 0;
  getToolsOf(categoryId).forEach(t => {
    if (t.inDate && t.inDate >= start && t.inDate <= end) sum += Number(t.price) || 0;
  });
  return util.round(sum, 2);
}
// 对外：指定年月的损耗成本汇总
function getMonthlyLossCost(year, month) {
  const consumableAmort = consumableAmortForMonth(year, month);
  const depreciation = assetDepreciationForMonth(year, month);
  const toolExpense = toolExpenseForMonth(year, month);
  return {
    consumableAmort, depreciation, toolExpense,
    total: util.round(consumableAmort + depreciation + toolExpense, 2)
  };
}
// 本月成品生产件数（来自 produceProduct 日志）

// 单日损耗成本：供看板趋势曲线按天展开（与月聚合口径一致，日累加即等于月末封装值）
function getDailyLossCost(dateStr) {
  let consumableAmort = 0, depreciation = 0, toolExpense = 0;
  // 耗材：当天落在 [useDate, outDate] 区间内的天数摊销
  getConsumablesOf().forEach(c => {
    if (c.status !== 'out' || !c.useDate || !c.outDate) return;
    if (dateStr < c.useDate || dateStr > c.outDate) return;
    const totalDays = util.diffDays(c.useDate, c.outDate) + 1;
    if (totalDays <= 0) return;
    consumableAmort += (Number(c.totalPrice) || 0) / totalDays;
  });
  // 资产：当天处于 active（入库次月起、报废月前/当月）按当月天数均摊日折旧
  getAssetsOf().forEach(a => {
    if (!a.inDate) return;
    const inIdx = monthIndex(a.inDate), dIdx = monthIndex(dateStr);
    if (inIdx == null || dIdx == null) return;
    if (dIdx <= inIdx) return; // 入库当月不提
    if (a.status === 'scrapped' && a.scrapDate) {
      const sIdx = monthIndex(a.scrapDate);
      if (sIdx != null && dIdx > sIdx) return;
    }
    const daysInMonth = new Date(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)), 0).getDate();
    depreciation += assetMonthlyDepreciation(a) / daysInMonth;
  });
  // 工具：当天购入即确认成本
  getToolsOf().forEach(t => {
    if (t.inDate === dateStr) toolExpense += Number(t.price) || 0;
  });
  return {
    consumableAmort: util.round(consumableAmort, 2),
    depreciation: util.round(depreciation, 2),
    toolExpense: util.round(toolExpense, 2),
    total: util.round(consumableAmort + depreciation + toolExpense, 2)
  };
}
// 指定日期区间的损耗成本按日序列（用于趋势曲线）
function getLossCostSeries(startDate, endDate) {
  const out = [];
  let d = startDate, guard = 0;
  while (d <= endDate && guard < 1000) {
    out.push({ date: d, value: getDailyLossCost(d).total });
    d = util.addDays(d, 1);
    guard++;
  }
  return out;
}


module.exports = {
  getConsumables, getConsumablesOf, getConsumable, consumableUnitPrice, saveConsumable,
  startUseConsumable, outConsumable, splitStartUseConsumable, splitOutConsumable,
  undoStartUseConsumable, undoOutConsumable, removeConsumable,
  getAssets, getAssetsOf, getAsset, assetRepairTotal, assetMonthlyDepreciation, saveAsset,
  addAssetRepair, updateRepair, deleteRepair, scrapAsset, unscrapAsset, removeAsset,
  getTools, getToolsOf, getTool, saveTool, replaceTool, replaceToolWith, undoReplaceTool, removeTool,
  getOtherExpenses, getOtherExpensesOf, getOtherExpense, saveOtherExpense, removeOtherExpense, otherExpenseIn,
  monthRange, monthIndex, consumableAmortForMonth, assetDepreciationForMonth, toolExpenseForMonth,
  getMonthlyLossCost, getDailyLossCost, getLossCostSeries
};
