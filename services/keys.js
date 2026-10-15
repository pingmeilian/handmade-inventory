// services/keys.js —— 所有 storage key 的唯一来源
// 说明：原先这些常量内联在 utils/store.js 顶部。抽出来的意义是让「用了哪些 key」
//       可以集中查看与校验（例如备份/恢复、容量统计、清空数据都需要遍历全量 key）。

const KEYS = {
  OPENID: 'bm_openid',
  // 真实微信身份（云函数返回的 openid）。与 OPENID 的关系：
  //   拿到真实身份后，OPENID 会被**覆盖**为真实值，之后一律用它；
  //   本键单独存一份，用来判断"是否已升级到真实身份"（避免每次启动都打云函数）。
  // ⚠️ 必须进 PRESERVED_ON_CLEAR：清空本地数据后身份要留住，
  //    否则用户清空后又想从云端恢复，就认不出自己了（方案直接失效）。
  REAL_OPENID: 'bm_real_openid',
  SEEDED: 'bm_seeded',
  BUSINESS_CATEGORIES: 'bm_businessCategories',
  MATERIAL_CATEGORIES: 'bm_materialCategories',
  PRODUCT_CATEGORIES: 'bm_productCategories',
  UNITS: 'bm_units',
  PLATFORMS: 'bm_platforms',
  MATERIAL_ATTRS: 'bm_materialAttrs',
  PRODUCT_ATTRS: 'bm_productAttrs',
  SETTINGS: 'bm_settings',
  MATERIALS: 'bm_materials',
  PRODUCTS: 'bm_products',
  FLOWS: 'bm_flows',
  INSPIRATIONS: 'bm_inspirations',
  WANTS: 'bm_wants',
  COMMISSIONS: 'bm_commissions',
  SNAPSHOTS: 'bm_snapshots',
  MIGRATED_V1: 'bm_migrated_v1',
  MIGRATED_V2: 'bm_migrated_v2',
  MIGRATED_ATTR_PRESETS: 'bm_migrated_attr_presets',
  // 材质预设"补齐"（2026-10-12 V145）：给已有的「材质」维度追加 双层纱/纱卡/涤纶。
  // 为什么单独一个标记：migrateAttrPresets 那次只"补空维度"，而这次是往**已有内容**里加项，
  // 两件事的幂等边界不同，混用一个标记会互相干扰。
  MIGRATED_MATERIAL_PRESET_ADD: 'bm_migrated_material_preset_add',
  // 手作空间与出厂预设"补齐"（2026-10-13 V150）：缝纫加 7 个辅料分类 + 新增 拼豆/粘土/钩织/串珠 四个空间。
  // 同样单独一个标记：这次补的是"整条空间 + 它名下所有分类"，与上面"往一个维度里加几个选项"不是一回事。
  MIGRATED_CRAFT_PRESETS: 'bm_migrated_craft_presets',
  MIGRATED_PRODUCT_MODEL: 'bm_migrated_product_model',
  CONSUMABLES: 'bm_consumables',
  ASSETS: 'bm_assets',
  TOOLS: 'bm_tools',
  // 其它支出（2026-10-10 V131）：不是物料、不是机器/工具/耗材的杂项开销
  // （快递费、摊位费、电费、包装袋…）。累计总账的 A 口径第 6 项取自这里。
  OTHER_EXPENSES: 'bm_otherExpenses',
  MIGRATED_SPACE_TAG: 'bm_migrated_space_tag',
  MIGRATED_CONFIG_SPACE: 'bm_migrated_config_space',
  MIGRATED_BC: 'bm_migrated_bc',
  MIGRATED_PRODUCT_CATEGORY_TAG: 'bm_migrated_product_category_tag',
  COLLECTED_STEPS: 'bm_collected_steps',
  // 备份/恢复的内部快照（三保险之一，只保留最近 3 份）
  // 不进 DATA_KEYS（备份不含自身，避免自我嵌套）；进 PRESERVED_ON_CLEAR（清空后仍可自救）
  BACKUP_SNAPSHOTS: 'bm_backup_snapshots',
  // 库存总值与流水对齐的一次性校准标记（Day 2 引入流水化时使用）
  MIGRATED_TOTALVALUE_LEDGER: 'bm_migrated_totalvalue_ledger',
  // 老流水备注订正（2026-09-27 V73）：V72 之前的排单交付备注写成「排单#<内部id> 交付」，
  // 导出到 Excel 就是一串乱码 —— 该标记用于只订正一次
  MIGRATED_FLOW_REMARK: 'bm_migrated_flow_remark',
  // 布料几何模型迁移（2026-09-29 V81）：老数据把一块布拆成「整布 + 碎料」多片分开记账，
  // 该标记用于只合并一次
  MIGRATED_FABRIC_SHEETS: 'bm_migrated_fabric_sheets',
  // schema 版本门（Day 5 任务 5.2）：已是最新版本则启动迁移整体短路
  SCHEMA_VERSION: 'bm_schema_version'
};

// 全量 key 列表（备份、容量统计、清空数据共用）
const ALL_KEYS = Object.keys(KEYS).map((k) => KEYS[k]);

// 清空数据时需要保留的 key：本地匿名标识、**真实微信身份**、备份内部快照（最后的自救手段）。
// ⭐ SEEDED 不再保留（2026-09-12 真机教训）：保留它会让 ensureSeed 在清空后跳过，
// 预设值（手作空间/物料分类/单位/平台）永远回不来 —— 用户真机踩中此坑。
// 现在语义：清空数据 = 恢复出厂，种子预设全部重发。
// ⭐ REAL_OPENID 必须保留（2026-09-21 云备份设计）：清空后仍要能认出"云端哪份备份是我的"。
const PRESERVED_ON_CLEAR = [KEYS.OPENID, KEYS.REAL_OPENID, KEYS.BACKUP_SNAPSHOTS];

// 属于「业务数据」的 key（备份/导出应包含这些；迁移标记等元数据不必备份）
const DATA_KEYS = [
  KEYS.BUSINESS_CATEGORIES, KEYS.MATERIAL_CATEGORIES, KEYS.PRODUCT_CATEGORIES,
  KEYS.UNITS, KEYS.PLATFORMS, KEYS.MATERIAL_ATTRS, KEYS.PRODUCT_ATTRS, KEYS.SETTINGS,
  KEYS.MATERIALS, KEYS.PRODUCTS, KEYS.FLOWS,
  KEYS.INSPIRATIONS, KEYS.WANTS, KEYS.COMMISSIONS, KEYS.SNAPSHOTS,
  KEYS.CONSUMABLES, KEYS.ASSETS, KEYS.TOOLS, KEYS.OTHER_EXPENSES, KEYS.COLLECTED_STEPS
];

module.exports = { KEYS, ALL_KEYS, PRESERVED_ON_CLEAR, DATA_KEYS };
