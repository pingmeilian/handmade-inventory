// pages/settings/export.js —— 数据导出（单项 = CSV，全部 = xlsx 多 sheet）
const csv = require('../../utils/csv.js');
const xlsx = require('../../utils/xlsx.js');
const util = require('../../utils/util.js');
const share = require('../../utils/share.js');

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  onShow() { themePage.apply(this); },   // 主题（V97）

  data: {
    exported: null   // { path, name } 最近一次导出文件，用于打开 / 转发
  },

  _write(kind) {
    // 「一键导出全部」走 xlsx（一个文件 4 个 sheet）—— 见 _writeAll
    if (kind === 'all') return this._writeAll();

    let content = '', filename = '', label = '';
    if (kind === 'materials') { content = csv.exportMaterials(); filename = '物料表.csv'; label = '物料'; }
    else if (kind === 'products') { content = csv.exportProducts(); filename = '成品表.csv'; label = '成品'; }
    else if (kind === 'flows') { content = csv.exportFlows(); filename = '物料出入库.csv'; label = '物料出入库'; }
    // 2026-09-27（V70）：成品的进出不在物料流水里（记在成品对象上）⇒ 单独一张表
    else { content = csv.exportProductFlows(); filename = '成品出入库.csv'; label = '成品出入库'; }
    return csv.writeCSVFile(filename, content).then((path) => {
      // 走 util.copyText：内容为空 / 写入失败 都要有提示（旧的裸调用失败时是完全静默的）。
      // failText 指"本页真正可用"的兜底 —— 这一页没有可长按的文本，别照搬"长按手动复制"
      util.copyText(content, {
        okText: label + '数据已复制到剪贴板',
        emptyText: '没有可复制的数据',
        failText: '复制失败，可改用下面的「转发给好友」或「打开文件」'
      });
      this.setData({ exported: { path: path, name: filename } });
    }).catch(() => { util.toast('导出失败，请重试'); throw new Error('export fail'); });
  },

  // 一键导出全部 → xlsx（一个文件，4 个工作表）
  //
  // 为什么不是 CSV：CSV 是纯文本，**一个文件天生只有一张表** ——
  // 早先把 4 张表首尾拼进一个 CSV，结果 4 个表头混在数据中间，
  // 在 Excel 里既没法分别筛选、也没法求和。xlsx 才有「工作表（sheet）」这个概念。
  //
  // ⚠️ xlsx 是**二进制**，走不了「复制到剪贴板」（那是 CSV 那条路）——
  //    只能打开文件或转发给好友，所以这里用弹窗把下一步说清楚。
  _writeAll() {
    const bytes = xlsx.buildXlsx(csv.allSheets());
    return csv.writeBinaryFile('全量数据.xlsx', bytes).then((path) => {
      this.setData({ exported: { path: path, name: '全量数据.xlsx' } });
      wx.showModal({
        title: '已生成 Excel 文件',
        content: '一个文件里 4 个工作表：物料表 / 成品表 / 物料出入库 / 成品出入库。\n\n'
          + 'Excel 不能复制到剪贴板 —— 请点「打开文件」查看，或「转发给好友」保存到微信。',
        showCancel: false, confirmText: '知道了'
      });
    }).catch(() => { util.toast('导出失败，请重试'); throw new Error('export xlsx fail'); });
  },

  doExport(e) { this._write(e.currentTarget.dataset.kind); },
  exportAll() { this._write('all'); },

  // 打开文件（T-2：提供打开入口，wx.openDocument 自带转发菜单）
  openFile() {
    const ex = this.data.exported;
    if (!ex) { util.toast('请先导出一份数据'); return; }
    wx.openDocument({
      filePath: ex.path, showMenu: true,
      success: () => {},
      fail: () => util.toast('当前环境不支持预览，已复制到剪贴板')
    });
  },

  // 转发给好友（T-2：提供转发入口）
  // ⚠️ 必须在 tap 处理器里同步调用（首行）——微信硬约束，详见 utils/share.js
  shareFile() {
    const ex = this.data.exported;
    if (!ex) { util.toast('请先导出一份数据'); return; }
    share.shareFileNow(ex.path, ex.name).then((r) => {
      if (r.ok) { util.toast('已发出，请确认对方收到', 'success'); return; }
      if (r.reason === 'cancel') return;   // 用户主动取消
      // 真实原因必须让用户看见（此前一律报「分享已取消」，把错误全吞了）
      wx.showModal({ title: '转发失败', content: r.msg, showCancel: false, confirmText: '知道了' });
    });
  }
});
