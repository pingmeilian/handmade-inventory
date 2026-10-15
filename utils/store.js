// utils/store.js —— 本地存储数据层（零后台、零 API、零成本）
// 所有数据持久化于 wx.storage，按手作空间（businessCategory）隔离。
const util = require('./util.js');
const sheets = require('./sheets.js');    // 布料几何内核（V81：一块布 = 外框 − 镂空）
const palette = require('./palette.js');  // 分类配色（V112：materialThumb 的占位底色/墨色）
const origin = require('./origin.js');    // 面料「出处」唯一口径（V95：形状 + 哪片布 + 哪个位置）
const themes = require('./themes.js');    // 主题唯一真相源（V97：按手作空间换色）
const image = require('./image.js');
const storage = require('../services/storage.js');
const { KEYS } = require('../services/keys.js');
const valuation = require('../services/valuation.js');
const state = require('../services/state.js');
const migrations = require('../services/migrations.js');
const presets = require('../services/presets.js');   // 出厂预设唯一源（V150：store 与 migrations 共用一份）
// 云能力入口。注意：cloud.js 只依赖 cloud-config（不反向依赖 store），所以无循环引用。
const cloud = require('../services/cloud.js');

// 属性维度预设选项（颜色 / 材质）——选项式录入
// ⚠️ **唯一源已挪到 `services/presets.js`**（V150）：
//    出厂预设有两类消费者 —— store（新装 / 新空间 / 恢复出厂）与 migrations（给老用户补）。
//    V145 那次 migrations 里又抄了一份分类/维度表 ⇒ 两处各写一遍迟早漂。
//    现在两边都从 presets.js 取；这里只是**转发**，本文件不再自己持有一份字面量。
// ⚠️ 改 presets.js 只对**新装 / 新空间**生效；老用户的数据要另配一条迁移去补
//    （见 services/migrations.js 的 migrateAddCraftSpacesAndPresets）。
const ATTR_PRESETS = presets.ATTR_PRESETS;

// V145 要"补"进老数据的三个材质 —— **每项自带位置**（`after` 为空表示落在末尾）。
//   为什么不只写三个名字：三个都想插在纯棉后面的话，后插的会挤到前面去（顺序反了）。
//   逐项声明位置，读起来就是"涤纶紧跟纯棉、其余落末尾"，不会靠执行顺序去猜。
const MATERIAL_PRESET_ADDITIONS = [
  { name: '涤纶', after: '纯棉' },   // 用户明确要求：涤纶放在纯棉之后
  { name: '双层纱' },                // 未指定位置 ⇒ 末尾（与 ATTR_PRESETS['材质'] 的次序一致）
  { name: '纱卡' }
];

function getAttrPresets(dimension) { return ATTR_PRESETS[dimension] || []; }

// 单位预设选项（选项式录入，避免自由输入口径不一）
// ⚠️ 同样转发自 presets.js（V150）。物料编辑页的单位下拉读的就是它。
const UNIT_PRESETS = presets.UNIT_PRESETS;
function getUnitPresets() { return UNIT_PRESETS.slice(); }

// 存储内核已抽到 services/storage.js（含容量保护 + 写失败可见）
// 这里保留同名别名，页面层的 store.get / store.set 调用无需改动
const get = storage.get;
const set = storage.set;

function uid(p) { return util.uid(p); }

// 当前手作空间（从全局状态读取，三页联动的唯一真相源）
function currentSpace() {
  return state.getCurrentSpace();
}
// 兼容：旧数据缺 categoryId 时归入「综合」空间
function spaceOf(x) { return (x && x.categoryId) || 'bc_default'; }

/* ===================== 种子预设 ===================== */

// 默认预设的唯一来源：ensureSeed（首装）与 restoreFactoryPresets（用户手动恢复）共用，
// 避免两处字面量漂移。**数据本体在 services/presets.js**（V150 起）——
// 这里只做「摊平 + 打时间戳」，不再自己持有任何预设字面量。
//
// 摊平规则：每个手作空间各来一份物料分类 / 成品品类 / 单位 / 平台。
//   为什么单位与平台也要按空间给一份：配置列表是**按空间隔离**的（见 getList(type) 的
//   `filter(x => x.categoryId === cid)`）⇒ 不给的话，新空间的「预设设置」里那两页是空的。
//   ⚠️ 分类 id 由 presets.js **显式给出、全项目唯一**（不用 uid）——
//      要可预测，否则迁移没法判断"这条出厂分类是不是已经加过了"。
function buildDefaultPresets() {
  const MATERIAL_CATEGORIES = [];
  const PRODUCT_CATEGORIES = [];
  const UNITS = [];
  const PLATFORMS = [];
  presets.SPACES.forEach((sp) => {
    (sp.materialCategories || []).forEach((c) => {
      MATERIAL_CATEGORIES.push(presets.cloneMaterialCategory(c, sp.id));
    });
    (sp.productCategories || []).forEach((c) => {
      PRODUCT_CATEGORIES.push(presets.cloneProductCategory(c, sp.id));
    });
    presets.SPACE_UNITS.forEach((n, i) => {
      UNITS.push({ id: uid('u'), name: n, sort: i, categoryId: sp.id });
    });
    presets.SPACE_PLATFORMS.forEach((n, i) => {
      PLATFORMS.push({ id: uid('p'), name: n, sort: i, categoryId: sp.id });
    });
  });
  return {
    BUSINESS_CATEGORIES: presets.SPACES.map((sp) => ({
      id: sp.id, name: sp.name, sort: sp.sort, createdAt: util.today()
    })),
    MATERIAL_CATEGORIES, PRODUCT_CATEGORIES, UNITS, PLATFORMS
  };
}

// ===================== 出厂预设「补齐」（V150） =====================
//
// 为什么单独抽出来：**三处**都要做同一件事，而它们各自还有别的事要干 ——
//   ① `services/migrations.js`：老用户升级后补出 5 个空间与它们的分类；
//   ② `restoreFactoryPresets()`：用户点「恢复出厂预设」；
//   ③ `addBusinessCategory(name)`：用户手建一个叫「拼豆」的空间时，直接给它配上拼豆的预设。
// 三处各写一遍必然漂（V145 的教训：同一个语义写在两处，迁移那处漏改）。
//
// 判据（**只加不删、不动用户任何已有项**）：
//   · 认一条出厂分类是否已存在 —— **先按 id**，再按「同一个空间里同名的」。
//     （用户可能删了出厂的「花边」又自己建了一个「花边」，id 不同、名字相同 ⇒ 不能再来一条）
//   · 单位 / 平台的 id 是随机生成的（uid）⇒ 只能按「同一空间 + 同名」认。
//
// 返回：{ materials: n, products: n, units: n, platforms: n } —— 加了几条（供调用方报数）
function seedSpacePresets(spaceId, factorySpace) {
  const added = { materials: 0, products: 0, units: 0, platforms: 0 };
  if (!spaceId || !factorySpace) return added;

  const addMissing = (key, want, byNameOnly, counter) => {
    const list = get(key, []);
    const ids = {};
    const names = {};
    list.forEach(function (x) {
      if (!x) return;
      if (x.id) ids[x.id] = true;
      names[String(x.categoryId || '') + '\u0000' + String(x.name || '')] = true;
    });
    want.forEach(function (it) {
      if (!byNameOnly && it.id && ids[it.id]) return;                       // id 已在（改名也认得出）
      if (names[String(it.categoryId || '') + '\u0000' + String(it.name || '')]) return;  // 同名已在
      list.push(it);
      added[counter]++;
    });
    set(key, list);
  };

  const cloneM = presets.cloneMaterialCategory;
  const cloneP = presets.cloneProductCategory;
  // ⚠️ 装到**不是它出厂归属的那个空间**时，分类 id 要按空间派生一个新的。
  //   为什么：id 全项目唯一（配置列表是"一张大表 + 按空间过滤"）。
  //   用户在「分类管理」里手建一个叫「拼豆」的空间时，`mc_perler_bead` 已经被
  //   出厂空间 bc_perler 占着 —— 直接用就会重号（find() 会取到另一条），
  //   而"看到 id 已存在就跳过"又等于新空间白建（一条都不给）。
  //   派生是**确定性**的（空间 id 拼后缀）⇒ 重跑能得到同一个 id，幂等不受影响。
  const own = (spaceId === factorySpace.id);
  const mid = function (c) { return own ? '' : (c.id + '_' + spaceId); };
  addMissing(KEYS.MATERIAL_CATEGORIES,
    (factorySpace.materialCategories || []).map(function (c) { return cloneM(c, spaceId, mid(c)); }),
    false, 'materials');
  addMissing(KEYS.PRODUCT_CATEGORIES,
    (factorySpace.productCategories || []).map(function (c) { return cloneP(c, spaceId, mid(c)); }),
    false, 'products');
  addMissing(KEYS.UNITS,
    presets.SPACE_UNITS.map(function (n, i) { return { id: uid('u'), name: n, sort: i, categoryId: spaceId }; }),
    true, 'units');
  addMissing(KEYS.PLATFORMS,
    presets.SPACE_PLATFORMS.map(function (n, i) { return { id: uid('p'), name: n, sort: i, categoryId: spaceId }; }),
    true, 'platforms');
  return added;
}

// 确保某个出厂空间存在，并把它的预设补齐。
// **认空间的方式**：先按 id，再按名字 —— 用户可能已经自己建了一个叫「拼豆」的空间，
// 那就用他的那一个（补分类），而不是再建一个同名的（两个「拼豆」会让人分不清）。
// 返回：{ id, created, added }
function ensureSpaceWithPresets(factorySpace) {
  if (!factorySpace) return { id: '', created: false, added: null };
  const list = get(KEYS.BUSINESS_CATEGORIES, []);
  let item = list.filter(function (x) { return x && x.id === factorySpace.id; })[0]
          || list.filter(function (x) { return x && x.name === factorySpace.name; })[0];
  let created = false;
  if (!item) {
    item = { id: factorySpace.id, name: factorySpace.name, sort: list.length, createdAt: util.today() };
    list.push(item);
    set(KEYS.BUSINESS_CATEGORIES, list);
    created = true;
  }
  const added = seedSpacePresets(item.id, factorySpace);
  return { id: item.id, created: created, added: added };
}

// 恢复出厂预设（不动任何业务数据）：把**被删掉的出厂项**按 id / 同名补回来。
// 场景：用户删了预设或手作空间后，不用清空数据也能一键找回。
//
// ⚠️ V150 重写：**页面上的确认文案是这么写的** ——
//   「会把**被删掉的默认手作空间、物料分类、单位、平台**等预设补回来」。
//   而原实现只在整个列表**为空**时才回填 ⇒ 删了其中一条，点恢复是没反应的。
//   单空间时代差别小（当年的报障就是"全删光了"），V150 起了 5 个空间之后会天天撞见
//   ⇒ 改成"按 id / 同名逐条补缺失的出厂项"，才对得上它对用户许的诺。
function restoreFactoryPresets() {
  const restored = [];
  const seen = {};
  const note = (label) => { if (!seen[label]) { seen[label] = true; restored.push(label); } };

  presets.SPACES.forEach(function (sp) {
    const r = ensureSpaceWithPresets(sp);
    if (r.created) note('手作空间');
    if (r.added) {
      if (r.added.materials) note('物料分类预设');
      if (r.added.products) note('成品品类预设');
      if (r.added.units) note('单位预设');
      if (r.added.platforms) note('平台预设');
    }
  });

  if (!get(KEYS.SETTINGS, null)) set(KEYS.SETTINGS, { defaultUnit: '个', defaultThreshold: 5 });
  // 全局选中项校正：当前空间不存在则回到默认（不发广播）
  const cur = state.getCurrentSpace();
  if (!get(KEYS.BUSINESS_CATEGORIES, []).find(x => x.id === cur)) state.init(presets.DEFAULT_SPACE_ID);
  return { restored: restored };
}

function ensureSeed() {
  if (get(KEYS.SEEDED, false)) return;
  const presets = buildDefaultPresets();
  set(KEYS.BUSINESS_CATEGORIES, presets.BUSINESS_CATEGORIES);
  set(KEYS.MATERIAL_CATEGORIES, presets.MATERIAL_CATEGORIES);
  set(KEYS.PRODUCT_CATEGORIES, presets.PRODUCT_CATEGORIES);
  set(KEYS.UNITS, presets.UNITS);
  set(KEYS.PLATFORMS, presets.PLATFORMS);
  set(KEYS.MATERIAL_ATTRS, []);
  set(KEYS.PRODUCT_ATTRS, []);
  set(KEYS.SETTINGS, { defaultUnit: '个', defaultThreshold: 5 });
  set(KEYS.MATERIALS, []);
  set(KEYS.PRODUCTS, []);
  set(KEYS.FLOWS, []);
  set(KEYS.INSPIRATIONS, []);
  set(KEYS.WANTS, []);
  set(KEYS.COMMISSIONS, []);
  set(KEYS.SNAPSHOTS, []);
  set(KEYS.SEEDED, true);
}

// 数据迁移：实现收拢进 services/migrations.js（Day 5 任务 5.2），本函数只做依赖注入。
// 每次启动都执行（内部有 schema 版本门：已是最新版本则一次读短路；各步骤另有幂等守卫）。
// 注意：必须在 ensureSeed() 之外调用，否则对已初始化过的老用户（SEEDED=true）永远不生效。
function runMigrations() {
  return migrations.runAll({
    getListAll: getListAll,
    stockValue: stockValue,
    isMaterialFabric: isMaterialFabric,
    getMaterial: getMaterial,
    addFlow: addFlow,
    ATTR_PRESETS: ATTR_PRESETS,
    // V145：材质预设"补齐"用（改出厂值只对新装生效，老数据靠迁移补）
    MATERIAL_PRESET_ADDITIONS: MATERIAL_PRESET_ADDITIONS,
    // V150：手作空间与出厂预设"补齐"用。
    // ⚠️ 这里注入的是**函数**（不是数据）—— 因为补预设要同时写 4 个存储集合，
    //    而那件事只有 store 该干（迁移模块只依赖叶子模块，见 migrations.js 文件头）。
    ensureSpaceWithPresets: ensureSpaceWithPresets,
    LIST_TYPES: LIST_TYPES
  });
}

/* ===================== 库存总值流水化（Day 2 核心改造） ===================== */
//
// 改造前：totalValue 是手工维护的字段，散落在 26 处赋值。任何一条路径漏改，
//         库存总值就会静默漂移 → unitCost（均价）失真 → 全部成本与利润全错。
// 改造后：totalValue 由**流水派生**，收口到唯一入口（addFlow 末尾）。
//         26 处手工赋值全部删除 —— 让"漏改"在结构上不可能发生。
//
// 历史数据的处理（重要）：
//   老数据的 totalValue 是早期的迁移函数按「单价 × 库存」推算出来的，**未必有流水支撑**。
//   若直接按流水重算，用户看到的库存总值会凭空变化 —— 这是不可接受的。
//   因此采用会计上的标准做法：**生成一条"期初校准"流水把差额补上**。
//   效果：用户看到的数字**分毫不变**，同时流水与总值从此完全对齐，且校准本身有留痕。

// 由流水重算某物料的库存总值（唯一收口点）
// 返回 null 表示无需改动；否则返回新的总值
function syncTotalValueFromFlows(materialId) {
  if (!materialId) return null;
  const list = get(KEYS.MATERIALS, []);
  if (!Array.isArray(list)) return null;
  const i = list.findIndex(function (x) { return x && x.id === materialId; });
  if (i < 0) return null;

  const derived = valuation.deriveTotalValue(materialId, get(KEYS.FLOWS, []));
  const cached = util.round(Number(list[i].totalValue) || 0, 2);
  if (cached === derived) return null;   // 已一致，不写（避免无谓的整表写入）

  list[i] = Object.assign({}, list[i], { totalValue: derived });
  set(KEYS.MATERIALS, list);
  return derived;
}

/* ===================== 登录（M1-01） ===================== */
// 本机身份：无云端时的兜底。**换手机/卸载重装会变成另一串码** ——
// 所以它不能用于"云端备份归属"（详见 ensureRealOpenid 注释）。
function getOpenid() {
  let id = get(KEYS.OPENID, '');
  if (!id) {
    id = uid('oid');
    set(KEYS.OPENID, id);
  }
  return id;
}

/* ===================== 真实微信身份（云备份的地基 · P1） =====================
 * 为什么必须换：本机随机码 `oid_xxx` 藏在手机里，换手机 / 卸载重装就变成新的，
 * 云端按它存备份 → 新手机查新码 → **认不出自己的备份**（方案直接失效）。
 * 真实 openid 跟着微信账号走，换机、重装都不变。
 *
 * 取法：云函数 `getOpenid` 里的 `cloud.getWXContext().OPENID`（服务端拿，最安全，
 *      小程序端自己取需要密钥，绝不能放前端）。
 *
 * 三条硬约束：
 *   ① **不阻塞**：异步获取，失败也不影响任何本地功能
 *   ② **优雅回退**：云不可用 / 云函数异常 / 没返回 → 保持本机身份，照常使用
 *   ③ **不写脏值**：只有拿到非空 openid 才落盘，避免把 undefined 存成身份
 */
function ensureRealOpenid() {
  const cached = get(KEYS.REAL_OPENID, '');
  if (cached) return Promise.resolve(cached);        // 已升级过，直接用（省一次云调用）

  if (!cloud.isReady()) return Promise.resolve(getOpenid());   // 云不可用 → 纯本地模式

  return cloud.callFunction('getOpenid', {})
    .then(function (res) {
      const openid = res && res.openid;
      if (!openid) throw { code: 'no-openid', msg: '云函数未返回 openid' };
      set(KEYS.REAL_OPENID, openid);   // 记下"已升级"
      set(KEYS.OPENID, openid);        // 覆盖本机随机码 → 此后一律用真实身份
      return openid;
    })
    .catch(function (e) {
      console.error('[store] 获取真实 openid 失败，保持本机身份（功能不受影响）：', e);
      return getOpenid();
    });
}

/* ===================== 手作空间（M1-17） ===================== */
function getBusinessCategories() { return get(KEYS.BUSINESS_CATEGORIES, []); }
function addBusinessCategory(name) {
  const list = getBusinessCategories();
  const item = { id: uid('bc'), name: name, sort: list.length, createdAt: util.today() };
  list.push(item); set(KEYS.BUSINESS_CATEGORIES, list);
  // V150：用户手建的空间如果**叫得出厂空间的名字**（拼豆 / 粘土 / 钩织 / 串珠 / 缝纫），
  // 就直接给它配上那一套出厂预设 —— 否则会得到一个空空间，用户还得自己一条条建分类。
  // ⚠️ 只在"新建"这一步做；以后**改名**到这些名字不会触发（不然改个名就冒出十几个分类，
  //    比空着更吓人）。用户想手动要预设，用「设置-数据体检-恢复出厂预设」。
  const factorySpace = presets.spaceByName(name);
  if (factorySpace) seedSpacePresets(item.id, factorySpace);
  return item;
}
function updateBusinessCategory(id, name) {
  const list = getBusinessCategories(); const i = list.findIndex(x => x.id === id);
  if (i >= 0) { list[i].name = name; set(KEYS.BUSINESS_CATEGORIES, list); }
}

// ---- 主题（V97）：主题挂在手作空间上，所以「换大类 = 换主题」 ----
//
// 为什么不需要数据迁移：**缺 theme 字段就是默认主题**。
//   老数据里没有这个字段，读出来就是默认主题 —— 不写迁移脚本、不回填、不假装有。
//   写入侧也不用给每个大类补默认值（避免出现"两套表达同一件事"）。
function getBusinessCategoryTheme(id) {
  const it = getBusinessCategories().find(x => x.id === id);
  const key = it && it.theme;
  return themes.has(key) ? key : themes.DEFAULT;   // 存坏了 / 被删了 → 兜底回默认
}

function setBusinessCategoryTheme(id, themeKey) {
  const list = getBusinessCategories();
  const i = list.findIndex(x => x.id === id);
  if (i < 0) return false;
  const key = themes.has(themeKey) ? themeKey : themes.DEFAULT;
  if (list[i].theme === key) return false;         // 没变就静默返回，别做无意义的写盘+广播
  list[i].theme = key;
  set(KEYS.BUSINESS_CATEGORIES, list);
  return true;
}

// 当前空间（手作空间）用的主题 key
function currentTheme() {
  return getBusinessCategoryTheme(state.getCurrentSpace());
}
function removeBusinessCategory(id) {
  set(KEYS.BUSINESS_CATEGORIES, getBusinessCategories().filter(x => x.id !== id));
  set(KEYS.MATERIALS, getMaterials().filter(x => x.categoryId !== id));
  set(KEYS.PRODUCTS, getProducts().filter(x => x.categoryId !== id));
  set(KEYS.FLOWS, getFlows().filter(x => x.categoryId !== id));
  set(KEYS.INSPIRATIONS, get(KEYS.INSPIRATIONS, []).filter(x => x.categoryId !== id));
  set(KEYS.WANTS, get(KEYS.WANTS, []).filter(x => x.categoryId !== id));
  set(KEYS.COMMISSIONS, get(KEYS.COMMISSIONS, []).filter(x => x.categoryId !== id));
  // 配置型列表（按空间隔离，整空间删除时一并清除）
  Object.keys(LIST_TYPES).forEach(type => {
    set(LIST_TYPES[type].key, getListAll(type).filter(x => x.categoryId !== id));
  });
  // 损耗记录与趋势快照（按空间隔离）
  set(KEYS.CONSUMABLES, get(KEYS.CONSUMABLES, []).filter(x => x.categoryId !== id));
  set(KEYS.ASSETS, get(KEYS.ASSETS, []).filter(x => x.categoryId !== id));
  set(KEYS.TOOLS, get(KEYS.TOOLS, []).filter(x => x.categoryId !== id));
  set(KEYS.SNAPSHOTS, get(KEYS.SNAPSHOTS, []).filter(x => x.categoryId !== id));
  // 若删除的是当前选中的手作空间，回退到第一个剩余空间，避免全局状态悬空
  let fallback = 'bc_default';
  // 若删除的是当前选中的手作空间，回退到第一个剩余空间，避免全局状态悬空。
  // （经 services/state.js 统一设置 —— setCurrentSpace 会广播，让栈内页面立即刷新）
  if (state.getCurrentSpace() === id) {
    const rest = getBusinessCategories();
    fallback = rest.length ? rest[0].id : 'bc_default';
    state.setCurrentSpace(fallback);
  }
  return fallback;
}

/* ===================== 通用列表型配置（属性管理） ===================== */
const LIST_TYPES = {
  materialCategory: { key: KEYS.MATERIAL_CATEGORIES, label: '物料分类' },
  materialAttr: { key: KEYS.MATERIAL_ATTRS, label: '物料自定义属性' },
  productAttr: { key: KEYS.PRODUCT_ATTRS, label: '成品自定义属性' },
  productCategory: { key: KEYS.PRODUCT_CATEGORIES, label: '品类' },
  unit: { key: KEYS.UNITS, label: '单位预设' },
  platform: { key: KEYS.PLATFORMS, label: '排单平台预设' }
};
// 配置型列表：默认返回「当前手作空间」自己的数据（按大类隔离）；getListAll 返回全量（用于导出/迁移/跨空间查找）
function getList(type, categoryId) {
  const cid = categoryId || currentSpace();
  return get(LIST_TYPES[type].key, []).filter(x => x.categoryId === cid);
}
function getListAll(type) { return get(LIST_TYPES[type].key, []); }
function saveListItem(type, item) {
  const list = getListAll(type);
  item.categoryId = item.categoryId || currentSpace();
  if (item.id) {
    const i = list.findIndex(x => x.id === item.id);
    if (i >= 0) list[i] = Object.assign(list[i], item);
  } else {
    item.id = uid(type.slice(0, 2));
    item.sort = list.length;
    list.push(item);
  }
  set(LIST_TYPES[type].key, list);
  return item;
}
function removeListItem(type, id) { set(LIST_TYPES[type].key, getListAll(type).filter(x => x.id !== id)); }

// 「删掉这条分类后，引用它的对象该归到哪」—— 答案是**同一个手作空间里的「其他」**。
//
// ⚠️ V150 修（这次的改动把它暴露出来的）：原实现把目标写死成 `'pc_other'` / `'mc_other'` ——
//   那是**缝纫空间**的 id。单空间时代看不出问题；V150 起了 4 个新空间之后，
//   在「拼豆」里删一个分类，珠子的子分类会被指到**缝纫空间的 mc_other**
//   ⇒ 在拼豆里显示成"未分类/空白"，而缝纫空间那边平白多出一条分类。
//   一句话：**「其他」是每个空间各自的，不能全项目共用一条**。
//
// 认的办法（按可靠度排序）：同空间里名字叫「其他」的 → 同空间里 id 以 `_other` 结尾的
//   → 都没有就**当场建一条「其他」**。
//   ⚠️ 刻意**没有**"退到本空间任意一条"这一步：那会把引用它的东西静默塞进一个**无关的分类**
//      （钥匙扣悄悄变成"冰箱贴"）—— 比留空更难发现。宁可建一条「其他」。
//   ⚠️ 为什么要建：删除前的确认文案对用户写的是「将归入**其他（未分类）**」，
//      得让这句话成立 —— 留一个悬空引用（分类名显示不出来）等于没兑现。
function fallbackCategoryIdOf(type, fromId) {
  const meta = LIST_TYPES[type];
  if (!meta) return '';
  const list = get(meta.key, []);
  const src = list.filter(x => x && x.id === fromId)[0];
  const spaceId = (src && src.categoryId) || currentSpace();
  const inSpace = list.filter(x => x && x.categoryId === spaceId && x.id !== fromId);
  const other = inSpace.filter(x => String(x.name || '') === '其他')[0];
  if (other) return other.id;
  const tail = inSpace.filter(x => /_other$/.test(String(x.id || '')))[0];
  if (tail) return tail.id;
  // 这一条空间里已经不剩叫「其他」的分类（用户把它也删了）⇒ 建回来，保证引用不悬空
  const created = {
    id: (type === 'productCategory' ? 'pc_other_' : 'mc_other_') + uid('x'),
    name: '其他', categoryId: spaceId, sort: (list.length || 0), attrDimensions: []
  };
  if (type === 'productCategory') { created.packaging = 1.5; created.shipping = 5.0; created.targetProfit = 0.5; }
  else created.defaultUnit = '个';
  list.push(created);
  set(meta.key, list);
  return created.id;
}

// 删除被引用的品类时，将其引用对象归入「其他（未分类）」占位，避免孤儿引用（M-4 / M1-14）
function reassignProductCategoryRefs(fromId) {
  const toId = fallbackCategoryIdOf('productCategory', fromId);
  if (!toId) return;
  const ps = getProducts(); let changed = false;
  ps.forEach(p => { if (p.productCategoryId === fromId) { p.productCategoryId = toId; changed = true; } });
  if (changed) set(KEYS.PRODUCTS, ps);
}
function reassignMaterialCategoryRefs(fromId) {
  const toId = fallbackCategoryIdOf('materialCategory', fromId);
  if (!toId) return;
  const ms = getMaterials(); let changed = false;
  ms.forEach(m => { if (m.materialCategoryId === fromId) { m.materialCategoryId = toId; changed = true; } });
  if (changed) set(KEYS.MATERIALS, ms);
}

/* ===================== 基础设置（M1-15） ===================== */
function getSettings() { return get(KEYS.SETTINGS, { defaultUnit: '个', defaultThreshold: 5 }); }
function saveSettings(s) { set(KEYS.SETTINGS, Object.assign(getSettings(), s)); }

/* ===================== 物料库（M1-02~M1-05, M1-08） ===================== */
// 热路径：每天被列表/搜索/统计调用成百上千次。
// 迁移检查已移出（Day 5 任务 5.1）—— 迁移统一在 app.onLaunch 的 runMigrations() 里跑一次。
function getMaterials() { return get(KEYS.MATERIALS, []); }
function getMaterial(id) { return getMaterials().find(x => x.id === id); }

// 判断物料是否为面料 —— **只认分类上的显式标记**（V127 · 2026-10-09）
//
// 为什么删掉了原来的"名称兜底"（`if (name.includes('面料')) return true`）：
//   用户拍板的原则是「预置分类就那么几个，面料勾上、其余不勾就完了；
//   用户自己加分类时自己选就可以了，**哪里需要系统自己去匹配**」。
//   ⇒ 名字不是证据，标记才是。按名字猜的代价已经付过一次：
//     `services/migrations.js` 里那条同源规则写成"含'布'也算"，把**布标**打成了面料。
//   现状可支撑这个精简：种子 `mc_fabric` **自第一版快照起**就带 `isFabric: true`，
//   其余分类显式缺省（false）；用户自建分类默认 false、并可在
//   「预设设置 → 物料分类 → 面料类」自己勾 ⇒ 没有任何正当数据依赖名字兜底。
function isMaterialFabric(m) {
  if (!m || !m.materialCategoryId) return false;
  // 用 getListAll：isMaterialFabric 是纯分类器，可能被任意空间的物料调用（如导出/跨空间核算），不应受当前展示空间限制
  const mc = getListAll('materialCategory').find(c => c.id === m.materialCategoryId);
  return !!(mc && mc.isFabric);
}

// 展示用单位：内部按批估量单位 'piece' 统一显示为「片」，重量单位 kg/g 原样显示
// 说明：底层存储仍保留 'piece' | 'kg' | 'g' 原值，仅在展示层做转换，避免历史数据迁移
function displayUnit(u) {
  if (u === 'piece') return '片';
  return u || 'kg';
}

// 根据层级属性 + 关键词生成物料名称
function buildMaterialName(attrGroups, keywords) {
  const parts = (attrGroups || []).filter(g => g && String(g.value || '').trim()).map(g => String(g.value).trim());
  const kw = (keywords || '').trim();
  if (kw) parts.push(kw);
  return parts.join('');
}

// 检查物料名称是否重复
function isNameDuplicate(name, excludeId) {
  const n = String(name || '').trim();
  if (!n) return false;
  return getMaterials().some(m => m.name === n && m.id !== excludeId);
}

// 把本地临时图片持久化到用户文件目录
// Day 4 加固（任务 4.1/4.5 + 兜底审计 P2-2）：
//   1. 保存前压缩（quality 70 + 长边限 1280）—— 单张 ~100KB 量级，200MB 能装更多张
//   2. 容量预检 —— 剩余空间放不下一张典型照片时直接拒绝并说清原因，
//      不再是"每张都失败、只提示保存失败"的静默黑洞
// 存图成功后顺手排进「图片上云」队列（P4）。
// ⚠️ 绝不能影响保存结果：云没配好、队列异常，都只是"少同步一次"，
//    而"图没存上"是用户不可接受的 —— 所以整体包在 try 里，且只传文件名不传路径。
function notifyPhotoSync(filePath) {
  try {
    // 延迟 require：避免加载期与 services 成环
    const photoSync = require('../services/photo-sync.js');
    const name = String(filePath || '').split('/').pop();
    if (name) photoSync.enqueue(name);
  } catch (e) {
    console.error('[store] 图片入同步队列失败（不影响保存）：', e);
  }
}

function savePhoto(tempPath) {
  return image.compressPhoto(tempPath).then((src) => {
    return image.hasRoomFor(image.RESERVED_BYTES).then((room) => {
      if (!room) {
        return Promise.reject({
          code: 'DISK_FULL',
          msg: '本小程序的图片与备份文件空间快满了（上限 ' + Math.round(image.USER_FILE_LIMIT / 1024 / 1024) + ' MB），请先删掉不用的图片，或在「我的-备份与恢复」查看用量'
        });
      }
      return new Promise((resolve, reject) => {
        const fs = wx.getFileSystemManager();
        const ext = tempPath.match(/\.\w+$/) ? tempPath.match(/\.\w+$/)[0] : '.jpg';
        const dest = `${wx.env.USER_DATA_PATH}/photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
        fs.saveFile({
          tempFilePath: src,
          filePath: dest,
          success: () => { notifyPhotoSync(dest); resolve(dest); },
          fail: reject
        });
      });
    });
  });
}

// 面料库存总面积（在库布片）
function fabricArea(material) {
  return util.round((material.pieces || []).filter(p => p.status === 'in').reduce((s, p) => s + p.area, 0), 2);
}
function fabricCount(material) {
  return (material.pieces || []).filter(p => p.status === 'in').length;
}
// 物料当前库存（面料=总面积cm²，非面料=quantity；batch 面料=批次剩余量 kg/片）
function stockValue(material) {
  if (isMaterialFabric(material)) {
    if (material.stockMode === 'batch') return material.batchRemain || 0;
    return fabricArea(material);
  }
  return material.quantity || 0;
}
// ============ 流水展示口径（唯一收口点）============
// 「物料出入库」页 / 物料详情页 / 数据导出 三处都要把流水的数量换算成可读的「数值 + 单位」。
// 收在一个函数里，避免三处各写一遍（历史教训：同一口径散在多处，改一处漏两处）。
//
// 返回 { isArea, unit, qty, balance }：
//   · 面积类（面料按片）：单位按临界值自动选 cm² / m²（util.areaAuto），
//     且**同一行「变动量」与「结余」用同一个单位** —— 否则一行里两个数不同口径，没法互相印证
//   · 刀口布（按批估量）：按自身单位（kg / 片）
//   · 其余：按流水自带的 unit，缺了才回退到物料单位
function flowDisplay(flow) {
  const f = flow || {};
  const m = f.materialId ? getMaterial(f.materialId) : null;
  const fabric = !!(m && isMaterialFabric(m));
  const isBatch = f.priceMode === 'byBatch' || (f.priceMode == null && fabric && m.stockMode === 'batch');
  let isArea = false;
  if (!isBatch) {
    if (f.priceMode === 'byArea') isArea = true;
    // 旧流水没有 priceMode：只有「面料且不是刀口布」才按面积 —— 刀口布按 kg/片算，误判会把数量当面积换算
    else if (f.priceMode == null) isArea = fabric && m.stockMode !== 'batch';
  }
  if (isArea) {
    const a = util.areaAuto(f.qty);            // 单位跟着「变动量」走，结余同单位
    const scale = a.unit === 'm²' ? 10000 : 1;
    return {
      isArea: true, unit: a.unit,
      qty: util.round((Number(f.qty) || 0) / scale, 4),
      balance: util.round((Number(f.balance) || 0) / scale, 4)
    };
  }
  return {
    isArea: false,
    unit: isBatch ? displayUnit(f.unit || m.batchUnit) : (f.unit || m.unit || ''),
    qty: util.round(Number(f.qty) || 0, 2),
    balance: util.round(Number(f.balance) || 0, 2)
  };
}

// 是否低库存
function isLowStock(material) {
  const threshold = material.threshold == null ? getSettings().defaultThreshold : material.threshold;
  return stockValue(material) <= threshold;
}

// 当前平均单价（每基准单位成本）：非面料 = 元/单位；面料 = 元/cm²
// 库存总值 totalValue 除以当前库存即可得到移动加权平均单价
function unitCost(material) {
  const stock = stockValue(material);
  if (stock <= 0) return 0;
  return util.round((material.totalValue || 0) / stock, 6);
}

// 物料展示口径（物料库列表 / 成品 BOM「选择物料」弹窗共用，保证两处文案完全一致）
// 返回 { isFabric, isBatch, unitSuffix, unitPrice, priceSeg, stockText, totalValue }
function materialBrief(material) {
  const fabric = isMaterialFabric(material);
  const isBatch = fabric && material.stockMode === 'batch';
  const batchUnit = displayUnit(material.batchUnit);
  const stock = stockValue(material);
  const unit = unitCost(material);
  // 单价：batch 面料直接取 batchUnitPrice（元/kg 或 元/片）；piece 面料 元/m²；非面料 元/单位
  const unitPrice = isBatch
    ? util.round(material.batchUnitPrice || 0, 2)
    : (fabric ? util.round(unit * 10000, 2) : util.round(unit, 4));
  const unitSuffix = isBatch ? batchUnit : (fabric ? 'm²' : (material.unit || '单位'));
  const stockText = isBatch
    ? (util.round(stock, 2) + batchUnit)
    : (fabric
      ? (util.areaToM2(fabricArea(material)) + ' m² · ' + fabricCount(material) + '片')
      : (util.round(stock, 2) + ' ' + (material.unit || '')));
  return {
    isFabric: fabric,
    isBatch,
    unitSuffix,
    unitPrice,
    priceSeg: '¥' + util.money(unitPrice) + '/' + unitSuffix,
    stockText,
    totalValue: util.round(material.totalValue || 0, 2)
  };
}

// 物料长按预览的数据准备（成品编辑页选物料时用）。
// 页面只负责「长按 → 取这份数据 → 渲染」，口径集中在此，便于单测与复用。
//
// ⚠️ 布片清单为什么限量：弹窗在**松手时自动关闭**，用户没有机会滚动。
//    所以不能把全部布片都塞进去（20 片就溢出屏幕且滚不了）——
//    只列最大的前 N 片 + 汇总行（共几片 / 整布几片 / 碎料几片）。
// ⚠️ 布片清单与属性都要限量：弹窗在**松手时自动关闭**，用户没有机会滚动。
//    所以不能把全部内容都塞进去 —— 内容一高，卡片就会超出弹层、被 overflow:hidden 从底部裁掉，
//    而底部正好是布片清单（本功能最有价值的部分）。限量 = 内容高度可控。
const PREVIEW_PIECE_LIMIT = 6;

// ---- 无图占位（2026-10-04 V112）----
// 没上传照片的物料，用「物料名第一个字 + 物料分类色」占位 —— 与物料列表、看板、
// 成品列表**完全同一套口径**（用户原话「就用物料详情里的这个」，指的就是列表里那张「粉」字方块）。
//
// 为什么要抽成函数而不是各处各写：这三四个页面都在算同一件事，
// 各自写一遍就迟早会走偏（某一个漏了分类色 / 换了首字规则，用户看到的不一致又要去报）。
// 📌 判断句：**"同一个视觉规则出现在 ≥2 个地方"就该抽成一处**（本项目的老教训是抽晚了）。
//
// 找不到分类时的兜底色 = 列表里那个「其他」色（#DED3C0），保持一致。
function materialThumb(material) {
  const m = material || {};
  const photo = (m.photos || [])[0] || '';
  const list = getList('materialCategory');
  const mc = list.find(c => c.id === m.materialCategoryId);
  const cc = palette.colorOf(list, m.materialCategoryId, 0);
  return {
    photo: photo,
    placeholder: (m.name || '物').slice(0, 1),
    // 分类色：与物料列表 cards 完全同一口径（palette.colorOf → bg / inkSoft）
    color: cc.bg,
    ink: mc ? cc.inkSoft : 'rgba(138,122,92,0.5)'
  };
}
const PREVIEW_ATTR_LIMIT = 4;

function materialPreview(material) {
  if (!material || !material.id) return null;   // 骨架对象不给渲染，避免页面拿到半成品
  const br = materialBrief(material);
  const fabric = br.isFabric;
  const isBatch = br.isBatch;
  const mc = getList('materialCategory').find(c => c.id === material.materialCategoryId);

  // 规格属性：新结构 attrGroups 优先，旧数据回落 attrs（与迁移前的物料兼容）
  // key 用下标生成 —— 维度名可能重复（如两行「颜色」），拿 label 当 wx:key 会撞
  const attrsAll = [];
  (material.attrGroups || []).forEach(g => {
    if (!g) return;
    const label = String(g.dimension || '').trim();
    const value = (g.value == null) ? '' : String(g.value).trim();
    if (label || value) attrsAll.push({ label, value });
  });
  if (!attrsAll.length && material.attrs) {
    Object.keys(material.attrs).forEach(k => {
      const v = material.attrs[k];
      if (v == null || v === '') return;
      attrsAll.push({ label: k, value: String(v) });
    });
  }
  const attrs = attrsAll.slice(0, PREVIEW_ATTR_LIMIT).map((a, i) => Object.assign({ key: 'at' + i }, a));
  const attrsHidden = Math.max(0, attrsAll.length - attrs.length);

  // 尺寸：面料给幅宽（裁剪时的宽度上限）；非面料没有这一项
  const sizeLine = (fabric && material.fabricWidth) ? ('幅宽 ' + material.fabricWidth + 'cm') : '';

  let stockDetail = '';
  let pieces = [];
  let piecesTotal = 0, piecesHidden = 0, wholeCount = 0, offcutCount = 0;

  if (fabric && !isBatch) {
    const fw = material.fabricWidth;
    const inPieces = (material.pieces || []).filter(p => p.status === 'in');
    piecesTotal = inPieces.length;
    inPieces.forEach(p => { if (isPieceOffcut(p, fw)) offcutCount++; else wholeCount++; });
    if (piecesTotal) stockDetail = '整布 ' + wholeCount + ' 片 · 碎料 ' + offcutCount + ' 片';

    pieces = inPieces.slice()
      .sort((a, b) => (Number(b.area) || 0) - (Number(a.area) || 0))   // 面积大的在前
      .slice(0, PREVIEW_PIECE_LIMIT)
      .map((p, pi) => {
        const isOff = isPieceOffcut(p, fw);
        return {
          key: p.id || ('pp' + pi),   // 供 wx:key 用（老数据可能没有 id）
          length: util.round(Number(p.length) || 0, 0),
          width: util.round(Number(p.width) || 0, 0),
          tag: isOff ? '碎料' : '整布',
          isOffcut: isOff,
          areaM2: util.areaToM2(Number(p.area) || util.round((Number(p.length) || 0) * (Number(p.width) || 0), 2))
        };
      });
    piecesHidden = Math.max(0, piecesTotal - pieces.length);
  }

  return {
    id: material.id,
    name: material.name || '',
    categoryName: mc ? mc.name : '其他',
    isFabric: fabric,
    isBatch: isBatch,
    low: isLowStock(material),
    attrs,
    attrsHidden,
    priceSeg: br.priceSeg,
    sizeLine,
    stockText: br.stockText,
    stockDetail,
    pieces,
    piecesTotal,
    piecesHidden,
    wholeCount,
    offcutCount
  };
}

function saveMaterial(m) {
  if (!m.categoryId) m.categoryId = currentSpace();
  const list = getMaterials();
  const fabric = isMaterialFabric(m);
  // 规范化单位
  const mc = getList('materialCategory').find(c => c.id === m.materialCategoryId);
  m.unit = m.unit || (mc && mc.defaultUnit) || '个';
  // 兼容：保留旧字段，但新逻辑以大类为准
  m.isFabric = fabric;
  if (fabric && !m.stockMode) m.stockMode = 'piece'; // 旧面料默认按片精确
  // 按批估量（刀口布）：库存以 batchRemain 计量，不保留 pieces；单价口径为元/kg 或 元/片
  if (m.stockMode === 'batch') { m.pieces = []; m.priceMode = 'byBatch'; }
  else m.priceMode = fabric ? 'byArea' : 'each';
  if (!m.attrGroups && m.attrs) {
    m.attrGroups = Object.keys(m.attrs).map(k => ({ dimension: k, value: m.attrs[k] }));
  }
  if (!m.photos) m.photos = [];
  if (m.keywords == null) m.keywords = '';
  if (m.id) {
    const i = list.findIndex(x => x.id === m.id);
    if (i >= 0) list[i] = m; else list.push(m);
  } else {
    m.id = uid('m');
    m.createdAt = util.today();
    list.push(m);
  }
  m.updatedAt = util.today();
  set(KEYS.MATERIALS, list);
  return m;
}

// 删除物料：若被成品 BOM 引用则拦截
function removeMaterial(id) {
  const refs = getProducts().filter(p => (p.bom || []).some(b => b.materialId === id));
  if (refs.length > 0) {
    throw { code: 'REFERENCED', msg: '该物料已被 ' + refs.length + ' 个成品引用，请先解除引用后再删除', refs };
  }
  set(KEYS.MATERIALS, getMaterials().filter(x => x.id !== id));
  set(KEYS.FLOWS, getFlows().filter(x => x.materialId !== id));
}

// ============ 布料几何模型（2026-09-29 V81 / D88~D97）============
//
// 一条布片记录 = **一块布**（不再是"一个矩形"）。结构：
//   · base        外框 {x,y,length,width}（入库时就是这块矩形；裁过之后仍是外框）
//   · holes       已经裁走的矩形列表（挖料 = 往这里加一个矩形，**不需要重新拆分余料**）
//   · area        **可用面积**，账上的权威值（库存面积口径，与旧模型逐 cm² 一致）
//   · length/width = 外框尺寸（页面"这块布多大"显示用）
//
// 铁律：**裁剪永远不拆块**。一块布裁过之后还是不规则的一整块；
//       只有「重新入库」或「用户明确要求拆开」才会多出一块（用户 D96）。
//
// 老数据（只有 length/width、没有 base）由 asSheet 在读取时当作矩形布处理 ——
// 所以**没跑迁移也不会崩、面积也不会变**（迁移只负责把被拆开的多片合回一块）。
// 布片快照：**必须含形状**（base / holes）。
// 少了形状，撤销 / 还原就会"缺口凭空消失" —— 2026-10-01 审计查实的真 bug，V95 修。
function pieceSnapshot(p) {
  if (!p) return null;
  return {
    id: p.id,
    base: p.base ? { x: p.base.x, y: p.base.y, length: p.base.length, width: p.base.width } : null,
    holes: (p.holes || []).map(h => ({ x: h.x, y: h.y, length: h.length, width: h.width })),
    cuts: p.cuts || 0,
    length: p.length, width: p.width, area: p.area,
    isOffcut: p.isOffcut, source: p.source,
    origin: p.origin || null, createdAt: p.createdAt, status: 'in'
  };
}

// 从快照还原一块布。
// 形状优先用快照里的 base / holes；**老快照（V95 以前）没有形状** ⇒ 退化成矩形，
// 但那是"退化的"，不是真的 —— 所以只用于兜底，界面上要能看出是历史记录。
function pieceFromSnapshot(snap) {
  if (!snap || !snap.id) return null;
  const hasShape = !!(snap.base && Number(snap.base.length) > 0 && Number(snap.base.width) > 0);
  const base = hasShape
    ? {
        x: Number(snap.base.x) || 0, y: Number(snap.base.y) || 0,
        length: util.round(snap.base.length, 2), width: util.round(snap.base.width, 2)
      }
    : { x: 0, y: 0, length: util.round(snap.length, 2) || 0, width: util.round(snap.width, 2) || 0 };
  const out = {
    id: snap.id, base: base,
    holes: hasShape ? (snap.holes || []).map(h => ({ x: h.x, y: h.y, length: h.length, width: h.width })) : [],
    cuts: hasShape ? (snap.cuts || 0) : 0,
    length: base.length, width: base.width,
    area: util.round(snap.area, 2),
    source: snap.source || 'manual', status: 'in',
    isOffcut: !!snap.isOffcut, createdAt: snap.createdAt
  };
  if (snap.origin) out.origin = snap.origin;
  // 老快照没有形状 → 打个标，界面/导出能如实说"这是历史记录"
  if (!hasShape) out.origin = snap.origin || origin.mk({ materialId: '', way: 'legacy', area: out.area });
  return out;
}

function asSheet(p) {
  if (!p) return null;
  if (p.base && Number(p.base.length) > 0 && Number(p.base.width) > 0) {
    return { base: p.base, holes: (p.holes || []).slice(), cuts: p.cuts || 0 };
  }
  const l = util.round(p.length, 2), w = util.round(p.width, 2);
  if (!(l > 0) || !(w > 0)) return null;
  return { base: { x: 0, y: 0, length: l, width: w }, holes: [], cuts: 0 };
}

// 按「挖掉若干矩形」造出这块布的**新状态**（其余字段照旧）
function cutSheetPiece(piece, rects, fabricWidth) {
  const sh = asSheet(piece);
  if (!sh) return null;
  const list = (rects || []).filter(Boolean);
  const holes = sh.holes.concat(list);
  const shape = { base: sh.base, holes: holes, cuts: sh.cuts + list.length };
  return Object.assign({}, piece, {
    base: shape.base, holes: holes, cuts: shape.cuts,
    length: sh.base.length, width: sh.base.width,
    area: sheets.freeArea(shape),
    isOffcut: fabricWidth ? !sheets.keepsFullWidth(shape, fabricWidth) : false
  });
}

function mkPiece(length, width, source, fabricWidth, org) {
  const l = util.round(length, 2) || 0;
  const w = util.round(width, 2) || 0;
  const shape = { base: { x: 0, y: 0, length: l, width: w }, holes: [], cuts: 0 };
  const out = {
    id: uid('fp'),
    base: shape.base, holes: shape.holes, cuts: 0,
    length: l, width: w, area: util.round(l * w, 2),
    source: source, status: 'in',
    isOffcut: fabricWidth ? !sheets.keepsFullWidth(shape, fabricWidth) : false,
    createdAt: util.today()
  };
  // ⭐ V95：**每一块布都要有出处**（用户：「所有的布不管在哪里都要这样要求」）。
  //   不传 org 时补一条诚实的说明（"没记来源"），不许留空 —— 留空就等于事后谁也说不清。
  out.origin = origin.mk(org || { materialId: '', way: 'legacy', area: out.area, note: '入库时未记录来源' });
  return out;
}

// 一块布上挖一个「面积约等于 take」的矩形（贴边优先：整幅宽的横带 → 余料仍横跨幅宽）
function areaHole(shape, take) {
  const base = shape.base;
  let l = util.round(take / base.width, 2);
  if (!(l > 0)) l = 0.01;
  if (l > base.length) l = base.length;
  let w = util.round(take / l, 2);
  if (w > base.width) w = base.width;
  return sheets.placeNext(shape, l, w) || sheets.rect({ x: 0, y: 0, length: l, width: w });
}

// 面料裁剪扣减（**按面积**，给"只填了面积、没有形状"的行用）：
//   账上精确减去 area（p.area 是权威值）；同时挖一个近似形状的洞，让余料看起来也对。
function consumeFabricArea(material, area) {
  area = util.round(area, 2);
  if (area <= 0) throw { code: 'AREA', msg: '裁剪面积需大于0' };
  const inPieces = (material.pieces || []).filter(p => p.status === 'in');
  const total = util.round(inPieces.reduce((s, p) => s + (p.area || 0), 0), 2);
  if (total < area) throw { code: 'NOFABRIC', msg: '面料库存不足' };
  let remain = area;
  const replaced = {};       // pieceId → 挖过之后的新状态
  const gone = {};           // pieceId → 整块用完，丢弃
  const origins = [];        // ⭐ V95：这一笔**动了哪片布的哪个位置**，一处一记录
  // ① 优先"只动一块"：面积最小但够用的那块（与旧口径一致：紧配、不浪费大块）
  const fits = inPieces.filter(p => (p.area || 0) >= area - 0.01).sort((a, b) => a.area - b.area);
  const order = fits.length ? [fits[0]] : inPieces.slice().sort((a, b) => b.area - a.area);
  order.forEach(p => {
    if (remain <= 0) return;
    const take = Math.min(remain, p.area || 0);
    if (take <= 0) return;
    remain = util.round(remain - take, 2);
    const shape = asSheet(p);
    // ⚠️ 后面三条 early-return 都是"这一片整片没了"—— 必须带上**整片快照**，
    //    否则将来退料时还原不回来（片已经不在 pieces 里了）
    if (!shape) {
      gone[p.id] = true;
      origins.push(origin.mk({ materialId: material.id, pieceId: p.id, way: 'whole', area: take, pieceBefore: pieceSnapshot(p) }));
      return;
    }
    const hole = areaHole(shape, take);
    const next = cutSheetPiece(p, [hole], material.fabricWidth);
    if (!next) {
      gone[p.id] = true;
      origins.push(origin.mk({ materialId: material.id, pieceId: p.id, way: 'whole', area: take, pieceBefore: pieceSnapshot(p) }));
      return;
    }
    // ⭐ 面积按**账**精确减（形状只是近似：这条路径本来就没有形状信息）
    next.area = util.round((p.area || 0) - take, 2);
    if (next.area <= 0.005) {
      gone[p.id] = true;
      origins.push(origin.mk({ materialId: material.id, pieceId: p.id, way: 'whole', area: take, pieceBefore: pieceSnapshot(p) }));
      return;
    }
    next.isOffcut = material.fabricWidth ? !sheets.keepsFullWidth(next, material.fabricWidth) : false;
    replaced[p.id] = next;
    // ⭐ V95：这一刀挖在哪 —— 形状照实记，退料时要靠它**填回原来的位置**
    //    注意 area 记的是**账上扣的 take**（不是洞的近似面积），这样退回来金额分毫不差
    origins.push(origin.mk({ materialId: material.id, pieceId: p.id, way: 'area', rect: hole, area: take }));
  });
  const kept = [];
  (material.pieces || []).forEach(p => {
    if (p.status !== 'in') { kept.push(p); return; }      // 已出库的原样留着（历史记录）
    if (replaced[p.id]) { kept.push(replaced[p.id]); return; }
    if (gone[p.id]) return;                               // 用完了 → 丢弃
    kept.push(p);
  });
  material.pieces = kept;
  return { consumed: area, remnantAdded: Object.keys(replaced).length, origins: origins };
}

// 「按面积扣」的**逆操作**：把当初挖走的洞**填回去**（2026-10-02 V95，用户拍板「退料退回原洞」）。
//
// 为什么不造一块新料：造新料只能保证面积相等，**形状和位置是编的** —— 违背
// 「关联到它的形状和来自哪片布的哪个位置」。填回原洞才是真正的逆操作。
//
// 三级兜底（每一级都**如实标明**，不许假装）：
//   ① 片还在、洞还在   → 填回原洞（正常路径）
//   ② 片不在了但有快照 → 按快照把整片还原（bySnapshot）
//   ③ 都没有           → 放进 detached，由调用方另造一片并标 way='detach'
function restoreAreaOrigins(material, origins) {
  const list = origins || [];
  let restoredArea = 0, restoredHoles = 0;
  const detached = [];
  const stats = {};
  list.forEach((raw) => {
    const o = origin.mk(raw);
    if (!o.area) return;
    if (o.way === 'batch') { restoredArea = util.round(restoredArea + o.area, 2); return; }
    const idx = (material.pieces || []).findIndex(p => p.id === o.pieceId);
    if (idx < 0) {
      if (o.pieceBefore) {
        const back = pieceFromSnapshot(o.pieceBefore);
        if (back) {
          material.pieces = (material.pieces || []).concat(back);
          restoredArea = util.round(restoredArea + o.area, 2);
          stats.bySnapshot = (stats.bySnapshot || 0) + 1;
          return;
        }
      }
      detached.push(o);
      return;
    }
    const r = origin.rect(o.rect);
    if (!r) { restoredArea = util.round(restoredArea + o.area, 2); return; }   // 整片且片还在 → 无需填洞
    const p = material.pieces[idx];
    const sh = asSheet(p);
    if (!sh) { detached.push(o); return; }
    const holes = sh.holes.filter(h => !sheets.sameRect(h, r));
    if (holes.length === sh.holes.length) { detached.push(o); return; }        // 那个洞已经找不到了
    const next = Object.assign({}, p, {
      holes: holes,
      cuts: Math.max(0, (sh.cuts || 0) - 1),
      area: util.round((p.area || 0) + o.area, 2)
    });
    next.isOffcut = material.fabricWidth ? !sheets.keepsFullWidth(next, material.fabricWidth) : false;
    material.pieces[idx] = next;
    restoredArea = util.round(restoredArea + o.area, 2);
    restoredHoles += 1;
  });
  return { restoredArea: restoredArea, restoredHoles: restoredHoles, detached: detached, stats: stats };
}

// 判定一块布是否为碎布：**可用区域的宽还等不等于幅宽**（2026-09-29 D97 定稿）
//   裁掉一角 → 形状不规则，但宽仍 = 幅宽 ⇒ 整布（还能横着取整幅宽的长条）
//   沿长边裁窄了 ⇒ 碎布
function isPieceOffcut(piece, fabricWidth) {
  const fw = util.round(fabricWidth, 2);
  if (!(fw > 0)) return false;                  // 未设幅宽 → 不判定（按整布处理）
  const sh = asSheet(piece);
  if (!sh) {
    // 只有宽度的裸对象（老调用方 / 单测）：退回「宽 < 幅宽」的旧口径，不误标
    const w = util.round(piece && piece.width, 2);
    return w > 0 ? w < fw : false;
  }
  return !sheets.keepsFullWidth(sh, fw);
}
// 把一块布转成「页面上画得出来」的形状描述（纯函数，2026-09-30 V82）。
//
// 为什么需要它：V81 把数据改成了「外框 − 镂空」，但界面还在画示意插画
// （整布画卷筒、碎料画圆角矩形）—— 用户看到的不是这块布真实的形状，更看不到已有的缺口
// （用户真机反馈：「这块布应该左上角缺了一块，怎么没有显示出来？看起来还是一整块布啊」）。
//
// 返回 { base:{x,y,length,width}, holes:[…], area, used }，画不出来时返回 null。
//   · 坐标原点在**左下角**（内核约定）；页面用 CSS 的 bottom 定位即可，不必翻转坐标
//   · 给的是**原始 cm 尺寸**，缩放交给页面（这样别处也能复用，例如导出或打印）
//   · 老矩形片（没跑迁移的）直接当一块完整矩形 —— 兼容
function pieceShape(piece) {
  const sh = asSheet(piece);
  if (!sh) return null;
  const area = (piece && piece.area != null) ? util.round(piece.area, 2) : sheets.freeArea(sh);
  return {
    base: { x: sh.base.x, y: sh.base.y, length: sh.base.length, width: sh.base.width },
    holes: sh.holes.map(h => ({ x: h.x, y: h.y, length: h.length, width: h.width })),
    area: area,
    used: sh.holes.length > 0 || (sh.cuts || 0) > 0
  };
}

// 页面用：算「这个剪裁区摆在这块布上」的绿红拆分（纯读，不改数据）。
// green = 这块料在布上确实存在的部分；red = 放不下的那部分（越出布边 / 压在缺口上）。
function splitCutArea(materialId, pieceId, rect) {
  const m = getMaterial(materialId);
  if (!m) return { ok: false, green: [], red: [] };
  const p = (m.pieces || []).find(x => x.id === pieceId && x.status === 'in');
  return splitPieceArea(p, rect);
}

// 同上，但直接吃一个**布片对象**（2026-09-30 V89）。
// 为什么需要：逐件排版时，第 2 件看到的是"第 1 件剪完之后"的**影子布片**（还没落盘），
// 而 splitCutArea 是按 id 去库里找真身 —— 影子用它就穿帮了。
function splitPieceArea(piece, rect) {
  const sh = asSheet(piece);
  if (!sh) return { ok: false, green: [], red: [] };
  return sheets.splitByFree(sh, rect);
}

// 面料布片统计：整布块数 / 碎布块数 / 总块数
function fabricPieceStats(material) {
  const fw = material.fabricWidth;
  const inPieces = (material.pieces || []).filter(p => p.status === 'in');
  let whole = 0, offcut = 0;
  inPieces.forEach(p => { if (isPieceOffcut(p, fw)) offcut++; else whole++; });
  return { whole, offcut, total: inPieces.length };
}

// 模拟：当前库存能完整切出 redLen×redWid 多少次（**每块布分别算再相加**；不拼接；允许旋转 90°）
// 纯函数，不改动真实数据。几何交给 utils/sheets.js（那里有一整套单测）。
function canCutTimes(material, redLen, redWid) {
  const rl = util.round(redLen, 2), rw = util.round(redWid, 2);
  if (!(rl > 0) || !(rw > 0)) return 0;
  let n = 0;
  (material.pieces || []).filter(p => p.status === 'in').forEach(p => {
    const sh = asSheet(p);
    if (!sh) return;
    n += sheets.maxPlacable(sh, rl, rw, 0, { allowRotate: true });
  });
  return n;
}

// 挑选可裁剪的源布（**碎布优先**：先消耗小块、别浪费大块）；返回 {id, rotate} 或 null
function pickCutSource(material, redLen, redWid) {
  const fw = material.fabricWidth;
  const inPieces = (material.pieces || []).filter(p => p.status === 'in');
  const ordered = inPieces.slice().sort((a, b) => {
    const oa = isPieceOffcut(a, fw) ? 0 : 1, ob = isPieceOffcut(b, fw) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    return (a.area || 0) - (b.area || 0);         // 同档：紧配最小的那块
  });
  const rl = util.round(redLen, 2), rw = util.round(redWid, 2);
  for (const p of ordered) {
    const sh = asSheet(p);
    if (!sh) continue;
    if (sheets.placeNext(sh, rl, rw)) return { id: p.id, rotate: false };
    if (rl !== rw && sheets.placeNext(sh, rw, rl)) return { id: p.id, rotate: true };
  }
  return null;
}

// 几何裁剪：从某块布上挖掉 redLen×redWid 的矩形。**这块布仍然是一块**（只是多了个镂空）。
// at（可选 {x,y}）：挖在哪（页面上用户拖出来的位置）。**给了就必须按它挖 —— 放不下直接报错**（V94）；
//   不传则自动找位置（靠下靠左）。
// 红区面积按物料当前加权均价（元/cm²）计入成本并从 totalValue 扣除（方案A）。
// source（可选，V96）：这笔流水的「来源」，默认 'cut'（裁剪）。
//   面料**出库**也走这条几何路径（用户指定哪片布、哪个位置），但来源要记 'manual' ——
//   详情页的「撤销」只对 manual / destroy / stocktake 开放。
function cutFabric(materialId, pieceId, redLen, redWid, remark, rotate, relatedProductId, at, source) {
  const m = getMaterial(materialId);
  if (!m) throw { code: 'NOMAT', msg: '物料不存在' };
  const piece = (m.pieces || []).find(p => p.id === pieceId && p.status === 'in');
  if (!piece) throw { code: 'NOPIECE', msg: '布片不存在或已出库' };
  const sh = asSheet(piece);
  const rl = util.round(rotate ? redWid : redLen, 2);
  const rw = util.round(rotate ? redLen : redWid, 2);
  if (!sh || !(rl > 0) || !(rw > 0)) throw { code: 'FIT', msg: '裁剪尺寸无效' };

  let target = null;
  if (at && at.x != null && at.y != null) {
    // 用户**明确摆过位置**（页面上拖出来的）⇒ 必须按它来：放不下就报错。
    // ⚠️ V94：绝不能退回 placeNext「自己找个位置裁掉」—— 那样流水里记的位置（cutAt / target）
    //    跟用户在界面上摆的**不是同一个地方**，而两块布面积一样、金额一样，**账面完全看不出来**。
    //    V87（选的布被顶掉）、V90（改的尺寸被顶掉）已经踩过两次，这是第三次。
    //    界面那一层已经先拦住了（红了不许确认），这里是**兜底**：任何入口走到这儿都不许静默改位置。
    const cand = sheets.rect({ x: at.x, y: at.y, length: rl, width: rw });
    if (!cand || !sheets.free(sh, cand)) {
      throw { code: 'FIT', msg: '你摆的位置裁不出来（超出布边或压到缺口上），请回裁剪界面重新排一次' };
    }
    target = cand;
  }
  if (!target) target = sheets.placeNext(sh, rl, rw);        // 没给位置（自动裁剪）：老口径不变
  if (!target) throw { code: 'FIT', msg: '裁剪区域超出布片尺寸' };

  const unit = unitCost(m);                                  // 元/cm²
  const redArea = util.round(target.length * target.width, 2);
  const cost = util.round(unit * redArea, 2);
  // ⭐ V95：快照**必须带形状**（base / holes）—— 否则撤销时"缺口凭空消失"
  const before = pieceSnapshot(piece);
  const cutOrigin = origin.mk({ materialId: m.id, pieceId: piece.id, way: 'cut', rect: target, area: redArea });
  const idx = m.pieces.findIndex(p => p.id === pieceId);
  m.pieces[idx] = cutSheetPiece(piece, [target], m.fabricWidth);   // ⚠️ 原地替换：块数不变
  m.totalValue = util.round((m.totalValue || 0) - cost, 2);
  saveMaterial(m);
  addFlow({
    categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'out',
    qty: redArea, balance: stockValue(m), remark: remark || '面料裁剪', source: source || 'cut',
    relatedProductId: relatedProductId, unitCost: unit, totalPrice: cost, priceMode: 'byArea',
    cutSourceId: piece.id, cutAt: { x: target.x, y: target.y },
    // ⭐ V95：出处 —— 这一刀是**哪片布的哪个位置**（形状 / 哪片布 / 哪个位置，三件一起走）。
    //    用**数组**：一笔面积可能同时动好几片布（按面积跨片时），单数会丢掉一部分出处。
    origins: [cutOrigin],
    cutBefore: before, remnantIds: []
  });
  return { consumedArea: redArea, cost: cost, at: target, remnants: [], origin: cutOrigin };
}

// 面料出库（**由用户指定「哪片布 + 哪个位置」**，V96）
//
// 用户 2026-10-02 真机质问：
//   「物料出库为什么只有个面积？不是说有关面料的都要关联几何形状吗
//     只有个面积怎么扣？连长宽都没有」
//
// 改造前：出库只填一个 cm²，然后 consumeFabricArea **自己挑一块布**（紧配最小）、
// **自己挖一个近似矩形**。那不是"扣不了"，是"扣在哪由系统替你决定" ——
// 正好违反「每一笔都要关联到形状 + 哪片布 + 哪个位置」。
//
// 现在：走裁剪排版界面（和成品编辑选面料**同一套**），用户选布、填长宽、摆位置，
// 回传的 schemes 直接就是 cutFabric 要的参数（形状 + 哪片布 + 哪个位置，三件齐全）。
//
// ⚠️ 每一片各自的流水里都带 origin（cutFabric 写），所以出库的每一刀都可追溯。
function outboundCut(materialId, schemes, remark) {
  const m = getMaterial(materialId);
  if (!m) throw { code: 'NOMAT', msg: '物料不存在' };
  const list = (schemes || []).filter(s =>
    s && s.pieceId && Number(s.length) > 0 && Number(s.width) > 0);
  if (!list.length) throw { code: 'NOORIGIN', msg: '请先在布上摆好要裁的位置再出库' };
  let area = 0;
  list.forEach((s) => {
    const at = (s.at && s.at.x != null && s.at.y != null) ? { x: s.at.x, y: s.at.y } : null;
    const r = cutFabric(
      materialId, s.pieceId, Number(s.length), Number(s.width),
      remark || '出库', !!s.rotate, null, at, 'manual');
    area = util.round(area + r.consumedArea, 2);
  });
  return { consumedArea: area, pieces: list.length };
}

// 纯函数：从布片集合里挖掉一个红区，返回**新的布片集合**（不改原数组、不落盘）。
//
// ⚠️ 与 cutFabric 共用 cutSheetPiece —— 影子预览与真正落盘必须是同一套规则，否则预览会骗人。
// 用途：选片页按它做「影子预览」——第 N 件的可选方案必须基于前 N-1 件剪完后的状态。
// at（可选 {x,y}）：挖在哪；不传则自动找位置（靠下靠左）。
function applyCutToPieces(pieces, pieceId, rl, rw, fw, at) {
  const all = (pieces || []).slice();
  const i = all.findIndex(p => p.id === pieceId && p.status === 'in');
  if (i < 0) return null;
  const sh = asSheet(all[i]);
  const L = util.round(rl, 2), W = util.round(rw, 2);
  if (!sh || !(L > 0) || !(W > 0)) return null;
  let target = null;
  if (at && at.x != null && at.y != null) {
    const cand = sheets.rect({ x: at.x, y: at.y, length: L, width: W });
    if (cand && sheets.free(sh, cand)) target = cand;
  }
  if (!target) target = sheets.placeNext(sh, L, W);
  if (!target) return null;
  all[i] = cutSheetPiece(all[i], [target], fw);
  return all;
}

// 列出某物料对某红区矩形的【全部可选裁剪方案】，按"尽量保住大块布"排序。
// 规则：1) 碎布优先（不破坏整布，且取最小能容的那块紧配）；2) 整布切最小能容的那块（保留更大整布）；
//      3) 同一块内，旋转使"沿长度方向被吃掉的尺寸"最小 → 剩余可用面积最大。
// 返回数组：第一项 isRecommended=true；每项含 at（挖在哪，页面画图用）与 remainArea（挖完还剩多少）。
// piecesOverride（2026-09-29 V78，可选）：用「影子布块」列方案 —— 逐件确认时，
//   第 N 件要按前 N-1 件剪完后的状态列，而不是按当前真实库存列。
//
// ⚠️ 2026-09-30 V89：**目前没有页面在用**它。它原本服务于「方案卡片」式的选片页
//   （`pages/cut-picker`，已删）；现在的裁剪界面是**用户自己拖**（不再给推荐方案）。
//   保留是因为：它是"给定矩形在这块布上怎么摆最省料"的唯一实现，且有一整套几何单测；
//   哪天要做「一键自动排版」还能直接用。要清理的话请连同 tests/fabric.test.js 的方案组一起评估。
function listCutSchemes(materialId, redLen, redWid, piecesOverride) {
  const m = getMaterial(materialId);
  if (!m) return [];
  const fw = m.fabricWidth;
  redLen = util.round(redLen, 2); redWid = util.round(redWid, 2);
  if (redLen <= 0 || redWid <= 0) return [];
  const inPieces = (piecesOverride || m.pieces || []).filter(p => p.status === 'in');
  const schemes = [];
  inPieces.forEach(p => {
    const sh = asSheet(p);
    if (!sh) return;
    const isOff = isPieceOffcut(p, fw);
    const placements = [{ rotate: false, rl: redLen, rw: redWid }];
    // 正方形红区：旋转 90° 与不旋转几何完全等价（红区占位、余料全同），只留不旋转的一个，
    // 免得出现两张"看起来一模一样"的方案卡（2026-09-13 真机反馈）。
    if (redLen !== redWid) placements.push({ rotate: true, rl: redWid, rw: redLen });
    placements.forEach(pl => {
      const at = sheets.placeNext(sh, pl.rl, pl.rw);
      if (!at) return;
      const after = { base: sh.base, holes: sh.holes.concat([at]) };
      schemes.push({
        materialId, pieceId: p.id, rotate: pl.rotate,
        sourceType: isOff ? 'offcut' : 'whole',
        source: { id: p.id, length: sh.base.length, width: sh.base.width, isOffcut: isOff },
        red: { length: pl.rl, width: pl.rw },
        at: { x: at.x, y: at.y },
        redArea: util.round(pl.rl * pl.rw, 2),
        remainArea: sheets.freeArea(after),
        rl: pl.rl,                                   // 仅用于排序：越小剩余可用越大
        sourceArea: p.area || 0
      });
    });
  });
  // 排序：碎布(0) < 整布(1)；同档可用面积升序（碎布紧配 / 整布切最小块）；再 rl 升序（剩更多）
  schemes.sort((a, b) => {
    const ta = a.sourceType === 'offcut' ? 0 : 1, tb = b.sourceType === 'offcut' ? 0 : 1;
    if (ta !== tb) return ta - tb;
    if (a.sourceArea !== b.sourceArea) return a.sourceArea - b.sourceArea;
    return a.rl - b.rl;
  });
  schemes.forEach((s, i) => { s.isRecommended = (i === 0); });
  return schemes;
}

// 从用户选定方案中找出对某物料+红区矩形有效（那块布还在、且**挖得下去**）的方案；无效返回 null
function findChosen(chosen, mid, rect) {
  if (!chosen || !rect) return null;
  const c = chosen.find(x =>
    x.materialId === mid &&
    util.round(x.length, 2) === util.round(rect.length, 2) &&
    util.round(x.width, 2) === util.round(rect.width, 2));
  if (!c) return null;
  const m = getMaterial(mid);
  if (!m) return null;
  const piece = (m.pieces || []).find(p => p.id === c.pieceId && p.status === 'in');
  if (!piece) return null;
  const sh = asSheet(piece);
  if (!sh) return null;
  const rl = util.round(c.rotate ? rect.width : rect.length, 2);
  const rw = util.round(c.rotate ? rect.length : rect.width, 2);
  // 用户指定的位置还空着吗？没指定就只要求"这块布上还放得下"
  if (c.at && c.at.x != null && c.at.y != null) {
    const cand = sheets.rect({ x: c.at.x, y: c.at.y, length: rl, width: rw });
    if (cand && sheets.free(sh, cand)) return c;
  }
  return sheets.placeNext(sh, rl, rw) ? c : null;
}

// 碎料整块销毁：从 pieces 中删除目标布片，按当前加权均价计算成本，写库存流水。
function destroyPiece(materialId, pieceId, remark) {
  const m = getMaterial(materialId);
  if (!m) throw { code: 'NOMAT', msg: '物料不存在' };
  const idx = (m.pieces || []).findIndex(p => p.id === pieceId && p.status === 'in');
  if (idx < 0) throw { code: 'NOPIECE', msg: '布片不存在或已出库' };
  const piece = m.pieces[idx];
  const unit = unitCost(m);
  const cost = util.round(unit * piece.area, 2);
  const before = pieceSnapshot(piece);   // ⭐ V95：含形状（否则撤销回来是完整矩形）
  m.pieces.splice(idx, 1);
  const oldArea = fabricArea(m) + piece.area; // 销毁前总面积
  m.totalValue = oldArea > 0 ? util.round((m.totalValue || 0) * (fabricArea(m) / oldArea), 2) : 0;
  m.price = util.round(unitCost(m) * 10000, 4);
  saveMaterial(m);
  addFlow({
    categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'out',
    qty: piece.area, balance: stockValue(m), remark: remark || '碎料销毁', source: 'destroy',
    unitCost: unit, totalPrice: cost, priceMode: 'byArea', pieceBefore: before,
    origins: [origin.mk({ materialId: m.id, pieceId: before.id, way: 'whole', area: before.area, pieceBefore: before })]
  });
  return m;
}

// 整布卷筒盘点调整：修改目标布片尺寸，按当前加权均价同步调整库存价值，写库存流水。
function stocktakePiece(materialId, pieceId, newLength, newWidth, remark) {
  const m = getMaterial(materialId);
  if (!m) throw { code: 'NOMAT', msg: '物料不存在' };
  const piece = (m.pieces || []).find(p => p.id === pieceId && p.status === 'in');
  if (!piece) throw { code: 'NOPIECE', msg: '布片不存在或已出库' };
  const nl = util.round(newLength, 2), nw = util.round(newWidth, 2);
  if (!nl || !nw) throw { code: 'DIM', msg: '请输入有效的长和宽' };
  const oldArea = piece.area;
  const newArea = util.round(nl * nw, 2);
  const delta = util.round(newArea - oldArea, 2);
  if (delta === 0) return m;
  const unit = unitCost(m);
  const cost = util.round(unit * Math.abs(delta), 2);
  const before = pieceSnapshot(piece);   // ⭐ V95：含形状（盘点前的真实形状）
  piece.length = nl; piece.width = nw; piece.area = newArea;
  // 盘点是「实际就剩这么大」→ 形状重置为那个矩形（旧镂空不再代表现实）
  piece.base = { x: 0, y: 0, length: nl, width: nw };
  piece.holes = [];
  piece.cuts = 0;
  piece.isOffcut = isPieceOffcut(piece, m.fabricWidth);
  m.totalValue = util.round((m.totalValue || 0) + unit * delta, 2);
  m.price = util.round(unitCost(m) * 10000, 4);
  saveMaterial(m);
  addFlow({
    categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: delta > 0 ? 'in' : 'out',
    qty: Math.abs(delta), balance: stockValue(m), remark: remark || '盘点调整', source: 'stocktake',
    unitCost: unit, totalPrice: cost, priceMode: 'byArea', pieceBefore: before,
    origins: [origin.mk({ materialId: m.id, pieceId: before.id, way: 'whole', area: before.area, pieceBefore: before })]
  });
  return m;
}

// 盘库（物料）：刀口布按 batchRemain、其他按 quantity，差额 Δ=实测−系统 按当前加权均价折算价值
// 与入库同构：盘盈(Δ>0)=入库加、盘亏(Δ<0)=出库减；仅对账修正，不生成采购单
function stocktakeMaterial(materialId, actualValue, remark) {
  const m = getMaterial(materialId);
  if (!m) throw { code: 'NOMAT', msg: '物料不存在' };
  const isBatch = isMaterialFabric(m) && m.stockMode === 'batch';
  actualValue = util.round(Number(actualValue) || 0, 2);
  if (actualValue < 0) throw { code: 'QTY', msg: '实际库存不能为负' };
  if (isBatch) {
    const cur = util.round(m.batchRemain || 0, 2);
    const delta = util.round(actualValue - cur, 2);
    if (delta === 0) return m;
    const unit = m.batchUnitPrice || 0;
    const cost = util.round(unit * Math.abs(delta), 2);
    m.batchRemain = actualValue;
    m.totalValue = util.round((m.totalValue || 0) + unit * delta, 2);
    saveMaterial(m);
    addFlow({
      categoryId: m.categoryId, materialId: m.id, materialName: m.name,
      type: delta > 0 ? 'in' : 'out',
      qty: Math.abs(delta), balance: stockValue(m), remark: remark || '盘库盈亏', source: 'stocktake',
      unitCost: unit, totalPrice: cost, priceMode: 'byBatch', unit: m.batchUnit,
      origins: [batchBackOrigin(m, Math.abs(delta))]
    });
    return m;
  }
  // 非面料（含工具/耗材）：按数量盘
  const cur = util.round(m.quantity || 0, 2);
  const delta = util.round(actualValue - cur, 2);
  if (delta === 0) return m;
  const unit = unitCost(m); // 元/单位 当前加权均价
  const cost = util.round(unit * Math.abs(delta), 2);
  m.quantity = actualValue;
  m.totalValue = util.round((m.totalValue || 0) + unit * delta, 2);
  m.price = unitCost(m);
  saveMaterial(m);
  addFlow({
    categoryId: m.categoryId, materialId: m.id, materialName: m.name,
    type: delta > 0 ? 'in' : 'out',
    qty: Math.abs(delta), balance: stockValue(m), remark: remark || '盘库盈亏', source: 'stocktake',
    unitCost: unit, totalPrice: cost, priceMode: 'each', unit: m.unit || '个'
  });
  return m;
}

// 盘库（成品）：待售、样品分别填实测件数，差额按当前单件成本（computeProduct.totalCost）折算价值
// 与入库同构：盘盈=生产加、盘亏=损减；仅对账，不触发 consumeBom 扣料（避免与历史生产重复扣减）
function stocktakeProduct(productId, actualSellable, actualSample, remark) {
  const list = getProducts();
  const p = list.find(x => x.id === productId);
  if (!p) throw { code: 'NOPROD', msg: '成品不存在' };
  const c = require('./calc.js').computeProduct(p);
  const unitCostVal = util.round(c.totalCost, 2); // 单件成本（元/件，当前 BOM 重算）
  let changed = false;
  const applyKind = (kind, cur, actual) => {
    const a = util.round(Number(actual) || 0, 2);
    if (a < 0) return;
    const delta = util.round(a - cur, 2);
    if (delta === 0) return;
    const cost = util.round(unitCostVal * Math.abs(delta), 2);
    if (kind === 'sellable') p.sellableStock = a; else p.sampleStock = a;
    addFlow({
      categoryId: p.categoryId, productId: p.id, productName: p.name,
      type: delta > 0 ? 'in' : 'out',
      qty: Math.abs(delta), balance: (kind === 'sellable' ? p.sellableStock : p.sampleStock),
      remark: remark || '盘库盈亏', source: 'stocktake',
      unitCost: unitCostVal, totalPrice: cost, priceMode: 'product', stockKind: kind, nature: p.nature
    });
    changed = true;
  };
  applyKind('sellable', util.round(p.sellableStock || 0, 2), actualSellable);
  applyKind('sample', util.round(p.sampleStock || 0, 2), actualSample);
  if (changed) set(KEYS.PRODUCTS, list);
  return p;
}

/* ===================== 库存流水（M1-04, M1-11） ===================== */
function getFlows() { return get(KEYS.FLOWS, []); }
function addFlow(flow) {
  if (!flow.categoryId) flow.categoryId = currentSpace();
  const list = getFlows();
  flow.id = uid('f');
  flow.createdAt = flow.createdAt || Date.now();
  flow.date = util.fmtDate(new Date(flow.createdAt));
  list.push(flow);
  set(KEYS.FLOWS, list);
  // ⭐ 唯一收口点：每次流水落盘后，由流水重算该物料的库存总值。
  //    所有库存变动都会经过 addFlow，因此 totalValue 不再需要任何手工维护。
  syncTotalValueFromFlows(flow.materialId);
  return flow;
}

// 入库（M1-04）：移动加权平均
// 非面料：qty 为数量，batchTotal 为本次入库总价（元，可选）
// 面料：qty 忽略；batchTotal 复用为 {length,width,total} 布片对象，total 为本次布片总价
// ── 刀口布「批次明细」（2026-10-02 V95）────────────────────────────
// 用户要求：「刀口布可以带出处」。刀口布是**按批估量**（kg / 片），没有"布片"，
// 所以它的出处不是"哪片布的哪个位置"，而是**哪一次入库的那一批**。
// 记账口径一个字不动（batchRemain / batchUnitPrice 仍是权威），批次只是**溯源**。
//
// ⚠️ 对不上的部分一律记到 `legacy` 批 —— 如实标明"没追溯到批次"，
//    **绝不把不知道来源的量摊给某个已知批次**（那等于编）。
// 兜底出处：原片 / 原洞已经找不到了，只能按面积另造一片。
// ⚠️ **必须如实标明**（way='detach'）—— 不许假装成「填回原洞」（那就是编）。
function detachOrigin(m, area, note) {
  return origin.mk({
    materialId: (m && m.id) || '', way: 'detach', rect: null, area: area,
    note: note || '原片位置无记录，按面积另造一片'
  });
}

function syncBatchLots(m) {
  if (!m) return;
  const bal = util.round(m.batchRemain || 0, 2);
  const lots = m.batchLots || [];
  const sum = util.round(lots.reduce((s, l) => s + (Number(l.remain) || 0), 0), 2);
  if (Math.abs(sum - bal) < 0.005) return;
  const diff = util.round(bal - sum, 2);
  if (diff > 0) {
    const lg = lots.find(l => l.way === 'legacy');
    if (lg) lg.remain = util.round((Number(lg.remain) || 0) + diff, 2);
    else m.batchLots = lots.concat([{
      id: uid('lot'), qty: diff, remain: diff,
      unitPrice: m.batchUnitPrice || 0, flowId: '', way: 'legacy', at: util.today()
    }]);
    return;
  }
  // 多了（取出 > 账）：从未追溯的那批起往下扣
  let cut = util.round(-diff, 2);
  const order = lots.slice().sort((a, b) => (a.way === 'legacy' ? -1 : 1) - (b.way === 'legacy' ? -1 : 1));
  order.forEach(l => {
    if (cut <= 0) return;
    const r = util.round(Number(l.remain) || 0, 2);
    const take = Math.min(cut, r);
    l.remain = util.round(r - take, 2);
    cut = util.round(cut - take, 2);
  });
}

// 新增一批（入库时调）
function pushBatchLot(m, qty, unitPrice, flowId) {
  const q = util.round(qty, 2);
  if (!(q > 0)) return null;
  const lot = {
    id: uid('lot'), qty: q, remain: q,
    unitPrice: util.round(unitPrice || 0, 6),
    flowId: flowId || '', way: 'in', at: util.today()
  };
  m.batchLots = (m.batchLots || []).concat(lot);
  return lot;
}

// 按 FIFO 取料（先入先出），返回 { lots:[{lotId,qty}], left }
function drawBatchLots(m, use) {
  syncBatchLots(m);                       // 先对齐（对不上的部分记到 legacy 批）
  let remain = util.round(use, 2);
  const taken = [];
  (m.batchLots || []).forEach(l => {
    if (remain <= 0 || !l) return;
    const r = util.round(Number(l.remain) || 0, 2);
    if (!(r > 0)) return;
    const take = util.round(Math.min(remain, r), 2);
    l.remain = util.round(r - take, 2);
    remain = util.round(remain - take, 2);
    taken.push({ lotId: l.id, qty: take });
  });
  if (remain > 0) taken.push({ lotId: 'legacy', qty: remain });   // 兜底：如实标"未追溯到批次"
  return { lots: taken, left: remain };
}

// 刀口布退回时的出处（V95 口径：按账加回，差额记 legacy 批；V96 会用成品记录里的出处精确回填）
function batchBackOrigin(m, qty) {
  const q = util.round(qty, 2);
  return origin.mk({
    materialId: m.id, way: 'batch', rect: null, area: q,
    lots: [{ lotId: 'legacy', qty: q }],
    note: '按账加回 · 未追溯到具体批次'
  });
}

function inbound(materialId, qty, batchTotal, remark) {
  const m = getMaterial(materialId);
  if (!m) throw { code: 'NOMAT', msg: '物料不存在' };
  // 按批估量（刀口布）：补货 = 增加 batchRemain，按本次总价做加权平均单价
  if (isMaterialFabric(m) && m.stockMode === 'batch') {
    qty = util.round(qty, 2);
    if (qty <= 0) throw { code: 'QTY', msg: '数量需大于0' };
    const oldRemain = m.batchRemain || 0;
    const oldValue = m.totalValue || 0;
    const addedValue = (batchTotal != null && batchTotal !== '' && !isNaN(batchTotal)) ? Number(batchTotal) : 0;
    const newRemain = util.round(oldRemain + qty, 2);
    const newUnitPrice = newRemain > 0 ? util.round((oldValue + addedValue) / newRemain, 6) : (m.batchUnitPrice || 0);
    m.batchRemain = newRemain;
    m.batchTotal = util.round((m.batchTotal || 0) + qty, 2);
    m.batchUnitPrice = newUnitPrice;
    m.totalValue = util.round(oldValue + addedValue, 2);
    // ⭐ V95：这一批入库单独建一条批次明细（刀口布的"出处"就是它）
    const inFlow = addFlow({
      categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'in',
      qty: qty, balance: stockValue(m), remark: remark || '刀口布补货', source: 'manual',
      unitCost: newUnitPrice, totalPrice: addedValue, priceMode: 'byBatch', unit: m.batchUnit
    });
    pushBatchLot(m, qty, newUnitPrice, inFlow && inFlow.id);
    syncBatchLots(m);
    saveMaterial(m);
    return m;
  }
  if (isMaterialFabric(m)) {
    const o = batchTotal || {};
    const length = util.round(o.length, 2);
    const width = util.round(o.width, 2);
    if (!length || !width) throw { code: 'DIM', msg: '面料需填写长、宽' };
    const area = util.round(length * width, 2);
    const oldArea = fabricArea(m);
    const oldValue = m.totalValue || 0;
    const oldUnit = oldArea > 0 ? util.round(oldValue / oldArea, 6) : 0;
    const batchVal = (o.total != null && o.total !== '' && !isNaN(o.total)) ? Number(o.total) : 0;
    const addedValue = batchVal > 0 ? batchVal : (oldArea > 0 ? util.round(oldUnit * area, 2) : 0);
    m.fabricWidth = width; // 幅宽=宽（录入口径固定）
    // 长同样按本次入库更新（与幅宽对称）。此前只写幅宽，「长」长期缺失 → 编辑页回填为空
    // 却仍当必填 → 用户被迫重填一个自己没改过的字段（2026-09-12 真机反馈）
    m.fabricLength = length;
    const newPiece = mkPiece(length, width, 'purchase', width);
    m.pieces = (m.pieces || []).concat(newPiece);
    m.totalValue = util.round(oldValue + addedValue, 2);
    m.price = util.round(unitCost(m) * 10000, 4); // 元/m²
    const newUnitCost = unitCost(m); // 元/cm²
    saveMaterial(m);
    addFlow({
      categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'in',
      qty: area, balance: stockValue(m), remark: remark || '面料入库', source: 'manual',
      unitCost: newUnitCost, totalPrice: addedValue, priceMode: 'byArea', pieceId: newPiece.id
    });
    return m;
  }
  qty = util.round(qty, 2);
  if (qty <= 0) throw { code: 'QTY', msg: '数量需大于0' };
  const oldQty = m.quantity || 0;
  const oldValue = m.totalValue || 0;
  const oldUnit = oldQty > 0 ? util.round(oldValue / oldQty, 6) : 0;
  const batchVal = (batchTotal != null && batchTotal !== '' && !isNaN(batchTotal)) ? Number(batchTotal) : 0;
  const addedValue = batchVal > 0 ? batchVal : (oldQty > 0 ? util.round(oldUnit * qty, 2) : 0);
  m.quantity = util.round(oldQty + qty, 2);
  m.totalValue = util.round(oldValue + addedValue, 2);
  m.price = unitCost(m); // 元/单位（加权平均）
  const newUnitCost = unitCost(m);
  saveMaterial(m);
    addFlow({
      categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'in',
      qty: qty, balance: stockValue(m), remark: remark || '入库', source: 'manual',
      unitCost: newUnitCost, totalPrice: addedValue, priceMode: 'each', unit: m.unit || '个'
    });
  return m;
}

// 出库（M1-04）：不可为负；按当前均价同比例扣减库存价值，保持均价不变
// source（2026-09-27 V72 新增，可选）：流水的来源标签，默认 'manual'（手动出库）。
//   排单交付要传 'commission' —— 之前它落库时一律是 'manual'/'cut'，导出里显示成
//   「手动 / 成品裁剪」，跟实际情况对不上（用户反馈）。
function outbound(materialId, qty, remark, relatedProductId, source) {
  const m = getMaterial(materialId);
  if (!m) throw { code: 'NOMAT', msg: '物料不存在' };
  qty = util.round(qty, 2);
  if (qty <= 0) throw { code: 'QTY', msg: '数量需大于0' };
  let cost = 0, unit = 0, priceMode = 'each';
  let flowOrigins = [];        // ⭐ V95：这一笔出库**动了什么**（形状 / 哪片布·哪批 / 哪个位置）
  if (!isMaterialFabric(m)) {
    const oldQty = m.quantity || 0;
    if (oldQty < qty) throw { code: 'NEG', msg: '库存不足，无法出库' };
    const oldValue = m.totalValue || 0;
    unit = oldQty > 0 ? util.round(oldValue / oldQty, 6) : 0;
    cost = util.round(unit * qty, 2);
    m.quantity = util.round(oldQty - qty, 2);
    m.totalValue = oldQty > 0 ? util.round(oldValue * (m.quantity / oldQty), 2) : 0;
    m.price = unitCost(m);
  } else if (m.stockMode === 'batch') {
    // 按批估量（刀口布）：按 batchRemain 扣减，库存价值同比缩减，保持加权单价不变
    const oldRemain = util.round(m.batchRemain || 0, 2);
    if (oldRemain < qty) throw { code: 'NEG', msg: '库存不足，无法出库' };
    const oldValue = m.totalValue || 0;
    unit = oldRemain > 0 ? util.round(oldValue / oldRemain, 6) : 0;
    cost = util.round(unit * qty, 2);
    // ⭐ V95：按 FIFO 记下**是从哪几批里出的**
    // ⚠️ 必须**先取批次、再减账**：先减 batchRemain 再取的话，
    //    syncBatchLots 会以为“账少了”而把批次又扣一遍（量凭空少一半）
    const drew = drawBatchLots(m, qty);
    m.batchRemain = util.round(oldRemain - qty, 2);
    m.totalValue = oldRemain > 0 ? util.round(oldValue * (m.batchRemain / oldRemain), 2) : 0;
    m.batchUnitPrice = unit;
    priceMode = 'byBatch';
    flowOrigins = [origin.mk({
      materialId: m.id, way: 'batch', rect: null, area: qty, lots: drew.lots,
      note: drew.left > 0 ? '有 ' + drew.left + ' 未追溯到批次' : ''
    })];
  } else {
    const oldArea = fabricArea(m);
    const oldValue = m.totalValue || 0;
    unit = oldArea > 0 ? util.round(oldValue / oldArea, 6) : 0;
    cost = util.round(unit * qty, 2);
    // ⭐ V95：把「挖了哪几片布的哪几个位置」原样带出去（面积口径不变，但出处不能缺）
    const consumed = consumeFabricArea(m, qty);
    flowOrigins = (consumed && consumed.origins) || [];
    const newArea = fabricArea(m);
    m.totalValue = oldArea > 0 ? util.round(oldValue * (newArea / oldArea), 2) : 0;
    m.price = util.round(unitCost(m) * 10000, 4);
    priceMode = 'byArea';
  }
  saveMaterial(m);
  const balance = stockValue(m);
  addFlow({
    categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'out',
    qty: qty, balance: balance, remark: remark || '出库', source: source || 'manual', relatedProductId: relatedProductId,
    unitCost: unit, totalPrice: cost, priceMode: priceMode, origins: flowOrigins,
    // 流水 unit 统一存原始计量值（piece/kg/g），展示层用 displayUnit 转换，与入库/盘库保持一致
    unit: priceMode === 'byBatch' ? m.batchUnit : (m.unit || '个')
  });
  return m;
}

// 撤销库存流水：手动入库/手动出库/关联成品的生产裁剪均可反向恢复
// 裁剪撤销会精确复原被切源片形状并删掉余料；手动出库/入库按当时金额同向回滚
function undoFlow(flowId) {
  const flows = getFlows();
  const fi = flows.findIndex(f => f.id === flowId);
  if (fi < 0) throw { code: 'NO', msg: '流水不存在' };
  const f = flows[fi];
  const m = f.materialId ? getMaterial(f.materialId) : null;
  if (f.materialId && !m) throw { code: 'NOMAT', msg: '物料不存在' };
  // 红冲防重守卫（改造后原流水不再被删除，必须挡住重复冲销，否则会重复回滚库存）
  if (f.source === 'reversal') throw { code: 'REVERSAL', msg: '冲销记录本身不能再撤销' };
  if (f.undone) throw { code: 'UNDONE', msg: '该流水已冲销过，不能重复撤销' };
  if (f.source === 'cut' && f.cutBefore) {
    // 裁剪撤销：这块布裁过之后**还在一块上**（只是多了个洞）⇒ 本质是"把洞填回去"。
    // ⚠️ 必须按 id **替换**，不能 concat（同一 id 会出现两块、面积凭空翻倍）。
    // ⭐ V95：用 pieceFromSnapshot 恢复 —— 快照里带 base/holes，缺口不会凭空消失。
    (f.remnantIds || []).forEach(rid => { m.pieces = (m.pieces || []).filter(p => p.id !== rid); });
    const b = pieceFromSnapshot(f.cutBefore);
    if (b) {
      const at = (m.pieces || []).findIndex(p => p.id === b.id);
      if (at >= 0) m.pieces[at] = b;
      else m.pieces = (m.pieces || []).concat(b);
    }
    m.totalValue = util.round((m.totalValue || 0) + (Number(f.totalPrice) || 0), 2);
    saveMaterial(m);
  } else if (f.source === 'destroy' && f.type === 'out' && f.pieceBefore) {
    // 碎料销毁撤销：恢复被删除的布片（⭐ V95：含形状）
    const b = pieceFromSnapshot(f.pieceBefore);
    if (b) {
      const at = (m.pieces || []).findIndex(p => p.id === b.id);
      if (at >= 0) m.pieces[at] = b;
      else m.pieces = (m.pieces || []).concat(b);
    }
    m.totalValue = util.round((m.totalValue || 0) + (Number(f.totalPrice) || 0), 2);
    saveMaterial(m);
  } else if (f.source === 'stocktake' && f.pieceBefore) {
    // 盘点调整撤销：**整片**回到盘点前的样子（⭐ V95：含形状，不再只还原长宽）
    const b = pieceFromSnapshot(f.pieceBefore);
    if (b) {
      const at = (m.pieces || []).findIndex(x => x.id === b.id);
      if (at >= 0) m.pieces[at] = b;
      else m.pieces = (m.pieces || []).concat(b);
    }
    const sign = f.type === 'in' ? -1 : 1; // 盘盈撤销扣回，盘亏撤销加回
    m.totalValue = util.round((m.totalValue || 0) + sign * (Number(f.totalPrice) || 0), 2);
    saveMaterial(m);
  } else if (f.source === 'stocktake' && f.priceMode === 'byBatch') {
    // 刀口布盘库撤销：按 flow 数量/金额反向恢复 batchRemain 与 totalValue（盘盈 in 撤销扣回，盘亏 out 撤销加回）
    const sign = f.type === 'in' ? -1 : 1;
    m.batchRemain = util.round((m.batchRemain || 0) + sign * (Number(f.qty) || 0), 2);
    m.totalValue = util.round((m.totalValue || 0) + sign * (Number(f.totalPrice) || 0), 2);
    saveMaterial(m);
  } else if (f.source === 'stocktake' && f.priceMode === 'product') {
    // 成品盘库撤销：按 stockKind 反向恢复 待售/样品 库存（盘盈 in 撤销扣回，盘亏 out 撤销加回）
    const list = getProducts();
    const p = list.find(x => x.id === f.productId);
    if (!p) throw { code: 'NOPROD', msg: '成品不存在' };
    const sign = f.type === 'in' ? -1 : 1;
    const dq = util.round((Number(f.qty) || 0) * sign, 2);
    if (f.stockKind === 'sellable') p.sellableStock = util.round((p.sellableStock || 0) + dq, 2);
    else p.sampleStock = util.round((p.sampleStock || 0) + dq, 2);
    set(KEYS.PRODUCTS, list);
  } else if (f.type === 'in') {
    if (f.priceMode === 'byBatch') {
      // 刀口布入库撤销：反向扣回 batchRemain 与库存价值
      m.batchRemain = util.round((m.batchRemain || 0) - (Number(f.qty) || 0), 2);
      m.totalValue = util.round((m.totalValue || 0) - (Number(f.totalPrice) || 0), 2);
    } else if (f.priceMode === 'byArea') {
      if (f.pieceId) m.pieces = (m.pieces || []).filter(p => p.id !== f.pieceId);
      m.totalValue = util.round((m.totalValue || 0) - (Number(f.totalPrice) || 0), 2);
    } else {
      m.quantity = util.round((m.quantity || 0) - (Number(f.qty) || 0), 2);
      m.totalValue = util.round((m.totalValue || 0) - (Number(f.totalPrice) || 0), 2);
    }
    saveMaterial(m);
  } else if (f.type === 'out') {
    if (f.priceMode === 'byBatch') {
      // 刀口布出库撤销：反向加回 batchRemain 与库存价值
      m.batchRemain = util.round((m.batchRemain || 0) + (Number(f.qty) || 0), 2);
      m.totalValue = util.round((m.totalValue || 0) + (Number(f.totalPrice) || 0), 2);
    } else if (f.priceMode === 'byArea') {
      // ⭐ V95：有出处就**填回原洞**（用户拍板「退料退回原洞」）；老记录没出处 → 另造一片并如实标明
      const srcs = f.origins || (f.origin ? [f.origin] : []);
      const res = srcs.length
        ? restoreAreaOrigins(m, srcs)
        : { restoredArea: 0, restoredHoles: 0, detached: [] };
      if (!srcs.length || res.detached.length > 0) {
        const w = m.fabricWidth || 100;
        const a = Number(f.qty) || 0;
        m.pieces = (m.pieces || []).concat(mkPiece(a / w, w, 'remnant', w,
          detachOrigin(m, a, '这条流水没有出处（改造前记的），只能按面积另造一片')));
      }
      m.totalValue = util.round((m.totalValue || 0) + (Number(f.totalPrice) || 0), 2);
    } else {
      m.quantity = util.round((m.quantity || 0) + (Number(f.qty) || 0), 2);
      m.totalValue = util.round((m.totalValue || 0) + (Number(f.totalPrice) || 0), 2);
    }
    saveMaterial(m);
  }
  // ── 红冲（方案：保留原流水 + 追加反向流水，保住完整审计链）──
  // 说明：旧实现是 flows.splice(fi, 1) 物理删除，会让「入库过又撤销」这段历史彻底消失，
  //       与「所有数据波动都要有时间戳记录、可导出」的需求冲突，故改为红冲。
  f.undone = true;
  f.undoneAt = Date.now();
  set(KEYS.FLOWS, flows);   // 先落盘标记，再追加红冲（addFlow 内部会重新读取）

  const balanceAfter = m ? stockValue(m) : (f.balance != null ? f.balance : null);
  const reversal = addFlow({
    categoryId: f.categoryId,
    materialId: f.materialId,
    materialName: f.materialName,
    type: f.type === 'in' ? 'out' : 'in',   // 方向取反
    qty: f.qty,
    balance: balanceAfter,
    remark: '冲销：' + (f.remark || ''),
    source: 'reversal',
    reversesFlowId: f.id,
    relatedProductId: f.relatedProductId,
    productId: f.productId,
    stockKind: f.stockKind,
    unitCost: f.unitCost,
    totalPrice: Number(f.totalPrice) || 0,
    priceMode: f.priceMode,
    unit: f.unit,
    origins: f.origins || (f.origin ? [f.origin] : [])
  });
  return reversal;
}

/* ===================== 成品（M1-06, M1-07, M1-09, M1-21） ===================== */
function getProducts() { return get(KEYS.PRODUCTS, []); }
function getProduct(id) { return getProducts().find(x => x.id === id); }

// 保存成品：按 BOM 扣减/返还物料库存（非面料数量 + 面料面积），记录流水
// 编辑时通过 materialUsed/fabricUsed 计算 delta，库存不足时整体回滚并抛错
function saveProduct(p, opts) {
  if (!p.categoryId) p.categoryId = currentSpace();
  // 成品品类兜底：历史上「成品品类」功能上线前的老成品缺该字段（undefined/空串），
  // 统一归入 'pc_other'，与 migrateProductCategoryTag 一致，防止任何保存路径漏写。
  if (!p.productCategoryId) p.productCategoryId = 'pc_other';
  const list = getProducts();
  const chosen = (opts && opts.chosenSchemes) || [];
  const old = p.id ? list.find(x => x.id === p.id) : null;
  const oldMatUsed = (old && old.materialUsed) || {};
  const oldFabricUsed = (old && old.fabricUsed) || {};
  const oldFabricRects = (old && old.fabricRects) || {};
  const oldBatchUsed = (old && old.batchUsed) || {}; // 按批估量（刀口布）/件用量 {materialId: 用量(kg/片)}
  const newMatUsed = {};
  const newFabricUsed = {};
  const newBatchUsed = {};
  const newFabricRects = {}; // 面料 BOM 红区矩形 {materialId: {length,width}}
  // V122：片清单签名 —— 判断"裁剪方案有没有变"时把**片数与每片尺寸**也算进去
  //   （只看主片长宽的话，第二片变了会被当成"没变"而漏扣）。
  const piecesSig = (r) => (r && r.pieces && r.pieces.length)
    ? r.pieces.map(x => [x.length, x.width, x.pieceId || '', x.rotate ? 1 : 0].join(':')).join('|')
    : '';
  const materials = getMaterials();

  (p.bom || []).forEach(b => {
    const m = materials.find(x => x.id === b.materialId);
    if (!m) return;
    // BOM 行手动「面料」开关优先级最高
    const fabric = b.isFabric || isMaterialFabric(m);
    if (fabric) {
      // 按批估量（刀口布）：以「每件用量(kg/片)」计，不走几何面积
      if (util.bomIsBatchLine(b, m)) {
        if (b.batchUsage) newBatchUsed[b.materialId] = util.round((newBatchUsed[b.materialId] || 0) + (Number(b.batchUsage) || 0), 2);
      } else {
        if (b.area) newFabricUsed[b.materialId] = util.round((newFabricUsed[b.materialId] || 0) + b.area, 2);
        // ⚠️ 裁剪红区只属于「按片面料」。刀口布若把长宽写进 fabricRects，
        //    下次打开编辑页会被回填 → 保存时又弹「请先完成裁剪」（2026-09-12 真机反馈的脏数据源头）
        if (b.length && b.width) {
          const rect = { length: util.round(b.length, 2), width: util.round(b.width, 2) };
          // V122：一个物料可以用**多块布** —— 片清单随矩形一起记，扣料时按它**逐片**挖。
          const pl = Array.isArray(b.chosenSchemes)
            ? b.chosenSchemes.filter(x => x && Number(x.length) > 0 && Number(x.width) > 0) : [];
          if (pl.length > 1) {
            rect.pieces = pl.map(x => ({
              length: util.round(Number(x.length), 2), width: util.round(Number(x.width), 2),
              pieceId: x.pieceId || null, rotate: !!x.rotate,
              at: (x.at && x.at.x != null && x.at.y != null) ? { x: x.at.x, y: x.at.y } : null
            }));
          }
          newFabricRects[b.materialId] = rect;
        }
      }
    } else {
      newMatUsed[b.materialId] = util.round((newMatUsed[b.materialId] || 0) + (Number(b.usage) || 0), 2);
    }
  });

  // 先校验所有增量是否够库存
  const allMatIds = new Set(Object.keys(oldMatUsed).concat(Object.keys(newMatUsed)));
  const allFabricIds = new Set(Object.keys(oldFabricUsed).concat(Object.keys(newFabricUsed)));
  const allBatchIds = new Set(Object.keys(oldBatchUsed).concat(Object.keys(newBatchUsed)));
  const shortages = [];
  allMatIds.forEach(mid => {
    const delta = util.round((newMatUsed[mid] || 0) - (oldMatUsed[mid] || 0), 2);
    if (delta <= 0) return;
    const m = getMaterial(mid);
    if (!m) { shortages.push({ name: '未知物料', lack: delta }); return; }
    if ((m.quantity || 0) < delta) shortages.push({ name: m.name, lack: util.round(delta - (m.quantity || 0), 2) });
  });
  allFabricIds.forEach(mid => {
    const m = getMaterial(mid);
    if (!m) { shortages.push({ name: '未知面料', lack: '库存异常' }); return; }
    const oldRect = oldFabricRects[mid];
    const newRect = newFabricRects[mid];
    const rectChanged = newRect && (!oldRect || oldRect.length !== newRect.length
      || oldRect.width !== newRect.width || piecesSig(oldRect) !== piecesSig(newRect));
    if (rectChanged) {
      // 模拟先退回旧面积，再切新矩形
      const sim = { pieces: (m.pieces || []).slice(), fabricWidth: m.fabricWidth };
      const oldArea = oldFabricUsed[mid] || 0;
      if (oldArea > 0) {
        const w = m.fabricWidth || 100;
        // V95：这是**模拟**用的临时片（只为判断放不放得下），同样带上出处 ——
        //      免得「模拟里造过没出处的片」变成日后照抄的坏样板
        sim.pieces = sim.pieces.concat(mkPiece(oldArea / w, w, 'remnant', w,
          detachOrigin(m, oldArea, '库存校验模拟 · 不落盘')));
      }
      if (canCutTimes(sim, newRect.length, newRect.width) < 1) shortages.push({ name: m.name, lack: ' 1 件裁剪空间不足' });
      return;
    }
    const delta = util.round((newFabricUsed[mid] || 0) - (oldFabricUsed[mid] || 0), 2);
    if (delta <= 0) return;
    const rect = newFabricRects[mid];
    if (rect && !oldFabricUsed[mid]) {
      if (canCutTimes(m, rect.length, rect.width) < 1) shortages.push({ name: m.name, lack: ' 1 件裁剪空间不足' });
    } else if (fabricArea(m) < delta) {
      shortages.push({ name: m.name, lack: util.round(delta - fabricArea(m), 2) + 'cm²' });
    }
  });
  allBatchIds.forEach(mid => {
    const delta = util.round((newBatchUsed[mid] || 0) - (oldBatchUsed[mid] || 0), 2);
    if (delta <= 0) return;
    const m = getMaterial(mid);
    if (!m) { shortages.push({ name: '未知物料', lack: delta }); return; }
    if (util.round(m.batchRemain || 0, 2) < delta) shortages.push({ name: m.name, lack: util.round(delta - (m.batchRemain || 0), 2) + displayUnit(m.batchUnit) });
  });
  if (shortages.length) throw { code: 'SHORT', msg: '物料库存不足，无法保存成品', shortages };

  // 执行扣减/返还
  allMatIds.forEach(mid => {
    const delta = util.round((newMatUsed[mid] || 0) - (oldMatUsed[mid] || 0), 2);
    if (delta === 0) return;
    const m = getMaterial(mid);
    if (!m) return;
    const unit = unitCost(m);
    if (delta > 0) {
      const cost = util.round(unit * delta, 2);
      m.quantity = util.round((m.quantity || 0) - delta, 2);
      saveMaterial(m);
      const balance = stockValue(m);
      addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'out', qty: delta, balance, remark: '成品《' + p.name + '》BOM 扣减', source: 'cut', relatedProductId: p.id, unitCost: unit, totalPrice: cost, priceMode: 'each' });
    } else {
      const back = -delta;
      const value = util.round(unit * back, 2);
      m.quantity = util.round((m.quantity || 0) + back, 2);
      saveMaterial(m);
      const balance = stockValue(m);
      addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'in', qty: back, balance, remark: '成品《' + p.name + '》BOM 调整返还', source: 'cut', relatedProductId: p.id, unitCost: unit, totalPrice: value, priceMode: 'each' });
    }
  });
  allFabricIds.forEach(mid => {
    let m = getMaterial(mid);
    if (!m) return;
    const unit = unitCost(m);
    const oldRect = oldFabricRects[mid];
    const newRect = newFabricRects[mid];
    const rectChanged = newRect && (!oldRect || oldRect.length !== newRect.length
      || oldRect.width !== newRect.width || piecesSig(oldRect) !== piecesSig(newRect));

    if (rectChanged) {
      // 矩形发生变化：先退回旧面积为整料片（旧数据无几何信息，按整片近似），再用新矩形几何裁剪
      const oldArea = oldFabricUsed[mid] || 0;
      if (oldArea > 0) {
        const value = util.round(unit * oldArea, 2);
        const w = m.fabricWidth || 100;
        // ⭐ V95：退回也要说出处（这条是按面积退 ⇒ 造片时标 way='detach'，不假装填回原洞）
        m.pieces = (m.pieces || []).concat(mkPiece(oldArea / w, w, 'remnant', w,
          detachOrigin(m, oldArea, 'BOM 调整退回 · 原洞位置无记录')));
        saveMaterial(m);
        addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'in', qty: oldArea, balance: stockValue(m), remark: '成品《' + p.name + '》BOM 调整退回', source: 'cut', relatedProductId: p.id, unitCost: unit, totalPrice: value, priceMode: 'byArea', origins: [detachOrigin(m, oldArea, 'BOM 调整退回 · 原洞位置无记录')] });
      }
      // ⭐ V122：这一行的方案是**多片**（一个物料用两块布）⇒ **逐片扣**（每片挖一次洞）。
      //   修前只按主片扣一刀 ⇒ 第二片不扣（库存虚高、成本偏低，用户报的"只扣一片布"）。
      const pl = (newRect && newRect.pieces) || null;
      if (pl && pl.length > 1) {
        pl.forEach((pc) => {
          m = getMaterial(m.id);
          const s2 = pc.pieceId ? { id: pc.pieceId, rotate: pc.rotate, at: pc.at }
            : pickCutSource(m, pc.length, pc.width);
          if (s2) {
            cutFabric(m.id, s2.id, pc.length, pc.width, '成品《' + p.name + '》裁剪', s2.rotate, p.id, s2.at);
          } else {
            // 某一片找不到落脚点：按这片面积扣（宁可少一块形状，也不能少扣料）
            consumeFabricArea(m, util.round(pc.length * pc.width, 2));
            saveMaterial(m);
          }
        });
        return;
      }
      const ch = findChosen(chosen, mid, newRect);
      const src = ch ? { id: ch.pieceId, rotate: ch.rotate } : pickCutSource(m, newRect.length, newRect.width);
      if (src) {
        cutFabric(m.id, src.id, newRect.length, newRect.width, '成品《' + p.name + '》裁剪', src.rotate, p.id);
      } else {
        // 按理校验阶段应已拦截，兜底按面积扣
        const cost = util.round(unit * (newFabricUsed[mid] || 0), 2);
        consumeFabricArea(m, newFabricUsed[mid] || 0);
        saveMaterial(m);
        addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'out', qty: newFabricUsed[mid] || 0, balance: stockValue(m), remark: '成品《' + p.name + '》裁剪', source: 'cut', relatedProductId: p.id, unitCost: unit, totalPrice: cost, priceMode: 'byArea' });
      }
      return;
    }

    const delta = util.round((newFabricUsed[mid] || 0) - (oldFabricUsed[mid] || 0), 2);
    if (delta === 0) return;
    if (delta > 0) {
      const rect = newFabricRects[mid];
      // ⭐ V122：多片同样要**逐片扣** —— 走这条分支时（fabricRects 已在、只有用量增量）
      //   最容易漏掉第二片：原来只 findChosen 找主片、扣一刀。
      const pl2 = (!oldFabricUsed[mid] && rect && rect.pieces) || null;
      if (pl2 && pl2.length > 1) {
        pl2.forEach((pc) => {
          m = getMaterial(m.id);
          const s2 = pc.pieceId ? { id: pc.pieceId, rotate: pc.rotate, at: pc.at }
            : pickCutSource(m, pc.length, pc.width);
          if (s2) {
            cutFabric(m.id, s2.id, pc.length, pc.width, '成品《' + p.name + '》裁剪', s2.rotate, p.id, s2.at);
          } else {
            consumeFabricArea(m, util.round(pc.length * pc.width, 2));
            saveMaterial(m);
          }
        });
        return;
      }
      const ch = rect && !oldFabricUsed[mid] ? findChosen(chosen, mid, rect) : null;
      const src = ch ? { id: ch.pieceId, rotate: ch.rotate } : (rect && !oldFabricUsed[mid] ? pickCutSource(m, rect.length, rect.width) : null);
      if (src) {
        cutFabric(m.id, src.id, rect.length, rect.width, '成品《' + p.name + '》裁剪', src.rotate, p.id);
        m = getMaterial(m.id);
      } else {
        const cost = util.round(unit * delta, 2);
        consumeFabricArea(m, delta);
        saveMaterial(m);
        addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'out', qty: delta, balance: stockValue(m), remark: '成品《' + p.name + '》裁剪', source: 'cut', relatedProductId: p.id, unitCost: unit, totalPrice: cost, priceMode: 'byArea' });
      }
    } else {
      const back = -delta;
      const value = util.round(unit * back, 2);
      const w = m.fabricWidth || 100;
      // ⭐ V95：同上
      m.pieces = (m.pieces || []).concat(mkPiece(back / w, w, 'remnant', w,
        detachOrigin(m, back, '调整退回余料 · 原洞位置无记录')));
      saveMaterial(m);
      addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'in', qty: back, balance: stockValue(m), remark: '成品《' + p.name + '》调整退回余料', source: 'cut', relatedProductId: p.id, unitCost: unit, totalPrice: value, priceMode: 'byArea', origins: [detachOrigin(m, back, '调整退回余料 · 原洞位置无记录')] });
    }
  });

  // 按批估量（刀口布）扣减/返还：用 kg/片 计，成本 = 用量 × 单价
  allBatchIds.forEach(mid => {
    let m = getMaterial(mid);
    if (!m) return;
    const unit = unitCost(m); // = batchUnitPrice
    const delta = util.round((newBatchUsed[mid] || 0) - (oldBatchUsed[mid] || 0), 2);
    if (delta === 0) return;
    const u = m.batchUnit || 'kg';
    if (delta > 0) {
      const cost = util.round(unit * delta, 2);
      m.batchRemain = util.round((m.batchRemain || 0) - delta, 2);
      m.totalValue = util.round(m.batchRemain * unit, 2);
      saveMaterial(m);
      const balance = stockValue(m);
      addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'out', qty: delta, balance, remark: '成品《' + p.name + '》BOM 扣减', source: 'cut', relatedProductId: p.id, unitCost: unit, totalPrice: cost, priceMode: 'byBatch', unit: u });
    } else {
      const back = -delta;
      const value = util.round(unit * back, 2);
      m.batchRemain = util.round((m.batchRemain || 0) + back, 2);
      m.totalValue = util.round(m.batchRemain * unit, 2);
      saveMaterial(m);
      const balance = stockValue(m);
      addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'in', qty: back, balance, remark: '成品《' + p.name + '》BOM 调整返还', source: 'cut', relatedProductId: p.id, unitCost: unit, totalPrice: value, priceMode: 'byBatch', unit: u });
    }
  });

  p.materialUsed = newMatUsed;
  p.fabricUsed = newFabricUsed;
  p.fabricRects = newFabricRects;
  p.batchUsed = newBatchUsed; // 按批估量/件用量，供编辑时比对增量
  p.updatedAt = util.today();
  if (!p.photos) p.photos = [];
  if (!p.id) {
    p.id = uid('p'); p.createdAt = util.today();
    p.productions = p.productions || []; p.sales = p.sales || [];
    // 新建成品默认在库 1 件（录入即生成）：商品记 sellableStock，样品记 sampleStock
    const isSample = p.nature === 'sample';
    p.sellableStock = p.sellableStock != null ? p.sellableStock : (isSample ? 0 : 1);
    p.sampleStock = p.sampleStock != null ? p.sampleStock : (isSample ? 1 : 0);
    list.push(p);
  } else {
    const i = list.findIndex(x => x.id === p.id);
    if (i >= 0) {
      const old = list[i];
      // 编辑：保留未显式传入的字段（生产记录、销售、库存、创建时间等），避免整体替换导致丢失
      p.productions = p.productions != null ? p.productions : (old.productions || []);
      p.sales = p.sales != null ? p.sales : (old.sales || []);
      p.sellableStock = p.sellableStock != null ? p.sellableStock : (old.sellableStock || 0);
      p.sampleStock = p.sampleStock != null ? p.sampleStock : (old.sampleStock || 0);
      p.createdAt = old.createdAt || util.today();
      list[i] = Object.assign({}, old, p);
    } else {
      list.push(p);
    }
  }
  set(KEYS.PRODUCTS, list);
  return p;
}

function removeProduct(id) {
  // 兜底拦截：防止其它调用方绕过页面预判，有在库直接拦下
  const products = getProducts();
  const p = products.find(x => x.id === id);
  if (p && ((p.sellableStock || 0) > 0 || (p.sampleStock || 0) > 0)) {
    throw { code: 'HAS_STOCK', msg: '该成品仍有在库，请先处理库存后再删除' };
  }
  set(KEYS.PRODUCTS, products.filter(x => x.id !== id));
}

// 检查成品 BOM 按 qty 件生产时物料是否足够
// BOM 库存校验。
// overrides（2026-09-27 V74，可选）：{ materialId: 数量 }「这批实际用掉多少」——
//   必须按**实际用量**校验：否则会出现"预检过了、扣料时才炸"，
//   或者反过来（用户把整块布填进来，标准用量够、实际不够却没被拦住）。
function checkBomStock(p, qty, overrides) {
  qty = util.round(qty, 2);
  if (qty <= 0) throw { code: 'QTY', msg: '数量需大于0' };
  const ov = overrides || null;
  const ovOf = (b) => (ov && b.materialId && ov[b.materialId] != null) ? ov[b.materialId] : null;
  const shortages = [];
  (p.bom || []).forEach(b => {
    const m = getMaterial(b.materialId);
    if (!m) { shortages.push({ name: b.materialName, lack: '物料不存在' }); return; }
    const ovRaw = ovOf(b);
    // 覆盖只有一种形态：**数值**（这一批实际用掉多少）—— 面积行 / 刀口布 / 普通辅料。
    // ⚠️ 2026-09-30 V92：原先还有 { mode:'merged', length, width }（V77 的「合起来剪」），
    //   那条路已退场 —— "这批合起来裁一块"现在在**裁剪界面**里做（片数减到 1、填上那块的长宽）。
    const over = (ovRaw != null && typeof ovRaw === 'number') ? util.round(ovRaw, 2) : null;
    const fabric = b.isFabric || isMaterialFabric(m);
    if (fabric) {
      // 按批估量（刀口布）：按 件用量(kg/片) × qty 校验剩余
      if (m.stockMode === 'batch') {
        const need = over != null ? over : util.round((b.batchUsage || 0) * qty, 2);
        if (need <= 0) return;
        if (util.round(m.batchRemain || 0, 2) < need) shortages.push({ name: m.name, lack: util.round(need - (m.batchRemain || 0), 2) + displayUnit(m.batchUnit) });
        return;
      }
      const redLen = util.round(b.length || 0, 2), redWid = util.round(b.width || 0, 2);
      const rect = redLen > 0 && redWid > 0;
      // 数值覆盖：只可能来自「面积面料行」（几何行不进那个面板 —— V92，刀口布走上面的分支），
      //   所以这里不会再出现"几何行 + 覆盖"的组合；有长宽的行走下面的标准校验。
      if (over != null) {
        if (over <= 0) return;                    // 填 0 = 这批没用这个料，不用校验库存
        if (fabricArea(m) < over) shortages.push({ name: m.name, lack: util.round(over - fabricArea(m), 2) + 'cm²' });
        return;
      }
      if (rect) {
        const times = canCutTimes(m, redLen, redWid);
        if (times < qty) shortages.push({ name: m.name, lack: (qty - times) + ' 件裁剪空间不足' });
      } else {
        const need = util.round((b.area || 0) * qty, 2);
        if (need <= 0) return;
        if (fabricArea(m) < need) shortages.push({ name: m.name, lack: util.round(need - fabricArea(m), 2) + 'cm²' });
      }
    } else {
      const need = over != null ? over : util.round((b.usage || 0) * qty, 2);
      if (need <= 0) return;
      if ((m.quantity || 0) < need) shortages.push({ name: m.name, lack: util.round(need - (m.quantity || 0), 2) + (m.unit || '个') });
    }
  });
  return shortages;
}

// 执行 BOM 扣减（按 qty 件），返回扣减明细
// opts.overrides（2026-09-27 V74，可选）：{ materialId: 数量 }「这批实际用掉多少」。
//   ⭐ 为什么只需要这一个口子：系统契约是「**扣了多少料，这批成本就是多少**」
//      （produceProduct 把本次扣料流水金额汇成 batchCost）——
//      所以只要扣的量对了，库存与成本同时就对了，成本公式一行都不用改。
//   传了覆盖的行：面积类**直接按面积扣**（不再走几何裁剪选片），刀口布/普通料按覆盖量扣。
//   没传的行：与以前完全一致（零回归）。
function consumeBom(p, qty, remark, relatedProductId, opts) {
  qty = util.round(qty, 2);
  const ov = (opts && opts.overrides) || null;
  // 逐件裁剪方案（2026-09-29 V78）：[[第 1 件各物料的选择], [第 2 件…], …]
  //   用户是「一件一件确认」的（每件自己选从哪块布剪、怎么摆），所以执行时也按件取方案。
  //   老格式（每个物料一条、不区分件）仍然兼容 —— 见下面的 perPiece = null 分支。
  const chosen = opts && opts.chosenSchemes;
  // 逐件选择有两种传法，都要认（2026-09-29 V80 热修）：
  //   ① 显式的 perPiece 参数（页面回传的就是这个形状，入口按第 6 个参数传下来）
  //   ② 老传法：整包塞在 chosenSchemes 里（第一项是数组 ⇒ 说明是逐件结构）
  // 只认 ② 是不够的：入口改成传 ① 之后，用户的逐件选择会被**静默丢掉**、退回系统自动取片。
  const perPiece = (opts && opts.perPiece)
    || ((Array.isArray(chosen) && chosen.length && Array.isArray(chosen[0])) ? chosen : null);
  const details = [];
  (p.bom || []).forEach(b => {
    let m = getMaterial(b.materialId);
    if (!m) return;
    const ovRaw = (ov && b.materialId && ov[b.materialId] != null) ? ov[b.materialId] : null;
    // 覆盖只有一种形态：**数值**（这一批实际用掉多少）—— 面积行 / 刀口布 / 普通辅料。
    // ⚠️ 2026-09-30 V92：原先还有 { mode:'merged', length, width }（V77 的「合起来剪」），
    //   那条路已退场 —— "这批合起来裁一块"现在在**裁剪界面**里做（片数减到 1、填上那块的长宽）。
    const over = (ovRaw != null && typeof ovRaw === 'number') ? util.round(ovRaw, 2) : null;
    const fabric = b.isFabric || isMaterialFabric(m);
    if (fabric) {
      // 按批估量（刀口布）：手动填用量（每件 kg/片），按比例扣减，不走几何裁剪
      if (m.stockMode === 'batch') {
        const use = over != null ? over : util.round((b.batchUsage || 0) * qty, 2);
        if (use <= 0) return;
        if (util.round(m.batchRemain || 0, 2) < use) throw { code: 'NOFABRIC', msg: '刀口布《' + m.name + '》剩余不足，无法扣减' };
        const unit = unitCost(m); // = batchUnitPrice
        const cost = util.round(unit * use, 2);
        // ⭐ V95：刀口布的出处 = 从哪几批里出的（同 outbound：先取批次、再减账）
        const drew = drawBatchLots(m, use);
        m.batchRemain = util.round((m.batchRemain || 0) - use, 2);
        m.totalValue = util.round(m.batchRemain * unit, 2);
        const bOrg = origin.mk({
          materialId: m.id, way: 'batch', rect: null, area: use, lots: drew.lots,
          note: drew.left > 0 ? '有 ' + drew.left + ' 未追溯到批次' : ''
        });
        saveMaterial(m);
        const u = m.batchUnit || 'kg';
        addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'out', qty: use, balance: stockValue(m), remark: remark || '成品生产', source: 'cut', relatedProductId, unitCost: unit, totalPrice: cost, priceMode: 'byBatch', unit: u, origins: [bOrg] });
        details.push({ materialId: m.id, name: m.name, qty: use, unit: u, origins: [bOrg] });
        return;
      }
      const redLen = util.round(b.length || 0, 2), redWid = util.round(b.width || 0, 2);
      const hasRect = redLen > 0 && redWid > 0;
      let consumedArea = 0;
      const matOrigins = [];   // ⭐ V95：这一行面料**动了哪几片布的哪几个位置**（给成品记录与导出用）
      // 同一批扣料**只取一次单价**：移动加权平均在"等比扣减"下本就不变
      // （扣掉 10% 的料就扣掉 10% 的钱），所以逐件扣与一次扣的金额必然一致。
      // 每次重算会多一次受"总值由流水派生"影响的机会 —— 数据一致时结果相同，
      // 不一致时（例如测试直接塞进来的物料）就会漂，没必要冒这个险。
      const unitOnce = unitCost(m);
      // 「按面积扣一次」的唯一收口：覆盖 / 报废 / 逐件 / 余量 都走它，免得写四遍写歪
      //   note：这一笔在账面/界面上的说法（不传则沿用调用方给的备注）
      const consumeAreaOnce = (amt, note) => {
        m = getMaterial(m.id);                 // 上一次扣减已落盘，重新读取布片
        if (!m) return;
        // ⭐ V95：把「挖了哪几片布的哪几个位置」原样带进流水（面积口径不变，出处不能缺）
        const consumed = consumeFabricArea(m, amt);
        const srcs = (consumed && consumed.origins) || [];
        matOrigins.push.apply(matOrigins, srcs);
        saveMaterial(m);
        addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'out', qty: amt, balance: stockValue(m), remark: note || remark || '成品生产', source: 'cut', relatedProductId, unitCost: unitOnce, totalPrice: util.round(unitOnce * amt, 2), priceMode: 'byArea', origins: srcs });
        consumedArea = util.round(consumedArea + amt, 2);
      };
      const per = util.round(Number(b.area) || 0, 2);
      if (!hasRect && per <= 0) return;
      if (hasRect) {
        // ⭐ 有长宽的面料几何行：按**用户给定的那批"刀"**扣。
        //    （2026-09-30 V92：V77 的「一件一件剪 / 合起来剪」两种剪法已退场 ——
        //      "这批合起来裁一块"现在在裁剪界面里做：片数减到 1、填上那块的长宽。
        //      所以这里不再有 { mode:'merged' } 那条分支。）
        // **按 materialId 认**（不拿 BOM 行的 rect 去匹配尺寸 ——
        // V90 的教训：那个值一旦能被用户改，匹配就会落空，然后**静默**改用系统自己挑的布）。
        // 优先级：本批逐件选择（perPiece）> BOM 行落下的方案（chosen）。
        let cuts = [];
        if (perPiece) {
          (perPiece || []).forEach((rows) => {
            (rows || []).forEach((c) => { if (c && c.materialId === b.materialId) cuts.push(c); });
          });
        }
        if (!cuts.length) {
          cuts = (chosen || []).filter((x) => x && x.materialId === b.materialId);
        }
        if (!cuts.length) {
          // ⭐ V122：谁也没显式给方案时，用**这一行自己存的**裁剪方案（用户当初排好的"每件几片"）。
          //   修前这里直接落到"按主片自动挑一块布、每件一刀" ⇒ 第二片永远不扣
          //   （用户 2026-10-06：「增加成品数量，也只扣一片布」）。
          //   多片 ⇒ 每件一套刀（按件数复制）；单片/没存 ⇒ 维持老行为。
          const own = (Array.isArray(b.chosenSchemes) ? b.chosenSchemes : [])
            .filter((x) => x && Number(x.length) > 0 && Number(x.width) > 0);
          if (own.length > 1) {
            const n = Math.max(1, Math.floor(Number(qty) || 1));
            for (let k = 0; k < n; k++) {
              own.forEach((x) => {
                // ⚠️ 位置（at）只对**第一件**有效：那是用户在裁剪页亲手摆的。
                //   后续件照抄位置必然压到刚挖的洞上（真机报「你摆的位置裁不出来」）
                //   ⇒ 从第二件起清掉 at，让 cutFabric 自己找落脚点（布上没位置就自动换一块）。
                cuts.push(k === 0 ? x : Object.assign({}, x, { at: null }));
              });
            }
          }
        }
        if (cuts.length) {
          // ⚠️ **按用户给的刀数扣，不再按件数补齐**（V91）——
          //    「做 4 件只裁 1 块」是合法操作（V74「合起来剪」那件事）；
          //    若还按 qty 循环，就会被补扣 3 次、用料凭空多出来。
          cuts.forEach((c) => {
            const useL = Number(c.length) > 0 ? util.round(c.length, 2) : redLen;
            const useW = Number(c.width) > 0 ? util.round(c.width, 2) : redWid;
            const src = c.pieceId
              ? { id: c.pieceId, rotate: c.rotate, at: c.at }
              : pickCutSource(m, useL, useW);
            if (!src) throw { code: 'NOFABRIC', msg: '面料库存不足或没有可裁剪的布片（碎料需长宽均够，且不拼接）' };
            // at（用户选/拖的挖料位置，V81）：给了就按它挖，没给由 cutFabric 自动找位置
            const r = cutFabric(m.id, src.id, useL, useW, remark || '成品生产', src.rotate, relatedProductId, src.at);
            consumedArea = util.round(consumedArea + r.consumedArea, 2);
            if (r.origin) matOrigins.push(r.origin);     // ⭐ V95：裁剪那条路的出处
            m = getMaterial(m.id); // cutFabric 已落盘，重新读取
          });
        } else {
          // 谁也没指定（老路径）：按件数**自动挑**紧配的布
          for (let i = 0; i < qty; i++) {
            const src = pickCutSource(m, redLen, redWid);
            if (!src) throw { code: 'NOFABRIC', msg: '面料库存不足或没有可裁剪的布片（碎料需长宽均够，且不拼接）' };
            const r = cutFabric(m.id, src.id, redLen, redWid, remark || '成品生产', src.rotate, relatedProductId);
            consumedArea = util.round(consumedArea + r.consumedArea, 2);
            if (r.origin) matOrigins.push(r.origin);     // ⭐ V95：自动挑布那条路的出处
            m = getMaterial(m.id); // cutFabric 已落盘，重新读取
          }
        }
      } else if (over != null) {
        // 只填了面积（没填长×宽 ⇒ 压根没有形状可用，无从几何剪裁）：按用户填的总量一次扣掉
        if (over <= 0) return;
        consumeAreaOnce(over);
      } else {
        // ⭐ 只填了面积（没填长×宽）：按「每件面积」**逐件扣、每件一笔流水**。
        //   面积法本来就不掌握形状（不知道裁成几条），所以逐件扣与一次性扣总面积
        //   在面积/金额上**完全等价**；但一次性扣只留一笔账，看起来像"做了 5 件只剪了一刀"
        //   （用户 2026-09-28 真机反馈）。逐件扣把"剪了几件"留在账上，才对得上心智。
        const whole = Math.floor(qty);
        const rest = util.round(qty - whole, 2);   // 不足一件的余量（正常不会出现，保底处理）
        for (let i = 0; i < whole; i++) consumeAreaOnce(per);
        if (rest > 0) consumeAreaOnce(util.round(per * rest, 2));
      }
      details.push({ materialId: m.id, name: m.name, qty: consumedArea, unit: 'cm²', origins: matOrigins });
    } else {
      const need = over != null ? over : util.round((b.usage || 0) * qty, 2);
      if (need <= 0) return;
      const unit = unitCost(m);
      const cost = util.round(unit * need, 2);
      m.quantity = util.round((m.quantity || 0) - need, 2);
      saveMaterial(m);
      const balance = stockValue(m);
      addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'out', qty: need, balance, remark: remark || '成品生产', source: 'cut', relatedProductId, unitCost: unit, totalPrice: cost, priceMode: 'each' });
      details.push({ materialId: m.id, name: m.name, qty: need, unit: m.unit || '个' });
    }
  });
  return details;
}

// 增加成品库存：输入数字 n，按 BOM 扣除 n 倍物料，成品 stock += n
// overrides（2026-09-27 V74，可选）：{ materialId: 数量 }「这批实际用掉多少」。
//   ⭐ 为什么成本公式不用改：batchCost 是**从本次产生的扣料流水汇总**出来的，
//      所以扣料量对了，单件实际成本（= batchCost / qty）自动就反映了损耗与报废。
// perPiece（2026-09-29 V80 热修，可选）：**逐件**的裁剪选择 —— [第几件][第几个面料行]。
// 选片页是逐件确认的，用户每一件选的方案都在这里。不接这个参数的话，
// 页面回传的嵌套数组会被当成扁平数组用 ⇒ **用户选的方案被静默忽略**（V78 留下的坑）。
function produceProduct(productId, qty, chosenSchemes, target, overrides, perPiece) {
  const list = getProducts();
  const p = list.find(x => x.id === productId);
  if (!p) throw { code: 'NOPROD', msg: '成品不存在' };
  qty = util.round(qty, 2);
  if (qty <= 0) throw { code: 'QTY', msg: '生产数量需大于0' };
  const shortages = checkBomStock(p, qty, overrides);
  if (shortages.length) throw { code: 'SHORT', msg: '物料库存不足，无法增加成品数量', shortages };

  // 记录流水起点，用于统计本次生产实际扣掉的物料金额
  const flowsBefore = getFlows().length;
  const consumeDetails = consumeBom(p, qty, '增加成品《' + p.name + '》库存', p.id,
    { chosenSchemes: chosenSchemes || null, overrides: overrides || null, perPiece: perPiece || null });
  // ⭐ 生产批次的实际成本 = 本次生产产生的全部物料扣减流水金额之和
  //    与物料扣减**完全对齐**（生产扣了多少，成本就是多少），不再依赖事后按当前价重算
  const batchCost = util.round(getFlows().slice(flowsBefore).reduce(function (s, f) {
    return s + (f && f.materialId ? (Number(f.totalPrice) || 0) : 0);
  }, 0), 2);

  // 默认入「商品库」（可售）；target='sample' 时入样品库（样品页的「增加数量」）
  if (target === 'sample') p.sampleStock = util.round((p.sampleStock || 0) + qty, 2);
  else p.sellableStock = util.round((p.sellableStock || 0) + qty, 2);
  p.productions = p.productions || [];
  p.productions.push({
    id: uid('pp'),                                          // 稳定标识：退产按 id 定位（下标会因重排指错）
    date: util.today(),
    qty: qty,
    cost: batchCost,                                        // 本次生产实际耗用金额
    unitCost: qty > 0 ? util.round(batchCost / qty, 6) : 0, // 本次单件实际成本
    // ⭐ V95：这一批**到底动了哪些布的哪些位置**。存下来退产/追溯才有得查
    //    （用户：「这样才能从头到尾所有的流程能追溯」）。老记录没有这个字段 = 老数据，不假装有。
    origins: (consumeDetails || []).reduce(function (a, d) { return a.concat((d && d.origins) || []); }, [])
  });
  set(KEYS.PRODUCTS, list);
  return p;
}

// ⭐ 成品的「实际单位成本」：由生产批次的实际扣料金额加权平均得出
//    与物料扣减流水完全对齐 —— 生产时扣了多少，成本就是多少。
//    只统计带 cost 字段的生产记录：老数据没有该字段，自动回退到估算，**不凭空造数**。
//    返回 null 表示没有可靠的实际成本（调用方应回退到估算并在界面标注）
function productActualUnitCost(p) {
  const prods = (p && p.productions) || [];
  let totalCost = 0, totalQty = 0;
  prods.forEach(function (pr) {
    if (!pr || typeof pr.cost !== 'number') return;   // 老数据无成本字段，跳过
    totalCost += pr.cost;
    totalQty += util.round(Number(pr.qty) || 0, 2);
  });
  if (totalQty <= 0) return null;
  return util.round(totalCost / totalQty, 6);
}

// 成品销售：减库存、记录销售流水；样品/作品集不计算利润，只按成本扣除
// client（2026-09-27 D76 新增，可选）：卖给谁 —— 用于「成品出入库」页与全链路追溯。
//   传空/不传 = 空串（老数据没有该字段，读取侧一律兜底成空串，不要出现 undefined）
function sellProduct(productId, qty, price, date, client) {
  const list = getProducts();
  const p = list.find(x => x.id === productId);
  if (!p) throw { code: 'NOPROD', msg: '成品不存在' };
  qty = util.round(qty, 2);
  if (qty <= 0) throw { code: 'QTY', msg: '售出数量需大于0' };
  if ((p.sellableStock || 0) < qty) throw { code: 'NOSTOCK', msg: '成品库存不足，无法卖出' };
  const c = require('./calc.js').computeProduct(p);
  // 可售：正常计利润；样品/作品集（非卖）：利润恒为 0，成本按售价锁定，不计入利润统计
  const isSellable = p.nature === 'merchandise';
  // ⭐ 成本口径（Day 2 修正）：优先用「生产时的实际成本」（与扣料流水对齐）；
  //    没有生产记录（老数据/纯设计稿）才回退到「按当前物料价估算」，并标记 isEstimate=true
  const actualUnit = productActualUnitCost(p);
  const hasActual = actualUnit != null;
  const unitTotal = hasActual ? actualUnit : util.round(c.totalCost, 2);
  // ⚠️ 注意：costSnapshot.totalCost 的既有语义是「单件成本」，
  //    所有统计都按 数量 × (售价 − 单件成本) 计利润（见 stat.saleProfit / calc.dashboardMetrics）。
  //    千万不要改成整单总成本 —— 那会让多件销售的利润被算错（本次测试抓到过）。
  const costSnapshot = {
    totalCost: isSellable ? util.round(unitTotal, 2) : price,
    unitCost: unitTotal,
    isEstimate: isSellable ? !hasActual : false,
    materialCost: c.materialCost,
    laborCost: isSellable ? c.laborCost : 0,
    packaging: isSellable ? c.packaging : 0,
    shipping: isSellable ? c.shipping : 0
  };
  p.sales = p.sales || [];
  p.sales.push({
    id: uid('ps'), qty: qty, price: price, date: date || util.today(),
    client: String(client == null ? '' : client).trim(),   // 卖给谁（可空）；老数据无此字段
    costSnapshot: costSnapshot
  });
  p.sellableStock = util.round((p.sellableStock || 0) - qty, 2);
  if (isSellable) p.saleStatus = 'sold';
  set(KEYS.PRODUCTS, list);
  return p;
}

// 成品转类（按件）：在 sellableStock / sampleStock 之间搬运 qty 件。
// fromNature/toNature ∈ {'merchandise'（商品）| 'sample'（样品）}，仅用于挑选来源/目标库存，
// 不修改 p.nature（nature 表示该设计创建时的类型，单一 SKU 可同时持有两类库存）。
function transferProduct(productId, fromNature, toNature, qty) {
  const list = getProducts();
  const p = list.find(x => x.id === productId);
  if (!p) throw { code: 'NOPROD', msg: '成品不存在' };
  qty = util.round(qty || 1, 2);
  if (qty <= 0) throw { code: 'QTY', msg: '数量需大于0' };
  const fromStock = fromNature === 'sample' ? (p.sampleStock || 0) : (p.sellableStock || 0);
  if (util.round(fromStock, 2) < qty) throw { code: 'NOSTOCK', msg: '转出数量超过在库' };
  if (fromNature === 'sample') p.sampleStock = util.round(p.sampleStock - qty, 2);
  else p.sellableStock = util.round(p.sellableStock - qty, 2);
  if (toNature === 'sample') p.sampleStock = util.round((p.sampleStock || 0) + qty, 2);
  else p.sellableStock = util.round((p.sellableStock || 0) + qty, 2);
  set(KEYS.PRODUCTS, list);
  return p;
}

// 样品出库（销毁 / 自用 / 赠送…）：只减样品库存 + 记一笔成本，**不产生利润**。
// 与 sellProduct 的区别：不写 sales、不改 saleStatus，看板的已售数 / 毛利 / 净收益都不受影响；
// 成本只落在 discards 里备查（样品本来就已经在创建时计过料了，这里不再重复扣料）。
function discardSample(productId, qty, reason, date, remark) {
  const list = getProducts();
  const p = list.find(x => x.id === productId);
  if (!p) throw { code: 'NOPROD', msg: '成品不存在' };
  qty = util.round(qty, 2);
  if (qty <= 0) throw { code: 'QTY', msg: '出库数量需大于0' };
  if (util.round(p.sampleStock || 0, 2) < qty) throw { code: 'NOSTOCK', msg: '样品数量不足' };
  // ⭐ 同销售：优先用「生产时的实际成本」，没有生产记录才按当前物料价估算
  const actualUnit = productActualUnitCost(p);
  const isEstimate = actualUnit == null;
  const unit = util.round(actualUnit != null ? actualUnit : require('./calc.js').computeProduct(p).totalCost, 2);
  p.discards = p.discards || [];
  p.discards.push({
    qty: qty,
    reason: reason || '其他',
    remark: remark || '',
    date: date || util.today(),
    unitCost: unit,
    totalCost: util.round(unit * qty, 2),
    isEstimate: isEstimate
  });
  p.sampleStock = util.round((p.sampleStock || 0) - qty, 2);
  set(KEYS.PRODUCTS, list);
  return p;
}

// ⚠️ 2026-10-11 V137：删除 `ingressFromInspiration / ingressFromWant` 两个函数。
//    它们与老的 convert* 是同一类东西 —— **直接 saveProduct({ bom: [] })**，
//    产出"物料栏全空"的成品，还会把来源记录一并**删掉**（比 convert* 更狠）。
//    全项目搜过：**只有定义与导出、没有任何调用点** ⇒ 属死代码；
//    留着就是"第二个能生成空 BOM 成品的入口"，迟早有人顺手调它。
//    「转为成品」现在统一走：buildProductDraftFromSource（预填）+ markSourceConverted（保存后标记）。

// ===================== 「转为成品」= 预填成品编辑页（2026-10-11 V137） =====================
// 用户拍板（原话）：「想做清单和灵感转成成品的时候，**不是直接转成成品就可以了**，而是把名字
//   之类的信息**填到成品编辑里**，之后的**物料选择之类的信息我还要填呢**，要不然成品保存了，
//   **物料那一栏都是空的**」。
// 拍板细节：① 「样品 / 待售商品」二选一弹窗**取消**（编辑页本来就有「商品 / 样品」开关）；
//          ② **保存成功才**把来源标「已完成」并回填关联（中途退出 ⇒ 来源仍是"待填坑"）；
//          ③ 图片与（隐藏的）图文教程**照旧带过去**（不动隐藏界面 ⇒ 不丢数据）。
//
// ⚠️ 旧实现 `convertWant / convertInspiration` 是**直接落库**的：
//    saveProduct({ bom: [] }) ⇒ 生成的成品物料栏全空，用户还得回头补料；
//    更糟的是它**绕过了成品编辑页"至少一项物料"的校验**（edit.js 的 save 里那道）。
// ⇒ 现在拆成两个**无副作用 / 单一职责**的小步骤，中间由「成品编辑页」承担选料：
//      ① buildProductDraftFromSource(kind, sid) —— 只产出**预填草稿**（不写任何存储）
//      ② markSourceConverted(kind, sid, productId) —— **保存成功后**才标来源
function sourceRecord(kind, sid) {
  if (!sid) return null;
  if (kind === 'want') return getWants().find(x => x.id === sid) || null;
  if (kind === 'inspiration') return getInspirations().find(x => x.id === sid) || null;
  return null;
}

// 预填草稿：字段与「成品编辑页」的表单一一对应（页面拿它 setData）
// 找不到来源 ⇒ 返回 null（调用方按"普通新建"处理，绝不半填）
function buildProductDraftFromSource(kind, sid) {
  const it = sourceRecord(kind, sid);
  if (!it) return null;
  const isWant = kind === 'want';
  return {
    name: it.title || (isWant ? '未命名想做' : '未命名灵感'),
    photos: (it.photos || []).slice(),
    tutorial: buildTutorialFromSource(it),   // 正文取自原描述、首图带过去；界面上仍是隐藏状态
    notes: isWant ? '由想做转入' : '由灵感转入',
    sourceKind: kind,
    sourceId: sid
  };
}

// 保存成功后调用：把来源标「已完成」+ 回填关联成品 id。
// ⚠️ **中途退出不会走到这里** —— 这正是用户要的口径（没保存就不算已填坑）。
// 保留原记录、不删除（老行为：删除=丢资料，用户没要求改）。
function markSourceConverted(kind, sid, productId) {
  const it = sourceRecord(kind, sid);
  if (!it || !productId) return null;
  it.status = 'done';
  it.convertedProductId = productId;
  if (kind === 'want') saveWant(it); else saveInspiration(it);
  return it;
}

// 删除单条销售记录：返还库存、从利润统计中剔除该笔（成本快照不再计入）
function deleteSale(productId, saleId) {
  const list = getProducts();
  const p = list.find(x => x.id === productId);
  if (!p) throw { code: 'NOPROD', msg: '成品不存在' };
  const sales = p.sales || [];
  // 按 id 定位（新记录都有 id）；老数据无 id 时回退为下标（兼容传入数字）
  let idx = sales.findIndex(s => s.id && s.id === saleId);
  if (idx < 0 && typeof saleId === 'number') idx = saleId;
  if (idx < 0 || idx >= sales.length) throw { code: 'BAD', msg: '该销售记录不存在' };
  const s = sales[idx];
  p.sellableStock = util.round((p.sellableStock || 0) + util.round(s.qty, 2), 2);
  sales.splice(idx, 1);
  p.sales = sales;
  if (sales.length === 0 && p.saleStatus === 'sold') p.saleStatus = 'available';
  set(KEYS.PRODUCTS, list);
  return p;
}

// 反向返还 BOM 物料（退产用）：非面料加回数量，面料按面积加回整片余料
function returnBom(p, qty) {
  qty = util.round(qty, 2);
  (p.bom || []).forEach(b => {
    let m = getMaterial(b.materialId);
    if (!m) return;
    const fabric = b.isFabric || isMaterialFabric(m);
    if (fabric && util.bomIsBatchLine(b, m)) {
      // 刀口布：按每件用量加回 batchRemain。面积口径会凭空造出「余料片」（2026-09-12 修复）
      const use = util.round((b.batchUsage || 0) * qty, 2);
      if (use <= 0) return;
      const unit = unitCost(m);
      m.batchRemain = util.round((m.batchRemain || 0) + use, 2);
      m.totalValue = util.round(m.batchRemain * unit, 2);
      syncBatchLots(m);               // ⭐ V95：加回的量记到「未追溯」批（如实标，不摊给已知批次）
      saveMaterial(m);
      addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'in', qty: use, balance: stockValue(m), remark: '成品《' + p.name + '》退产返还', source: 'cut', relatedProductId: p.id, unitCost: unit, totalPrice: util.round(unit * use, 2), priceMode: 'byBatch', unit: m.batchUnit || 'kg', origins: [batchBackOrigin(m, use)] });
    } else if (fabric) {
      const redLen = util.round(b.length || 0, 2), redWid = util.round(b.width || 0, 2);
      const hasRect = redLen > 0 && redWid > 0;
      const back = hasRect ? util.round(redLen * redWid * qty, 2) : util.round((b.area || 0) * qty, 2);
      if (back <= 0) return;
      const w = m.fabricWidth || 100;
      // ⭐ V95：退回也要说出处。这条是**按面积退**（找不到原洞的记录）⇒ 造片时如实标 way='detach'
      m.pieces = (m.pieces || []).concat(mkPiece(back / w, w, 'remnant', w,
        detachOrigin(m, back, '退产返还 · 原洞位置无记录')));
      saveMaterial(m);
      addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'in', qty: back, balance: stockValue(m), remark: '成品《' + p.name + '》退产返还', source: 'cut', relatedProductId: p.id, unitCost: unitCost(m), totalPrice: util.round(unitCost(m) * back, 2), priceMode: 'byArea', origins: [detachOrigin(m, back, '退产返还 · 原洞位置无记录')] });
    } else {
      const need = util.round((b.usage || 0) * qty, 2);
      if (need <= 0) return;
      m.quantity = util.round((m.quantity || 0) + need, 2);
      saveMaterial(m);
      addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'in', qty: need, balance: stockValue(m), remark: '成品《' + p.name + '》退产返还', source: 'cut', relatedProductId: p.id, unitCost: unitCost(m), totalPrice: util.round(unitCost(m) * need, 2), priceMode: 'each' });
    }
  });
}

// 退产：撤销某条生产记录，返还 BOM 物料并扣减库存（库存不足则拒绝，避免负库存）
function undoProduce(productId, prodId) {
  const list = getProducts();
  const p = list.find(x => x.id === productId);
  if (!p) throw { code: 'NOPROD', msg: '成品不存在' };
  const prods = p.productions || [];
  // 按 id 定位（新记录都有 id）；老数据无 id 时回退为下标（兼容传入数字）
  let idx = prods.findIndex(pr => pr.id && pr.id === prodId);
  if (idx < 0 && typeof prodId === 'number') idx = prodId;
  if (idx < 0 || idx >= prods.length) throw { code: 'BAD', msg: '该生产记录不存在' };
  const pr = prods[idx];
  const qty = util.round(pr.qty, 2);
  if (util.round((p.sellableStock || 0), 2) < qty) throw { code: 'STOCK', msg: '当前库存不足，无法退产（可能已有部分售出）' };
  returnBom(p, qty);
  p.sellableStock = util.round((p.sellableStock || 0) - qty, 2);
  prods.splice(idx, 1);
  p.productions = prods;
  set(KEYS.PRODUCTS, list);
  return p;
}

/* ===================== 排单（M1-21, A.9） ===================== */
function getCommissions() { return get(KEYS.COMMISSIONS, []); }
function getCommission(id) { return getCommissions().find(x => x.id === id); }
function saveCommission(c) {
  const list = getCommissions();
  if (c.id) { const i = list.findIndex(x => x.id === c.id); if (i >= 0) list[i] = c; else list.push(c); }
  else { c.id = uid('cm'); c.deliveredQty = 0; c.status = 'active'; c.createdAt = util.today(); list.push(c); }
  set(KEYS.COMMISSIONS, list); return c;
}
function removeCommission(id) { set(KEYS.COMMISSIONS, getCommissions().filter(x => x.id !== id)); }

// 取消排单：只改状态 —— 已交付记录与已出库的物料流水都保留。
// 口径收口在这里：详情页与列表左滑都走它，避免"同一语义在两处各写一遍"（历史教训：
// 同一判定散在多处，改一处漏一处）。失败抛 {code,msg}，与 store 其余写接口一致。
function cancelCommission(id) {
  const c = getCommission(id);
  if (!c) throw { code: 'NOCOM', msg: '排单不存在' };
  c.status = 'cancelled';
  saveCommission(c);
  return c;
}

// 指派成品并抵消排单（V149 起：**先选货从哪来**）
//   opts.fromStock = 'product'  ：从成品在库出 —— 不扣料，写销售记录（客户＝排单客户）
//   opts.fromStock = 'material' ：现做现交（默认）—— 先按裁剪方案生产（扣料），再出库
//   opts.perPiece               ：用户在裁剪页**逐件选的**方案（现做现交时传；
//                                 需要排版而没带方案 ⇒ 上层应拦在裁剪页，绝不在这里自动刨布）
// ⚠️ 两条路径都不再自己手写扣料：走 produceProduct / sellProduct ⇒ 与本项目其它入口同一套账。
function assignCommission(commissionId, deliverQty, opts) {
  const list = getCommissions();
  const c = list.find(x => x.id === commissionId);
  if (!c) throw { code: 'NOCOM', msg: '排单不存在' };
  if (!c.productId) throw { code: 'NOPROD', msg: '排单未关联成品' };
  deliverQty = util.round(deliverQty, 2);
  if (deliverQty <= 0) throw { code: 'QTY', msg: '交付数量需大于0' };
  if (deliverQty > (c.qty - (c.deliveredQty || 0))) throw { code: 'OVER', msg: '交付数量超过排单余量' };

  const fromStock = (opts && opts.fromStock) === 'product' ? 'product' : 'material';
  const unitPrice = Number(c.price) || 0;
  const client = c.client || '';

  let prodId = '';
  let saleId = '';
  let origins = [];

  if (fromStock === 'product') {
    // A · 从成品在库出：货早就做好了 —— 只出库，不再扣料
    const p0 = getProduct(c.productId);
    if (!p0) throw { code: 'NOPROD', msg: '关联成品不存在' };
    const have = util.round(p0.sellableStock || 0, 2);
    if (have < deliverQty) throw { code: 'NOSTOCK', msg: '成品在库不足（当前在库 ' + have + ' 件）' };
    const pAfter = sellProduct(c.productId, deliverQty, unitPrice, util.today(), client);
    const sales = (pAfter && pAfter.sales) || [];
    saleId = (sales[sales.length - 1] || {}).id || '';
  } else {
    // B · 从物料出（现做现交）：先生产（按用户选的裁剪方案扣料），再出库
    // ⚠️ 需要裁剪的面料行**必须**带用户选的方案 —— 否则 produceProduct 会静默自动取片，
    //    等于又回到"系统替你决定从哪块布上裁"（V149 要修掉的正是这个）。
    //    宁可不交，也不替用户决定。
    const pB = getProduct(c.productId);
    if (!pB) throw { code: 'NOPROD', msg: '关联成品不存在' };
    const needCut = require('./calc.js').cutQueueFor(pB.bom, deliverQty) || [];
    if (needCut.length && !(opts && opts.perPiece)) {
      throw { code: 'NEEDCUT', msg: '这一单要裁剪面料，请先选好每片从哪块布上裁', needCut: true };
    }
    const flowsBefore = getFlows().length;
    const pProd = produceProduct(c.productId, deliverQty, null, null, null, (opts && opts.perPiece) || null);
    const prods = (pProd && pProd.productions) || [];
    prodId = (prods[prods.length - 1] || {}).id || '';
    // ⭐ 追溯：这批料是「为这一单交付」出的，要把本批流水的**来源与备注**改成排单口径 ——
    //    生产内部用的是一般口径（来源「成品裁剪」、备注「增加成品《X》库存」），
    //    原样留着会让「物料出入库」里认不出这是哪一单交付扣的（V72 专门修过这个标签）。
    const allFlows = getFlows();
    const mine = allFlows.slice(flowsBefore);
    const deliverRemark = '排单交付 · ' + (client || '未记录客户');
    mine.forEach(function (f) { f.source = 'commission'; f.remark = deliverRemark; });
    if (mine.length) set(KEYS.FLOWS, allFlows);
    origins = mine.reduce(function (a, f) { return a.concat((f && f.origins) || []); }, []);
    const pAfter = sellProduct(c.productId, deliverQty, unitPrice, util.today(), client);
    const sales = (pAfter && pAfter.sales) || [];
    saleId = (sales[sales.length - 1] || {}).id || '';
  }

  c.deliveredQty = util.round((c.deliveredQty || 0) + deliverQty, 2);
  c.deliverLogs = c.deliverLogs || [];
  // V149：来源要**记下来** —— 撤销时靠它走两条不同的反向路径
  c.deliverLogs.push({
    date: util.today(), qty: deliverQty, fromStock: fromStock,
    prodId: prodId, saleId: saleId, origins: origins
  });
  if (c.deliveredQty >= c.qty) c.status = 'done';
  set(KEYS.COMMISSIONS, list);
  return c;
}

// 撤销某次交付：按交付记录里的来源反向
//   · V149 起（记录里有 fromStock）：先撤销售记录（在库加回）；若是现做现交，再退产（返还物料）
//   · V149 之前的老记录（没有 fromStock）：**沿用原逻辑**，按 BOM 反向返还物料 —— 不猜、不追溯
function undoDeliver(commissionId, logIdx) {
  const list = getCommissions();
  const c = list.find(x => x.id === commissionId);
  if (!c) throw { code: 'NOCOM', msg: '排单不存在' };
  const logs = c.deliverLogs || [];
  if (logIdx < 0 || logIdx >= logs.length) throw { code: 'BAD', msg: '该交付记录不存在' };
  const log = logs[logIdx];
  const p = getProduct(c.productId);
  if (!p) throw { code: 'NOPROD', msg: '关联成品不存在' };
  const qty = util.round(log.qty, 2);
  // 与交付同一口径：备注写客户名、来源为「排单履约」（同样是 2026-09-27 V72 修正）
  const backRemark = '排单交付撤销 · ' + (c.client || '未记录客户');

  if (log.fromStock) {
    // ① 先撤销售：删掉那条销售记录 + 在库加回（两条来源都有销售记录）
    if (log.saleId) {
      const plist = getProducts();
      const pp = plist.find(x => x.id === c.productId);
      if (pp && (pp.sales || []).some(x => x.id === log.saleId)) {
        pp.sales = (pp.sales || []).filter(x => x.id !== log.saleId);
        pp.sellableStock = util.round((pp.sellableStock || 0) + qty, 2);
        set(KEYS.PRODUCTS, plist);
      }
    }
    // ② 现做现交的，再退产：返还所耗物料 + 在库减回（复用退产，与"误增可退产"同一套口径）
    if (log.fromStock === 'material' && log.prodId) {
      undoProduce(c.productId, log.prodId);
    }
  } else {
    // —— V149 之前的老记录：原样（按 BOM 反向返还物料）——
    (p.bom || []).forEach(b => {
      let m = getMaterial(b.materialId);
      if (!m) return;
      const fabric = b.isFabric || isMaterialFabric(m);
      if (fabric && util.bomIsBatchLine(b, m)) {
        // 刀口布：按每件用量加回 batchRemain（与 assignCommission 扣减口径一一对应）
        const use = util.round((b.batchUsage || 0) * qty, 2);
        if (use <= 0) return;
        const unit = unitCost(m);
        m.batchRemain = util.round((m.batchRemain || 0) + use, 2);
        m.totalValue = util.round(m.batchRemain * unit, 2);
        syncBatchLots(m);               // ⭐ V95：同退产
        saveMaterial(m);
        addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'in', qty: use, balance: stockValue(m), remark: backRemark, source: 'commission', relatedProductId: p.id, unitCost: unit, totalPrice: util.round(unit * use, 2), priceMode: 'byBatch', unit: m.batchUnit || 'kg', origins: [batchBackOrigin(m, use)] });
      } else if (fabric) {
        const redLen = util.round(b.length || 0, 2), redWid = util.round(b.width || 0, 2);
        const hasRect = redLen > 0 && redWid > 0;
        const back = hasRect ? util.round(redLen * redWid * qty, 2) : util.round((b.area || 0) * qty, 2);
        if (back <= 0) return;
        const w = m.fabricWidth || 100;
        // ⭐ V95：同退产 —— 退回也要说出处
        m.pieces = (m.pieces || []).concat(mkPiece(back / w, w, 'remnant', w,
          detachOrigin(m, back, '交付撤销 · 原洞位置无记录')));
        saveMaterial(m);
        addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'in', qty: back, balance: stockValue(m), remark: backRemark, source: 'commission', relatedProductId: p.id, unitCost: unitCost(m), totalPrice: util.round(unitCost(m) * back, 2), priceMode: 'byArea', origins: [detachOrigin(m, back, '交付撤销 · 原洞位置无记录')] });
      } else {
        const need = util.round((b.usage || 0) * qty, 2);
        if (need <= 0) return;
        m.quantity = util.round((m.quantity || 0) + need, 2);
        saveMaterial(m);
        addFlow({ categoryId: m.categoryId, materialId: m.id, materialName: m.name, type: 'in', qty: need, balance: stockValue(m), remark: backRemark, source: 'commission', relatedProductId: p.id, unitCost: unitCost(m), totalPrice: util.round(unitCost(m) * need, 2), priceMode: 'each' });
      }
    });
  }

  c.deliveredQty = util.round((c.deliveredQty || 0) - qty, 2);
  if (c.deliveredQty < c.qty) c.status = 'active';
  logs.splice(logIdx, 1);
  c.deliverLogs = logs;
  set(KEYS.COMMISSIONS, list);
  return c;
}

/* ===================== 灵感 / 想做（M1-19, M1-20） ===================== */
function getInspirations() { return get(KEYS.INSPIRATIONS, []); }
function saveInspiration(it) {
  if (!it.categoryId) it.categoryId = currentSpace();
  const list = getInspirations();
  if (it.id) { const i = list.findIndex(x => x.id === it.id); if (i >= 0) list[i] = it; else list.push(it); }
  else { it.id = uid('ins'); it.status = 'draft'; it.createdAt = util.today(); list.push(it); }
  set(KEYS.INSPIRATIONS, list); return it;
}
function removeInspiration(id) { set(KEYS.INSPIRATIONS, getInspirations().filter(x => x.id !== id)); }

function getWants() { return get(KEYS.WANTS, []); }
function saveWant(it) {
  if (!it.categoryId) it.categoryId = currentSpace();
  const list = getWants();
  if (it.id) { const i = list.findIndex(x => x.id === it.id); if (i >= 0) list[i] = it; else list.push(it); }
  else { it.id = uid('wt'); it.status = 'todo'; it.createdAt = util.today(); list.push(it); }
  set(KEYS.WANTS, list); return it;
}
function removeWant(id) { set(KEYS.WANTS, getWants().filter(x => x.id !== id)); }

/* ===================== 收藏工序（全局复用，仅标题 + 正文） ===================== */
function getCollectedSteps() { return get(KEYS.COLLECTED_STEPS, []); }
function addCollectedStep(step) {
  const title = (step && step.title || '').trim();
  const body = (step && step.body || '').trim();
  if (!title && !body) return null;            // 空工序不收藏
  const list = getCollectedSteps();
  list.unshift({ id: uid('cs'), title, body, createdAt: util.today() });
  // 去重：相同「标题 + 正文」只保留一条
  const seen = new Set(); const dedup = [];
  list.forEach(x => { const k = (x.title || '') + '\u0001' + (x.body || ''); if (!seen.has(k)) { seen.add(k); dedup.push(x); } });
  set(KEYS.COLLECTED_STEPS, dedup.slice(0, 200));
  return dedup[0];
}
function removeCollectedStep(id) { set(KEYS.COLLECTED_STEPS, getCollectedSteps().filter(x => x.id !== id)); }

// 灵感 / 想做转成品时，预填原有图文到教程卡（可修改删除）
// 规则：有图则首步带图 + 正文=原描述；无图仅有描述则单步正文；均无则空教程（标题默认=名称+制作教程）
function buildTutorialFromSource(it) {
  const photos = (it.photos || []).map(p => ({ path: p, remark: '' }));
  const desc = (it.desc || '').trim();
  const name = it.title || '灵感';
  if (!photos.length && !desc) return { title: name + ' 制作教程', steps: [] };
  const steps = [];
  if (photos.length) {
    steps.push({ id: uid('st'), title: '准备材料与草图', body: desc, images: photos, mats: [], pageBreak: false });
  } else {
    steps.push({ id: uid('st'), title: '步骤说明', body: desc, images: [], mats: [], pageBreak: false });
  }
  return { title: name + ' 制作教程', steps };
}

/* ===================== 日期快照（M1-10, A.3） ===================== */
function getSnapshots(categoryId) { const cid = categoryId || currentSpace(); return get(KEYS.SNAPSHOTS, []).filter(s => (s.categoryId || 'bc_default') === cid); }
function getSnapshotsAll() { return get(KEYS.SNAPSHOTS, []); }
function saveSnapshots(arr) { set(KEYS.SNAPSHOTS, arr); }
function ensureTodaySnapshot(metrics) {
  const cid = currentSpace();
  const arr = getSnapshotsAll();
  const t = util.today();
  const i = arr.findIndex(s => s.date === t && (s.categoryId || 'bc_default') === cid);
  // V142b：快照里那对"入库/出库数量"改名为**金额** —— 改前是 `inboundQty/outboundQty`
  //   且算法是"把当天所有流水的 qty 直接相加"（片 + cm² + kg 混加，硬错），
  //   而且**没有任何读取方**（`getSnapshots` 的消费方只读 inventoryValue）。
  //   现在与「物料出入库」页的曲线口径一致：入库=本次采购总价、出库=按均价扣减的成本。
  //   ⚠️ 老快照里残留的 inboundQty 字段没人读，留着无害（不做破坏性迁移）。
  const snap = { date: t, categoryId: cid, inventoryValue: metrics.inventoryValue, sales: metrics.sales, profit: metrics.profit, inboundAmount: metrics.inboundAmount, outboundAmount: metrics.outboundAmount };
  if (i >= 0) arr[i] = snap; else arr.push(snap);
  set(KEYS.SNAPSHOTS, arr);
  return snap;
}

/* ===================== 可选月份区间（首月 → 当月） ===================== */
// 用户首个月份：取当前手作空间各类数据中最早的创建日期；无任何数据时用当月
function getFirstActiveMonth() {
  const cur = currentSpace();
  let min = util.today().slice(0, 7);
  const consider = (d) => {
    if (typeof d !== 'string' || d.length < 7) return;
    const m = d.slice(0, 7);
    if (m < min) min = m;
  };
  getMaterials().filter(x => spaceOf(x) === cur).forEach(x => consider(x.createdAt));
  getProducts().filter(x => spaceOf(x) === cur).forEach(x => consider(x.createdAt));
  getCommissions().filter(x => spaceOf(x) === cur).forEach(x => consider(x.createdAt));
  getInspirations().filter(x => spaceOf(x) === cur).forEach(x => consider(x.createdAt));
  getWants().filter(x => spaceOf(x) === cur).forEach(x => consider(x.createdAt));
  getAssetsOf(cur).forEach(x => consider(x.createdAt));
  getToolsOf(cur).forEach(x => consider(x.createdAt));
  getConsumablesOf(cur).forEach(x => consider(x.createdAt));
  getSnapshots(cur).forEach(x => consider(x.date));
  return min;
}
// 可选月份列表：从首月到当月，倒序（最新在上）
function buildMonthList() {
  const first = getFirstActiveMonth();
  const now = util.today().slice(0, 7);
  if (first > now) return [now];
  const out = [];
  let y = Number(now.slice(0, 4)), m = Number(now.slice(5, 7));
  let guard = 0;
  while (guard < 600) {
    const cur = y + '-' + ('0' + m).slice(-2);
    out.push(cur);
    if (cur === first) break;
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
    guard++;
  }
  return out;
}

/* ===================== 导出辅助 ===================== */
function getAll() {
  return {
    businessCategories: getBusinessCategories(),
    materialCategories: getListAll('materialCategory'),
    productCategories: getListAll('productCategory'),
    units: getListAll('unit'),
    platforms: getListAll('platform'),
    materials: getMaterials(),
    products: getProducts(),
    flows: getFlows(),
    inspirations: getInspirations(),
    wants: getWants(),
    commissions: getCommissions()
  };
}
function clearAll() { storage.clearAll(); }

/* ===================== 库存总值对账与修复 ===================== */
// 背景：totalValue 原是手工维护的字段，漏改会静默漂移，进而让均价与全部成本失真。
// 这里提供「查」与「修」两个能力 —— 计算逻辑在 services/valuation.js（纯函数），本处只负责读写。

// 对账（只读）：比对每个物料缓存的 totalValue 与流水派生值
// 返回 { checked, okCount, mismatchCount, mismatches[], sumCached, sumDerived, sumDiff, sumOk }
function reconcileTotalValue(categoryId) {
  return valuation.reconcileAll(getMaterials(), getFlows(), { categoryId: categoryId });
}

// 修复：把漂移的 totalValue 按流水重算回正确值
// 返回 { materials, repairedCount, repaired: [{ materialId, name, from, to, diff }] }
function repairTotalValue() {
  const res = valuation.applyRepairs(getMaterials(), getFlows());
  if (res.repairedCount) set(KEYS.MATERIALS, res.materials);
  return res;
}

/* ===================== 损耗（耗材 / 资产 / 工具）——已迁移至 services/loss.js（薄壳转发） ===================== */
const loss = require('../services/loss.js');
const {
  getConsumables, getConsumablesOf, getConsumable, consumableUnitPrice, saveConsumable,
  startUseConsumable, outConsumable, splitStartUseConsumable, splitOutConsumable,
  undoStartUseConsumable, undoOutConsumable, removeConsumable,
  getAssets, getAssetsOf, getAsset, assetRepairTotal, assetMonthlyDepreciation, saveAsset,
  addAssetRepair, updateRepair, deleteRepair, scrapAsset, unscrapAsset, removeAsset,
  getTools, getToolsOf, getTool, saveTool, replaceTool, replaceToolWith, undoReplaceTool, removeTool,
  getOtherExpenses, getOtherExpensesOf, getOtherExpense, saveOtherExpense, removeOtherExpense, otherExpenseIn,
  monthRange, monthIndex, consumableAmortForMonth, assetDepreciationForMonth, toolExpenseForMonth,
  getMonthlyLossCost, getDailyLossCost, getLossCostSeries
} = loss;

// 指定月份生产件数（依赖成品数据，留在本模块；月份边界由 services/loss.js 提供）
function getMonthlyProducedUnits(year, month) {
  const { start, end } = monthRange(year, month);
  let sum = 0;
  getProducts().filter(p => spaceOf(p) === currentSpace()).forEach(p => {
    (p.productions || []).forEach(pr => {
      if (pr.date && pr.date >= start && pr.date <= end) sum += Number(pr.qty) || 0;
    });
  });
  return util.round(sum, 2);
}

module.exports = {
  KEYS, get, set, uid, ensureSeed, runMigrations, getOpenid, ensureRealOpenid,
  restoreFactoryPresets, ensureSpaceWithPresets, seedSpacePresets,   // V150：出厂预设补齐（迁移与「恢复出厂」共用）
  currentSpace,   // 当前手作空间（由 services/state.js 统一管理）
  // 存储容量与写失败（由 services/storage.js 提供，经此转发给页面层使用）
  usage: storage.usage,
  isNearFull: storage.isNearFull,
  canFit: storage.canFit,
  onWriteError: storage.onWriteError,
  lastWriteError: storage.lastWriteError,
  // 数据损坏留痕（存储里的值类型与期望不符时）
  onCorruption: storage.onCorruption,
  lastCorruptionInfo: storage.lastCorruptionInfo,
  // 库存总值对账与修复（计算在 services/valuation.js）
  reconcileTotalValue, repairTotalValue,
  getBusinessCategories, addBusinessCategory, updateBusinessCategory, removeBusinessCategory,
  getBusinessCategoryTheme, setBusinessCategoryTheme, currentTheme,
  LIST_TYPES, getList, getListAll, saveListItem, removeListItem, reassignProductCategoryRefs, reassignMaterialCategoryRefs,
  getSettings, saveSettings,
  getMaterials, getMaterial, isMaterialFabric, displayUnit, buildMaterialName, isNameDuplicate, savePhoto,
  materialPreview,
  materialThumb,
  fabricArea, fabricCount, stockValue, isLowStock, unitCost, materialBrief, flowDisplay, saveMaterial, removeMaterial,
  consumeFabricArea, restoreAreaOrigins, isPieceOffcut, fabricPieceStats, pieceShape, splitCutArea, splitPieceArea, canCutTimes, pickCutSource, cutFabric, listCutSchemes, applyCutToPieces, asSheet, cutSheetPiece,
  outboundCut,
  pieceSnapshot, pieceFromSnapshot, detachOrigin,
  syncBatchLots, pushBatchLot, drawBatchLots, batchBackOrigin,
  destroyPiece, stocktakePiece, stocktakeMaterial, stocktakeProduct,
  inbound, outbound, getFlows, addFlow, undoFlow,
  getProducts, getProduct, saveProduct, removeProduct,
  checkBomStock, consumeBom, produceProduct, productActualUnitCost, sellProduct, transferProduct, discardSample, deleteSale, returnBom, undoProduce,
  buildProductDraftFromSource, markSourceConverted,
  getCommissions, getCommission, saveCommission, removeCommission, cancelCommission, assignCommission, undoDeliver,
  getInspirations, saveInspiration, removeInspiration,
  getWants, saveWant, removeWant,
  getCollectedSteps, addCollectedStep, removeCollectedStep, buildTutorialFromSource,
  getSnapshots, getSnapshotsAll, saveSnapshots, ensureTodaySnapshot, getFirstActiveMonth, buildMonthList,
  getAttrPresets, getUnitPresets,
  getAll, clearAll,
  getConsumables, getConsumablesOf, getConsumable, consumableUnitPrice, saveConsumable, startUseConsumable, outConsumable, splitStartUseConsumable, splitOutConsumable, undoStartUseConsumable, undoOutConsumable, removeConsumable,
  getAssets, getAssetsOf, getAsset, assetRepairTotal, assetMonthlyDepreciation, saveAsset, addAssetRepair, updateRepair, deleteRepair, scrapAsset, unscrapAsset, removeAsset,
  getTools, getToolsOf, getTool, saveTool, replaceTool, replaceToolWith, undoReplaceTool, removeTool,
  getOtherExpenses, getOtherExpensesOf, getOtherExpense, saveOtherExpense, removeOtherExpense, otherExpenseIn,
  getMonthlyLossCost, getMonthlyProducedUnits, getDailyLossCost, getLossCostSeries,
  // 2026-10-10 V131 补：这三个一直在上面被解构，却漏在导出清单里 ——
  // 「看起来能用、其实拿不到」。累计总账要按月累加损耗，正好暴露了这个缺口。
  consumableAmortForMonth, assetDepreciationForMonth, toolExpenseForMonth
};
