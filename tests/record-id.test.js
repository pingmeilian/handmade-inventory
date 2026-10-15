// 记录定位测试：deleteSale / undoProduce 按 id 定位（Day 3 任务 3.5）
const store = require('../utils/store.js');
const F = require('./fixtures.js');
const { group, test, ok, equal, near, throws } = require('./harness.js');

group('记录定位 · 按 id（消除下标脆弱性）');

test('销售记录创建即带 id，按 id 删除成功', () => {
  F.reset();
  const p = F.product({});
  F.seedProducts([p]);
  p.sellableStock = 5;
  F.seedProducts([p]);
  store.sellProduct(p.id, 2, 50);
  store.sellProduct(p.id, 1, 60);

  const db = store.getProduct(p.id);
  ok(db.sales[0].id, '销售记录有 id');
  ok(db.sales[1].id, '第二条也有 id');
  ok(db.sales[0].id !== db.sales[1].id, 'id 不重复');

  store.deleteSale(p.id, db.sales[0].id);
  const after = store.getProduct(p.id);
  equal(after.sales.length, 1, '删掉了指定那条');
  near(after.sales[0].price, 60, 0.01, '留下的是另一条（价格 60 那笔）');
  near(after.sellableStock, 4, 0.01, '库存返还 2 → 5-3+2=4');
});

test('退产按 id 定位：多批生产中精确撤销指定批次', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 0, unitPrice: 0 });
  F.seedMaterials([m]);
  store.inbound(m.id, 20, 200);
  const p = F.product({ bom: [{ materialId: m.id, usage: 1 }] });
  F.seedProducts([p]);

  store.produceProduct(p.id, 2);   // 批次1
  store.produceProduct(p.id, 3);   // 批次2
  const db = store.getProduct(p.id);
  ok(db.productions[0].id, '生产记录有 id');
  const firstBatchId = db.productions[0].id;

  store.undoProduce(p.id, firstBatchId);
  const after = store.getProduct(p.id);
  equal(after.productions.length, 1, '只撤销了指定批次');
  near(after.productions[0].qty, 3, 0.01, '留下的是批次2');
  near(after.sellableStock, 3, 0.01, '库存 5-2=3');
});

test('删除后原 id 再删 → 报错（不会误删别的）', () => {
  F.reset();
  const p = F.product({});
  p.sellableStock = 3;
  F.seedProducts([p]);
  store.sellProduct(p.id, 1, 50);
  const sid = store.getProduct(p.id).sales[0].id;
  store.deleteSale(p.id, sid);
  throws(() => store.deleteSale(p.id, sid), '同 id 二次删除必须失败');
});

test('老数据无 id：传数字下标仍可用（兼容）', () => {
  F.reset();
  const p = F.product({});
  p.sellableStock = 5;
  p.sales = [   // 模拟老数据：无 id 字段
    { qty: 1, price: 10, date: '2026-01-01', costSnapshot: { totalCost: 5 } },
    { qty: 2, price: 20, date: '2026-01-02', costSnapshot: { totalCost: 5 } }
  ];
  F.seedProducts([p]);

  store.deleteSale(p.id, 0);   // 按下标删第一条
  const after = store.getProduct(p.id);
  equal(after.sales.length, 1);
  near(after.sales[0].price, 20, 0.01, '删的是下标 0 那条');
});

test('老数据退产同样支持下标回退', () => {
  F.reset();
  const m = F.simpleMaterial({ quantity: 20, unitPrice: 10 });
  F.seedMaterials([m]);
  const p = F.product({ bom: [{ materialId: m.id, usage: 1 }] });
  p.sellableStock = 3;
  p.productions = [{ date: '2026-01-01', qty: 3 }];   // 老数据：无 id
  F.seedProducts([p]);

  store.undoProduce(p.id, 0);
  const after = store.getProduct(p.id);
  equal(after.productions.length, 0);
  near(after.sellableStock, 0, 0.01);
});

test('不存在的 id / 下标 → 报错不误删', () => {
  F.reset();
  const p = F.product({});
  p.sellableStock = 3;
  F.seedProducts([p]);
  store.sellProduct(p.id, 1, 50);
  throws(() => store.deleteSale(p.id, 'ps_ghost'));
  throws(() => store.deleteSale(p.id, 99));
  equal(store.getProduct(p.id).sales.length, 1, '记录原样');
});
