// ===== Utility Functions =====

const API_URL = window.location.origin + '/api';

// Token management
function getToken() {
  return localStorage.getItem('chatverse_token');
}

function setToken(token) {
  localStorage.setItem('chatverse_token', token);
}

function removeToken() {
  localStorage.removeItem('chatverse_token');
  localStorage.removeItem('chatverse_user');
}

function getUser() {
  const user = localStorage.getItem('chatverse_user');
  return user ? JSON.parse(user) : null;
}

function setUser(user) {
  localStorage.setItem('chatverse_user', JSON.stringify(user));
}

// API helper
async function apiRequest(endpoint, options = {}) {
  const token = getToken();
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    ...options
  };

  const response = await fetch(`${API_URL}${endpoint}`, config);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }

  return data;
}

// Check auth
function requireAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

function redirectIfAuth() {
  const token = getToken();
  if (token) {
    window.location.href = '/';
    return true;
  }
  return false;
}

// Toast notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Avatar helpers
function getInitials(user) {
  if (user.profile?.firstName && user.profile?.lastName) {
    return (user.profile.firstName[0] + user.profile.lastName[0]).toUpperCase();
  }
  if (user.profile?.firstName) {
    return user.profile.firstName[0].toUpperCase();
  }
  return user.username ? user.username[0].toUpperCase() : '?';
}

function getDisplayName(user) {
  if (user.profile?.firstName || user.profile?.lastName) {
    return [user.profile.firstName, user.profile.lastName].filter(Boolean).join(' ');
  }
  return user.username;
}

function getAvatarColor(user) {
  return user.profile?.avatarColor || '#6c5ce7';
}

function createAvatarHTML(user, size = '') {
  const sizeClass = size ? ` ${size}` : '';
  return `<div class="user-avatar${sizeClass}" style="background: ${getAvatarColor(user)}">${getInitials(user)}</div>`;
}

// Time formatting
function formatTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;
  
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const time = `${hours}:${minutes}`;
  
  if (diff < 86400000 && date.getDate() === now.getDate()) {
    return time;
  }
  
  if (diff < 172800000) {
    return `Вчера, ${time}`;
  }
  
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${day}.${month} ${time}`;
}

// Escape HTML
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Debounce
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}