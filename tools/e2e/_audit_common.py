"""审计脚本共用：登录 / 打开编辑器。
只在一次性/本机数据库 + 本机起的 node src/app.js（端口 3999）上跑；账号密码是种子里的测试值，不是生产的。
前提见 tools/e2e/README.md 末尾"沙箱里的实测记录"：起一次性 Postgres，跑 seed-showcase.js，再起应用。
每次运行会登录一次后台——登录有限流，连续跑很多次会被 429，重启应用即可清零。
"""
from playwright.sync_api import sync_playwright
import json, sys
def login(pg):
    pg.goto('http://127.0.0.1:3999/admin/login'); pg.fill('#username','admin'); pg.fill('#password','Passw0rd-test-123'); pg.click('button[type=submit]'); pg.wait_for_load_state()
def new_editor(pg):
    pg.goto('http://127.0.0.1:3999/admin/posts/new'); pg.wait_for_selector('textarea#content_md, textarea[name=content_md]')
    return pg.locator('textarea[name=content_md]')
def val(ta): return ta.input_value()
