// utils/image.js —— 图片压缩与 USER_DATA_PATH 容量（Day 4 任务 4.1 / 4.5）
//
// 背景（兜底审计 P2-2）：savePhoto 原本直接 fs.saveFile，不检查空间。
// 当时误以为 USER_DATA_PATH 上限 10MB（实际 200MB，见下方真机教训）—— 于是"图片约只装 50 张"，满了每张都失败且只提示「保存失败」。
// 现在两层防护：
//   1. compressPhoto：保存前压缩（quality 70 + 长边限 1280），单张控制在 ~100KB 量级
//   2. savePhoto 前容量预检：剩余空间放不下一张典型照片时，直接给出可读原因
//
// 注意：这里的容量是 USER_DATA_PATH（本地**文件**池，200MB），
// 不是 wx.storage（结构化数据池，10MB，由 services/storage.js 管）——两个池互不相通。

const QUALITY = 70;
const MAX_EDGE = 1280;
// 「一张典型照片」的预留量：savePhoto 用它判断还装不装得下
const RESERVED_BYTES = 500 * 1024;
// USER_DATA_PATH 总上限。
// 真机教训（2026-09-12）：勘查报告的「本地文件 10MB」是过时认知——用户真机上
// 实存 69MB 文件仍正常读写，实际配额远大于 10MB（现行微信文档：本地用户文件 200MB）。
// 旧值曾导致：剩余空间算成 0 → 传图全被拒 / 备份全被拒 / 首页横幅显示 694%。
const USER_FILE_LIMIT = 200 * 1024 * 1024;

// 回调式 API → Promise（fail 时 resolve(null)，由调用方决定兜底）
function call(method, opts) {
  return new Promise((resolve) => {
    wx[method](Object.assign({}, opts, {
      success: (r) => resolve(r || {}),
      fail: () => resolve(null)
    }));
  });
}

// 压缩一张临时图片，返回可用的临时路径（失败一律回退原图，绝不阻断选图）
function compressPhoto(src) {
  return call('getImageInfo', { src: src }).then((info) => {
    if (!info || !info.width || !info.height) return src; // 尺寸拿不到：不盲压
    const opts = { src: src, quality: QUALITY };
    const edge = Math.max(info.width, info.height);
    if (edge > MAX_EDGE) {
      const ratio = MAX_EDGE / edge;
      opts.compressedWidth = Math.round(info.width * ratio);
      opts.compressedHeight = Math.round(info.height * ratio);
    }
    return call('compressImage', opts).then((r) => (r && r.tempFilePath) ? r.tempFilePath : src);
  });
}

// USER_DATA_PATH 用量：{ used, limit, free, ratio, count, photoCount }
// count = 全部文件数；photoCount = 图片数（photo_ 前缀）。
// 修复「46 张图片」口径：备份 json / CSV / PDF 不是图片，不该算进图片数。
// readdir + 逐文件 stat 求和（平台没有直接的配额 API）
function userDataUsage() {
  return new Promise((resolve) => {
    wx.getFileSystemManager().readdir({
      dirPath: wx.env.USER_DATA_PATH,
      success: (r) => {
        const files = r && r.files ? r.files : [];
        let pending = files.length;
        let used = 0;
        const photoCount = files.filter((n) => n.indexOf('photo_') === 0).length;
        if (!pending) return resolve({ used: 0, limit: USER_FILE_LIMIT, free: USER_FILE_LIMIT, ratio: 0, count: 0, photoCount: 0 });
        files.forEach((name) => {
          wx.getFileSystemManager().stat({
            path: wx.env.USER_DATA_PATH + '/' + name,
            success: (s) => { used += (s.stats && s.stats.size) || 0; },
            complete: () => {
              if (--pending === 0) {
                resolve({
                  used: used,
                  limit: USER_FILE_LIMIT,
                  free: Math.max(0, USER_FILE_LIMIT - used),
                  ratio: used / USER_FILE_LIMIT,
                  count: files.length,
                  photoCount: photoCount
                });
              }
            }
          });
        });
      },
      fail: () => resolve({ used: 0, limit: USER_FILE_LIMIT, free: USER_FILE_LIMIT, ratio: 0, count: 0, photoCount: 0 })
    });
  });
}

// 再放 extra 字节是否装得下
function hasRoomFor(extra) {
  return userDataUsage().then((u) => u.free >= (Number(extra) || 0));
}

module.exports = {
  QUALITY: QUALITY,
  MAX_EDGE: MAX_EDGE,
  RESERVED_BYTES: RESERVED_BYTES,
  USER_FILE_LIMIT: USER_FILE_LIMIT,
  compressPhoto: compressPhoto,
  userDataUsage: userDataUsage,
  hasRoomFor: hasRoomFor
};
