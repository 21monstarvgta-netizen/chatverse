var mongoose = require('mongoose');

var dailyQuestSchema = new mongoose.Schema({
  questId:     { type: String, required: true, unique: true },
  title:       { type: String, required: true },
  description: { type: String, required: true },
  type:        { type: String, required: true },   // 'build','collect','upgrade','spend','unlock_zone'
  target:      { type: String, required: true },   // e.g. 'farm', 'coins', 'any'
  count:       { type: Number, required: true },
  reward:      { type: Object, default: {} },      // { coins, food, materials, crystals, experience }
  createdBy:   { type: String, default: 'admin' },
  expiresAt:   { type: Date,   required: true },   // auto-set to now+24h
  active:      { type: Boolean, default: true }
}, { timestamps: true });

// Auto-expire: mark as inactive after expiresAt
dailyQuestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('DailyQuest', dailyQuestSchema);
