// tools/pkg-size.js —— 进包体积实测（口径固化，便于随时复核）
//
// 用法：node tools/pkg-size.js
//
// 为什么要有这个脚本：上架清单里的「214 文件 / 1414.0 KB」是手算的、口径没记在案，
// 换个时间再算就对不上（V148 复核时发现的）。数字要能自证，就得**口径可复跑**，
// 而不是"某次某个人算过一遍"。
//
// 口径（三条，都可核对）：
//   ① 排除 project.config.json 的 packOptions.ignore（本项目：tests/ tools/ docs/ *.md）；
//   ② 排除 cloudfunctionRoot（云函数单独部署到云端，不进代码包）；
//   ③ 排除 project.private.config.json 与点文件（微信不打包），以及 node_modules / miniprogram_npm。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'));

const skipDirs = new Set(['node_modules', 'miniprogram_npm']);
const skipSuffix = new Set();
const skipFiles = new Set(['project.private.config.json']);

((cfg.packOptions && cfg.packOptions.ignore) || []).forEach((it) => {
  if (it.type === 'folder') skipDirs.add(it.value);
  else if (it.type === 'suffix') skipSuffix.add(String(it.value).toLowerCase());
  else if (it.type === 'file') skipFiles.add(it.value);
});
if (cfg.cloudfunctionRoot) skipDirs.add(String(cfg.cloudfunctionRoot).replace(/\/+$/, ''));

let count = 0;
let bytes = 0;
const byTop = {};

(function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    if (d.name.startsWith('.') || skipDirs.has(d.name)) return;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return walk(p);
    if (skipFiles.has(d.name)) return;
    if (skipSuffix.has(path.extname(d.name).toLowerCase())) return;
    const size = fs.statSync(p).size;
    count += 1;
    bytes += size;
    const top = path.relative(ROOT, dir).split(path.sep)[0] || '.';
    byTop[top] = (byTop[top] || 0) + size;
  });
})(ROOT);

Object.keys(byTop).sort((a, b) => byTop[b] - byTop[a]).forEach((k) => {
  console.log('  ' + k.padEnd(18) + (byTop[k] / 1024).toFixed(1).padStart(9) + ' KB');
});
console.log('-'.repeat(40));
console.log('进包：' + count + ' 文件 / ' + (bytes / 1024).toFixed(1) + ' KB = ' +
  (bytes / 1024 / 1024).toFixed(2) + ' MB');
console.log('（排除：' + Array.from(skipDirs).join(' / ') + '，后缀 ' +
  Array.from(skipSuffix).join(' ') + '，文件 ' + Array.from(skipFiles).join(' ') + '）');
