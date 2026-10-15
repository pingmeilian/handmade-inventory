// utils/csv.js —— 导出的数据与文件落地（CSV + XLSX 两个出口）
//
// ⭐ 结构说明（2026-09-27 V71 重构）：
//   把「取数据」与「拼格式」拆开 —— 四个 xxxxSheet() 负责取数（headers + rows），
//   CSV 与 XLSX 两个出口都从同一份数据出发。
//   否则两边各写一遍列，迟早出现「CSV 里有这列、xlsx 里没有」这种对不上。
const store = require('./store.js');
const util = require('./util.js');
const trace = require('../services/trace.js');

/* ===================== 通用 ===================== */

// 转义单元格（含逗号/引号/换行时加引号）
function esc(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// 生成带 BOM 的 CSV 文本
function buildCSV(headers, rows) {
  const lines = [headers.map(esc).join(',')];
  rows.forEach(r => lines.push(r.map(esc).join(',')));
  // BOM 保证 Excel 中文不乱码
  return '﻿' + lines.join('\r\n');
}

// 写入文本文件（用户数据目录），返回 filePath
function writeCSVFile(filename, content) {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager();
    const filePath = `${wx.env.USER_DATA_PATH}/${filename}`;
    fs.writeFile({
      filePath: filePath, data: content, encoding: 'utf8',
      success: () => resolve(filePath),
      fail: (e) => reject(e)
    });
  });
}

// 写入二进制文件（xlsx 用；CSV 走上面的 writeCSVFile）
// ⚠️ 小程序 writeFile 只认 string / ArrayBuffer —— Uint8Array 必须先转 ArrayBuffer。
//    注意 byteOffset：直接取 .buffer 在带上偏移时会写进多余字节，故按视图切片。
function writeBinaryFile(filename, bytes) {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager();
    const filePath = `${wx.env.USER_DATA_PATH}/${filename}`;
    let data = bytes;
    if (bytes && bytes.buffer && typeof bytes.byteLength === 'number') {
      data = (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength)
        ? bytes.buffer
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    fs.writeFile({
      filePath: filePath, data: data,
      success: () => resolve(filePath),
      fail: (e) => reject(e)
    });
  });
}

/* ===================== 四张表的数据 ===================== */

// 物料表
function materialsSheet() {
  const mats = store.getMaterials();
  // 「面料总面积」不再写死 cm² —— 单位按临界值自适应（util.fmtArea），
  // 否则大布会显示成 38500cm² 这种要一位一位数过去的写法（用户 2026-09-27 反馈）
  const headers = ['名称', '手作空间', '物料分类', '单位', '单价', '当前库存', '预警阈值', '是否面料', '面料总面积', '片数', '属性', '购买平台', '备注'];
  const bcMap = {}; store.getBusinessCategories().forEach(c => bcMap[c.id] = c.name);
  const mcMap = {}; store.getListAll('materialCategory').forEach(c => mcMap[c.id] = c.name);
  const rows = mats.map(m => {
    const fabric = store.isMaterialFabric(m);
    const pf = ((m.purchaseL1 ? m.purchaseL1 + '/' : '') + (m.purchaseL2 || m.supplier || '')).replace(/^\//, '') || '';
    return [
      m.name, bcMap[m.categoryId] || '', mcMap[m.materialCategoryId] || '', m.unit, m.price,
      fabric ? '' : (m.quantity || 0), m.threshold == null ? '' : m.threshold, fabric ? '是' : '否',
      fabric ? util.fmtArea(store.fabricArea(m)) : '', fabric ? store.fabricCount(m) : '',
      (m.attrGroups || []).map(g => g.dimension + ':' + g.value).join(' '), pf, m.remark || ''
    ];
  });
  return { name: '物料表', headers: headers, rows: rows };
}

// 成品表
function productsSheet() {
  const prods = store.getProducts();
  // 「在库」拆成两列（2026-09-27 V72）：合成一列 "3 / 1" 在 Excel 里没法分别筛选/求和
  const headers = ['名称', '手作空间', '商品性质', '品类', '销售状态', '售价', '目标利润率', '总成本', '利润', '利润率', '是否计人工', 'BOM', '商品在库', '样品在库'];
  const bcMap = {}; store.getBusinessCategories().forEach(c => bcMap[c.id] = c.name);
  const pcMap = {}; store.getListAll('productCategory').forEach(c => pcMap[c.id] = c.name);
  const rows = prods.map(p => {
    const c = require('./calc.js').computeProduct(p);
    return [
      p.name, bcMap[p.categoryId] || '', p.nature === 'merchandise' ? '商品' : '样品',
      pcMap[p.productCategoryId] || '', p.saleStatus === 'sold' ? '已卖出' : '未卖出',
      p.price || 0, util.percent(p.targetProfit || 0), c.totalCost, c.profit,
      c.profitRate == null ? '—' : util.percent(c.profitRate), p.includeLabor ? '是' : '否',
      // BOM 文案与详情页同源（calc.bomLineSpec）：刀口布显示每件用量，不再出现「0cm²」面积（2026-09-12）
      (p.bom || []).map(b => b.materialName + '×' + require('./calc.js').bomLineSpec(b, store.getMaterial(b.materialId))).join('; '),
      util.round(p.sellableStock || 0, 2), util.round(p.sampleStock || 0, 2)
    ];
  });
  return { name: '成品表', headers: headers, rows: rows };
}

// 物料出入库（⚠️ 只含**物料**流水）
//
// 2026-09-27（V70）：用户要求「数据导出的流水表里加上成品」。核查后**拆成两张表**而不是
// 挤进一张 —— 物料与成品的列不通用（物料有结余没有买家、成品有买家没有结余），
// 合并会得到一张大半是空格、谁也读不懂的表；且界面本来就是两个入口
// （「物料出入库」/「成品出入库」），导出与界面保持对称最不容易搞混。
//
// ⭐ 顺带补了一列「关联成品」：`flows.relatedProductId` 一直记着「这笔料是为哪个成品扣的」，
//    但导出时没露出来 —— 这一列正是「每块料用在哪」的答案（D74 追溯缺口的导出侧）。
//
// 2026-09-27（V72）用户微调：
//   · 「怎么有两个时间」→ 原来「时间」=「日期」是同一个值（流水日期就是写入当天），删掉重复的那列，
//     并把剩下这列精确到分（同一天录入的多笔才好排序、对账）
//   · 「加个单位」→ 补「单位」列；面积类流水单位按临界值自适应（见 util.areaAuto），
//     且同一行的「变动量 / 结余」共用同一单位（否则一行里两个数没法互相印证）
//   · 「为什么有的关联成品是空着的」→ 入库/盘点/手动出库本来就没有关联成品，留空是对的；
//     但「成品被删了」必须显式写出来，不能同样留空（否则看起来像漏记）
function flowsSheet() {
  const flows = store.getFlows().slice().sort((a, b) => b.createdAt - a.createdAt);
  const headers = ['时间', '手作空间', '物料', '单位', '类型', '变动量', '结余', '来源', '关联成品', '备注'];
  const bcMap = {}; store.getBusinessCategories().forEach(c => bcMap[c.id] = c.name);
  const prodName = {}; store.getProducts().forEach(p => { prodName[p.id] = p.name; });
  const rows = flows.map(f => {
    const d = store.flowDisplay(f);
    // 关联成品：有 id 就一定有说法（哪怕是"已删除"）；没 id 才是真的没有
    const related = f.relatedProductId ? (prodName[f.relatedProductId] || '（成品已删除）') : '';
    return [
      // 时间：优先录入时刻（含时分）；老数据缺 createdAt 才退回业务日期
      f.createdAt ? util.fmtDateTime(new Date(f.createdAt)) : (f.date || ''),
      bcMap[f.categoryId] || '', f.materialName, d.unit,
      f.type === 'in' ? '入' : '出', d.qty, d.balance, util.flowSourceLabel(f.source),
      related,
      // 被冲销的原流水在备注里标注，保证导出的账目可自证
      (f.remark || '') + (f.undone ? ' [已冲销]' : '')
    ];
  });
  return { name: '物料出入库', headers: headers, rows: rows };
}

// 成品出入库（生产 = 入 / 销售 = 出）
//
// 与「物料出入库」配套的另一半：成品的进出**不在物料流水表里**
// （记在成品对象的 productions / sales 上），所以必须单独导出，
// 否则"成品动过什么"永远看不到。汇总逻辑在 services/trace.js（纯函数，有单测）。
//
// 2026-09-27（V72）：补「利润」列 —— 只有销售行有（生产行留空，填 0 会被误读成"这批白干"）。
function productFlowsSheet() {
  const prods = store.getProducts();
  const items = trace.productFlowLog(prods);
  const headers = ['日期', '手作空间', '成品', '类型', '数量', '单价', '金额', '利润', '买家'];
  const bcMap = {}; store.getBusinessCategories().forEach(c => bcMap[c.id] = c.name);
  const pmap = {}; prods.forEach(p => { pmap[p.id] = p; });
  const rows = items.map(r => [
    r.date,
    bcMap[(pmap[r.productId] || {}).categoryId] || '',
    r.productName,
    r.kind === 'produce' ? '生产' : '销售',
    // 带符号：入为正、出为负（类型列已区分，但符号让 Excel 里一眼看得出方向）
    (r.kind === 'produce' ? '+' : '-') + r.qty,
    r.unitPrice,
    r.amount,
    // null 一律留空 —— 没有成本快照时算不出利润，留空好过给一个错数（导出会被当账用）
    r.profit == null ? '' : r.profit,
    r.client
  ]);
  return { name: '成品出入库', headers: headers, rows: rows };
}

// 四张表（供 xlsx 多 sheet 出口使用；顺序即 sheet 顺序）
function allSheets() {
  return [materialsSheet(), productsSheet(), flowsSheet(), productFlowsSheet()];
}

/* ===================== CSV 出口（既有 API，其它调用方仍在用） ===================== */
function exportMaterials() { const s = materialsSheet(); return buildCSV(s.headers, s.rows); }
function exportProducts() { const s = productsSheet(); return buildCSV(s.headers, s.rows); }
function exportFlows() { const s = flowsSheet(); return buildCSV(s.headers, s.rows); }
function exportProductFlows() { const s = productFlowsSheet(); return buildCSV(s.headers, s.rows); }

module.exports = {
  buildCSV, writeCSVFile, writeBinaryFile,
  materialsSheet, productsSheet, flowsSheet, productFlowsSheet, allSheets,
  exportMaterials, exportProducts, exportFlows, exportProductFlows
};
