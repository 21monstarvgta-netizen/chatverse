const mongoose = require('mongoose');

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
  buildings: [{
    type: { type: String, required: true },
    level: { type: Number, default: 1 },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    lastCollected: { type: Date, default: Date.now },
    isProducing: { type: Boolean, default: true }
  }],
  unlockedZones: [{
    x1: Number, y1: Number,
    x2: Number, y2: Number,
    direction: String
  }],
  completedQuests: [{ type: Number }], // indices into QUEST_TEMPLATES
  activeQuests: [{
    questId: Number,
    type: String,
    target: String,
    count: Number,
    reward: mongoose.Schema.Types.Mixed,
    description: String,
    progress: { type: Number, default: 0 }
  }],
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