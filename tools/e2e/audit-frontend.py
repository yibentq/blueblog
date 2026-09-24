"""前台审计：首页搜索/季度筛选、手机宽度横向溢出、评论提交→后台通过→作者回复→前台、feed/sitemap/meta。
只在一次性/本机数据库 + 本机起的 node src/app.js（端口 3999）上跑；账号密码是种子里的测试值，不是生产的。
前提见 tools/e2e/README.md 末尾"沙箱里的实测记录"：起一次性 Postgres，跑 seed-showcase.js，再起应用。
每次运行会登录一次后台——登录有限流，连续跑很多次会被 429，重启应用即可清零。
"""
import sys, json, re; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from _audit_common import login
from playwright.sync_api import sync_playwright
import urllib.request
R=[]
def chk(name, got, want):
    ok = (got==want) if not callable(want) else want(got)
    R.append((ok,name,got)); print(('PASS ' if ok else 'FAIL ')+name+('' if ok else '  -> '+json.dumps(got,ensure_ascii=False)[:220]))
def get(path): 
    r=urllib.request.urlopen('http://127.0.0.1:3999'+path); return r.status, r.read().decode('utf-8','replace'), r.headers
with sync_playwright() as p:
    b=p.chromium.launch(); errs=[]
    # ---------- 匿名访客：首页 ----------
    ctx=b.new_context(viewport={'width':1280,'height':900}); pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append('home:'+str(e)))
    pg.goto('http://127.0.0.1:3999/'); pg.wait_for_timeout(1200)
    n=pg.locator('#nb-entries > *').count(); chk('首页目录渲染出条目', n>=3, True)
    pg.fill('#nb-search','雨后'); pg.wait_for_timeout(900)
    vis=[t.strip() for t in pg.locator('#nb-entries a').all_inner_texts()]; chk('搜索“雨后”只剩匹配条目', (len(vis)>=1) and all('雨后' in t for t in vis), True); print('   ',vis[:4])
    pg.fill('#nb-search','不存在的词xyz'); pg.wait_for_timeout(900); chk('搜索无结果显示空状态', pg.locator('#nb-empty').is_visible(), True)
    pg.fill('#nb-search',''); pg.wait_for_timeout(700)
    pg.click('#nb-volume-trigger'); pg.wait_for_timeout(300); chk('季度下拉菜单能展开', pg.locator('#nb-volume-menu').is_visible(), True)
    opts=pg.locator('#nb-volume-menu [role=option], #nb-volume-menu li, #nb-volume-menu button'); print('   volume options:', opts.count())
    if opts.count()>1:
        opts.nth(1).click(); pg.wait_for_timeout(800); chk('切换季度后菜单收起', pg.locator('#nb-volume-menu').is_visible(), False)
    pg.keyboard.press('Escape')
    # 点条目能跳文章
    pg.goto('http://127.0.0.1:3999/'); pg.wait_for_timeout(1000); pg.locator('#nb-entries a').first.click(); pg.wait_for_load_state(); chk('点目录条目跳到文章页', '/p/' in pg.url, True)
    # ---------- 手机宽度：横向溢出 ----------
    for path in ['/','/p/t0','/sitemap','/nope']:
        m=b.new_context(viewport={'width':390,'height':800},device_scale_factor=2).new_page(); m.goto('http://127.0.0.1:3999'+path); m.wait_for_timeout(900)
        ov=m.evaluate("()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth})"); chk(f'手机 {path} 无横向滚动', ov['sw']<=ov['cw']+1, True)
        if ov['sw']>ov['cw']+1: print('   overflow',ov)
    # ---------- 评论：匿名提交 → 后台通过 → 作者回复 → 前台 ----------
    pg.goto('http://127.0.0.1:3999/p/t0'); pg.fill('.comment-form input[name=author_name]','审计员'); pg.fill('.comment-form textarea[name=content]','这是审计写的评论\n第二行 <b>不该加粗</b>'); 
    with pg.expect_navigation(): pg.click('.comment-form button[type=submit]')
    chk('提交评论后提示待审核', '评论已提交' in pg.content(), True)
    chk('待审核评论不在前台显示', '这是审计写的评论' in pg.locator('.comments').inner_text(), False)
    adm=b.new_context(viewport={'width':1300,'height':900}).new_page(); adm.on('pageerror',lambda e:errs.append('admin:'+str(e))); login(adm)
    adm.goto('http://127.0.0.1:3999/admin/comments'); adm.wait_for_timeout(700)
    body=adm.inner_text('body'); chk('后台评论页看到待审核评论', '审计员' in body, True)
    btn=adm.locator('button:has-text("通过")'); print('   通过 buttons:', btn.count())
    if btn.count():
        btn.first.click(); adm.wait_for_timeout(1000)
    pg.goto('http://127.0.0.1:3999/p/t0'); txt=pg.locator('.comments').inner_text(); chk('通过后前台可见', '这是审计写的评论' in txt, True)
    chk('评论里的 HTML 被转义（不执行）', pg.locator('.comments b').count(), 0)
    print('   .comment newline preserved?', pg.locator('.comment p').nth(1).inner_html()[:80] if pg.locator('.comment p').count()>1 else '')
    # ---------- feed / sitemap / robots / head ----------
    s,h,hd=get('/feed.xml'); chk('feed.xml 是 RSS 且含文章', s==200 and '<rss' in h and 'audit-post'.__len__()>0 and '<item>' in h, True)
    s,h,hd=get('/sitemap.xml') if True else (0,'',{}); chk('sitemap.xml 200', s, 200)
    s,h,hd=get('/robots.txt'); chk('robots.txt 200', s, 200)
    s,h,hd=get('/p/t0'); chk('文章页有 og:title 与 canonical', 'og:title' in h and 'canonical' in h, True)
    print('JS errors:', errs[:5]); b.close()
print('\nFAILS:', [n for ok,n,g in R if not ok])
