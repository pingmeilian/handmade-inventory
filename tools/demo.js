// services/demo.js —— 一键填充演示数据（开发期工具）
//
// 目的：开发者工具重新导入项目会丢 storage（平台机制，非本程序 bug），
// 一键生成一整套有代表性、账目自洽的演示数据，免手输。
//
// 设计铁律：
// 1. 先 restoreFactoryPresets() —— 预设大类/单位必须在，物料才有归属
// 2. 全部走 store 真实写路径（saveMaterial/inbound/saveProduct/produceProduct/sellProduct…），
//    流水/库存总值/成本由既有逻辑保证自洽 —— 绝不手写存储绕过账目
// 3. 追加语义：不删除不覆盖，可重复点击
// 4. 命名遵守物料自动命名规则：颜色 + 材质 + 花纹 + 关键词（与编辑页「生成名称」同源），
//    同时写入 attrs / keywords —— 编辑页打开时各字段与名称对得上（2026-09-12 用户指正）
// 5. BOM 行字段与 produceProduct 的 consumeBom 严格对齐：
//    非面料 = { materialId, materialName, usage }（usage=每件用量）；
//    刀口布 = { materialId, materialName, isFabric: true, batchUsage }（每件 kg/片）。
//    ⚠️ 首版误写 qty 导致消耗为 0、成品页物料清单空白 —— 已修正并加语义测试（2026-09-12）

const store = require('../utils/store.js');

// ---------- 名字池 ----------

var FABRICS = [
  { mat: '纯棉', kw: '平布' }, { mat: '亚麻', kw: '格子布' },
  { mat: '针织', kw: '印花布' }, { mat: '牛仔', kw: '素色布' },
  { mat: '雪纺', kw: '波点布' }, { mat: '灯芯绒', kw: '条纹布' },
  { mat: '纯棉', kw: '帆布' }, { mat: '亚麻', kw: '提花布' }
];
var COLORS = ['米白', '藏蓝', '砖红', '墨绿'];
var BATCH = [
  { hua: '碎花' }, { hua: '格子' }, { hua: '素色' },
  { hua: '条纹' }, { hua: '波点' }, { hua: '渐变' }
];
var ZIPPERS = [
  { color: '黑色', kw: '隐形拉链' }, { color: '白色', kw: '树脂拉链' },
  { color: '藏青', kw: '金属拉链' }, { color: '咖啡', kw: '尼龙拉链' }
];
var BUTTONS = [
  { mat: '贝壳', kw: '纽扣' }, { mat: '木质', kw: '纽扣' },
  { mat: '树脂', kw: '纽扣' }, { mat: '金属', kw: '纽扣' }
];
var MISC = ['涤纶线', '弹力线', '蕾丝花边', '磁力暗扣'];
var HAIR = ['蝴蝶结发夹', '弹簧夹', '大肠发圈', '头饰花环'];
var PET = ['宠物领结', '宠物围脖', '宠物口水巾'];
var BAG = ['束口袋', '帆布挎包', '零钱包'];
var CLOTH = ['儿童围裙', '夏季罩衫'];
var CLIENTS = ['张女士', '李先生', '王阿姨', '小美', '阿珍', '陈同学', '刘老师', '周小姐'];
var TOOLS_N = ['裁布剪刀', '线头剪刀', '拆线器', '水消笔', '软尺', '珠针盒', '顶针', '锥子'];
var ASSETS_N = ['兄弟缝纫机', '锁边机', '蒸汽熨斗', '裁布台', '打扣机'];
var CONSUMABLES_N = ['涤纶线卷', '珍珠棉包', '胶枪胶棒', '水消笔芯', '防锈针盒'];
var STEPS = ['藏针缝', '平针缝', '回针缝', '锁边缝', '卷针缝', '贴布绣', '打籽绣', '缩褶缝'];

function _pick(arr, i) { return arr[i % arr.length]; }

function _date(offsetDays) {
  var d = new Date(Date.now() - (offsetDays || 0) * 86400000);
  var p = function (n) { return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// 与物料编辑页「生成名称」同一拼装顺序：颜色 + 材质 + 花纹 + 关键词
function _autoName(attrs, kw) {
  return [attrs['颜色'], attrs['材质'], attrs['花纹'], kw]
    .filter(function (x) { return !!x; }).join('');
}

// ---------- 生成器 ----------

function fillDemoData() {
  store.restoreFactoryPresets(); // 保底：预设大类/单位必须在，物料才有归属

  var counts = { materials: 0, products: 0, inspirations: 0, wants: 0, commissions: 0, consumables: 0, assets: 0, tools: 0, steps: 0, sales: 0 };
  var flowsBefore = store.getFlows().length;

  // ---------- 物料（26 件，名称全部走自动命名规则） ----------
  var i, m, attrs;
  var zipMats = [], threadMat = null, batchMats = [];

  // 按片面料 × 8：名称 = 颜色 + 材质 + 关键词
  for (i = 0; i < FABRICS.length; i++) {
    attrs = { '颜色': _pick(COLORS, i), '材质': FABRICS[i].mat };
    m = store.saveMaterial({
      name: _autoName(attrs, FABRICS[i].kw),
      materialCategoryId: 'mc_fabric',
      price: 0.02 + (i % 4) * 0.01,
      threshold: 500,
      attrs: attrs,
      keywords: FABRICS[i].kw,
      fabricLength: 200 + i * 10,          // 长（cm）——编辑页「长」回显
      fabricWidth: 140,                    // 幅宽（cm）
      purchaseL1: '供应商',
      purchaseL2: _pick(['微信小店', '布料市场', '淘宝', '拼多多'], i)
    });
    store.inbound(m.id, null, { length: 150 + i * 5, width: 140, total: 22 + i * 3, date: _date(30 - i) });
    if (i % 2 === 0) store.inbound(m.id, null, { length: 120, width: 140, total: 18 + i, date: _date(12 - (i % 10)) });
    counts.materials++;
  }
  // 刀口布（按批）× 6：名称 = 花纹 + 关键词
  for (i = 0; i < BATCH.length; i++) {
    attrs = { '花纹': BATCH[i].hua };
    m = store.saveMaterial({
      name: _autoName(attrs, '刀口布'),
      materialCategoryId: 'mc_fabric',
      stockMode: 'batch',
      batchUnit: 'kg',
      price: 0,
      threshold: 1,
      attrs: attrs,
      keywords: '刀口布',
      purchaseL1: '供应商',
      purchaseL2: _pick(['布料市场', '淘宝', '闲鱼'], i)
    });
    batchMats.push(m);
    store.inbound(m.id, 8 + i * 2, 40 + i * 8, '整卷购入', _date(28 - i * 2));
    counts.materials++;
  }
  // 非面料 × 12：拉链 = 颜色+关键词；纽扣 = 材质+关键词；线/花边 = 关键词
  for (i = 0; i < 12; i++) {
    var spec2 = i < 4 ? ZIPPERS[i] : (i < 8 ? BUTTONS[i - 4] : null);
    var mc2 = i < 4 ? 'mc_zipper' : (i < 8 ? 'mc_bead' : 'mc_other');
    if (spec2) {
      attrs = spec2.color ? { '颜色': spec2.color } : { '材质': spec2.mat };
      m = store.saveMaterial({
        name: _autoName(attrs, spec2.kw),
        materialCategoryId: mc2,
        price: 0.4 + (i % 5) * 0.3,
        threshold: 10,
        attrs: attrs,
        keywords: spec2.kw,
        purchaseL1: '供应商',
        purchaseL2: _pick(['淘宝', '拼多多', '义乌小商品', '微信小店'], i)
      });
    } else {
      var kw2 = MISC[i - 8];
      m = store.saveMaterial({
        name: kw2,
        materialCategoryId: mc2,
        price: 0.4 + (i % 5) * 0.3,
        threshold: 10,
        keywords: kw2,
        purchaseL1: '供应商',
        purchaseL2: _pick(['淘宝', '拼多多', '义乌小商品', '微信小店'], i + 1)
      });
    }
    if (m.name === '涤纶线') threadMat = m;
    zipMats.push(m);
    store.inbound(m.id, 100 + i * 20, 60 + i * 15, null, _date(25 - i));
    counts.materials++;
  }
  if (!threadMat) threadMat = zipMats[0];

  // ---------- 成品（21）+ 生产（真实扣料）+ 销售 ----------
  // 成品名称无自动命名规则（程序只对物料做属性命名），按「款式 + 颜色」手填——与页面行为一致
  var productNames = [];
  for (i = 0; i < 8; i++) productNames.push({ name: _pick(HAIR, i) + ' ' + _pick(COLORS, i), pc: 'pc_hair', price: 12 + (i % 4) * 6 });
  for (i = 0; i < 5; i++) productNames.push({ name: _pick(PET, i) + ' ' + _pick(COLORS, i + 1), pc: 'pc_pet', price: 18 + i * 7 });
  for (i = 0; i < 5; i++) productNames.push({ name: _pick(BAG, i) + ' ' + _pick(COLORS, i + 2), pc: 'pc_bag', price: 35 + i * 12 });
  for (i = 0; i < 3; i++) productNames.push({ name: _pick(CLOTH, i) + ' ' + _pick(COLORS, i), pc: 'pc_cloth', price: 55 + i * 15 });

  for (i = 0; i < productNames.length; i++) {
    var spec = productNames[i];
    var zip = zipMats[i % zipMats.length];
    var bat = batchMats[i % batchMats.length];
    var p = store.saveProduct({
      name: spec.name,
      productCategoryId: spec.pc,
      nature: 'merchandise',
      note: '演示数据',
      // ⭐ 字段与 consumeBom 对齐：非面料 usage（每件用量），刀口布 batchUsage（每件 kg）
      bom: [
        { materialId: zip.id, materialName: zip.name, usage: 1 + (i % 2) },
        { materialId: threadMat.id, materialName: threadMat.name, usage: 1 },
        { materialId: bat.id, materialName: bat.name, isFabric: true, batchUsage: 0.05 + (i % 3) * 0.03 }
      ]
    });
    counts.products++;
    var qty = 5 + (i % 5);
    store.produceProduct(p.id, qty, [], _date(20 - (i % 15)));
    store.sellProduct(p.id, 1 + (i % 2), spec.price, _date(10 - (i % 8)));
    counts.sales += 1;
    if (i % 4 === 0) {
      store.sellProduct(p.id, 1, Math.max(1, spec.price - 2), _date(6 - (i % 5)));
      counts.sales += 1;
    }
  }

  // ---------- 灵感 / 心愿（各 22） ----------
  for (i = 0; i < 22; i++) {
    store.saveInspiration({ title: '教程灵感 ' + (i + 1) + '：' + _pick(HAIR.concat(BAG), i) + '的做法', note: '参考小红书教程，材料：' + _pick(FABRICS, i).mat });
    counts.inspirations++;
    store.saveWant({ title: '想做 ' + _pick(HAIR.concat(PET, BAG, CLOTH), i) + '（演示 ' + (i + 1) + '）', note: '预计用料：' + _pick(FABRICS, i).mat });
    counts.wants++;
  }

  // ---------- 排单（22） ----------
  var prods = store.getProducts();
  for (i = 0; i < 22; i++) {
    var pp = prods[i % prods.length];
    store.saveCommission({
      productId: pp.id, productName: pp.name,
      client: _pick(CLIENTS, i), qty: 2 + (i % 4),
      price: 15 + (i % 6) * 8, deadline: _date(-(i % 20) - 1),
      remark: '演示排单'
    });
    counts.commissions++;
  }

  // ---------- 耗材（21）/ 固定资产（21）/ 工具（21） ----------
  for (i = 0; i < 21; i++) {
    store.saveConsumable({ name: _pick(CONSUMABLES_N, i) + ' ' + (i + 1), spec: '标准装', quantity: 10 + i, totalPrice: 8 + i * 3, inDate: _date(60 - i) });
    counts.consumables++;
    store.saveAsset({ name: _pick(ASSETS_N, i) + ' ' + String.fromCharCode(65 + (i % 6)) + (i + 1), originalValue: 200 + i * 45, lifeMonths: 24 + (i % 5) * 6, inDate: _date(200 - i * 3) });
    counts.assets++;
    store.saveTool({ name: _pick(TOOLS_N, i) + ' ' + (i + 1), price: 5 + i * 4, inDate: _date(90 - i) });
    counts.tools++;
  }

  // ---------- 收藏工序（22） ----------
  for (i = 0; i < 22; i++) {
    store.addCollectedStep({ title: _pick(STEPS, i) + '（' + (i + 1) + '）', body: '要点：针脚均匀 0.2cm，起针藏线头，收针打结两次。示例工序说明 ' + (i + 1) + '。' });
    counts.steps++;
  }

  counts.flowsAdded = store.getFlows().length - flowsBefore;
  return counts;
}

module.exports = { fillDemoData: fillDemoData };
