// services/migrations.js —— 数据迁移收拢（Day 5 任务 5.2）
//
// 为什么收拢：原来 11 个 migrate* 散在 utils/store.js 各处，启动时逐个跑，
// 各自带幂等标记但没有总闸。现在统一到这里，外加一道 **schema 版本门**：
// 版本已是最新 → 整体短路（一次 storage 读就返回，启动零迁移开销）；
// 版本落后 → 按顺序跑全部步骤，然后落盘版本号。
//
// 依赖注入设计：store 侧把 addFlow / getMaterial / stockValue 等业务函数传进来
//（见 utils/store.js 的 runMigrations 包装）。这样本模块只依赖叶子模块
//（storage / keys / util / valuation / state），与 store 无循环引用，也可用假依赖单测。
//
// 纪律：每个迁移步骤必须幂等（自带 MIGRATED_* 守卫或天然可重跑）；
//      新增迁移步骤时 SCHEMA_VERSION 必须 +1。

const storage = require('./storage.js');
const { KEYS } = require('./keys.js');
const util = require('../utils/util.js');
const valuation = require('./valuation.js');
const sheets = require('../utils/sheets.js');   // 布料几何内核（纯函数、零依赖）
const state = require('./state.js');
const presets = require('./presets.js');        // 出厂预设唯一源（V150：与 utils/store.js 共用一份）

// 当前 schema 版本。新增迁移步骤时 +1（老用户版本号落后 → 触发全量迁移检查）
// V127（2026-10-09）3 → 4：删掉"按名字打面料标记"的 migrateMaterialCategories，
//   换成只关不开的纠正迁移 migrateFixMaterialFabricFlag。
//   ⚠️ 这两件事**必须同批**：升版本号会让整条迁移链重跑，
//      若只升版本号而不删那条错规则，布标会被**再翻成面料一次**。
// V145（2026-10-12）4 → 5：新增 migrateAddFabricMaterialOptions（材质预设补 双层纱/纱卡/涤纶）。
//   ⚠️ 用户数据里已经落盘了旧的「材质」列表 ⇒ 只改出厂值对他**不生效**，必须靠这条迁移补。
// V150（2026-10-13）5 → 6：新增 migrateAddCraftSpacesAndPresets
//   （缝纫补 7 个辅料分类「花边/嵌条与包边/织带与绳带/松紧带/纽扣/衬布/装饰辅料」
//     + 新增 拼豆 / 粘土 / 钩织 / 串珠 四个手作空间，各自带物料分类与成品品类）。
//   同样：出厂预设只对新装生效，老用户必须靠迁移。
const SCHEMA_VERSION = 6;

// ---------- 各迁移步骤（从 utils/store.js 原样迁入，仅把 store 内部函数改为 deps 注入） ----------

// 旧物料使用 m.isFabric / m.priceMode / 平铺 attrs，迁移到新模型
// 注意：直接读存储，禁止调用 getMaterials()（在 store 侧），否则无限递归。
function migrateLegacyMaterials(deps) {
  if (storage.get(KEYS.MIGRATED_V1, false)) return;
  const list = storage.get(KEYS.MATERIALS, []);
  let changed = false;
  list.forEach(m => {
    // 旧 isFabric 字段：把物料归到面料大类
    if (m.isFabric === true) {
      const fabricCat = deps.getListAll('materialCategory').find(c => c.isFabric);
      if (fabricCat && m.materialCategoryId !== fabricCat.id) {
        m.materialCategoryId = fabricCat.id;
        changed = true;
      }
    }
    // 平铺 attrs -> 层级 attrGroups
    if (!m.attrGroups && m.attrs) {
      m.attrGroups = Object.keys(m.attrs).map(k => ({ dimension: k, value: m.attrs[k] }));
      changed = true;
    }
    // 补齐 keywords（旧数据用 name 兜底）
    if (m.keywords == null) {
      m.keywords = m.name || '';
      changed = true;
    }
    // 补齐 photos
    if (!m.photos) { m.photos = []; changed = true; }
  });
  if (changed) storage.set(KEYS.MATERIALS, list);
  storage.set(KEYS.MIGRATED_V1, true);
}

// 累计库存价值迁移：旧数据只有 m.price（单价），未记录 totalValue（库存总值）
// 非面料：totalValue = price × quantity；面料：totalValue = price(元/m²) × 面积(cm²)/10000
function migrateTotalValue(deps) {
  if (storage.get(KEYS.MIGRATED_V2, false)) return;
  const list = storage.get(KEYS.MATERIALS, []);
  let changed = false;
  list.forEach(m => {
    if (m.totalValue == null) {
      const stock = deps.stockValue(m);
      m.totalValue = deps.isMaterialFabric(m)
        ? util.round((m.price || 0) * (stock / 10000), 2)
        : util.round((m.price || 0) * stock, 2);
      changed = true;
    }
  });
  if (changed) storage.set(KEYS.MATERIALS, list);
  storage.set(KEYS.MIGRATED_V2, true);
}

// 一次性校准：让老数据的 totalValue 与流水对齐，且**不改动用户看到的数字**
// （会计上的「期初余额调整分录」：补一笔流水让账实相符，校准本身有留痕）
function migrateCalibrateTotalValue(deps) {
  if (storage.get(KEYS.MIGRATED_TOTALVALUE_LEDGER, false)) return;

  const mats = storage.get(KEYS.MATERIALS, []);
  // 空库（新用户）无需校准，直接打标记
  if (!Array.isArray(mats) || !mats.length) {
    storage.set(KEYS.MIGRATED_TOTALVALUE_LEDGER, true);
    return;
  }

  const res = valuation.reconcileAll(mats, storage.get(KEYS.FLOWS, []));
  res.mismatches.forEach(function (mm) {
    const diff = util.round(mm.diff, 2);
    if (Math.abs(diff) < 0.01) return;
    const m = deps.getMaterial(mm.materialId);
    deps.addFlow({
      categoryId: (m && m.categoryId) || 'bc_default',
      materialId: mm.materialId,
      materialName: mm.name,
      // 差额为正 → 需要补一笔"入"；为负 → 需要补一笔"出"
      type: diff > 0 ? 'in' : 'out',
      qty: 0,                       // 只调整金额，不动数量（数量没漂移）
      balance: m ? deps.stockValue(m) : 0,
      remark: '期初校准：历史库存总值与流水对齐',
      source: 'calibration',
      unitCost: 0,
      totalPrice: Math.abs(diff),
      priceMode: m ? (m.stockMode === 'batch' ? 'byBatch' : (deps.isMaterialFabric(m) ? 'byArea' : 'each')) : 'each'
    });
  });

  storage.set(KEYS.MIGRATED_TOTALVALUE_LEDGER, true);
}

// 清理历史脏数据：成品 BOM 里 materialId 为空的行（未选物料就保存造成的空行）
// 幂等：清完再跑不会再有变化；只删空行，不影响任何已选物料的行
function migrateEmptyBomLines() {
  const products = storage.get(KEYS.PRODUCTS, []);
  if (!Array.isArray(products) || !products.length) return;
  let changed = false;
  products.forEach(p => {
    if (!p || !Array.isArray(p.bom)) return;
    const clean = p.bom.filter(b => b && b.materialId);
    if (clean.length !== p.bom.length) { p.bom = clean; changed = true; }
  });
  if (changed) storage.set(KEYS.PRODUCTS, products);
}

// 成品品类补标：「成品品类」功能上线前的老成品缺 productCategoryId，
// 会被看板明细/环图按该字段过滤时静默丢弃。统一补为 'pc_other'，让明细相加恒等于总计。
function migrateProductCategoryTag() {
  if (storage.get(KEYS.MIGRATED_PRODUCT_CATEGORY_TAG, false)) return;
  const list = storage.get(KEYS.PRODUCTS, []);
  if (!Array.isArray(list) || !list.length) { storage.set(KEYS.MIGRATED_PRODUCT_CATEGORY_TAG, true); return; }
  let changed = false;
  list.forEach(p => {
    if (!p || (p.productCategoryId === undefined || p.productCategoryId === null || p.productCategoryId === '')) {
      p.productCategoryId = 'pc_other';
      changed = true;
    }
  });
  if (changed) storage.set(KEYS.PRODUCTS, list);
  storage.set(KEYS.MIGRATED_PRODUCT_CATEGORY_TAG, true);
}

// 物料分类「面料类」标记：**一次性纠正**（V127 · 2026-10-09）
//
// 为什么要有这一步 —— 上一版这里是 `migrateMaterialCategories`，它按**名字**打标记：
//   `if (name.includes('面料') || name.includes('布')) c.isFabric = true`
// ⇒ **「布标」含「布」⇒ 被打成面料**，于是物料编辑页给布标带出了
//   「按批估量」+ 长/幅宽（用户反馈：「不是只有面料才有的吗」）。
//   ⚠️ 而 `utils/store.js` 的物料级判定**早就**注释写明「不再把带"布"字的都当面料，
//      避免"布标/纽扣布"等辅料被误判」—— 同一个语义的规则写在两处，**迁移这处漏改**。
//   ⚠️ 更糟的是：它是"会把结果写进用户本地存储"的那一处，危害比读时判断大得多。
//
// 用户的决定（原话）：「预置分类就那么几个，面料勾上、其余不勾就完了；
//   等用户自己添加物料分类预设的时候自己选就可以了，**哪里需要系统自己去匹配**」
// ⇒ 从此 **isFabric 只来自显式标记**（种子显式给 + 用户在「预设设置 → 物料分类 → 面料类」自己勾），
//   **运行时不猜**。本步骤是全项目唯一还带名字判断的地方 ——
//   它只做"清理历史误判"，**不是常态规则**，清理完就再也不会命中。
//
// 规则：名称含「布」且不含「面料」的分类，若当前被标成面料 ⇒ **关掉**
//   · 为什么取这个集合：它正是上面那条错规则的**命中集**（错规则 = 含'面料' 或 含'布'）；
//   · 为什么排除「面料」：它是**合法的显式标记**（种子从第一版快照起就是 true），不能动。
// 安全性：**只关不开** —— 这一步永远不可能把某个分类变成面料，所以不可能重现本次事故。
// 边界（已知取舍）：用户若**自己**把某条名字含「布」的分类勾成面料（例如「布料」），
//   会被这一步关一次；一次性，随时可以在预设设置里再打开。
// 幂等：重跑时没有任何分类满足条件 ⇒ 天然可重跑（符合"每个迁移步骤必须幂等"的纪律）。
function migrateFixMaterialFabricFlag(deps) {
  const list = deps.getListAll('materialCategory');
  let changed = false;
  list.forEach(c => {
    if (!c.isFabric) return;
    const name = String(c.name || '');
    if (!name.includes('面料') && name.includes('布')) {
      c.isFabric = false;
      changed = true;
    }
  });
  if (changed) storage.set(KEYS.MATERIAL_CATEGORIES, list);
}

// 属性预设回填：按大类名称命中内置预设，给已有大类补全属性维度的预设选项。
// 规则：已有维度 options 为空则填入内置预设；用户已填的 options 不覆盖；缺失维度补上。
//
// ⚠️ V150 收口：这里原来**又抄了一份**分类/维度表（面料 / 布标 / 拉链 / 珠饰 / 棉花 各自有哪些维度）
//   —— 那正是 V145 那次漂移的根源（同一份语义写在 store 与 migrations 两处，改一处漏一处）。
//   现在改成**从 services/presets.js 派生**：
//     · 分类 → 维度：取该分类出厂时的 attrDimensions（少了人工维护的第二份表）；
//     · 「颜色」/「材质」两个维度用 deps.ATTR_PRESETS（它们的权威列表就在那儿）。
//   ⚠️ 行为**不变**：派生出来的数组与原来那份字面量逐字相同（出厂值本来就是同一份数据的两个写法）。
function dimPresetMap(deps) {
  const map = {};
  (presets.SPACES || []).forEach(function (sp) {
    (sp.materialCategories || []).forEach(function (c) {
      if (!c.name) return;
      const dims = {};
      (c.attrDimensions || []).forEach(function (d) {
        if (!d || !d.name) return;
        // ⚠️ 用**该分类自己出厂时的那份 options**，只有它是空的才回落到全局预设。
        //   不能一律拿 ATTR_PRESETS[d.name] —— 维度重名不等于内容相同：
        //   布标也有「颜色」，但它是「黑/白/红/金/银/彩色」，拿全局那 12 色就改错了。
        const own = Array.isArray(d.options) ? d.options : [];
        dims[d.name] = (own.length ? own : ((deps.ATTR_PRESETS || {})[d.name] || [])).slice();
      });
      if (Object.keys(dims).length) map[c.name] = dims;
    });
  });
  return map;
}

function migrateAttrPresets(deps) {
  if (storage.get(KEYS.MIGRATED_ATTR_PRESETS, false)) return;
  const PRESETS = dimPresetMap(deps);
  const list = deps.getListAll('materialCategory');
  let changed = false;
  list.forEach(c => {
    const map = PRESETS[String(c.name || '')];
    if (!map) return;
    const dims = (c.attrDimensions || []).map(d => {
      if (typeof d === 'string') return { name: d, options: [] };
      return { name: d.name, options: Array.isArray(d.options) ? d.options.slice() : [] };
    });
    Object.keys(map).forEach(dimName => {
      const existing = dims.find(d => d.name === dimName);
      if (existing) {
        if (existing.options.length === 0) { existing.options = map[dimName].slice(); changed = true; }
      } else {
        dims.push({ name: dimName, options: map[dimName].slice() });
        changed = true;
      }
    });
    c.attrDimensions = dims;
  });
  if (changed) storage.set(KEYS.MATERIAL_CATEGORIES, list);
  storage.set(KEYS.MIGRATED_ATTR_PRESETS, true);
}

// 材质预设"补齐"（2026-10-12 V145）：往**已有**的「材质」维度里追加 双层纱 / 纱卡 / 涤纶。
//
// 为什么需要单独一条（而不是只改 utils/store.js 的出厂值）：
//   属性维度的 options 是**存在用户数据里**的（materialCategory.attrDimensions）——
//   出厂值只在「新装 / 新空间」和「该维度 options 为空时的兜底」生效。
//   老用户的数据早就落盘了 ⇒ **不迁移的话，用户在新版本里根本看不到这三个选项**。
//   （这是本项目的既有惯例：migrateAttrPresets 当初也是为此而存在。）
//
// ⚠️ 三条纪律（改用户数据必须守住）：
//   ① **只加不删**：用户删掉的选项不许"复活"吗？—— 这里确实是"补"，所以会补回来，
//      但只在**首次**执行时补一次（幂等标记），之后用户再删就永远不碰了；
//   ② **不动用户已有项的顺序**，也不改内容；
//   ③ 只碰**名字叫「材质」的维度**，别的大类 / 别的维度一律不碰。
//
// 位置规则（用户明确要求「涤纶放在纯棉之后」）：**每项自带 `after` 锚点** ——
//   有锚点就插在它后面、没有就落末尾。写成一个数组而不是"三个名字 + 一个锚点"，
//   是因为后者会让后插的挤到前面（顺序反了），得靠执行顺序去猜。
function migrateAddFabricMaterialOptions(deps) {
  if (storage.get(KEYS.MIGRATED_MATERIAL_PRESET_ADD, false)) return;
  const ADD = deps.MATERIAL_PRESET_ADDITIONS || [];
  const list = deps.getListAll('materialCategory');
  let changed = false;
  list.forEach(c => {
    (c.attrDimensions || []).forEach(d => {
      if (!d || typeof d === 'string') return;          // 字符串形态的维度没有 options 可补
      if (d.name !== '材质') return;
      if (!Array.isArray(d.options)) return;
      ADD.forEach(item => {
        const name = (item && item.name) || String(item || '');
        if (!name) return;
        if (d.options.indexOf(name) >= 0) return;       // 已经有了，别重复插
        const at = item && item.after ? d.options.indexOf(item.after) : -1;
        if (at >= 0) d.options.splice(at + 1, 0, name); // 插在锚点后面（涤纶紧跟纯棉）
        else d.options.push(name);                      // 没锚点（或锚点不在了）就落末尾
        changed = true;
      });
    });
  });
  if (changed) storage.set(KEYS.MATERIAL_CATEGORIES, list);
  storage.set(KEYS.MIGRATED_MATERIAL_PRESET_ADD, true);
}

// 手作空间与出厂预设「补齐」（2026-10-13 V150）
//
// 用户要求：「还有物料预设，加花边嵌条等等的」+「拼豆、粘土、钩织、串珠这些空间也加一些默认的预设」。
//
// 为什么必须是一条迁移（不能只改 services/presets.js）：
//   出厂预设只在「新装 / 用户手动恢复出厂」时写进 storage。老用户的数据**早就落盘了** ——
//   只改出厂值 ⇒ 他在新版本里**根本看不到这四个空间与那七个新分类**（V145 那次就是这么栽的）。
//
// 做什么：把 `presets.SPACES` 里每个出厂空间（连同它名下的物料分类 / 成品品类 / 单位 / 平台）
//   逐条补齐。具体怎么落盘在 `store.ensureSpaceWithPresets`（由 deps 注入）——
//   本模块只管"什么时候补、补哪些"，不碰存储集合的写法（与文件头的依赖注入设计一致）。
//
// ⚠️ 三条纪律（改用户数据必须守住）：
//   ① **只加不删**：用户已有的分类、改过的名字、自建的分类，一个字不动；
//   ② **按 id 或「同空间同名」认**：用户可能删了出厂的「花边」又自己建了个同名的 ⇒ 不再来一条；
//   ③ **只补一次**：走 MIGRATED_CRAFT_PRESETS 标记 —— 用户之后删掉的分类不会被"复活"。
//
// ⚠️ 与 `buildDefaultPresets`（新装那条路）的分工：那条只对新装生效，这条只对老数据生效；
//    两边都从 services/presets.js 取**同一份数据**，所以内容必然一致（这正是 V145 收口的意义）。
function migrateAddCraftSpacesAndPresets(deps) {
  if (storage.get(KEYS.MIGRATED_CRAFT_PRESETS, false)) return;
  // 依赖没注入就当作"这一步还没跑"（不落标记、留着重试），而不是静默跳过
  if (typeof deps.ensureSpaceWithPresets !== 'function') return;
  (presets.SPACES || []).forEach(function (sp) { deps.ensureSpaceWithPresets(sp); });
  storage.set(KEYS.MIGRATED_CRAFT_PRESETS, true);
}

// 成品模型重构（2026-08-06）：
// 1) nature 'sellable' → 'merchandise'（商品）；删除 inPortfolio（作品集=总库容器）
// 2) 库存由单一 stock 拆为 sellableStock / sampleStock
function migrateProductModel() {
  if (storage.get(KEYS.MIGRATED_PRODUCT_MODEL, false)) return;
  const list = storage.get(KEYS.PRODUCTS, []);
  let changed = false;
  const out = list.map(p => {
    const np = p;
    if (np.nature === 'sellable') { np.nature = 'merchandise'; changed = true; }
    if (np.inPortfolio != null) { delete np.inPortfolio; changed = true; }
    if (np.stock != null && np.sellableStock == null && np.sampleStock == null) {
      if (np.nature === 'sample') np.sampleStock = np.stock;
      else np.sellableStock = np.stock;
      delete np.stock;
      changed = true;
    }
    if (np.sellableStock == null) np.sellableStock = 0;
    if (np.sampleStock == null) np.sampleStock = 0;
    return np;
  });
  if (changed) storage.set(KEYS.PRODUCTS, out);
  storage.set(KEYS.MIGRATED_PRODUCT_MODEL, true);
}

// 手作空间补全：确保默认手作空间始终存在（兼容老用户已 SEEDED 的情况）。
// 一次性执行（带幂等标记），不覆盖用户后续在「分类管理」里的自定义增删。
function migrateBusinessCategories() {
  if (storage.get(KEYS.MIGRATED_BC, false)) return;
  const list = storage.get(KEYS.BUSINESS_CATEGORIES, []);
  if (list.length === 0) {
    // 新用户：仅创建 1 条默认手作空间（名字从唯一源取 —— V150 收口：原来是写死的「缝纫」）
    const defSpace = presets.spaceById(presets.DEFAULT_SPACE_ID) || { name: '综合' };
    storage.set(KEYS.BUSINESS_CATEGORIES, [{ id: presets.DEFAULT_SPACE_ID, name: defSpace.name, sort: 0, createdAt: util.today() }]);
  } else if (!list.find(x => x.id === 'bc_default')) {
    // 老用户缺默认空间时补一个（沿用旧名「综合」兜底，避免数据悬空）
    list.unshift({ id: 'bc_default', name: '综合', sort: -1, createdAt: util.today() });
    storage.set(KEYS.BUSINESS_CATEGORIES, list);
  }
  // 保证全局选中项有效，否则回退到默认空间（经 services/state.js 统一管理）
  {
    const cur = state.getCurrentSpace();
    const exists = storage.get(KEYS.BUSINESS_CATEGORIES, []).find(x => x.id === cur);
    if (!exists) state.init('bc_default');   // 迁移期校正，不发广播
  }
  storage.set(KEYS.MIGRATED_BC, true);
}

// 手作空间打标：升级前的旧数据没有 categoryId 字段，统一归入「综合」空间（bc_default）。
function migrateSpaceTag() {
  if (storage.get(KEYS.MIGRATED_SPACE_TAG, false)) return;
  const keys = [KEYS.MATERIALS, KEYS.PRODUCTS, KEYS.FLOWS, KEYS.INSPIRATIONS, KEYS.WANTS, KEYS.COMMISSIONS];
  keys.forEach(key => {
    const list = storage.get(key, []);
    let changed = false;
    list.forEach(x => { if (x && !x.categoryId) { x.categoryId = 'bc_default'; changed = true; } });
    if (changed) storage.set(key, list);
  });
  storage.set(KEYS.MIGRATED_SPACE_TAG, true);
}

// 配置型列表 / 损耗记录 / 趋势快照 补打手作空间标记：
// 升级前这些集合是全局共用的（无 categoryId），统一归入默认空间 bc_default。
function migrateConfigSpaceTag(deps) {
  if (storage.get(KEYS.MIGRATED_CONFIG_SPACE, false)) return;
  // 配置型列表（物料分类 / 属性 / 品类 / 单位 / 平台）
  Object.keys(deps.LIST_TYPES).forEach(type => {
    const key = deps.LIST_TYPES[type].key;
    const list = storage.get(key, []);
    let changed = false;
    list.forEach(it => { if (it && !it.categoryId) { it.categoryId = 'bc_default'; changed = true; } });
    if (changed) storage.set(key, list);
  });
  // 损耗记录：耗材 / 资产 / 工具
  [KEYS.CONSUMABLES, KEYS.ASSETS, KEYS.TOOLS].forEach(key => {
    const list = storage.get(key, []);
    let changed = false;
    list.forEach(it => { if (it && !it.categoryId) { it.categoryId = 'bc_default'; changed = true; } });
    if (changed) storage.set(key, list);
  });
  // 趋势快照
  const snaps = storage.get(KEYS.SNAPSHOTS, []);
  let sChanged = false;
  snaps.forEach(s => { if (s && !s.categoryId) { s.categoryId = 'bc_default'; sChanged = true; } });
  if (sChanged) storage.set(KEYS.SNAPSHOTS, snaps);
  storage.set(KEYS.MIGRATED_CONFIG_SPACE, true);
}

// ---------- 总入口（带 schema 版本门） ----------

// 老流水备注订正（2026-09-27 V73）
//
// 背景：V72 之前，排单交付 / 撤销交付返还写流水时，备注拼的是 `'排单#' + c.id`，
//   而 c.id 是内部随机串（形如 cm_k3j9f2）—— 用户在导出与页面上看到的就是一串乱码。
//   V72 只修了**写入侧**（新记录写客户名），**设备上已存在的老记录仍是脏的**
//   （用户复看数据导出时反馈"中间还是乱码"就是指这些）。这里做一次性订正。
//
// 做什么：把 `排单#<id> 交付|撤销交付返还…` 反查排单拿到客户名，重写成
//   「排单交付 · 客户名」（撤销的写「排单交付撤销 · 客户名」）；
//   同时把 source 从 'manual' / 'cut' 订正为 'commission'（导出显示「排单履约」）。
//   为什么连 source 一起改：① 否则导出仍显示「手动 / 成品裁剪」，与事实不符；
//   ② source='manual' 会让物料详情页给这笔交付一个「撤销」按钮，而直接冲流水
//      不会回退排单的 deliveredQty —— 排单余量会与库存对不上（撤销交付该走排单侧）。
//
// 边界：排单已被删除 / 未填客户 → 写「未记录客户」（既不回退成 id，也不留空）。
// 幂等：重写后不再匹配 `排单#` 开头，天然可重跑；另配 MIGRATED_FLOW_REMARK 守卫。
const LEGACY_DELIVER_REMARK = /^排单#(\S+)\s+(\S.*)$/;

function migrateFlowRemark() {
  if (storage.get(KEYS.MIGRATED_FLOW_REMARK, false)) return;
  const flows = storage.get(KEYS.FLOWS, []);
  if (!Array.isArray(flows)) { storage.set(KEYS.MIGRATED_FLOW_REMARK, true); return; }

  const clientOf = {};
  storage.get(KEYS.COMMISSIONS, []).forEach(function (c) {
    if (c && c.id) clientOf[c.id] = c.client || '';
  });

  let changed = false;
  flows.forEach(function (f) {
    if (!f || typeof f.remark !== 'string') return;
    const m = LEGACY_DELIVER_REMARK.exec(f.remark);
    if (!m) return;
    const who = clientOf[m[1]] || '未记录客户';
    f.remark = (m[2].indexOf('撤销') >= 0 ? '排单交付撤销 · ' : '排单交付 · ') + who;
    if (f.source === 'manual' || f.source === 'cut') f.source = 'commission';
    changed = true;
  });
  if (changed) storage.set(KEYS.FLOWS, flows);
  storage.set(KEYS.MIGRATED_FLOW_REMARK, true);
}

// ---------- 布料几何模型迁移（2026-09-29 V81 / D88~D97）----------
//
// 老模型把布料存成一堆**互不相干的矩形**：裁一刀就把剩下的 L 形硬拆成两个矩形分开记账
//（宽度仍等于幅宽的那块被叫"整布"、窄的叫"碎料"）。可物理上它们是**连着的一整块** ——
// 拆开之后再也取不出跨那条分界线的料（用户真机反馈：「整布和碎布可能是连在一起的」）。
//
// 新模型：**一块布 = 外框 base − 镂空 holes**（见 utils/sheets.js）。
//   · 裁剪不再拆块：挖料 = 往 holes 里加一个矩形，形状永远真实
//   · 「整布 / 碎布」= 可用区域的宽还等不等于幅宽（用户 D97 定的口径）
//   · 面积口径不变 ⇒ **账一分钱不动**
//
// 合并规则（sheets.sheetsFromRects）：只在能唯一确定是"同一条阶梯形"时才合并；
//   判不准就**每块各算一块布**（保守，不猜）—— 宁可少合、不可合错。
//   例：裁掉 38×83 一角后的「202×150 + 38×67」⇒ 还原成 240×150 带一个缺口（面积逐 cm² 相等）；
//       两次入库的「200×150 + 100×150」⇒ 宽度都 = 幅宽，各自独立，不合并。
function migrateFabricSheets() {
  if (storage.get(KEYS.MIGRATED_FABRIC_SHEETS, false)) return;
  const list = storage.get(KEYS.MATERIALS, []);
  if (!Array.isArray(list) || !list.length) {
    storage.set(KEYS.MIGRATED_FABRIC_SHEETS, true);
    return;
  }
  let changed = false;
  list.forEach(function (m) {
    if (!m || !Array.isArray(m.pieces) || !m.pieces.length) return;
    if (m.pieces.some(function (p) { return p && p.base; })) return;   // 已是新模型 → 不动
    // 只动**在库**的片：已出库的片是历史记录（账面之外），合并它们会丢掉出库语义
    const alive = m.pieces.filter(function (p) { return p && p.status === 'in'; });
    const history = m.pieces.filter(function (p) { return !p || p.status !== 'in'; });
    if (!alive.length) return;
    const rebuilt = sheets.sheetsFromRects(alive, m.fabricWidth);
    if (!rebuilt.length) return;
    // 溯源：合并成一块时，宿主取面积最大的那片（保住 id / source / createdAt，
    // 老流水的 cutSourceId 至少还有一个指向存在的片）；未合并时按原顺序一一对应。
    const hosts = rebuilt.length === alive.length
      ? alive.slice()
      : [alive.slice().sort(function (a, b) { return (b.area || 0) - (a.area || 0); })[0]];
    m.pieces = history.concat(rebuilt.map(function (sh, i) {
      const host = hosts[i] || hosts[0] || {};
      const fw = m.fabricWidth;
      return {
        id: host.id || ('fp_' + m.id + '_' + i),
        base: sh.base,
        holes: sh.holes,
        cuts: sh.cuts || 0,
        length: sh.base.length,
        width: sh.base.width,
        area: sheets.freeArea(sh),                       // = 外框 − 镂空（与原面积一致）
        source: host.source || 'purchase',
        status: host.status || 'in',
        isOffcut: fw ? !sheets.keepsFullWidth(sh, fw) : false,
        createdAt: host.createdAt || util.today()
      };
    }));
    changed = true;
  });
  if (changed) storage.set(KEYS.MATERIALS, list);
  storage.set(KEYS.MIGRATED_FABRIC_SHEETS, true);
}

const STEPS = [
  migrateLegacyMaterials,
  migrateTotalValue,
  migrateFixMaterialFabricFlag,  // 只关不开的一次性纠正（必须紧跟"删除按名字打标记"同批落地）
  migrateAttrPresets,
  migrateAddFabricMaterialOptions,   // 必须紧跟在 attrPresets 之后：先"补空维度"，再"往已有内容加项"
  migrateAddCraftSpacesAndPresets,   // 同行列：补"空间 + 它名下的分类"（V150）
  migrateProductModel,
  migrateBusinessCategories,
  migrateSpaceTag,
  migrateConfigSpaceTag,
  migrateEmptyBomLines,
  migrateProductCategoryTag,
  migrateFabricSheets,          // 布料几何模型（只改形状，不碰金额，可放在校准之前）
  migrateCalibrateTotalValue,   // ⭐ 必须最后跑：要在旧模型迁移全部完成后才能对账校准
  migrateFlowRemark             // 纯文案订正，不碰库存与金额，放最后无依赖
];

// 启动迁移入口。deps 见文件头注释。
// 版本已是最新 → 直接短路（一次读返回）；落后 → 顺序跑全部步骤并落盘版本号。
function runAll(deps) {
  if (storage.get(KEYS.SCHEMA_VERSION, 0) >= SCHEMA_VERSION) return;
  STEPS.forEach(function (step) { step(deps); });
  storage.set(KEYS.SCHEMA_VERSION, SCHEMA_VERSION);
}

module.exports = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  runAll: runAll
};
