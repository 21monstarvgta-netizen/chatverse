const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const search = req.query.search || '';
    const query = search ? { username: { $regex: search, $options: 'i' } } : {};
    const users = await User.find(query).select('-password').sort({ status: -1, username: 1 }).limit(100);
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.put('/profile', auth, [
  body('firstName').optional().trim().isLength({ max: 50 }),
  body('lastName').optional().trim().isLength({ max: 50 }),
  body('bio').optional().trim().isLength({ max: 500 }),
  body('location').optional().trim().isLength({ max: 100 }),
  body('website').optional().trim().isLength({ max: 200 }),
  body('avatarColor').optional().trim(),
  body('statusEmoji').optional().trim().isLength({ max: 10 }),
  body('statusText').optional().trim().isLength({ max: 100 }),
  body('bannerColor1').optional().trim(),
  body('bannerColor2').optional().trim(),
  body('nameGlow').optional().isBoolean(),
  body('nameColor').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { firstName, lastName, bio, birthDate, location, website, avatarColor,
            statusEmoji, statusText, bannerColor1, bannerColor2, nameGlow, nameColor } = req.body;

    const updateData = {};
    if (firstName !== undefined) updateData['profile.firstName'] = firstName;
    if (lastName !== undefined) updateData['profile.lastName'] = lastName;
    if (bio !== undefined) updateData['profile.bio'] = bio;
    if (birthDate !== undefined) updateData['profile.birthDate'] = birthDate || null;
    if (location !== undefined) updateData['profile.location'] = location;
    if (website !== undefined) updateData['profile.website'] = website;
    if (avatarColor !== undefined) updateData['profile.avatarColor'] = avatarColor;
    if (statusEmoji !== undefined) updateData['profile.statusEmoji'] = statusEmoji;
    if (statusText !== undefined) updateData['profile.statusText'] = statusText;
    if (bannerColor1 !== undefined) updateData['profile.bannerColor1'] = bannerColor1;
    if (bannerColor2 !== undefined) updateData['profile.bannerColor2'] = bannerColor2;
    if (nameGlow !== undefined) updateData['profile.nameGlow'] = nameGlow;
    if (nameColor !== undefined) updateData['profile.nameColor'] = nameColor;

    const user = await User.findByIdAndUpdate(req.userId, { $set: updateData }, { new: true, runValidators: true }).select('-password');
    res.json({ user, message: 'Профиль обновлён' });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Admin: edit any user profile
router.put('/admin/edit/:userId', auth, admin, async (req, res) => {
  try {
    const { firstName, lastName, bio, location, website, avatarColor, role } = req.body;
    const updateData = {};
    if (firstName !== undefined) updateData['profile.firstName'] = firstName;
    if (lastName !== undefined) updateData['profile.lastName'] = lastName;
    if (bio !== undefined) updateData['profile.bio'] = bio;
    if (location !== undefined) updateData['profile.location'] = location;
    if (website !== undefined) updateData['profile.website'] = website;
    if (avatarColor !== undefined) updateData['profile.avatarColor'] = avatarColor;
    if (role !== undefined && ['user', 'admin'].includes(role)) updateData.role = role;

    const user = await User.findByIdAndUpdate(req.params.userId, { $set: updateData }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Admin: ban user
router.post('/admin/ban/:userId', auth, admin, async (req, res) => {
  try {
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
    if (target.role === 'admin') return res.status(400).json({ error: 'Нельзя забанить администратора' });

    target.isBanned = true;
    target.banReason = req.body.reason || 'Нарушение правил';
    target.status = 'offline';
    await target.save();

    // Disconnect user via socket
    const io = req.app.get('io');
    io.to('user:' + target._id.toString()).emit('banned', { reason: target.banReason });

    res.json({ message: 'Пользователь заблокирован' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Admin: unban user
router.post('/admin/unban/:userId', auth, admin, async (req, res) => {
  try {
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
    target.isBanned = false;
    target.banReason = '';
    await target.save();
    res.json({ message: 'Пользователь разблокирован' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Admin: delete user
router.delete('/admin/delete/:userId', auth, admin, async (req, res) => {
  try {
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
    if (target.role === 'admin') return res.status(400).json({ error: 'Нельзя удалить администратора' });

    const Message = require('../models/Message');
    await Message.deleteMany({ sender: target._id });

    const Room = require('../models/Room');
    await Room.updateMany({ members: target._id }, { $pull: { members: target._id } });

    await User.findByIdAndDelete(target._id);

    const io = req.app.get('io');
    io.to('user:' + target._id.toString()).emit('account:deleted');

    res.json({ message: 'Пользователь удалён' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Admin: set role
router.post('/admin/role/:userId', auth, admin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Неверная роль' });
    const user = await User.findByIdAndUpdate(req.params.userId, { role }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;