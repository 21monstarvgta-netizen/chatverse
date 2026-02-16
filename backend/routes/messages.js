const express = require('express');
const Message = require('../models/Message');
const Room = require('../models/Room');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/general', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const messages = await Message.find({ room: null })
      .populate('sender', 'username profile')
      .populate('shoppingList.items.boughtBy', 'username')
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
      .populate('sender', 'username profile')
      .populate('shoppingList.items.boughtBy', 'username')
      .sort({ createdAt: -1 }).skip(skip).limit(limit);
    res.json({ messages: messages.reverse() });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Toggle shopping item bought status
router.post('/shopping/:messageId/toggle/:itemId', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    if (!message || message.type !== 'shopping') {
      return res.status(404).json({ error: 'Список не найден' });
    }

    const item = message.shoppingList.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Товар не найден' });

    item.bought = !item.bought;
    item.boughtBy = item.bought ? req.userId : null;
    await message.save();

    const populated = await Message.findById(message._id)
      .populate('sender', 'username profile')
      .populate('shoppingList.items.boughtBy', 'username');

    // Emit update via socket
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