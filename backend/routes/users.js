const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// Получить всех пользователей
router.get('/', auth, async (req, res) => {
  try {
    const search = req.query.search || '';
    const query = search 
      ? { username: { $regex: search, $options: 'i' } }
      : {};
    
    const users = await User.find(query)
      .select('-password')
      .sort({ status: -1, username: 1 })
      .limit(100);
    
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить профиль пользователя по ID
router.get('/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновить профиль
router.put('/profile', auth, [
  body('firstName').optional().trim().isLength({ max: 50 }),
  body('lastName').optional().trim().isLength({ max: 50 }),
  body('bio').optional().trim().isLength({ max: 500 }),
  body('location').optional().trim().isLength({ max: 100 }),
  body('website').optional().trim().isLength({ max: 200 }),
  body('avatarColor').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { firstName, lastName, bio, birthDate, location, website, avatarColor } = req.body;

    const updateData = {};
    if (firstName !== undefined) updateData['profile.firstName'] = firstName;
    if (lastName !== undefined) updateData['profile.lastName'] = lastName;
    if (bio !== undefined) updateData['profile.bio'] = bio;
    if (birthDate !== undefined) updateData['profile.birthDate'] = birthDate || null;
    if (location !== undefined) updateData['profile.location'] = location;
    if (website !== undefined) updateData['profile.website'] = website;
    if (avatarColor !== undefined) updateData['profile.avatarColor'] = avatarColor;

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    res.json({ user, message: 'Профиль обновлён' });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;