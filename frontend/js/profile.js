document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;
  try {
    const data = await apiRequest('/auth/me');
    const user = data.user;
    populateForm(user);
    setupEventListeners(user);
  } catch (e) { console.error(e); removeToken(); window.location.href = '/login.html'; }
});

function populateForm(user) {
  const p = user.profile || {};
  document.getElementById('firstName').value = p.firstName || '';
  document.getElementById('lastName').value = p.lastName || '';
  document.getElementById('bio').value = p.bio || '';
  document.getElementById('location').value = p.location || '';
  document.getElementById('website').value = p.website || '';
  if (p.birthDate) { document.getElementById('birthDate').value = new Date(p.birthDate).toISOString().split('T')[0]; }
  const avatarColor = p.avatarColor || '#6c5ce7';
  document.querySelectorAll('.color-option').forEach(opt => opt.classList.toggle('active', opt.dataset.color === avatarColor));
  updateDisplayNames(user);
  updateAvatarPreview(user);
  document.getElementById('profile-banner').style.background = 'linear-gradient(135deg,' + avatarColor + ',' + shiftColor(avatarColor) + ')';
}

function setupEventListeners(user) {
  document.getElementById('back-btn').addEventListener('click', () => { window.location.href = '/'; });

  document.querySelectorAll('.color-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.color-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      const color = opt.dataset.color;
      document.getElementById('profile-banner').style.background = 'linear-gradient(135deg,' + color + ',' + shiftColor(color) + ')';
      // Update avatar bg color only if no photo
      const avatarUrl = getAvatarUrl(user);
      if (!avatarUrl) {
        document.getElementById('profile-avatar').style.background = color;
      }
    });
  });

  ['firstName', 'lastName'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const fn = document.getElementById('firstName').value;
      const ln = document.getElementById('lastName').value;
      document.getElementById('profile-display-name').textContent = [fn, ln].filter(Boolean).join(' ') || user.username;
      if (!getAvatarUrl(user)) {
        document.getElementById('profile-avatar-letter').textContent = fn ? fn[0].toUpperCase() : user.username[0].toUpperCase();
      }
    });
  });

  document.getElementById('save-profile-btn').addEventListener('click', saveProfile);

  // Avatar upload
  document.getElementById('avatar-upload-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Макс. размер 5MB', 'error'); return; }

    const btn = document.getElementById('avatar-upload-btn');
    btn.textContent = '⏳ Загрузка...';
    btn.disabled = true;

    try {
      const formData = new FormData();
      formData.append('avatar', file);

      const response = await fetch(API_URL + '/upload/avatar', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + getToken() },
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      user.profile.avatarUrl = data.avatarUrl;
      setUser(data.user);
      updateAvatarPreview(data.user);
      showToast('Аватар обновлён!', 'success');
    } catch (err) {
      showToast(err.message || 'Ошибка загрузки', 'error');
    } finally {
      btn.textContent = '📷 Загрузить фото';
      btn.disabled = false;
      e.target.value = '';
    }
  });

  // Delete avatar
  document.getElementById('avatar-delete-btn').addEventListener('click', async () => {
    if (!confirm('Удалить аватар?')) return;
    try {
      const data = await apiRequest('/upload/avatar', { method: 'DELETE' });
      user.profile.avatarUrl = '';
      setUser(data.user);
      updateAvatarPreview(data.user);
      showToast('Аватар удалён', 'info');
    } catch (err) {
      showToast(err.message || 'Ошибка', 'error');
    }
  });
}

function updateAvatarPreview(user) {
  const avatar = document.getElementById('profile-avatar');
  const letterEl = document.getElementById('profile-avatar-letter');
  const avatarUrl = getAvatarUrl(user);
  const deleteBtn = document.getElementById('avatar-delete-btn');

  if (avatarUrl) {
    avatar.style.background = 'url(' + avatarUrl + ') center/cover';
    letterEl.textContent = '';
    deleteBtn.classList.remove('hidden');
  } else {
    const color = (user.profile && user.profile.avatarColor) || '#6c5ce7';
    avatar.style.background = color;
    const fn = document.getElementById('firstName') ? document.getElementById('firstName').value : '';
    letterEl.textContent = fn ? fn[0].toUpperCase() : (user.profile && user.profile.firstName ? user.profile.firstName[0] : user.username[0]).toUpperCase();
    deleteBtn.classList.add('hidden');
  }
}

async function saveProfile() {
  const btn = document.getElementById('save-profile-btn');
  btn.disabled = true; btn.textContent = '⏳ Сохранение...';
  try {
    const activeColor = document.querySelector('.color-option.active');
    const profileData = {
      firstName: document.getElementById('firstName').value.trim(),
      lastName: document.getElementById('lastName').value.trim(),
      bio: document.getElementById('bio').value.trim(),
      location: document.getElementById('location').value.trim(),
      website: document.getElementById('website').value.trim(),
      birthDate: document.getElementById('birthDate').value || null,
      avatarColor: activeColor ? activeColor.dataset.color : '#6c5ce7'
    };
    const data = await apiRequest('/users/profile', { method: 'PUT', body: JSON.stringify(profileData) });
    setUser(data.user);
    showToast('Профиль сохранён!', 'success');
  } catch (e) { showToast(e.message || 'Ошибка', 'error'); }
  finally { btn.disabled = false; btn.textContent = '💾 Сохранить'; }
}

function updateDisplayNames(user) {
  const fn = user.profile ? user.profile.firstName : '';
  const ln = user.profile ? user.profile.lastName : '';
  document.getElementById('profile-display-name').textContent = [fn, ln].filter(Boolean).join(' ') || user.username;
  document.getElementById('profile-username').textContent = '@' + user.username;
}

function shiftColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return '#' + Math.min(255, r + 60).toString(16).padStart(2, '0') + Math.min(255, g + 40).toString(16).padStart(2, '0') + Math.min(255, b + 80).toString(16).padStart(2, '0');
}