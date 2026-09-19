// 编辑器辅助脚本：
// 上传和插入是两步分开的——上传完成的图片进入下面的"图片列表"，
// 用户自己把光标点到正文里想要的位置，再点某张图的"插入到光标处"，
// 才会真正写进 Markdown。不在上传的同时自动帮用户决定插入位置。
document.addEventListener('DOMContentLoaded', function () {
  var fileInput = document.getElementById('image-upload-input');
  var uploadBtn = document.getElementById('image-upload-btn');
  var textarea = document.getElementById('content_md');
  var status = document.getElementById('upload-status');
  var gallery = document.getElementById('image-gallery');
  var csrfInput = document.querySelector('input[name="_csrf"]');

  if (!uploadBtn || !textarea) return;

  var csrfToken = csrfInput ? csrfInput.value : '';
  var maxMb = Number(fileInput.getAttribute('data-max-mb')) || 8;
  var lastCaretPos = textarea.value.length; // 光标位置的兜底值：文本末尾

  // 只要用户在正文里点过/打过字，就记下当前光标位置——
  // 之后不管点上传按钮还是点"插入"，都用这个记下来的位置，而不是当下这一刻（那一刻焦点早就不在 textarea 上了）
  ['click', 'keyup', 'select'].forEach(function (evt) {
    textarea.addEventListener(evt, function () {
      lastCaretPos = textarea.selectionStart;
    });
  });

  function setStatus(text, isError) {
    status.textContent = text;
    status.style.color = isError ? 'var(--a-danger)' : 'var(--a-text-dim)';
  }

  function insertAtCaret(snippet) {
    var pos = Math.min(lastCaretPos, textarea.value.length);
    textarea.value = textarea.value.slice(0, pos) + snippet + textarea.value.slice(pos);
    var newPos = pos + snippet.length;
    textarea.focus();
    textarea.setSelectionRange(newPos, newPos);
    lastCaretPos = newPos;
  }

  function addToGallery(url, name) {
    var item = document.createElement('div');
    item.className = 'gallery-item';

    var thumb = document.createElement('img');
    thumb.src = url;
    thumb.alt = name || '';
    item.appendChild(thumb);

    var label = document.createElement('span');
    label.className = 'gallery-name mono';
    label.textContent = name || url;
    item.appendChild(label);

    var insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'btn secondary';
    insertBtn.style.cssText = 'padding:0.3rem 0.6rem;font-size:0.72rem';
    insertBtn.textContent = '插入到光标处';
    insertBtn.addEventListener('click', function () {
      insertAtCaret('![](' + url + ')\n');
      setStatus('已插入：' + url, false);
    });
    item.appendChild(insertBtn);

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn secondary';
    copyBtn.style.cssText = 'padding:0.3rem 0.6rem;font-size:0.72rem';
    copyBtn.textContent = '复制链接';
    copyBtn.addEventListener('click', function () {
      navigator.clipboard.writeText(location.origin + url).then(function () {
        setStatus('链接已复制', false);
      });
    });
    item.appendChild(copyBtn);

    gallery.prepend(item);
  }

  uploadBtn.addEventListener('click', function () {
    fileInput.click();
  });

  fileInput.addEventListener('change', function () {
    var file = fileInput.files[0];
    if (!file) return;

    // 先在前端拦一次大小——不用等一次完整上传失败才知道超限
    var maxBytes = maxMb * 1024 * 1024;
    if (file.size > maxBytes) {
      setStatus('文件太大（' + (file.size / 1024 / 1024).toFixed(1) + 'MB），最大允许 ' + maxMb + 'MB', true);
      fileInput.value = '';
      return;
    }

    var formData = new FormData();
    formData.append('image', file);
    formData.append('_csrf', csrfToken);
    setStatus('上传中…', false);

    fetch('/admin/upload', { method: 'POST', body: formData })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok || result.data.error) {
          setStatus('上传失败：' + (result.data.error || '未知错误'), true);
          return;
        }
        addToGallery(result.data.url, result.data.name);
        setStatus('上传成功，点下面的"插入到光标处"把它放进正文', false);
        fileInput.value = '';
      })
      .catch(function () {
        setStatus('上传失败，检查网络连接', true);
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
