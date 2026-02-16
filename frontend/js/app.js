// ===== Main App Controller =====

class ChatApp {
  constructor() {
    this.currentUser = null;
    this.socket = null;
    this.currentView = 'general'; // 'general' or room id
    this.onlineUsers = [];
    this.typingUsers = new Map();
    this.typingTimeout = null;
    this.isTyping = false;

    this.init();
  }

  async init() {
    if (!requireAuth()) return;

    try {
      // Verify token and get user
      const data = await apiRequest('/auth/me');
      this.currentUser = data.user;
      setUser(data.user);

      // Initialize socket
      this.initSocket();

      // Setup UI
      this.setupUI();
      this.setupEventListeners();

      // Load initial data
      await this.loadGeneralMessages();
      await this.loadRooms();

      // Show app
      document.getElementById('loading-screen').classList.add('hidden');
      document.getElementById('chat-app').classList.remove('hidden');

    } catch (error) {
      console.error('Init error:', error);
      removeToken();
      window.location.href = '/login.html';
    }
  }

  initSocket() {
    this.socket = io(window.location.origin, {
      auth: { token: getToken() }
    });

    this.socket.on('connect', () => {
      console.log('🟢 Socket connected');
    });

    this.socket.on('disconnect', () => {
      console.log('🔴 Socket disconnected');
    });

    // General messages
    this.socket.on('general:message', (message) => {
      if (this.currentView === 'general') {
        this.appendMessage(message);
      }
    });

    // Room messages
    this.socket.on('room:message', (data) => {
      if (this.currentView === data.roomId) {
        this.appendMessage(data.message);
      }
    });

    // Online users
    this.socket.on('users:online', (users) => {
      this.onlineUsers = users;
      this.renderOnlineUsers();
    });

    // Typing
    this.socket.on('typing:start', (data) => {
      const targetView = data.roomId || 'general';
      if (this.currentView === targetView && data.userId !== this.currentUser._id) {
        this.typingUsers.set(data.userId, data.username);
        this.renderTyping();
      }
    });

    this.socket.on('typing:stop', (data) => {
      this.typingUsers.delete(data.userId);
      this.renderTyping();
    });

    this.socket.on('error', (data) => {
      showToast(data.message, 'error');
    });
  }

  setupUI() {
    // Sidebar profile
    this.renderSidebarProfile();
  }

  setupEventListeners() {
    // Send message
    const sendBtn = document.getElementById('send-btn');
    const messageInput = document.getElementById('message-input');

    sendBtn.addEventListener('click', () => this.sendMessage());
    
    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Auto-resize textarea
    messageInput.addEventListener('input', () => {
      messageInput.style.height = 'auto';
      messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
      
      // Typing indicator
      this.handleTyping();
    });

    // Navigation - General chat
    document.getElementById('nav-general').addEventListener('click', () => {
      this.switchView('general');
    });

    // Profile button
    document.getElementById('btn-profile').addEventListener('click', () => {
      window.location.href = '/profile.html';
    });

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => {
      removeToken();
      window.location.href = '/login.html';
    });

    // Mobile menu
    document.getElementById('mobile-menu-btn').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebar-overlay').classList.toggle('show');
    });

    document.getElementById('sidebar-overlay').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay').classList.remove('show');
    });

    // Create room modal
    document.getElementById('btn-create-room').addEventListener('click', () => this.openCreateRoomModal());
    document.getElementById('close-create-room').addEventListener('click', () => this.closeModal('create-room-modal'));
    document.getElementById('cancel-create-room').addEventListener('click', () => this.closeModal('create-room-modal'));
    document.getElementById('confirm-create-room').addEventListener('click', () => this.createRoom());

    // Room info modal
    document.getElementById('close-room-info').addEventListener('click', () => this.closeModal('room-info-modal'));

    // Add member modal
    document.getElementById('close-add-member').addEventListener('click', () => this.closeModal('add-member-modal'));
    document.getElementById('cancel-add-member').addEventListener('click', () => this.closeModal('add-member-modal'));
    document.getElementById('confirm-add-member').addEventListener('click', () => this.addMembersToRoom());

    // Search in create room
    document.getElementById('member-search').addEventListener('input', 
      debounce((e) => this.searchUsersForRoom(e.target.value, 'members-checkbox-list'), 300)
    );

    // Search in add member
    document.getElementById('add-member-search').addEventListener('input',
      debounce((e) => this.searchUsersForAddMember(e.target.value), 300)
    );

    // Close user popup on click outside
    document.addEventListener('click', (e) => {
      const popup = document.getElementById('user-popup');
      if (!popup.classList.contains('hidden') && !popup.contains(e.target) && !e.target.classList.contains('msg-username')) {
        popup.classList.add('hidden');
      }
    });

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.add('hidden');
        }
      });
    });
  }

  // ===== Messages =====

  async loadGeneralMessages() {
    try {
      const data = await apiRequest('/messages/general');
      this.renderMessages(data.messages);
    } catch (error) {
      console.error('Load messages error:', error);
    }
  }

  async loadRoomMessages(roomId) {
    try {
      const data = await apiRequest(`/messages/room/${roomId}`);
      this.renderMessages(data.messages);
    } catch (error) {
      console.error('Load room messages error:', error);
      showToast('Ошибка загрузки сообщений', 'error');
    }
  }

  renderMessages(messages) {
    const container = document.getElementById('messages-container');
    const emptyState = document.getElementById('empty-messages');

    if (messages.length === 0) {
      container.innerHTML = '';
      container.appendChild(emptyState);
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    container.innerHTML = messages.map(msg => this.createMessageHTML(msg)).join('');
    this.scrollToBottom();
  }

  appendMessage(message) {
    const container = document.getElementById('messages-container');
    const emptyState = document.getElementById('empty-messages');
    emptyState.classList.add('hidden');

    // Remove empty state if present
    if (container.contains(emptyState)) {
      // keep it hidden but in DOM
    }

    const msgDiv = document.createElement('div');
    msgDiv.innerHTML = this.createMessageHTML(message);
    const messageEl = msgDiv.firstElementChild;
    container.appendChild(messageEl);
    this.scrollToBottom();
  }

  createMessageHTML(msg) {
    if (!msg.sender) return '';

    const isOwn = msg.sender._id === this.currentUser._id;
    const senderColor = getAvatarColor(msg.sender);
    const initials = getInitials(msg.sender);
    const displayName = getDisplayName(msg.sender);

    if (msg.type === 'system') {
      return `
        <div class="message system-message">
          <div class="msg-content">
            <div class="msg-text">${escapeHTML(msg.content)}</div>
          </div>
        </div>
      `;
    }

    return `
      <div class="message ${isOwn ? 'own-message' : ''}" data-user-id="${msg.sender._id}">
        <div class="msg-avatar">
          <div class="user-avatar" style="background: ${senderColor}; width:36px;height:36px;font-size:14px;border-radius:50%;">${initials}</div>
        </div>
        <div class="msg-content">
          <div class="msg-header">
            <span class="msg-username" style="color: ${senderColor}" data-user-id="${msg.sender._id}" onclick="app.showUserPopup(event, '${msg.sender._id}')">${escapeHTML(displayName)}</span>
            <span class="msg-time">${formatTime(msg.createdAt)}</span>
          </div>
          <div class="msg-text">${escapeHTML(msg.content)}</div>
        </div>
      </div>
    `;
  }

  sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();

    if (!content) return;

    if (this.currentView === 'general') {
      this.socket.emit('general:message', { content });
    } else {
      this.socket.emit('room:message', { content, roomId: this.currentView });
    }

    input.value = '';
    input.style.height = 'auto';

    // Stop typing
    this.isTyping = false;
    this.socket.emit('typing:stop', { roomId: this.currentView === 'general' ? null : this.currentView });
  }

  scrollToBottom() {
    const container = document.getElementById('messages-container');
    setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 50);
  }

  // ===== Typing =====

  handleTyping() {
    const roomId = this.currentView === 'general' ? null : this.currentView;

    if (!this.isTyping) {
      this.isTyping = true;
      this.socket.emit('typing:start', { roomId });
    }

    clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      this.isTyping = false;
      this.socket.emit('typing:stop', { roomId });
    }, 2000);
  }

  renderTyping() {
    const indicator = document.getElementById('typing-indicator');
    
    if (this.typingUsers.size === 0) {
      indicator.innerHTML = '';
      return;
    }

    const names = Array.from(this.typingUsers.values());
    const text = names.length === 1 
      ? `${names[0]} печатает`
      : `${names.join(', ')} печатают`;

    indicator.innerHTML = `
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
      <span>${text}...</span>
    `;
  }

  // ===== Views =====

  async switchView(viewId) {
    this.currentView = viewId;
    this.typingUsers.clear();
    this.renderTyping();

    // Update nav
    document.querySelectorAll('.nav-item, .room-item').forEach(el => el.classList.remove('active'));

    if (viewId === 'general') {
      document.getElementById('nav-general').classList.add('active');
      document.getElementById('chat-title').textContent = '🌍 Общий чат';
      document.getElementById('chat-header-actions').innerHTML = '';
      await this.loadGeneralMessages();
    } else {
      const roomEl = document.querySelector(`.room-item[data-room-id="${viewId}"]`);
      if (roomEl) roomEl.classList.add('active');

      // Load room info
      try {
        const data = await apiRequest(`/rooms/${viewId}`);
        const room = data.room;
        document.getElementById('chat-title').textContent = `# ${room.name}`;
        
        // Room actions
        const isOwner = room.owner._id === this.currentUser._id;
        document.getElementById('chat-header-actions').innerHTML = `
          <button class="btn-icon" onclick="app.showRoomInfo('${viewId}')" title="Информация">ℹ️</button>
          ${isOwner ? `<button class="btn-icon" onclick="app.openAddMemberModal('${viewId}')" title="Добавить участника">👤+</button>` : ''}
          <button class="btn-icon" onclick="app.leaveRoom('${viewId}')" title="Покинуть">🚪</button>
        `;

        this.socket.emit('room:join', viewId);
        await this.loadRoomMessages(viewId);
      } catch (error) {
        showToast('Ошибка загрузки комнаты', 'error');
        this.switchView('general');
      }
    }

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');

    // Focus input
    document.getElementById('message-input').focus();
  }

  // ===== Online Users =====

  renderOnlineUsers() {
    const list = document.getElementById('online-users-list');
    const count = this.onlineUsers.length;
    
    document.getElementById('online-count').textContent = `${count} онлайн`;
    document.getElementById('online-panel-count').textContent = count;

    list.innerHTML = this.onlineUsers.map(user => `
      <div class="online-user-item" onclick="app.showUserPopup(event, '${user._id}')">
        <div class="mini-avatar" style="background: ${getAvatarColor(user)}">
          ${getInitials(user)}
          <div class="mini-status"></div>
        </div>
        <span class="user-name">${escapeHTML(getDisplayName(user))}</span>
      </div>
    `).join('');
  }

  // ===== User Popup =====

  async showUserPopup(event, userId) {
    event.stopPropagation();
    
    try {
      const data = await apiRequest(`/users/${userId}`);
      const user = data.user;
      const popup = document.getElementById('user-popup');

      const birthStr = user.profile?.birthDate 
        ? new Date(user.profile.birthDate).toLocaleDateString('ru-RU')
        : null;

      popup.innerHTML = `
        <div class="user-popup-header">
          ${createAvatarHTML(user)}
          <div class="user-popup-info">
            <h3>${escapeHTML(getDisplayName(user))}</h3>
            <div class="popup-username">@${escapeHTML(user.username)}</div>
          </div>
        </div>
        ${user.profile?.bio ? `<div class="user-popup-bio">${escapeHTML(user.profile.bio)}</div>` : ''}
        <div class="user-popup-details">
          ${user.status === 'online' 
            ? '<div class="detail-item"><span>🟢</span><span>Онлайн</span></div>'
            : `<div class="detail-item"><span>⚫</span><span>Был(а) ${formatTime(user.lastSeen)}</span></div>`
          }
          ${user.profile?.location ? `<div class="detail-item"><span>📍</span><span>${escapeHTML(user.profile.location)}</span></div>` : ''}
          ${birthStr ? `<div class="detail-item"><span>🎂</span><span>${birthStr}</span></div>` : ''}
          ${user.profile?.website ? `<div class="detail-item"><span>🔗</span><span>${escapeHTML(user.profile.website)}</span></div>` : ''}
        </div>
      `;

      // Position popup
      const rect = event.target.getBoundingClientRect();
      popup.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
      popup.style.top = Math.min(rect.bottom + 8, window.innerHeight - 300) + 'px';
      popup.classList.remove('hidden');

    } catch (error) {
      console.error('User popup error:', error);
    }
  }

  // ===== Rooms =====

  async loadRooms() {
    try {
      const data = await apiRequest('/rooms');
      this.renderRooms(data.rooms);
    } catch (error) {
      console.error('Load rooms error:', error);
    }
  }

  renderRooms(rooms) {
    const list = document.getElementById('rooms-list');
    
    if (rooms.length === 0) {
      list.innerHTML = `
        <div style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">
          Нет комнат. Создайте первую!
        </div>
      `;
      return;
    }

    list.innerHTML = rooms.map(room => `
      <div class="room-item ${this.currentView === room._id ? 'active' : ''}" 
           data-room-id="${room._id}" 
           onclick="app.switchView('${room._id}')">
        <div class="room-icon" style="background: ${room.color || '#6c5ce7'}">
          ${room.name[0].toUpperCase()}
        </div>
        <div class="room-info">
          <div class="room-name">${escapeHTML(room.name)}</div>
          <div class="room-members-count">${room.members.length} участн.</div>
        </div>
      </div>
    `).join('');
  }

  async openCreateRoomModal() {
    document.getElementById('room-name-input').value = '';
    document.getElementById('room-desc-input').value = '';
    document.getElementById('member-search').value = '';
    
    await this.searchUsersForRoom('', 'members-checkbox-list');
    document.getElementById('create-room-modal').classList.remove('hidden');
  }

  async searchUsersForRoom(query, containerId) {
    try {
      const data = await apiRequest(`/users?search=${encodeURIComponent(query)}`);
      const container = document.getElementById(containerId);
      
      const users = data.users.filter(u => u._id !== this.currentUser._id);

      container.innerHTML = users.map(user => `
        <label class="user-checkbox">
          <input type="checkbox" value="${user._id}" class="room-member-checkbox">
          <span class="checkmark">✓</span>
          <div class="check-user-info">
            <div class="mini-avatar" style="background:${getAvatarColor(user)};width:28px;height:28px;font-size:11px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;">
              ${getInitials(user)}
            </div>
            <span>${escapeHTML(user.username)}</span>
          </div>
        </label>
      `).join('');
    } catch (error) {
      console.error('Search users error:', error);
    }
  }

  async createRoom() {
    const name = document.getElementById('room-name-input').value.trim();
    const description = document.getElementById('room-desc-input').value.trim();

    if (!name) {
      showToast('Введите название комнаты', 'error');
      return;
    }

    const checkboxes = document.querySelectorAll('#members-checkbox-list .room-member-checkbox:checked');
    const members = Array.from(checkboxes).map(cb => cb.value);

    try {
      await apiRequest('/rooms', {
        method: 'POST',
        body: JSON.stringify({ name, description, members })
      });

      showToast('Комната создана!', 'success');
      this.closeModal('create-room-modal');
      await this.loadRooms();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async showRoomInfo(roomId) {
    try {
      const data = await apiRequest(`/rooms/${roomId}`);
      const room = data.room;

      document.getElementById('room-info-title').textContent = room.name;
      document.getElementById('room-info-desc').textContent = room.description || 'Нет описания';

      const membersList = document.getElementById('room-members-list');
      membersList.innerHTML = room.members.map(member => `
        <div class="online-user-item">
          <div class="mini-avatar" style="background:${getAvatarColor(member)};width:32px;height:32px;font-size:13px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;">
            ${getInitials(member)}
          </div>
          <span class="user-name">${escapeHTML(getDisplayName(member))}</span>
          ${member._id === room.owner._id ? '<span style="color:var(--warning);font-size:11px;">👑 Создатель</span>' : ''}
        </div>
      `).join('');

      const adminActions = document.getElementById('room-admin-actions');
      if (room.owner._id === this.currentUser._id) {
        adminActions.innerHTML = `
          <button class="btn btn-danger btn-sm" onclick="app.deleteRoom('${roomId}')">🗑 Удалить комнату</button>
        `;
      } else {
        adminActions.innerHTML = '';
      }

      document.getElementById('room-info-modal').classList.remove('hidden');
    } catch (error) {
      showToast('Ошибка загрузки информации', 'error');
    }
  }

  async openAddMemberModal(roomId) {
    this.addMemberRoomId = roomId;
    document.getElementById('add-member-search').value = '';
    await this.searchUsersForAddMember('');
    document.getElementById('add-member-modal').classList.remove('hidden');
  }

  async searchUsersForAddMember(query) {
    try {
      const roomData = await apiRequest(`/rooms/${this.addMemberRoomId}`);
      const memberIds = roomData.room.members.map(m => m._id);

      const data = await apiRequest(`/users?search=${encodeURIComponent(query)}`);
      const container = document.getElementById('add-members-list');
      
      const users = data.users.filter(u => !memberIds.includes(u._id));

      if (users.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">Все пользователи уже добавлены</div>';
        return;
      }

      container.innerHTML = users.map(user => `
        <label class="user-checkbox">
          <input type="checkbox" value="${user._id}" class="add-member-checkbox">
          <span class="checkmark">✓</span>
          <div class="check-user-info">
            <div class="mini-avatar" style="background:${getAvatarColor(user)};width:28px;height:28px;font-size:11px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;">
              ${getInitials(user)}
            </div>
            <span>${escapeHTML(user.username)}</span>
          </div>
        </label>
      `).join('');
    } catch (error) {
      console.error('Search error:', error);
    }
  }

  async addMembersToRoom() {
    const checkboxes = document.querySelectorAll('#add-members-list .add-member-checkbox:checked');
    const userIds = Array.from(checkboxes).map(cb => cb.value);

    if (userIds.length === 0) {
      showToast('Выберите пользователей', 'error');
      return;
    }

    try {
      for (const userId of userIds) {
        await apiRequest(`/rooms/${this.addMemberRoomId}/members`, {
          method: 'POST',
          body: JSON.stringify({ userId })
        });
      }

      showToast('Участники добавлены!', 'success');
      this.closeModal('add-member-modal');
      await this.loadRooms();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async leaveRoom(roomId) {
    if (!confirm('Покинуть эту комнату?')) return;

    try {
      await apiRequest(`/rooms/${roomId}/leave`, { method: 'POST' });
      showToast('Вы покинули комнату', 'info');
      this.switchView('general');
      await this.loadRooms();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async deleteRoom(roomId) {
    if (!confirm('Удалить комнату? Это действие нельзя отменить.')) return;

    try {
      await apiRequest(`/rooms/${roomId}`, { method: 'DELETE' });
      showToast('Комната удалена', 'info');
      this.closeModal('room-info-modal');
      this.switchView('general');
      await this.loadRooms();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  // ===== Sidebar Profile =====

  renderSidebarProfile() {
    const container = document.getElementById('sidebar-user-profile');
    const user = this.currentUser;

    container.innerHTML = `
      <div class="user-avatar" style="background: ${getAvatarColor(user)}">
        ${getInitials(user)}
        <div class="status-dot online"></div>
      </div>
      <div class="user-info">
        <div class="user-name">${escapeHTML(getDisplayName(user))}</div>
        <div class="user-status">Онлайн</div>
      </div>
    `;
  }

  // ===== Helpers =====

  closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
  }
}

// Initialize app
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new ChatApp();
});