// cloudfunctions/backupIndex/index.js
// ── 本云函数的唯一职责：回答"这个人的云端备份有哪些、fileID 是什么" ──
//
// 为什么必须有它（而不是让客户端自己列目录）：
//   平台**没有**给小程序端「列云存储目录」的能力（wx.cloud 里就没有这个 API）。
//   而云存储的 fileID 又无法自己拼（中间那段是腾讯云分配的，含随机后缀 + APPID）。
//   结论：客户端上传完，必须由服务端**记一笔**（fileID / 时间 / 大小），
//   否则换台手机就完全找不到自己的备份文件 —— 备份等于白存。
//
// 安全：身份一律取 `cloud.getWXContext().OPENID`（平台注入、**无法伪造**），
//       绝不接受客户端传进来的 openid —— 否则任何人都能读写别人的备份索引。
//
// 集合：`backup_index`，一人最多两条（对应 a / b 两个槽）。
//       只存元数据，**业务数据始终在云存储的文件里**。

const cloud = require('wx-server-sdk');

// DYNAMIC_CURRENT_ENV = 用云函数当前所在环境，免去硬编码环境 ID
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLL = 'backup_index';
// 云端保留的备份份数。2 = 最新 + 上一版：
// 万一下次上传把最新那份传坏了，还回得去。
const MAX_KEEP = 2;

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
    slot: d.slot,
    fileID: d.fileID,
    updatedAt: d.updatedAt,
    sizeBytes: d.sizeBytes,
    mode: d.mode
  };
}

async function getIndex(openid) {
  const res = await withCollection(() => db.collection(COLL)
    .where({ _openid: openid })
    .orderBy('updatedAt', 'desc')
    .limit(MAX_KEEP)
    .get());
  const list = (res && res.data) || [];
  return { ok: true, records: list.map(toRecord) };
}

async function putIndex(openid, ev) {
  const slot = (ev && ev.slot) === 'a' ? 'a' : ((ev && ev.slot) === 'b' ? 'b' : null);
  if (!slot) return { ok: false, msg: 'slot 非法（只允许 a / b）' };
  if (!ev || !ev.fileID) return { ok: false, msg: '缺少 fileID' };

  const doc = {
    // ⚠️ 云函数以管理员身份写库，**不会**自动注入 _openid，必须自己带上
    _openid: openid,
    slot: slot,
    fileID: ev.fileID,
    updatedAt: Number(ev.updatedAt) || Date.now(),
    sizeBytes: Number(ev.sizeBytes) || 0,
    mode: ev.mode || ''
  };

  // 同一人同一槽只保留一条：先清旧的再写新的（避免索引里堆一堆历史）
  await withCollection(() => db.collection(COLL).where({ _openid: openid, slot: slot }).remove());
  await withCollection(() => db.collection(COLL).add({ data: doc }));

  // 只留最近 MAX_KEEP 条；超出的连同云文件一起删掉 ——
  // 否则云端文件只涨不降，用户既看不见也删不掉（客户端没有列目录/批量删的能力）
  const res = await withCollection(() => db.collection(COLL)
    .where({ _openid: openid })
    .orderBy('updatedAt', 'desc')
    .limit(50)
    .get());
  const all = (res && res.data) || [];
  const stale = all.slice(MAX_KEEP);

  if (stale.length) {
    try {
      await db.collection(COLL).where({ _id: db.command.in(stale.map((d) => d._id)) }).remove();
    } catch (e) {
      console.error('[backupIndex] 清理多余索引记录失败：', e);
    }
    const files = stale.map((d) => d.fileID).filter(Boolean);
    if (files.length) {
      try {
        await cloud.deleteFile({ fileList: files });
      } catch (e) {
        // 文件删不掉不该让"备份成功"变成失败 —— 索引已指向新文件，功能不受影响
        console.error('[backupIndex] 清理多余备份文件失败：', e);
      }
    }
  }

  return { ok: true, kept: all.slice(0, MAX_KEEP).map(toRecord) };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext && wxContext.OPENID;
  if (!openid) return { ok: false, msg: '拿不到调用者身份' };

  const action = (event && event.action) || 'get';
  try {
    if (action === 'get') return await getIndex(openid);
    if (action === 'put') return await putIndex(openid, event);
    return { ok: false, msg: '未知操作：' + action };
  } catch (e) {
    console.error('[backupIndex] 执行失败：', e);
    return { ok: false, msg: errText(e) || '执行失败' };
  }
};
