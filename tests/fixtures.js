// tests/fixtures.js —— 测试数据构造器
// 目的：用少量代码快速搭出「接近真实」的物料 / 成品数据，供各测试文件复用。

const stub = require('./wx-stub.js');
const store = require('../utils/store.js');
const util = require('../utils/util.js');

// 每个用例开始前调用：清空存储并灌入种子 + 迁移（等价于一个已初始化的老用户）
function reset() {
  stub.resetStorage();
  store.ensureSeed();
  store.runMigrations();
  // 追加两个测试专用物料分类：一个面料、一个辅料
  const cats = store.getListAll('materialCategory').filter(
    (c) => c.id !== 'mc_t_fabric' && c.id !== 'mc_t_trim'
  );
  store.set(store.KEYS.MATERIAL_CATEGORIES, cats.concat([
    { id: 'mc_t_fabric', name: '测试面料类', isFabric: true, sort: 900, categoryId: 'bc_default' },
    { id: 'mc_t_trim', name: '测试辅料类', isFabric: false, sort: 901, categoryId: 'bc_default' }
  ]));
}

// ---------- 布片 ----------
function piece(length, width, over) {
  return Object.assign({
    id: util.uid('fp'),
    length: util.round(length, 2),
    width: util.round(width, 2),
    area: util.round(length * width, 2),
    source: 'buy',
    status: 'in',
    isOffcut: false,
    createdAt: '2026-01-01'
  }, over);
}

// ---------- 非面料物料 ----------
// quantity: 数量，unitPrice: 元/单位 → totalValue = quantity × unitPrice
function simpleMaterial(over) {
  const o = Object.assign({
    id: util.uid('m'),
    name: '测试辅料',
    materialCategoryId: 'mc_t_trim',
    unit: '个',
    quantity: 0,
    unitPrice: 0
  }, over);
  return {
    id: o.id,
    name: o.name,
    categoryId: 'bc_default',
    materialCategoryId: o.materialCategoryId,
    unit: o.unit,
    quantity: util.round(o.quantity, 2),
    price: util.round(o.unitPrice, 4),
    totalValue: util.round(o.quantity * o.unitPrice, 2),
    photos: [], keywords: '', attrGroups: o.attrGroups || [],
    createdAt: '2026-01-01', updatedAt: '2026-01-01'
  };
}

// ---------- 面料物料（按片精确 / 或按批估量） ----------
// pieces: [[长, 宽], ...] 或 piece 对象数组；unitPrice: 元/cm²
function fabricMaterial(over) {
  const o = Object.assign({
    id: util.uid('m'),
    name: '测试棉布',
    fabricWidth: 150,
    stockMode: 'piece',
    pieces: [],
    unitPrice: 0
  }, over);
  const pieces = o.pieces.map((p) => (Array.isArray(p) ? piece(p[0], p[1]) : p));
  const area = util.round(pieces.reduce((s, p) => s + p.area, 0), 2);
  return {
    id: o.id,
    name: o.name,
    categoryId: 'bc_default',
    materialCategoryId: 'mc_t_fabric',
    isFabric: true,
    stockMode: 'piece',
    priceMode: 'byArea',
    fabricWidth: o.fabricWidth,
    unit: '片',
    pieces,
    // price 存储口径为「元/㎡」，而 unitCost 为「元/cm²」——与源码 destroyPiece 的换算一致
    price: util.round(o.unitPrice * 10000, 4),
    totalValue: util.round(o.unitPrice * area, 2),
    photos: [], keywords: '', attrGroups: o.attrGroups || [],
    createdAt: '2026-01-01', updatedAt: '2026-01-01'
  };
}

// 按批估量面料（刀口布）：库存以 batchRemain 计量
function batchFabricMaterial(over) {
  const o = Object.assign({
    id: util.uid('m'),
    name: '测试刀口布',
    fabricWidth: 150,
    batchRemain: 0,
    batchUnit: 'kg',
    batchUnitPrice: 0
  }, over);
  return {
    id: o.id,
    name: o.name,
    categoryId: 'bc_default',
    materialCategoryId: 'mc_t_fabric',
    isFabric: true,
    stockMode: 'batch',
    priceMode: 'byBatch',
    fabricWidth: o.fabricWidth,
    batchRemain: util.round(o.batchRemain, 2),
    batchUnit: o.batchUnit,
    batchUnitPrice: o.batchUnitPrice,
    pieces: [],
    price: o.batchUnitPrice,
    totalValue: util.round(o.batchRemain * o.batchUnitPrice, 2),
    photos: [], keywords: '', attrGroups: o.attrGroups || [],
    createdAt: '2026-01-01', updatedAt: '2026-01-01'
  };
}

// ---------- 成品 ----------
// bom 行：
//   非面料 { materialId, usage }
//   面料按片 { materialId, isFabric:true, length, width }
//   面料按面积 { materialId, isFabric:true, area }
//   面料按批 { materialId, isFabric:true, batchUsage }
function product(over) {
  const o = Object.assign({
    id: util.uid('p'),
    name: '测试成品',
    nature: 'merchandise',
    bom: [],
    laborMode: 'perPiece',
    laborFeePerPiece: 0,
    includeLabor: false,
    packaging: 0,
    shipping: 0
  }, over);
  return Object.assign({
    categoryId: 'bc_default',
    productCategoryId: 'pc_other',
    photos: [], productions: [], sales: [], discards: [],
    sellableStock: 0, sampleStock: 0,
    createdAt: '2026-01-01', updatedAt: '2026-01-01'
  }, o);
}

// ---------- 写入存储 ----------
function seedMaterials(list) { store.set(store.KEYS.MATERIALS, list); }
function seedProducts(list) { store.set(store.KEYS.PRODUCTS, list); }
function seedFlows(list) { store.set(store.KEYS.FLOWS, list); }

// 当前所有物料的「库存总值合计」
function sumTotalValue() {
  return util.round(store.getMaterials().reduce((s, m) => s + (Number(m.totalValue) || 0), 0), 2);
}
// 当前所有流水 totalPrice 合计
function sumFlowPrice() {
  return util.round(store.getFlows().reduce((s, f) => s + (Number(f.totalPrice) || 0), 0), 2);
}

module.exports = {
  reset, piece, simpleMaterial, fabricMaterial, batchFabricMaterial, product,
  seedMaterials, seedProducts, seedFlows,
  sumTotalValue, sumFlowPrice,
  store, util, stub
};
