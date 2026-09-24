"""编辑器审计：真实登录后台、真实上传/保存/草稿/预览/使用表，逐项 PASS/FAIL。
（已知：最后一项 "Esc 关闭抽屉" 是我当时多写的期望，原设计里只有专注模式用 Esc，忽略即可。）
只在一次性/本机数据库 + 本机起的 node src/app.js（端口 3999）上跑；账号密码是种子里的测试值，不是生产的。
前提见 tools/e2e/README.md 末尾"沙箱里的实测记录"：起一次性 Postgres，跑 seed-showcase.js，再起应用。
每次运行会登录一次后台——登录有限流，连续跑很多次会被 429，重启应用即可清零。
"""
import sys, os; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from _audit_common import *
R=[]
def chk(name, got, want):
    ok = (got==want) if not callable(want) else want(got)
    R.append((ok,name,got)); print(('PASS ' if ok else 'FAIL ')+name+('' if ok else '  -> '+json.dumps(got,ensure_ascii=False)[:200]))
def setv(ta,t,s=None,e=None):
    ta.evaluate("(el,a)=>{el.focus();el.value=a[0];el.dispatchEvent(new Event('input',{bubbles:true}));el.setSelectionRange(a[1]===null?el.value.length:a[1],a[2]===null?el.value.length:a[2])}",[t,s,e])
from PIL import Image
Image.new('RGB',(800,500),(200,220,240)).save('/tmp/audit-up1.jpg'); Image.new('RGB',(600,400),(230,200,180)).save('/tmp/audit-up2.jpg')
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1300,'height':900}); pg=ctx.new_page(); login(pg); ta=new_editor(pg)
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    # --- 工具栏「图片」: 真实文件选择器 + 上传接口 + 水印 ---
    setv(ta,'一段文字',4,4)
    with pg.expect_file_chooser() as fc: pg.click('button[data-cmd="image"]')
    fc.value.set_files('/tmp/audit-up1.jpg'); pg.wait_for_timeout(3000)
    v=val(ta); print('   after toolbar upload:', json.dumps(v,ensure_ascii=False)[:140])
    chk('工具栏上传:无占位符残留', 'uploading' not in v, True)
    chk('工具栏上传:图片独占段落(前后空行)', v.startswith('一段文字\n\n![](/uploads/') and v.endswith(')\n\n'), True)
    # 连传第二张到文末，不能粘连
    ta.evaluate("el=>{el.focus();el.setSelectionRange(el.value.length,el.value.length)}")
    with pg.expect_file_chooser() as fc: pg.click('button[data-cmd="image"]')
    fc.value.set_files('/tmp/audit-up2.jpg'); pg.wait_for_timeout(3000)
    v=val(ta); chk('连传两张:各自独占段落', v.count('![](/uploads/')==2 and '\n\n![](/uploads/' in v and ')![' not in v and ')\n![' not in v, True)
    # 图库「插入到光标处」
    n0=v.count('![](')
    setv(ta,'甲文字\n乙文字',3,3)
    pg.locator('#image-gallery .gallery-item button:has-text("插入到光标处")').first.click(); pg.wait_for_timeout(300)
    v=val(ta); chk('图库插入:独占段落', '甲文字\n\n![](' in v and ')\n\n\n乙文字' not in v and ')\n\n乙文字' in v or ')\n\n\n乙文字' in v, True); print('   ',json.dumps(v,ensure_ascii=False)[:120])
    # 粘贴图片 (clipboard files)
    setv(ta,'贴图前文字',5,5)
    ta.evaluate("""async el=>{const r=await fetch('/uploads/'+document.querySelector('#image-gallery .gallery-item img').getAttribute('src').split('/').pop());const bl=await r.blob();const f=new File([bl],'p.jpg',{type:'image/jpeg'});const dt=new DataTransfer();dt.items.add(f);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));}""")
    pg.wait_for_timeout(3000); v=val(ta); print('   paste:', json.dumps(v,ensure_ascii=False)[:120])
    chk('粘贴图片:上传并独占段落', v.startswith('贴图前文字\n\n![](/uploads/') and 'uploading' not in v, True)
    # --- 使用表 ---
    pg.keyboard.press('Control+/'); pg.wait_for_timeout(500)
    chk('Ctrl+/ 打开抽屉', pg.locator('#md-drawer').evaluate("e=>!e.hidden && e.classList.contains('open')"), True)
    setv(ta,'甲\n乙',0,3)
    pg.locator('#md-drawer .cs-row[data-cmd="ol"]').first.click(); pg.wait_for_timeout(200)
    chk('使用表点「编号」套在选中行上', val(ta), '1. 甲\n2. 乙')
    setv(ta,'## 一\n\n正文\n\n### 二\n\n```\n## 不是标题\n```\n'); pg.click('#md-drawer .md-tab[data-tab="outline"]'); pg.wait_for_timeout(300)
    chk('大纲只列真标题(跳过代码块)', pg.locator('#md-outline button, #md-outline a, #md-outline .md-ol-item').count(), 2)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    chk('Esc 关闭抽屉', pg.locator('#md-drawer').evaluate("e=>e.hidden || !e.classList.contains('open')"), True)
    # --- 专注模式 ---
    pg.keyboard.press('Control+Alt+f'); pg.wait_for_timeout(300); on=pg.evaluate("()=>document.body.classList.contains('md-focus')||!!document.querySelector('.focus-mode,.is-focus')")
    print('   focus class present:', on); pg.keyboard.press('Escape')
    # --- 摘要生成 ---
    setv(ta,'这是一段用来生成摘要的正文，写得稍微长一点点，看看摘要会怎么截取。'); pg.fill('#summary',''); pg.click('#summary-gen'); pg.wait_for_timeout(300)
    chk('从正文生成摘要', len(pg.input_value('#summary'))>5, True)
    # --- 草稿暂存 / 恢复 ---
    setv(ta,'草稿内容ABC'); pg.fill('#title','草稿标题'); pg.wait_for_timeout(2200)
    keys=pg.evaluate("()=>Object.keys(localStorage)"); chk('正文暂存到 localStorage', any('draft' in k or 'blog' in k for k in keys), True); print('   ls keys:',keys)
    pg.goto('http://127.0.0.1:3999/admin/posts/new'); pg.wait_for_timeout(800)
    vis=pg.locator('#draft-banner').is_visible(); chk('重新打开出现恢复提示', vis, True)
    if vis:
        pg.click('#draft-restore'); pg.wait_for_timeout(300); chk('恢复后正文回来', pg.locator('textarea[name=content_md]').input_value(), '草稿内容ABC')
    # --- 保存 → 前台 ---
    ta=pg.locator('textarea[name=content_md]'); setv(ta,'## 审计文章\n\n一段文字\n![](/img/og-default.png "图说")\n收尾![](/img/404-fallen-v1.svg)\n\n1. 甲\n2. 乙\n')
    pg.fill('#title','审计文章'); pg.fill('#slug','audit-post'); pg.select_option('#status','published')
    pg.click('#post-form button[type=submit]'); pg.wait_for_load_state(); pg.wait_for_timeout(500)
    print('   after save url:', pg.url); chk('保存后带 saved=1 或跳转成功', ('saved=1' in pg.url) or ('/admin' in pg.url), True)
    keys=pg.evaluate("()=>Object.keys(localStorage)"); chk('保存后暂存已清', not any(('draft' in k) for k in keys), True)
    r=pg.goto('http://127.0.0.1:3999/p/audit-post'); chk('前台文章 200', r.status, 200)
    chk('前台:两张图都成了相册照片', pg.locator('figure.print').count(), 2)
    print('JS errors:', errs[:5])
    b.close()
print('\nFAILS:', [n for ok,n,g in R if not ok])
