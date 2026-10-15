// cloudfunctions/photoIndex/index.js
// ── 本云函数的唯一职责：回答"这个人的云端图片有哪些、fileID 是什么" ──
//
// 为什么必须有它（而不是让客户端自己列目录）：
//   平台**没有**给小程序端「列云存储目录」的能力，云存储 fileID 也无法自拼。
//   图片走的又是"保持原文件名"策略（photos/{openid}/photo_xxx.jpg）——
//   名字看似可推，但**本地有哪些图**这件事，换机之后就无从得知了：
//   新手机本地一张图都没有，自然推不出该下载哪些名字。
//   → 所以必须由服务端记一份清单，否则"换机找回图片"只能找回零张。
//
// 安全：身份一律取 `cloud.getWXContext().OPENID`（平台注入、**无法伪造**），
//       绝不接受客户端传进来的 openid —— 否则任何人都能读写别人的图片清单。
//
// 集合：`photo_index`，一条 = 一张图（按 name 唯一）。
//       只存元数据（name / fileID / 大小 / 时间）；**图片本体始终在云存储里**。
//
// ⚠️ 本清单**只增不删**：本地删图不同步删云端（万一误删还能找回）。
//    清理策略留待后续版本专门做 —— 顺手删错就没救了。

const cloud = require('wx-server-sdk');

// DYNAMIC_CURRENT_ENV = 用云函数当前所在环境，免去硬编码环境 ID
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLL = 'photo_index';
// 单人清单上限：本地图片池只有 10MB（约百来张），1000 条足够；
// 设上限是为了防止异常情况下单次返回把云函数内存打爆
const MAX_LIST = 1000;
// 单次最多接受多少条登记 —— 客户端的单批上限是 20，留点余量
const MAX_ITEMS = 100;

function errText(e) {
  return String((e && (e.errMsg || e.message)) || '') + ' ' + String((e && e.errCode) || '');
}

function isNoCollection(e) {
  return /not exist|not found|-502005|-501001|collection/i.test(errText(e));
}

// 集合可能还没建过（首次使用）。跑一遍操作，报"集合不存在"就建一次再重试。
async function withCollection(fn) {
  try {
    return await fn();
  } catch (e) {
    if (!isNoCollection(e)) throw e;
    try { await db.createCollection(COLL); } catch (_) { /* 已存在等情况，忽略 */ }
    return await fn();
  }
}

function toRecord(d) {
  return {
    name: d.name,
    fileID: d.fileID,
    sizeBytes: d.sizeBytes,
    updatedAt: d.updatedAt
  };
}

// ---------- 读：云端有哪些图 ----------

async function getPhotos(openid) {
  const res = await withCollection(() => db.collection(COLL)
    .where({ _openid: openid })
    .orderBy('updatedAt', 'desc')
    .limit(MAX_LIST)
    .get());
  const list = (res && res.data) || [];
  return { ok: true, records: list.map(toRecord) };
}

// ---------- 写：登记一批已上传的图 ----------

async function putPhotos(openid, ev) {
  const raw = (ev && ev.items) || [];
  if (!Array.isArray(raw) || !raw.length) return { ok: false, msg: '缺少 items' };
  if (raw.length > MAX_ITEMS) return { ok: false, msg: '单批最多 ' + MAX_ITEMS + ' 条' };

  const items = [];
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i] || {};
    const name = String(it.name || '');
    if (!name || !it.fileID) return { ok: false, msg: '第 ' + (i + 1) + ' 条缺少 name 或 fileID' };
    items.push({
      name: name,
      fileID: String(it.fileID),
      sizeBytes: Number(it.sizeBytes) || 0,
      updatedAt: Number(it.updatedAt) || Date.now()
    });
  }

  const names = items.map((x) => x.name);

  // 同名先清后写：重传（失败重试 / 换机补传）时不会在清单里堆出重复条目
  await withCollection(() => db.collection(COLL)
    .where({ _openid: openid, name: db.command.in(names) })
    .remove());

  // 云数据库没有批量 add，只能逐条。（一批最多 20 条，开销可接受）
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await withCollection(() => db.collection(COLL).add({
      data: {
        // ⚠️ 云函数以管理员身份写库，**不会**自动注入 _openid，必须自己带上
        _openid: openid,
        name: it.name,
        fileID: it.fileID,
        sizeBytes: it.sizeBytes,
        updatedAt: it.updatedAt
      }
    }));
  }

  return { ok: true, saved: items.length };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext && wxContext.OPENID;
  if (!openid) return { ok: false, msg: '拿不到调用者身份' };

  const action = (event && event.action) || 'get';
  try {
    if (action === 'get') return await getPhotos(openid);
    if (action === 'put') return await putPhotos(openid, event);
    return { ok: false, msg: '未知操作：' + action };
  } catch (e) {
    console.error('[photoIndex] 执行失败：', e);
    return { ok: false, msg: errText(e) || '执行失败' };
  }
};
