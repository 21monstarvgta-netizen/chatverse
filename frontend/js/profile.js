document.addEventListener('DOMContentLoaded', async function() {
  if (!requireAuth()) return;
  try {
    var data = await apiRequest('/auth/me');
    var user = data.user;
    populateForm(user);
    setupEventListeners(user);
  } catch (e) { removeToken(); window.location.href = '/login.html'; }
});

function populateForm(user) {
  var p = user.profile || {};
  document.getElementById('firstName').value = p.firstName || '';
  document.getElementById('lastName').value = p.lastName || '';
  document.getElementById('bio').value = p.bio || '';
  document.getElementById('location').value = p.location || '';
  document.getElementById('website').value = p.website || '';
  document.getElementById('statusEmoji').value = p.statusEmoji || '';
  document.getElementById('statusText').value = p.statusText || '';
  document.getElementById('bannerColor1').value = p.bannerColor1 || '#6c5ce7';
  document.getElementById('bannerColor2').value = p.bannerColor2 || '#a29bfe';
  document.getElementById('nameColor').value = p.nameColor || '#ffffff';
  document.getElementById('nameGlow').checked = !!p.nameGlow;
  if (p.birthDate) document.getElementById('birthDate').value = new Date(p.birthDate).toISOString().split('T')[0];
  var avatarColor = p.avatarColor || '#6c5ce7';
  document.querySelectorAll('.color-option').forEach(function(opt) { opt.classList.toggle('active', opt.dataset.color === avatarColor); });
  updateDisplayNames(user);
  updateAvatarPreview(user);
  updateBanner();
}

function updateBanner() {
  var c1 = document.getElementById('bannerColor1').value;
  var c2 = document.getElementById('bannerColor2').value;
  document.getElementById('profile-banner').style.background = 'linear-gradient(135deg,' + c1 + ',' + c2 + ')';
}

function setupEventListeners(user) {
  document.getElementById('back-btn').addEventListener('click', function() { window.location.href = '/'; });
  document.getElementById('bannerColor1').addEventListener('input', updateBanner);
  document.getElementById('bannerColor2').addEventListener('input', updateBanner);

  document.querySelectorAll('.color-option').forEach(function(opt) {
    opt.addEventListener('click', function() {
      document.querySelectorAll('.color-option').forEach(function(o) { o.classList.remove('active'); });
      opt.classList.add('active');
      if (!getAvatarUrl(user)) document.getElementById('profile-avatar').style.background = opt.dataset.color;
    });
  });

  ['firstName', 'lastName'].forEach(function(id) {
    document.getElementById(id).addEventListener('input', function() {
      var fn = document.getElementById('firstName').value;
      var ln = document.getElementById('lastName').value;
      document.getElementById('profile-display-name').textContent = [fn, ln].filter(Boolean).join(' ') || user.username;
      if (!getAvatarUrl(user)) document.getElementById('profile-avatar-letter').textContent = fn ? fn[0].toUpperCase() : user.username[0].toUpperCase();
    });
  });

  document.getElementById('save-profile-btn').addEventListener('click', saveProfile);

  document.getElementById('avatar-upload-input').addEventListener('change', async function(e) {
    var file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Макс. 5MB', 'error'); return; }
    var btn = document.getElementById('avatar-upload-btn');
    btn.textContent = '⏳ Загрузка...'; btn.disabled = true;
    try {
      var formData = new FormData();
      formData.append('avatar', file);
      var response = await fetch(API_URL + '/upload/avatar', { method: 'POST', headers: { 'Authorization': 'Bearer ' + getToken() }, body: formData });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error);
      user.profile.avatarUrl = data.avatarUrl;
      setUser(data.user);
      updateAvatarPreview(data.user);
      showToast('Аватар обновлён!', 'success');
    } catch (err) { showToast(err.message || 'Ошибка загрузки', 'error'); }
    finally { btn.textContent = '📷 Загрузить фото'; btn.disabled = false; e.target.value = ''; }
  });

  document.getElementById('avatar-delete-btn').addEventListener('click', async function() {
    if (!confirm('Удалить аватар?')) return;
    try {
      var data = await apiRequest('/upload/avatar', { method: 'DELETE' });
      user.profile.avatarUrl = '';
      setUser(data.user);
      updateAvatarPreview(data.user);
      showToast('Аватар удалён', 'info');
    } catch (err) { showToast(err.message, 'error'); }
  });
}

function updateAvatarPreview(user) {
  var avatar = document.getElementById('profile-avatar');
  var letterEl = document.getElementById('profile-avatar-letter');
  var avatarUrl = getAvatarUrl(user);
  var deleteBtn = document.getElementById('avatar-delete-btn');
  if (avatarUrl) {
    avatar.style.background = 'url(' + avatarUrl + ') center/cover';
    letterEl.textContent = '';
    deleteBtn.classList.remove('hidden');
  } else {
    avatar.style.background = (user.profile && user.profile.avatarColor) || '#6c5ce7';
    var fn = document.getElementById('firstName') ? document.getElementById('firstName').value : '';
    letterEl.textContent = fn ? fn[0].toUpperCase() : (user.profile && user.profile.firstName ? user.profile.firstName[0] : user.username[0]).toUpperCase();
    deleteBtn.classList.add('hidden');
  }
}

async function saveProfile() {
  var btn = document.getElementById('save-profile-btn');
  btn.disabled = true; btn.textContent = '⏳ Сохранение...';
  try {
    var activeColor = document.querySelector('.color-option.active');
    var profileData = {
      firstName: document.getElementById('firstName').value.trim(),
      lastName: document.getElementById('lastName').value.trim(),
      bio: document.getElementById('bio').value.trim(),
      location: document.getElementById('location').value.trim(),
      website: document.getElementById('website').value.trim(),
      birthDate: document.getElementById('birthDate').value || null,
      avatarColor: activeColor ? activeColor.dataset.color : '#6c5ce7',
      statusEmoji: document.getElementById('statusEmoji').value.trim(),
      statusText: document.getElementById('statusText').value.trim(),
      bannerColor1: document.getElementById('bannerColor1').value,
      bannerColor2: document.getElementById('bannerColor2').value,
      nameGlow: document.getElementById('nameGlow').checked,
      nameColor: document.getElementById('nameColor').value
    };
    var data = await apiRequest('/users/profile', { method: 'PUT', body: JSON.stringify(profileData) });
    setUser(data.user);
    showToast('Профиль сохранён!', 'success');
  } catch (e) { showToast(e.message || 'Ошибка', 'error'); }
  finally { btn.disabled = false; btn.textContent = '💾 Сохранить'; }
}

function updateDisplayNames(user) {
  var fn = user.profile ? user.profile.firstName : '';
  var ln = user.profile ? user.profile.lastName : '';
  document.getElementById('profile-display-name').textContent = [fn, ln].filter(Boolean).join(' ') || user.username;
  document.getElementById('profile-username').textContent = '@' + user.username;
}