# -*- coding: utf-8 -*-
# 切片一：把 utils/store.js 的损耗段（耗材/资产/工具 + 聚合）迁移到 services/loss.js
# 自带两道保险：目标文件已存在则拒跑；抽出的段异常小则拒跑（防止在已改过的文件上重复执行）
import io, re, os, sys

if os.path.exists('services/loss.js'):
    sys.exit('保险①：services/loss.js 已存在，拒绝重复执行。先恢复现场再跑。')

lines = io.open('utils/store.js', encoding='utf-8').read().split('\n')
start = next(i for i, l in enumerate(lines) if l.startswith('/* ===================== 损耗'))
end = next(i for i, l in enumerate(lines) if l.startswith('module.exports'))
seg = lines[start:end]

if len(seg) < 300:
    sys.exit('保险②：抽出的段只有 %d 行（应约 410 行），疑似在已改过的文件上执行，拒绝。' % len(seg))
if 'function saveConsumable' not in '\n'.join(seg):
    sys.exit('保险②b：段内没有 saveConsumable，定位失败，拒绝。')

text = '\n'.join(seg)
m = re.search(r"function getMonthlyProducedUnits.*?\n\}\n", text, re.S)
produced = m.group(0)
text_loss = text.replace(produced, '')

loss_src = """// services/loss.js —— 损耗（耗材 / 资产 / 工具）与月度/日度聚合（Day 3 任务 3.2 切片一）
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
// 当前经营大类（统一走状态层）
const currentSpace = state.getCurrentSpace;

""" + text_loss + """

module.exports = {
  getConsumables, getConsumablesOf, getConsumable, consumableUnitPrice, saveConsumable,
  startUseConsumable, outConsumable, splitStartUseConsumable, splitOutConsumable,
  undoStartUseConsumable, undoOutConsumable, removeConsumable,
  getAssets, getAssetsOf, getAsset, assetRepairTotal, assetMonthlyDepreciation, saveAsset,
  addAssetRepair, updateRepair, deleteRepair, scrapAsset, unscrapAsset, removeAsset,
  getTools, getToolsOf, getTool, saveTool, replaceTool, replaceToolWith, undoReplaceTool, removeTool,
  monthRange, monthIndex, consumableAmortForMonth, assetDepreciationForMonth, toolExpenseForMonth,
  getMonthlyLossCost, getDailyLossCost, getLossCostSeries
};
"""
io.open('services/loss.js', 'w', encoding='utf-8', newline='\n').write(loss_src)

shell = [
  "/* ===================== 损耗（耗材 / 资产 / 工具）——已迁移至 services/loss.js（薄壳转发） ===================== */",
  "const loss = require('../services/loss.js');",
  "const {",
  "  getConsumables, getConsumablesOf, getConsumable, consumableUnitPrice, saveConsumable,",
  "  startUseConsumable, outConsumable, splitStartUseConsumable, splitOutConsumable,",
  "  undoStartUseConsumable, undoOutConsumable, removeConsumable,",
  "  getAssets, getAssetsOf, getAsset, assetRepairTotal, assetMonthlyDepreciation, saveAsset,",
  "  addAssetRepair, updateRepair, deleteRepair, scrapAsset, unscrapAsset, removeAsset,",
  "  getTools, getToolsOf, getTool, saveTool, replaceTool, replaceToolWith, undoReplaceTool, removeTool,",
  "  monthRange, monthIndex, consumableAmortForMonth, assetDepreciationForMonth, toolExpenseForMonth,",
  "  getMonthlyLossCost, getDailyLossCost, getLossCostSeries",
  "} = loss;",
  "",
  "// 指定月份生产件数（依赖成品数据，留在本模块；月份边界由 services/loss.js 提供）",
  produced.rstrip('\n'),
  ""
]
lines[start:end] = shell
io.open('utils/store.js', 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print('切片完成: 损耗段 %d 行 -> services/loss.js' % len(seg))
