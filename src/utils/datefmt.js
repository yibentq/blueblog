'use strict';

// 站点时区：页面上所有"日期"都按这个时区显示和分组。
//
// 为什么需要（v30 盘点出来的真问题）：之前页面日期是 new Date(x).toISOString().slice(0,10)——这是 UTC 日期。
// 站长在东八区，凌晨 0:00~8:00 发的文章，页面上会显示成"前一天"；
// 首页目录的"年·季度"分组又是数据库按它自己的会话时区算的，跟页面上显示的日期不是同一把尺子，
// 季度交界那天发的文章会出现"日期写着 10.01，却归在第三季度"。
// 现在显示、站点地图年份分组、数据库里的季度分组，全部走同一个时区。
//
// 默认 Asia/Shanghai；想改在 .env 里设 SITE_TIMEZONE（IANA 名，如 Asia/Tokyo、America/New_York）。写错了会退回默认值，不会让站点起不来。
const DEFAULT_TZ = 'Asia/Shanghai';
const TZ = (() => {
  const tz = process.env.SITE_TIMEZONE || DEFAULT_TZ;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return DEFAULT_TZ; }
})();

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function parts(d) {
  const o = {};
  for (const p of fmt.formatToParts(new Date(d))) o[p.type] = p.value;
  return o;
}

const ymd = (d) => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };         // 2026-10-20
const dot = (d) => ymd(d).replace(/-/g, '.');                                              // 2026.10.20
const dateTime = (d) => { const p = parts(d); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; };
const year = (d) => Number(parts(d).year);

module.exports = { TZ, ymd, dot, dateTime, year };
