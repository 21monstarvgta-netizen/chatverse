var express = require('express');
var router = express.Router();
var mongoose = require('mongoose');

var taskSchema = new mongoose.Schema({
  task_id: { type: String, required: true },
  chat_id: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  date: { type: String, required: true },
  time: { type: String, default: '' },
  creator: { type: String, default: '' },
  done: { type: Boolean, default: false },
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

// Задачи на сегодня (для уведомлений)
router.get('/:chat_id/notify/today', async function(req, res) {
  try {
    var today = new Date().toISOString().split('T')[0];
    var tasks = await Task.find({ chat_id: req.params.chat_id, date: today, done: false });
    res.json(tasks);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.Task = Task;
