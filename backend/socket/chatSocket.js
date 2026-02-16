const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Room = require('../models/Room');

const onlineUsers = new Map();

function setupChatSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Auth required'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      if (!user) return next(new Error('User not found'));
      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    const user = socket.user;
    console.log('Connected: ' + user.username);

    await User.findByIdAndUpdate(userId, { status: 'online', lastSeen: new Date() });
    onlineUsers.set(userId, { socketId: socket.id, user });

    // Join user's rooms
    try {
      const userRooms = await Room.find({ members: userId });
      userRooms.forEach(room => {
        socket.join('room:' + room._id.toString());
      });
    } catch (e) {
      console.error('Error joining rooms:', e);
    }

    socket.join('general');
    broadcastOnlineUsers(io);

    // General chat message
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
        const populated = await Message.findById(message._id)
          .populate('sender', 'username profile');
        io.to('general').emit('general:message', populated);
      } catch (error) {
        console.error('Message error:', error);
        socket.emit('error', { message: 'Ошибка отправки' });
      }
    });

    // Room message
    socket.on('room:message', async (data) => {
      try {
        if (!data.content || !data.content.trim() || !data.roomId) return;
        const room = await Room.findById(data.roomId);
        if (!room || !room.members.some(m => m.toString() === userId)) {
          return socket.emit('error', { message: 'Нет доступа' });
        }
        const message = new Message({
          content: data.content.trim().substring(0, 2000),
          sender: userId,
          room: data.roomId,
          type: 'text'
        });
        await message.save();
        const populated = await Message.findById(message._id)
          .populate('sender', 'username profile');
        io.to('room:' + data.roomId).emit('room:message', {
          roomId: data.roomId,
          message: populated
        });
      } catch (error) {
        console.error('Room message error:', error);
      }
    });

    socket.on('room:join', (roomId) => {
      socket.join('room:' + roomId);
    });

    socket.on('room:leave', (roomId) => {
      socket.leave('room:' + roomId);
    });

    socket.on('typing:start', (data) => {
      const target = data.roomId ? 'room:' + data.roomId : 'general';
      socket.to(target).emit('typing:start', {
        userId,
        username: user.username,
        roomId: data.roomId || null
      });
    });

    socket.on('typing:stop', (data) => {
      const target = data.roomId ? 'room:' + data.roomId : 'general';
      socket.to(target).emit('typing:stop', {
        userId,
        roomId: data.roomId || null
      });
    });

    socket.on('disconnect', async () => {
      console.log('Disconnected: ' + user.username);
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