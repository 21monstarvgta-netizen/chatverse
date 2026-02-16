// ===== Profile Page =====

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;

  try {
    const data = await apiRequest('/auth/me');
    const user = data.user;
    
    populateForm(user);
    setupEventListeners(user);
  } catch (error) {
    console.error('Profile load error:', error);
    removeToken();
    window.location.href = '/login.html';
  }
});

function populateForm(user) {
  const p = user.profile || {};

  document.getElementById('firstName').value = p.firstName || '';
  document.getElementById('lastName').value = p.lastName || '';
  document.getElementById('bio').value = p.bio || '';
  document.getElementById('location').value = p.location || '';
  document.getElementById('website').value = p.website || '';
  
  if (p.birthDate) {
    const date = new Date(p.birthDate);
    document.getElementById('birthDate').value = date.toISOString().split('T')[0];
  }

  // Avatar
  const avatarColor = p.avatarColor || '#6c5ce7';
  updateAvatarPreview(user, avatarColor);

  // Color picker
  document.querySelectorAll('.color-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.color === avatarColor);
  });

  // Display name
  updateDisplayNames(user);

  // Banner color
  document.getElementById('profile-banner').style.background = 
    `linear-gradient(135deg, ${avatarColor}, ${shiftColor(avatarColor)})`;
}

function setupEventListeners(user) {
  // Back button
  document.getElementById('back-btn').addEventListener('click', () => {
    window.location.href = '/';
  });

  // Color picker
  document.querySelectorAll('.color-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.color-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      
      const color = opt.dataset.color;
      updateAvatarPreview(user, color);
      document.getElementById('profile-banner').style.background = 
        `linear-gradient(135deg, ${color}, ${shiftColor(color)})`;
    });
  });

  // Live preview of name
  ['firstName', 'lastName'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const fn = document.getElementById('firstName').value;
      const ln = document.getElementById('lastName').value;
      const displayName = [fn, ln].filter(Boolean).join(' ') || user.username;
      document.getElementById('profile-display-name').textContent = displayName;
      
      const letter = fn ? fn[0].toUpperCase() : user.username[0].toUpperCase();
      document.getElementById('profile-avatar-letter').textContent = letter;
    });
  });

  // Save profile
  document.getElementById('save-profile-btn').addEventListener('click', saveProfile);
}

async function saveProfile() {
  const btn = document.getElementById('save-profile-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Сохранение...';

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

    const data = await apiRequest('/users/profile', {
      method: 'PUT',
      body: JSON.stringify(profileData)
    });

    setUser(data.user);
    showToast('Профиль сохранён!', 'success');
    
  } catch (error) {
    showToast(error.message || 'Ошибка сохранения', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Сохранить';
  }
}

function updateAvatarPreview(user, color) {
  const avatar = document.getElementById('profile-avatar');
  avatar.style.background = color;
  
  const fn = document.getElementById('firstName')?.value;
  const letter = fn ? fn[0].toUpperCase() : (user.profile?.firstName?.[0] || user.username[0]).toUpperCase();
  document.getElementById('profile-avatar-letter').textContent = letter;
}

function updateDisplayNames(user) {
  const fn = user.profile?.firstName;
  const ln = user.profile?.lastName;
  const displayName = [fn, ln].filter(Boolean).join(' ') || user.username;
  
  document.getElementById('profile-display-name').textContent = displayName;
  document.getElementById('profile-username').textContent = `@${user.username}`;
}

function shiftColor(hex) {
  // Create a complementary-ish color for gradient
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  
  const nr = Math.min(255, r + 60);
  const ng = Math.min(255, g + 40);
  const nb = Math.min(255, b + 80);
  
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}