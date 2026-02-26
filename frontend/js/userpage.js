document.addEventListener('DOMContentLoaded', async function() {
  if (!requireAuth()) return;
  var params = new URLSearchParams(window.location.search);
  var userId = params.get('id');
  if (!userId) { window.history.back(); return; }

  try {
    var meData = await apiRequest('/auth/me');
    var currentUser = meData.user;

    var data = await apiRequest('/users/' + userId);
    var user = data.user;
    var p = user.profile || {};

    // Banner
    var c1 = p.bannerColor1 || p.avatarColor || '#6c5ce7';
    var c2 = p.bannerColor2 || '#a29bfe';
    document.getElementById('user-banner').style.background = 'linear-gradient(135deg,' + c1 + ',' + c2 + ')';

    // Avatar
    var avatar = document.getElementById('user-avatar');
    var letterEl = document.getElementById('user-avatar-letter');
    if (p.avatarUrl) {
      avatar.style.background = 'url(' + p.avatarUrl + ') center/cover';
      letterEl.textContent = '';
    } else {
      avatar.style.background = p.avatarColor || '#6c5ce7';
      letterEl.textContent = getInitials(user);
    }

    document.getElementById('user-display-name').textContent = getDisplayName(user);
    document.getElementById('user-display-name').style.cssText = getNameStyle(user);
    document.getElementById('user-username').textContent = '@' + user.username;

    // Role badge
    if (user.role === 'admin') {
      document.getElementById('user-role-badge').innerHTML = '<span class="admin-badge" style="font-size:13px;">👑 Администратор</span>';
    }

    // Custom status
    if (p.statusEmoji || p.statusText) {
      document.getElementById('user-status-custom').textContent = (p.statusEmoji || '') + ' ' + (p.statusText || '');
    }

    // Bio
    document.getElementById('user-bio').textContent = p.bio || '';

    // Details
    var details = '';
    if (user.status === 'online') details += '<div class="detail-item"><span>🟢</span><span>Онлайн</span></div>';
    else details += '<div class="detail-item"><span>⚫</span><span>Был(а) ' + formatTime(user.lastSeen) + '</span></div>';
    if (p.location) details += '<div class="detail-item"><span>📍</span><span>' + escapeHTML(p.location) + '</span></div>';
    if (p.birthDate) details += '<div class="detail-item"><span>🎂</span><span>' + new Date(p.birthDate).toLocaleDateString('ru-RU') + '</span></div>';
    if (p.website) details += '<div class="detail-item"><span>🔗</span><a href="' + escapeHTML(p.website) + '" target="_blank" style="color:var(--primary-light);">' + escapeHTML(p.website) + '</a></div>';
    document.getElementById('user-details').innerHTML = details;

    // Admin actions
    if (currentUser.role === 'admin' && user._id !== currentUser._id) {
      var actions = '';
      if (user.role !== 'admin') {
        actions += '<button class="btn btn-danger btn-sm" onclick="adminAction(\'ban\',\'' + user._id + '\')">🔨 Забанить</button>';
        actions += '<button class="btn btn-secondary btn-sm" onclick="adminAction(\'admin\',\'' + user._id + '\')">👑 Сделать админом</button>';
        actions += '<button class="btn btn-danger btn-sm" onclick="adminAction(\'delete\',\'' + user._id + '\')">🗑 Удалить профиль</button>';
      } else {
        actions += '<button class="btn btn-secondary btn-sm" onclick="adminAction(\'removeadmin\',\'' + user._id + '\')">Снять админку</button>';
      }
      document.getElementById('admin-user-actions').innerHTML = actions;
    }

    // Currency editor — only for @YasheNJO
    if (currentUser.username === 'YasheNJO' && user._id !== currentUser._id) {
      var currencyHtml =
        '<div id="currency-editor" style="margin-top:20px;padding:16px;background:rgba(255,255,255,0.04);border-radius:12px;border:1px solid rgba(255,255,255,0.1);">' +
        '<h4 style="margin:0 0 12px;font-size:14px;color:#a78bfa;">🪙 Редактировать валюту (@' + escapeHTML(user.username) + ')</h4>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">' +
        '<select id="currency-type" style="padding:6px 10px;border-radius:8px;background:#1e2535;color:#fff;border:1px solid rgba(255,255,255,0.12);font-size:13px;">' +
        '<option value="coins">🪙 Монеты</option>' +
        '<option value="food">🍞 Еда</option>' +
        '<option value="materials">🪨 Материалы</option>' +
        '<option value="energy">⚡ Энергия</option>' +
        '<option value="crystals">💎 Кристаллы</option>' +
        '</select>' +
        '<input id="currency-amount" type="number" min="0" placeholder="Кол-во" value="1000" ' +
        'style="width:100px;padding:6px 10px;border-radius:8px;background:#1e2535;color:#fff;border:1px solid rgba(255,255,255,0.12);font-size:13px;">' +
        '<button class="btn btn-primary btn-sm" onclick="setCurrency(\'' + escapeHTML(user.username) + '\')">Установить</button>' +
        '</div></div>';
      document.querySelector('.profile-body').insertAdjacentHTML('beforeend', currencyHtml);
    }

    // Load user posts
    try {
      var postsData = await apiRequest('/posts/user/' + userId);
      var postsList = document.getElementById('user-posts-list');
      if (postsData.posts.length === 0) {
        postsList.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Нет постов</p>';
      } else {
        postsList.innerHTML = postsData.posts.map(function(post) {
          var likesCount = post.likes ? post.likes.length : 0;
          return '<div class="post-card-mini"><div class="post-content">' + escapeHTML(post.content) + '</div>' +
            (post.imageUrl ? '<img src="' + post.imageUrl + '" style="max-width:100%;max-height:200px;border-radius:8px;margin-top:8px;" loading="lazy">' : '') +
            '<div style="font-size:11px;color:var(--text-muted);margin-top:6px;">❤️ ' + likesCount + ' · 💬 ' + (post.comments ? post.comments.length : 0) + ' · ' + formatTime(post.createdAt) + '</div></div>';
        }).join('');
      }
    } catch (e) {}

  } catch (e) {
    showToast('Пользователь не найден', 'error');
  }

  document.getElementById('back-btn').addEventListener('click', function() { window.history.back(); });
});

async function adminAction(action, userId) {
  try {
    if (action === 'ban') {
      var reason = prompt('Причина бана:');
      if (reason === null) return;
      await apiRequest('/users/admin/ban/' + userId, { method: 'POST', body: JSON.stringify({ reason: reason }) });
      showToast('Забанен', 'success');
    } else if (action === 'admin') {
      await apiRequest('/users/admin/role/' + userId, { method: 'POST', body: JSON.stringify({ role: 'admin' }) });
      showToast('Роль изменена', 'success');
    } else if (action === 'removeadmin') {
      await apiRequest('/users/admin/role/' + userId, { method: 'POST', body: JSON.stringify({ role: 'user' }) });
      showToast('Роль изменена', 'success');
    } else if (action === 'delete') {
      if (!confirm('Удалить аккаунт пользователя навсегда?')) return;
      await apiRequest('/users/admin/delete/' + userId, { method: 'DELETE' });
      showToast('Удалён', 'success');
      window.location.href = '/';
    }
    location.reload();
  } catch (e) { showToast(e.message, 'error'); }
}

async function setCurrency(username) {
  try {
    var currency = document.getElementById('currency-type').value;
    var amount   = parseInt(document.getElementById('currency-amount').value);
    if (isNaN(amount) || amount < 0) { showToast('Неверное количество', 'error'); return; }
    var data = await apiRequest('/game/admin/set-currency', {
      method: 'POST',
      body: JSON.stringify({ username: username, currency: currency, amount: amount })
    });
    showToast(data.message || 'Готово!', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}
