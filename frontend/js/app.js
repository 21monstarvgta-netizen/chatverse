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
    this.init();
  }

  async init() {
    if (!requireAuth()) return;
    try {
      const data = await apiRequest('/auth/me');
      this.currentUser = data.user;
      setUser(data.user);
      this.initSocket();
      this.setupUI();
      this.setupEventListeners();
      await this.loadGeneralMessages();
      await this.loadRooms();
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
    this.socket.on('connect', () => console.log('Socket connected'));
    this.socket.on('general:message', (msg) => { if (this.currentView === 'general') this.appendMessage(msg); });
    this.socket.on('room:message', (data) => { if (this.currentView === data.roomId) this.appendMessage(data.message); });
    this.socket.on('users:online', (users) => { this.onlineUsers = users; this.renderOnlineUsers(); });
    this.socket.on('typing:start', (data) => {
      const tv = data.roomId || 'general';
      if (this.currentView === tv && data.userId !== this.currentUser._id) { this.typingUsers.set(data.userId, data.username); this.renderTyping(); }
    });
    this.socket.on('typing:stop', (data) => { this.typingUsers.delete(data.userId); this.renderTyping(); });
    this.socket.on('shopping:update', (data) => {
      const targetView = data.roomId || 'general';
      if (this.currentView === targetView) {
        const el = document.querySelector('[data-msg-id="' + data.messageId + '"]');
        if (el) {
          const contentEl = el.querySelector('.msg-body');
          if (contentEl) contentEl.innerHTML = createShoppingListHTML(data.message);
        }
      }
    });
    this.socket.on('error', (data) => showToast(data.message, 'error'));
  }

  setupUI() { this.renderSidebarProfile(); this.buildEmojiPicker(); this.buildDicePicker(); this.buildShoppingModal(); }

  setupEventListeners() {
    document.getElementById('send-btn').addEventListener('click', () => this.sendMessage());
    const msgInput = document.getElementById('message-input');
    msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); } });
    msgInput.addEventListener('input', () => { msgInput.style.height = 'auto'; msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px'; this.handleTyping(); });

    document.getElementById('nav-general').addEventListener('click', () => this.switchView('general'));
    document.getElementById('btn-profile').addEventListener('click', () => { window.location.href = '/profile.html'; });
    document.getElementById('btn-logout').addEventListener('click', () => { if (this.socket) this.socket.disconnect(); removeToken(); window.location.href = '/login.html'; });
    document.getElementById('mobile-menu-btn').addEventListener('click', () => { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('sidebar-overlay').classList.toggle('show'); });
    document.getElementById('sidebar-overlay').addEventListener('click', () => { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebar-overlay').classList.remove('show'); });

    // Room modals
    document.getElementById('btn-create-room').addEventListener('click', () => this.openCreateRoomModal());
    document.getElementById('close-create-room').addEventListener('click', () => this.closeModal('create-room-modal'));
    document.getElementById('cancel-create-room').addEventListener('click', () => this.closeModal('create-room-modal'));
    document.getElementById('confirm-create-room').addEventListener('click', () => this.createRoom());
    document.getElementById('close-room-info').addEventListener('click', () => this.closeModal('room-info-modal'));
    document.getElementById('close-add-member').addEventListener('click', () => this.closeModal('add-member-modal'));
    document.getElementById('cancel-add-member').addEventListener('click', () => this.closeModal('add-member-modal'));
    document.getElementById('confirm-add-member').addEventListener('click', () => this.addMembersToRoom());
    document.getElementById('member-search').addEventListener('input', debounce((e) => this.searchUsersForRoom(e.target.value, 'members-checkbox-list'), 300));
    document.getElementById('add-member-search').addEventListener('input', debounce((e) => this.searchUsersForAddMember(e.target.value), 300));

    // Emoji
    document.getElementById('btn-emoji').addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('emoji-picker').classList.toggle('hidden'); document.getElementById('dice-picker').classList.add('hidden'); });

    // Image upload
    document.getElementById('image-upload-input').addEventListener('change', (e) => this.handleImageUpload(e));

    // Shopping
    document.getElementById('btn-shopping').addEventListener('click', () => this.openShoppingModal());
    document.getElementById('close-shopping').addEventListener('click', () => this.closeModal('shopping-modal'));
    document.getElementById('cancel-shopping').addEventListener('click', () => this.closeModal('shopping-modal'));
    document.getElementById('confirm-shopping').addEventListener('click', () => this.sendShoppingList());
    document.getElementById('add-custom-item').addEventListener('click', () => this.addCustomShoppingItem());
    document.getElementById('custom-item-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.addCustomShoppingItem(); } });

    // Dice
    document.getElementById('btn-dice').addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('dice-picker').classList.toggle('hidden'); document.getElementById('emoji-picker').classList.add('hidden'); });

    // Close popups on outside click
    document.addEventListener('click', (e) => {
      const emoji = document.getElementById('emoji-picker');
      const dice = document.getElementById('dice-picker');
      const popup = document.getElementById('user-popup');
      if (!emoji.contains(e.target) && e.target.id !== 'btn-emoji') emoji.classList.add('hidden');
      if (!dice.contains(e.target) && e.target.id !== 'btn-dice') dice.classList.add('hidden');
      if (!popup.classList.contains('hidden') && !popup.contains(e.target) && !e.target.classList.contains('msg-username')) popup.classList.add('hidden');
    });
    document.querySelectorAll('.modal-overlay').forEach(o => { o.addEventListener('click', (e) => { if (e.target === o) o.classList.add('hidden'); }); });
  }

  // ===== Emoji =====
  buildEmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    picker.innerHTML = EMOJI_LIST.map(e => '<span onclick="app.insertEmoji(\'' + e + '\')">' + e + '</span>').join('');
  }
  insertEmoji(emoji) {
    const input = document.getElementById('message-input');
    input.value += emoji;
    input.focus();
    document.getElementById('emoji-picker').classList.add('hidden');
  }

  // ===== Dice =====
  buildDicePicker() {
    const picker = document.getElementById('dice-picker');
    picker.innerHTML = '<div class="dice-picker-title">Бросить кубик</div>' +
      DICE_TYPES.map(d => '<div class="dice-option" onclick="app.rollDice(\'' + d.id + '\')">' +
        '<span class="dice-emoji">' + d.emoji + '</span>' +
        '<span class="dice-label">' + d.name + '</span>' +
        '<span class="dice-range">1-' + d.sides + '</span></div>').join('');
  }
  rollDice(diceType) {
    const roomId = this.currentView === 'general' ? null : this.currentView;
    this.socket.emit('dice:roll', { diceType, roomId });
    document.getElementById('dice-picker').classList.add('hidden');
  }

  // ===== Image Upload =====
  async handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast('Макс. размер 10MB', 'error'); return; }
    showToast('Загрузка изображения...', 'info');
    try {
      const formData = new FormData();
      formData.append('image', file);
      const response = await fetch(API_URL + '/upload/chat-image', { method: 'POST', headers: { 'Authorization': 'Bearer ' + getToken() }, body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const roomId = this.currentView === 'general' ? null : this.currentView;
      this.socket.emit('image:message', { imageUrl: data.imageUrl, content: '', roomId });
      showToast('Изображение отправлено!', 'success');
    } catch (err) { showToast(err.message || 'Ошибка загрузки', 'error'); }
    e.target.value = '';
  }

  // ===== Shopping =====
  buildShoppingModal() {
    const container = document.getElementById('shopping-categories');
    let html = '';
    for (const cat in SHOPPING_CATEGORIES) {
      html += '<div class="shopping-cat-group"><div class="shopping-cat-title" onclick="this.nextElementSibling.classList.toggle(\'open\')">▶ ' + cat + '</div>';
      html += '<div class="shopping-cat-items">';
      SHOPPING_CATEGORIES[cat].forEach(item => {
        html += '<div class="shopping-product-tag" onclick="app.toggleShoppingProduct(this,\'' + escapeHTML(item) + '\',\'' + escapeHTML(cat) + '\')">' + escapeHTML(item) + '</div>';
      });
      html += '</div></div>';
    }
    container.innerHTML = html;
  }

  openShoppingModal() {
    this.selectedShoppingItems = [];
    document.getElementById('shopping-title-input').value = 'Список покупок';
    document.getElementById('custom-item-input').value = '';
    document.querySelectorAll('.shopping-product-tag').forEach(t => t.classList.remove('selected'));
    this.renderSelectedItems();
    document.getElementById('shopping-modal').classList.remove('hidden');
  }

  toggleShoppingProduct(el, name, category) {
    const idx = this.selectedShoppingItems.findIndex(i => i.name === name);
    if (idx >= 0) { this.selectedShoppingItems.splice(idx, 1); el.classList.remove('selected'); }
    else { this.selectedShoppingItems.push({ name, category }); el.classList.add('selected'); }
    this.renderSelectedItems();
  }

  addCustomShoppingItem() {
    const input = document.getElementById('custom-item-input');
    const name = input.value.trim();
    if (!name) return;
    if (!this.selectedShoppingItems.find(i => i.name === name)) {
      this.selectedShoppingItems.push({ name, category: 'Другое' });
      this.renderSelectedItems();
    }
    input.value = '';
  }

  renderSelectedItems() {
    const preview = document.getElementById('selected-items-preview');
    if (this.selectedShoppingItems.length === 0) { preview.innerHTML = '<span style="color:var(--text-muted);font-size:13px;">Товары не выбраны</span>'; return; }
    preview.innerHTML = this.selectedShoppingItems.map((item, i) =>
      '<div class="selected-item-chip">' + escapeHTML(item.name) + '<span class="remove-chip" onclick="app.removeShoppingItem(' + i + ')">✕</span></div>'
    ).join('');
  }

  removeShoppingItem(index) {
    const item = this.selectedShoppingItems[index];
    this.selectedShoppingItems.splice(index, 1);
    document.querySelectorAll('.shopping-product-tag').forEach(t => { if (t.textContent === item.name) t.classList.remove('selected'); });
    this.renderSelectedItems();
  }

  sendShoppingList() {
    if (this.selectedShoppingItems.length === 0) { showToast('Добавьте товары', 'error'); return; }
    const title = document.getElementById('shopping-title-input').value.trim() || 'Список покупок';
    const roomId = this.currentView === 'general' ? null : this.currentView;
    this.socket.emit('shopping:create', { title, items: this.selectedShoppingItems, roomId });
    this.closeModal('shopping-modal');
    showToast('Список отправлен!', 'success');
  }

  async toggleShoppingItem(messageId, itemId) {
    try { await apiRequest('/messages/shopping/' + messageId + '/toggle/' + itemId, { method: 'POST' }); }
    catch (e) { showToast('Ошибка', 'error'); }
  }

  // ===== Messages =====
  async loadGeneralMessages() {
    try { const data = await apiRequest('/messages/general'); this.renderMessages(data.messages); } catch (e) { console.error(e); }
  }
  async loadRoomMessages(roomId) {
    try { const data = await apiRequest('/messages/room/' + roomId); this.renderMessages(data.messages); } catch (e) { showToast('Ошибка загрузки', 'error'); }
  }

  renderMessages(messages) {
    const container = document.getElementById('messages-container');
    if (messages.length === 0) { container.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><h3>Пока нет сообщений</h3><p>Будьте первым!</p></div>'; return; }
    container.innerHTML = messages.map(msg => this.createMessageHTML(msg)).join('');
    this.scrollToBottom();
  }

  appendMessage(msg) {
    const container = document.getElementById('messages-container');
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();
    const d = document.createElement('div');
    d.innerHTML = this.createMessageHTML(msg);
    if (d.firstElementChild) container.appendChild(d.firstElementChild);
    this.scrollToBottom();
  }

  createMessageHTML(msg) {
    if (!msg.sender) return '';
    const isOwn = msg.sender._id === this.currentUser._id;
    const avatar = createMiniAvatarHTML(msg.sender, 36);
    const dn = getDisplayName(msg.sender);
    const sc = getAvatarColor(msg.sender);

    let bodyContent = '';
    if (msg.type === 'text') {
      bodyContent = '<div class="msg-text">' + escapeHTML(msg.content) + '</div>';
    } else if (msg.type === 'image') {
      bodyContent = (msg.content ? '<div class="msg-text">' + escapeHTML(msg.content) + '</div>' : '') +
        '<img class="msg-image" src="' + msg.imageUrl + '" onclick="app.openImageFullscreen(\'' + msg.imageUrl + '\')" loading="lazy">';
    } else if (msg.type === 'shopping') {
      bodyContent = createShoppingListHTML(msg);
    } else if (msg.type === 'dice') {
      bodyContent = createDiceHTML(msg);
    } else if (msg.type === 'system') {
      return '<div class="message system-message"><div class="msg-content"><div class="msg-text">' + escapeHTML(msg.content) + '</div></div></div>';
    }

    return '<div class="message ' + (isOwn ? 'own-message' : '') + '" data-msg-id="' + msg._id + '">' +
      '<div class="msg-avatar">' + avatar + '</div>' +
      '<div class="msg-content"><div class="msg-header">' +
      '<span class="msg-username" style="color:' + sc + '" onclick="app.showUserPopup(event,\'' + msg.sender._id + '\')">' + escapeHTML(dn) + '</span>' +
      '<span class="msg-time">' + formatTime(msg.createdAt) + '</span></div>' +
      '<div class="msg-body">' + bodyContent + '</div></div></div>';
  }

  openImageFullscreen(url) {
    document.getElementById('fullscreen-img').src = url;
    document.getElementById('image-fullscreen').classList.remove('hidden');
  }

  sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content) return;
    if (this.currentView === 'general') this.socket.emit('general:message', { content });
    else this.socket.emit('room:message', { content, roomId: this.currentView });
    input.value = '';
    input.style.height = 'auto';
    this.isTyping = false;
    this.socket.emit('typing:stop', { roomId: this.currentView === 'general' ? null : this.currentView });
  }

  scrollToBottom() { const c = document.getElementById('messages-container'); setTimeout(() => { c.scrollTop = c.scrollHeight; }, 50); }

  handleTyping() {
    const roomId = this.currentView === 'general' ? null : this.currentView;
    if (!this.isTyping) { this.isTyping = true; this.socket.emit('typing:start', { roomId }); }
    clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => { this.isTyping = false; this.socket.emit('typing:stop', { roomId }); }, 2000);
  }

  renderTyping() {
    const ind = document.getElementById('typing-indicator');
    if (this.typingUsers.size === 0) { ind.innerHTML = ''; return; }
    const names = Array.from(this.typingUsers.values());
    ind.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div><span>' + (names.length === 1 ? names[0] + ' печатает' : names.join(', ') + ' печатают') + '...</span>';
  }

  // ===== Views =====
  async switchView(viewId) {
    this.currentView = viewId;
    this.typingUsers.clear();
    this.renderTyping();
    document.querySelectorAll('.nav-item, .room-item').forEach(el => el.classList.remove('active'));
    if (viewId === 'general') {
      document.getElementById('nav-general').classList.add('active');
      document.getElementById('chat-title').textContent = '🌍 Общий чат';
      document.getElementById('chat-header-actions').innerHTML = '';
      await this.loadGeneralMessages();
    } else {
      const roomEl = document.querySelector('.room-item[data-room-id="' + viewId + '"]');
      if (roomEl) roomEl.classList.add('active');
      try {
        const data = await apiRequest('/rooms/' + viewId);
        const room = data.room;
        document.getElementById('chat-title').textContent = '# ' + room.name;
        const isOwner = room.owner._id === this.currentUser._id;
        document.getElementById('chat-header-actions').innerHTML =
          '<button class="btn-icon" onclick="app.showRoomInfo(\'' + viewId + '\')" title="Инфо">ℹ️</button>' +
          (isOwner ? '<button class="btn-icon" onclick="app.openAddMemberModal(\'' + viewId + '\')" title="Добавить">👤+</button>' : '') +
          '<button class="btn-icon" onclick="app.leaveRoom(\'' + viewId + '\')" title="Выйти">🚪</button>';
        this.socket.emit('room:join', viewId);
        await this.loadRoomMessages(viewId);
      } catch (e) { showToast('Ошибка', 'error'); this.switchView('general'); return; }
    }
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
    document.getElementById('message-input').focus();
  }

  // ===== Online =====
  renderOnlineUsers() {
    const list = document.getElementById('online-users-list');
    const count = this.onlineUsers.length;
    document.getElementById('online-count').textContent = count + ' онлайн';
    document.getElementById('online-panel-count').textContent = count;
    list.innerHTML = this.onlineUsers.map(u => {
      const av = createMiniAvatarHTML(u, 32);
      return '<div class="online-user-item" onclick="app.showUserPopup(event,\'' + u._id + '\')">' +
        '<div style="position:relative;">' + av + '<div style="width:10px;height:10px;border-radius:50%;background:#00b894;position:absolute;bottom:-2px;right:-2px;border:2px solid var(--bg-sidebar);"></div></div>' +
        '<span class="user-name">' + escapeHTML(getDisplayName(u)) + '</span></div>';
    }).join('');
  }

  // ===== User Popup =====
  async showUserPopup(event, userId) {
    event.stopPropagation();
    try {
      const data = await apiRequest('/users/' + userId);
      const u = data.user;
      const popup = document.getElementById('user-popup');
      const bd = u.profile && u.profile.birthDate ? new Date(u.profile.birthDate).toLocaleDateString('ru-RU') : null;
      popup.innerHTML = '<div class="user-popup-header">' + createAvatarHTML(u) +
        '<div class="user-popup-info"><h3>' + escapeHTML(getDisplayName(u)) + '</h3><div class="popup-username">@' + escapeHTML(u.username) + '</div></div></div>' +
        (u.profile && u.profile.bio ? '<div class="user-popup-bio">' + escapeHTML(u.profile.bio) + '</div>' : '') +
        '<div class="user-popup-details">' +
        (u.status === 'online' ? '<div class="detail-item"><span>🟢</span><span>Онлайн</span></div>' : '<div class="detail-item"><span>⚫</span><span>Был(а) ' + formatTime(u.lastSeen) + '</span></div>') +
        (u.profile && u.profile.location ? '<div class="detail-item"><span>📍</span><span>' + escapeHTML(u.profile.location) + '</span></div>' : '') +
        (bd ? '<div class="detail-item"><span>🎂</span><span>' + bd + '</span></div>' : '') +
        '</div>';
      const rect = event.target.getBoundingClientRect();
      popup.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
      popup.style.top = Math.min(rect.bottom + 8, window.innerHeight - 300) + 'px';
      popup.classList.remove('hidden');
    } catch (e) {}
  }

  // ===== Rooms =====
  async loadRooms() { try { const data = await apiRequest('/rooms'); this.renderRooms(data.rooms); } catch (e) {} }

  renderRooms(rooms) {
    const list = document.getElementById('rooms-list');
    if (rooms.length === 0) { list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">Нет комнат</div>'; return; }
    list.innerHTML = rooms.map(r =>
      '<div class="room-item ' + (this.currentView === r._id ? 'active' : '') + '" data-room-id="' + r._id + '" onclick="app.switchView(\'' + r._id + '\')">' +
      '<div class="room-icon" style="background:' + (r.color || '#6c5ce7') + '">' + r.name[0].toUpperCase() + '</div>' +
      '<div class="room-info"><div class="room-name">' + escapeHTML(r.name) + '</div><div class="room-members-count">' + r.members.length + ' уч.</div></div></div>'
    ).join('');
  }

  async openCreateRoomModal() {
    document.getElementById('room-name-input').value = '';
    document.getElementById('room-desc-input').value = '';
    document.getElementById('member-search').value = '';
    await this.searchUsersForRoom('', 'members-checkbox-list');
    document.getElementById('create-room-modal').classList.remove('hidden');
  }

  async searchUsersForRoom(q, cid) {
    try {
      const data = await apiRequest('/users?search=' + encodeURIComponent(q));
      document.getElementById(cid).innerHTML = data.users.filter(u => u._id !== this.currentUser._id).map(u =>
        '<label class="user-checkbox"><input type="checkbox" value="' + u._id + '" class="room-member-checkbox"><span class="checkmark">✓</span>' +
        '<div class="check-user-info">' + createMiniAvatarHTML(u, 28) + '<span>' + escapeHTML(u.username) + '</span></div></label>'
      ).join('');
    } catch (e) {}
  }

  async createRoom() {
    const name = document.getElementById('room-name-input').value.trim();
    if (!name) { showToast('Введите название', 'error'); return; }
    const members = Array.from(document.querySelectorAll('#members-checkbox-list .room-member-checkbox:checked')).map(c => c.value);
    try {
      const data = await apiRequest('/rooms', { method: 'POST', body: JSON.stringify({ name, description: document.getElementById('room-desc-input').value.trim(), members }) });
      showToast('Комната создана!', 'success');
      this.closeModal('create-room-modal');
      await this.loadRooms();
      if (data.room) this.socket.emit('room:join', data.room._id);
    } catch (e) { showToast(e.message, 'error'); }
  }

  async showRoomInfo(roomId) {
    try {
      const data = await apiRequest('/rooms/' + roomId);
      const r = data.room;
      document.getElementById('room-info-title').textContent = r.name;
      document.getElementById('room-info-desc').textContent = r.description || 'Нет описания';
      document.getElementById('room-members-list').innerHTML = r.members.map(m =>
        '<div class="online-user-item">' + createMiniAvatarHTML(m, 32) + '<span class="user-name">' + escapeHTML(getDisplayName(m)) + '</span>' +
        (m._id === r.owner._id ? '<span style="color:var(--warning);font-size:11px;">👑</span>' : '') + '</div>'
      ).join('');
      document.getElementById('room-admin-actions').innerHTML = r.owner._id === this.currentUser._id ? '<button class="btn btn-danger btn-sm" onclick="app.deleteRoom(\'' + roomId + '\')">🗑 Удалить</button>' : '';
      document.getElementById('room-info-modal').classList.remove('hidden');
    } catch (e) { showToast('Ошибка', 'error'); }
  }

  async openAddMemberModal(roomId) {
    this.addMemberRoomId = roomId;
    document.getElementById('add-member-search').value = '';
    await this.searchUsersForAddMember('');
    document.getElementById('add-member-modal').classList.remove('hidden');
  }

  async searchUsersForAddMember(q) {
    try {
      const rd = await apiRequest('/rooms/' + this.addMemberRoomId);
      const mids = rd.room.members.map(m => m._id);
      const data = await apiRequest('/users?search=' + encodeURIComponent(q));
      const users = data.users.filter(u => !mids.includes(u._id));
      document.getElementById('add-members-list').innerHTML = users.length === 0 ? '<div style="text-align:center;padding:20px;color:var(--text-muted);">Все добавлены</div>' :
        users.map(u => '<label class="user-checkbox"><input type="checkbox" value="' + u._id + '" class="add-member-checkbox"><span class="checkmark">✓</span>' +
          '<div class="check-user-info">' + createMiniAvatarHTML(u, 28) + '<span>' + escapeHTML(u.username) + '</span></div></label>').join('');
    } catch (e) {}
  }

  async addMembersToRoom() {
    const ids = Array.from(document.querySelectorAll('#add-members-list .add-member-checkbox:checked')).map(c => c.value);
    if (!ids.length) { showToast('Выберите', 'error'); return; }
    try {
      for (const id of ids) await apiRequest('/rooms/' + this.addMemberRoomId + '/members', { method: 'POST', body: JSON.stringify({ userId: id }) });
      showToast('Добавлены!', 'success');
      this.closeModal('add-member-modal');
      await this.loadRooms();
    } catch (e) { showToast(e.message, 'error'); }
  }

  async leaveRoom(rid) {
    if (!confirm('Покинуть?')) return;
    try { await apiRequest('/rooms/' + rid + '/leave', { method: 'POST' }); this.switchView('general'); await this.loadRooms(); } catch (e) { showToast(e.message, 'error'); }
  }

  async deleteRoom(rid) {
    if (!confirm('Удалить комнату?')) return;
    try { await apiRequest('/rooms/' + rid, { method: 'DELETE' }); this.closeModal('room-info-modal'); this.switchView('general'); await this.loadRooms(); } catch (e) { showToast(e.message, 'error'); }
  }

  renderSidebarProfile() {
    const u = this.currentUser;
    document.getElementById('sidebar-user-profile').innerHTML =
      '<div style="position:relative;">' + createMiniAvatarHTML(u, 40) + '<div class="status-dot online"></div></div>' +
      '<div class="user-info"><div class="user-name">' + escapeHTML(getDisplayName(u)) + '</div><div class="user-status">Онлайн</div></div>';
  }

  closeModal(id) { document.getElementById(id).classList.add('hidden'); }
}

let app;
document.addEventListener('DOMContentLoaded', () => { app = new ChatApp(); });