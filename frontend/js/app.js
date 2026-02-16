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

    this.socket.on('general:message', (msg) => {
      if (this.currentView === 'general') {
        this.appendMessage(msg);
      } else {
        this.unreadCounts['general'] = (this.unreadCounts['general'] || 0) + 1;
        this.updateUnreadBadges();
      }
    });

    this.socket.on('room:message', (data) => {
      if (this.currentView === data.roomId) {
        this.appendMessage(data.message);
      } else {
        this.unreadCounts[data.roomId] = (this.unreadCounts[data.roomId] || 0) + 1;
        this.updateUnreadBadges();
      }
    });

    this.socket.on('users:online', (users) => {
      this.onlineUsers = users;
      this.renderOnlineUsers();
    });

    this.socket.on('typing:start', (data) => {
      var tv = data.roomId || 'general';
      if (this.currentView === tv && data.userId !== this.currentUser._id) {
        this.typingUsers.set(data.userId, data.username);
        this.renderTyping();
      }
    });

    this.socket.on('typing:stop', (data) => {
      this.typingUsers.delete(data.userId);
      this.renderTyping();
    });

    this.socket.on('shopping:update', (data) => {
      var targetView = data.roomId || 'general';
      if (this.currentView === targetView) {
        var el = document.querySelector('[data-msg-id="' + data.messageId + '"]');
        if (el) {
          var contentEl = el.querySelector('.msg-body');
          if (contentEl) contentEl.innerHTML = createShoppingListHTML(data.message);
        }
      }
    });

    this.socket.on('room:new', async (room) => {
      this.socket.emit('room:join', room._id);
      await this.loadRooms();
      showToast('Вас добавили в комнату "' + room.name + '"', 'info');
    });

    this.socket.on('error', (data) => showToast(data.message, 'error'));
  }

  setupUI() {
    this.renderSidebarProfile();
    this.buildEmojiPicker();
    this.buildDicePicker();
    this.buildShoppingModal();
  }

  setupEventListeners() {
    document.getElementById('send-btn').addEventListener('click', () => this.sendMessage());
    var msgInput = document.getElementById('message-input');
    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    msgInput.addEventListener('input', () => {
      msgInput.style.height = 'auto';
      msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
      this.handleTyping();
    });

    document.getElementById('nav-general').addEventListener('click', () => this.switchView('general'));
    document.getElementById('btn-profile').addEventListener('click', () => { window.location.href = '/profile.html'; });
    document.getElementById('btn-logout').addEventListener('click', () => {
      if (this.socket) this.socket.disconnect();
      removeToken();
      window.location.href = '/login.html';
    });
    document.getElementById('mobile-menu-btn').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebar-overlay').classList.toggle('show');
    });
    document.getElementById('sidebar-overlay').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay').classList.remove('show');
    });

    // Room modals
    document.getElementById('btn-create-room').addEventListener('click', () => this.openCreateRoomModal());
    document.getElementById('close-create-room').addEventListener('click', () => this.closeModal('create-room-modal'));
    document.getElementById('cancel-create-room').addEventListener('click', () => this.closeModal('create-room-modal'));
    document.getElementById('confirm-create-room').addEventListener('click', () => this.createRoom());
    document.getElementById('close-room-info').addEventListener('click', () => this.closeModal('room-info-modal'));
    document.getElementById('close-add-member').addEventListener('click', () => this.closeModal('add-member-modal'));
    document.getElementById('cancel-add-member').addEventListener('click', () => this.closeModal('add-member-modal'));
    document.getElementById('confirm-add-member').addEventListener('click', () => this.addMembersToRoom());
    document.getElementById('member-search').addEventListener('input',
      debounce((e) => this.searchUsersForRoom(e.target.value, 'members-checkbox-list'), 300));
    document.getElementById('add-member-search').addEventListener('input',
      debounce((e) => this.searchUsersForAddMember(e.target.value), 300));

    // Emoji
    document.getElementById('btn-emoji').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('emoji-picker').classList.toggle('hidden');
      document.getElementById('dice-picker').classList.add('hidden');
    });

    // Image upload
    document.getElementById('image-upload-input').addEventListener('change', (e) => this.handleImageUpload(e));

    // Shopping
    document.getElementById('btn-shopping').addEventListener('click', () => this.openShoppingModal());
    document.getElementById('close-shopping').addEventListener('click', () => this.closeModal('shopping-modal'));
    document.getElementById('cancel-shopping').addEventListener('click', () => this.closeModal('shopping-modal'));
    document.getElementById('confirm-shopping').addEventListener('click', () => this.sendShoppingList());
    document.getElementById('add-custom-item').addEventListener('click', () => this.addCustomShoppingItem());
    document.getElementById('custom-item-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.addCustomShoppingItem(); }
    });

    // Dice
    document.getElementById('btn-dice').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('dice-picker').classList.toggle('hidden');
      document.getElementById('emoji-picker').classList.add('hidden');
    });

    // Close popups on outside click
    document.addEventListener('click', (e) => {
      var emoji = document.getElementById('emoji-picker');
      var dice = document.getElementById('dice-picker');
      var popup = document.getElementById('user-popup');
      if (!emoji.contains(e.target) && e.target.id !== 'btn-emoji') emoji.classList.add('hidden');
      if (!dice.contains(e.target) && e.target.id !== 'btn-dice') dice.classList.add('hidden');
      if (!popup.classList.contains('hidden') && !popup.contains(e.target) && !e.target.classList.contains('msg-username')) popup.classList.add('hidden');
    });

    document.querySelectorAll('.modal-overlay').forEach(function(o) {
      o.addEventListener('click', function(e) { if (e.target === o) o.classList.add('hidden'); });
    });
  }

  // ===== Emoji =====
  buildEmojiPicker() {
    var picker = document.getElementById('emoji-picker');
    picker.innerHTML = EMOJI_LIST.map(function(e) {
      return '<span onclick="app.insertEmoji(\'' + e + '\')">' + e + '</span>';
    }).join('');
  }

  insertEmoji(emoji) {
    var input = document.getElementById('message-input');
    input.value += emoji;
    input.focus();
    document.getElementById('emoji-picker').classList.add('hidden');
  }

  // ===== Dice =====
  buildDicePicker() {
    var picker = document.getElementById('dice-picker');
    