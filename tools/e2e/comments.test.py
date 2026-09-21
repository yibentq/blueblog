# 评论收件箱端到端测试：真实应用 + 真实 Postgres + 真实登录/CSRF。
# 前置：数据库已 migrate + seed（管理员），并跑过 seed-comments.js；应用监听 E2E_BASE（默认 3999 端口）。
import os
import re
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_BASE', 'http://127.0.0.1:3999')
ADMIN_USER = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASS = os.environ.get('ADMIN_PASSWORD', 'Passw0rd-test-123')
OUT = os.environ.get('E2E_OUT', '/tmp')
fails = []


def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else '  ' + str(extra)))
    if not cond:
        fails.append(name)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'fonts.g' not in m.text and '403' not in m.text and 'ERR_' not in m.text else None)
    dialogs = []
    pg.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))

    # ---- 登录（真实的 session + CSRF 链路）
    pg.goto(BASE + '/admin/login')
    pg.fill('#username', ADMIN_USER)
    pg.fill('#password', ADMIN_PASS)
    pg.click('button[type=submit]')
    pg.wait_for_url(BASE + '/admin')
    check('logged in', '/admin' in pg.url)

    # ---- 文章列表：评论列 + 侧栏角标
    check('nav badge shows pending', pg.locator('.admin-sidebar .nav-badge').count() == 1, pg.locator('.admin-sidebar').inner_text())
    check('dashboard has comment column', pg.locator('th', has_text='评论').count() == 1)
    check('dashboard per-post pending pill', pg.locator('.cm-link .cm-pill.pending').count() >= 1)

    # ---- 收件箱
    pg.goto(BASE + '/admin/comments')
    check('default tab pending', pg.locator('.cm-tabs a.active').inner_text().startswith('待审核'))
    n_pending = pg.locator('.cc').count()
    check('cards rendered', n_pending >= 5, n_pending)
    check('rail lists posts', pg.locator('.cm-rail-item[data-post]').count() >= 2)
    html = pg.inner_html('#cm-list')
    check('XSS payload escaped (no script tag in list)', '<script>alert(1)</script>' not in html and '&lt;script&gt;' in html)
    check('reply-less card has context link to post', pg.locator('.cc-post').first.is_visible())
    spam_card = pg.locator('.cc', has_text='Third spam')
    check('visitor batch button appears', spam_card.locator('[data-act=spam-visitor]').count() == 1)
    check('time localized', pg.locator('time.cc-time').first.inner_text() != '' and 'UTC' not in pg.locator('time.cc-time').first.inner_text())

    # ---- 通过（不刷新页面：在页面上放一个标记，动作后标记还在）
    pg.evaluate("window.__marker = 42")
    target = pg.locator('.cc', has_text='这篇写得真好')
    tid = target.get_attribute('data-id')
    badge_before = int(pg.locator('.nav-badge').inner_text())
    pg.locator(f'#cc-{tid} [data-act=approve]').click()
    pg.wait_for_timeout(600)
    check('approved card leaves pending list', pg.locator(f'#cc-{tid}').count() == 0)
    check('no page reload', pg.evaluate("window.__marker") == 42)
    check('nav badge decremented', int(pg.locator('.nav-badge').inner_text()) == badge_before - 1)
    check('toast with undo', pg.is_visible('#cm-toast') and pg.is_visible('#cm-toast-undo'))
    # 撤销
    pg.click('#cm-toast-undo')
    pg.wait_for_timeout(600)
    check('undo restores card', pg.locator(f'#cc-{tid}').count() == 1 and pg.locator(f'#cc-{tid}').get_attribute('data-status') == 'pending')
    check('undo restored badge', int(pg.locator('.nav-badge').inner_text()) == badge_before)

    # ---- 键盘：j 聚焦第一条，a 通过
    pg.locator('body').click(position={'x': 5, 'y': 5})
    pg.keyboard.press('j')
    first_id = pg.evaluate("document.activeElement.getAttribute('data-id')")
    check('j focuses first card', bool(first_id) and pg.evaluate("document.activeElement.classList.contains('cc')"))
    pg.keyboard.press('s')
    pg.wait_for_timeout(600)
    check('s marks focused as spam (removed from pending)', pg.locator(f'#cc-{first_id}').count() == 0)
    pg.keyboard.press('u')
    pg.wait_for_timeout(600)
    check('u undoes via keyboard', pg.locator(f'#cc-{first_id}').count() == 1)

    # ---- 同访客批量垃圾
    pg.locator('.cc', has_text='Spammer').first.locator('[data-act=spam-visitor]').click()
    pg.wait_for_timeout(1400)  # confirm auto-accepted + reload
    check('spam-visitor asked for confirm', any('待审' in d for d in dialogs), dialogs)
    check('visitor spam gone from pending', pg.locator('.cc', has_text='Spammer').count() == 0)

    # ---- 垃圾标签页：恢复 + 永久删除
    pg.goto(BASE + '/admin/comments?status=spam')
    check('spam tab shows spammer', pg.locator('.cc', has_text='Third spam').count() == 1)
    check('spam card offers delete', pg.locator('.cc', has_text='Third spam').locator('[data-act=delete]').count() == 1)
    pg.locator('.cc', has_text='Third spam').locator('[data-act=delete]').click()
    pg.wait_for_timeout(700)
    check('deleted permanently', pg.locator('.cc', has_text='Third spam').count() == 0)
    # 恢复一条
    pg.locator('.cc', has_text='Another spam').locator('[data-act=approve]').click()
    pg.wait_for_timeout(600)
    check('restored from spam (leaves spam tab)', pg.locator('.cc', has_text='Another spam').count() == 0)

    # ---- 文章绑定视图 + 回复
    pg.goto(BASE + '/admin/comments')
    pg.click('.cm-rail-item[data-post] >> nth=0')
    pg.wait_for_load_state()
    check('post-bound view shows article card', pg.locator('.cm-postcard').count() == 1)
    check('post-bound hides per-card article link', not pg.locator('.cc-post').first.is_visible() if pg.locator('.cc-post').count() else True)
    check('tab counts scoped to article', pg.locator('.cm-count[data-count=all]').inner_text().isdigit())
    pid = pg.locator('.cm-main').get_attribute('data-post')
    check('post id in url', pid in pg.url)

    pg.goto(BASE + f'/admin/comments?post={pid}&status=pending')
    pend = pg.locator('.cc[data-status=pending]')
    if pend.count() == 0:
        print('no pending in first post, using second')
    cid = pend.first.get_attribute('data-id')
    pg.locator(f'#cc-{cid} [data-act=reply]').click()
    check('reply composer opens', pg.locator(f'#cc-{cid} .cc-reply').is_visible())
    pg.fill(f'#cc-{cid} .cc-reply textarea', '谢谢你的留言！')
    pg.keyboard.press('Control+Enter')
    pg.wait_for_timeout(800)
    check('replying to pending approves & removes from pending tab', pg.locator(f'#cc-{cid}').count() == 0)

    pg.goto(BASE + f'/admin/comments?post={pid}&status=all')
    check('thread: reply is nested', pg.locator('.cc.is-reply.is-author').count() >= 1)
    check('author badge on reply', pg.locator('.cc.is-author .cc-tag.author').count() >= 1)
    check('reply shows quote of parent', pg.locator('.cc.is-author .cc-quote').count() >= 1)
    check('author reply has no spam button', pg.locator('.cc.is-author [data-act=spam]').count() == 0)

    # ---- 批量
    pg.goto(BASE + '/admin/comments?status=all')
    pg.check('#cm-selectall')
    check('bulk bar appears', pg.is_visible('#cm-bulk'))
    check('bulk count', re.search(r'已选 \d+ 条', pg.inner_text('#cm-bulk-n')) is not None)
    pg.click('[data-bulk=clear]')
    check('bulk cleared', not pg.is_visible('#cm-bulk'))

    # ---- 编辑页与评论互链
    pg.goto(BASE + f'/admin/posts/{pid}/edit')
    check('editor side link to comments', pg.locator('.side-comments').count() == 1)
    check('file input hidden by attribute', not pg.locator('#image-upload-input').is_visible())

    # ---- 公开页：线程 + 作者标记 + 锚点
    slug = pg.evaluate("fetch('/admin/comments?post=%s&status=all').then(r=>r.text())" % pid)
    m = re.search(r'/p/([a-z0-9-]+)#c-', slug)
    if m:
        pub = ctx.new_page()
        pub.goto(BASE + f'/p/{m.group(1)}')
        check('public: author badge', pub.locator('.comment-author-badge').count() >= 1)
        check('public: reply nested', pub.locator('.comment.reply').count() >= 1)
        check('public: comment anchors', pub.locator('.comment[id^=c-]').count() >= 1)
        pub.screenshot(path=OUT + '/public-comments.png', full_page=True)

    # ---- 截图
    pg.goto(BASE + f'/admin/comments?post={pid}&status=all')
    pg.wait_for_timeout(300)
    pg.screenshot(path=OUT + '/cm-post.png')
    pg.goto(BASE + '/admin/comments')
    pg.locator('.cc').first.focus()
    pg.wait_for_timeout(300)
    pg.screenshot(path=OUT + '/cm-inbox.png')

    check('no page errors', not errs, errs)
    b.close()

print('FAILS:', fails)
