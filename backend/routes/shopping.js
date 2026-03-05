var express = require('express');
var router = express.Router();
var mongoose = require('mongoose');
var https = require('https');

var BOT_TOKEN = process.env.BOT_TOKEN;

function sendTgMessage(chat_id, text) {
  if (!BOT_TOKEN) return;
  var data = JSON.stringify({ chat_id: Number(chat_id), text, parse_mode: 'Markdown' });
  var options = {
    hostname: 'api.telegram.org',
    path: '/bot' + BOT_TOKEN + '/sendMessage',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  };
  var req = https.request(options);
  req.on('error', function(e) { console.error('TG notify error:', e.message); });
  req.write(data);
  req.end();
}

var itemSchema = new mongoose.Schema({
  name: String,
  cat_id: String,
  bought: { type: Boolean, default: false },
  buyer: { type: String, default: null },
  added_by: String,
}, { _id: false });

var listSchema = new mongoose.Schema({
  list_id: { type: String, required: true },
  chat_id: { type: String, required: true },
  name: { type: String, required: true },
  creator: String,
  items: { type: Map, of: itemSchema, default: {} },
  created_at: { type: Date, default: Date.now },
});
listSchema.index({ chat_id: 1, list_id: 1 }, { unique: true });

var List = mongoose.model('ShoppingList', listSchema);

// Все списки чата
router.get('/:chat_id', async function(req, res) {
  try {
    var lists = await List.find({ chat_id: req.params.chat_id });
    res.json(lists);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Создать список
router.post('/:chat_id', async function(req, res) {
  try {
    var { list_id, name, creator } = req.body;
    var list = new List({ list_id, chat_id: req.params.chat_id, name, creator, items: {} });
    await list.save();
    // Уведомление в чат
    sendTgMessage(req.params.chat_id, `🛒 *${creator}* создал(а) новый список покупок: *«${name}»*`);
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Удалить список
router.delete('/:chat_id/:list_id', async function(req, res) {
  try {
    await List.deleteOne({ chat_id: req.params.chat_id, list_id: req.params.list_id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Добавить/убрать товар
router.post('/:chat_id/:list_id/toggle', async function(req, res) {
  try {
    var { key, name, cat_id, added_by } = req.body;
    var list = await List.findOne({ chat_id: req.params.chat_id, list_id: req.params.list_id });
    if (!list) return res.status(404).json({ error: 'Not found' });
    if (list.items.get(key)) {
      list.items.delete(key);
    } else {
      list.items.set(key, { name, cat_id, bought: false, buyer: null, added_by });
    }
    list.markModified('items');
    await list.save();
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Добавить свой товар
router.post('/:chat_id/:list_id/custom', async function(req, res) {
  try {
    var { name, added_by } = req.body;
    var list = await List.findOne({ chat_id: req.params.chat_id, list_id: req.params.list_id });
    if (!list) return res.status(404).json({ error: 'Not found' });
    var key = 'custom::' + name;
    if (!list.items.get(key)) {
      list.items.set(key, { name, cat_id: 'custom', bought: false, buyer: null, added_by });
      list.markModified('items');
      await list.save();
    }
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Отметить купленным
router.post('/:chat_id/:list_id/buy', async function(req, res) {
  try {
    var { key, buyer } = req.body;
    var list = await List.findOne({ chat_id: req.params.chat_id, list_id: req.params.list_id });
    if (!list) return res.status(404).json({ error: 'Not found' });
    var item = list.items.get(key);
    if (item) {
      item.bought = !item.bought;
      item.buyer = item.bought ? buyer : null;
      list.items.set(key, item);
      list.markModified('items');
      await list.save();
    }
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Удалить товар
router.delete('/:chat_id/:list_id/item', async function(req, res) {
  try {
    var { key } = req.body;
    var list = await List.findOne({ chat_id: req.params.chat_id, list_id: req.params.list_id });
    if (!list) return res.status(404).json({ error: 'Not found' });
    list.items.delete(key);
    list.markModified('items');
    await list.save();
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Убрать купленные
router.post('/:chat_id/:list_id/clearbought', async function(req, res) {
  try {
    var list = await List.findOne({ chat_id: req.params.chat_id, list_id: req.params.list_id });
    if (!list) return res.status(404).json({ error: 'Not found' });
    for (var [key, item] of list.items) {
      if (item.bought) list.items.delete(key);
    }
    list.markModified('items');
    await list.save();
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
