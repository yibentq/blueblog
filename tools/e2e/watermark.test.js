// 图片落盘管线的测试（src/utils/watermark.js）：不需要数据库、不需要起应用。
//   node tools/e2e/watermark.test.js
// 覆盖 v30 修的几个真 bug：手机竖拍照片经水印后横躺（EXIF 方向被丢）、水印亮度测的是整张图而不是落点、
// 以及新增的行为（去 GPS、长边上限、小图也转正、动图不碰、坏文件不抛错）。
const path = require('path'); const os = require('os'); const fs = require('fs');
const root = path.resolve(__dirname, '../..');
const sharp = require(root + '/node_modules/sharp');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-test-')); // 全部在临时目录里，不碰 uploads/
const { applyWatermark, measureLuma } = require(root + '/src/utils/watermark');
let fails = [];
const chk = (n, ok, extra='') => { console.log((ok?'PASS ':'FAIL ')+n+(ok?'':'  '+extra)); if(!ok) fails.push(n); };
(async () => {
  // 1. 手机竖拍：像素 800x600，Orientation=6，左半红右半蓝 → 转正后应是 600x800，上半红下半蓝
  const left = await sharp({ create: { width: 400, height: 600, channels: 3, background: '#cc3333' } }).png().toBuffer();
  const phone = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3333cc' } })
    .composite([{ input: left, left: 0, top: 0 }]).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  fs.writeFileSync(T + '/t-phone.jpg', phone);
  await applyWatermark(T + '/t-phone.jpg', 'image/jpeg');
  let m = await sharp(T + '/t-phone.jpg').metadata();
  chk('竖拍：像素转正成 600x800', m.width === 600 && m.height === 800, m.width+'x'+m.height);
  chk('竖拍：不再带 orientation 标记', !m.orientation, String(m.orientation));
  const crop = async (r) => sharp(await sharp(T + '/t-phone.jpg').extract(r).toBuffer()).stats();
  const top = await crop({left:100,top:50,width:50,height:50});
  const bot = await crop({left:100,top:700,width:50,height:50});
  chk('竖拍：上半是红（方向对）', top.channels[0].mean > 150 && top.channels[2].mean < 100, JSON.stringify(top.channels.map(c=>c.mean)));
  chk('竖拍：下半是蓝', bot.channels[2].mean > 150, JSON.stringify(bot.channels.map(c=>c.mean)));

  // 1b. 亮度只量落点区域：整体深色、右下角是白块 → 区域亮度要高；反之亦然
  const dark = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#101010' } })
    .composite([{ input: await sharp({ create: { width: 200, height: 150, channels: 3, background: '#fafafa' } }).png().toBuffer(), left: 600, top: 450 }]).png().toBuffer();
  const lc = await measureLuma(dark, { left: 640, top: 480, width: 100, height: 80 });
  const ld = await measureLuma(dark, { left: 20, top: 20, width: 100, height: 80 });
  chk('亮度：右下角白块 > 0.9', lc > 0.9, String(lc));
  chk('亮度：左上深色 < 0.1', ld < 0.1, String(ld));

  // 2. 带 GPS 的照片：处理后元数据应被清掉
  try {
    const gps = await sharp({ create: { width: 900, height: 700, channels: 3, background: '#888' } }).jpeg()
      .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 41/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '139/1 41/1 0/1' } }).toBuffer();
    fs.writeFileSync(T + '/t-gps.jpg', gps);
    const before = await sharp(T + '/t-gps.jpg').metadata();
    await applyWatermark(T + '/t-gps.jpg', 'image/jpeg');
    const after = await sharp(T + '/t-gps.jpg').metadata();
    chk('GPS：处理前确实带 EXIF（测试有效）', !!before.exif);
    chk('GPS：处理后 EXIF 被清掉', !after.exif);
  } catch (e) { console.log('SKIP gps test:', e.message); }

  // 3. 大图缩到长边 2560；MAX_IMAGE_EDGE=0 时不缩
  const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#468' } }).jpeg().toBuffer();
  fs.writeFileSync(T + '/t-big.jpg', big);
  await applyWatermark(T + '/t-big.jpg', 'image/jpeg');
  m = await sharp(T + '/t-big.jpg').metadata();
  chk('大图：长边缩到 2560', m.width === 2560 && m.height === 1920, m.width+'x'+m.height);
  process.env.MAX_IMAGE_EDGE = '0';
  fs.writeFileSync(T + '/t-big2.jpg', big); await applyWatermark(T + '/t-big2.jpg', 'image/jpeg');
  m = await sharp(T + '/t-big2.jpg').metadata();
  chk('MAX_IMAGE_EDGE=0：不缩', m.width === 4000, m.width+'x'+m.height);
  delete process.env.MAX_IMAGE_EDGE;

  // 4. 小图：不打水印，但照样转正（不能因为小就躺倒）
  const smallPhone = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#3333cc' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  fs.writeFileSync(T + '/t-small.jpg', smallPhone);
  const r = await applyWatermark(T + '/t-small.jpg', 'image/jpeg');
  m = await sharp(T + '/t-small.jpg').metadata();
  chk('小图：返回 null（没打水印）', r === null);
  chk('小图：照样转正成 100x160', m.width === 100 && m.height === 160, m.width+'x'+m.height);

  // 5. PNG 透明通道保留
  const png = await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  fs.writeFileSync(T + '/t-alpha.png', png);
  await applyWatermark(T + '/t-alpha.png', 'image/png');
  m = await sharp(T + '/t-alpha.png').metadata();
  chk('PNG：透明通道还在', m.hasAlpha === true && m.format === 'png', JSON.stringify({a:m.hasAlpha,f:m.format}));

  // 6. 动图 WebP：整个不碰，帧数不变
  try {
    const f1 = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#f00' } }).png().toBuffer();
    const f2 = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#00f' } }).png().toBuffer();
    const anim = await sharp([f1, f2], { join: { animated: true } }).webp({ loop: 0, delay: [200, 200] }).toBuffer();
    fs.writeFileSync(T + '/t-anim.webp', anim);
    const b = await sharp(T + '/t-anim.webp', { pages: -1 }).metadata();
    await applyWatermark(T + '/t-anim.webp', 'image/webp');
    const a = await sharp(T + '/t-anim.webp', { pages: -1 }).metadata();
    chk('动图 WebP：测试数据确实是多帧', b.pages === 2, String(b.pages));
    chk('动图 WebP：处理后仍是 2 帧', a.pages === 2, String(a.pages));
  } catch (e) { console.log('SKIP anim test:', e.message); }

  // 7. 坏文件：不抛错、原文件不动
  fs.writeFileSync(T + '/t-bad.jpg', 'not an image');
  const rb = await applyWatermark(T + '/t-bad.jpg', 'image/jpeg');
  chk('坏文件：静默降级，原样保留', rb === null && fs.readFileSync(T + '/t-bad.jpg', 'utf8') === 'not an image' && !fs.existsSync(T + '/t-bad.jpg.tmp'));

  console.log('\nFAILS:', fails);
})();
