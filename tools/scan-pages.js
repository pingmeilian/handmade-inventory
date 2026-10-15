// .scratch/extract-pages.js —— 扫描页面行为骨架（v2）
// v1 的两个盲区已修：① 漏掉 async 方法 ② 漏掉 wxml 里 data-url 形式的跳转
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pagesDir = path.join(ROOT, 'pages');

function walk(dir, out = []) {
  fs.readdirSync(dir).forEach((f) => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.js')) out.push(p);
  });
  return out;
}

// 方法名：普通 fn() 与 async fn()
function extractMethods(src) {
  const out = [];
  const re = /^ {2}(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

// 跳转目标：js 里的 url: '...' / url: `...`，以及 wxml 里的 data-url="/pages/..." / url="/pages/..."
function extractNavs(jsFile) {
  const navs = new Set();
  const src = fs.readFileSync(jsFile, 'utf8');
  let m;
  const reJs = /url:\s*['"`]([^'"`]+)['"`]/g;
  while ((m = reJs.exec(src))) navs.add(m[1].replace(/\$\{[^}]+\}/g, ':id'));

  const wxml = jsFile.replace(/\.js$/, '.wxml');
  if (fs.existsSync(wxml)) {
    const w = fs.readFileSync(wxml, 'utf8');
    const reW = /(?:data-url|url)="(\/pages\/[^"]+)"/g;
    while ((m = reW.exec(w))) navs.add(m[1]);
  }
  return [...navs];
}

function analyze(file) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  const lifecycle = ['onLoad', 'onShow', 'onReady', 'onHide', 'onUnload', 'onPullDownRefresh']
    .filter((k) => new RegExp('\\b' + k + '\\s*[\\(:]').test(src));

  const storeCalls = new Set();
  let m;
  const reS = /store\.([a-zA-Z_$][\w$]*)\s*\(/g;
  while ((m = reS.exec(src))) storeCalls.add(m[1]);

  // wxml 里绑定的交互事件（bindtap / catchtap / bindinput / bindchange / bindlongpress …）
  const handlers = new Set();
  const wxml = file.replace(/\.js$/, '.wxml');
  if (fs.existsSync(wxml)) {
    const w = fs.readFileSync(wxml, 'utf8');
    const reH = /(?:bind|catch)(?::)?([a-z]+)\s*=\s*"([a-zA-Z_$][\w$]*)"/g;
    while ((m = reH.exec(w))) handlers.add(m[2]);
  }

  return {
    rel,
    lifecycle,
    methods: extractMethods(src),
    navs: extractNavs(file),
    storeCalls: [...storeCalls],
    globalDataHits: (src.match(/app\.globalData/g) || []).length,
    wxmlHandlers: [...handlers]
  };
}

const files = walk(pagesDir).sort();
const results = files.map(analyze);

// 入口可达性：谁被别处指向
const inbound = {};
results.forEach((r) => {
  r.navs.forEach((n) => {
    const key = n.split('?')[0];
    (inbound[key] = inbound[key] || []).push(r.rel);
  });
});

const allStore = new Set();
results.forEach((r) => r.storeCalls.forEach((s) => allStore.add(s)));

console.log('页面总数: ' + results.length);
console.log('');
results.forEach((r) => {
  const pageKey = '/' + r.rel.replace(/\.js$/, '');
  const inFrom = inbound[pageKey] || [];
  console.log('── ' + r.rel + (inFrom.length ? '' : '   ⚠️ 无页面指向（可能仅靠 tabBar / 或不可达）'));
  console.log('   生命周期: ' + (r.lifecycle.join(', ') || '—'));
  console.log('   方法: ' + (r.methods.join(', ') || '—'));
  console.log('   wxml绑定: ' + (r.wxmlHandlers.join(', ') || '—'));
  console.log('   跳转: ' + (r.navs.join(', ') || '—'));
  console.log('   来自: ' + (inFrom.join(', ') || '—'));
  console.log('   store: ' + (r.storeCalls.join(', ') || '—'));
  if (r.globalDataHits) console.log('   ⚠️ globalData 命中: ' + r.globalDataHits);
  console.log('');
});

// 未被 wxml 绑定、也不在生命周期里的方法（疑似死方法）
console.log('=== 疑似死方法（未被 wxml 绑定，也非生命周期）===');
const LIFECYCLE = new Set(['onLoad', 'onShow', 'onReady', 'onHide', 'onUnload', 'onPullDownRefresh', 'onShareAppMessage', 'onShareTimeline', 'onPageScroll', 'onReachBottom']);
results.forEach((r) => {
  const dead = r.methods.filter((x) => !LIFECYCLE.has(x) && r.wxmlHandlers.indexOf(x) < 0 && x !== 'if' && x !== 'return');
  if (dead.length) console.log('  ' + r.rel + ' → ' + dead.join(', '));
});

console.log('');
console.log('=== 全项目 store 能力覆盖数: ' + allStore.size + ' ===');
console.log([...allStore].sort().join(', '));
