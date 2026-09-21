import os
from playwright.sync_api import sync_playwright
# 编辑器前端行为测试：需要先启动 editor-stub.js（默认 4317 端口）
BASE = os.environ.get('STUB_URL', 'http://127.0.0.1:4317')
OUT = os.environ.get('E2E_OUT', '/tmp')
fails=[]
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ')+name+(' '+str(extra) if (not cond and extra!='') else ''))
    if not cond: fails.append(name)

with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1500,'height':900}); pg=ctx.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' and 'fonts.g' not in m.text and 'ERR_' not in m.text else None)
    pg.goto(BASE + '/editor'); pg.wait_for_timeout(300)
    ta=pg.locator('#content_md'); ta.click()
    def val(): return ta.input_value()
    def clear(): ta.fill(''); ta.click()

    # bold: empty → placeholder selected; type over it
    pg.click('[data-cmd=bold]'); check('bold empty', val()=='**粗体文字**', val())
    pg.click('[data-cmd=bold]'); check('bold toggle off', val()=='粗体文字', val())
    # wrap selection
    clear(); pg.keyboard.type('hello'); pg.keyboard.press('Control+a'); pg.click('[data-cmd=italic]')
    check('italic wrap', val()=='*hello*', val())
    pg.click('[data-cmd=italic]'); check('italic unwrap', val()=='hello', val())
    # bold then italic must not confuse
    clear(); pg.keyboard.type('x'); pg.keyboard.press('Control+a'); pg.click('[data-cmd=bold]'); pg.click('[data-cmd=italic]')
    check('bold+italic', val()=='***x***', val())
    # headings
    clear(); pg.keyboard.type('标题'); pg.click('[data-cmd=h2]'); check('h2', val()=='## 标题', val())
    pg.click('[data-cmd=h3]'); check('h2→h3', val()=='### 标题', val())
    pg.click('[data-cmd=h3]'); check('h3 off', val()=='标题', val())
    # lists multi-line
    clear(); pg.keyboard.type('a\nb\nc'); pg.keyboard.press('Control+a'); pg.click('[data-cmd=ol]')
    check('ol', val()=='1. a\n2. b\n3. c', val())
    pg.click('[data-cmd=ul]'); check('ol→ul', val()=='- a\n- b\n- c', val())
    pg.click('[data-cmd=task]'); check('ul→task', val()=='- [ ] a\n- [ ] b\n- [ ] c', val())
    pg.click('[data-cmd=task]'); check('task off', val()=='a\nb\nc', val())
    # quote
    pg.click('[data-cmd=quote]'); check('quote', val()=='> a\n> b\n> c', val())
    pg.click('[data-cmd=quote]'); check('quote off', val()=='a\nb\nc', val())
    # smart enter
    clear(); pg.keyboard.type('- 一'); pg.keyboard.press('Enter'); pg.keyboard.type('二'); pg.keyboard.press('Enter')
    check('enter continues ul', val()=='- 一\n- 二\n- ', val())
    pg.keyboard.press('Enter'); check('empty item ends list', val()=='- 一\n- 二\n', val())
    clear(); pg.keyboard.type('1. a'); pg.keyboard.press('Enter'); pg.keyboard.type('b'); pg.keyboard.press('Enter')
    check('enter continues ol', val()=='1. a\n2. b\n3. ', val())
    clear(); pg.keyboard.type('- [ ] t'); pg.keyboard.press('Enter'); check('enter continues task', val()=='- [ ] t\n- [ ] ', val())
    # tab indent
    clear(); pg.keyboard.type('- a'); pg.keyboard.press('Tab'); check('tab indent', val()=='  - a', val())
    pg.keyboard.press('Shift+Tab'); check('shift-tab outdent', val()=='- a', val())
    # blocks
    clear(); pg.keyboard.type('前文'); pg.click('[data-cmd=codeblock]')
    check('codeblock spacing', val()=='前文\n\n```\n代码写在这里\n```\n', repr(val()))
    clear(); pg.keyboard.type('前'); pg.keyboard.press('Enter'); pg.keyboard.type('后'); pg.keyboard.press('ArrowLeft'); pg.keyboard.press('ArrowLeft'); 
    pg.click('[data-cmd=hr]'); check('hr between', '前\n\n---\n\n后' in val() or val().count('---')==1, repr(val()))
    clear(); pg.click('[data-cmd=table]'); check('table', val().startswith('| 列一 | 列二 | 列三 |\n| --- |'), repr(val()))
    clear(); pg.click('summary.tb-btn'); pg.click('[data-cmd=tip]'); check('tip callout', val().startswith('> [!TIP]\n> 内容'), repr(val()))
    # link
    clear(); pg.keyboard.type('站点'); pg.keyboard.press('Control+a'); pg.click('[data-cmd=link]')
    check('link wrap', val()=='[站点](https://)', val())
    # undo works after toolbar op
    clear(); pg.keyboard.type('u'); pg.keyboard.press('Control+a'); pg.click('[data-cmd=bold]'); pg.keyboard.press('Control+z')
    check('undo after toolbar', val()=='u', repr(val()))
    # shortcut
    clear(); pg.keyboard.type('s'); pg.keyboard.press('Control+a'); pg.keyboard.press('Control+b'); check('ctrl+b', val()=='**s**', val())

    # stats
    clear(); pg.keyboard.type('你好世界 hello world'); pg.wait_for_timeout(300)
    check('stats', pg.inner_text('#stat-count').startswith('6 字'), pg.inner_text('#stat-count'))

    # preview
    clear(); pg.keyboard.type('## 标题\n\n==重点== 与 **粗**'); 
    pg.click('[data-view=split]'); pg.wait_for_timeout(1600)
    html=pg.inner_html('#pv-body')
    check('preview renders', '<h2 id=' in html and '<mark>重点</mark>' in html, html[:200])
    check('preview visible in split', pg.is_visible('#md-preview') and pg.is_visible('#content_md'))
    pg.click('[data-view=preview]'); check('preview-only hides textarea', not pg.is_visible('#content_md'))
    pg.click('[data-view=write]'); check('write hides preview', not pg.is_visible('#md-preview'))

    # drawer
    pg.click('#tb-cheat'); pg.wait_for_timeout(300); check('drawer opens', pg.is_visible('#md-drawer'))
    clear(); pg.click('#md-drawer [data-cmd=mark]'); check('cheat row inserts', val()=='==高亮重点==', val())
    pg.click('[data-tab=outline]'); ta.fill('# a\n## 二级\n```\n## 代码里的\n```\n### 三级'); ta.dispatch_event('input'); pg.click('[data-tab=keys]'); pg.click('[data-tab=outline]')
    items=pg.locator('.ol-item').all_inner_texts(); check('outline skips fences', items==['a','二级','三级'], items)
    pg.screenshot(path=OUT + '/editor-drawer.png')
    pg.click('#md-drawer-close'); pg.wait_for_timeout(300)

    # draft stash + restore
    ta.fill('草稿内容'); ta.dispatch_event('input'); pg.wait_for_timeout(1900)
    check('stash status', '本机已暂存' in pg.inner_text('#stat-save'), pg.inner_text('#stat-save'))
    pg.evaluate("window.onbeforeunload=null")
    pg2=ctx.new_page(); pg2.goto(BASE + '/editor')
    # different context shares localStorage within same browser context? new_page shares context
    pg2.wait_for_timeout(300); check('draft banner on reload', pg2.is_visible('#draft-banner'))
    pg2.click('#draft-restore'); check('restore', pg2.locator('#content_md').input_value()=='草稿内容'); check('banner hides after restore', not pg2.is_visible('#draft-banner'))
    pg2.close()

    # summary gen
    pg.fill('#summary',''); ta.fill('## 标题\n\n这是**第一段**正文，[链接](http://x.com)。\n\n```\ncode\n```\n'); pg.click('#summary-gen')
    check('summary gen', pg.input_value('#summary')=='标题 这是第一段正文，链接。', pg.input_value('#summary'))

    # focus mode
    pg.click('#tb-focus'); check('focus hides side', not pg.is_visible('.editor-side'))
    pg.keyboard.press('Escape'); check('esc exits focus', pg.is_visible('.editor-side'))

    errs=[e for e in errs if '403' not in e]
    check('no page errors', not errs, errs)
    b.close()
print('FAILS:',fails)
