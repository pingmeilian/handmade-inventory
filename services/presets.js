// services/presets.js —— 出厂预设的**唯一源**（V150 · 2026-10-13）
//
// 为什么单独一个文件：
//   出厂预设有两类消费者 ——
//     ① `utils/store.js` 的 `buildDefaultPresets()`：新装 / 用户手动恢复出厂；
//     ② `services/migrations.js` 的迁移步骤：老用户的数据里**已经落盘了旧预设**，
//        只改出厂值对他不生效，必须靠迁移补（V145 就是这么栽的）。
//   而这两处**要的是同一份数据**。V145 当时 migrations.js 里又抄了一份分类/维度表 ⇒
//   两处各写一遍，迟早漂。⇒ 本文件是唯一源。
//
// ⚠️ 本文件是**纯数据 + 零依赖**（不许 require 任何东西）—— 这样 store 与 migrations
//    都能安全地引用它，不会形成循环依赖。
//
// ⚠️ 改动纪律（三条，都是踩出来的）：
//   ① **只加不删**：用户删掉的预设不许"复活"（迁移侧只补一次，见 migrations.js 的幂等标记）；
//   ② **新项追加在末尾**：缩略图配色是按**下标**取的（`utils/palette.js` 的 `colorOf`）
//      ⇒ 往中间插会让老用户看到"颜色全变了"。要加就加在最后。
//   ③ **新增空间 / 新增分类 = 必须配一条迁移**，否则老用户看不到（并且 SCHEMA_VERSION +1）。
//
// ⚠️ id 必须**全局唯一**：配置列表在存储里是"一张大表 + 按 categoryId 过滤"，
//    两个空间用同名 id 会让 `find()` 取到另一个空间的那条。

// ==================== 共用色板 ====================
// 手作各门类通用的基础色（用于"颜色"维度）；门类特有的色（珠光 / 马卡龙 / 幻彩…）写在各自分类里。
const C_BASIC = ['白色', '黑色', '灰色', '红色', '橙色', '黄色', '绿色', '蓝色', '紫色', '粉色', '棕色', '米白'];

// ==================== 属性维度预设 ====================
// 选项式录入的兜底值（页面不许再抄一份，见 V145 的收口）。
// 页面取法：`store.getAttrPresets(dim)` —— 维度自己有 options 时用页面数据，为空时才回落到这里。
const ATTR_PRESETS = {
  '颜色': ['粉色', '蓝色', '白色', '黑色', '红色', '黄色', '绿色', '紫色', '米色', '灰色', '棕色', '橙色'],
  '材质': ['纯棉', '涤纶', '粗布', '棉麻', '亚麻', '丝绸', '牛仔', '皮革', '绒布', '帆布', '蕾丝', '雪纺', '针织', '双层纱', '纱卡']
};

// ==================== 单位预设 ====================
// 编辑页的单位下拉就用这份（全局，不按空间分）；
// V150 追加末尾 6 个：手作各门类实际会用到的量词（团/支/块/罐/把/球）。
// ⚠️ 追加在末尾 —— 改前 4 个位置不动，用户的肌肉记忆不变。
const UNIT_PRESETS = [
  '个', '件', '只', '条', '根', '副', '对', '套', '包', '盒',
  '卷', '米', '厘米', '码', '克', '千克', '张', '片', '粒', '颗',
  '双', '打', '捆', '束', '瓶', '袋', '桶', '升', '毫升',
  '团', '球', '支', '块', '罐', '把'
];

// 每个手作空间默认给的那几项单位 / 平台（名单取自上面的全量表，只挑常用的，别一次给 35 项）
const SPACE_UNITS = ['个', '米', '克', '卷', '颗', '条', '副', 'cm', '张', '团'];
const SPACE_PLATFORMS = ['微信', '小红书', '闲鱼', '淘宝', '抖音', '自定义'];

// ==================== 手作空间（含各自的物料分类 / 成品品类） ====================
//
// 5 个出厂空间。第一个是项目最初的「缝纫」（默认空间，**id 固定为 bc_default**，
// 多处逻辑（主题兜底 / 迁移校正 / 状态初始化）认这个 id，不要改）。
//
// 缝纫的既有 6 个分类**原样照搬**（一个字没动、sort 0–5），新增 7 个排在后面（sort 6–12）。
// 其余 4 个空间是 V150 按用户要求新增的（「拼豆、粘土、钩织、串珠这些空间也加一些默认的预设」）。
//
// 各分类的属性维度都是**联网查过行业口径**之后定的（缝纫辅料按「宽度 + 材质 + 工艺」三维界定、
// 拼豆按「尺寸 + 材质 + 色号体系」、粘土按「泥种 + 克重 + 品牌」、毛线按「线材 + 股数 + 成分」、
// 珠子按「材质 + 珠径 + 形状 + 孔径」）—— 这些是各门类真正会用来区分规格的字段，
// 不是"随便凑几个"。
const SPACES = [
  {
    id: 'bc_default', name: '缝纫', sort: 0,
    materialCategories: [
      { id: 'mc_fabric', name: '面料', defaultUnit: '米', isFabric: true, sort: 0, attrDimensions: [
        { name: '颜色', options: ATTR_PRESETS['颜色'] },
        { name: '材质', options: ATTR_PRESETS['材质'] },
        { name: '花纹', options: ['条纹', '格纹', '波点', '碎花', '纯色', '几何'] }
      ] },
      { id: 'mc_label', name: '布标', defaultUnit: '个', isFabric: false, sort: 1, attrDimensions: [
        { name: '类型', options: ['织标', '印标', '洗水标', '吊牌', '主标', '侧标'] },
        { name: '颜色', options: ['黑色', '白色', '红色', '金色', '银色', '彩色'] },
        { name: '形状', options: ['长方形', '方形', '圆形', '异形'] }
      ] },
      { id: 'mc_zipper', name: '拉链', defaultUnit: '个', sort: 2, attrDimensions: [
        { name: '颜色', options: ['黑色', '白色', '藏青', '咖啡', '红色', '银色', '古铜'] },
        { name: '长度', options: ['3cm', '5cm', '10cm', '15cm', '20cm', '30cm', '40cm', '50cm', '60cm'] }
      ] },
      { id: 'mc_bead', name: '珠饰', defaultUnit: '颗', sort: 3, attrDimensions: [
        { name: '颜色', options: ['透明', '白色', '黑色', '金色', '银色', '红色', '蓝色', '粉色'] },
        { name: '形状', options: ['圆珠', '管珠', '米珠', '菱形', '水滴', '珍珠', '亮片', '铃铛'] }
      ] },
      { id: 'mc_cotton', name: '棉花', defaultUnit: '克', sort: 4, attrDimensions: [
        { name: '材质', options: ['PP棉', '珍珠棉', '羽绒棉', '太空棉', '羊毛毡', '记忆棉'] },
        { name: '颜色', options: ['白色', '本白', '黑色', '灰色'] }
      ] },
      { id: 'mc_other', name: '其他', defaultUnit: '个', sort: 5, attrDimensions: [] },

      // —— V150 新增（用户：「还有物料预设，加花边嵌条等等的」）——
      // 用户点名的是花边与嵌条；顺带把同类缝纫辅料一次补齐（织带 / 松紧带 / 纽扣 / 衬布 / 装饰辅料），
      // 免得用户下次再为"纽扣该放哪个分类"纠结。**不放进已有的 6 个里**，各起一个分类。
      { id: 'mc_lace', name: '花边', defaultUnit: '米', sort: 6, attrDimensions: [
        { name: '类型', options: ['机织花边', '针织（尼龙）花边', '刺绣花边', '编织花边', '水溶花边', '钩花花边'] },
        { name: '材质', options: ['纯棉', '锦纶（尼龙）', '涤纶', '人造丝', '棉涤混纺'] },
        { name: '宽度', options: ['5mm', '7mm', '9mm', '12mm', '15mm', '20mm', '25mm', '40mm', '50mm', '70mm'] },
        { name: '颜色', options: ['米白', '本白', '黑色', '浅粉', '杏色', '香槟', '藕粉', '古酒红', '藏青', '彩色'] }
      ] },
      { id: 'mc_binding', name: '嵌条与包边', defaultUnit: '米', sort: 7, attrDimensions: [
        { name: '类型', options: ['斜裁包边条（单折）', '斜裁包边条（双折）', '嵌线（夹绳）', '滚边带', '门襟衬带', '纱带', '皮革包边条'] },
        { name: '材质', options: ['纯棉', '涤纶', '棉涤混纺', '弹力布', '皮革'] },
        { name: '宽度', options: ['12mm', '18mm', '20mm', '25mm', '30mm', '40mm', '50mm'] },
        { name: '颜色', options: ['白色', '黑色', '米白', '藏青', '咖色', '红色', '彩色套装'] }
      ] },
      { id: 'mc_webbing', name: '织带与绳带', defaultUnit: '米', sort: 8, attrDimensions: [
        { name: '类型', options: ['人字带', '缎带', '棉带', '罗纹带', '罗缎带', '弹力带', '抽绳', '魔术贴', '皮革带'] },
        { name: '材质', options: ['全棉', '涤纶', '尼龙', '氨纶', '皮革'] },
        { name: '宽度', options: ['6mm', '10mm', '12mm', '15mm', '18mm', '20mm', '25mm', '30mm', '38mm', '50mm'] },
        { name: '颜色', options: ['本白', '米白', '黑色', '藏青', '咖色', '红色', '粉色', '彩色'] }
      ] },
      { id: 'mc_elastic', name: '松紧带', defaultUnit: '米', sort: 9, attrDimensions: [
        { name: '类型', options: ['平纹松紧带', '针织松紧带', '包边松紧带', '花边松紧带', '对折松紧带', '弹力绳'] },
        { name: '宽度', options: ['4mm', '6mm', '8mm', '10mm', '12mm', '15mm', '20mm', '25mm', '30mm', '40mm'] },
        { name: '颜色', options: ['白色', '黑色', '米色', '彩色'] }
      ] },
      { id: 'mc_button', name: '纽扣', defaultUnit: '个', sort: 10, attrDimensions: [
        { name: '类型', options: ['树脂扣', '金属扣', '贝壳扣', '木质扣', '包布扣', '椰壳扣', '四合扣', '暗扣', '气眼'] },
        { name: '直径', options: ['10mm', '12mm', '15mm', '18mm', '20mm', '25mm', '30mm'] },
        { name: '孔数', options: ['2 孔', '4 孔', '无孔（背面有脚）', '按扣'] },
        { name: '颜色', options: ['白色', '黑色', '米色', '透明', '金属色', '木色', '彩色'] }
      ] },
      { id: 'mc_interlining', name: '衬布', defaultUnit: '米', sort: 11, attrDimensions: [
        { name: '类型', options: ['粘合衬（有纺）', '无纺粘合衬', '针织衬', '硬衬', '铺棉', '水溶衬', '纸衬'] },
        { name: '克重', options: ['20g/㎡', '30g/㎡', '50g/㎡', '80g/㎡', '120g/㎡', '200g/㎡'] },
        { name: '颜色', options: ['白色', '本白', '黑色', '灰色'] }
      ] },
      { id: 'mc_trim', name: '装饰辅料', defaultUnit: '个', sort: 12, attrDimensions: [
        { name: '类型', options: ['水钻', '亮片', '烫钻', '流苏', '排须', '铆钉', '爪钻', '胸针托', '发夹底托', '包扣'] },
        { name: '材质', options: ['玻璃', '亚克力', '金属', '树脂', '涤纶'] },
        { name: '尺寸', options: ['2mm', '3mm', '5mm', '8mm', '10mm', '15mm', '20mm'] }
      ] }
    ],
    productCategories: [
      { id: 'pc_hair', name: '发饰', packaging: 1.0, shipping: 3.0, targetProfit: 0.6, sort: 0 },
      { id: 'pc_pet', name: '宠物用品', packaging: 2.0, shipping: 8.0, targetProfit: 0.5, sort: 1 },
      { id: 'pc_bag', name: '包包', packaging: 3.0, shipping: 10.0, targetProfit: 0.5, sort: 2 },
      { id: 'pc_cloth', name: '衣服', packaging: 2.0, shipping: 6.0, targetProfit: 0.55, sort: 3 },
      { id: 'pc_other', name: '其他', packaging: 1.5, shipping: 5.0, targetProfit: 0.5, sort: 4 }
    ]
  },

  {
    id: 'bc_perler', name: '拼豆', sort: 1,
    materialCategories: [
      // 尺寸三档是行业口径：Mini 2.6mm（细节最高）/ 中颗 3mm / Midi 5mm（最主流，95% 图纸用它）/ Maxi 10mm（幼儿）
      { id: 'mc_perler_bead', name: '拼豆豆粒', defaultUnit: '颗', sort: 0, attrDimensions: [
        { name: '尺寸', options: ['2.6mm（迷你）', '3mm（小颗）', '5mm（中颗·Midi）', '10mm（大颗·Maxi）'] },
        { name: '材质', options: ['PE（硬豆）', 'EVA（软豆）', 'PE 珠光', '透明'] },
        { name: '色号体系', options: ['COCO 291', 'Perler', 'Hama', 'Artkal', 'MARD', '通用色卡'] },
        { name: '颜色', options: ['白色', '黑色', '红色', '橙色', '黄色', '绿色', '蓝色', '紫色', '粉色', '棕色', '灰色', '透明', '珠光', '荧光', '肤色'] },
        { name: '包装', options: ['散装（按颗）', '分装小袋 100 颗', '盒装 24 色', '大桶装'] }
      ] },
      { id: 'mc_perler_board', name: '拼豆板', defaultUnit: '块', sort: 1, attrDimensions: [
        { name: '形状', options: ['方形', '圆形', '心形', '六角形', '星形', '三角形'] },
        { name: '规格', options: ['29×29', '57×57', '大号方形', '大号圆形'] },
        { name: '颜色', options: ['透明', '白色'] }
      ] },
      { id: 'mc_perler_paper', name: '助烫纸', defaultUnit: '张', sort: 2, attrDimensions: [
        { name: '类型', options: ['助烫纸', '硅油纸', '硫酸纸', '烘焙纸'] },
        { name: '尺寸', options: ['15×15cm', '20×30cm', '30×40cm'] }
      ] },
      { id: 'mc_perler_fitting', name: '拼豆配件', defaultUnit: '个', sort: 3, attrDimensions: [
        { name: '类型', options: ['钥匙扣', '手机绳', '胸针托', '冰箱贴磁片', '挂扣', '开口圈', '亚克力底座', '灯座'] },
        { name: '规格', options: ['20mm', '25mm', '30mm', '长款'] },
        { name: '颜色', options: ['银色', '金色', '黑色', '白色'] }
      ] },
      { id: 'mc_perler_tool', name: '拼豆工具', defaultUnit: '个', sort: 4, attrDimensions: [
        { name: '类型', options: ['镊子', '拼豆笔', '分豆盘', '收纳盒', '熨斗', '熨烫垫'] }
      ] },
      { id: 'mc_perler_other', name: '其他', defaultUnit: '个', sort: 5, attrDimensions: [] }
    ],
    productCategories: [
      { id: 'pc_perler_keychain', name: '钥匙扣/挂件', packaging: 0.5, shipping: 3.0, targetProfit: 0.6, sort: 0 },
      { id: 'pc_perler_magnet', name: '冰箱贴', packaging: 0.5, shipping: 3.0, targetProfit: 0.6, sort: 1 },
      { id: 'pc_perler_figure', name: '摆件', packaging: 2.0, shipping: 6.0, targetProfit: 0.55, sort: 2 },
      { id: 'pc_perler_art', name: '装饰画', packaging: 3.0, shipping: 8.0, targetProfit: 0.5, sort: 3 },
      { id: 'pc_perler_earring', name: '耳饰', packaging: 1.0, shipping: 3.0, targetProfit: 0.6, sort: 4 },
      { id: 'pc_perler_other', name: '其他', packaging: 1.0, shipping: 5.0, targetProfit: 0.5, sort: 5 }
    ]
  },

  {
    id: 'bc_clay', name: '粘土', sort: 2,
    materialCategories: [
      // 泥种是粘土圈最容易买错的地方（固化方式完全不同）⇒ 一个泥种一个分类，别混。
      // 超轻粘土 / 树脂粘土 / 石塑粘土：自然风干；软陶：需要烤箱烘烤（且不烤不干，可反复修改）。
      { id: 'mc_clay_light', name: '超轻粘土', defaultUnit: '克', sort: 0, attrDimensions: [
        { name: '颜色', options: ['白色', '黑色', '红色', '橙色', '黄色', '绿色', '蓝色', '紫色', '粉色', '棕色', '灰色', '肤色', '马卡龙色', '荧光色'] },
        { name: '规格', options: ['100g', '250g', '500g', '1000g'] },
        { name: '品牌', options: ['贝蒙', '多多鹿', '小哥比', '爱乐陶', '其他'] },
        { name: '包装', options: ['单色分装', '24 色套装', '36 色套装'] }
      ] },
      { id: 'mc_clay_resin', name: '树脂粘土', defaultUnit: '克', sort: 1, attrDimensions: [
        { name: '颜色', options: ['透明', '白色', '半透明', '彩色'] },
        { name: '规格', options: ['100g', '250g', '500g', '1000g'] },
        { name: '品牌', options: ['具象', '墨叔家', 'Padico', '其他'] }
      ] },
      { id: 'mc_clay_stone', name: '石塑粘土', defaultUnit: '克', sort: 2, attrDimensions: [
        { name: '颜色', options: ['米白', '白色', '灰色'] },
        { name: '规格', options: ['500g', '1000g'] },
        { name: '品牌', options: ['青山一木', 'La Doll', '其他'] }
      ] },
      { id: 'mc_clay_polymer', name: '软陶', defaultUnit: '克', sort: 3, attrDimensions: [
        { name: '颜色', options: ['白色', '黑色', '红色', '橙色', '黄色', '绿色', '蓝色', '紫色', '粉色', '棕色', '灰色', '肤色', '半透明'] },
        { name: '规格', options: ['56g（2oz）', '454g（1lb）'] },
        { name: '品牌', options: ['FIMO', 'Sculpey', 'Premo', 'Cernit', 'Pardo', '爱乐陶', '陶立方', '陶元素'] }
      ] },
      { id: 'mc_clay_tool', name: '粘土工具', defaultUnit: '套', sort: 4, attrDimensions: [
        { name: '类型', options: ['三件组工具刀', '橡胶笔', '圆头棒', '压泥板', '擀泥棒', '模具', '硅胶笔', '砂纸', '镊子'] },
        { name: '材质', options: ['不锈钢', '亚克力', '硅胶', '木质', '树脂'] }
      ] },
      { id: 'mc_clay_fitting', name: '粘土配件', defaultUnit: '个', sort: 5, attrDimensions: [
        { name: '类型', options: ['冰箱贴磁片', '胸针托', '挂扣', '戒指托', '耳钉托', '发夹底托', '垫板', '密封袋', '收纳箱'] },
        { name: '规格', options: ['小号', '中号', '大号'] }
      ] },
      { id: 'mc_clay_paint', name: '颜料与辅料', defaultUnit: '瓶', sort: 6, attrDimensions: [
        { name: '类型', options: ['丙烯颜料', '水彩', '色粉', '光油', '亮油', 'UV 胶', '亮片'] },
        { name: '颜色', options: ['白色', '黑色', '红色', '黄色', '蓝色', '绿色', '金色', '银色', '透明'] }
      ] },
      { id: 'mc_clay_other', name: '其他', defaultUnit: '个', sort: 7, attrDimensions: [] }
    ],
    productCategories: [
      { id: 'pc_clay_figure', name: '手办/公仔', packaging: 2.0, shipping: 8.0, targetProfit: 0.6, sort: 0 },
      { id: 'pc_clay_mini', name: '微缩食玩', packaging: 1.5, shipping: 5.0, targetProfit: 0.6, sort: 1 },
      { id: 'pc_clay_magnet', name: '冰箱贴', packaging: 0.5, shipping: 3.0, targetProfit: 0.6, sort: 2 },
      { id: 'pc_clay_brooch', name: '胸针饰品', packaging: 1.0, shipping: 3.0, targetProfit: 0.6, sort: 3 },
      { id: 'pc_clay_display', name: '摆件', packaging: 3.0, shipping: 8.0, targetProfit: 0.55, sort: 4 },
      { id: 'pc_clay_flower', name: '花艺', packaging: 2.0, shipping: 8.0, targetProfit: 0.6, sort: 5 },
      { id: 'pc_clay_other', name: '其他', packaging: 1.5, shipping: 5.0, targetProfit: 0.5, sort: 6 }
    ]
  },

  {
    id: 'bc_crochet', name: '钩织', sort: 3,
    materialCategories: [
      // 线材决定钩针号（"几号钩针配几股线"是钩织最常查的表）⇒ 规格里同时给股数与蕾丝线号，
      // 因为蕾丝线是"数字越大线越细"，与股数是两套体系，混在一个维度里但要写清。
      { id: 'mc_yarn', name: '毛线', defaultUnit: '团', sort: 0, attrDimensions: [
        { name: '线材', options: ['牛奶棉', '蕾丝线', '羊毛线', '腈纶线', '圆股纱线', '扁平线', '布条线', '灌心棉', '纸草线', '空心棉纱', '毛毛线', '马海毛'] },
        { name: '规格', options: ['2 股', '3 股', '4 股', '5 股', '6 股', '7 股', '8 股', '蕾丝线 3#', '蕾丝线 5#', '蕾丝线 8#'] },
        { name: '成分', options: ['100% 棉', '精梳棉', '腈纶', '羊毛', '棉混纺', '棉+腈纶', '聚酯纤维', '人造丝'] },
        { name: '颜色', options: ['米白', '奶白', '黑色', '灰色', '咖色', '红色', '粉色', '橙色', '黄色', '绿色', '蓝色', '紫色', '藏青', '彩色'] }
      ] },
      { id: 'mc_hook', name: '钩针', defaultUnit: '支', sort: 1, attrDimensions: [
        { name: '类型', options: ['蕾丝钩针', '普通钩针', '无柄钩针', '带柄钩针', '阿富汗针', '环形针'] },
        { name: '规格（日规）', options: ['2/0', '3/0', '4/0', '5/0', '6/0', '7/0', '8/0', '9/0', '10/0', '蕾丝钩针 2–8 号'] },
        { name: '直径', options: ['1.0mm', '1.25mm', '1.5mm', '1.75mm', '2.0mm', '2.5mm', '3.0mm', '3.5mm', '4.0mm', '4.5mm', '5.0mm', '6.0mm'] },
        { name: '材质', options: ['铝', '不锈钢', '树脂', '竹木', '硅胶带柄'] }
      ] },
      { id: 'mc_crochet_fitting', name: '钩织配件', defaultUnit: '个', sort: 2, attrDimensions: [
        { name: '类型', options: ['记号扣', '缝合针', '麻花针', '填充棉（PP 棉）', '定型针', '定型板', '木环', '包带', '拉链', '内衬布', '纽扣'] },
        { name: '规格', options: ['小号', '中号', '大号'] }
      ] },
      { id: 'mc_crochet_other', name: '其他', defaultUnit: '个', sort: 3, attrDimensions: [] }
    ],
    productCategories: [
      { id: 'pc_crochet_doll', name: '玩偶/挂件', packaging: 1.0, shipping: 4.0, targetProfit: 0.6, sort: 0 },
      { id: 'pc_crochet_bag', name: '包包', packaging: 3.0, shipping: 10.0, targetProfit: 0.55, sort: 1 },
      { id: 'pc_crochet_hat', name: '帽子围巾', packaging: 2.0, shipping: 6.0, targetProfit: 0.55, sort: 2 },
      { id: 'pc_crochet_mat', name: '杯垫/桌垫', packaging: 0.5, shipping: 3.0, targetProfit: 0.6, sort: 3 },
      { id: 'pc_crochet_cloth', name: '衣服', packaging: 2.0, shipping: 8.0, targetProfit: 0.55, sort: 4 },
      { id: 'pc_crochet_basket', name: '收纳篮', packaging: 3.0, shipping: 10.0, targetProfit: 0.55, sort: 5 },
      { id: 'pc_crochet_other', name: '其他', packaging: 1.5, shipping: 5.0, targetProfit: 0.5, sort: 6 }
    ]
  },

  {
    id: 'bc_beading', name: '串珠', sort: 4,
    materialCategories: [
      // 串珠第一个坑是"珠子孔径与线材粗细对不上"⇒ 所以珠子单列「孔径」、线材单列「直径」，
      // 两个维度摆在用户面前，选之前就能对上。
      { id: 'mc_bead_stone', name: '珠子', defaultUnit: '颗', sort: 0, attrDimensions: [
        { name: '材质', options: ['水晶', '玻璃', '亚克力', '天然石', '木珠', '贝壳', '珍珠', '仿珍珠', '蜜蜡', '树脂'] },
        { name: '珠径', options: ['2mm', '3mm', '4mm', '5mm', '6mm', '8mm', '10mm', '12mm', '14mm', '16mm', '20mm'] },
        { name: '形状', options: ['圆珠', '管珠', '米珠', '方珠', '水滴', '车轮扁珠', '地球面珠', '珠中珠', '异形'] },
        { name: '孔径', options: ['1mm', '1.5mm', '2mm', '2.5mm', '3mm'] },
        { name: '颜色', options: ['透明', '白色', '黑色', '红色', '粉色', '橙色', '黄色', '绿色', '蓝色', '紫色', '咖色', '金色', '银色', '幻彩', '混色'] }
      ] },
      { id: 'mc_bead_thread', name: '线材', defaultUnit: '卷', sort: 1, attrDimensions: [
        { name: '类型', options: ['鱼线', '弹力线', '棉绳', '蜡绳', '编织线', '金属线', '丝线', '玉线', '记忆钢丝'] },
        { name: '直径', options: ['0.3mm', '0.4mm', '0.5mm', '0.6mm', '0.8mm', '1.0mm', '1.2mm', '1.5mm', '2mm', '3mm'] },
        { name: '材质', options: ['尼龙', '聚酯', '棉', '真丝', '不锈钢'] },
        { name: '颜色', options: ['透明', '白色', '黑色', '棕色', '彩色'] }
      ] },
      { id: 'mc_bead_fitting', name: '串珠配件', defaultUnit: '个', sort: 2, attrDimensions: [
        { name: '类型', options: ['龙虾扣', '弹簧扣', '延长链', '9 字针', 'T 针', '开口圈', '隔珠', '定位珠', '花托', '吊坠', '三通', '包扣', '耳钩', '戒指托'] },
        { name: '材质', options: ['不锈钢', '合金镀金', '合金镀银', '铜', '树脂', '亚克力'] },
        { name: '规格', options: ['小号', '中号', '大号'] }
      ] },
      // 工具＝三把钳（尖嘴 / 斜口 / 圆嘴）走天下 —— 所以"把"这个量词进了单位预设
      { id: 'mc_bead_tool', name: '串珠工具', defaultUnit: '把', sort: 3, attrDimensions: [
        { name: '类型', options: ['尖嘴钳', '斜口钳', '圆嘴钳', '镊子', '串珠盘', '剪线钳', '锥子', '胶水（E6000）'] },
        { name: '材质', options: ['不锈钢', '塑料', '硅胶'] }
      ] },
      { id: 'mc_bead_other', name: '其他', defaultUnit: '个', sort: 4, attrDimensions: [] }
    ],
    productCategories: [
      { id: 'pc_bead_bracelet', name: '手链', packaging: 1.0, shipping: 3.0, targetProfit: 0.65, sort: 0 },
      { id: 'pc_bead_necklace', name: '项链', packaging: 1.5, shipping: 5.0, targetProfit: 0.6, sort: 1 },
      { id: 'pc_bead_earring', name: '耳饰', packaging: 1.0, shipping: 3.0, targetProfit: 0.65, sort: 2 },
      { id: 'pc_bead_pendant', name: '挂件', packaging: 0.5, shipping: 3.0, targetProfit: 0.6, sort: 3 },
      { id: 'pc_bead_bagcharm', name: '包挂', packaging: 0.5, shipping: 3.0, targetProfit: 0.6, sort: 4 },
      { id: 'pc_bead_home', name: '家居装饰', packaging: 3.0, shipping: 10.0, targetProfit: 0.55, sort: 5 },
      { id: 'pc_bead_other', name: '其他', packaging: 1.0, shipping: 5.0, targetProfit: 0.5, sort: 6 }
    ]
  }
];

// 默认手作空间 id（多处逻辑认它：主题兜底 / 状态初始化 / 迁移校正）
const DEFAULT_SPACE_ID = 'bc_default';

// 按名字找出厂空间（用户在「分类管理」里手建一个叫「拼豆」的空间时，用它取到该空间的预设）
function spaceByName(name) {
  const n = String(name || '').trim();
  return SPACES.filter(s => s.name === n)[0] || null;
}
function spaceById(id) { return SPACES.filter(s => s.id === id)[0] || null; }

// ==================== 克隆（**写进存储前必须过这里**） ====================
//
// 为什么必须有：本文件的数据是**模块级单例**，会被 store 与 migrations 反复引用。
//   如果直接把 `c` 塞进 storage，某些环境下（测试的 wx-stub 就是直接存引用）
//   页面/迁移一改就成了改这份出厂数据 —— 第二次装机拿到的"出厂值"已经被改过了。
//   ⇒ 一律**克隆出全新对象 + 全新数组**再落盘。
//
// `idOverride`（可选）：把分类装到**不是它出厂归属的那个空间**时用。
//   场景：用户在「分类管理」里手建了一个叫「拼豆」的空间 ⇒ 我们把拼豆那套预设补给他，
//   但 `mc_perler_bead` 这类 id 已经被出厂空间 bc_perler 占着 ——
//   配置列表是"一张大表 + 按空间过滤"，**两个空间用同一个 id 会让 find() 取到另一条**。
//   ⇒ 此时按「空间 id 派生一个新 id」（确定性派生，不是随机：重跑能得到同一个 id，幂等）
function cloneMaterialCategory(c, spaceId, idOverride) {
  return {
    id: idOverride || c.id,
    name: c.name,
    categoryId: spaceId,
    defaultUnit: c.defaultUnit,
    // 显式给 false，别留 undefined：预设设置里的「面料类」开关读的就是它（V127 之后只认显式标记）
    isFabric: c.isFabric === true,
    sort: c.sort,
    attrDimensions: (c.attrDimensions || []).map(d => ({ name: d.name, options: (d.options || []).slice() }))
  };
}
function cloneProductCategory(c, spaceId, idOverride) {
  return {
    id: idOverride || c.id, name: c.name, categoryId: spaceId, sort: c.sort,
    packaging: c.packaging, shipping: c.shipping, targetProfit: c.targetProfit
  };
}

module.exports = {
  ATTR_PRESETS, UNIT_PRESETS, SPACES, SPACE_UNITS, SPACE_PLATFORMS,
  DEFAULT_SPACE_ID, spaceByName, spaceById, C_BASIC,
  cloneMaterialCategory, cloneProductCategory
};
