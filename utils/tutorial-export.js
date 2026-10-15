// utils/tutorial-export.js —— 教程导出纯逻辑（可在 Node 下单测，无 wx 依赖）
// 仅包含：分页算法、CSV 生成、JPEG 内嵌 PDF 生成。
// Canvas 绘制在导出页内完成（依赖 wx）。

/* ============ 1. 自媒体配图分页算法（3:4 小红书竖版） ============
 * 核心规则（严格）：
 *  - 完整一条工序步骤禁止跨两张配图拆分（原子性：不与其他步骤穿插）
 *  - 短内容步骤：自动把多条简短完整步骤排版填充到单张 3:4 画面内
 *  - 图片过多的长步骤：该步骤独占一张或多张配图，分页保留统一步骤标题，不割裂工序逻辑
 *  - 手动分页标记 pageBreak=true：在该步骤前强制新开一张配图
 * 返回：cards = [{ blocks:[{ stepId, title, body, images:[{path,remark}], mats:[materialName], continuation }] }]
 */
function estimateStepWeight(step) {
  let w = 1.0;                                  // 标题 + 正文基础权重
  w += Math.min((step.images || []).length, 16) * 1.5;          // 每张图权重
  w += Math.min((step.body || '').length, 240) / 130;           // 正文长度
  return w;
}

const SOCIAL_CAPACITY = 6;        // 单张 3:4 可合卡的短步骤经验容量
const MAX_IMG_PER_CARD = 9;       // 单卡图片上限（超出则长步骤拆卡，保留标题）

function paginateSocial(tutorial, opts) {
  const capacity = (opts && opts.capacity) || SOCIAL_CAPACITY;
  const steps = (tutorial.steps || []).filter(s =>
    (s.title || '').trim() || (s.body || '').trim() || (s.images || []).length || (s.mats || []).length
  );
  const cards = [];
  let cur = [];
  let curW = 0;

  const flush = () => { if (cur.length) { cards.push({ blocks: cur }); cur = []; curW = 0; } };

  for (const s of steps) {
    if (s.pageBreak && cur.length) flush();      // 手动分页：前一步强制收卡
    const w = estimateStepWeight(s);

    // 当前卡为空：单步直接入卡（哪怕很重也独占，保证原子性）
    if (!cur.length) { cur = [blockOf(s, false)]; curW = w; continue; }

    // 加入会超容量且卡内已有步骤 → 新卡（完整步骤不跨卡）
    if (curW + w > capacity) { flush(); cur = [blockOf(s, false)]; curW = w; }
    else { cur.push(blockOf(s, false)); curW += w; }
  }
  flush();

  // 长步骤拆卡：若某卡内单个步骤图片数 > 上限，把其图片拆成多组，每组保留标题/正文/物料
  const split = [];
  cards.forEach(card => {
    const heavy = card.blocks.filter(b => b.images.length > MAX_IMG_PER_CARD);
    if (!heavy.length) { split.push(card); return; }
    // 逐 block 处理（通常一张卡内最多一个超量步骤）
    card.blocks.forEach((b, bi) => {
      if (b.images.length > MAX_IMG_PER_CARD) {
        const groups = chunk(b.images, MAX_IMG_PER_CARD);
        groups.forEach((g, gi) => {
          split.push({ blocks: [{ stepId: b.stepId, title: b.title, body: b.body, images: g, mats: b.mats, continuation: gi > 0 }] });
        });
      } else {
        split.push({ blocks: [b] });
      }
      if (bi < card.blocks.length - 1) split.push({ blocks: [] }); // 占位保持顺序（空卡忽略）
    });
  });
  return split.filter(c => c.blocks.length);
}

function blockOf(step, continuation) {
  return {
    stepId: step.id,
    title: (step.title || '').trim(),
    body: (step.body || '').trim(),
    images: (step.images || []).map(im => ({ path: im.path, remark: im.remark || '' })),
    mats: (step.mats || []).slice(),
    continuation: !!continuation
  };
}
function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

/* ============ 2. CSV 生成（成品 + BOM + 步骤标题/正文 + 图片备注 + 物料绑定） ============ */
function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function buildCsv(product, opts) {
  const matNames = (opts && opts.matNames) || {};   // materialId -> name
  const rows = [];
  rows.push(['成品名称', '成品类别', '状态', '售价(元)', '物料清单', '步骤序号', '步骤标题', '步骤正文', '图片备注', '绑定物料']);
  const bomText = (product.bom || []).map(b => {
    const name = b.materialName || matNames[b.materialId] || '物料';
    const qty = b.isFabric
      ? (b.stockMode === 'batch' ? ('每件' + (b.batchUsage || 0) + (b.batchUnit || 'kg')) : ((b.length || 0) + '×' + (b.width || 0) + 'cm'))
      : (b.usage || 0) + (b.unit || '');
    return name + '×' + qty;
  }).join('；');
  const tut = product.tutorial || {};
  const steps = (tut.steps || []).filter(s => (s.title || '').trim() || (s.body || '').trim() || (s.images || []).length || (s.mats || []).length);
  if (!steps.length) {
    rows.push([product.name || '', product.productCategoryName || '', product.nature === 'sample' ? '样品' : '商品', product.price || 0, bomText, '', '', '', '', '']);
  } else {
    steps.forEach((s, i) => {
      const remarks = (s.images || []).map(im => (im.remark || '').trim()).filter(Boolean).join(' | ');
      const mats = (s.mats || []).map(id => matNames[id] || '物料').join(' | ');
      rows.push([
        product.name || '', product.productCategoryName || '', product.nature === 'sample' ? '样品' : '商品', product.price || 0, bomText,
        String(i + 1), (s.title || '').trim(), (s.body || '').trim(), remarks, mats
      ]);
    });
  }
  const lines = rows.map(r => r.map(csvEscape).join(','));
  // BOM 编码 \uFEFF 让 Excel 正确识别中文
  return '﻿' + lines.join('\r\n');
}

/* ============ 3. JPEG 内嵌生成真实 PDF（ArrayBuffer） ============ */
function base64ToBytes(b64) {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const len = bin.length; const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i) & 0xff;
  return arr;
}
function makePdfFromJpeg(jpegBase64, w, h, iw, ih) {
  const img = base64ToBytes(jpegBase64);
  const W = w, H = h, IW = iw || w, IH = ih || h;
  // 各个对象体（不含 xref）
  const objCatalog = '<< /Type /Catalog /Pages 2 0 R >>';
  const objPages = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  const objPage = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`;
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  const objContent = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  const objImage = `<< /Type /XObject /Subtype /Image /Width ${IW} /Height ${IH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream`;
  // 组装字节
  const enc = (s) => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff; return a; };
  const header = enc('%PDF-1.4\n');
  const parts = [
    { id: 1, body: enc(objCatalog) },
    { id: 2, body: enc(objPages) },
    { id: 3, body: enc(objPage) },
    { id: 4, body: enc(objContent) },
    { id: 5, body: enc(objImage) }
  ];
  // 计算偏移
  const offsets = [];
  let pos = header.length;
  const bodies = [];
  parts.forEach(p => { offsets[p.id] = pos; bodies[p.id] = p.body; pos += p.body.length; });
  // image stream 紧跟 objImage 之后（含 stream\n + bytes + \nendstream）
  const streamHead = enc('\nstream\n');
  const streamTail = enc('\nendstream');
  const xrefPos = pos + streamHead.length + img.length + streamTail.length;

  const xrefCount = 6; // 0 占位 + 5 对象
  let xref = 'xref\n0 ' + xrefCount + '\n';
  xref += '0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    xref += ('0000000000' + offsets[i]).slice(-10) + ' 00000 n \n';
  }
  const trailer = `trailer\n<< /Size ${xrefCount} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  const xrefBytes = enc(xref);
  const trailerBytes = enc(trailer);

  const total = header.length + parts.reduce((s, p) => s + p.body.length, 0)
    + streamHead.length + img.length + streamTail.length + xrefBytes.length + trailerBytes.length;
  const out = new Uint8Array(total);
  let o = 0;
  const put = (a) => { out.set(a, o); o += a.length; };
  put(header);
  for (let i = 1; i <= 5; i++) put(bodies[i]);
  put(streamHead); put(img); put(streamTail); put(xrefBytes); put(trailerBytes);
  return out.buffer;
}

module.exports = { paginateSocial, buildCsv, makePdfFromJpeg, estimateStepWeight, SOCIAL_CAPACITY, MAX_IMG_PER_CARD };
