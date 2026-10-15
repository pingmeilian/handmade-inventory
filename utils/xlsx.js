// utils/xlsx.js —— 最小 XLSX 生成器（零第三方，2026-09-27 D78/V71）
//
// 背景：用户要把导出的 4 张表放进**不同 sheet**。CSV 是纯文本，**一个文件天生只有一张表**，
// 做不到 —— 所以必须生成 xlsx。
//
// ⚠️ 为什么不引库：项目约定「零第三方」，且 SheetJS 这类库体积会挤占小程序主包（上限 2MB）。
//    这里只实现「能被 Excel / WPS 打开」所需的最小结构。
//
// xlsx 的本质 = 一个 ZIP 包，里面放几段 XML：
//   ① [Content_Types].xml        声明各部分的类型
//   ② _rels/.rels                指向 xl/workbook.xml（整包的入口）
//   ③ xl/workbook.xml            有哪些 sheet、叫什么名字
//   ④ xl/_rels/workbook.xml.rels 每个 sheet 对应哪个 xml
//   ⑤ xl/worksheets/sheetN.xml   每张表的实际内容
// **少任何一个，Excel 都会说「文件已损坏」** —— tests/xlsx.test.js 就盯着这几项。
//
// 压缩方式选 **store（不压缩）**：省掉 deflate 实现、数据在包里是原样的（也便于测试解回来）；
// 代价是文件偏大，对几千行的清单无感。

/* ===================== CRC32（ZIP 校验用） ===================== */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ===================== UTF-8 编码（不依赖 TextEncoder） ===================== */
// 小程序对 TextEncoder 的支持不稳，自己写更可靠；也让本模块能在 Node 里直接跑测试。
function utf8Encode(str) {
  const s = String(str == null ? '' : str);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i);
    if (cp > 0xffff) i++;                       // 代理对：吃掉第二个码元
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return new Uint8Array(out);
}

/* ===================== XML 转义 ===================== */
// ⚠️ 不转义 = 文件直接损坏（用户只看到「文件已损坏」，查不出原因）
function xmlEsc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // XML 1.0 不允许控制字符；留在里面 Excel 会直接拒绝打开
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

/* ===================== 列号 → 字母（A…Z、AA…） ===================== */
function colName(idx) {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/* ===================== 每张表的 XML ===================== */
function sheetXml(sheet) {
  const headers = (sheet && sheet.headers) || [];
  const data = (sheet && sheet.rows) || [];
  const all = headers.length ? [headers].concat(data) : data;
  const rowXml = [];
  all.forEach((row, ri) => {
    const cells = [];
    (row || []).forEach((val, ci) => {
      if (val == null || val === '') return;    // 空单元格省略，文件更小
      const ref = colName(ci) + (ri + 1);
      // ⭐ 数字必须写成**数值单元格**（无 t 属性 + <v>）。
      //    全写成 inlineStr 的话，Excel 里读出来是文本，一整列数字没法求和/排序 ——
      //    而"导出拿去算账"正是本功能的意义。（这条是拿 openpyxl 交叉验证时发现的。）
      //    注意：日期保持字符串，不转 Excel 日期序列号（转了对用户反而更难读）。
      if (typeof val === 'number' && isFinite(val)) {
        cells.push('<c r="' + ref + '"><v>' + val + '</v></c>');
      } else {
        cells.push('<c r="' + ref + '" t="inlineStr"><is><t>' + xmlEsc(val) + '</t></is></c>');
      }
    });
    rowXml.push('<row r="' + (ri + 1) + '">' + cells.join('') + '</row>');
  });
  return XML_HEAD +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>' + rowXml.join('') + '</sheetData></worksheet>';
}

/* ===================== 四个结构文件 ===================== */
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function contentTypesXml(n) {
  let s = XML_HEAD +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
  for (let i = 1; i <= n; i++) {
    s += '<Override PartName="/xl/worksheets/sheet' + i + '.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
  }
  return s + '</Types>';
}

const ROOT_RELS = XML_HEAD +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
  'Target="xl/workbook.xml"/></Relationships>';

// sheet 名有硬约束：非空、≤31 字符、不含 : \ / ? * [ ]
// （不改的话 Excel 报「文件已损坏」，而且这个错在生成时完全看不出来）
function safeSheetName(name, i) {
  const cleaned = String(name || '').replace(/[:\\\/\?\*\[\]]/g, '_').slice(0, 31);
  return cleaned || ('Sheet' + (i + 1));
}

function workbookXml(sheets) {
  let s = XML_HEAD +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
  sheets.forEach((sh, i) => {
    s += '<sheet name="' + xmlEsc(safeSheetName(sh && sh.name, i)) + '" sheetId="' + (i + 1) +
      '" r:id="rId' + (i + 1) + '"/>';
  });
  return s + '</sheets></workbook>';
}

function workbookRelsXml(n) {
  let s = XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  for (let i = 1; i <= n; i++) {
    s += '<Relationship Id="rId' + i + '" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
      'Target="worksheets/sheet' + i + '.xml"/>';
  }
  return s + '</Relationships>';
}

/* ===================== ZIP 打包（store，不压缩） ===================== */
function zipStore(files) {
  const chunks = [];      // local header + data
  const central = [];
  let offset = 0;

  files.forEach(f => {
    const nameBytes = utf8Encode(f.name);
    const dataBytes = typeof f.data === 'string' ? utf8Encode(f.data) : f.data;
    const crc = crc32(dataBytes);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // local file header 签名
    lv.setUint16(4, 20, true);           // version needed to extract
    lv.setUint16(6, 0x0800, true);       // flags：文件名按 UTF-8（中文路径必需）
    lv.setUint16(8, 0, true);            // 压缩方法 0 = store
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);   // 压缩后大小
    lv.setUint32(22, dataBytes.length, true);   // 原始大小
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    chunks.push(local, dataBytes);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);   // central directory 签名
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);      // 对应 local header 的偏移
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + dataBytes.length;
  });

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);     // EOCD 签名
  ev.setUint16(8, files.length, true);   // 本磁盘条目数
  ev.setUint16(10, files.length, true);  // 总条目数
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);        // central directory 起始偏移

  const all = chunks.concat(central).concat([eocd]);
  const total = all.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  all.forEach(c => { out.set(c, p); p += c.length; });
  return out;
}

/* ===================== 对外 ===================== */
/**
 * 生成 xlsx 字节流
 * @param {Array} sheets [{ name: '物料表', headers: [...], rows: [[...], ...] }]
 * @returns {Uint8Array}
 */
function buildXlsx(sheets) {
  const list = (sheets && sheets.length) ? sheets : [{ name: 'Sheet1', headers: [], rows: [] }];
  const files = [
    { name: '[Content_Types].xml', data: contentTypesXml(list.length) },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'xl/workbook.xml', data: workbookXml(list) },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml(list.length) }
  ];
  list.forEach((sh, i) => {
    files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(sh) });
  });
  return zipStore(files);
}

module.exports = { buildXlsx, crc32, utf8Encode, xmlEsc, colName };
