const express = require('express');
const { body, validationResult } = require('express-validator');
const Post = require('../models/Post');
const auth = require('../middleware/auth');

const router = express.Router();

const populatePost = [
  { path: 'author', select: 'username profile role' },
  { path: 'comments.author', select: 'username profile role' },
  { path: 'likes', select: 'username' }
];

// Get all posts (feed)
router.get('/', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const posts = await Post.find()
      .populate(populatePost)
      .sort({ pinned: -1, createdAt: -1 })
      .skip(skip).limit(limit);

    const total = await Post.countDocuments();
    res.json({ posts, total, hasMore: skip + posts.length < total });
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get user's posts
router.get('/user/:userId', auth, async (req, res) => {
  try {
    const posts = await Post.find({ author: req.params.userId })
      .populate(populatePost)
      .sort({ createdAt: -1 }).limit(50);
    res.json({ posts });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Create post
router.post('/', auth, [
  body('content').trim().isLength({ min: 1, max: 5000 }).withMessage('Текст от 1 до 5000 символов')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { content, imageUrl, emoji } = req.body;
    const post = new Post({
      content: content.trim(),
      author: req.userId,
      imageUrl: imageUrl || '',
      emoji: emoji || ''
    });

    await post.save();
    const populated = await Post.findById(post._id).populate(populatePost);
    res.status(201).json({ post: populated });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Like/unlike post
router.post('/:id/like', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Пост не найден' });

    const idx = post.likes.indexOf(req.userId);
    if (idx >= 0) post.likes.splice(idx, 1);
    else post.likes.push(req.userId);

    await post.save();
    const populated = await Post.findById(post._id).populate(populatePost);
    res.json({ post: populated });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Add comment
router.post('/:id/comment', auth, [
  body('content').trim().isLength({ min: 1, max: 1000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Пост не найден' });

    post.comments.push({ content: req.body.content.trim(), author: req.userId });
    await post.save();

    const populated = await Post.findById(post._id).populate(populatePost);
    res.json({ post: populated });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Delete comment (author of post or comment or admin)
router.delete('/:postId/comment/:commentId', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ error: 'Пост не найден' });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Комментарий не найден' });

    const isPostAuthor = post.author.toString() === req.userId.toString();
    const isCommentAuthor = comment.author.toString() === req.userId.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isPostAuthor && !isCommentAuthor && !isAdmin) {
      return res.status(403).json({ error: 'Нет прав' });
    }

    post.comments.pull({ _id: req.params.commentId });
    await post.save();

    const populated = await Post.findById(post._id).populate(populatePost);
    res.json({ post: populated });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Delete post (author or admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Пост не найден' });

    const isAuthor = post.author.toString() === req.userId.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isAuthor && !isAdmin) return res.status(403).json({ error: 'Нет прав' });

    await Post.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;