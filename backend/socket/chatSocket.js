const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Room = require('../models/Room');

const onlineUsers = new Map();

const populateMsg = [
  { path: 'sender', select: 'username profile role' },
  { path: 'shoppingList.items.boughtBy', select: 'username' },
  { path: 'forwarded.originalSender', select: 'username profile' },
  { path: 'pinnedBy', select: 'username' }
];

function setupChatSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Auth required'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      if (!user) return next(new Error('User not found'));
      if (user.isBanned) return next(new Error('Banned'));
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

    try {
      const userRooms = await Room.find({ members: userId });
      userRooms.forEach(room => socket.join('room:' + room._id.toString()));
    } catch (e) {
      console.error('Error joining rooms:', e);
    }

    socket.join('user:' + userId);
    socket.join('general');
    broadcastOnlineUsers(io);

    socket.on('general:message', async (data) => {
      try {
        if (!data.content || !data.content.trim()) return;
        const message = new Message({
          content: data.content.trim().substring(0, 5000),
          sender: userId,
          room: null,
          type: 'text'
        });
        await message.save();
        const populated = await Message.findById(message._id).populate(populateMsg);
        io.to('general').emit('general:message', populated);
      } catch (error) {
        console.error('Message error:', error);
        socket.emit('error', { message: 'Ошибка отправки' });
      }
    });

    socket.on('room:message', async (data) => {
      try {
        if (!data.content || !data.content.trim() || !data.roomId) return;
        const room = await Room.findById(data.roomId);
        if (!room || !room.members.some(m => m.toString() === userId)) {
          return socket.emit('error', { message: 'Нет доступа' });
        }
        const message = new Message({
          content: data.content.trim().substring(0, 5000),
          sender: userId,
          room: data.roomId,
          type: 'text'
        });
        await message.save();
        const populated = await Message.findById(message._id).populate(populateMsg);
        io.to('room:' + data.roomId).emit('room:message', { roomId: data.roomId, message: populated });
      } catch (error) {
        console.error('Room message error:', error);
      }
    });

    socket.on('image:message', async (data) => {
      try {
        if (!data.imageUrl) return;
        const message = new Message({
          content: data.content || '',
          sender: userId,
          room: data.roomId || null,
          type: 'image',
          imageUrl: data.imageUrl
        });
        await message.save();
        const populated = await Message.findById(message._id).populate(populateMsg);
        if (data.roomId) {
          io.to('room:' + data.roomId).emit('room:message', { roomId: data.roomId, message: populated });
        } else {
          io.to('general').emit('general:message', populated);
        }
      } catch (error) {
        console.error('Image message error:', error);
      }
    });

    socket.on('shopping:create', async (data) => {
      try {
        if (!data.items || !data.items.length) return;
        const message = new Message({
          content: '',
          sender: userId,
          room: data.roomId || null,
          type: 'shopping',
          shoppingList: {
            title: data.title || 'Список покупок',
            items: data.items.map(item => ({
              name: item.name.substring(0, 100),
              category: item.category || '',
              bought: false,
              boughtBy: null
            }))
          }
        });
        await message.save();
        const populated = await Message.findById(message._id).populate(populateMsg);
        if (data.roomId) {
          io.to('room:' + data.roomId).emit('room:message', { roomId: data.roomId, message: populated });
        } else {
          io.to('general').emit('general:message', populated);
        }
      } catch (error) {
        console.error('Shopping create error:', error);
      }
    });

    socket.on('dice:roll', async (data) => {
      try {
        const validDice = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 100 };
        const diceType = data.diceType || 'd6';
        const sides = validDice[diceType] || 6;
        const result = Math.floor(Math.random() * sides) + 1;
        const message = new Message({
          content: '',
          sender: userId,
          room: data.roomId || null,
          type: 'dice',
          diceResult: { diceType, sides, result, rolledBy: user.username }
        });
        await message.save();
        const populated = await Message.findById(message._id).populate(populateMsg);
        if (data.roomId) {
          io.to('room:' + data.roomId).emit('room:message', { roomId: data.roomId, message: populated });
        } else {
          io.to('general').emit('general:message', populated);
        }
      } catch (error) {
        console.error('Dice roll error:', error);
      }
    });

    socket.on('room:created', async (data) => {
      try {
        if (!data.roomId) return;
        const room = await Room.findById(data.roomId)
          .populate('owner', 'username profile.avatarColor')
          .populate('members', 'username profile.avatarColor status');
        if (!room) return;
        room.members.forEach(member => {
          const memberId = member._id.toString();
          if (memberId !== userId) io.to('user:' + memberId).emit('room:new', room);
          const memberSocket = findSocketByUserId(memberId);
          if (memberSocket) memberSocket.join('room:' + room._id.toString());
        });
      } catch (e) {
        console.error('Room created notify error:', e);
      }
    });

    socket.on('room:join', (roomId) => { socket.join('room:' + roomId); });
    socket.on('room:leave', (roomId) => { socket.leave('room:' + roomId); });

    socket.on('typing:start', (data) => {
      const target = data.roomId ? 'room:' + data.roomId : 'general';
      socket.to(target).emit('typing:start', { userId, username: user.username, roomId: data.roomId || null });
    });

    socket.on('typing:stop', (data) => {
      const target = data.roomId ? 'room:' + data.roomId : 'general';
      socket.to(target).emit('typing:stop', { userId, roomId: data.roomId || null });
    });

    socket.on('disconnect', async () => {
      console.log('Disconnected: ' + user.username);
      onlineUsers.delete(userId);
      await User.findByIdAndUpdate(userId, { status: 'offline', lastSeen: new Date() });
      broadcastOnlineUsers(io);
    });
  });

  function findSocketByUserId(userId) {
    const userData = onlineUsers.get(userId);
    if (!userData) return null;
    return io.sockets.sockets.get(userData.socketId);
  }
}

function broadcastOnlineUsers(io) {
  const users = Array.from(onlineUsers.values()).map(u => ({
    _id: u.user._id, username: u.user.username, profile: u.user.profile, status: 'online', role: u.user.role
  }));
  io.emit('users:online', users);
}

module.exports = setupChatSocket;