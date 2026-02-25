var mongoose = require('mongoose');

var activeQuestSchema = new mongoose.Schema({
  questId: { type: String, default: '' },
  type: { type: String, default: '' },
  target: { type: String, default: '' },
  count: { type: Number, default: 0 },
  reward: { type: Object, default: {} },
  description: { type: String, default: '' },
  progress: { type: Number, default: 0 }
}, { _id: false });

var buildingSchema = new mongoose.Schema({
  type: { type: String, required: true },
  level: { type: Number, default: 1 },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  lastCollected: { type: Date, default: Date.now },
  isProducing: { type: Boolean, default: true }
}, { _id: false });

var zoneSchema = new mongoose.Schema({
  x1: { type: Number, default: 0 },
  y1: { type: Number, default: 0 },
  x2: { type: Number, default: 0 },
  y2: { type: Number, default: 0 },
  direction: { type: String, default: '' }
}, { _id: false });

var gamePlayerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  level: { type: Number, default: 1 },
  experience: { type: Number, default: 0 },
  resources: {
    coins: { type: Number, default: 5000 },
    food: { type: Number, default: 2000 },
    materials: { type: Number, default: 1000 },
    energy: { type: Number, default: 10 },
    population: { type: Number, default: 0 },
    crystals: { type: Number, default: 50 }
  },
  buildings: [buildingSchema],
  unlockedZones: [zoneSchema],
  completedQuests: [{ type: String }],
  activeQuests: [activeQuestSchema],
  activeThreats: [{
    id: String,
    type: String,
    name: String,
    emoji: String,
    hp: { type: Number, default: 1 },
    maxHp: { type: Number, default: 1 },
    x: Number,
    y: Number,
    spawnedAt: { type: Date, default: Date.now }
  }],
  stats: {
    totalBuilt: { type: Number, default: 0 },
    totalCollected: { type: Number, default: 0 },
    totalUpgrades: { type: Number, default: 0 },
    totalCoinsEarned: { type: Number, default: 0 },
    totalFoodEarned: { type: Number, default: 0 },
    totalMaterialsEarned: { type: Number, default: 0 },
    zonesUnlocked: { type: Number, default: 0 }
  },
  lastOnline: { type: Date, default: Date.now },
  cityName: { type: String, default: 'Мой город', maxlength: 30 }
}, { timestamps: true });

// Drop old problematic index and create new one
gamePlayerSchema.index({ userId: 1 }, { unique: true, sparse: true });
gamePlayerSchema.index({ level: -1 });

module.exports = mongoose.model('GamePlayer', gamePlayerSchema);