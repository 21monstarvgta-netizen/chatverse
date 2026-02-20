const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = multer.memoryStorage();

const avatarUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Только изображения!'), false);
  }
});

const chatImageUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Только изображения!'), false);
  }
});

// Upload avatar
router.post('/avatar', auth, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Выберите изображение' });

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'chatverse/avatars',
          public_id: 'user_' + req.userId,
          overwrite: true,
          transformation: [
            { width: 200, height: 200, crop: 'fill', gravity: 'face' },
            { quality: 'auto', fetch_format: 'auto' }
          ]
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: { 'profile.avatarUrl': result.secure_url } },
      { new: true }
    ).select('-password');

    res.json({ user, avatarUrl: result.secure_url });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Ошибка загрузки' });
  }
});

// Delete avatar
router.delete('/avatar', auth, async (req, res) => {
  try {
    try {
      await cloudinary.uploader.destroy('chatverse/avatars/user_' + req.userId);
    } catch (e) {}

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: { 'profile.avatarUrl': '' } },
      { new: true }
    ).select('-password');

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

// Upload chat image
router.post('/chat-image', auth, chatImageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Выберите изображение' });

    const timestamp = Date.now();
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'chatverse/chat',
          public_id: 'msg_' + req.userId + '_' + timestamp,
          transformation: [
            { width: 800, height: 800, crop: 'limit' },
            { quality: 'auto', fetch_format: 'auto' }
          ]
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    res.json({ imageUrl: result.secure_url });
  } catch (error) {
    console.error('Chat image upload error:', error);
    res.status(500).json({ error: 'Ошибка загрузки изображения' });
  }
});


// Upload any file to chat (via Cloudinary raw)
const chatFileUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

router.post('/chat-file', auth, chatFileUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Выберите файл' });

    const timestamp = Date.now();
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'chatverse/files',
          public_id: 'file_' + req.userId + '_' + timestamp,
          resource_type: 'auto',
          use_filename: false,
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    res.json({
      fileUrl: result.secure_url,
      fileName: originalName,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });
  } catch (error) {
    console.error('Chat file upload error:', error);
    res.status(500).json({ error: 'Ошибка загрузки файла' });
  }
});

module.exports = router;