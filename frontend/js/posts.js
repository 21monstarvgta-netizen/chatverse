var postsApp = {
  currentUser: null,
  postImageUrl: '',

  init: async function() {
    var token = getToken();
    if (!token) {
      window.location.href = '/login.html';
      return;
    }
    try {
      var data = await apiRequest('/auth/me');
      if (!data || !data.user) {
        window.location.href = '/login.html';
        return;
      }
      this.currentUser = data.user;
      this.setupEvents();
      this.buildEmojiPicker();
      await this.loadPosts();
    } catch (e) {
      console.error('Posts init error:', e);
      // Не удаляем токен, просто показываем ошибку
      showToast('Ошибка загрузки: ' + (e.message || ''), 'error');
    }
  },

  setupEvents: function() {
    var self = this;
    document.getElementById('back-btn').addEventListener('click', function() {
      window.location.href = '/';
    });
    document.getElementById('new-post-btn').addEventListener('click', function() {
      document.getElementById('new-post-form').classList.toggle('hidden');
    });
    document.getElementById('submit-post-btn').addEventListener('click', function() {
      self.submitPost();
    });
    document.getElementById('post-image-input').addEventListener('change', function(e) {
      self.uploadPostImage(e);
    });
    document.getElementById('post-emoji-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      document.getElementById('post-emoji-picker').classList.toggle('hidden');
    });
    document.addEventListener('click', function(e) {
      var picker = document.getElementById('post-emoji-picker');
      if (!picker.contains(e.target) && e.target.id !== 'post-emoji-btn') {
        picker.classList.add('hidden');
      }
    });
  },

  buildEmojiPicker: function() {
    var picker = document.getElementById('post-emoji-picker');
    // Используем встроенный список если EMOJI_LIST недоступен
    var emojis = [
      '😀','😂','😊','😍','🥰','😎','🤗','😇','😋','🤤','😜','🤪',
      '😝','🤑','🤩','🥳','😢','😭','😤','😡','🤬','😱','😰','😥',
      '🤔','🤫','🤭','🙄','😏','😌','😴','🥱',
      '👍','👎','👌','✌️','🤞','🤝','👏','🙌','💪','🙏',
      '❤️','🧡','💛','💚','💙','💜','🖤','💔','💯','💥','🔥','⭐','🌟','✨',
      '🎉','🎊','🎁','🎂','🍕','🍔','☕','🍺',
      '📱','💻','🎮','🎵','🎬','📚'
    ];
    try {
      if (typeof EMOJI_LIST !== 'undefined' && EMOJI_LIST.length > 0) {
        emojis = EMOJI_LIST;
      }
    } catch(e) {}

    picker.innerHTML = emojis.map(function(e) {
      return '<span data-emoji="' + e + '">' + e + '</span>';
    }).join('');
    picker.addEventListener('click', function(ev) {
      if (ev.target.dataset.emoji) {
        ev.stopPropagation();
        var input = document.getElementById('post-content');
        input.value += ev.target.dataset.emoji;
        input.focus();
      }
    });
  },

  loadPosts: async function() {
    try {
      var data = await apiRequest('/posts');
      var list = document.getElementById('posts-list');
      var empty = document.getElementById('posts-empty');
      if (!data.posts || data.posts.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
      }
      empty.classList.add('hidden');
      var self = this;
      list.innerHTML = data.posts.map(function(p) { return self.renderPost(p); }).join('');
    } catch (e) {
      showToast('Ошибка загрузки постов', 'error');
      console.error(e);
    }
  },

  renderPost: function(post) {
    if (!post.author) return '';
    var isAuthor = post.author._id === this.currentUser._id;
    var amAdmin = this.currentUser.role === 'admin';
    var nameStyle = getNameStyle(post.author);
    var adminBadge = post.author.role === 'admin' ? ' 👑' : '';
    var likesCount = post.likes ? post.likes.length : 0;
    var myId = this.currentUser._id;
    var isLiked = post.likes && post.likes.some(function(l) {
      return (l._id || l) === myId;
    });
    var commentsCount = post.comments ? post.comments.length : 0;

    var html = '<div class="post-card" data-post-id="' + post._id + '">';

    // Header
    html += '<div class="post-header">';
    html += '<a href="/user.html?id=' + post.author._id + '" style="text-decoration:none;">' + createMiniAvatarHTML(post.author, 40) + '</a>';
    html += '<div style="flex:1;"><span style="font-weight:700;' + nameStyle + '">' + escapeHTML(getDisplayName(post.author)) + adminBadge + '</span>';
    html += '<br><span style="font-size:11px;color:var(--text-muted);">' + formatTime(post.createdAt) + '</span></div>';
    if (isAuthor || amAdmin) {
      html += '<button class="btn btn-ghost btn-sm" onclick="postsApp.deletePost(\'' + post._id + '\')">🗑</button>';
    }
    html += '</div>';

    // Content
    if (post.emoji) html += '<div style="font-size:32px;margin:8px 0;">' + post.emoji + '</div>';
    html += '<div class="post-content">' + escapeHTML(post.content) + '</div>';
    if (post.imageUrl) html += '<img class="post-image" src="' + post.imageUrl + '" loading="lazy">';

    // Actions
    html += '<div class="post-actions">';
    html += '<button class="btn btn-ghost btn-sm' + (isLiked ? ' liked' : '') + '" onclick="postsApp.likePost(\'' + post._id + '\')">❤️ ' + likesCount + '</button>';
    html += '<button class="btn btn-ghost btn-sm" onclick="postsApp.toggleComments(\'' + post._id + '\')">💬 ' + commentsCount + '</button>';
    html += '</div>';

    // Comments (collapsed)
    html += '<div class="post-comments hidden" id="comments-' + post._id + '">';
    if (post.comments && post.comments.length) {
      var self = this;
      post.comments.forEach(function(c) {
        if (!c.author) return;
        var cIsAuthor = c.author._id === myId;
        var cIsPostAuthor = post.author._id === myId;
        var cNameStyle = getNameStyle(c.author);
        html += '<div class="post-comment">';
        html += '<span style="font-weight:600;font-size:12px;' + cNameStyle + '">' + escapeHTML(getDisplayName(c.author)) + '</span> ';
        html += '<span style="font-size:13px;color:var(--text-secondary);">' + escapeHTML(c.content) + '</span>';
        html += ' <span style="font-size:10px;color:var(--text-muted);">' + formatTime(c.createdAt) + '</span>';
        if (cIsAuthor || cIsPostAuthor || amAdmin) {
          html += ' <span class="comment-delete" onclick="postsApp.deleteComment(\'' + post._id + '\',\'' + c._id + '\')">✕</span>';
        }
        html += '</div>';
      });
    }
    html += '<div class="comment-input-row">';
    html += '<input type="text" placeholder="Комментарий..." id="comment-input-' + post._id + '" maxlength="1000" onkeydown="if(event.key===\'Enter\'){event.preventDefault();postsApp.addComment(\'' + post._id + '\');}">';
    html += '<button class="btn btn-primary btn-sm" onclick="postsApp.addComment(\'' + post._id + '\')">→</button>';
    html += '</div>';
    html += '</div>';

    html += '</div>';
    return html;
  },

  submitPost: async function() {
    var content = document.getElementById('post-content').value.trim();
    if (!content) { showToast('Введите текст', 'error'); return; }
    try {
      await apiRequest('/posts', {
        method: 'POST',
        body: JSON.stringify({ content: content, imageUrl: this.postImageUrl, emoji: '' })
      });
      document.getElementById('post-content').value = '';
      this.postImageUrl = '';
      document.getElementById('post-image-preview').classList.add('hidden');
      document.getElementById('new-post-form').classList.add('hidden');
      showToast('Пост опубликован!', 'success');
      await this.loadPosts();
    } catch (e) { showToast(e.message || 'Ошибка', 'error'); }
  },

  uploadPostImage: async function(e) {
    var file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast('Макс. 10MB', 'error'); return; }
    showToast('Загрузка...', 'info');
    try {
      var formData = new FormData();
      formData.append('image', file);
      var response = await fetch(API_URL + '/upload/chat-image', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + getToken() },
        body: formData
      });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error);
      this.postImageUrl = data.imageUrl;
      document.getElementById('post-preview-img').src = data.imageUrl;
      document.getElementById('post-image-preview').classList.remove('hidden');
      showToast('Фото загружено', 'success');
    } catch (err) { showToast(err.message || 'Ошибка', 'error'); }
    e.target.value = '';
  },

  clearImage: function() {
    this.postImageUrl = '';
    document.getElementById('post-image-preview').classList.add('hidden');
  },

  likePost: async function(postId) {
    try {
      await apiRequest('/posts/' + postId + '/like', { method: 'POST' });
      await this.loadPosts();
    } catch (e) { showToast(e.message, 'error'); }
  },

  toggleComments: function(postId) {
    var el = document.getElementById('comments-' + postId);
    if (el) el.classList.toggle('hidden');
  },

  addComment: async function(postId) {
    var input = document.getElementById('comment-input-' + postId);
    if (!input) return;
    var content = input.value.trim();
    if (!content) return;
    try {
      await apiRequest('/posts/' + postId + '/comment', {
        method: 'POST',
        body: JSON.stringify({ content: content })
      });
      input.value = '';
      await this.loadPosts();
      // Re-open comments
      setTimeout(function() {
        var el = document.getElementById('comments-' + postId);
        if (el) el.classList.remove('hidden');
      }, 100);
    } catch (e) { showToast(e.message, 'error'); }
  },

  deleteComment: async function(postId, commentId) {
    if (!confirm('Удалить комментарий?')) return;
    try {
      await apiRequest('/posts/' + postId + '/comment/' + commentId, { method: 'DELETE' });
      await this.loadPosts();
      setTimeout(function() {
        var el = document.getElementById('comments-' + postId);
        if (el) el.classList.remove('hidden');
      }, 100);
    } catch (e) { showToast(e.message, 'error'); }
  },

  deletePost: async function(postId) {
    if (!confirm('Удалить пост?')) return;
    try {
      await apiRequest('/posts/' + postId, { method: 'DELETE' });
      showToast('Пост удалён', 'success');
      await this.loadPosts();
    } catch (e) { showToast(e.message, 'error'); }
  }
};

document.addEventListener('DOMContentLoaded', function() {
  postsApp.init();
});