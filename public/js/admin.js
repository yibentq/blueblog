// 编辑器辅助脚本：图片上传后把 Markdown 图片语法插入到光标位置。
// 没有依赖任何前端框架——这个后台只有站长一个人用，没必要为此引入 build 工具链。
document.addEventListener('DOMContentLoaded', function () {
  var fileInput = document.getElementById('image-upload-input');
  var uploadBtn = document.getElementById('image-upload-btn');
  var textarea = document.getElementById('content_md');
  var status = document.getElementById('upload-status');
  var csrfToken = document.querySelector('input[name="_csrf"]').value;

  if (!uploadBtn) return;

  uploadBtn.addEventListener('click', function () {
    fileInput.click();
  });

  fileInput.addEventListener('change', function () {
    var file = fileInput.files[0];
    if (!file) return;
    var formData = new FormData();
    formData.append('image', file);
    formData.append('_csrf', csrfToken);
    status.textContent = '上传中…';
    fetch('/admin/upload', { method: 'POST', body: formData })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          status.textContent = '上传失败：' + data.error;
          return;
        }
        var snippet = '![](' + data.url + ')\n';
        var pos = textarea.selectionStart || textarea.value.length;
        textarea.value = textarea.value.slice(0, pos) + snippet + textarea.value.slice(pos);
        status.textContent = '已插入：' + data.url;
        fileInput.value = '';
      })
      .catch(function () {
        status.textContent = '上传失败，检查网络或文件大小';
      });
  });

  // 标题变化时，如果 slug 输入框还是空的，给一个建议值（仍可手动覆盖）
  var titleInput = document.getElementById('title');
  var slugInput = document.getElementById('slug');
  if (titleInput && slugInput) {
    titleInput.addEventListener('blur', function () {
      if (!slugInput.value.trim() && titleInput.value.trim()) {
        slugInput.placeholder = '留空将自动生成';
      }
    });
  }
});
