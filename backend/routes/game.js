const express = require('express');
const GamePlayer = require('../models/GamePlayer');
const auth = require('../middleware/auth');
const config = require('../game/gameConfig');
const logic = require('../game/gameLogic');

const router = express.Router();

// Get or create game state
router.get('/state', auth, async (req, res) => {
  try {
    let player = await GamePlayer.findOne({ userId: req.userId });
    if (!player) {
      player = new GamePlayer({
        userId: req.userId,
        activeQuests: logic.getQuestsForLevel(1, [])
      });
      await player.save();
    }

    // Process offline progress
    var now = new Date();
    var result = logic.processOfflineProgress(player, player.buildings, now);
    player.resources = result.resources;
    player.lastOnline = now;
    await player.save();

    var maxStorage = logic.calculateMaxStorage(player.buildings);
    var totalEnergy = logic.calculateTotalEnergy(player.buildings);
    var usedEnergy = logic.calculateUsedEnergy(player.buildings);
    var totalPopulation = logic.calculateTotalPopulation(player.buildings);
    var nextZones = logic.getNextZones(player.unlockedZones);
    var xpNeeded = config.LEVEL_XP(player.level + 1);

    res.json({
      player: {
        level: player.level,
        experience: player.experience,
        xpNeeded: xpNeeded,
        resources: player.resources,
        buildings: player.buildings,
        unlockedZones: player.unlockedZones,
        activeQuests: player.activeQuests,
        completedQuests: player.completedQuests,
        stats: player.stats,
        cityName: player.cityName,
        maxStorage: maxStorage,
        totalEnergy: totalEnergy,
        usedEnergy: usedEnergy,
        totalPopulation: totalPopulation,
        nextZones: nextZones,
        offlineCollected: result.collected
      },
      config: {
        gridSize: config.GRID_SIZE,
        initialUnlocked: config.INITIAL_UNLOCKED,
        buildingTypes: config.BUILDING_TYPES
      }
    });
  } catch (error) {
    console.error('Game state error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Build
router.post('/build', auth, async (req, res) => {
  try {
    var { buildingType, x, y } = req.body;
    var player = await GamePlayer.findOne({ userId: req.userId });
    if (!player) return res.status(404).json({ error: 'Игрок не найден' });

    var bt = config.BUILDING_TYPES[buildingType];
    if (!bt) return res.status(400).json({ error: 'Неизвестное здание' });

    if (player.level < bt.unlockLevel) {
      return res.status(400).json({ error: 'Требуется уровень ' + bt.unlockLevel });
    }

    // Check tile unlocked
    if (!logic.isTileUnlocked(x, y, player.unlockedZones)) {
      return res.status(400).json({ error: 'Территория не открыта' });
    }

    // Check tile empty
    var occupied = player.buildings.some(function(b) { return b.x === x && b.y === y; });
    if (occupied) return res.status(400).json({ error: 'Клетка занята' });

    // Check energy
    var totalEnergy = logic.calculateTotalEnergy(player.buildings);
    var usedEnergy = logic.calculateUsedEnergy(player.buildings);
    if (usedEnergy + bt.energyCost > totalEnergy && buildingType !== 'powerplant') {
      return res.status(400).json({ error: 'Недостаточно энергии' });
    }

    // Check cost
    var cost = logic.calculateBuildCost(buildingType);
    if (!logic.canAfford(player.resources, cost)) {
      return res.status(400).json({ error: 'Недостаточно ресурсов' });
    }

    logic.subtractResources(player.resources, cost);

    player.buildings.push({
      type: buildingType,
      level: 1,
      x: x,
      y: y,
      lastCollected: new Date(),
      isProducing: true
    });

    // Stats and XP
    player.stats.totalBuilt += 1;
    player.experience += 10 + player.level * 2;

    // Check level up
    var xpNeeded = config.LEVEL_XP(player.level + 1);
    while (player.experience >= xpNeeded) {
      player.experience -= xpNeeded;
      player.level += 1;
      xpNeeded = config.LEVEL_XP(player.level + 1);
      // Add new quests
      var newQuests = logic.getQuestsForLevel(player.level, player.completedQuests);
      newQuests.forEach(function(q) {
        if (!player.activeQuests.some(function(aq) { return aq.questId === q.questId; })) {
          player.activeQuests.push(q);
        }
      });
    }

    // Update quest progress
    updateQuestProgress(player, 'build', buildingType, 1);
    updateQuestProgress(player, 'build_count', 'any', 1);

    player.markModified('resources');
    player.markModified('buildings');
    player.markModified('activeQuests');
    player.markModified('stats');
    await player.save();

    res.json({ success: true, player: getPlayerState(player) });
  } catch (error) {
    console.error('Build error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Collect resources from building
router.post('/collect/:buildingIndex', auth, async (req, res) => {
  try {
    var player = await GamePlayer.findOne({ userId: req.userId });
    if (!player) return res.status(404).json({ error: 'Игрок не найден' });

    var idx = parseInt(req.params.buildingIndex);
    if (idx < 0 || idx >= player.buildings.length) {
      return res.status(400).json({ error: 'Здание не найдено' });
    }

    var building = player.buildings[idx];
    var bt = config.BUILDING_TYPES[building.type];
    if (!bt || bt.baseTime === 0) {
      return res.status(400).json({ error: 'Это здание не производит ресурсы' });
    }

    var now = new Date();
    var elapsed = Math.floor((now - new Date(building.lastCollected)) / 1000);
    var prodTime = logic.calculateProductionTime(building.type, building.level);

    if (elapsed < prodTime) {
      return res.status(400).json({ error: 'Ещё не готово', remaining: prodTime - elapsed });
    }

    var cycles = Math.floor(elapsed / prodTime);
    // Cap to prevent abuse
    cycles = Math.min(cycles, 10);

    var output = logic.calculateOutput(building.type, building.level);
    var maxStorage = logic.calculateMaxStorage(player.buildings);
    var collected = {};

    for (var r in output) {
      collected[r] = output[r] * cycles;
    }

    logic.addResources(player.resources, collected, maxStorage);
    building.lastCollected = now;

    // Stats and XP
    player.stats.totalCollected += 1;
    if (collected.coins) player.stats.totalCoinsEarned += collected.coins;
    player.experience += 5 + player.level;

    // Check level up
    var xpNeeded = config.LEVEL_XP(player.level + 1);
    while (player.experience >= xpNeeded) {
      player.experience -= xpNeeded;
      player.level += 1;
      xpNeeded = config.LEVEL_XP(player.level + 1);
      var newQuests = logic.getQuestsForLevel(player.level, player.completedQuests);
      newQuests.forEach(function(q) {
        if (!player.activeQuests.some(function(aq) { return aq.questId === q.questId; })) {
          player.activeQuests.push(q);
        }
      });
    }

    // Update quest progress
    for (var res in collected) {
      updateQuestProgress(player, 'collect', res, collected[res]);
    }

    player.markModified('resources');
    player.markModified('buildings');
    player.markModified('activeQuests');
    player.markModified('stats');
    await player.save();

    res.json({ success: true, collected: collected, player: getPlayerState(player) });
  } catch (error) {
    console.error('Collect error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Collect all ready buildings
router.post('/collect-all', auth, async (req, res) => {
  try {
    var player = await GamePlayer.findOne({ userId: req.userId });
    if (!player) return res.status(404).json({ error: 'Игрок не найден' });

    var now = new Date();
    var maxStorage = logic.calculateMaxStorage(player.buildings);
    var totalCollected = {};
    var count = 0;

    for (var i = 0; i < player.buildings.length; i++) {
      var building = player.buildings[i];
      var bt = config.BUILDING_TYPES[building.type];
      if (!bt || bt.baseTime === 0) continue;

      var elapsed = Math.floor((now - new Date(building.lastCollected)) / 1000);
      var prodTime = logic.calculateProductionTime(building.type, building.level);
      if (elapsed < prodTime) continue;

      var cycles = Math.min(Math.floor(elapsed / prodTime), 10);
      var output = logic.calculateOutput(building.type, building.level);

      for (var r in output) {
        var amount = output[r] * cycles;
        totalCollected[r] = (totalCollected[r] || 0) + amount;
      }

      building.lastCollected = now;
      count++;
    }

    if (count === 0) return res.json({ success: true, collected: {}, count: 0, player: getPlayerState(player) });

    logic.addResources(player.resources, totalCollected, maxStorage);

    player.stats.totalCollected += count;
    if (totalCollected.coins) player.stats.totalCoinsEarned += totalCollected.coins;
    player.experience += (5 + player.level) * count;

    var xpNeeded = config.LEVEL_XP(player.level + 1);
    while (player.experience >= xpNeeded) {
      player.experience -= xpNeeded;
      player.level += 1;
      xpNeeded = config.LEVEL_XP(player.level + 1);
      var newQuests = logic.getQuestsForLevel(player.level, player.completedQuests);
      newQuests.forEach(function(q) {
        if (!player.activeQuests.some(function(aq) { return aq.questId === q.questId; })) {
          player.activeQuests.push(q);
        }
      });
    }

    for (var res in totalCollected) {
      updateQuestProgress(player, 'collect', res, totalCollected[res]);
    }

    player.markModified('resources');
    player.markModified('buildings');
    player.markModified('activeQuests');
    player.markModified('stats');
    await player.save();

    res.json({ success: true, collected: totalCollected, count: count, player: getPlayerState(player) });
  } catch (error) {
    console.error('Collect all error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Upgrade building
router.post('/upgrade/:buildingIndex', auth, async (req, res) => {
  try {
    var player = await GamePlayer.findOne({ userId: req.userId });
    if (!player) return res.status(404).json({ error: 'Игрок не найден' });

    var idx = parseInt(req.params.buildingIndex);
    if (idx < 0 || idx >= player.buildings.length) {
      return res.status(400).json({ error: 'Здание не найдено' });
    }

    var building = player.buildings[idx];
    var bt = config.BUILDING_TYPES[building.type];
    if (!bt) return res.status(400).json({ error: 'Ошибка' });

    if (building.level >= bt.maxLevel) {
      return res.status(400).json({ error: 'Максимальный уровень' });
    }

    var cost = logic.calculateUpgradeCost(building.type, building.level);
    if (!logic.canAfford(player.resources, cost)) {
      return res.status(400).json({ error: 'Недостаточно ресурсов' });
    }

    logic.subtractResources(player.resources, cost);
    building.level += 1;

    player.stats.totalUpgrades += 1;
    player.experience += 15 + player.level * 3;

    var xpNeeded = config.LEVEL_XP(player.level + 1);
    while (player.experience >= xpNeeded) {
      player.experience -= xpNeeded;
      player.level += 1;
      xpNeeded = config.LEVEL_XP(player.level + 1);
      var newQuests = logic.getQuestsForLevel(player.level, player.completedQuests);
      newQuests.forEach(function(q) {
        if (!player.activeQuests.some(function(aq) { return aq.questId === q.questId; })) {
          player.activeQuests.push(q);
        }
      });
    }

    updateQuestProgress(player, 'upgrade', building.type, building.level);

    player.markModified('resources');
    player.markModified('buildings');
    player.markModified('activeQuests');
    player.markModified('stats');
    await player.save();

    res.json({ success: true, player: getPlayerState(player) });
  } catch (error) {
    console.error('Upgrade error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Demolish building
router.post('/demolish/:buildingIndex', auth, async (req, res) => {
  try {
    var player = await GamePlayer.findOne({ userId: req.userId });
    if (!player) return res.status(404).json({ error: 'Игрок не найден' });

    var idx = parseInt(req.params.buildingIndex);
    if (idx < 0 || idx >= player.buildings.length) {
      return res.status(400).json({ error: 'Здание не найдено' });
    }

    var building = player.buildings[idx];
    var bt = config.BUILDING_TYPES[building.type];

    // Refund 30%
    var cost = logic.calculateBuildCost(building.type);
    var refund = {};
    for (var r in cost) {
      refund[r] = Math.floor(cost[r] * 0.3);
    }
    logic.addResources(player.resources, refund, logic.calculateMaxStorage(player.buildings));

    player.buildings.splice(idx, 1);

    player.markModified('resources');
    player.markModified('buildings');
    await player.save();

    res.json({ success: true, refund: refund, player: getPlayerState(player) });
  } catch (error) {
    console.error('Demolish error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Unlock zone
router.post('/unlock-zone', auth, async (req, res) => {
  try {
    var { zone } = req.body;
    var player = await GamePlayer.findOne({ userId: req.userId });
    if (!player) return res.status(404).json({ error: 'Игрок не найден' });

    var nextZones = logic.getNextZones(player.unlockedZones);
    var target = nextZones.find(function(z) { return z.direction === zone.direction; });
    if (!target) return res.status(400).json({ error: 'Зона недоступна' });

    if ((player.resources.coins || 0) < target.cost) {
      return res.status(400).json({ error: 'Недостаточно монет (' + target.cost + ')' });
    }

    player.resources.coins -= target.cost;
    player.unlockedZones.push({
      x1: target.x1, y1: target.y1,
      x2: target.x2, y2: target.y2,
      direction: target.direction
    });

    player.stats.zonesUnlocked += 1;
    player.experience += 50;

    updateQuestProgress(player, 'unlock_zone', 'zone', player.stats.zonesUnlocked);

    var xpNeeded = config.LEVEL_XP(player.level + 1);
    while (player.experience >= xpNeeded) {
      player.experience -= xpNeeded;
      player.level += 1;
      xpNeeded = config.LEVEL_XP(player.level + 1);
    }

    player.markModified('resources');
    player.markModified('unlockedZones');
    player.markModified('stats');
    player.markModified('activeQuests');
    await player.save();

    res.json({ success: true, player: getPlayerState(player) });
  } catch (error) {
    console.error('Unlock zone error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Claim quest reward
router.post('/quest/claim/:questId', auth, async (req, res) => {
  try {
    var player = await GamePlayer.findOne({ userId: req.userId });
    if (!player) return res.status(404).json({ error: 'Игрок не найден' });

    var questId = parseInt(req.params.questId);
    var questIdx = player.activeQuests.findIndex(function(q) { return q.questId === questId; });
    if (questIdx === -1) return res.status(400).json({ error: 'Квест не найден' });

    var quest = player.activeQuests[questIdx];
    if (quest.progress < quest.count) {
      return res.status(400).json({ error: 'Квест не выполнен' });
    }

    // Give reward
    var maxStorage = logic.calculateMaxStorage(player.buildings);
    logic.addResources(player.resources, quest.reward, maxStorage);

    // Mark completed
    player.completedQuests.push(questId);
    player.activeQuests.splice(questIdx, 1);

    // Add new quests
    var newQuests = logic.getQuestsForLevel(player.level, player.completedQuests);
    newQuests.forEach(function(q) {
      if (!player.activeQuests.some(function(aq) { return aq.questId === q.questId; }) &&
          player.completedQuests.indexOf(q.questId) === -1) {
        player.activeQuests.push(q);
      }
    });

    // Keep max 5 active
    if (player.activeQuests.length > 5) {
      player.activeQuests = player.activeQuests.slice(0, 5);
    }

    player.experience += 20 + player.level * 5;
    var xpNeeded = config.LEVEL_XP(player.level + 1);
    while (player.experience >= xpNeeded) {
      player.experience -= xpNeeded;
      player.level += 1;
      xpNeeded = config.LEVEL_XP(player.level + 1);
    }

    player.markModified('resources');
    player.markModified('activeQuests');
    player.markModified('completedQuests');
    await player.save();

    res.json({ success: true, reward: quest.reward, player: getPlayerState(player) });
  } catch (error) {
    console.error('Quest claim error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Rename city
router.post('/rename', auth, async (req, res) => {
  try {
    var { name } = req.body;
    if (!name || name.trim().length < 1 || name.trim().length > 30) {
      return res.status(400).json({ error: 'Название от 1 до 30 символов' });
    }
    var player = await GamePlayer.findOne({ userId: req.userId });
    if (!player) return res.status(404).json({ error: 'Игрок не найден' });

    player.cityName = name.trim();
    await player.save();

    res.json({ success: true, cityName: player.cityName });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// View other player's city
router.get('/visit/:userId', auth, async (req, res) => {
  try {
    var player = await GamePlayer.findOne({ userId: req.params.userId })
      .populate('userId', 'username profile');
    if (!player) return res.status(404).json({ error: 'Город не найден' });

    res.json({
      city: {
        owner: player.userId,
        cityName: player.cityName,
        level: player.level,
        buildings: player.buildings,
        unlockedZones: player.unlockedZones,
        stats: player.stats,
        totalPopulation: logic.calculateTotalPopulation(player.buildings)
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Leaderboard
router.get('/leaderboard', auth, async (req, res) => {
  try {
    var players = await GamePlayer.find()
      .populate('userId', 'username profile')
      .sort({ level: -1, experience: -1 })
      .limit(50)
      .select('userId level cityName stats buildings');

    var leaderboard = players.map(function(p) {
      return {
        userId: p.userId ? p.userId._id : null,
        username: p.userId ? p.userId.username : 'Unknown',
        profile: p.userId ? p.userId.profile : {},
        level: p.level,
        cityName: p.cityName,
        buildingCount: p.buildings.length,
        population: logic.calculateTotalPopulation(p.buildings)
      };
    }).filter(function(p) { return p.userId; });

    res.json({ leaderboard: leaderboard });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Helper functions
function getPlayerState(player) {
  var maxStorage = logic.calculateMaxStorage(player.buildings);
  var totalEnergy = logic.calculateTotalEnergy(player.buildings);
  var usedEnergy = logic.calculateUsedEnergy(player.buildings);
  var totalPopulation = logic.calculateTotalPopulation(player.buildings);
  var nextZones = logic.getNextZones(player.unlockedZones);
  var xpNeeded = config.LEVEL_XP(player.level + 1);

  return {
    level: player.level,
    experience: player.experience,
    xpNeeded: xpNeeded,
    resources: player.resources,
    buildings: player.buildings,
    unlockedZones: player.unlockedZones,
    activeQuests: player.activeQuests,
    completedQuests: player.completedQuests,
    stats: player.stats,
    cityName: player.cityName,
    maxStorage: maxStorage,
    totalEnergy: totalEnergy,
    usedEnergy: usedEnergy,
    totalPopulation: totalPopulation,
    nextZones: nextZones
  };
}

function updateQuestProgress(player, type, target, value) {
  for (var i = 0; i < player.activeQuests.length; i++) {
    var q = player.activeQuests[i];
    if (q.type === type) {
      if (q.type === 'build' && q.target === target) {
        q.progress += value;
      } else if (q.type === 'build_count') {
        q.progress += value;
      } else if (q.type === 'collect' && q.target === target) {
        q.progress += value;
      } else if (q.type === 'upgrade' && q.target === target) {
        q.progress = Math.max(q.progress, value);
      } else if (q.type === 'reach_population') {
        q.progress = logic.calculateTotalPopulation(player.buildings);
      } else if (q.type === 'unlock_zone') {
        q.progress = value;
      }
    }
  }
}

module.exports = router;