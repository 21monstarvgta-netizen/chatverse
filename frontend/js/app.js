var ADMIN_EMOJI = ['👑', '⚡', '🛡️', '🔱', '💎', '🌟', '🏆', '🎖️', '🔥', '✨', '🦁', '🐉'];

var ChatApp = function() {
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
  this.selectMode = null;
  this.selectedMessages = [];
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
      if (self.messagesCache[self.currentView]) {
        var msgIdStr = data.messageId.toString();
        self.messagesCache[self.currentView] = self.messagesCache[self.currentView].map(function(m) {
          if (m._id.toString() === msgIdStr) return data.message;
          return m;
        });
      }
    }
  });

  this.socket.on('message:deleted', function(data) {
    var targetView = data.roomId || 'general';
    if (self.currentView === targetView) {
      var el = document.querySelector('[data-msg-id="' + data.messageId + '"]');
      if (el) el.remove();
      if (self.messagesCache[self.currentView]) {
        var msgIdStr = data.messageId.toString();
        self.messagesCache[self.currentView] = self.messagesCache[self.currentView].filter(function(m) {
          return m._id.toString() !== msgIdStr;
        });
      }
    }
  });

  this.socket.on('message:pinned', function(data) {
    var targetView = data.roomId || 'general';
    if (self.currentView === targetView) {
      var msgIdStr = data.messageId.toString();
      if (self.messagesCache[self.currentView]) {
        self.messagesCache[self.currentView] = self.messagesCache[self.currentView].map(function(m) {
          if (m._id.toString() === msgIdStr) {
            if (data.message) return data.message;
            m.pinned = data.pinned;
          }
          return m;
        });
      }
      var el = document.querySelector('[data-msg-id="' + msgIdStr + '"]');
      if (el) {
        var pinInd = el.querySelector('.pin-indicator');
        if (data.pinned && !pinInd) {
          var header = el.querySelector('.msg-header');
          if (header) {
            var span = document.createElement('span');
            span.className = 'pin-indicator';
            span.title = 'Закреплено';
            span.textContent = '📌';
            header.insertBefore(span, header.firstChild);
          }
        } else if (!data.pinned && pinInd) {
          pinInd.remove();
        }
      }
      self.loadPinnedMessages();
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
  document.getElementById('btn-profile').addEventListener('click', function() { window.location.href = '/profile.html'; });
  document.getElementById('btn-game').addEventListener('click', function() { window.location.href = '/game.html'; });
  document.getElementById('btn-posts').addEventListener('click', function() { window.location.href = '/posts.html'; });
  document.getElementById('btn-logout').addEventListener('click', function() {
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
  document.getElementById('image-upload-input').addEventListener('change', function(e) { self.handleImageUpload(e); });
  document.getElementById('btn-shopping').addEventListener('click', function() { self.openShoppingModal(); });
  document.getElementById('close-shopping').addEventListener('click', function() { self.closeModal('shopping-modal'); });
  document.getElementById('cancel-shopping').addEventListener('click', function() { self.closeModal('shopping-modal'); });
  document.getElementById('confirm-shopping').addEventListener('click', function() { self.sendShoppingList(); });
  document.getElementById('add-custom-item').addEventListener('click', function() { self.addCustomShoppingItem(); });
  document.getElementById('custom-item-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); self.addCustomShoppingItem(); }
  });
  document.getElementById('btn-dice').addEventListener('click', function(e) {
    e.stopPropagation();
    document.getElementById('dice-picker').classList.toggle('hidden');
    document.getElementById('emoji-picker').classList.add('hidden');
  });
  document.getElementById('close-forward').addEventListener('click', function() { self.closeModal('forward-modal'); });

  document.addEventListener('click', function(e) {
    var emoji = document.getElementById('emoji-picker');
    var dice = document.getElementById('dice-picker');
    var popup = document.getElementById('user-popup');
    var ctx = document.getElementById('msg-context-menu');
    if (!emoji.contains(e.target) && e.target.id !== 'btn-emoji') emoji.classList.add('hidden');
    if (!dice.contains(e.target) && e.target.id !== 'btn-dice') dice.classList.add('hidden');
    if (!popup.classList.contains('hidden') && !popup.contains(e.target) && !e.target.classList.contains('msg-username')) popup.classList.add('hidden');
    if (!ctx.classList.contains('hidden') && !ctx.contains(e.target) && !e.target.closest('.msg-menu-btn')) ctx.classList.add('hidden');
  });

  document.querySelectorAll('.modal-overlay').forEach(function(o) {
    o.addEventListener('click', function(e) { if (e.target === o) o.classList.add('hidden'); });
  });

  var longPressTimer = null;
  var longPressTriggered = false;
  document.getElementById('messages-container').addEventListener('touchstart', function(e) {
    var msgEl = e.target.closest('.message[data-msg-id]');
    if (!msgEl) return;
    if (self.selectMode) return;
    longPressTriggered = false;
    longPressTimer = setTimeout(function() {
      longPressTriggered = true;
      var msgId = msgEl.dataset.msgId;
      if (msgId) {
        var touch = e.changedTouches[0];
        self.showContextMenu({
          preventDefault: function() {},
          stopPropagation: function() {},
          clientX: touch.clientX,
          clientY: touch.clientY
        }, msgId);
      }
    }, 500);
  }, { passive: true });
  document.getElementById('messages-container').addEventListener('touchend', function(e) {
    clearTimeout(longPressTimer);
    if (longPressTriggered) {
      e.preventDefault();
    }
  });
  document.getElementById('messages-container').addEventListener('touchmove', function() {
    clearTimeout(longPressTimer);
  }, { passive: true });

  document.getElementById('messages-container').addEventListener('click', function(e) {
    if (!self.selectMode) return;
    var msgEl = e.target.closest('.message[data-msg-id]');
    if (!msgEl) return;
    if (e.target.closest('.msg-username') || e.target.closest('.msg-image') || e.target.closest('.shopping-item') || e.target.closest('a')) return;
    var msgId = msgEl.dataset.msgId;
    if (!msgId) return;

    if (self.selectMode === 'delete') {
      var msg = self.findMessageInCache(msgId);
      if (!msg) return;
      var isOwn = msg.sender._id === self.currentUser._id;
      var amAdmin = self.currentUser.role === 'admin';
      if (!isOwn && !amAdmin) {
        showToast('Можно выбирать только свои сообщения', 'error');
        return;
      }
    }

    var idx = self.selectedMessages.indexOf(msgId);
    if (idx >= 0) {
      self.selectedMessages.splice(idx, 1);
      msgEl.classList.remove('selected-message');
    } else {
      self.selectedMessages.push(msgId);
      msgEl.classList.add('selected-message');
    }
    self.updateSelectBar();
  });
};

ChatApp.prototype.findMessageInCache = function(msgId) {
  var cache = this.messagesCache[this.currentView] || [];
  var idStr = msgId.toString();
  for (var i = 0; i < cache.length; i++) {
    if (cache[i]._id.toString() === idStr) return cache[i];
  }
  return null;
};

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
ChatApp.prototype.addCustomShoppingItem = function() {
  var input = document.getElementById('custom-item-input');
  var name = input.value.trim();
  if (!name) return;
  if (!this.selectedShoppingItems.find(function(i) { return i.name === name; })) {
    this.selectedShoppingItems.push({ name: name, category: 'Другое' });
    this.renderSelectedItems();
  }
  input.value = '';
};
ChatApp.prototype.renderSelectedItems = function() {
  var preview = document.getElementById('selected-items-preview');
  var self = this;
  if (this.selectedShoppingItems.length === 0) {
    preview.innerHTML = '<span style="color:var(--text-muted);font-size:13px;">Товары не выбраны</span>';
    return;
  }
  preview.innerHTML = this.selectedShoppingItems.map(function(item, i) {
    return '<div class="selected-item-chip">' + escapeHTML(item.name) + '<span class="remove-chip" data-idx="' + i + '">✕</span></div>';
  }).join('');
  preview.querySelectorAll('.remove-chip').forEach(function(el) {
    el.addEventListener('click', function() { self.removeShoppingItem(parseInt(el.dataset.idx)); });
  });
};
ChatApp.prototype.removeShoppingItem = function(index) {
  var item = this.selectedShoppingItems[index];
  this.selectedShoppingItems.splice(index, 1);
  document.querySelectorAll('.shopping-product-tag').forEach(function(t) {
    if (t.textContent === item.name) t.classList.remove('selected');
  });
  this.renderSelectedItems();
};
ChatApp.prototype.sendShoppingList = function() {
  if (this.selectedShoppingItems.length === 0) { showToast('Добавьте товары', 'error'); return; }
  this.socket.emit('shopping:create', {
    title: document.getElementById('shopping-title-input').value.trim() || 'Список покупок',
    items: this.selectedShoppingItems,
    roomId: this.currentView === 'general' ? null : this.currentView
  });
  this.closeModal('shopping-modal');
};
ChatApp.prototype.toggleShoppingItem = async function(messageId, itemId) {
  try { await apiRequest('/messages/shopping/' + messageId + '/toggle/' + itemId, { method: 'POST' }); }
  catch (e) { showToast('Ошибка', 'error'); }
};

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
  } catch (e) {}
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
  var selectedClass = this.selectedMessages.indexOf(msg._id) >= 0 ? ' selected-message' : '';

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

  var menuBtn = '';
  if (!this.selectMode) {
    menuBtn = '<button class="msg-menu-btn" onclick="event.stopPropagation();event.preventDefault();app.openMenuForMessage(event,\'' + msg._id + '\');return false;" title="Меню">⋮</button>';
  }

  return '<div class="message' + (isOwn ? ' own-message' : '') + adminMsgClass + selectedClass + '" data-msg-id="' + msg._id + '">' +
    '<div class="msg-avatar">' + avatar + '</div>' +
    '<div class="msg-content"><div class="msg-header">' + pinnedIcon +
    '<span class="msg-username" style="' + nameStyle + '" onclick="app.showUserPopup(event,\'' + msg.sender._id + '\')">' + escapeHTML(dn) + '</span>' + adminBadge +
    '<span class="msg-time">' + formatTime(msg.createdAt) + '</span>' +
    menuBtn +
    '</div><div class="msg-body">' + bodyContent + '</div></div></div>';
};

ChatApp.prototype.openMenuForMessage = function(event, messageId) {
  event.stopPropagation();
  event.preventDefault();
  this.showContextMenu(event, messageId);
};

ChatApp.prototype.enterSelectMode = function(mode) {
  document.getElementById('msg-context-menu').classList.add('hidden');
  this.selectMode = mode;
  this.selectedMessages = [];
  var self = this;
  document.querySelectorAll('.message[data-msg-id]').forEach(function(el) {
    el.classList.remove('selected-message');
    if (mode === 'delete') {
      var msgId = el.dataset.msgId;
      var msg = self.findMessageInCache(msgId);
      if (msg) {
        var isOwn = msg.sender._id === self.currentUser._id;
        var amAdmin = self.currentUser.role === 'admin';
        if (!isOwn && !amAdmin) {
          el.classList.add('msg-not-selectable');
        } else {
          el.classList.remove('msg-not-selectable');
        }
      }
    }
  });
  document.querySelectorAll('.msg-menu-btn').forEach(function(btn) { btn.style.display = 'none'; });
  this.showSelectBar();
  showToast(mode === 'delete' ? 'Нажимайте на сообщения для выбора' : 'Нажимайте на сообщения для выбора', 'info');
};

ChatApp.prototype.exitSelectMode = function() {
  this.selectMode = null;
  this.selectedMessages = [];
  this.hideSelectBar();
  document.querySelectorAll('.message[data-msg-id]').forEach(function(el) {
    el.classList.remove('selected-message');
    el.classList.remove('msg-not-selectable');
  });
  document.querySelectorAll('.msg-menu-btn').forEach(function(btn) { btn.style.display = ''; });
};

ChatApp.prototype.showSelectBar = function() {
  var bar = document.getElementById('select-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'select-bar';
    bar.className = 'select-bar';
    var inputArea = document.querySelector('.message-input-area');
    inputArea.parentNode.insertBefore(bar, inputArea);
  }
  this.updateSelectBar();
  bar.classList.remove('hidden');
  document.querySelector('.message-input-area').classList.add('hidden');
};

ChatApp.prototype.hideSelectBar = function() {
  var bar = document.getElementById('select-bar');
  if (bar) bar.classList.add('hidden');
  document.querySelector('.message-input-area').classList.remove('hidden');
};

ChatApp.prototype.updateSelectBar = function() {
  var bar = document.getElementById('select-bar');
  if (!bar) return;
  var count = this.selectedMessages.length;
  if (this.selectMode === 'delete') {
    bar.innerHTML = '<div class="select-bar-info">🗑 Выбрано: <strong>' + count + '</strong></div>' +
      '<div class="select-bar-actions">' +
      '<button class="btn btn-secondary btn-sm" onclick="app.exitSelectMode()">✕ Отмена</button>' +
      '<button class="btn btn-danger btn-sm" ' + (count === 0 ? 'disabled' : '') + ' onclick="app.bulkDelete()">Удалить (' + count + ')</button>' +
      '</div>';
  } else if (this.selectMode === 'forward') {
    bar.innerHTML = '<div class="select-bar-info">↗️ Выбрано: <strong>' + count + '</strong></div>' +
      '<div class="select-bar-actions">' +
      '<button class="btn btn-secondary btn-sm" onclick="app.exitSelectMode()">✕ Отмена</button>' +
      '<button class="btn btn-primary btn-sm" style="width:auto" ' + (count === 0 ? 'disabled' : '') + ' onclick="app.bulkForwardChooseTarget()">Переслать (' + count + ')</button>' +
      '</div>';
  }
};

ChatApp.prototype.bulkDelete = async function() {
  if (this.selectedMessages.length === 0) return;
  if (!confirm('Удалить выбранные сообщения (' + this.selectedMessages.length + ')?')) return;
  try {
    await apiRequest('/messages/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ messageIds: this.selectedMessages })
    });
    showToast('Удалено: ' + this.selectedMessages.length, 'success');
    this.exitSelectMode();
  } catch (e) { showToast(e.message, 'error'); }
};

ChatApp.prototype.bulkForwardChooseTarget = function() {
  if (this.selectedMessages.length === 0) return;
  var self = this;
  var html = '<div class="forward-target" onclick="app.bulkForwardTo(null)"><span>🌍</span> Общий чат</div>';
  Object.keys(this.roomsCache).forEach(function(rid) {
    var r = self.roomsCache[rid];
    html += '<div class="forward-target" onclick="app.bulkForwardTo(\'' + rid + '\')"><span style="color:' + (r.color || '#6c5ce7') + '">●</span> ' + escapeHTML(r.name) + '</div>';
  });
  document.getElementById('forward-targets').innerHTML = html;
  document.getElementById('forward-modal').classList.remove('hidden');
};

ChatApp.prototype.bulkForwardTo = async function(targetRoomId) {
  try {
    await apiRequest('/messages/bulk-forward', {
      method: 'POST',
      body: JSON.stringify({ messageIds: this.selectedMessages, targetRoomId: targetRoomId })
    });
    showToast('Переслано: ' + this.selectedMessages.length, 'success');
    this.closeModal('forward-modal');
    this.exitSelectMode();
  } catch (e) { showToast(e.message, 'error'); }
};

ChatApp.prototype.showContextMenu = function(event, messageId) {
  if (this.selectMode) return;
  event.preventDefault();
  event.stopPropagation();
  var menu = document.getElementById('msg-context-menu');
  var msg = this.findMessageInCache(messageId);
  if (!msg) return;

  var isOwn = msg.sender._id === this.currentUser._id;
  var amAdmin = isAdmin(this.currentUser);
  var canEdit = (isOwn || amAdmin) && (msg.type === 'text' || msg.type === 'image');
  var canDelete = isOwn || amAdmin;
  var canPin = amAdmin || (this.currentView !== 'general' && this.roomsCache[this.currentView] && this.roomsCache[this.currentView].owner && this.roomsCache[this.currentView].owner._id === this.currentUser._id);

  var html = '';
  if (canEdit) html += '<div class="ctx-item" onclick="app.startEdit(\'' + messageId + '\')">✏️ Редактировать</div>';
  html += '<div class="ctx-item" onclick="app.openForwardModal(\'' + messageId + '\')">↗️ Переслать</div>';
  if (canPin) html += '<div class="ctx-item" onclick="app.togglePin(\'' + messageId + '\')">' + (msg.pinned ? '📌 Открепить' : '📌 Закрепить') + '</div>';
  html += '<div class="ctx-item" onclick="app.enterSelectMode(\'forward\')">☑️ Выбрать несколько для пересылки</div>';
  if (canDelete) {
    html += '<div class="ctx-item ctx-danger" onclick="app.deleteMessage(\'' + messageId + '\')">🗑 Удалить</div>';
    html += '<div class="ctx-item ctx-danger" onclick="app.enterSelectMode(\'delete\')">☑️ Выбрать несколько для удаления</div>';
  }

  menu.innerHTML = html;

  if (window.innerWidth <= 768) {
    menu.style.left = '8px';
    menu.style.right = '8px';
    menu.style.bottom = '8px';
    menu.style.top = 'auto';
    menu.style.width = 'auto';
  } else {
    menu.style.left = Math.max(10, Math.min(event.clientX, window.innerWidth - 220)) + 'px';
    menu.style.top = Math.min(event.clientY, window.innerHeight - 300) + 'px';
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    menu.style.width = '';
  }
  menu.classList.remove('hidden');
};

ChatApp.prototype.startEdit = function(messageId) {
  var msg = this.findMessageInCache(messageId);
  if (!msg) return;
  this.editingMessageId = messageId;
  document.getElementById('message-input').value = msg.content || '';
  document.getElementById('edit-bar').classList.remove('hidden');
  document.getElementById('message-input').focus();
  document.getElementById('msg-context-menu').classList.add('hidden');
};
ChatApp.prototype.cancelEdit = function() {
  this.editingMessageId = null;
  document.getElementById('message-input').value = '';
  document.getElementById('edit-bar').classList.add('hidden');
};

ChatApp.prototype.deleteMessage = async function(messageId) {
  if (!confirm('Удалить сообщение?')) return;
  try {
    await apiRequest('/messages/delete/' + messageId, { method: 'DELETE' });
    document.getElementById('msg-context-menu').classList.add('hidden');
  } catch (e) { showToast(e.message, 'error'); }
};

ChatApp.prototype.togglePin = async function(messageId) {
  try {
    console.log('Toggle pin for:', messageId);
    var result = await apiRequest('/messages/pin/' + messageId, { method: 'POST' });
    console.log('Pin result:', result);
    document.getElementById('msg-context-menu').classList.add('hidden');
    if (this.messagesCache[this.currentView]) {
      var msgIdStr = messageId.toString();
      this.messagesCache[this.currentView] = this.messagesCache[this.currentView].map(function(m) {
        if (m._id.toString() === msgIdStr) {
          return result.message || m;
        }
        return m;
      });
    }
  } catch (e) {
    console.error('Pin error:', e);
    showToast(e.message, 'error');
  }
};

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

ChatApp.prototype.switchView = async function(viewId) {
  if (this.selectMode) this.exitSelectMode();

  this.currentView = viewId;
  this.typingUsers.clear();
  this.renderTyping();
  delete this.unreadCounts[viewId];
  this.updateUnreadBadges();
  saveCurrentView(viewId);
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
      showToast('Ошибка', 'error');
      this.switchView('general');
      return;
    }
  }
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