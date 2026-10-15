// tests/guard-storage-copy.test.js —— V148：两个「存储池」的口径不许再混
//
// 起因：用户问「40 张，已用 26.1 MB（13%）是什么意思？现在还有限制吗」。
// 查实 13% = 26.1MB ÷ 200MB（utils/image.js 的 USER_FILE_LIMIT），**是对的**。
// 但同一批文案里散着 8 处没跟着改的数字/指引 —— 源于 2026-09-12 那次修正：
//   把 USER_DATA_PATH 配额从「误认的 10MB」改为 200MB 时，只动了 image.js 的常量与注释，
//   **别处的文案全漏了** —— 于是同一个工程里同时存在两个数字，读者只能靠猜。
//
// 两个池（互不相通，必须分清楚）：
//   · USER_DATA_PATH（本地**文件**池）—— 图片 / 备份 json / CSV / PDF   上限 200MB  ← image.js
//   · wx.storage（**键值**池）      —— 账本数据（物料/成品/流水…）        上限  10MB  ← storage.js
//
// 本文件钉住三件事：
//   ① 数字**从唯一源派生**，不许在别处再抄一遍（抄一遍就会再飘一次）；
//   ② 描述「图片/文件空间」的文案里，不许出现键值池的数字（10MB）；
//   ③ **该留的必须留** —— 键值池的 10MB 是真的，别被"统一口径"误删；清理入口也别删。
const fs = require('fs');
const path = require('path');
const { test, group, ok, equal } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// 剥块注释 / wxml 注释 / 整行注释 —— 否则会被"注释里提到了这件事"骗到
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

function walk(dir, out) {
  out = out || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else if (/\.(js|wxml)$/.test(d.name)) out.push(p);
  });
  return out;
}

// DISK_FULL 那段（提示文案 + 它的判据）
function diskFullBlock() {
  const src = strip(R('utils/store.js'));
  const m = /DISK_FULL[\s\S]{0,600}?\n\s*\}/.exec(src);
  ok(!!m, '找不到 DISK_FULL 的提示块 —— 锚点漂了就更新这条');
  return m[0];
}

group('V148 · 存储口径：两个池不许混');

test('① ★ 存图失败提示：上限数字必须从 USER_FILE_LIMIT 派生', () => {
  const block = diskFullBlock();
  ok(/USER_FILE_LIMIT/.test(block),
    '★ 上限必须从 image.USER_FILE_LIMIT 派生（唯一源）—— 在别处再抄一遍数字，下次改配额就又会飘：' +
    block.replace(/\s+/g, ' ').slice(0, 160));
  ok(!/10\s*MB/.test(block),
    '★ 提示里不许再出现「10MB」—— 那是 wx.storage 键值池的值，图片走的是 200MB 文件池');
});

test('② ★ 文件池上限 = 200MB（真机实证，别退回 10MB）', () => {
  const img = strip(R('utils/image.js'));
  const m = /const USER_FILE_LIMIT\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(img);
  ok(!!m, '找不到 USER_FILE_LIMIT 的定义 —— 锚点漂了就更新这条');
  equal(Number(m[1]), 200,
    '★ 文件池上限 200MB。旧值 10MB 是过时认知 —— 用户真机上实存 69MB 文件仍正常，' +
    '按 10MB 算曾导致：剩余空间算成 0 → 传图全被拒 / 备份全被拒 / 首页横幅显示 694%');
});

test('③ ★ 提示要指向「备份与恢复」，不许再指「数据体检」', () => {
  const block = diskFullBlock();
  ok(/备份与恢复/.test(block),
    '★ 图片/文件用量在「我的 → 备份与恢复 → 图片空间」那一页');
  ok(!/数据体检/.test(block),
    '★ 不许让人去「数据体检」查图片用量 —— 那页统计的是键值池（账本数据），去了看不到文件用量');
});

test('④ ★★ 全仓扫描：写「图片/文件空间」的地方不许出现 10MB', () => {
  const bad = [];
  ['pages', 'utils', 'services', 'components'].forEach((dir) => {
    walk(path.join(ROOT, dir)).forEach((p) => {
      strip(fs.readFileSync(p, 'utf8')).split('\n').forEach((line, i) => {
        if (/图片空间|文件空间|文件池/.test(line) && /10\s*MB/.test(line)) {
          bad.push('  ' + path.relative(ROOT, p).replace(/\\/g, '/') + ':' + (i + 1) +
            ' → ' + line.trim().slice(0, 90));
        }
      });
    });
  });
  equal(bad.length, 0,
    '★ 这些行把键值池的数字（10MB）安到了文件池上（下次改配额还会漏同一处）：\n' + bad.join('\n'));
});

test('⑤ ★ 体检页：要标明是「账本数据」，且快满时别建议清图片', () => {
  const wxml = R('pages/settings/checkup.wxml');
  ok(/账本数据/.test(wxml),
    '★ 要写明这行统计的是「账本数据」（键值池）—— 否则和备份页的「26.1 MB（13%）」打架，用户只能猜');
  // ⚠️ 必须定位到 `wx:if="{{nearFull}}"` 那一行 —— 上面进度条还有一处
  //    `{{nearFull ? 'ck-bar-warn' : ''}}`，用 indexOf('nearFull') 会先命中它，
  //    于是下面两条断言全落空（写这条守卫时第一次就踩了，被自己抓出来）。
  const line = wxml.split('\n').filter((l) => /wx:if="\{\{nearFull\}\}"/.test(l))[0] || '';
  ok(!!line, '找不到 nearFull 那条提示 —— 锚点漂了就更新这条');
  ok(!/清理图片/.test(line),
    '★ 键值池满了清图片没用（图片根本不在这个池）—— 建议必须是能救这个池的动作：' + line.trim().slice(0, 90));
  ok(/导出备份/.test(line), '★ 快满时应建议「先导出备份」');
  ok(/\{\{fileLimitMB\}\}/.test(wxml),
    '★ 要顺带说明图片走的是另一个池（上限由 js 派生传入，见下一条）');
});

test('⑥ ★ 体检页的「另一个池上限」不许在 wxml 里写死', () => {
  const js = strip(R('pages/settings/checkup.js'));
  ok(/USER_FILE_LIMIT/.test(js), '★ fileLimitMB 必须从 image.USER_FILE_LIMIT 派生');
  ok(!/200\s*MB/.test(R('pages/settings/checkup.wxml')),
    '★ wxml 里不许写死「200 MB」—— 写死就会再飘一次（本轮的教训就是这个）');
});

test('⑦ ★ 备份页两处都要说清是「整个文件空间」的用量', () => {
  const wxml = R('pages/settings/backup.wxml');
  const hits = wxml.split('\n').filter((l) => /imgUsage\.usedText/.test(l));
  ok(hits.length >= 2,
    '备份页应有两处显示用量（「完整」模式下方 + 「图片空间」段），实际 ' + hits.length + ' 处');
  hits.forEach((l) => {
    ok(/整个[a-z\u4e00-\u9fa5]*文件空间/.test(l),
      '★ 每处都要说明这是"整个文件空间"的用量 —— 否则会被读成「这 40 张图占了 26.1MB」：' +
      l.trim().slice(0, 90));
  });
});

test('⑧ ★ 该留的必须留（删过头也是错）', () => {
  ok(/DEFAULT_LIMIT_KB\s*=\s*10240/.test(strip(R('services/storage.js'))),
    '★ 键值池的 10MB 上限要留 —— 那是 wx.storage 的真实配额，别被"统一口径"顺手删了');
  ok(/\{\{usagePercent\}\}/.test(R('pages/settings/checkup.wxml')),
    '★ 体检页的用量百分比要留（别为了改文案把整行删掉 —— 那用户就看不到用量了）');
  ok(/清理无主图片/.test(R('pages/settings/backup.wxml')),
    '★ 「清理无主图片」入口要留 —— 那是文件池**唯一**能回收空间的工具');
});
