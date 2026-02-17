const express = require('express');
const { body, validationResult } = require('express-validator');
const Room = require('../models/Room');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const rooms = await Room.find({ members: req.userId })
      .populate('owner', 'username profile.avatarColor')
      .populate('members', 'username profile.avatarColor status')
      .sort({ updatedAt: -1 });
    res.json({ rooms });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/', auth, [
  body('name').trim().isLength({ min: 1, max: 50 }).withMessage('Название от 1 до 50 символов'),
  body('description').optional().trim().isLength({ max: 200 }),
  body('members').isArray().withMessage('Укажите участников'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { name, description, members, color } = req.body;
    const memberIds = [...new Set([req.userId.toString(), ...members])];
    const colors = ['#6c5ce7', '#00b894', '#e17055', '#0984e3', '#e84393', '#00cec9'];

    const room = new Room({
      name,
      description: description || '',
      owner: req.userId,
      members: memberIds,
      color: color || colors[Math.floor(Math.random() * colors.length)]
    });

    await room.save();
    const populatedRoom = await Room.findById(room._id)
      .populate('owner', 'username profile.avatarColor')
      .populate('members', 'username profile.avatarColor status');
    res.status(201).json({ room: populatedRoom });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const room = await Room.findById(req.params.id)
      .populate('owner', 'username profile.avatarColor')
      .populate('members', 'username profile.avatarColor status profile.firstName profile.lastName');
    if (!room) return res.status(404).json({ error: 'Комната не найдена' });
    if (!room.members.some(m => m._id.toString() === req.userId.toString())) {
      return res.status(403).json({ error: 'Вы не участник этой комнаты' });
    }
    res.json({ room });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/:id/members', auth, async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Комната не найдена' });
    if (room.owner.toString() !== req.userId.toString()) {
      return res.status(403).json({ error: 'Только создатель может добавлять участников' });
    }
    const { userId } = req.body;
    if (!room.members.includes(userId)) {
      room.members.push(userId);
      await room.save();
    }
    const populatedRoom = await Room.findById(room._id)
      .populate('owner', 'username profile.avatarColor')
      .populate('members', 'username profile.avatarColor status');
    res.json({ room: populatedRoom });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Комната не найдена' });
    const isOwner = room.owner.toString() === req.userId.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Нет прав' });
    await Room.findByIdAndDelete(req.params.id);
    res.json({ message: 'Комната удалена' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/:id/leave', auth, async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Комната не найдена' });
    room.members = room.members.filter(m => m.toString() !== req.userId.toString());
    if (room.members.length === 0) {
      await Room.findByIdAndDelete(req.params.id);
      return res.json({ message: 'Комната удалена (все вышли)' });
    }
    if (room.owner.toString() === req.userId.toString()) room.owner = room.members[0];
    await room.save();
    res.json({ message: 'Вы покинули комнату' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;