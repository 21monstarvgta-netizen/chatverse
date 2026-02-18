const mongoose = require('mongoose');

const activeQuestSchema = new mongoose.Schema({
  questId: { type: Number, default: 0 },
  type: { type: String, default: '' },
  target: { type: String, default: '' },
  count: { type: Number, default: 0 },
  reward: { type: Object, default: {} },
  description: { type: String, default: '' },
  progress: { type: Number, default: 0 }
}, { _id: false });

const buildingSchema = new mongoose.Schema({
  type: { type: String, required: true },
  level: { type: Number, default: 1 },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  lastCollected: { type: Date, default: Date.now },
  isProducing: { type: Boolean, default: true }
}, { _id: false });

const zoneSchema = new mongoose.Schema({
  x1: { type: Number, default: 0 },
  y1: { type: Number, default: 0 },
  x2: { type: Number, default: 0 },
  y2: { type: Number, default: 0 },
  direction: { type: String, default: '' }
}, { _id: false });

const gamePlayerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  level: { type: Number, default: 1 },
  experience: { type: Number, default: 0 },
  resources: {
    coins: { type: Number, default: 500 },
    food: { type: Number, default: 200 },
    materials: { type: Number, default: 100 },
    energy: { type: Number, default: 10 },
    population: { type: Number, default: 0 },
    crystals: { type: Number, default: 5 }
  },
  buildings: [buildingSchema],
  unlockedZones: [zoneSchema],
  completedQuests: [{ type: Number }],
  activeQuests: [activeQuestSchema],
  stats: {
    totalBuilt: { type: Number, default: 0 },
    totalCollected: { type: Number, default: 0 },
    totalUpgrades: { type: Number, default: 0 },
    totalCoinsEarned: { type: Number, default: 0 },
    zonesUnlocked: { type: Number, default: 0 }
  },
  lastOnline: { type: Date, default: Date.now },
  cityName: { type: String, default: 'Мой город', maxlength: 30 }
}, { timestamps: true });

gamePlayerSchema.index({ userId: 1 });
gamePlayerSchema.index({ level: -1 });

module.exports = mongoose.model('GamePlayer', gamePlayerSchema);