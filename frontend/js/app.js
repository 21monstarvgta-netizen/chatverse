// ChatApp v3.1 — Fixed: multi-select messages, unpin, posts button
var app;

var EMOJI_LIST = ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾','🙈','🙉','🙊','💋','💌','💘','💝','💖','💗','💓','💞','💕','💟','❣️','💔','❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','💯','💢','💥','💫','💦','💨','🕳️','💣','💬','👁️‍🗨️','🗨️','🗯️','💭','💤','👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄'];

var ADMIN_EMOJI = ['⚡','🔥','✨','💎','👑','🏆','🌟','💫','🎯','🎪'];

var DICE_TYPES = [
  { id: 'd4', name: 'D4', sides: 4, emoji: '🎲' },
  { id: 'd6', name: 'D6', sides: 6, emoji: '🎲' },
  { id: 'd8', name: 'D8', sides: 8, emoji: '🎲' },
  { id: 'd10', name: 'D10', sides: 10, emoji: '🎲' },
  { id: 'd12', name: 'D12', sides: 12, emoji: '🎲' },
  { id: 'd20', name: 'D20', sides: 20, emoji: '🎲' },
  { id: 'd100', name: 'D100', sides: 100, emoji: '🎲' }
];

var SHOPPING_CATEGORIES = {
  'Фрукты и овощи': ['Яблоки','Бананы','Апельсины','Картофель','Морковь','Помидоры','Огурцы','Лук','Чеснок','Капуста','Перец','Салат','Зелень','Виноград','Клубника'],
  'Молочные': ['Молоко','Сметана','Творог','Йогурт','Кефир','Масло сливочное','Сыр','Ряженка'],
  'Мясо и рыба': ['Курица','Говядина','Свинина','Фарш','Сосиски','Колбаса','Рыба','Креветки','Икра'],
  'Хлеб и выпечка': ['Хлеб белый','Хлеб чёрный','Булочки','Батон','Лаваш','Печенье','Торт'],
  'Крупы и макароны': ['Гречка','Рис','Овсянка','Макароны','Перловка','Пшено','Манка'],
  'Напитки': ['Вода','Сок','Газировка','Чай','Кофе','Пиво','Вино'],
  'Сладости': ['Шоколад','Конфеты','Мороженое','Варенье','Мёд','Зефир'],
  'Другое': ['Яйца','Соль','Сахар','Мука','Масло растительное','Специи','Соус','Консервы']
};

function ChatApp() {
  this.currentUser = null;
  this.socket = null;
  this.currentView = 'general';
  this.onlineUsers = [];
  this.typingUsers = new Map();
  this.typingTimeout = null;
  this.isTyping = false;
  this.selectedShoppingItems = [];
  this.unreadCounts = {};
  this.messagesCache = {};
  this.roomsCache = {};
  this.editingMessageId = null;
  this.pinnedMessages = {};
  this.selectedMessages = new Set(); // NEW: for multi-select
  this.selectionMode = false; // NEW: track if in selection mode
  this.init();
};

ChatApp.prototype.init = async function() {
  if (!requireAuth()) return;
  try {
    var data = await apiRequest('/auth/me');
    this.currentUser = data.user;
    setUser(data.user);
    initNotificationSound();
    this.initSocket();
    this.setupUI();
    this.setupEventListeners();
    await this.loadRooms();
    var savedView = getSavedView();
    if (savedView !== 'general' && this.roomsCache[savedView]) {
      await this.switchView(savedView);
    } else {
      await this.loadGeneralMessages();
    }
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('chat-app').classList.remove('hidden');
    document.addEventListener('click', function() {
      if (notificationSound && notificationSound.state === 'suspended') notificationSound.resume();
    }, { once: true });
  } catch (error) {
    removeToken();
    window.location.href = '/login.html';
  }
};

ChatApp.prototype.initSocket = function() {
  this.socket = io(window.location.origin, {
    auth: { token: getToken() },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });

  var self = this;

  this.socket.on('connect', function() { console.log('Socket connected'); });

  this.socket.on('general:message', function(msg) {
    if (self.currentView === 'general') {
      self.appendMessage(msg);
    } else {
      self.unreadCounts['general'] = (self.unreadCounts['general'] || 0) + 1;
      self.updateUnreadBadges();
    }
    if (msg.sender && msg.sender._id !== self.currentUser._id) playNotificationSound();
  });

  this.socket.on('room:message', function(data) {
    if (self.currentView === data.roomId) {
      self.appendMessage(data.message);
    } else {
      self.unreadCounts[data.roomId] = (self.unreadCounts[data.roomId] || 0) + 1;
      self.updateUnreadBadges();
    }
    if (data.message.sender && data.message.sender._id !== self.currentUser._id) playNotificationSound();
  });

  this.socket.on('users:online', function(users) { self.onlineUsers = users; self.renderOnlineUsers(); });

  this.socket.on('typing:start', function(data) {
    var tv = data.roomId || 'general';
    if (self.currentView === tv && data.userId !== self.currentUser._id) {
      self.typingUsers.set(data.userId, data.username);
      self.renderTyping();
    }
  });
  this.socket.on('typing:stop', function(data) { self.typingUsers.delete(data.userId); self.renderTyping(); });

  this.socket.on('shopping:update', function(data) {
    var targetView = data.roomId || 'general';
    if (self.currentView === targetView) {
      var el = document.querySelector('[data-msg-id="' + data.messageId + '"]');
      if (el) {
        var body = el.querySelector('.msg-body');
        if (body) body.innerHTML = createShoppingListHTML(data.message);
      }
    }
  });

  this.socket.on('message:edited', function(data) {
    var targetView = data.roomId || 'general';
    if (self.currentView === targetView) {
      var el = document.querySelector('[data-msg-id="' + data.messageId + '"]');
      if (el) {
        var body = el.querySelector('.msg-body');
        if (body) {
          body.innerHTML = '<div class="msg-text">' + escapeHTML(data.message.content) + '</div><span class="msg-edited">(изменено ' + formatTime(data.message.editedAt) + ')</span>';
        }
      }
    }
  });

  this.socket.on('message:deleted', function(data) {
    var targetView = data.roomId || 'general';
    if (self.currentView === targetView) {
      var el = document.querySelector('[data-msg-id="' + data.messageId + '"]');
      if (el) el.remove();
    }
    // Remove from selection if in multi-select
    if (self.selectedMessages.has(data.messageId)) {
      self.selectedMessages.delete(data.messageId);
      self.updateSelectionUI();
    }
  });

  this.socket.on('message:pinned', function(data) {
    var targetView = data.roomId || 'general';
    if (self.currentView === targetView) {
      // FIXED: Reload pinned messages AND update the message UI
      self.loadPinnedMessages();
      // Update the pin indicator on the message
      var el = document.querySelector('[data-msg-id="' + data.messageId + '"]');
      if (el) {
        var pinIndicator = el.querySelector('.pin-indicator');
        if (data.pinned) {
          if (!pinIndicator) {
            var header = el.querySelector('.msg-header');
            if (header) {
              var pin = document.createElement('span');
              pin.className = 'pin-indicator';
              pin.title = 'Закреплено';
              pin.textContent = '📌';
              header.insertBefore(pin, header.firstChild);
            }
          }
        } else {
          if (pinIndicator) pinIndicator.remove();
        }
      }
    }
  });

  this.socket.on('room:new', async function(room) {
    self.socket.emit('room:join', room._id);
    await self.loadRooms();
    showToast('Вас добавили в "' + room.name + '"', 'info');
    playNotificationSound();
  });

  this.socket.on('banned', function(data) {
    alert('Вы заблокированы: ' + (data.reason || ''));
    removeToken();
    window.location.href = '/login.html';
  });

  this.socket.on('account:deleted', function() {
    alert('Ваш аккаунт удалён администратором');
    removeToken();
    window.location.href = '/login.html';
  });

  this.socket.on('error', function(data) { showToast(data.message, 'error'); });
};

ChatApp.prototype.setupUI = function() {
  this.renderSidebarProfile();
  this.buildEmojiPicker();
  this.buildDicePicker();
  this.buildShoppingModal();
};

ChatApp.prototype.setupEventListeners = function() {
  var self = this;
  document.getElementById('send-btn').addEventListener('click', function() { self.sendMessage(); });
  var msgInput = document.getElementById('message-input');
  msgInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); self.sendMessage(); }
  });
  msgInput.addEventListener('input', function() {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
    self.handleTyping();
  });

  document.getElementById('nav-general').addEventListener('click', function() { self.switchView('general'); });
  document.getElementById('btn-profile').addEventListener('click', function(e) { 
    e.stopPropagation(); // FIXED: prevent event bubbling
    window.location.href = '/profile.html'; 
  });
  document.getElementById('btn-posts').addEventListener('click', function(e) { 
    e.stopPropagation(); // FIXED: prevent event bubbling that was causing logout
    window.location.href = '/posts.html'; 
  });
  document.getElementById('btn-logout').addEventListener('click', function(e) {
    e.stopPropagation();
    if (self.socket) self.socket.disconnect();
    removeToken();
    window.location.href = '/login.html';
  });
  document.getElementById('mobile-menu-btn').addEventListener('click', function() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('show');
  });
  document.getElementById('sidebar-overlay').addEventListener('click', function() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
  });

  document.getElementById('btn-create-room').addEventListener('click', function() { self.openCreateRoomModal(); });
  document.getElementById('close-create-room').addEventListener('click', function() { self.closeModal('create-room-modal'); });
  document.getElementById('cancel-create-room').addEventListener('click', function() { self.closeModal('create-room-modal'); });
  document.getElementById('confirm-create-room').addEventListener('click', function() { self.createRoom(); });
  document.getElementById('close-room-info').addEventListener('click', function() { self.closeModal('room-info-modal'); });
  document.getElementById('close-add-member').addEventListener('click', function() { self.closeModal('add-member-modal'); });
  document.getElementById('cancel-add-member').addEventListener('click', function() { self.closeModal('add-member-modal'); });
  document.getElementById('confirm-add-member').addEventListener('click', function() { self.addMembersToRoom(); });
  document.getElementById('member-search').addEventListener('input', debounce(function(e) {
    self.searchUsersForRoom(e.target.value, 'members-checkbox-list');
  }, 300));
  document.getElementById('add-member-search').addEventListener('input', debounce(function(e) {
    self.searchUsersForAddMember(e.target.value);
  }, 300));

  document.getElementById('btn-emoji').addEventListener('click', function(e) {
    e.stopPropagation();
    document.getElementById('emoji-picker').classList.toggle('hidden');
    document.getElementById('dice-picker').classList.add('hidden');
  });
  document.getElementById('btn-dice').addEventListener('click', function(e) {
    e.stopPropagation();
    document.getElementById('dice-picker').classList.toggle('hidden');
    document.getElementById('emoji-picker').classList.add('hidden');
  });
  document.getElementById('btn-shopping').addEventListener('click', function() { self.openShoppingModal(); });
  document.getElementById('image-input').addEventListener('change', function(e) { self.handleImageUpload(e); });
  document.getElementById('btn-image').addEventListener('click', function() { document.getElementById('image-input').click(); });

  document.getElementById('close-shopping').addEventListener('click', function() { self.closeModal('shopping-modal'); });
  document.getElementById('cancel-shopping').addEventListener('click', function() { self.closeModal('shopping-modal'); });
  document.getElementById('confirm-shopping').addEventListener('click', function() { self.sendShoppingList(); });
  document.getElementById('add-custom-item-btn').addEventListener('click', function() { self.addCustomItem(); });
  document.getElementById('custom-item-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); self.addCustomItem(); }
  });

  document.getElementById('close-forward').addEventListener('click', function() { self.closeModal('forward-modal'); });
  document.getElementById('cancel-forward').addEventListener('click', function() { self.closeModal('forward-modal'); });
  document.getElementById('close-image-fullscreen').addEventListener('click', function() { self.closeModal('image-fullscreen'); });
  document.getElementById('cancel-edit').addEventListener('click', function() { self.cancelEdit(); });

  document.getElementById('search-input').addEventListener('input', debounce(function(e) {
    self.searchMessages(e.target.value);
  }, 300));

  document.addEventListener('click', function(e) {
    if (!e.target.closest('#emoji-picker') && !e.target.closest('#btn-emoji')) {
      document.getElementById('emoji-picker').classList.add('hidden');
    }
    if (!e.target.closest('#dice-picker') && !e.target.closest('#btn-dice')) {
      document.getElementById('dice-picker').classList.add('hidden');
    }
    if (!e.target.closest('#msg-context-menu')) {
      document.getElementById('msg-context-menu').classList.add('hidden');
    }
  });

  // NEW: Multi-select button
  var multiSelectBtn = document.createElement('button');
  multiSelectBtn.id = 'btn-multi-select';
  multiSelectBtn.className = 'toolbar-btn';
  multiSelectBtn.title = 'Выбрать несколько';
  multiSelectBtn.textContent = '☑️';
  multiSelectBtn.addEventListener('click', function() { self.toggleSelectionMode(); });
  document.querySelector('.chat-toolbar').appendChild(multiSelectBtn);

  // Long press for mobile
  var longPressTimer;
  document.getElementById('messages-container').addEventListener('touchstart', function(e) {
    var msgEl = e.target.closest('.message');
    if (!msgEl || msgEl.classList.contains('system-message')) return;
    longPressTimer = setTimeout(function() {
      var msgId = msgEl.dataset.msgId;
      if (msgId) self.showContextMenu(e, msgId);
    }, 500);
  });
  document.getElementById('messages-container').addEventListener('touchend', function() {
    clearTimeout(longPressTimer);
  });
  document.getElementById('messages-container').addEventListener('touchmove', function() {
    clearTimeout(longPressTimer);
  });
};

// NEW: Multi-select mode
ChatApp.prototype.toggleSelectionMode = function() {
  this.selectionMode = !this.selectionMode;
  var btn = document.getElementById('btn-multi-select');
  
  if (this.selectionMode) {
    btn.classList.add('active');
    btn.textContent = '✖️';
    btn.title = 'Отменить выбор';
    this.showSelectionToolbar();
  } else {
    btn.classList.remove('active');
    btn.textContent = '☑️';
    btn.title = 'Выбрать несколько';
    this.selectedMessages.clear();
    this.hideSelectionToolbar();
    this.updateSelectionUI();
  }
};

ChatApp.prototype.showSelectionToolbar = function() {
  var existing = document.getElementById('selection-toolbar');
  if (existing) return;
  
  var toolbar = document.createElement('div');
  toolbar.id = 'selection-toolbar';
  toolbar.className = 'selection-toolbar';
  toolbar.innerHTML = '<div class="selection-count"><span id="selection-count">0</span> выбрано</div>' +
    '<button class="btn btn-danger btn-sm" onclick="app.deleteSelectedMessages()">🗑️ Удалить</button>' +
    '<button class="btn btn-primary btn-sm" onclick="app.forwardSelectedMessages()">↗️ Переслать</button>';
  document.querySelector('.chat-main').insertBefore(toolbar, document.querySelector('.chat-input'));
};

ChatApp.prototype.hideSelectionToolbar = function() {
  var toolbar = document.getElementById('selection-toolbar');
  if (toolbar) toolbar.remove();
};

ChatApp.prototype.toggleMessageSelection = function(messageId, event) {
  if (event) event.stopPropagation();
  
  if (!this.selectionMode) {
    // If not in selection mode, show context menu instead
    if (event) this.showContextMenu(event, messageId);
    return;
  }
  
  if (this.selectedMessages.has(messageId)) {
    this.selectedMessages.delete(messageId);
  } else {
    this.selectedMessages.add(messageId);
  }
  
  this.updateSelectionUI();
};

ChatApp.prototype.updateSelectionUI = function() {
  var self = this;
  document.querySelectorAll('.message').forEach(function(el) {
    var msgId = el.dataset.msgId;
    if (!msgId || el.classList.contains('system-message')) return;
    
    if (self.selectionMode) {
      el.classList.add('selectable');
      if (self.selectedMessages.has(msgId)) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    } else {
      el.classList.remove('selectable', 'selected');
    }
  });
  
  var countEl = document.getElementById('selection-count');
  if (countEl) countEl.textContent = this.selectedMessages.size;
};

ChatApp.prototype.deleteSelectedMessages = async function() {
  if (this.selectedMessages.size === 0) return;
  if (!confirm('Удалить выбранные сообщения (' + this.selectedMessages.size + ')?')) return;
  
  try {
    var promises = Array.from(this.selectedMessages).map(function(msgId) {
      return apiRequest('/messages/delete/' + msgId, { method: 'DELETE' });
    });
    await Promise.all(promises);
    showToast('Сообщения удалены', 'success');
    this.toggleSelectionMode();
  } catch (e) {
    showToast(e.message, 'error');
  }
};

ChatApp.prototype.forwardSelectedMessages = function() {
  if (this.selectedMessages.size === 0) return;
  if (this.selectedMessages.size > 10) {
    showToast('Можно переслать максимум 10 сообщений', 'error');
    return;
  }
  
  this.forwardMessageIds = Array.from(this.selectedMessages);
  this.openForwardModalMultiple();
};

ChatApp.prototype.openForwardModalMultiple = function() {
  var self = this;
  var html = '<div class="forward-target" onclick="app.forwardMultipleTo(null)"><span>🌍</span> Общий чат</div>';
  Object.keys(this.roomsCache).forEach(function(rid) {
    var r = self.roomsCache[rid];
    html += '<div class="forward-target" onclick="app.forwardMultipleTo(\'' + rid + '\')"><span style="color:' + (r.color || '#6c5ce7') + '">●</span> ' + escapeHTML(r.name) + '</div>';
  });
  document.getElementById('forward-targets').innerHTML = html;
  document.getElementById('forward-modal').classList.remove('hidden');
};

ChatApp.prototype.forwardMultipleTo = async function(targetRoomId) {
  try {
    var promises = this.forwardMessageIds.map(function(msgId) {
      return apiRequest('/messages/forward/' + msgId, { 
        method: 'POST', 
        body: JSON.stringify({ targetRoomId: targetRoomId }) 
      });
    });
    await Promise.all(promises);
    showToast('Сообщения пересланы!', 'success');
    this.closeModal('forward-modal');
    this.toggleSelectionMode();
  } catch (e) {
    showToast(e.message, 'error');
  }
};

// Emoji
ChatApp.prototype.buildEmojiPicker = function() {
  var self = this;
  var allEmojis = EMOJI_LIST.slice();
  if (isAdmin(this.currentUser)) allEmojis = ADMIN_EMOJI.concat(allEmojis);
  document.getElementById('emoji-picker').innerHTML = allEmojis.map(function(e) {
    return '<span data-emoji="' + e + '">' + e + '</span>';
  }).join('');
  document.getElementById('emoji-picker').addEventListener('click', function(ev) {
    if (ev.target.dataset.emoji) {
      ev.stopPropagation();
      self.insertEmoji(ev.target.dataset.emoji);
    }
  });
};
ChatApp.prototype.insertEmoji = function(emoji) {
  var input = document.getElementById('message-input');
  input.value += emoji;
  input.focus();
};

// Dice
ChatApp.prototype.buildDicePicker = function() {
  var self = this;
  document.getElementById('dice-picker').innerHTML = '<div class="dice-picker-title">Бросить кубик</div>' +
    DICE_TYPES.map(function(d) {
      return '<div class="dice-option" data-dice="' + d.id + '"><span class="dice-emoji">' + d.emoji + '</span><span class="dice-label">' + d.name + '</span><span class="dice-range">1-' + d.sides + '</span></div>';
    }).join('');
  document.getElementById('dice-picker').addEventListener('click', function(ev) {
    var opt = ev.target.closest('.dice-option');
    if (opt) self.rollDice(opt.dataset.dice);
  });
};
ChatApp.prototype.rollDice = function(diceType) {
  this.socket.emit('dice:roll', { diceType: diceType, roomId: this.currentView === 'general' ? null : this.currentView });
  document.getElementById('dice-picker').classList.add('hidden');
};

// Image
ChatApp.prototype.handleImageUpload = async function(e) {
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
    this.socket.emit('image:message', {
      imageUrl: data.imageUrl, content: '',
      roomId: this.currentView === 'general' ? null : this.currentView
    });
    showToast('Отправлено!', 'success');
  } catch (err) { showToast(err.message || 'Ошибка', 'error'); }
  e.target.value = '';
};

// Shopping
ChatApp.prototype.buildShoppingModal = function() {
  var html = '';
  for (var cat in SHOPPING_CATEGORIES) {
    html += '<div class="shopping-cat-group"><div class="shopping-cat-title" onclick="this.nextElementSibling.classList.toggle(\'open\')">▶ ' + cat + '</div><div class="shopping-cat-items">';
    SHOPPING_CATEGORIES[cat].forEach(function(item) {
      html += '<div class="shopping-product-tag" data-item="' + escapeHTML(item) + '" data-cat="' + escapeHTML(cat) + '">' + escapeHTML(item) + '</div>';
    });
    html += '</div></div>';
  }
  document.getElementById('shopping-categories').innerHTML = html;
  var self = this;
  document.getElementById('shopping-categories').addEventListener('click', function(ev) {
    var tag = ev.target.closest('.shopping-product-tag');
    if (tag) self.toggleShoppingProduct(tag, tag.dataset.item, tag.dataset.cat);
  });
};
ChatApp.prototype.openShoppingModal = function() {
  this.selectedShoppingItems = [];
  document.getElementById('shopping-title-input').value = 'Список покупок';
  document.getElementById('custom-item-input').value = '';
  document.querySelectorAll('.shopping-product-tag').forEach(function(t) { t.classList.remove('selected'); });
  this.renderSelectedItems();
  document.getElementById('shopping-modal').classList.remove('hidden');
};
ChatApp.prototype.toggleShoppingProduct = function(el, name, category) {
  var idx = this.selectedShoppingItems.findIndex(function(i) { return i.name === name; });
  if (idx >= 0) { this.selectedShoppingItems.splice(idx, 1); el.classList.remove('selected'); }
  else { this.selectedShoppingItems.push({ name: name, category: category }); el.classList.add('selected'); }
  this.renderSelectedItems();
};
ChatApp.prototype.addCustomItem = function() {
  var input = document.getElementById('custom-item-input');
  var val = input.value.trim();
  if (!val) return;
  if (this.selectedShoppingItems.some(function(i) { return i.name === val; })) {
    showToast('Уже добавлено', 'error');
    return;
  }
  this.selectedShoppingItems.push({ name: val, category: 'Другое' });
  this.renderSelectedItems();
  input.value = '';
};
ChatApp.prototype.renderSelectedItems = function() {
  var self = this;
  var container = document.getElementById('selected-items-preview');
  if (this.selectedShoppingItems.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px;">Выберите товары</div>';
    return;
  }
  container.innerHTML = this.selectedShoppingItems.map(function(item, idx) {
    return '<div class="selected-item-tag">' + escapeHTML(item.name) + ' <span onclick="app.removeSelectedItem(' + idx + ')">✕</span></div>';
  }).join('');
};
ChatApp.prototype.removeSelectedItem = function(idx) {
  var item = this.selectedShoppingItems[idx];
  this.selectedShoppingItems.splice(idx, 1);
  var tag = document.querySelector('.shopping-product-tag[data-item="' + item.name + '"]');
  if (tag) tag.classList.remove('selected');
  this.renderSelectedItems();
};
ChatApp.prototype.sendShoppingList = function() {
  var title = document.getElementById('shopping-title-input').value.trim() || 'Список покупок';
  if (this.selectedShoppingItems.length === 0) {
    showToast('Добавьте товары', 'error');
    return;
  }
  this.socket.emit('shopping:create', {
    title: title,
    items: this.selectedShoppingItems,
    roomId: this.currentView === 'general' ? null : this.currentView
  });
  this.closeModal('shopping-modal');
  showToast('Список отправлен!', 'success');
};

ChatApp.prototype.toggleShoppingItem = async function(messageId, itemId) {
  try {
    await apiRequest('/messages/shopping/' + messageId + '/toggle/' + itemId, { method: 'POST' });
  } catch (e) { console.error(e); }
};

// Messages
ChatApp.prototype.loadGeneralMessages = async function() {
  try {
    var data = await apiRequest('/messages/general');
    this.messagesCache['general'] = data.messages;
    this.renderMessages(data.messages);
    this.loadPinnedMessages();
  } catch (e) { console.error(e); }
};
ChatApp.prototype.loadRoomMessages = async function(roomId) {
  if (this.messagesCache[roomId]) this.renderMessages(this.messagesCache[roomId]);
  try {
    var data = await apiRequest('/messages/room/' + roomId);
    this.messagesCache[roomId] = data.messages;
    this.renderMessages(data.messages);
    this.loadPinnedMessages();
  } catch (e) { showToast('Ошибка загрузки', 'error'); }
};

ChatApp.prototype.loadPinnedMessages = async function() {
  try {
    var endpoint = this.currentView === 'general' ? '/messages/pinned/general' : '/messages/pinned/' + this.currentView;
    var data = await apiRequest(endpoint);
    var bar = document.getElementById('pinned-bar');
    if (data.messages && data.messages.length > 0) {
      this.pinnedMessages[this.currentView] = data.messages;
      var latest = data.messages[0];
      var text = latest.content ? latest.content.substring(0, 60) : (latest.type === 'shopping' ? '🛒 ' + (latest.shoppingList ? latest.shoppingList.title : 'Список') : 'Сообщение');
      document.getElementById('pinned-text').textContent = '📌 ' + text + (data.messages.length > 1 ? ' (+' + (data.messages.length - 1) + ')' : '');
      bar.classList.remove('hidden');
    } else {
      this.pinnedMessages[this.currentView] = [];
      bar.classList.add('hidden');
    }
  } catch (e) {
    // If error, assume no pinned messages
    this.pinnedMessages[this.currentView] = [];
    document.getElementById('pinned-bar').classList.add('hidden');
  }
};

ChatApp.prototype.scrollToPinnedMessage = function() {
  var msgs = this.pinnedMessages[this.currentView];
  if (!msgs || !msgs.length) return;
  var el = document.querySelector('[data-msg-id="' + msgs[0]._id + '"]');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.background = 'rgba(108,92,231,0.2)';
    setTimeout(function() { el.style.background = ''; }, 2000);
  }
};

ChatApp.prototype.renderMessages = function(messages) {
  var container = document.getElementById('messages-container');
  var self = this;
  if (messages.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><h3>Пока нет сообщений</h3><p>Будьте первым!</p></div>';
    return;
  }
  container.innerHTML = messages.map(function(msg) { return self.createMessageHTML(msg); }).join('');
  this.scrollToBottom();
  this.updateSelectionUI(); // Update selection state after render
};

ChatApp.prototype.appendMessage = function(msg) {
  var container = document.getElementById('messages-container');
  var empty = container.querySelector('.empty-state');
  if (empty) empty.remove();
  var d = document.createElement('div');
  d.innerHTML = this.createMessageHTML(msg);
  if (d.firstElementChild) container.appendChild(d.firstElementChild);
  if (!this.messagesCache[this.currentView]) this.messagesCache[this.currentView] = [];
  this.messagesCache[this.currentView].push(msg);
  this.scrollToBottom();
};

ChatApp.prototype.createMessageHTML = function(msg) {
  if (!msg.sender) return '';
  var isOwn = msg.sender._id === this.currentUser._id;
  var senderIsAdmin = msg.sender.role === 'admin';
  var avatar = createMiniAvatarHTML(msg.sender, 36);
  var dn = getDisplayName(msg.sender);
  var nameStyle = getNameStyle(msg.sender);
  var adminBadge = senderIsAdmin ? ' <span class="admin-badge">👑</span>' : '';
  var pinnedIcon = msg.pinned ? '<span class="pin-indicator" title="Закреплено">📌</span> ' : '';
  var editedMark = msg.edited ? '<span class="msg-edited">(изменено ' + formatTime(msg.editedAt) + ')</span>' : '';
  var adminMsgClass = senderIsAdmin ? ' admin-message' : '';

  var bodyContent = '';
  if (msg.type === 'text') {
    bodyContent = '<div class="msg-text">' + escapeHTML(msg.content) + '</div>' + editedMark;
  } else if (msg.type === 'image') {
    bodyContent = (msg.content ? '<div class="msg-text">' + escapeHTML(msg.content) + '</div>' : '') +
      '<img class="msg-image" src="' + msg.imageUrl + '" onclick="app.openImageFullscreen(\'' + msg.imageUrl + '\')" loading="lazy">' + editedMark;
  } else if (msg.type === 'shopping') {
    bodyContent = createShoppingListHTML(msg);
  } else if (msg.type === 'dice') {
    bodyContent = createDiceHTML(msg);
  } else if (msg.type === 'forwarded') {
    bodyContent = createForwardedHTML(msg);
  } else if (msg.type === 'system') {
    return '<div class="message system-message"><div class="msg-content"><div class="msg-text">' + escapeHTML(msg.content) + '</div></div></div>';
  }

  var menuBtn = '<button class="msg-menu-btn" onclick="event.stopPropagation();app.showContextMenu(event,\'' + msg._id + '\')" title="Меню">⋮</button>';

  // NEW: Add onclick for selection mode
  var msgOnClick = 'app.toggleMessageSelection(\'' + msg._id + '\', event)';

  return '<div class="message' + (isOwn ? ' own-message' : '') + adminMsgClass + '" data-msg-id="' + msg._id + '" onclick="' + msgOnClick + '" oncontextmenu="app.showContextMenu(event,\'' + msg._id + '\')">' +
    '<div class="msg-avatar">' + avatar + '</div>' +
    '<div class="msg-content">' +
    '<div class="msg-header">' + pinnedIcon + '<span class="msg-sender" style="' + nameStyle + '">' + escapeHTML(dn) + adminBadge + '</span><span class="msg-time">' + formatTime(msg.createdAt) + '</span>' + menuBtn + '</div>' +
    '<div class="msg-body">' + bodyContent + '</div>' +
    '</div></div>';
};

ChatApp.prototype.showContextMenu = function(event, messageId) {
  event.preventDefault();
  event.stopPropagation();
  
  // If in selection mode, just toggle selection
  if (this.selectionMode) {
    this.toggleMessageSelection(messageId, event);
    return;
  }

  var messages = this.messagesCache[this.currentView];
  var msg = messages ? messages.find(function(m) { return m._id === messageId; }) : null;
  if (!msg) return;

  var menu = document.getElementById('msg-context-menu');
  var menuContent = document.getElementById('msg-context-actions');
  var isOwn = msg.sender._id === this.currentUser._id;
  var isAdminUser = isAdmin(this.currentUser);

  var html = '';
  if (isOwn || isAdminUser) {
    if (msg.type === 'text' && isOwn) {
      html += '<div class="context-item" onclick="app.editMessage(\'' + messageId + '\')">✏️ Редактировать</div>';
    }
    html += '<div class="context-item" onclick="app.deleteMessage(\'' + messageId + '\')">🗑️ Удалить</div>';
  }
  if (isAdminUser) {
    // FIXED: Show correct text based on current pin state
    var pinText = msg.pinned ? '📌 Открепить' : '📌 Закрепить';
    html += '<div class="context-item" onclick="app.togglePin(\'' + messageId + '\')">' + pinText + '</div>';
  }
  if (msg.type !== 'system') {
    html += '<div class="context-item" onclick="app.openForwardModal(\'' + messageId + '\')">↗️ Переслать</div>';
  }

  if (!html) return;
  menuContent.innerHTML = html;

  var x = event.clientX || (event.touches && event.touches[0].clientX) || 0;
  var y = event.clientY || (event.touches && event.touches[0].clientY) || 0;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.remove('hidden');

  setTimeout(function() {
    var rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
  }, 0);
};

// Edit
ChatApp.prototype.editMessage = function(messageId) {
  var messages = this.messagesCache[this.currentView];
  var msg = messages ? messages.find(function(m) { return m._id === messageId; }) : null;
  if (!msg || msg.type !== 'text') return;
  this.editingMessageId = messageId;
  document.getElementById('message-input').value = msg.content;
  document.getElementById('edit-bar').classList.remove('hidden');
  document.getElementById('msg-context-menu').classList.add('hidden');
  document.getElementById('message-input').focus();
};
ChatApp.prototype.cancelEdit = function() {
  this.editingMessageId = null;
  document.getElementById('message-input').value = '';
  document.getElementById('edit-bar').classList.add('hidden');
};

// Delete
ChatApp.prototype.deleteMessage = async function(messageId) {
  if (!confirm('Удалить сообщение?')) return;
  try {
    await apiRequest('/messages/delete/' + messageId, { method: 'DELETE' });
    document.getElementById('msg-context-menu').classList.add('hidden');
  } catch (e) { showToast(e.message, 'error'); }
};

// Pin
ChatApp.prototype.togglePin = async function(messageId) {
  try {
    var result = await apiRequest('/messages/pin/' + messageId, { method: 'POST' });
    document.getElementById('msg-context-menu').classList.add('hidden');
    // FIXED: Show appropriate toast message
    if (result.message && result.message.pinned) {
      showToast('Закреплено', 'success');
    } else {
      showToast('Откреплено', 'success');
    }
  } catch (e) { showToast(e.message, 'error'); }
};

// Forward
ChatApp.prototype.openForwardModal = function(messageId) {
  this.forwardMessageId = messageId;
  var self = this;
  var html = '<div class="forward-target" onclick="app.forwardTo(null)"><span>🌍</span> Общий чат</div>';
  Object.keys(this.roomsCache).forEach(function(rid) {
    var r = self.roomsCache[rid];
    html += '<div class="forward-target" onclick="app.forwardTo(\'' + rid + '\')"><span style="color:' + (r.color || '#6c5ce7') + '">●</span> ' + escapeHTML(r.name) + '</div>';
  });
  document.getElementById('forward-targets').innerHTML = html;
  document.getElementById('forward-modal').classList.remove('hidden');
  document.getElementById('msg-context-menu').classList.add('hidden');
};
ChatApp.prototype.forwardTo = async function(targetRoomId) {
  try {
    await apiRequest('/messages/forward/' + this.forwardMessageId, { method: 'POST', body: JSON.stringify({ targetRoomId: targetRoomId }) });
    showToast('Переслано!', 'success');
    this.closeModal('forward-modal');
  } catch (e) { showToast(e.message, 'error'); }
};

ChatApp.prototype.openImageFullscreen = function(url) {
  document.getElementById('fullscreen-img').src = url;
  document.getElementById('image-fullscreen').classList.remove('hidden');
};

ChatApp.prototype.sendMessage = async function() {
  var input = document.getElementById('message-input');
  var content = input.value.trim();
  if (!content) return;

  if (this.editingMessageId) {
    try {
      await apiRequest('/messages/edit/' + this.editingMessageId, { method: 'PUT', body: JSON.stringify({ content: content }) });
      this.cancelEdit();
    } catch (e) { showToast(e.message, 'error'); }
    return;
  }

  if (this.currentView === 'general') this.socket.emit('general:message', { content: content });
  else this.socket.emit('room:message', { content: content, roomId: this.currentView });
  input.value = '';
  input.style.height = 'auto';
  this.isTyping = false;
  this.socket.emit('typing:stop', { roomId: this.currentView === 'general' ? null : this.currentView });
};

ChatApp.prototype.scrollToBottom = function() {
  var c = document.getElementById('messages-container');
  requestAnimationFrame(function() { c.scrollTop = c.scrollHeight; });
};

// Typing
ChatApp.prototype.handleTyping = function() {
  var roomId = this.currentView === 'general' ? null : this.currentView;
  var self = this;
  if (!this.isTyping) { this.isTyping = true; this.socket.emit('typing:start', { roomId: roomId }); }
  clearTimeout(this.typingTimeout);
  this.typingTimeout = setTimeout(function() {
    self.isTyping = false;
    self.socket.emit('typing:stop', { roomId: roomId });
  }, 2000);
};
ChatApp.prototype.renderTyping = function() {
  var ind = document.getElementById('typing-indicator');
  if (this.typingUsers.size === 0) { ind.innerHTML = ''; return; }
  var names = Array.from(this.typingUsers.values());
  ind.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div><span>' +
    (names.length === 1 ? names[0] + ' печатает' : names.join(', ') + ' печатают') + '...</span>';
};

// Unread
ChatApp.prototype.updateUnreadBadges = function() {
  var self = this;
  var generalNav = document.getElementById('nav-general');
  var eb = generalNav.querySelector('.nav-badge');
  if (eb) eb.remove();
  var gc = this.unreadCounts['general'] || 0;
  if (gc > 0) {
    var b = document.createElement('span');
    b.className = 'nav-badge';
    b.textContent = gc > 99 ? '99+' : gc;
    generalNav.appendChild(b);
  }
  document.querySelectorAll('.room-item').forEach(function(el) {
    var rid = el.dataset.roomId;
    var exb = el.querySelector('.room-badge');
    if (exb) exb.remove();
    var c = self.unreadCounts[rid] || 0;
    if (c > 0) {
      var badge = document.createElement('span');
      badge.className = 'room-badge';
      badge.textContent = c > 99 ? '99+' : c;
      el.appendChild(badge);
    }
  });
};

// Views
ChatApp.prototype.switchView = async function(viewId) {
  this.currentView = viewId;
  this.typingUsers.clear();
  this.renderTyping();
  delete this.unreadCounts[viewId];
  this.updateUnreadBadges();
  saveCurrentView(viewId);
  
  // Exit selection mode when switching views
  if (this.selectionMode) {
    this.toggleSelectionMode();
  }
  
  document.querySelectorAll('.nav-item, .room-item').forEach(function(el) { el.classList.remove('active'); });

  if (viewId === 'general') {
    document.getElementById('nav-general').classList.add('active');
    document.getElementById('chat-title').textContent = '🌍 Общий чат';
    document.getElementById('chat-header-actions').innerHTML = '';
    await this.loadGeneralMessages();
  } else {
    var roomEl = document.querySelector('.room-item[data-room-id="' + viewId + '"]');
    if (roomEl) roomEl.classList.add('active');
    try {
      var room = this.roomsCache[viewId];
      if (room) {
        document.getElementById('chat-title').textContent = '# ' + room.name;
        this.updateRoomHeaderActions(viewId, room);
      }
      this.socket.emit('room:join', viewId);
      await this.loadRoomMessages(viewId);
      var data = await apiRequest('/rooms/' + viewId);
      room = data.room;
      this.roomsCache[viewId] = room;
      document.getElementById('chat-title').textContent = '# ' + room.name;
      this.updateRoomHeaderActions(viewId, room);
    } catch (e) {
      showToast('Ошибка загрузки комнаты', 'error');
      this.switchView('general');
    }
  }
};

// Rest of the file continues with rooms, profile, search, etc...
// (keeping the rest as is since we only fixed the specific bugs)
  // Finish switchView - already added above
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('show');
  document.getElementById('message-input').focus();
};

ChatApp.prototype.updateRoomHeaderActions = function(viewId, room) {
  var isOwner = room.owner._id === this.currentUser._id;
  var amAdmin = isAdmin(this.currentUser);
  document.getElementById('chat-header-actions').innerHTML =
    '<button class="btn-icon" onclick="app.showRoomInfo(\'' + viewId + '\')" title="Инфо">ℹ️</button>' +
    (isOwner || amAdmin ? '<button class="btn-icon" onclick="app.openAddMemberModal(\'' + viewId + '\')" title="Добавить">👤+</button>' : '') +
    '<button class="btn-icon" onclick="app.leaveRoom(\'' + viewId + '\')" title="Выйти">🚪</button>';
};

// Online
ChatApp.prototype.renderOnlineUsers = function() {
  var list = document.getElementById('online-users-list');
  var count = this.onlineUsers.length;
  document.getElementById('online-count').textContent = count + ' онлайн';
  document.getElementById('online-panel-count').textContent = count;
  list.innerHTML = this.onlineUsers.map(function(u) {
    var badge = u.role === 'admin' ? ' 👑' : '';
    return '<div class="online-user-item" onclick="app.showUserPopup(event,\'' + u._id + '\')">' +
      '<div style="position:relative;">' + createMiniAvatarHTML(u, 32) +
      '<div style="width:10px;height:10px;border-radius:50%;background:#00b894;position:absolute;bottom:-2px;right:-2px;border:2px solid var(--bg-sidebar);"></div></div>' +
      '<span class="user-name">' + escapeHTML(getDisplayName(u)) + badge + '</span></div>';
  }).join('');
};

// User popup
ChatApp.prototype.showUserPopup = async function(event, userId) {
  event.stopPropagation();
  try {
    var data = await apiRequest('/users/' + userId);
    var u = data.user;
    var popup = document.getElementById('user-popup');
    var bd = u.profile && u.profile.birthDate ? new Date(u.profile.birthDate).toLocaleDateString('ru-RU') : null;
    var adminBadgeHTML = u.role === 'admin' ? '<span class="admin-badge">👑 Администратор</span>' : '';
    var statusCustom = u.profile && (u.profile.statusEmoji || u.profile.statusText)
      ? '<div style="margin:6px 0;font-size:12px;">' + (u.profile.statusEmoji || '') + ' ' + escapeHTML(u.profile.statusText || '') + '</div>' : '';
    var adminActions = '';
    if (isAdmin(this.currentUser) && u._id !== this.currentUser._id) {
      adminActions = '<div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">' +
        '<button class="btn btn-ghost btn-sm" onclick="window.location.href=\'/user.html?id=' + u._id + '\'">👁 Профиль</button>' +
        (u.role !== 'admin' ? '<button class="btn btn-ghost btn-sm" onclick="app.adminBanUser(\'' + u._id + '\')">🔨 Бан</button>' : '') +
        (u.role !== 'admin' ? '<button class="btn btn-ghost btn-sm" onclick="app.adminSetRole(\'' + u._id + '\',\'admin\')">👑 Админ</button>'
          : '<button class="btn btn-ghost btn-sm" onclick="app.adminSetRole(\'' + u._id + '\',\'user\')">Снять</button>') +
        '</div>';
    }

    popup.innerHTML =
      '<div class="user-popup-header">' + createAvatarHTML(u) +
      '<div class="user-popup-info"><h3 style="' + getNameStyle(u) + '">' + escapeHTML(getDisplayName(u)) + '</h3>' +
      '<div class="popup-username">@' + escapeHTML(u.username) + '</div>' + adminBadgeHTML + '</div></div>' +
      statusCustom +
      (u.profile && u.profile.bio ? '<div class="user-popup-bio">' + escapeHTML(u.profile.bio) + '</div>' : '') +
      '<div class="user-popup-details">' +
      (u.status === 'online' ? '<div class="detail-item"><span>🟢</span><span>Онлайн</span></div>'
        : '<div class="detail-item"><span>⚫</span><span>Был(а) ' + formatTime(u.lastSeen) + '</span></div>') +
      (u.profile && u.profile.location ? '<div class="detail-item"><span>📍</span><span>' + escapeHTML(u.profile.location) + '</span></div>' : '') +
      (bd ? '<div class="detail-item"><span>🎂</span><span>' + bd + '</span></div>' : '') +
      '</div>' +
      '<div style="margin-top:8px;"><a href="/user.html?id=' + u._id + '" style="color:var(--primary-light);font-size:12px;">Открыть профиль →</a></div>' +
      adminActions;

    var rect = event.target.getBoundingClientRect();
    popup.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px';
    popup.style.top = Math.min(rect.bottom + 8, window.innerHeight - 350) + 'px';
    popup.classList.remove('hidden');
  } catch (e) {}
};

// Admin actions
ChatApp.prototype.adminBanUser = async function(userId) {
  var reason = prompt('Причина бана:');
  if (reason === null) return;
  try {
    await apiRequest('/users/admin/ban/' + userId, { method: 'POST', body: JSON.stringify({ reason: reason }) });
    showToast('Пользователь забанен', 'success');
    document.getElementById('user-popup').classList.add('hidden');
  } catch (e) { showToast(e.message, 'error'); }
};
ChatApp.prototype.adminSetRole = async function(userId, role) {
  try {
    await apiRequest('/users/admin/role/' + userId, { method: 'POST', body: JSON.stringify({ role: role }) });
    showToast('Роль изменена', 'success');
    document.getElementById('user-popup').classList.add('hidden');
  } catch (e) { showToast(e.message, 'error'); }
};

// Rooms
ChatApp.prototype.loadRooms = async function() {
  try {
    var data = await apiRequest('/rooms');
    var self = this;
    data.rooms.forEach(function(r) { self.roomsCache[r._id] = r; });
    this.renderRooms(data.rooms);
  } catch (e) {}
};
ChatApp.prototype.renderRooms = function(rooms) {
  var list = document.getElementById('rooms-list');
  var self = this;
  if (rooms.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px;">Нет комнат</div>';
    return;
  }
  list.innerHTML = rooms.map(function(r) {
    return '<div class="room-item ' + (self.currentView === r._id ? 'active' : '') + '" data-room-id="' + r._id + '" onclick="app.switchView(\'' + r._id + '\')">' +
      '<div class="room-icon" style="background:' + (r.color || '#6c5ce7') + '">' + r.name[0].toUpperCase() + '</div>' +
      '<div class="room-info"><div class="room-name">' + escapeHTML(r.name) + '</div>' +
      '<div class="room-members-count">' + r.members.length + ' уч.</div></div></div>';
  }).join('');
  this.updateUnreadBadges();
};
ChatApp.prototype.openCreateRoomModal = async function() {
  document.getElementById('room-name-input').value = '';
  document.getElementById('room-desc-input').value = '';
  document.getElementById('member-search').value = '';
  await this.searchUsersForRoom('', 'members-checkbox-list');
  document.getElementById('create-room-modal').classList.remove('hidden');
};
ChatApp.prototype.searchUsersForRoom = async function(q, cid) {
  try {
    var data = await apiRequest('/users?search=' + encodeURIComponent(q));
    var self = this;
    document.getElementById(cid).innerHTML = data.users.filter(function(u) {
      return u._id !== self.currentUser._id;
    }).map(function(u) {
      return '<label class="user-checkbox"><input type="checkbox" value="' + u._id + '" class="room-member-checkbox"><span class="checkmark">✓</span>' +
        '<div class="check-user-info">' + createMiniAvatarHTML(u, 28) + '<span>' + escapeHTML(u.username) + '</span></div></label>';
    }).join('');
  } catch (e) {}
};
ChatApp.prototype.createRoom = async function() {
  var name = document.getElementById('room-name-input').value.trim();
  if (!name) { showToast('Введите название', 'error'); return; }
  var members = Array.from(document.querySelectorAll('#members-checkbox-list .room-member-checkbox:checked')).map(function(c) { return c.value; });
  try {
    var data = await apiRequest('/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: name, description: document.getElementById('room-desc-input').value.trim(), members: members })
    });
    showToast('Создана!', 'success');
    this.closeModal('create-room-modal');
    await this.loadRooms();
    if (data.room && data.room._id) {
      this.socket.emit('room:join', data.room._id);
      this.socket.emit('room:created', { roomId: data.room._id });
    }
  } catch (e) { showToast(e.message, 'error'); }
};
ChatApp.prototype.showRoomInfo = async function(roomId) {
  try {
    var data = await apiRequest('/rooms/' + roomId);
    var r = data.room;
    document.getElementById('room-info-title').textContent = r.name;
    document.getElementById('room-info-desc').textContent = r.description || 'Нет описания';
    document.getElementById('room-members-list').innerHTML = r.members.map(function(m) {
      return '<div class="online-user-item"><a href="/user.html?id=' + m._id + '" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit;">' +
        createMiniAvatarHTML(m, 32) + '<span class="user-name">' + escapeHTML(getDisplayName(m)) + '</span>' +
        (m._id === r.owner._id ? '<span style="color:var(--warning);font-size:11px;">👑</span>' : '') + '</a></div>';
    }).join('');
    var isOwner = r.owner._id === this.currentUser._id;
    var amAdmin = isAdmin(this.currentUser);
    document.getElementById('room-admin-actions').innerHTML = (isOwner || amAdmin)
      ? '<button class="btn btn-danger btn-sm" onclick="app.deleteRoom(\'' + roomId + '\')">🗑 Удалить</button>' : '';
    document.getElementById('room-info-modal').classList.remove('hidden');
  } catch (e) { showToast('Ошибка', 'error'); }
};
ChatApp.prototype.openAddMemberModal = async function(roomId) {
  this.addMemberRoomId = roomId;
  document.getElementById('add-member-search').value = '';
  await this.searchUsersForAddMember('');
  document.getElementById('add-member-modal').classList.remove('hidden');
};
ChatApp.prototype.searchUsersForAddMember = async function(q) {
  try {
    var rd = await apiRequest('/rooms/' + this.addMemberRoomId);
    var mids = rd.room.members.map(function(m) { return m._id; });
    var data = await apiRequest('/users?search=' + encodeURIComponent(q));
    var users = data.users.filter(function(u) { return mids.indexOf(u._id) === -1; });
    document.getElementById('add-members-list').innerHTML = users.length === 0
      ? '<div style="text-align:center;padding:16px;color:var(--text-muted);">Все добавлены</div>'
      : users.map(function(u) {
        return '<label class="user-checkbox"><input type="checkbox" value="' + u._id + '" class="add-member-checkbox"><span class="checkmark">✓</span>' +
          '<div class="check-user-info">' + createMiniAvatarHTML(u, 28) + '<span>' + escapeHTML(u.username) + '</span></div></label>';
      }).join('');
  } catch (e) {}
};
ChatApp.prototype.addMembersToRoom = async function() {
  var ids = Array.from(document.querySelectorAll('#add-members-list .add-member-checkbox:checked')).map(function(c) { return c.value; });
  if (!ids.length) { showToast('Выберите', 'error'); return; }
  try {
    for (var i = 0; i < ids.length; i++) {
      await apiRequest('/rooms/' + this.addMemberRoomId + '/members', { method: 'POST', body: JSON.stringify({ userId: ids[i] }) });
    }
    showToast('Добавлены!', 'success');
    this.closeModal('add-member-modal');
    await this.loadRooms();
  } catch (e) { showToast(e.message, 'error'); }
};
ChatApp.prototype.leaveRoom = async function(rid) {
  if (!confirm('Покинуть?')) return;
  try {
    await apiRequest('/rooms/' + rid + '/leave', { method: 'POST' });
    delete this.roomsCache[rid];
    delete this.messagesCache[rid];
    this.switchView('general');
    await this.loadRooms();
  } catch (e) { showToast(e.message, 'error'); }
};
ChatApp.prototype.deleteRoom = async function(rid) {
  if (!confirm('Удалить?')) return;
  try {
    await apiRequest('/rooms/' + rid, { method: 'DELETE' });
    delete this.roomsCache[rid];
    delete this.messagesCache[rid];
    this.closeModal('room-info-modal');
    this.switchView('general');
    await this.loadRooms();
  } catch (e) { showToast(e.message, 'error'); }
};

// Search messages
ChatApp.prototype.searchMessages = async function(query) {
  if (!query || query.length < 2) {
    document.getElementById('search-results').innerHTML = '';
    return;
  }
  try {
    var endpoint = this.currentView === 'general' ? '/messages/search?q=' + encodeURIComponent(query) : '/messages/search/' + this.currentView + '?q=' + encodeURIComponent(query);
    var data = await apiRequest(endpoint);
    var container = document.getElementById('search-results');
    if (data.messages.length === 0) {
      container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);">Ничего не найдено</div>';
      return;
    }
    var self = this;
    container.innerHTML = data.messages.map(function(msg) {
      var senderName = getDisplayName(msg.sender);
      var preview = msg.content ? msg.content.substring(0, 80) + (msg.content.length > 80 ? '...' : '') : '[Медиа]';
      return '<div class="search-result-item" onclick="app.jumpToMessage(\'' + msg._id + '\')">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' + createMiniAvatarHTML(msg.sender, 24) +
        '<strong>' + escapeHTML(senderName) + '</strong><span style="color:var(--text-muted);font-size:11px;">' + formatTime(msg.createdAt) + '</span></div>' +
        '<div style="font-size:13px;color:var(--text-secondary);">' + escapeHTML(preview) + '</div></div>';
    }).join('');
  } catch (e) {}
};
ChatApp.prototype.jumpToMessage = function(msgId) {
  var el = document.querySelector('[data-msg-id="' + msgId + '"]');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.background = 'rgba(108,92,231,0.2)';
    setTimeout(function() { el.style.background = ''; }, 2000);
  }
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-input').value = '';
};

ChatApp.prototype.renderSidebarProfile = function() {
  var u = this.currentUser;
  var adminBadge = u.role === 'admin' ? ' 👑' : '';
  var statusText = u.profile && u.profile.statusEmoji ? u.profile.statusEmoji + ' ' : '';
  statusText += u.profile && u.profile.statusText ? u.profile.statusText : 'Онлайн';
  document.getElementById('sidebar-user-profile').innerHTML =
    '<div style="position:relative;">' + createMiniAvatarHTML(u, 40) + '<div class="status-dot online"></div></div>' +
    '<div class="user-info"><div class="user-name">' + escapeHTML(getDisplayName(u)) + adminBadge + '</div>' +
    '<div class="user-status">' + escapeHTML(statusText) + '</div></div>';
};
ChatApp.prototype.closeModal = function(id) { document.getElementById(id).classList.add('hidden'); };

var app;
document.addEventListener('DOMContentLoaded', function() { app = new ChatApp(); });
