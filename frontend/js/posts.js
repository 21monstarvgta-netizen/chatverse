var app_posts = {
  currentUser: null,
  postImageUrl: '',

  init: async function() {
    if (!requireAuth()) return;
    try {
      var data = await apiRequest('/auth/me');
      this.currentUser = data.user;
      this.setupEvents();
      await this.loadPosts();
    } catch (e) { removeToken(); window.location.href = '/login.html'; }
  },

  setupEvents: function() {
    var self = this;
    document.getElementById('back-btn').addEventListener('click', function() { window.location.href = '/'; });
    document.getElementById('new-post-btn').addEventListener('click', function() { document.getElementById('new-post-form').classList.toggle('hidden'); });
    document.getElementById('submit-post-btn').addEventListener('click', function() { self.submitPost(); });
    document.getElementById('post-image-input').addEventListener('change', function(e) { self.uploadPostImage(e); });
    document.getElementById('post-emoji-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      document.getElementById('post-emoji-picker').classList.toggle('hidden');
    });
    // Build emoji picker
    var picker = document.getElementById('post-emoji-picker');
    picker.innerHTML = EMOJI_LIST.map(function(e) { return '<span data-emoji="' + e + '">' + e + '</span>'; }).join('');
    picker.addEventListener('click', function(ev) {
      if (ev.target.dataset.emoji) {
        ev.stopPropagation();
        document.getElementById('post-content').value += ev.target.dataset.emoji;
      }
    });
    document.addEventListener('click', function(e) {
      if (!picker.contains(e.target) && e.target.id !== 'post-emoji-btn') picker.classList.add('hidden');
    });
  },

  loadPosts: async function() {
    try {
      var data = await apiRequest('/posts');
      var list = document.getElementById('posts-list');
      var empty = document.getElementById('posts-empty');
      if (data.posts.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
      empty.classList.add('hidden');
      list.innerHTML = data.posts.map(function(p) { return app_posts.renderPost(p); }).join('');
    } catch (e) { showToast('Ошибка загрузки', 'error'); }
  },

  renderPost: function(post) {
    var isAuthor = post.author._id === this.currentUser._id;
    var amAdmin = this.currentUser.role === 'admin';
    var nameStyle = getNameStyle(post.author);
    var adminBadge = post.author.role === 'admin' ? ' 👑' : '';
    var likesCount = post.likes ? post.likes.length : 0;
    var isLiked = post.likes && post.likes.some(function(l) { return (l._id || l) === app_posts.currentUser._id; });

    var html = '<div class="post-card" data-post-id="' + post._id + '">';
    html += '<div class="post-header"><a href="/user.html?id=' + post.author._id + '" style="text-decoration:none;">' + createMiniAvatarHTML(post.author, 40) + '</a>';
    html += '<div><span style="font-weight:700;' + nameStyle + '">' + escapeHTML(getDisplayName(post.author)) + adminBadge + '</span><br><span style="font-size:11px;color:var(--text-muted);">' + formatTime(post.createdAt) + '</span></div>';
    if (isAuthor || amAdmin) html += '<button class="btn btn-ghost btn-sm" style="margin-left:auto;" onclick="app_posts.deletePost(\'' + post._id + '\')">🗑</button>';
    html += '</div>';
    if (post.emoji) html += '<div style="font-size:32px;margin:8px 0;">' + post.emoji + '</div>';
    html += '<div class="post-content">' + escapeHTML(post.content) + '</div>';
    if (post.imageUrl) html += '<img class="post-image" src="' + post.imageUrl + '" loading="lazy">';
    html += '<div class="post-actions">';
    html += '<button class="btn btn-ghost btn-sm' + (isLiked ? ' liked' : '') + '" onclick="app_posts.likePost(\'' + post._id + '\')">❤️ ' + likesCount + '</button>';
    html += '<button class="btn btn-ghost btn-sm" onclick="app_posts.toggleComments(\'' + post._id + '\')">💬 ' + (post.comments ? post.comments.length : 0) + '</button>';
    html += '</div>';
    // Comments section
    html += '<div class="post-comments hidden" id="comments-' + post._id + '">';
    if (post.comments && post.comments.length) {
      post.comments.forEach(function(c) {
        var cIsAuthor = c.author._id === app_posts.currentUser._id;
        var cIsPostAuthor = post.author._id === app_posts.currentUser._id;
        html += '<div class="post-comment"><span style="font-weight:600;font-size:12px;' + getNameStyle(c.author) + '">' + escapeHTML(getDisplayName(c.author)) + '</span> <span style="font-size:13px;color:var(--text-secondary);">' + escapeHTML(c.content) + '</span>';
        if (cIsAuthor || cIsPostAuthor || amAdmin) html += ' <span class="comment-delete" onclick="app_posts.deleteComment(\'' + post._id + '\',\'' + c._id + '\')">✕</span>';
        html += '</div>';
      });
    }
    html += '<div class="comment-input-row"><input type="text" placeholder="Комментарий..." id="comment-input-' + post._id + '" maxlength="1000"><button class="btn btn-primary btn-sm" onclick="app_posts.addComment(\'' + post._id + '\')">→</button></div>';
    html += '</div></div>';
    return html;
  },

  submitPost: async function() {
    var content = document.getElementById('post-content').value.trim();
    if (!content) { showToast('Введите текст', 'error'); return; }
    try {
      await apiRequest('/posts', { method: 'POST', body: JSON.stringify({ content: content, imageUrl: this.postImageUrl, emoji: '' }) });
      document.getElementById('post-content').value = '';
      this.postImageUrl = '';
      document.getElementById('post-image-preview').classList.add('hidden');
      document.getElementById('new-post-form').classList.add('hidden');
      showToast('Пост опубликован!', 'success');
      await this.loadPosts();
    } catch (e) { showToast(e.message, 'error'); }
  },

  uploadPostImage: async function(e) {
    var file = e.target.files[0];
    if (!file) return;
    try {
      var formData = new FormData();
      formData.append('image', file);
      var response = await fetch(API_URL + '/upload/chat-image', { method: 'POST', headers: { 'Authorization': 'Bearer ' + getToken() }, body: formData });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error);
      this.postImageUrl = data.imageUrl;
      document.getElementById('post-preview-img').src = data.imageUrl;
      document.getElementById('post-image-preview').classList.remove('hidden');
    } catch (err) { showToast(err.message, 'error'); }
    e.target.value = '';
  },

  clearImage: function() { this.postImageUrl = ''; document.getElementById('post-image-preview').classList.add('hidden'); },

  likePost: async function(postId) {
    try { await apiRequest('/posts/' + postId + '/like', { method: 'POST' }); await this.loadPosts(); } catch (e) { showToast(e.message, 'error'); }
  },

  toggleComments: function(postId) {
    var el = document.getElementById('comments-' + postId);
    if (el) el.classList.toggle('hidden');
  },

  addComment: async function(postId) {
    var input = document.getElementById('comment-input-' + postId);
    var content = input.value.trim();
    if (!content) return;
    try { await apiRequest('/posts/' + postId + '/comment', { method: 'POST', body: JSON.stringify({ content: content }) }); input.value = ''; await this.loadPosts(); } catch (e) { showToast(e.message, 'error'); }
  },

  deleteComment: async function(postId, commentId) {
    try { await apiRequest('/posts/' + postId + '/comment/' + commentId, { method: 'DELETE' }); await this.loadPosts(); } catch (e) { showToast(e.message, 'error'); }
  },

  deletePost: async function(postId) {
    if (!confirm('Удалить пост?')) return;
    try { await apiRequest('/posts/' + postId, { method: 'DELETE' }); await this.loadPosts(); } catch (e) { showToast(e.message, 'error'); }
  }
};

document.addEventListener('DOMContentLoaded', function() { app_posts.init(); });