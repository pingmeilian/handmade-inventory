// pages/products/tutorial-export.js —— 教程预览 + 导出（A4 PDF / 长图 / 3:4 自媒体 / CSV）
const app = getApp();
const util = require('../../utils/util.js');
const tx = require('../../utils/tutorial-export.js');

const BRAND = '别针手作';
const C_BG = '#FAF6F0';       // 奶油纸底
const C_BAR = '#C28E72';      // 暖陶色条
const C_TITLE = '#4A3F35';    // 深棕标题
const C_BODY = '#6F6358';     // 正文
const C_SUB = '#A99B8D';      // 次要
const C_LINE = '#EDE4D9';     // 分隔线

const themePage = require('../../utils/theme-page.js');   // 主题：页面统一入口（V97）

Page({
  onShow() { themePage.apply(this); },   // 主题（V97）

  data: {
    draft: null,
    tut: null,
    mode: 'preview',
    busy: false,
    lastFile: null,   // 已生成待转发/另存的文件（两段式导出的第二段入口）
    imgPreview: { show: false, idx: 0, urls: [], remark: '' }
  },

  onLoad(options) {
    this.draft = app.globalData.tutDraft || null;
    const draft = this.draft;
    if (!draft || !draft.tutorial || !draft.tutorial.steps.length) {
      this.setData({ draft: null, tut: null });
      wx.showToast({ title: '暂无教程内容', icon: 'none' });
      return;
    }
    const tut = {
      title: draft.tutorial.title || (draft.name ? draft.name + ' 制作教程' : ''),
      steps: draft.tutorial.steps.map(s => ({
        title: s.title || '', body: s.body || '',
        images: (s.images || []).map(im => ({ path: im.path, remark: im.remark || '' })),
        mats: (s.mats || []).slice()
      }))
    };
    this.setData({ draft, tut, mode: options.mode || 'preview' });
  },

  /* ===================== 通用画布工具 ===================== */
  _canvas(id) {
    return new Promise((resolve) => {
      wx.createSelectorQuery().in(this).select('#' + id).fields({ node: true, size: true }).exec((res) => {
        if (!res || !res[0] || !res[0].node) return resolve(null);
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2;
        resolve({ canvas, ctx, dpr, w: res[0].width, h: res[0].height });
      });
    });
  },
  _loadImg(canvas, path) {
    return new Promise((resolve, reject) => {
      if (!path) return reject(new Error('空路径'));
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('加载超时')); } }, 8000);
      const tryCreate = (p) => new Promise((res, rej) => {
        const img = canvas.createImage();
        img.onload = () => { if (done) return; done = true; clearTimeout(timer); res(img); };
        img.onerror = () => { if (done) return; rej(new Error('createImage 失败')); };
        img.src = p;
      });
      // 1) 优先直接用存储路径（wxfile://store/... USER_DATA_PATH，微信 canvas 2D 原生支持）
      tryCreate(path)
        .then(resolve)
        .catch(() => {
          if (done) return;
          // 2) 兜底：getImageInfo 取系统可信本地路径
          wx.getImageInfo({
            src: path,
            success: (info) => { if (done) return; tryCreate(info.path).then(resolve).catch(fallbackB64); },
            fail: () => { if (!done) fallbackB64(); }
          });
        });
      // 3) 再兜底：读成 base64 dataURL 喂给 createImage
      function fallbackB64() {
        if (done) return;
        wx.getFileSystemManager().readFile({
          filePath: path, encoding: 'base64',
          success: (r) => {
            if (done) return;
            const mime = /\.png$/i.test(path) ? 'image/png' : 'image/jpeg';
            tryCreate('data:' + mime + ';base64,' + r.data)
              .then(resolve)
              .catch(() => { if (!done) { done = true; clearTimeout(timer); reject(new Error('base64 加载失败')); } });
          },
          fail: () => { if (!done) { done = true; clearTimeout(timer); reject(new Error('readFile 失败')); } }
        });
      }
    });
  },
  _wrap(ctx, text, maxW) {
    const out = []; let line = '';
    for (const ch of String(text || '')) {
      if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; }
      else line += ch;
    }
    if (line) out.push(line);
    return out;
  },
  _watermark(ctx, w, h) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = C_BAR;
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(BRAND, w - 28, h - 26);
    ctx.restore();
  },

  /* ===================== A4 PDF 工艺单 ===================== */
  async exportPdf() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '生成中…' });
    try {
      const PW = 794, PH = 1123, dpr = 2;
      const c = await this._canvas('exportCanvas');
      if (!c) throw new Error('canvas');
      c.canvas.width = PW * dpr; c.canvas.height = PH * dpr;
      c.ctx.scale(dpr, dpr);
      this._drawDoc(c.ctx, c.canvas, PW, PH, this.data.draft, { watermark: false });
      const tmp = await new Promise((res, rej) => wx.canvasToTempFilePath({
        canvas: c.canvas, x: 0, y: 0, width: c.canvas.width, height: c.canvas.height,
        destWidth: c.canvas.width, destHeight: c.canvas.height, fileType: 'jpg', quality: 0.92,
        success: r => res(r.tempFilePath), fail: rej
      }, this));
      const b64 = await this._fileBase64(tmp);
      const pdfBuf = tx.makePdfFromJpeg(b64, PW, PH, PW * dpr, PH * dpr);
      const out = `${wx.env.USER_DATA_PATH}/${this._fileName('pdf')}`;
      wx.getFileSystemManager().writeFile({ filePath: out, data: pdfBuf, success: () => this._afterExport(out), fail: (e) => util.toast('PDF 写入失败') });
    } catch (e) { util.toast('生成失败：' + (e.message || e)); }
    finally { wx.hideLoading(); this.setData({ busy: false }); }
  },

  /* ===================== 竖版长图 ===================== */
  async exportLong() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '生成中…' });
    try {
      const W = 750;
      const H = this._measureHeight(W, this.data.draft);
      const c = await this._canvas('exportCanvas');
      if (!c) throw new Error('canvas');
      const dpr = 2;
      c.canvas.width = W * dpr; c.canvas.height = H * dpr;
      c.ctx.scale(dpr, dpr);
      this._drawDoc(c.ctx, c.canvas, W, H, this.data.draft, { watermark: true });
      const tmp = await new Promise((res, rej) => wx.canvasToTempFilePath({
        canvas: c.canvas, x: 0, y: 0, width: c.canvas.width, height: c.canvas.height,
        destWidth: c.canvas.width, destHeight: c.canvas.height, fileType: 'jpg', quality: 0.92,
        success: r => res(r.tempFilePath), fail: rej
      }, this));
      this._saveImage(tmp);
    } catch (e) { util.toast('生成失败：' + (e.message || e)); }
    finally { wx.hideLoading(); this.setData({ busy: false }); }
  },

  /* ===================== 3:4 自媒体配图（分页 + 水印） ===================== */
  async exportSocial() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '分页生成中…' });
    try {
      const cards = tx.paginateSocial(this.data.draft.tutorial, {});
      const W = 750, H = 1000, dpr = 2;
      const paths = [];
      for (let ci = 0; ci < cards.length; ci++) {
        const c = await this._canvas('exportCanvas');
        if (!c) throw new Error('canvas');
        c.canvas.width = W * dpr; c.canvas.height = H * dpr;
        c.ctx.scale(dpr, dpr);
        await this._drawSocialCard(c.ctx, c.canvas, W, H, this.data.draft, cards[ci], ci + 1, cards.length);
        const tmp = await new Promise((res, rej) => wx.canvasToTempFilePath({
          canvas: c.canvas, x: 0, y: 0, width: c.canvas.width, height: c.canvas.height,
          destWidth: c.canvas.width, destHeight: c.canvas.height, fileType: 'jpg', quality: 0.92,
          success: r => res(r.tempFilePath), fail: rej
        }, this));
        paths.push(tmp);
      }
      this._saveImages(paths);
    } catch (e) { util.toast('生成失败：' + (e.message || e)); }
    finally { wx.hideLoading(); this.setData({ busy: false }); }
  },

  /* ===================== CSV ===================== */
  exportCsv() {
    if (this.data.busy) return;
    const draft = this.data.draft;
    const matNames = {}; (draft.bom || []).forEach(b => { if (b.materialName) matNames[b.materialName] = b.materialName; });
    // 步骤绑定物料已是名称数组（快照），直接传空映射
    const csv = tx.buildCsv({
      name: draft.name, productCategoryName: '', nature: draft.nature, price: draft.price,
      bom: (draft.bom || []).map(b => ({ materialName: b.materialName, isFabric: b.isFabric, stockMode: b.stockMode, batchUsage: b.batchUsage, batchUnit: b.batchUnit, length: b.length, width: b.width, unit: b.unit })),
      tutorial: { steps: (draft.tutorial.steps || []).map(s => ({ title: s.title, body: s.body, images: s.images, mats: s.mats })) }
    }, { matNames });
    const out = `${wx.env.USER_DATA_PATH}/${this._fileName('csv')}`;
    wx.getFileSystemManager().writeFile({
      filePath: out, data: csv, encoding: 'utf8',
      success: () => this._afterExport(out),
      fail: () => util.toast('CSV 写入失败')
    });
  },

  /* ===================== 绘制：文档（A4 / 长图） ===================== */
  _measureHeight(W, draft) {
    const pad = 40, titleH = 150, stepGap = 28;
    let h = pad + titleH + pad;
    const ctx = wx.createCanvasContext ? null : null;
    // 粗略估算：正文按每行 ~36px、图片 ~ (W-2pad)/2 高度
    (draft.tutorial.steps || []).forEach(s => {
      let sh = 60;
      const bodyLines = Math.ceil((s.body || '').length / 22);
      sh += bodyLines * 34 + 10;
      const imgs = s.images || [];
      if (imgs.length) {
        const perRow = 2; const rows = Math.ceil(imgs.length / perRow);
        const iw = (W - 2 * pad - 16) / perRow;
        sh += rows * iw + 10;
      }
      sh += 30; // 物料
      h += sh + stepGap;
    });
    return Math.max(h, 800);
  },
  async _drawDoc(ctx, canvas, W, H, draft, opt) {
    ctx.fillStyle = C_BG; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C_BAR; ctx.fillRect(0, 0, W, 16);
    const pad = 40;
    let y = 70;
    ctx.textAlign = 'left'; ctx.fillStyle = C_TITLE; ctx.font = 'bold 40px sans-serif';
    const docTitle = draft.tutorial.title || draft.name;
    ctx.fillText(this._cut(docTitle, 18), pad, y);
    y += 44;
    ctx.fillStyle = C_SUB; ctx.font = '26px sans-serif';
    ctx.fillText(this._cut(draft.name, 24) + ' · 共 ' + draft.tutorial.steps.length + ' 步', pad, y);
    y += 46;
    ctx.strokeStyle = C_LINE; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
    y += 30;
    const iw = (W - 2 * pad - 16) / 2;
    for (let i = 0; i < draft.tutorial.steps.length; i++) {
      const s = draft.tutorial.steps[i];
      ctx.fillStyle = C_BAR; ctx.font = 'bold 30px sans-serif';
      ctx.fillText('步骤 ' + (i + 1), pad, y + 22);
      ctx.fillStyle = C_TITLE; ctx.font = 'bold 30px sans-serif';
      ctx.fillText(this._cut(s.title, 16), pad + 110, y + 22);
      y += 44;
      if (s.body) {
        ctx.fillStyle = C_BODY; ctx.font = '26px sans-serif';
        const lines = this._wrap(ctx, s.body, W - 2 * pad);
        lines.forEach(l => { ctx.fillText(l, pad, y); y += 34; });
        y += 6;
      }
      // 图片网格
      const imgs = s.images || [];
      for (let j = 0; j < imgs.length; j++) {
        const col = j % 2, row = Math.floor(j / 2);
        const x = pad + col * (iw + 16);
        const iy = y + row * (iw + 10);
        try {
          const img = await this._loadImg(canvas, imgs[j].path);
          this._roundRectPath(ctx, x, iy, iw, iw, 12); ctx.save(); ctx.clip();
          ctx.drawImage(img, x, iy, iw, iw); ctx.restore();
        } catch (e) {
          ctx.fillStyle = C_LINE; this._roundRectPath(ctx, x, iy, iw, iw, 12); ctx.fill();
          ctx.fillStyle = C_SUB; ctx.font = '20px sans-serif';
          ctx.fillText('图加载失败:' + this._cut(String(e && e.message || '未知'), 16), x + 6, iy + iw / 2 - 8);
        }
        // 图片备注
        if (imgs[j].remark) {
          ctx.fillStyle = C_SUB; ctx.font = '22px sans-serif';
          const rl = this._wrap(ctx, imgs[j].remark, iw);
          rl.slice(0, 2).forEach((l, k) => ctx.fillText(l, x, iy + iw + 22 + k * 26));
        }
      }
      if (imgs.length) y += Math.ceil(imgs.length / 2) * (iw + 10) + (imgs.some(im => im.remark) ? 40 : 10);
      if (s.mats && s.mats.length) {
        ctx.fillStyle = C_SUB; ctx.font = '24px sans-serif';
        ctx.fillText('🧷 ' + s.mats.join('、'), pad, y); y += 30;
      }
      y += 22;
      ctx.strokeStyle = C_LINE; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
      y += 22;
    }
    if (opt && opt.watermark) this._watermark(ctx, W, H);
  },

  /* ===================== 绘制：单张 3:4 自媒体配图 ===================== */
  async _drawSocialCard(ctx, canvas, W, H, draft, card, idx, total) {
    ctx.fillStyle = C_BG; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C_BAR; ctx.fillRect(0, 0, W, 14);
    const pad = 44;
    let y = 80;
    ctx.textAlign = 'left'; ctx.fillStyle = C_TITLE; ctx.font = 'bold 38px sans-serif';
    ctx.fillText(this._cut(draft.tutorial.title || draft.name, 16), pad, y);
    y += 50;
    ctx.fillStyle = C_SUB; ctx.font = '24px sans-serif';
    ctx.fillText('第 ' + idx + ' / ' + total + ' 张', pad, y);
    y += 40;
    ctx.strokeStyle = C_LINE; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
    y += 30;
    const iw = (W - 2 * pad - 18) / 2;
    const blocks = card.blocks || [];
    for (const b of blocks) {
      if (b.continuation) { ctx.fillStyle = C_SUB; ctx.font = '24px sans-serif'; ctx.fillText('（接上）' + this._cut(b.title, 14), pad, y); y += 34; }
      else {
        ctx.fillStyle = C_BAR; ctx.font = 'bold 30px sans-serif';
        ctx.fillText('步骤', pad, y + 20);
        ctx.fillStyle = C_TITLE; ctx.font = 'bold 30px sans-serif';
        ctx.fillText(this._cut(b.title, 14), pad + 90, y + 20); y += 44;
      }
      if (b.body) {
        ctx.fillStyle = C_BODY; ctx.font = '26px sans-serif';
        const lines = this._wrap(ctx, b.body, W - 2 * pad);
        lines.slice(0, 6).forEach(l => { ctx.fillText(l, pad, y); y += 34; });
        y += 4;
      }
      const imgs = b.images || [];
      for (let j = 0; j < imgs.length; j++) {
        const col = j % 2, row = Math.floor(j / 2);
        const x = pad + col * (iw + 18);
        const iy = y + row * (iw + 12);
        if (iy + iw > H - 70) break; // 防止溢出卡片底
        try {
          const img = await this._loadImg(canvas, imgs[j].path);
          this._roundRectPath(ctx, x, iy, iw, iw, 12); ctx.save(); ctx.clip();
          ctx.drawImage(img, x, iy, iw, iw); ctx.restore();
        } catch (e) {
          ctx.fillStyle = C_LINE; this._roundRectPath(ctx, x, iy, iw, iw, 12); ctx.fill();
          ctx.fillStyle = C_SUB; ctx.font = '20px sans-serif';
          ctx.fillText('图加载失败:' + this._cut(String(e && e.message || '未知'), 16), x + 6, iy + iw / 2 - 8);
        }
        if (imgs[j].remark) {
          ctx.fillStyle = C_SUB; ctx.font = '22px sans-serif';
          const rl = this._wrap(ctx, imgs[j].remark, iw);
          rl.slice(0, 2).forEach((l, k) => ctx.fillText(l, x, iy + iw + 22 + k * 26));
        }
      }
      if (imgs.length) y += Math.ceil(imgs.length / 2) * (iw + 12) + (imgs.some(im => im.remark) ? 40 : 8);
      if (b.mats && b.mats.length) { ctx.fillStyle = C_SUB; ctx.font = '24px sans-serif'; ctx.fillText('🧷 ' + b.mats.join('、'), pad, y); y += 28; }
      y += 16;
    }
    this._watermark(ctx, W, H);
  },

  _roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  },
  _cut(str, n) { str = String(str || ''); return str.length > n ? str.slice(0, n) + '…' : str; },

  _fileBase64(path) {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({ filePath: path, encoding: 'base64', success: r => resolve(r.data), fail: reject });
    });
  },

  /* ===================== 结果处理 ===================== */
  _saveImage(tmp) {
    wx.saveImageToPhotosAlbum({
      filePath: tmp,
      success: () => util.toast('已保存到相册', 'success'),
      fail: (e) => {
        if ((e.errMsg || '').indexOf('auth') >= 0 || (e.errMsg || '').indexOf('deny') >= 0) {
          wx.showModal({ title: '需要相册权限', content: '请在设置中允许保存到相册', confirmText: '去设置', success: r => { if (r.confirm) wx.openSetting(); } });
        } else util.toast('保存失败');
      }
    });
  },
  _saveImages(paths) {
    if (!paths.length) return;
    let i = 0;
    const next = () => {
      if (i >= paths.length) { util.toast('已保存 ' + paths.length + ' 张配图', 'success'); return; }
      const p = paths[i++];
      wx.saveImageToPhotosAlbum({ filePath: p, success: next, fail: (e) => { if ((e.errMsg || '').indexOf('auth') >= 0) { util.toast('请授权相册'); } else util.toast('第' + i + '张保存失败'); next(); } });
    };
    next();
  },
  /* ===================== 文件落盘：真实可找到的保存位置 =====================
     小程序沙盒内的 wxfile:// 路径用户找不到，所以：
     - 电脑端（开发者工具/Windows/Mac）：wx.saveFileToDisk 弹出系统"另存为"，用户自选文件夹
     - 手机端：wx.shareFileMessage 把文件发给好友/文件传输助手，聊天内可打开、可另存
     ★ 2026-09-12 真机事故：导出完成后**不能**自动转发 —— 微信要求 shareFileMessage
       必须由 TAP 手势直接触发，在 await 之后的异步链条里调用必然失败（官方 FAQ 同）。
       因此拆成两段：导出只记录文件并提示；转发/另存由下面的按钮（tap 首行同步调用）负责。 */
  _fileName(ext) {
    const safe = String((this.data.draft && this.data.draft.name) || '成品').replace(/[\\/:*?"<>|]/g, '');
    const d = new Date();
    const p2 = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
    return `别针手作_${safe}_${stamp}.${ext}`;
  },
  _platform() {
    try { if (wx.getDeviceInfo) return wx.getDeviceInfo().platform; } catch (e) {}
    try { return wx.getSystemInfoSync().platform; } catch (e) { return ''; }
  },
  // 第一段（导出完成后调用）：记录文件 + 提示用户点按钮
  _afterExport(path) {
    const fileName = path.split('/').pop();
    this.setData({ lastFile: { path: path, name: fileName } });
    util.toast('已生成，请点「转发 / 另存这个文件」');
  },

  // 第二段：⚠️ 必须在本 tap 处理器里同步调用（首行）——微信硬约束，详见 utils/share.js
  shareGenerated() {
    const f = this.data.lastFile;
    if (!f) { util.toast('请先导出一个文件'); return; }
    const pf = this._platform();
    const isDesktop = pf === 'devtools' || pf === 'windows' || pf === 'mac';
    if (isDesktop) {
      wx.saveFileToDisk({
        filePath: f.path,
        success: () => util.toast('已保存到你选择的文件夹', 'success'),
        fail: (e) => {
          if ((e.errMsg || '').indexOf('cancel') >= 0) return; // 用户取消另存为
          wx.showModal({
            title: '另存失败',
            content: (e && e.errMsg) || '请重试；也可在手机微信里打开本页，用「转发」保存到聊天。',
            showCancel: false, confirmText: '知道了'
          });
        }
      });
      return;
    }
    share.shareFileNow(f.path, f.name).then((r) => {
      if (r.ok) { util.toast('已发送，在聊天里打开即可保存', 'success'); return; }
      if (r.reason === 'cancel') return;   // 用户主动取消，不打扰
      wx.showModal({ title: '转发失败', content: r.msg, showCancel: false, confirmText: '知道了' });
    });
  },

  previewImage(e) {
    const i = Number(e.currentTarget.dataset.i), j = Number(e.currentTarget.dataset.j);
    const images = this.data.tut.steps[i].images || [];
    const urls = images.map(im => im.path);
    const remark = images[j] ? images[j].remark : '';
    this.setData({ imgPreview: { show: true, idx: j, urls, remark } });
  },
  onPreviewChange(e) {
    const idx = e.detail.current;
    const step = this.data.tut.steps.find(s => (s.images || []).some(im => this.data.imgPreview.urls.includes(im.path)));
    const remark = step && step.images[idx] ? step.images[idx].remark : '';
    this.setData({ 'imgPreview.idx': idx, 'imgPreview.remark': remark });
  },
  closeImgPreview() {
    this.setData({ imgPreview: { show: false, idx: 0, urls: [], remark: '' } });
  },
  goBack() { wx.navigateBack(); }
});
