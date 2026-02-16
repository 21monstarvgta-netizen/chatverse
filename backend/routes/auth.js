const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// Генерация токена
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// Регистрация
router.post('/register', [
  body('username')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Логин должен быть от 3 до 20 символов')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Логин может содержать только буквы, цифры и _'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Пароль должен быть минимум 6 символов')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { username, password } = req.body;

    // Проверяем существует ли пользователь
    const existingUser = await User.findOne({ 
      username: { $regex: new RegExp(`^${username}$`, 'i') } 
    });
    
    if (existingUser) {
      return res.status(400).json({ error: 'Этот логин уже занят' });
    }

    // Случайный цвет аватара
    const colors = ['#6c5ce7', '#00b894', '#e17055', '#0984e3', '#e84393', '#fd79a8', '#00cec9', '#fab1a0'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    const user = new User({
      username,
      password,
      profile: { avatarColor: randomColor }
    });

    await user.save();

    const token = generateToken(user._id);

    res.status(201).json({
      token,
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Вход
router.post('/login', [
  body('username').trim().notEmpty().withMessage('Введите логин'),
  body('password').notEmpty().withMessage('Введите пароль')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { username, password } = req.body;

    const user = await User.findOne({ 
      username: { $regex: new RegExp(`^${username}$`, 'i') } 
    });
    
    if (!user) {
      return res.status(400).json({ error: 'Неверный логин или пароль' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Неверный логин или пароль' });
    }

    // Обновляем статус
    user.status = 'online';
    user.lastSeen = new Date();
    await user.save();

    const token = generateToken(user._id);

    res.json({
      token,
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить текущего пользователя
router.get('/me', auth, async (req, res) => {
  res.json({ user: req.user.toJSON() });
});

module.exports = router;