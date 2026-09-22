const fs = require('fs');
const path = require('path');

const aB64 = fs.readFileSync(path.join(__dirname, 'A-antique-leather-cover-preview.png')).toString('base64');
const bB64 = fs.readFileSync(path.join(__dirname, 'B-moldy-kraft-page-preview.png')).toString('base64');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>材质 + 文字对比度测试</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Caveat:wght@500;600&family=Noto+Serif+SC:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{
    --brass:#C79A45; --cream:#EFE6CE; --ink-fountain:#25334A; --ink-on-paper:#16233A;
    --font-hand-zh:'Ma Shan Zheng',cursive; --font-hand-en:'Caveat',cursive;
    --font-body:'Noto Serif SC',Georgia,serif; --font-mono:'IBM Plex Mono',monospace;
  }
  body{ margin:0; background:#0b1420; color:#EAF0F8; font-family:var(--font-body);
    padding:40px 24px 80px; display:flex; flex-direction:column; align-items:center; gap:46px; }
  .note{ max-width:760px; text-align:center; font-family:var(--font-mono); font-size:0.78rem; opacity:0.75; line-height:1.7; }
  .note b{ color:var(--brass); }
  .row{ display:flex; gap:40px; flex-wrap:wrap; justify-content:center; align-items:flex-start; }
  figure{ margin:0; text-align:center; }
  figcaption{ margin-top:10px; font-family:var(--font-mono); font-size:0.72rem; opacity:0.7; }

  /* 封面卡片：测试签名/标题文字直接压在皮革材质上 */
  .cover{
    width:250px; height:350px; border-radius:2px; position:relative; overflow:hidden;
    background-image:url('data:image/png;base64,${aB64}');
    background-size:cover; background-position:center;
    box-shadow:0 25px 50px -18px rgba(0,0,0,0.7);
  }
  .cover .sig{ position:absolute; left:20px; top:26px; font-family:var(--font-hand-en);
    font-size:2.1rem; color:var(--cream); text-shadow:0 2px 6px rgba(0,0,0,0.6); }
  .cover .tagline{ position:absolute; left:20px; top:70px; font-family:var(--font-mono);
    font-size:0.62rem; color:rgba(239,230,206,0.75); letter-spacing:0.03em; max-width:170px; line-height:1.6; }
  .cover .vol{ position:absolute; right:18px; bottom:18px; font-family:var(--font-hand-en);
    font-size:1.3rem; color:rgba(239,230,206,0.85); }

  /* 内页：测试标题(艺术字)+正文(清晰字体)压在发霉材质上 */
  .page{
    width:420px; min-height:340px; border-radius:2px; position:relative; overflow:hidden; padding:34px 30px;
    background-image:url('data:image/png;base64,${bB64}');
    background-size:cover; background-position:center;
    box-shadow:0 25px 50px -18px rgba(0,0,0,0.7);
  }
  .page .date{ font-family:var(--font-hand-en); font-size:1.15rem; color:var(--ink-fountain); }
  .page h2{ font-family:var(--font-hand-zh); font-weight:400; font-size:2.1rem; margin:6px 0 14px; color:var(--ink-on-paper); line-height:1.3; }
  .page p{ font-size:0.92rem; line-height:1.8; color:var(--ink-on-paper); max-width:32ch; margin:0; }

  /* 变体2：给文字区域加一层极轻的纸色衬底，测试是否能解决"压在深色霉斑上看不清"的问题 */
  .page.scrim h2, .page.scrim p, .page.scrim .date{ position:relative; z-index:2; }
  .page.scrim::before{
    content:""; position:absolute; inset:0; z-index:1;
    background:linear-gradient(180deg, rgba(246,239,224,0.0) 0%, rgba(246,239,224,0.55) 22%, rgba(246,239,224,0.6) 100%);
  }
</style>
</head>
<body>
  <div class="note">材质 + 文字对比度测试——只测两件事：<b>皮革封面压文字好不好认</b>、<b>发霉内页压文字会不会被斑块吃掉</b>。<br>
  不是最终排版，标题/摘录内容是占位文字。</div>

  <div class="row">
    <figure>
      <div class="cover">
        <div class="sig">blog blue</div>
        <div class="tagline">一本随手记的蓝图手帐 / 写于 2024 年至今</div>
        <div class="vol">Vol.03</div>
      </div>
      <figcaption>封面：文字直接压在 A 版材质上</figcaption>
    </figure>

    <figure>
      <div class="page">
        <div class="date">9.18</div>
        <h2>今天窗外下了一整天的雨</h2>
        <p>在阳台坐了很久，什么也没干，只是看雨，突然想起去年这个时候也是这样。</p>
      </div>
      <figcaption>内页版本 1：文字直接压在 B 版材质上（没有任何衬底）</figcaption>
    </figure>

    <figure>
      <div class="page scrim">
        <div class="date">9.18</div>
        <h2>今天窗外下了一整天的雨</h2>
        <p>在阳台坐了很久，什么也没干，只是看雨，突然想起去年这个时候也是这样。</p>
      </div>
      <figcaption>内页版本 2：文字区域叠了一层极轻的纸色渐变衬底</figcaption>
    </figure>
  </div>
</body>
</html>
`;

fs.writeFileSync('/mnt/user-data/outputs/material-typography-test.html', html);
console.log('done, length=', html.length);
