const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ── MongoDB connection ──
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// ── Schema ──
const itemSchema = new mongoose.Schema({
  name: String,
  cat_id: String,
  bought: { type: Boolean, default: false },
  buyer: { type: String, default: null },
  added_by: String,
}, { _id: true });

const listSchema = new mongoose.Schema({
  list_id: { type: String, required: true },
  chat_id: { type: String, required: true },
  name: { type: String, required: true },
  creator: String,
  items: { type: Map, of: itemSchema, default: {} },
  created_at: { type: Date, default: Date.now },
});
listSchema.index({ chat_id: 1, list_id: 1 }, { unique: true });

const List = mongoose.model('ShoppingList', listSchema);

// ── Middleware: проверка chat_id ──
// Telegram передаёт initData в заголовке, мы берём chat_id из query
// Для простоты без верификации подписи (можно добавить позже)

// ── Routes ──

// Все списки чата
app.get('/api/lists/:chat_id', async (req, res) => {
  try {
    const lists = await List.find({ chat_id: req.params.chat_id });
    res.json(lists);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Создать список
app.post('/api/lists/:chat_id', async (req, res) => {
  try {
    const { list_id, name, creator } = req.body;
    const list = new List({ list_id, chat_id: req.params.chat_id, name, creator, items: {} });
    await list.save();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Удалить список
app.delete('/api/lists/:chat_id/:list_id', async (req, res) => {
  try {
    await List.deleteOne({ chat_id: req.params.chat_id, list_id: req.params.list_id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Добавить/убрать товар
app.post('/api/lists/:chat_id/:list_id/toggle', async (req, res) => {
  try {
    const { key, name, cat_id, added_by } = req.body;
    const list = await List.findOne({ chat_id: req.params.chat_id, list_id: req.params.list_id });
    if (!list) return res.status(404).json({ error: 'List not found' });

    if (list.items.get(key)) {
      list.items.delete(key);
    } else {
      list.items.set(key, { name, cat_id, bought: false, buyer: null, added_by });
    }
    list.markModified('items');
    await list.save();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Добавить свой товар
app.post('/api/lists/:chat_id/:list_id/custom', async (req, res) => {
  try {
    const { name, added_by } = req.body;
    const list = await List.findOne({ chat_id: req.params.chat_id, list_id: req.params.list_id });
    if (!list) return res.status(404).json({ error: 'List not found' });

    const key = `custom::${name}`;
    if (!list.items.get(key)) {
      list.items.set(key, { name, cat_id: 'custom', bought: false, buyer: null, added_by });
      list.markModified('items');
      await list.save();
    }
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Отметить купленным
app.post('/api/lists/:chat_id/:list_id/buy', async (req, res) => {
  try {
    const { key, buyer } = req.body;
    const list = await List.findOne({ chat_id: req.params.chat_id, list_id: req.params.list_id });
    if (!list) return res.status(404).json({ error: 'List not found' });

    const item = list.items.get(key);
    if (item) {
      item.bought = !item.bought;
      item.buyer = item.bought ? buyer : null;
      list.items.set(key, item);
      list.markModified('items');
      await list.save();
    }
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Удалить товар
app.delete('/api/lists/:chat_id/:list_id/item', async (req, res) => {
  try {
    const { key } = req.body;
    const list = await List.findOne({ chat_id: req.params.chat_id, list_id: req.params.list_id });
    if (!list) return res.status(404).json({ error: 'List not found' });

    list.items.delete(key);
    list.markModified('items');
    await list.save();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Убрать купленные
app.post('/api/lists/:chat_id/:list_id/clearbought', async (req, res) => {
  try {
    const list = await List.findOne({ chat_id: req.params.chat_id, list_id: req.params.list_id });
    if (!list) return res.status(404).json({ error: 'List not found' });

    for (const [key, item] of list.items) {
      if (item.bought) list.items.delete(key);
    }
    list.markModified('items');
    await list.save();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.SHOP_PORT || 3001;
app.listen(PORT, () => console.log(`Shopping API running on port ${PORT}`));
