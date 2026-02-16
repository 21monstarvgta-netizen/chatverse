const API_URL = window.location.origin + '/api';

function getToken() { return localStorage.getItem('chatverse_token'); }
function setToken(token) { localStorage.setItem('chatverse_token', token); }
function removeToken() { localStorage.removeItem('chatverse_token'); localStorage.removeItem('chatverse_user'); }
function getUser() { const u = localStorage.getItem('chatverse_user'); return u ? JSON.parse(u) : null; }
function setUser(user) { localStorage.setItem('chatverse_user', JSON.stringify(user)); }

async function apiRequest(endpoint, options = {}) {
  const token = getToken();
  const headers = { ...(token ? { 'Authorization': 'Bearer ' + token } : {}) };
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const config = { headers, ...options };
  const response = await fetch(API_URL + endpoint, config);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function requireAuth() { if (!getToken()) { window.location.href = '/login.html'; return false; } return true; }

function showToast(message, type) {
  type = type || 'info';
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = '<span>' + (icons[type] || 'ℹ️') + '</span><span>' + message + '</span>';
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('toast-exit'); setTimeout(() => toast.remove(), 300); }, 3000);
}

function getInitials(user) {
  if (user.profile && user.profile.firstName && user.profile.lastName) return (user.profile.firstName[0] + user.profile.lastName[0]).toUpperCase();
  if (user.profile && user.profile.firstName) return user.profile.firstName[0].toUpperCase();
  return user.username ? user.username[0].toUpperCase() : '?';
}

function getDisplayName(user) {
  if (user.profile && (user.profile.firstName || user.profile.lastName)) return [user.profile.firstName, user.profile.lastName].filter(Boolean).join(' ');
  return user.username;
}

function getAvatarColor(user) { return (user.profile && user.profile.avatarColor) || '#6c5ce7'; }

function getAvatarUrl(user) { return (user.profile && user.profile.avatarUrl) || ''; }

function createAvatarHTML(user, size) {
  const sc = size ? ' ' + size : '';
  const avatarUrl = getAvatarUrl(user);
  if (avatarUrl) {
    const sizeMap = { 'large': '80px', 'xl': '120px' };
    const px = sizeMap[size] || '40px';
    const radius = size === 'xl' ? '28px' : size === 'large' ? '20px' : '50%';
    return '<div class="user-avatar' + sc + '" style="background:url(' + avatarUrl + ') center/cover; width:' + px + '; height:' + px + '; border-radius:' + radius + ';"></div>';
  }
  return '<div class="user-avatar' + sc + '" style="background:' + getAvatarColor(user) + '">' + getInitials(user) + '</div>';
}

function createMiniAvatarHTML(user, sizePx) {
  sizePx = sizePx || 36;
  const avatarUrl = getAvatarUrl(user);
  if (avatarUrl) {
    return '<div style="width:' + sizePx + 'px;height:' + sizePx + 'px;border-radius:50%;background:url(' + avatarUrl + ') center/cover;flex-shrink:0;"></div>';
  }
  return '<div style="background:' + getAvatarColor(user) + ';width:' + sizePx + 'px;height:' + sizePx + 'px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:' + Math.round(sizePx * 0.4) + 'px;flex-shrink:0;">' + getInitials(user) + '</div>';
}

function formatTime(dateStr) {
  const date = new Date(dateStr); const now = new Date(); const diff = now - date;
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const time = h + ':' + m;
  if (diff < 86400000 && date.getDate() === now.getDate()) return time;
  if (diff < 172800000) return 'Вчера, ' + time;
  return date.getDate().toString().padStart(2, '0') + '.' + (date.getMonth() + 1).toString().padStart(2, '0') + ' ' + time;
}

function escapeHTML(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

function debounce(func, wait) { let t; return function (...args) { clearTimeout(t); t = setTimeout(() => func.apply(this, args), wait); }; }
// ===== Shopping list HTML =====
function createShoppingListHTML(msg) {
  const list = msg.shoppingList;
  if (!list || !list.items) return '';

  const grouped = {};
  list.items.forEach(item => {
    const cat = item.category || 'Другое';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  });

  let html = '<div class="shopping-list-card">';
  html += '<div class="shopping-list-header">🛒 ' + escapeHTML(list.title) + '</div>';

  const totalItems = list.items.length;
  const boughtItems = list.items.filter(i => i.bought).length;
  html += '<div class="shopping-progress"><div class="shopping-progress-bar" style="width:' + (totalItems > 0 ? Math.round(boughtItems / totalItems * 100) : 0) + '%"></div></div>';
  html += '<div class="shopping-progress-text">' + boughtItems + ' из ' + totalItems + ' куплено</div>';

  for (const cat in grouped) {
    html += '<div class="shopping-category">' + escapeHTML(cat) + '</div>';
    grouped[cat].forEach(item => {
      const checked = item.bought ? 'checked' : '';
      const boughtClass = item.bought ? ' bought' : '';
      const boughtByText = item.bought && item.boughtBy ? ' — ' + escapeHTML(item.boughtBy.username || '') : '';
      html += '<div class="shopping-item' + boughtClass + '" onclick="app.toggleShoppingItem(\'' + msg._id + '\',\'' + item._id + '\')">' +
        '<div class="shopping-checkbox ' + checked + '">' + (item.bought ? '✓' : '') + '</div>' +
        '<span class="shopping-item-name">' + escapeHTML(item.name) + '</span>' +
        '<span class="shopping-bought-by">' + boughtByText + '</span>' +
        '</div>';
    });
  }
  html += '</div>';
  return html;
}

// ===== Dice HTML =====
function createDiceHTML(msg) {
  const d = msg.diceResult;
  if (!d) return '';
  return '<div class="dice-result-card">' +
    '<div class="dice-roll-animation" id="dice-' + msg._id + '">' +
    '<div class="dice-cube">' + d.result + '</div>' +
    '</div>' +
    '<div class="dice-info">' +
    '<span class="dice-type-badge">' + d.diceType.toUpperCase() + '</span>' +
    '<span class="dice-rolled-by">' + escapeHTML(d.rolledBy) + ' бросил кубик</span>' +
    '<span class="dice-result-number">Результат: <strong>' + d.result + '</strong> из ' + d.sides + '</span>' +
    '</div></div>';
}// ===== Sound Notification =====
var notificationSound = null;

function initNotificationSound() {
  try {
    var AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    notificationSound = new AudioContext();
  } catch(e) {}
}

function playNotificationSound() {
  try {
    if (!notificationSound) initNotificationSound();
    if (!notificationSound) return;
    
    var ctx = notificationSound;
    if (ctx.state === 'suspended') ctx.resume();
    
    var oscillator = ctx.createOscillator();
    var gain = ctx.createGain();
    
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    oscillator.frequency.setValueAtTime(880, ctx.currentTime + 0.2);
    
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);
  } catch(e) {}
}

// ===== Save/Restore current view =====
function saveCurrentView(viewId) {
  try { sessionStorage.setItem('chatverse_view', viewId); } catch(e) {}
}

function getSavedView() {
  try { return sessionStorage.getItem('chatverse_view') || 'general'; } catch(e) { return 'general'; }
}