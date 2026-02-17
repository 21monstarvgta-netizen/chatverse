const API_URL = window.location.origin + '/api';

function getToken() { return localStorage.getItem('chatverse_token'); }
function setToken(token) { localStorage.setItem('chatverse_token', token); }
function removeToken() { localStorage.removeItem('chatverse_token'); localStorage.removeItem('chatverse_user'); }
function getUser() { var u = localStorage.getItem('chatverse_user'); return u ? JSON.parse(u) : null; }
function setUser(user) { localStorage.setItem('chatverse_user', JSON.stringify(user)); }

async function apiRequest(endpoint, options) {
  options = options || {};
  var token = getToken();
  var headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  options.headers = Object.assign(headers, options.headers || {});
  var response = await fetch(API_URL + endpoint, options);
  var data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function requireAuth() { if (!getToken()) { window.location.href = '/login.html'; return false; } return true; }

function showToast(message, type) {
  type = type || 'info';
  var container = document.getElementById('toast-container');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  var icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = '<span>' + (icons[type] || 'ℹ️') + '</span><span>' + message + '</span>';
  container.appendChild(toast);
  setTimeout(function() { toast.classList.add('toast-exit'); setTimeout(function() { toast.remove(); }, 300); }, 3000);
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
function isAdmin(user) { return user && user.role === 'admin'; }

function getNameStyle(user) {
  var color = (user.profile && user.profile.nameColor) || getAvatarColor(user);
  var glow = user.profile && user.profile.nameGlow;
  var style = 'color:' + color + ';';
  if (glow) style += 'text-shadow:0 0 8px ' + color + ',0 0 16px ' + color + ';';
  if (isAdmin(user)) style += 'text-shadow:0 0 10px gold,0 0 20px gold;';
  return style;
}

function createAvatarHTML(user, size) {
  var sc = size ? ' ' + size : '';
  var avatarUrl = getAvatarUrl(user);
  if (avatarUrl) {
    var sizeMap = { 'large': '80px', 'xl': '120px' };
    var px = sizeMap[size] || '40px';
    var radius = size === 'xl' ? '28px' : size === 'large' ? '20px' : '50%';
    return '<div class="user-avatar' + sc + '" style="background:url(' + avatarUrl + ') center/cover;width:' + px + ';height:' + px + ';border-radius:' + radius + ';"></div>';
  }
  return '<div class="user-avatar' + sc + '" style="background:' + getAvatarColor(user) + '">' + getInitials(user) + '</div>';
}

function createMiniAvatarHTML(user, sizePx) {
  sizePx = sizePx || 36;
  var avatarUrl = getAvatarUrl(user);
  if (avatarUrl) {
    return '<div style="width:' + sizePx + 'px;height:' + sizePx + 'px;border-radius:50%;background:url(' + avatarUrl + ') center/cover;flex-shrink:0;"></div>';
  }
  return '<div style="background:' + getAvatarColor(user) + ';width:' + sizePx + 'px;height:' + sizePx + 'px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:' + Math.round(sizePx * 0.4) + 'px;flex-shrink:0;">' + getInitials(user) + '</div>';
}

function formatTime(dateStr) {
  var date = new Date(dateStr); var now = new Date(); var diff = now - date;
  var h = date.getHours().toString().padStart(2, '0');
  var m = date.getMinutes().toString().padStart(2, '0');
  var time = h + ':' + m;
  if (diff < 86400000 && date.getDate() === now.getDate()) return time;
  if (diff < 172800000) return 'Вчера, ' + time;
  return date.getDate().toString().padStart(2, '0') + '.' + (date.getMonth() + 1).toString().padStart(2, '0') + ' ' + time;
}

function escapeHTML(str) { if (!str) return ''; var d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function debounce(func, wait) { var t; return function() { var args = arguments; var ctx = this; clearTimeout(t); t = setTimeout(function() { func.apply(ctx, args); }, wait); }; }

function createShoppingListHTML(msg) {
  var list = msg.shoppingList;
  if (!list || !list.items) return '';
  var grouped = {};
  list.items.forEach(function(item) { var cat = item.category || 'Другое'; if (!grouped[cat]) grouped[cat] = []; grouped[cat].push(item); });
  var html = '<div class="shopping-list-card"><div class="shopping-list-header">🛒 ' + escapeHTML(list.title) + '</div>';
  var totalItems = list.items.length;
  var boughtItems = list.items.filter(function(i) { return i.bought; }).length;
  html += '<div class="shopping-progress"><div class="shopping-progress-bar" style="width:' + (totalItems > 0 ? Math.round(boughtItems / totalItems * 100) : 0) + '%"></div></div>';
  html += '<div class="shopping-progress-text">' + boughtItems + ' из ' + totalItems + ' куплено</div>';
  for (var cat in grouped) {
    html += '<div class="shopping-category">' + escapeHTML(cat) + '</div>';
    grouped[cat].forEach(function(item) {
      var checked = item.bought ? 'checked' : '';
      var boughtClass = item.bought ? ' bought' : '';
      var boughtByText = item.bought && item.boughtBy ? ' — ' + escapeHTML(item.boughtBy.username || '') : '';
      html += '<div class="shopping-item' + boughtClass + '" onclick="app.toggleShoppingItem(\'' + msg._id + '\',\'' + item._id + '\')"><div class="shopping-checkbox ' + checked + '">' + (item.bought ? '✓' : '') + '</div><span class="shopping-item-name">' + escapeHTML(item.name) + '</span><span class="shopping-bought-by">' + boughtByText + '</span></div>';
    });
  }
  html += '</div>';
  return html;
}

function createDiceHTML(msg) {
  var d = msg.diceResult;
  if (!d) return '';
  return '<div class="dice-result-card"><div class="dice-roll-animation"><div class="dice-cube">' + d.result + '</div></div><div class="dice-info"><span class="dice-type-badge">' + d.diceType.toUpperCase() + '</span><span class="dice-rolled-by">' + escapeHTML(d.rolledBy) + ' бросил кубик</span><span class="dice-result-number">Результат: <strong>' + d.result + '</strong> из ' + d.sides + '</span></div></div>';
}

function createForwardedHTML(msg) {
  var f = msg.forwarded;
  if (!f) return '';
  var originalName = f.originalSender ? getDisplayName(f.originalSender) : 'Неизвестный';
  var originalDate = f.originalDate ? formatTime(f.originalDate) : '';
  return '<div class="forwarded-header">↗️ Переслано от <strong>' + escapeHTML(originalName) + '</strong> из <em>' + escapeHTML(f.originalRoom) + '</em> <span class="msg-time">' + originalDate + '</span></div>' +
    (msg.imageUrl ? '<img class="msg-image" src="' + msg.imageUrl + '" onclick="app.openImageFullscreen(\'' + msg.imageUrl + '\')" loading="lazy">' : '') +
    (msg.content ? '<div class="msg-text">' + escapeHTML(msg.content) + '</div>' : '');
}

// Sound
var notificationSound = null;
function initNotificationSound() {
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    notificationSound = new AC();
  } catch(e) {}
}

function playNotificationSound() {
  try {
    if (!notificationSound) initNotificationSound();
    if (!notificationSound) return;
    var ctx = notificationSound;
    if (ctx.state === 'suspended') ctx.resume();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch(e) {}
}

function saveCurrentView(viewId) { try { sessionStorage.setItem('chatverse_view', viewId); } catch(e) {} }
function getSavedView() { try { return sessionStorage.getItem('chatverse_view') || 'general'; } catch(e) { return 'general'; } }