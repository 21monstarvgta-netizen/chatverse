var express = require('express');
var router = express.Router();
var mongoose = require('mongoose');
var https = require('https');

var BOT_TOKEN = process.env.BOT_TOKEN;

function sendTgMessage(chat_id, text) {
  if (!BOT_TOKEN) return;
  var data = JSON.stringify({ chat_id: parseInt(chat_id), text, parse_mode: 'Markdown' });
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

var taskSchema = new mongoose.Schema({
  task_id: { type: String, required: true },
  chat_id: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  date: { type: String, required: true },
  time: { type: String, default: '' },
  creator: { type: String, default: '' },
  done: { type: Boolean, default: false },
  notified: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
});
taskSchema.index({ chat_id: 1, task_id: 1 }, { unique: true });

var Task = mongoose.model('Task', taskSchema);

// Все задачи чата
router.get('/:chat_id', async function(req, res) {
  try {
    var tasks = await Task.find({ chat_id: req.params.chat_id }).sort({ date: 1 });
    res.json(tasks);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Создать задачу
router.post('/:chat_id', async function(req, res) {
  try {
    var { task_id, title, description, date, time, creator } = req.body;
    var task = new Task({ task_id, chat_id: req.params.chat_id, title, description, date, time, creator });
    await task.save();

    // Уведомление о создании задачи
    var dateObj = new Date(date + 'T00:00:00');
    var dateStr = dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    var timeStr = time ? ` в ${time}` : '';
    var descStr = description ? `\n_${description}_` : '';
    sendTgMessage(req.params.chat_id,
      `📅 *${creator}* создал(а) новую задачу:\n\n*${title}*${descStr}\n\n🗓 ${dateStr}${timeStr}`
    );

    res.json(task);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Отметить выполненной
router.post('/:chat_id/:task_id/toggle', async function(req, res) {
  try {
    var task = await Task.findOne({ chat_id: req.params.chat_id, task_id: req.params.task_id });
    if (!task) return res.status(404).json({ error: 'Not found' });
    task.done = !task.done;
    await task.save();
    res.json(task);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Удалить задачу
router.delete('/:chat_id/:task_id', async function(req, res) {
  try {
    await Task.deleteOne({ chat_id: req.params.chat_id, task_id: req.params.task_id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Задачи на сегодня (для ежедневных уведомлений)
router.get('/:chat_id/notify/today', async function(req, res) {
  try {
    var today = new Date().toISOString().split('T')[0];
    var tasks = await Task.find({ chat_id: req.params.chat_id, date: today, done: false, notified: false });
    // Отмечаем как уведомлённые
    for (var task of tasks) {
      task.notified = true;
      await task.save();
      var timeStr = task.time ? ` в ${task.time}` : '';
      var descStr = task.description ? `\n_${task.description}_` : '';
      sendTgMessage(req.params.chat_id,
        `🔔 *Напоминание!*\n\n📌 *${task.title}*${descStr}\n\n⏰ Сегодня${timeStr}`
      );
    }
    res.json(tasks);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.Task = Task;
