const express = require('express');
const Message = require('../models/Message');
const Room = require('../models/Room');
const auth = require('../middleware/auth');

const router = express.Router();

const populateMsg = [
  { path: 'sender', select: 'username profile role' },
  { path: 'shoppingList.items.boughtBy', select: 'username' },
  { path: 'forwarded.originalSender', select: 'username profile' },
  { path: 'pinnedBy', select: 'username' }
];

router.get('/general', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const messages = await Message.find({ room: null })
      .populate(populateMsg)
      .sort({ createdAt: -1 }).skip(skip).limit(limit);
    res.json({ messages: messages.reverse() });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/room/:roomId', auth, async (req, res) => {
  try {
    const room = await Room.findById(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Комната не найдена' });
    if (!room.members.some(m => m.toString() === req.userId.toString())) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const messages = await Message.find({ room: req.params.roomId })
      .populate(populateMsg)
      .sort({ createdAt: -1 }).skip(skip).limit(limit);
    res.json({ messages: messages.reverse() });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get pinned messages
router.get('/pinned/:roomId?', auth, async (req, res) => {
  try {
    const query = { pinned: true };
    if (req.params.roomId && req.params.roomId !== 'general') {
      query.room = req.params.roomId;
    } else {
      query.room = null;
    }
    console.log('=== GET PINNED ===');
    console.log('Query:', JSON.stringify(query));
    const messages = await Message.find(query)
      .populate(populateMsg)
      .sort({ pinnedAt: -1 }).limit(20);
    console.log('Found pinned messages:', messages.length);
    messages.forEach(function(m) {
      console.log('  - id:', m._id, 'pinned:', m.pinned, 'content:', (m.content || '').substring(0, 30));
    });
    console.log('=== END GET PINNED ===');
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Toggle pin
router.post('/pin/:messageId', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Сообщение не найдено' });

    // Check permission: room owner or admin
    if (message.room) {
      const room = await Room.findById(message.room);
      if (!room) return res.status(404).json({ error: 'Комната не найдена' });
      const isOwner = room.owner.toString() === req.userId.toString();
      const isAdmin = req.user.role === 'admin';
      if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Нет прав' });
    } else {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нет прав' });
    }

    const oldPinned = message.pinned;
    const newPinned = !oldPinned;

    console.log('=== PIN TOGGLE ===');
    console.log('Message ID:', req.params.messageId);
    console.log('Old pinned:', oldPinned);
    console.log('New pinned:', newPinned);

    const result = await Message.updateOne(
      { _id: req.params.messageId },
      {
        $set: {
          pinned: newPinned,
          pinnedBy: newPinned ? req.userId : null,
          pinnedAt: newPinned ? new Date() : null
        }
      }
    );

    console.log('UpdateOne result:', JSON.stringify(result));

    // Verify it actually changed
    const verify = await Message.findById(req.params.messageId).select('pinned pinnedBy pinnedAt');
    console.log('After update - pinned:', verify.pinned, 'pinnedBy:', verify.pinnedBy, 'pinnedAt:', verify.pinnedAt);
    console.log('=== END PIN ===');

    const populated = await Message.findById(req.params.messageId).populate(populateMsg);

    const io = req.app.get('io');
    const target = message.room ? 'room:' + message.room : 'general';
    io.to(target).emit('message:pinned', {
      messageId: message._id,
      pinned: newPinned,
      message: populated,
      roomId: message.room ? message.room.toString() : null
    });

    res.json({ message: populated });
  } catch (error) {
    console.error('Pin error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Edit message
router.put('/edit/:messageId', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Сообщение не найдено' });

    const isOwner = message.sender.toString() === req.userId.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Нет прав' });

    if (message.type !== 'text' && message.type !== 'image') {
      return res.status(400).json({ error: 'Нельзя редактировать этот тип сообщения' });
    }

    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Пустое сообщение' });

    message.content = content.trim().substring(0, 5000);
    message.edited = true;
    message.editedAt = new Date();
    await message.save();

    const populated = await Message.findById(message._id).populate(populateMsg);

    const io = req.app.get('io');
    const target = message.room ? 'room:' + message.room : 'general';
    io.to(target).emit('message:edited', {
      messageId: message._id,
      message: populated,
      roomId: message.room ? message.room.toString() : null
    });

    res.json({ message: populated });
  } catch (error) {
    console.error('Edit error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Delete message
router.delete('/delete/:messageId', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Сообщение не найдено' });

    const isOwner = message.sender.toString() === req.userId.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Нет прав' });

    const roomId = message.room ? message.room.toString() : null;
    await Message.findByIdAndDelete(req.params.messageId);

    const io = req.app.get('io');
    const target = roomId ? 'room:' + roomId : 'general';
    io.to(target).emit('message:deleted', {
      messageId: req.params.messageId,
      roomId: roomId
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Bulk delete messages
router.post('/bulk-delete', auth, async (req, res) => {
  try {
    const { messageIds } = req.body;
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'Не выбраны сообщения' });
    }

    const isAdmin = req.user.role === 'admin';
    const messages = await Message.find({ _id: { $in: messageIds } });

    for (const msg of messages) {
      const isOwner = msg.sender.toString() === req.userId.toString();
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ error: 'Можно удалять только свои сообщения' });
      }
    }

    const io = req.app.get('io');

    for (const msg of messages) {
      const roomId = msg.room ? msg.room.toString() : null;
      await Message.findByIdAndDelete(msg._id);
      const target = roomId ? 'room:' + roomId : 'general';
      io.to(target).emit('message:deleted', {
        messageId: msg._id.toString(),
        roomId: roomId
      });
    }

    res.json({ success: true, deleted: messages.length });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Bulk forward messages
router.post('/bulk-forward', auth, async (req, res) => {
  try {
    const { messageIds, targetRoomId } = req.body;
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'Не выбраны сообщения' });
    }

    if (targetRoomId) {
      const room = await Room.findById(targetRoomId);
      if (!room || !room.members.some(m => m.toString() === req.userId.toString())) {
        return res.status(403).json({ error: 'Нет доступа к комнате' });
      }
    }

    const messages = await Message.find({ _id: { $in: messageIds } })
      .populate('sender', 'username profile')
      .sort({ createdAt: 1 });

    const io = req.app.get('io');
    const forwarded = [];

    for (const originalMsg of messages) {
      let originalRoomName = 'Общий чат';
      if (originalMsg.room) {
        const origRoom = await Room.findById(originalMsg.room);
        if (origRoom) originalRoomName = origRoom.name;
      }

      const newMsg = new Message({
        content: originalMsg.content,
        sender: req.userId,
        room: targetRoomId || null,
        type: 'forwarded',
        imageUrl: originalMsg.imageUrl || '',
        forwarded: {
          originalSender: originalMsg.sender._id,
          originalRoom: originalRoomName,
          originalDate: originalMsg.createdAt
        }
      });

      await newMsg.save();
      const populated = await Message.findById(newMsg._id).populate(populateMsg);

      if (targetRoomId) {
        io.to('room:' + targetRoomId).emit('room:message', { roomId: targetRoomId, message: populated });
      } else {
        io.to('general').emit('general:message', populated);
      }
      forwarded.push(populated);
    }

    res.json({ success: true, forwarded: forwarded.length });
  } catch (error) {
    console.error('Bulk forward error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Forward message
router.post('/forward/:messageId', auth, async (req, res) => {
  try {
    const originalMsg = await Message.findById(req.params.messageId)
      .populate('sender', 'username profile');
    if (!originalMsg) return res.status(404).json({ error: 'Сообщение не найдено' });

    const { targetRoomId } = req.body;

    if (targetRoomId) {
      const room = await Room.findById(targetRoomId);
      if (!room || !room.members.some(m => m.toString() === req.userId.toString())) {
        return res.status(403).json({ error: 'Нет доступа к комнате' });
      }
    }

    let originalRoomName = 'Общий чат';
    if (originalMsg.room) {
      const origRoom = await Room.findById(originalMsg.room);
      if (origRoom) originalRoomName = origRoom.name;
    }

    const newMsg = new Message({
      content: originalMsg.content,
      sender: req.userId,
      room: targetRoomId || null,
      type: 'forwarded',
      imageUrl: originalMsg.imageUrl || '',
      forwarded: {
        originalSender: originalMsg.sender._id,
        originalRoom: originalRoomName,
        originalDate: originalMsg.createdAt
      }
    });

    await newMsg.save();
    const populated = await Message.findById(newMsg._id).populate(populateMsg);

    const io = req.app.get('io');
    if (targetRoomId) {
      io.to('room:' + targetRoomId).emit('room:message', { roomId: targetRoomId, message: populated });
    } else {
      io.to('general').emit('general:message', populated);
    }

    res.json({ message: populated });
  } catch (error) {
    console.error('Forward error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Toggle shopping item
router.post('/shopping/:messageId/toggle/:itemId', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    if (!message || message.type !== 'shopping') return res.status(404).json({ error: 'Список не найден' });

    const item = message.shoppingList.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Товар не найден' });

    item.bought = !item.bought;
    item.boughtBy = item.bought ? req.userId : null;
    await message.save();

    const populated = await Message.findById(message._id).populate(populateMsg);

    const io = req.app.get('io');
    const target = message.room ? 'room:' + message.room : 'general';
    io.to(target).emit('shopping:update', {
      messageId: message._id,
      message: populated,
      roomId: message.room ? message.room.toString() : null
    });

    res.json({ message: populated });
  } catch (error) {
    console.error('Toggle shopping error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;