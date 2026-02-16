const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Room = require('../models/Room');

const onlineUsers = new Map(); // userId -> { socketId, user }

function setupChatSocket(io) {
  // Middleware для аутентификации сокета
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Необходима авторизация'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      
      if (!user) return next(new Error('Пользователь не найден'));

      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Невалидный токен'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    const user = socket.user;

    console.log(`🟢 ${user.username} connected`);

    // Обновляем статус
    await User.findByIdAndUpdate(userId, { status: 'online', lastSeen: new Date() });
    onlineUsers.set(userId, { socketId: socket.id, user });

    // Присоединяемся к личным комнатам
    const userRooms = await Room.find({ members: userId });
    userRooms.forEach(room => {
      socket.join(`room:${room._id}`);
    });

    // Общий канал
    socket.join('general');

    // Отправляем список онлайн
    broadcastOnlineUsers(io);

    // === Общий чат ===
    socket.on('general:message', async (data) => {
      try {
        if (!data.content || !data.content.trim()) return;

        const message = new Message({
          content: data.content.trim().substring(0, 2000),
          sender: userId,
          room: null,
          type: 'text'
        });

        await message.save();
        
        const populatedMessage = await Message.findById(message._id)
          .populate('sender', 'username profile.avatarColor profile.firstName profile.lastName');

        io.to('general').emit('general:message', populatedMessage);
      } catch (error) {
        console.error('Message error:', error);
        socket.emit('error', { message: 'Ошибка отправки сообщения' });
      }
    });

    // === Комната ===
    socket.on('room:message', async (data) => {
      try {
        if (!data.content || !data.content.trim() || !data.roomId) return;

        const room = await Room.findById(data.roomId);
        if (!room || !room.members.some(m => m.toString() === userId)) {
          return socket.emit('error', { message: 'Нет доступа к комнате' });
        }

        const message = new Message({
          content: data.content.trim().substring(0, 2000),
          sender: userId,
          room: data.roomId,
          type: 'text'
        });

        await message.save();

        const populatedMessage = await Message.findById(message._id)
          .populate('sender', 'username profile.avatarColor profile.firstName profile.lastName');

        io.to(`room:${data.roomId}`).emit('room:message', {
          roomId: data.roomId,
          message: populatedMessage
        });
      } catch (error) {
        console.error('Room message error:', error);
      }
    });

    // Присоединиться к комнате (сокет)
    socket.on('room:join', async (roomId) => {
      socket.join(`room:${roomId}`);
    });

    // Покинуть комнату (сокет)
    socket.on('room:leave', (roomId) => {
      socket.leave(`room:${roomId}`);
    });

    // Индикатор набора текста
    socket.on('typing:start', (data) => {
      const target = data.roomId ? `room:${data.roomId}` : 'general';
      socket.to(target).emit('typing:start', {
        userId,
        username: user.username,
        roomId: data.roomId || null
      });
    });

    socket.on('typing:stop', (data) => {
      const target = data.roomId ? `room:${data.roomId}` : 'general';
      socket.to(target).emit('typing:stop', {
        userId,
        roomId: data.roomId || null
      });
    });

    // Отключение
    socket.on('disconnect', async () => {
      console.log(`🔴 ${user.username} disconnected`);
      onlineUsers.delete(userId);
      await User.findByIdAndUpdate(userId, { status: 'offline', lastSeen: new Date() });
      broadcastOnlineUsers(io);
    });
  });
}

function broadcastOnlineUsers(io) {
  const users = Array.from(onlineUsers.values()).map(u => ({
    _id: u.user._id,
    username: u.user.username,
    profile: u.user.profile,
    status: 'online'
  }));
  io.emit('users:online', users);
}

module.exports = setupChatSocket;