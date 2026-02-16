class ChatApp {
  constructor() {
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
    this.init();
  }

  async init() {
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
    } catch (error) {
      removeToken();
      window.location.href = '/login.html';
    }
  }

  initSocket() {
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
        if (msg.sender._id !== self.currentUser._id) playNotificationSound();
      }
    });

    this.socket.on('room:message', function(data) {
      if (self.currentView === data.roomId) {
        self.appendMessage(data.message);
      } else {
        self.unreadCounts[data.roomId] = (self.unreadCounts[data.roomId] || 0) + 1;
        self.updateUnreadBadges();
        if (data.message.sender._id !== self.currentUser._id) playNotificationSound();
      }
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
          var contentEl = el.querySelector('.msg-body');
          if (contentEl) contentEl.innerHTML = createShoppingListHTML(data.message);
        }
      }
    });

    this.socket.on('room:new', async function(room) {
      self.socket.emit('room:join', room._id);
      await self.loadRooms();
      showToast('Вас добавили в "' + room.name + '"', 'info');
      playNotificationSound();
    });

    this.socket.on('error', function(data) { showToast(data.message, 'error'); });
  }

  setupUI() { this.renderSidebarProfile(); this.buildEmojiPicker(); this.buildDicePicker(); this.buildShoppingModal(); }

  setupEventListeners() {
    var self = this;
    document.getElementById('send-btn').addEventListener('click', function() { self.sendMessage(); });
    var msgInput = document.getElementById('message-input');
    msgInput.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); self.sendMessage(); } });
    msgInput.addEventListener('input', function() { msgInput.style.height = 'auto'; msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px'; self.handleTyping(); });

    document.getElementById('nav-general').addEventListener('click', function() { self.switchView('general'); });
    document.getElementById('btn-profile').addEventListener('click', function() { window.location.href = '/profile.html'; });
    document.getElementById('btn-logout').addEventListener('click', function() { if (self.socket) self.socket.disconnect(); removeToken(); window.location.href = '/login.html'; });
    document.getElementById('mobile-menu-btn').addEventListener('click', function() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('sidebar-overlay').classList.toggle('show'); });
    document.getElementById('sidebar-overlay').addEventListener('click', function() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebar-overlay').classList.remove('show'); });

    document.getElementById('btn-create-room').addEventListener('click', function() { self.openCreateRoomModal(); });
    document.getElementById('close-create-room').addEventListener('click', function() { self.closeModal('create-room-modal'); });
    document.getElementById('cancel-create-room').addEventListener('click', function() { self.closeModal('create-room-modal'); });
    document.getElementById('confirm-create-room').addEventListener('click', function() { self.createRoom(); });
    document.getElementById('close-room-info').addEventListener('click', function() { self.closeModal('room-info-modal'); });
    document.getElementById('close-add-member').addEventListener('click', function() { self.closeModal('add-member-modal'); });
    document.getElementById('cancel-add-member').addEventListener('click', function() { self.closeModal('add-member-modal'); });
    document.getElementById('confirm-add-member').addEventListener('click', function() { self.addMembersToRoom(); });
    document.getElementById('member-search').addEventListener('input', debounce(function(e) { self.searchUsersForRoom(e.target.value, 'members-checkbox-list'); }, 300));
    document.getElementById('add-member-search').addEventListener('input', debounce(function(e) { self.searchUsersForAddMember(e.target.value); }, 300));

    document.getElementById('btn-emoji').addEventListener('click', function(e) { e.stopPropagation(); document.getElementById('emoji-picker').classList.toggle('hidden'); document.getElementById('dice-picker').classList.add('hidden'); });
    document.getElementById('image-upload-input').addEventListener('change', function(e) { self.handleImageUpload(e); });
    document.getElementById('btn-shopping').addEventListener('click', function() { self.openShoppingModal(); });
    document.getElementById('close-shopping').addEventListener('click', function() { self.closeModal('shopping-modal'); });
    document.getElementById('cancel-shopping').addEventListener('click', function() { self.closeModal('shopping-modal'); });
    document.getElementById('confirm-shopping').addEventListener('click', function() { self.sendShoppingList(); });
    document.getElementById('add-custom-item').addEventListener('click', function() { self.addCustomShoppingItem(); });
    document.getElementById('custom-item-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); self.addCustomShoppingItem(); } });
    document.getElementById('btn-dice').addEventListener('click', function(e) { e.stopPropagation(); document.getElementById('dice-picker').classList.toggle('hidden'); document.getElementById('emoji-picker').classList.add('hidden'); });

    document.addEventListener('click', function(e) {
      var emoji = document.getElementById('emoji-picker');
      var dice = document.getElementById('dice-picker');
      var popup = document.getElementById('user-popup');
      if (!emoji.contains(e.target) && e.target.id !== 'btn-emoji') emoji.classList.add('hidden');
      if (!dice.contains(e.target) && e.target.id !== 'btn-dice') dice.classList.add('hidden');
      if (!popup.classList.contains('hidden') && !popup.contains(e.target) && !e.target.classList.contains('msg-username')) popup.classList.add('hidden');
    });
    document.querySelectorAll('.modal-overlay').forEach(function(o) { o.addEventListener('click', function(e) { if (e.target === o) o.classList.add('hidden'); }); });
  }

  // Emoji
  buildEmojiPicker() { document.getElementById('emoji-picker').innerHTML = EMOJI_LIST.map(function(e) { return '<span onclick="app.insertEmoji(\'' + e + '\')">' + e + '</span>'; }).join(''); }
  insertEmoji(emoji) { var input = document.getElementById('message-input'); input.value += emoji; input.focus(); document.getElementById('emoji-picker').classList.add('hidden'); }

  // Dice
  buildDicePicker() {
    document.getElementById('dice-picker').innerHTML = '<div class="dice-picker-title">Бросить кубик</div>' +
      DICE_TYPES.map(function(d) { return '<div class="dice-option" onclick="app.rollDice(\'' + d.id + '\')"><span class="dice-emoji">' + d.emoji + '</span><span class="dice-label">' + d.name + '</span><span class="dice-range">1-' + d.sides + '</span></div>'; }).join('');
  }
  rollDice(diceType) { this.socket.emit('dice:roll', { diceType: diceType, roomId: this.currentView === 'general' ? null : this.currentView }); document.getElementById('dice-picker').classList.add('hidden'); }

  // Image
  async handleImageUpload(e) {
    var file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast('Макс. 10MB', 'error'); return; }
    showToast('Загрузка...', 'info');
    try {
      var formData = new FormData();
      formData.append('image', file);
      var response = await fetch(API_URL + '/upload/chat-image', { method: 'POST', headers: { 'Authorization': 'Bearer ' + getToken() }, body: formData });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error);
      this.socket.emit('image:message', { imageUrl: data.imageUrl, content: '', roomId: this.currentView === 'general' ? null : this.currentView });
      showToast('Отправлено!', 'success');
    } catch (err) { showToast(err.message || 'Ошибка', 'error'); }
    e.target.value = '';
  }

  // Shopping
  buildShoppingModal() {
    var html = '';
    for (var cat in SHOPPING_CATEGORIES) {
      html += '<div class="shopping-cat-group"><div class="shopping-cat-title" onclick="this.nextElementSibling.classList.toggle(\'open\')">▶ ' + cat + '</div><div class="shopping-cat-items">';
      SHOPPING_CATEGORIES[cat].forEach(function(item) { html += '<div class="shopping-product-tag" onclick="app.toggleShoppingProduct(this,\'' + escapeHTML(item) + '\',\'' + escapeHTML(cat) + '\')">' + escapeHTML(item) + '</div>'; });
      html += '</div></div>';
    }
    document.getElementById('shopping-categories').innerHTML = html;
  }
  openShoppingModal() { this.selectedShoppingItems = []; document.getElementById('shopping-title-input').value = 'Список покупок'; document.getElementById('custom-item-input').value = ''; document.querySelectorAll('.shopping-product-tag').forEach(function(t) { t.classList.remove('selected'); }); this.renderSelectedItems(); document.getElementById('shopping-modal').classList.remove('hidden'); }
  toggleShoppingProduct(el, name, category) { var idx = this.selectedShoppingItems.findIndex(function(i) { return i.name === name; }); if (idx >= 0) { this.selectedShoppingItems.splice(idx, 1); el.classList.remove('selected'); } else { this.selectedShoppingItems.push({ name: name, category: category }); el.classList.add('selected'); } this.renderSelectedItems(); }
  addCustomShoppingItem() { var input = document.getElementById('custom-item-input'); var name = input.value.trim(); if (!name) return; if (!this.selectedShoppingItems.find(function(i) { return i.name === name; })) { this.selectedShoppingItems.push({ name: name, category: 'Другое' }); this.renderSelectedItems(); } input.value = ''; }
  renderSelectedItems() { var preview = document.getElementById('selected-items-preview'); if (this.selectedShoppingItems.length === 0) { preview.innerHTML = '<span style="color:var(--text-muted);font-size:13px;">Товары не выбраны</span>'; return; } preview.innerHTML = this.selectedShoppingItems.map(function(item, i) { return '<div class="selected-item-chip">' + escapeHTML(item.name) + '<span class="remove-chip" onclick="app.removeShoppingItem(' + i + ')">✕</span></div>'; }).join(''); }
  removeShoppingItem(index) { var item = this.selectedShoppingItems[index]; this.selectedShoppingItems.splice(index, 1); document.querySelectorAll('.shopping-product-tag').forEach(function(t) { if (t.textContent === item.name) t.classList.remove('selected'); }); this.renderSelectedItems(); }
  sendShoppingList() { if (this.selectedShoppingItems.length === 0) { showToast('Добавьте товары', 'error'); return; } this.socket.emit('shopping:create', { title: document.getElementById('shopping-title-input').value.trim() || 'Список покупок', items: this.selectedShoppingItems, roomId: this.currentView === 'general' ? null : this.currentView }); this.closeModal('shopping-modal'); showToast('Список отправлен!', 'success'); }
  async toggleShoppingItem(messageId, itemId) { try { await apiRequest('/messages/shopping/' + messageId + '/toggle/' + itemId, { method: 'POST' }); } catch (e) { showToast('Ошибка', 'error'); } }

  // Messages
  async loadGeneralMessages() {
    try { var data = await apiRequest('/messages/general'); this.messagesCache['general'] = data.messages; this.renderMessages(data.messages); } catch (e) { console.error(e); }
  }
  async loadRoomMessages(roomId) {
    // Show cached first for speed
    if (this.messagesCache[roomId]) {
      this.renderMessages(this.messagesCache[roomId]);
    }
    try {
      var data = await apiRequest('/messages/room/' + roomId);
      this.messagesCache[roomId] = data.messages;
      this.renderMessages(data.messages);
    } catch (e) { showToast('Ошибка загрузки', 'error'); }
  }
  renderMessages(messages) {
    var container = document.getElementById('messages-container');
    var self = this;
    if (messages.length === 0) { container.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><h3>Пока нет сообщений</h3><p>Будьте первым!</p></div>'; return; }
    container.innerHTML = messages.map(function(msg) { return self.createMessageHTML(msg); }).join('');
    this.scrollToBottom();
  }
  appendMessage(msg) {
    var container = document.getElementById('messages-container');
    var empty = container.querySelector('.empty-state');
    if (empty) empty.remove();
    var d = document.createElement('div');
    d.innerHTML = this.createMessageHTML(msg);
    if (d.firstElementChild) container.appendChild(d.firstElementChild);
    // Update cache
    if (!this.messagesCache[this.currentView]) this.messagesCache[this.currentView] = [];
    this.messagesCache[this.currentView].push(msg);
    this.scrollToBottom();
  }
  createMessageHTML(msg) {
    if (!msg.sender) return '';
    var isOwn = msg.sender._id === this.currentUser._id;
    var avatar = createMiniAvatarHTML(msg.sender, 36);
    var dn = getDisplayName(msg.sender);
    var sc = getAvatarColor(msg.sender);
    var bodyContent = '';
    if (msg.type === 'text') { bodyContent = '<div class="msg-text">' + escapeHTML(msg.content) + '</div>'; }
    else if (msg.type === 'image') { bodyContent = (msg.content ? '<div class="msg-text">' + escapeHTML(msg.content) + '</div>' : '') + '<img class="msg-image" src="' + msg.imageUrl + '" onclick="app.openImageFullscreen(\'' + msg.imageUrl + '\')" loading="lazy">'; }
    else if (msg.type === 'shopping') { bodyContent = createShoppingListHTML(msg); }
    else if (msg.type === 'dice') { bodyContent = createDiceHTML(msg); }
    else if (msg.type === 'system') { return '<div class="message system-message"><div class="msg-content"><div class="msg-text">' + escapeHTML(msg.content) + '</div></div></div>'; }
    return '<div class="message ' + (isOwn ? 'own-message' : '') + '" data-msg-id="' + msg._id + '"><div class="msg-avatar">' + avatar + '</div><div class="msg-content"><div class="msg-header"><span class="msg-username" style="color:' + sc + '" onclick="app.showUserPopup(event,\'' + msg.sender._id + '\')">' + escapeHTML(dn) + '</span><span class="msg-time">' + formatTime(msg.createdAt) + '</span></div><div class="msg-body">' + bodyContent + '</div></div></div>';
  }
  openImageFullscreen(url) { document.getElementById('fullscreen-img').src = url; document.getElementById('image-fullscreen').classList.remove('hidden'); }
  sendMessage() {
    var input = document.getElementById('message-input');
    var content = input.value.trim();
    if (!content) return;
    if (this.currentView === 'general') this.socket.emit('general:message', { content: content });
    else this.socket.emit('room:message', { content: content, roomId: this.currentView });
    input.value = '';
    input.style.height = 'auto';
    this.isTyping = false;
    this.socket.emit('typing:stop', { roomId: this.currentView === 'general' ? null : this.currentView });
  }
  scrollToBottom() { var c = document.getElementById('messages-container'); setTimeout(function() { c.scrollTop = c.scrollHeight; }, 50); }

  // Typing
  handleTyping() {
    var roomId = this.currentView === 'general' ? null : this.currentView;
    var self = this;
    if (!this.isTyping) { this.isTyping = true; this.socket.emit('typing:start', { roomId: roomId }); }
    clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(function() { self.isTyping = false; self.socket.emit('typing:stop', { roomId: roomId }); }, 2000);
  }
  renderTyping() {
    var ind = document.getElementById('typing-indicator');
    if (this.typingUsers.size === 0) { ind.innerHTML = ''; return; }
    var names = Array.from(this.typingUsers.values());
    ind.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div><span>' + (names.length === 1 ? names[0] + ' печатает' : names.join(', ') + ' печатают') + '...</span>';
  }

  // Unread
  updateUnreadBadges() {
    var self = this;
    var generalNav = document.getElementById('nav-general');
    var eb = generalNav.querySelector('.nav-badge');
    if (eb) eb.remove();
    var gc = this.unreadCounts['general'] || 0;
    if (gc > 0) { var b = document.createElement('span'); b.className = 'nav-badge'; b.textContent = gc > 99 ? '99+' : gc; generalNav.appendChild(b); }
    document.querySelectorAll('.room-item').forEach(function(el) {
      var rid = el.dataset.roomId;
      var exb = el.querySelector('.room-badge');
      if (exb) exb.remove();
      var c = self.unreadCounts[rid] || 0;
      if (c > 0) { var badge = document.createElement('span'); badge.className = 'room-badge'; badge.textContent = c > 99 ? '99+' : c; el.appendChild(badge); }
    });
  }

  // Views
  async switchView(viewId) {
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
      // Show cached immediately
      if (this.messagesCache['general']) this.renderMessages(this.messagesCache['general']);
      await this.loadGeneralMessages();
    } else {
      var roomEl = document.querySelector('.room-item[data-room-id="' + viewId + '"]');
      if (roomEl) roomEl.classList.add('active');
      try {
        // Use cached room info if available
        var room;
        if (this.roomsCache[viewId]) {
          room = this.roomsCache[viewId];
          document.getElementById('chat-title').textContent = '# ' + room.name;
          var isOwner = room.owner._id === this.currentUser._id;
          document.getElementById('chat-header-actions').innerHTML =
            '<button class="btn-icon" onclick="app.showRoomInfo(\'' + viewId + '\')" title="Инфо">ℹ️</button>' +
            (isOwner ? '<button class="btn-icon" onclick="app.openAddMemberModal(\'' + viewId + '\')" title="Добавить">👤+</button>' : '') +
            '<button class="btn-icon" onclick="app.leaveRoom(\'' + viewId + '\')" title="Выйти">🚪</button>';
        }
        this.socket.emit('room:join', viewId);
        await this.loadRoomMessages(viewId);
        // Fetch fresh room data in background
        var data = await apiRequest('/rooms/' + viewId);
        room = data.room;
        this.roomsCache[viewId] = room;
        document.getElementById('chat-title').textContent = '# ' + room.name;
        var isOwner2 = room.owner._id === this.currentUser._id;
        document.getElementById('chat-header-actions').innerHTML =
          '<button class="btn-icon" onclick="app.showRoomInfo(\'' + viewId + '\')" title="Инфо">ℹ️</button>' +
          (isOwner2 ? '<button class="btn-icon" onclick="app.openAddMemberModal(\'' + viewId + '\')" title="Добавить">👤+</button>' : '') +
          '<button class="btn-icon" onclick="app.leaveRoom(\'' + viewId + '\')" title="Выйти">🚪</button>';
      } catch (e) { showToast('Ошибка', 'error'); this.switchView('general'); return; }
    }
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
    document.getElementById('message-input').focus();
  }

  // Online
  renderOnlineUsers() {
    var list = document.getElementById('online-users-list');
    var count = this.onlineUsers.length;
    document.getElementById('online-count').textContent = count + ' онлайн';
    document.getElementById('online-panel-count').textContent = count;
    list.innerHTML = this.onlineUsers.map(function(u) {
      return '<div class="online-user-item" onclick="app.showUserPopup(event,\'' + u._id + '\')"><div style="position:relative;">' + createMiniAvatarHTML(u, 32) + '<div style="width:10px;height:10px;border-radius:50%;background:#00b894;position:absolute;bottom:-2px;right:-2px;border:2px solid var(--bg-sidebar);"></div></div><span class="user-name">' + escapeHTML(getDisplayName(u)) + '</span></div>';
    }).join('');
  }

  // User Popup
  async showUserPopup(event, userId) {
    event.stopPropagation();
    try {
      var data = await apiRequest('/users/' + userId);
      var u = data.user;
      var popup = document.getElementById('user-popup');
      var bd = u.profile && u.profile.birthDate ? new Date(u.profile.birthDate).toLocaleDateString('ru-RU') : null;
      popup.innerHTML = '<div class="user-popup-header">' + createAvatarHTML(u) + '<div class="user-popup-info"><h3>' + escapeHTML(getDisplayName(u)) + '</h3><div class="popup-username">@' + escapeHTML(u.username) + '</div></div></div>' +
        (u.profile && u.profile.bio ? '<div class="user-popup-bio">' + escapeHTML(u.profile.bio) + '</div>' : '') +
        '<div class="user-popup-details">' +
        (u.status === 'online' ? '<div class="detail-item"><span>🟢</span><span>Онлайн</span></div>' : '<div class="detail-item"><span>⚫</span><span>Был(а) ' + formatTime(u.lastSeen) + '</span></div>') +
        (u.profile && u.profile.location ? '<div class="detail-item"><span>📍</span><span>' + escapeHTML(u.profile.location) + '</span></div>' : '') +
        (bd ? '<div class="detail-item"><span>🎂</span><span>' + bd + '</span></div>' : '') + '</div>';
      var rect = event.target.getBoundingClientRect();
      popup.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px';
      popup.style.top = Math.min(rect.bottom + 8, window.innerHeight - 250) + 'px';
      popup.classList.remove('hidden');
    } catch (e) {}
  }

  // Rooms
  async loadRooms() {
    try {
      var data = await apiRequest('/rooms');
      var self = this;
      data.rooms.forEach(function(r) { self.roomsCache[r._id] = r; });
      this.renderRooms(data.rooms);
    } catch (e) {}
  }
  renderRooms(rooms) {
    var list = document.getElementById('rooms-list');
    var self = this;
    if (rooms.length === 0) { list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px;">Нет комнат</div>'; return; }
    list.innerHTML = rooms.map(function(r) {
      return '<div class="room-item ' + (self.currentView === r._id ? 'active' : '') + '" data-room-id="' + r._id + '" onclick="app.switchView(\'' + r._id + '\')"><div class="room-icon" style="background:' + (r.color || '#6c5ce7') + '">' + r.name[0].toUpperCase() + '</div><div class="room-info"><div class="room-name">' + escapeHTML(r.name) + '</div><div class="room-members-count">' + r.members.length + ' уч.</div></div></div>';
    }).join('');
    this.updateUnreadBadges();
  }

  async openCreateRoomModal() { document.getElementById('room-name-input').value = ''; document.getElementById('room-desc-input').value = ''; document.getElementById('member-search').value = ''; await this.searchUsersForRoom('', 'members-checkbox-list'); document.getElementById('create-room-modal').classList.remove('hidden'); }
  async searchUsersForRoom(q, cid) { try { var data = await apiRequest('/users?search=' + encodeURIComponent(q)); var self = this; document.getElementById(cid).innerHTML = data.users.filter(function(u) { return u._id !== self.currentUser._id; }).map(function(u) { return '<label class="user-checkbox"><input type="checkbox" value="' + u._id + '" class="room-member-checkbox"><span class="checkmark">✓</span><div class="check-user-info">' + createMiniAvatarHTML(u, 28) + '<span>' + escapeHTML(u.username) + '</span></div></label>'; }).join(''); } catch (e) {} }
  async createRoom() {
    var name = document.getElementById('room-name-input').value.trim();
    if (!name) { showToast('Введите название', 'error'); return; }
    var members = Array.from(document.querySelectorAll('#members-checkbox-list .room-member-checkbox:checked')).map(function(c) { return c.value; });
    try {
      var data = await apiRequest('/rooms', { method: 'POST', body: JSON.stringify({ name: name, description: document.getElementById('room-desc-input').value.trim(), members: members }) });
      showToast('Создана!', 'success');
      this.closeModal('create-room-modal');
      await this.loadRooms();
      if (data.room && data.room._id) { this.socket.emit('room:join', data.room._id); this.socket.emit('room:created', { roomId: data.room._id }); }
    } catch (e) { showToast(e.message, 'error'); }
  }
  async showRoomInfo(roomId) {
    try {
      var data = await apiRequest('/rooms/' + roomId);
      var r = data.room;
      document.getElementById('room-info-title').textContent = r.name;
      document.getElementById('room-info-desc').textContent = r.description || 'Нет описания';
      document.getElementById('room-members-list').innerHTML = r.members.map(function(m) { return '<div class="online-user-item">' + createMiniAvatarHTML(m, 32) + '<span class="user-name">' + escapeHTML(getDisplayName(m)) + '</span>' + (m._id === r.owner._id ? '<span style="color:var(--warning);font-size:11px;">👑</span>' : '') + '</div>'; }).join('');
      document.getElementById('room-admin-actions').innerHTML = r.owner._id === this.currentUser._id ? '<button class="btn btn-danger btn-sm" onclick="app.deleteRoom(\'' + roomId + '\')">🗑 Удалить</button>' : '';
      document.getElementById('room-info-modal').classList.remove('hidden');
    } catch (e) { showToast('Ошибка', 'error'); }
  }
  async openAddMemberModal(roomId) { this.addMemberRoomId = roomId; document.getElementById('add-member-search').value = ''; await this.searchUsersForAddMember(''); document.getElementById('add-member-modal').classList.remove('hidden'); }
  async searchUsersForAddMember(q) {
    try {
      var rd = await apiRequest('/rooms/' + this.addMemberRoomId);
      var mids = rd.room.members.map(function(m) { return m._id; });
      var data = await apiRequest('/users?search=' + encodeURIComponent(q));
      var users = data.users.filter(function(u) { return mids.indexOf(u._id) === -1; });
      document.getElementById('add-members-list').innerHTML = users.length === 0 ? '<div style="text-align:center;padding:16px;color:var(--text-muted);">Все добавлены</div>' :
        users.map(function(u) { return '<label class="user-checkbox"><input type="checkbox" value="' + u._id + '" class="add-member-checkbox"><span class="checkmark">✓</span><div class="check-user-info">' + createMiniAvatarHTML(u, 28) + '<span>' + escapeHTML(u.username) + '</span></div></label>'; }).join('');
    } catch (e) {}
  }
  async addMembersToRoom() {
    var ids = Array.from(document.querySelectorAll('#add-members-list .add-member-checkbox:checked')).map(function(c) { return c.value; });
    if (!ids.length) { showToast('Выберите', 'error'); return; }
    try { for (var i = 0; i < ids.length; i++) await apiRequest('/rooms/' + this.addMemberRoomId + '/members', { method: 'POST', body: JSON.stringify({ userId: ids[i] }) }); showToast('Добавлены!', 'success'); this.closeModal('add-member-modal'); await this.loadRooms(); } catch (e) { showToast(e.message, 'error'); }
  }
  async leaveRoom(rid) { if (!confirm('Покинуть?')) return; try { await apiRequest('/rooms/' + rid + '/leave', { method: 'POST' }); delete this.roomsCache[rid]; delete this.messagesCache[rid]; this.switchView('general'); await this.loadRooms(); } catch (e) { showToast(e.message, 'error'); } }
  async deleteRoom(rid) { if (!confirm('Удалить?')) return; try { await apiRequest('/rooms/' + rid, { method: 'DELETE' }); delete this.roomsCache[rid]; delete this.messagesCache[rid]; this.closeModal('room-info-modal'); this.switchView('general'); await this.loadRooms(); } catch (e) { showToast(e.message, 'error'); } }

  renderSidebarProfile() {
    var u = this.currentUser;
    document.getElementById('sidebar-user-profile').innerHTML = '<div style="position:relative;">' + createMiniAvatarHTML(u, 40) + '<div class="status-dot online"></div></div><div class="user-info"><div class="user-name">' + escapeHTML(getDisplayName(u)) + '</div><div class="user-status">Онлайн</div></div>';
  }
  closeModal(id) { document.getElementById(id).classList.add('hidden'); }
}

var app;
document.addEventListener('DOMContentLoaded', function() { app = new ChatApp(); });