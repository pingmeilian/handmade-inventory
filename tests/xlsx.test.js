// tests/xlsx.test.js —— 手写 xlsx 生成器（零第三方，2026-09-27 D78/V71）
//
// 为什么这个文件值得写这么细：
// xlsx 是**二进制 + ZIP 结构**，写错一个字节用户就"打不开"，
// 而且这种坏是**完全静默的** —— 生成时没有报错、只有双击文件那一刻才知道。
// 所以本测试不只验"函数有没有返回东西"，而是**按 ZIP 规范把结果解回来**，逐项核对：
//   ① ZIP 签名（PK\x03\x04 / EOCD）
//   ② central directory 里的条目名（结构文件一个都不能少）
//   ③ 每条数据的 CRC32 与 header 里写的一致（这是"文件损坏"最常见的根因）
//   ④ sheet 数量与名字真的写进了 workbook.xml
//   ⑤ 单元格内容能原样取回（含中文、逗号、引号 —— 这些正是 CSV 里要转义的坑）
//
// ⚠️ 实现用的是 ZIP 的 **store（不压缩）** 模式 —— 数据在包里是原样的，
//    所以这里可以直接切片取数据，不需要实现 inflate。

const { test, group, ok, equal } = require('./harness.js');
const xlsx = require('../utils/xlsx.js');

/* ===================== 最小 ZIP 读取器（只支持 store） ===================== */

function u16(d, i) { return d[i] | (d[i + 1] << 8); }
function u32(d, i) { return (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24)) >>> 0; }

function utf8Decode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    if (b < 0x80) { out += String.fromCharCode(b); i += 1; }
    else if (b < 0xe0) { out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)); i += 2; }
    else if (b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else {
      const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      out += String.fromCodePoint(cp); i += 4;
    }
  }
  return out;
}

// 独立实现的 CRC32（与待测实现各算各的，避免"自己验自己"）
function crc32Ref(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? ((c >>> 1) ^ 0xedb88320) : (c >>> 1);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// 解析 ZIP：返回 [{ name, crc, size, data }]
function readZip(buf) {
  const d = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  // EOCD 在文件末尾（本实现不写注释，固定最后 22 字节）
  const eocd = d.length - 22;
  equal(u32(d, eocd), 0x06054b50, 'EOCD 签名应为 0x06054b50');
  const count = u16(d, eocd + 10);
  let p = u32(d, eocd + 16);      // central directory 起始偏移
  const out = [];
  for (let i = 0; i < count; i++) {
    equal(u32(d, p), 0x02014b50, 'central directory 条目签名应为 0x02014b50');
    const crc = u32(d, p + 16);
    const size = u32(d, p + 24);
    const nameLen = u16(d, p + 28);
    const extraLen = u16(d, p + 30);
    const cmtLen = u16(d, p + 32);
    const localOff = u32(d, p + 42);
    const name = utf8Decode(d.subarray(p + 46, p + 46 + nameLen));
    // local header：跳过文件名/扩展区，取数据段
    const lNameLen = u16(d, localOff + 26);
    const lExtraLen = u16(d, localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    out.push({ name: name, crc: crc, size: size, data: d.subarray(dataStart, dataStart + size) });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

const SHEETS = [
  { name: '物料表', headers: ['名称', '数量'], rows: [['棉布, 白色', 3], ['"引号"料', 1]] },
  { name: '成品出入库', headers: ['日期', '成品', '类型', '买家'], rows: [['2026-09-26', '猫窝', '销售', '阿强']] }
];

group('xlsx · 生成器（零第三方，能被 Excel/WPS 打开的结构）');

test('① 产出是合法的 ZIP：local header 签名 + EOCD 都在', () => {
  const buf = xlsx.buildXlsx(SHEETS);
  ok(buf.length > 0, '应有内容');
  const d = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  equal(u32(d, 0) >>> 0, 0x04034b50 >>> 0, '应以 local file header 签名 PK\\x03\\x04 开头');
  const eocd = d.length - 22;
  equal(u32(d, eocd) >>> 0, 0x06054b50 >>> 0, '应以 EOCD 结束');
});

test('② 结构文件一个都不能少（少一个 Excel 就报"文件已损坏"）', () => {
  const files = readZip(xlsx.buildXlsx(SHEETS));
  const names = files.map(f => f.name);
  const must = [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/worksheets/sheet1.xml',
    'xl/worksheets/sheet2.xml'
  ];
  const missing = must.filter(m => names.indexOf(m) < 0);
  equal(missing.length, 0, '缺少结构文件：' + missing.join('、'));
  equal(files.length, must.length, '不应有多余条目');
});

test('③ 每条数据的 CRC32 与 header 里写的一致（文件损坏最常见的根因）', () => {
  const files = readZip(xlsx.buildXlsx(SHEETS));
  const bad = files.filter(f => crc32Ref(f.data) !== f.crc);
  equal(bad.length, 0, 'CRC32 不匹配的条目：' + bad.map(f => f.name).join('、'));
});

test('④ sheet 名与顺序真的写进了 workbook.xml', () => {
  const files = readZip(xlsx.buildXlsx(SHEETS));
  const wb = utf8Decode(files.find(f => f.name === 'xl/workbook.xml').data);
  ok(wb.indexOf('name="物料表"') >= 0, '第 1 个 sheet 名应为「物料表」');
  ok(wb.indexOf('name="成品出入库"') >= 0, '第 2 个 sheet 名应为「成品出入库」');
  ok(wb.indexOf('name="物料表"') < wb.indexOf('name="成品出入库"'), 'sheet 顺序应与传入一致');
  // 每个 sheet 都要在 rels 里有对应关系，否则 Excel 打不开
  const rels = utf8Decode(files.find(f => f.name === 'xl/_rels/workbook.xml.rels').data);
  ok(rels.indexOf('worksheets/sheet2.xml') >= 0, 'rels 里必须有 sheet2 的指向');
});

test('⑤ 单元格内容能原样取回（中文 / 逗号 / 引号 —— CSV 里要转义的那些坑）', () => {
  const files = readZip(xlsx.buildXlsx(SHEETS));
  const s1 = utf8Decode(files.find(f => f.name === 'xl/worksheets/sheet1.xml').data);
  ok(s1.indexOf('<t>名称</t>') >= 0, '表头应写进 sheet1');
  ok(s1.indexOf('棉布, 白色') >= 0, '含逗号的文本应原样保留（xlsx 不需要转义逗号）');
  ok(s1.indexOf('&quot;引号&quot;料') >= 0, 'XML 特殊字符必须转义 —— 否则文件直接损坏');
  const s2 = utf8Decode(files.find(f => f.name === 'xl/worksheets/sheet2.xml').data);
  ok(s2.indexOf('阿强') >= 0, '第 2 个 sheet 应装它自己的数据');
  ok(s2.indexOf('棉布, 白色') < 0, '数据不能串到别的 sheet 里');
});

test('⑥ 空 sheet 与空表格也不能生成坏文件', () => {
  const files = readZip(xlsx.buildXlsx([{ name: '空表', headers: [], rows: [] }]));
  equal(files.length, 5, '1 个 sheet 时应是 4 个结构文件 + 1 个 sheet');
  const s = utf8Decode(files.find(f => f.name === 'xl/worksheets/sheet1.xml').data);
  ok(s.indexOf('</sheetData>') >= 0, '空表也必须有完整的 sheetData 闭合');
});

test('⑦ 数字必须是「数值单元格」（否则 Excel 里是文本，求和/排序全废）', () => {
  // ⭐ 这条是拿 openpyxl 交叉验证时发现的真问题：把数字也写成 inlineStr 的话，
  //    Excel 里读出来是 '3'（文本），一列数字没法求和 —— 而"导出拿去算账"正是本功能的意义。
  const files = readZip(xlsx.buildXlsx([
    { name: 'S', headers: ['数量'], rows: [[3], ['文本3'], [12.5]] }
  ]));
  const s = utf8Decode(files.find(f => f.name === 'xl/worksheets/sheet1.xml').data);
  ok(s.indexOf('<c r="A2"><v>3</v></c>') >= 0, 'number 应写成数值单元格（无 t 属性 + <v>）');
  ok(s.indexOf('<c r="A4"><v>12.5</v></c>') >= 0, '小数同样走数值');
  ok(s.indexOf('<c r="A3" t="inlineStr">') >= 0, '字符串仍走 inlineStr');
});

group('xlsx · 接入导出页');

test('⑧ 「一键导出全部」必须走 xlsx，不能退回「把 4 张表拼进一个 CSV」', () => {
  // 这条守的是**用户明确提过的问题**：早先 4 张表首尾拼在一个 CSV 里，
  // 4 个表头混在数据中间，在 Excel 里没法分别筛选/求和（2026-09-27 D78）。
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'pages/settings/export.js'), 'utf8');

  // 注入法自检：拼接写法必须被判为"没走 xlsx"
  const oldImpl = "content = '【物料表】\\n' + csv.exportMaterials(); filename = '全量数据.csv';";
  ok(oldImpl.indexOf('xlsx.buildXlsx') < 0, '自检失败：拼接写法应判为未走 xlsx');

  ok(src.indexOf('xlsx.buildXlsx') >= 0, '导出页应调用 xlsx.buildXlsx 生成多工作表');
  ok(src.indexOf('csv.allSheets') >= 0, '应使用 csv.allSheets() 作为四个工作表的数据源');
  ok(src.indexOf('全量数据.xlsx') >= 0, '文件名应带 .xlsx 后缀（否则系统不认）');
  ok(src.indexOf('【物料表】') < 0, '不得再把多张表拼进同一个文件');
});
