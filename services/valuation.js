// services/valuation.js —— 库存总值的「派生」与「对账」
//
// 背景（本项目最重要的架构决策）：
//   原先 totalValue（物料库存总值）是一个被**手工维护在 26 处**的字段。任何一条路径
//   忘了同步它，库存总值就会静默漂移，进而让 unitCost（均价）失真，最终所有成本与
//   利润全错 —— 而且没有任何机制会提醒。
//
// 已验证的事实（勘查阶段确认）：
//   totalValue 的 26 处改动  与  addFlow 的 26 次调用  完全 1:1 对应
//   → 所以 totalValue ≡ Σ(该物料流水，入库为正、出库为负)
//
// 本模块的设计原则：**纯函数，只算不写**
//   传入 materials / flows，返回计算结果；真正的落盘由调用方（store.js）负责。
//   好处：① 彻底避免与 material/ledger 模块的循环依赖 ② 极易单测

const util = require('../utils/util.js');

// 成品盘库流水（priceMode === 'product'）不参与物料库存总值 —— 它记的是成品库存变动
function isProductStocktakeFlow(f) {
  return f && f.priceMode === 'product';
}

// 流水带符号金额：入库为正、出库为负
function signedAmount(f) {
  const amount = Number(f && f.totalPrice) || 0;
  return (f && f.type === 'in' ? 1 : -1) * amount;
}

// 某物料的流水集合（排除成品盘库流水）
function flowsOf(materialId, flows) {
  return (flows || []).filter(function (f) {
    return f && f.materialId === materialId && !isProductStocktakeFlow(f);
  });
}

// ⭐ 从流水派生某物料的库存总值
function deriveTotalValue(materialId, flows) {
  return util.round(flowsOf(materialId, flows).reduce(function (s, f) {
    return s + signedAmount(f);
  }, 0), 2);
}

// 全部物料的流水派生总值合计
function deriveTotalValueSum(flows) {
  return util.round((flows || []).reduce(function (s, f) {
    return isProductStocktakeFlow(f) ? s : s + signedAmount(f);
  }, 0), 2);
}

// ---------- 对账 ----------

// 单个物料对账：比对「缓存的 totalValue」与「流水派生的 totalValue」
// 返回 { materialId, name, cached, derived, diff, ok }
function reconcile(material, flows) {
  const cached = util.round(Number(material && material.totalValue) || 0, 2);
  const derived = deriveTotalValue(material && material.id, flows);
  const diff = util.round(cached - derived, 2);
  return {
    materialId: material && material.id,
    name: (material && material.name) || '',
    cached: cached,
    derived: derived,
    diff: diff,
    ok: Math.abs(diff) < 0.01
  };
}

// 全量对账
// 返回 { checked, okCount, mismatchCount, mismatches[], sumCached, sumDerived, sumOk }
function reconcileAll(materials, flows, options) {
  const opts = options || {};
  const targetCategory = opts.categoryId || null;

  const list = (materials || []).filter(function (m) {
    if (!targetCategory) return true;
    return (m.categoryId || 'bc_default') === targetCategory;
  });

  const mismatches = [];
  let sumCached = 0;
  let sumDerived = 0;

  list.forEach(function (m) {
    const r = reconcile(m, flows);
    sumCached = util.round(sumCached + r.cached, 2);
    sumDerived = util.round(sumDerived + r.derived, 2);
    if (!r.ok) mismatches.push(r);
  });

  return {
    checked: list.length,
    okCount: list.length - mismatches.length,
    mismatchCount: mismatches.length,
    mismatches: mismatches,
    sumCached: sumCached,
    sumDerived: sumDerived,
    sumDiff: util.round(sumCached - sumDerived, 2),
    sumOk: Math.abs(util.round(sumCached - sumDerived, 2)) < 0.01
  };
}

// 生成修复后的物料列表（纯函数，不落盘）
// 返回 { materials: 新数组, repairedCount, repaired: [{materialId,name,from,to}] }
function applyRepairs(materials, flows) {
  const repaired = [];
  const next = (materials || []).map(function (m) {
    const r = reconcile(m, flows);
    if (r.ok) return m;
    repaired.push({ materialId: m.id, name: m.name, from: r.cached, to: r.derived, diff: r.diff });
    return Object.assign({}, m, { totalValue: r.derived });
  });
  return { materials: next, repairedCount: repaired.length, repaired: repaired };
}

// ---------- 派生库存价值的辅助 ----------

// 由派生总值反算均价（与 store.unitCost 同口径，但基于派生值）
// stockValue 由调用方给出（面料=面积cm²、按批=batchRemain、非面料=数量）
function deriveUnitCost(derivedTotalValue, stockValue) {
  const stock = Number(stockValue) || 0;
  if (stock <= 0) return 0;
  return util.round((Number(derivedTotalValue) || 0) / stock, 6);
}

module.exports = {
  isProductStocktakeFlow: isProductStocktakeFlow,
  signedAmount: signedAmount,
  flowsOf: flowsOf,
  deriveTotalValue: deriveTotalValue,
  deriveTotalValueSum: deriveTotalValueSum,
  reconcile: reconcile,
  reconcileAll: reconcileAll,
  applyRepairs: applyRepairs,
  deriveUnitCost: deriveUnitCost
};
