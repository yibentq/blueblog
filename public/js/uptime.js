// 建站计时——从 SITE_LAUNCH_DATE 到现在的实时时长，纯前端计算，不产生任何请求。
(function () {
  var el = document.getElementById('site-uptime');
  if (!el) return;
  var launch = new Date(el.getAttribute('data-launch'));
  if (isNaN(launch.getTime())) return;

  function render() {
    var diff = Math.max(0, Date.now() - launch.getTime());
    var sec = Math.floor(diff / 1000);
    var days = Math.floor(sec / 86400);
    var hours = Math.floor((sec % 86400) / 3600);
    var mins = Math.floor((sec % 3600) / 60);
    var secs = sec % 60;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    el.textContent = '建站已运行 ' + days + ' 天 ' + pad(hours) + ':' + pad(mins) + ':' + pad(secs);
  }

  render();
  setInterval(render, 1000);
})();
