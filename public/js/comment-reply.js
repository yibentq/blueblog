// 读者回复读者。服务端一直支持 parent_id（src/models/comment.js 的 create() 会校验它是
// 同一篇文章下已通过的评论），前台缺的只是入口：点某条评论上的"回复"，把已有的评论表单
// 原地搬到那条评论下面、把 parent_id 填上，而不是新建一个表单（新建的话，两处的校验、
// 蜜罐字段、字数限制都要再抄一遍，容易漏）。
(function () {
  var form = document.getElementById('comment-form');
  if (!form) return;
  var parentInput = document.getElementById('comment-parent-id');
  var indicator = document.getElementById('comment-replying-to');
  var nameSpan = document.getElementById('comment-replying-name');
  var cancelBtn = document.getElementById('comment-reply-cancel');
  var content = document.getElementById('comment-content');
  var formHome = form.parentNode; // 表单原来的位置：取消回复时搬回这里
  var homeAnchor = document.createComment('comment-form-home');
  formHome.insertBefore(homeAnchor, form);

  function cancel() {
    parentInput.value = '';
    indicator.hidden = true;
    if (form.nextSibling !== null || form.parentNode !== formHome) {
      formHome.insertBefore(form, homeAnchor.nextSibling);
    }
  }

  document.querySelectorAll('.comment-reply-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-reply-to');
      var name = btn.getAttribute('data-reply-name');
      var targetComment = document.querySelector('[data-comment-id="' + id + '"]');
      if (!targetComment) return;
      parentInput.value = id;
      nameSpan.textContent = name;
      indicator.hidden = false;
      // 表单跟着搬到这条评论后面：视觉上"贴着在回复谁"，回复完还在原地不用再滚一次
      targetComment.insertAdjacentElement('afterend', form);
      form.scrollIntoView({ block: 'center', behavior: 'smooth' });
      content.focus();
    });
  });

  cancelBtn.addEventListener('click', cancel);
})();
