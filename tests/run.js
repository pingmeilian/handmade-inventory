// tests/run.js —— 测试入口
// 用法：node tests/run.js          跑全部
//       node tests/run.js calc     只跑文件名含 calc 的测试

const fs = require('fs');
const path = require('path');

// 关键顺序：必须先装好 wx 打桩，再加载任何业务模块
require('./wx-stub.js');

const harness = require('./harness.js');

const filter = process.argv[2];
const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .filter((f) => !filter || f.indexOf(filter) >= 0)
  .sort();

if (!files.length) {
  console.log('未找到测试文件' + (filter ? '（筛选：' + filter + '）' : ''));
}

files.forEach((f) => require(path.join(__dirname, f)));

harness.run().then((okAll) => process.exit(okAll ? 0 : 1));
