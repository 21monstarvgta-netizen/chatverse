var express = require('express');
var GamePlayer = require('../models/GamePlayer');
var auth = require('../middleware/auth');
var config = require('../game/gameConfig');
var logic = require('../game/gameLogic');

var router = express.Router();

function getPlayerState(player) {
  var buildings = player.buildings || [];
  var maxStorage = logic.calculateMaxStorage(buildings);
  var totalEnergy = logic.calculateTotalEnergy(buildings);
  var usedEnergy = logic.calculateUsedEnergy(buildings);
  var totalPopulation = logic.calculateTotalPopulation(buildings);
  var nextZones = logic.getNextZones(player.unlockedZones || []);
  var xpNeeded = config.LEVEL_XP(player.level + 1);

  return {
    level: player.level,
    experience: player.experience,
    xpNeeded: xpNeeded,
    resources: player.resources,
    buildings: buildings,
    unlockedZones: player.unlockedZones || [],
    activeQuests: player.activeQuests || [],
    completedQuests: player.completedQuests || [],
    stats: player.stats || {},
    cityName: player.cityName,
    maxStorage: maxStorage,
    totalEnergy: totalEnergy,
    usedEnergy: usedEnergy,
    totalPopulation: totalPopulation,
    nextZones: nextZones
  };
}

function updateQuestProgress(player, type, target, value) {
  if (!player.activeQuests) return;
  for (var i = 0; i < player.activeQuests.length; i++) {
    var q = player.activeQuests[i];
    if (q.type === type) {
      if (q.type === 'build' && q.target === target) {
        q.progress = (q.progress || 0) + value;
      } else if (q.type === 'build_count') {
        q.progress = (q.progress || 0) + value;
      } else if (q.type === 'collect' && q.target === target) {
        q.progress = (q.progress || 0) + value;
      } else if (q.type === 'upgrade' && q.target === target) {
        q.progress = Math.max(q.progress || 0, value);
      } else if (q.type === 'reach_population') {
        q.progress = logic.calculateTotalPopulation(player.buildings || []);
      } else if (q.type === 'unlock_zone') {
        q.progress = value;
      }
    }
  }
}

function checkLevelUp(player) {
  var xpNeeded = config.LEVEL_XP(player.level + 1);
  while (player.experience >= xpNeeded) {
    player.experience -= xpNeeded;
    player.level += 1;
    xpNeeded = config.LEVEL_XP(player.level + 1);
    var newQuests = logic.getQuestsForLevel(player.level, player.completedQuests || []);
    for (var i = 0; i < newQuests.length; i++) {
      var nq = newQuests[i];
      var exists = false;
      for (var j = 0; j < player.activeQuests.length; j++) {
        if (player.activeQuests[j].questId === nq.questId) { exists = true; break; }
      }
      if (!exists) player.activeQuests.push(nq);
    }
  }
}

// Get or create game state
router.get('/state', auth, async function(req, res) {
  try {
    var player = await GamePlayer.findOne({ userId: req.userId });
    if (!player) {
      var initialQuests = logic.getQuestsForLevel(1, []);
      player = new GamePlayer({
        userId: req.userId,
        activeQuests: initialQuests
      });
      await player.save();
    }

    var now = new Date();
    var result = logic.processOfflineProgress(player, player.buildings || [], now);
    player.resources = result.resources;
    player.lastOnline = now;
    await player.save();

    var state = getPlayerState(player);
    state.offlineCollected = result.collected;

    res.json({
      player: state,
      config: {
        gridSize: config.GRID_SIZE,
        initialUnlocked: config.INITIAL_UNLOCKED,
        buildingTypes: config.BUILDING_TYPES
      }
    });
  } catch (error) {
    console.error('Game state error:', error.message, error.stack);
    res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
  }
});

// Build
router.post('/build', auth, async function(req, res) {
  try {
    var buildingType = req.body.buildingType;
    var x = req.body.x;
    var y = req.body.y;
    var player = await GamePlayer.findOne({ userId: req.userId });
    if (!player) return res.status(404).json({ error: 'Игрок не найден' });

    var bt = config.BUILDING_TYPES[buildingType];
    if (!bt) return res.status(400).json({ error: 'Неизвестное здание' });

    if (player.level < bt.unlockLevel) {
      return res.status(400).json({ error: 'Требуется уровень ' + bt.unlockLevel });
    }

    if (!logic.isTileUnlocked(x, y, player.unlockedZones)) {
      return res.status(400).json({ error: 'Территория не открыта' });
    }

    var buildings = player.buildings || [];
    var occupied = false;
    for (var i = 0; i < buildings.length; i++) {
      if (buildings[i].x === x && buildings[i].y === y) { occupied = true; break; }
    }
    if (occupied) return res.status(400).json({ error: 'Клетка занята' });

    var totalEnergy = logic.calculateTotalEnergy(buildings);
    var usedEnergy = logic.calculateUsedEnergy(buildings);
    if (usedEnergy + bt.energyCost > totalEnergy && buildingType !== 'powerplant') {
      return res.status(400).json({ error: 'Недостаточно энергии' });
    }

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

    player.stats.totalBuilt += 1;
    player.experience += 10 + player.level * 2;

    checkLevelUp(player);
    updateQuestProgress(player, 'build', buildingType, 1);
    updateQuestProgress(player, 'build_count', 'any', 1);

    player.markModified('resources');
    player.markModified('buildings');
    player.markModified('activeQuests');
    player.markModified('stats');
    await player.save();

    res.json({ success: true, player: getPlayerState(player) });
  } catch (error) {
    console.error('Build error:', error.message, error.stack);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Collect from single building
router.post('/collect/:buildingIndex', auth, async function(req, res) {
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
    var elapsed = Math.floor((now.getTime() - new Date(building.lastCollected).getTime()) / 1000);
    var prodTime = logic.calculateProductionTime(building.type, building.level);

    if (elapsed < prodTime) {
      return res.status(400).json({ error: 'Ещё не готово', remaining: prodTime - elapsed });
    }

    var cycles = Math.min(Math.floor(elapsed / prodTime), 10);
    var output = logic.calculateOutput(building.type, building.level);
    var maxStorage = logic.calculateMaxStorage(player.buildings);
    var collected = {};

    var outputKeys = Object.keys(output);
    for (var i = 0; i < outputKeys.length; i++) {
      var r = outputKeys[i];
      collected[r] = output[r] * cycles;
    }

    logic.addResources(player.resources, collected, maxStorage);
    building.lastCollected = now;

    player.stats.totalCollected += 1;
    if (collected.coins) player.stats.totalCoinsEarned += collected.coins;
    player.experience += 5 + player.level;

    checkLevelUp(player);
    var collectedKeys = Object.keys(collected);
    for (var j = 0; j < collectedKeys.length; j++) {
      updateQuestProgress(player, 'collect', collectedKeys[j], collected[collectedKeys[j]]);
    }

    player.markModified('resources');
    player.markModified('buildings');
    player.markModified('activeQuests');
    player.markModified('stats');
    await player.save();

    res.json({ success: true, collected: collected, player: getPlayerState(player) });
  } catch (error) {
    console.error('Collect error:', error.message, error.stack);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Collect all
router.post('/collect-all', auth, async function(req, res) {
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

      var elapsed = Math.floor((now.getTime() - new Date(building.lastCollected).getTime()) / 1000);
      var prodTime = logic.calculateProductionTime(building.type, building.level);
      if (elapsed < prodTime) continue;

      var cycles = Math.min(Math.floor(elapsed / prodTime), 10);
      var output = logic.calculateOutput(building.type, building.level);

      var outputKeys = Object.keys(output);
      for (var j = 0; j < outputKeys.length; j++) {
        var r = outputKeys[j];
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

    checkLevelUp(player);

    var tcKeys = Object.keys(totalCollected);
    for (var k = 0; k < tcKeys.length; k++) {
      updateQuestProgress(player, 'collect', tcKeys[k], totalCollected[tcKeys[k]]);
    }

    player.markModified('resources');
    player.markModified('buildings');
    player.markModified('activeQuests');
    player.markModified('stats');
    await player.save();

    res.json({ success: true, collected: totalCollected, count: count, player: getPlayerState(player) });
  } catch (error) {
    console.error('Collect all error:', error.message, error.stack);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Upgrade
router.post('/upgrade/:buildingIndex', auth, async function(req, res) {
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

    checkLevelUp(player);
    updateQuestProgress(player, 'upgrade', building.type, building.level);

    player.markModified('resources');
    player.markModified('buildings');
    player.markModified('activeQuests');
    player.markModified('stats');
    await player.save();

    res.json({ success: true, player: getPlayerState(player) });
  } catch (error) {
    console.error('Upgrade error:', error.message, error.stack);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Demolish
router.post('/demolish/:buildingIndex', auth, async function(req, res) {
  try {
    var player = await GamePlayer.findOne({ userId: req.userId });
    if (!player) return res.status(404).json({ error: 'Игрок не найден' });

    var idx = parseInt(req.params.buildingIndex);
    if (idx < 0 || idx >= player.buildings.length) {
      return res.status(400).json({ error: 'Здание не найдено' });
    }

    var building = player.buildings[idx];
    var cost = logic.calculateBuildCost(building.type);
    var refund = {};
    var costKeys = Object.keys(cost);
    for (var i = 0; i < costKeys.length; i++) {
      var r = costKeys[i];
      refund[r] = Math.floor(cost[r] * 0.3);
    }
    logic.addResources(player.resources, refund, logic.calculateMaxStorage(player.buildings));

    player.buildings.splice(idx, 1);

    player.markModified('resources');
    player.markModified('buildings');
    await player.save();

    res.json({ success: true, refund: refund, player: getPlayerState(player) });
  } catch (error) {
    console.error('Demolish error:', error.message, error.stack);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Unlock zone
router.post('/unlock-zone', auth, async function(req, res) {
  try {
    var zone = req.body.zone;
    var player = await GamePlayer.findOne({ userId: req.userId });
    if (!player) return res.status(404).json({ error: 'Игрок не найден' });

    var nextZones = logic.getNextZones(player.unlockedZones || []);
    var target = null;
    for (var i = 0; i < nextZones.length; i++) {
      if (nextZones[i].direction === zone.direction) { target = nextZones[i]; break; }
    }
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
    checkLevelUp(player);

    player.markModified('resources');
    player.markModified('unlockedZones');
    player.markModified('stats');
    player.markModified('activeQuests');
    await player.save();

    res.json({ success: true, player: getPlayerState(player) });
  } catch (error) {
    console.error('Unlock zone error:', error.message, error.stack);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Claim quest
router.post('/quest/claim/:questId', auth, async function(req, res) {
  try {
    var player = await GamePlayer.findOne({ userId: req.userId });
    if (!player) return res.status(404).json({ error: 'Игрок не найден' });

    var questId = parseInt(req.params.questId);
    var questIdx = -1;
    for (var i = 0; i < player.activeQuests.length; i++) {
      if (player.activeQuests[i].questId === questId) { questIdx = i; break; }
    }
    if (questIdx === -1) return res.status(400).json({ error: 'Квест не найден' });

    var quest = player.activeQuests[questIdx];
    if ((quest.progress || 0) < quest.count) {
      return res.status(400).json({ error: 'Квест не выполнен' });
    }

    var maxStorage = logic.calculateMaxStorage(player.buildings);
    logic.addResources(player.resources, quest.reward, maxStorage);

    player.completedQuests.push(questId);
    player.activeQuests.splice(questIdx, 1);

    var newQuests = logic.getQuestsForLevel(player.level, player.completedQuests);
    for (var j = 0; j < newQuests.length; j++) {
      var nq = newQuests[j];
      var exists = false;
      for (var k = 0; k < player.activeQuests.length; k++) {
        if (player.activeQuests[k].questId === nq.questId) { exists = true; break; }
      }
      var alreadyDone = player.completedQuests.indexOf(nq.questId) >= 0;
      if (!exists && !alreadyDone) player.activeQuests.push(nq);
    }

    if (player.activeQuests.length > 5) {
      player.activeQuests = player.activeQuests.slice(0, 5);
    }

    player.experience += 20 + player.level * 5;
    checkLevelUp(player);

    player.markModified('resources');
    player.markModified('activeQuests');
    player.markModified('completedQuests');
    await player.save();

    res.json({ success: true, reward: quest.reward, player: getPlayerState(player) });
  } catch (error) {
    console.error('Quest claim error:', error.message, error.stack);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Rename city
router.post('/rename', auth, async function(req, res) {
  try {
    var name = req.body.name;
    if (!name || name.trim().length < 1 || name.trim().length > 30) {
      return res.status(400).json({ error: 'Название от 1 до 30 символов' });
    }
    var player = await GamePlayer.findOne({ userId: req.userId });
    if (!player) return res.status(404).json({ error: 'Игрок не найден' });

    player.cityName = name.trim();
    await player.save();

    res.json({ success: true, cityName: player.cityName });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Visit another player's city
router.get('/visit/:userId', auth, async function(req, res) {
  try {
    var player = await GamePlayer.findOne({ userId: req.params.userId })
      .populate('userId', 'username profile');
    if (!player) return res.status(404).json({ error: 'Город не найден' });

    res.json({
      city: {
        owner: player.userId,
        cityName: player.cityName,
        level: player.level,
        buildings: player.buildings || [],
        unlockedZones: player.unlockedZones || [],
        stats: player.stats || {},
        totalPopulation: logic.calculateTotalPopulation(player.buildings || [])
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Leaderboard
router.get('/leaderboard', auth, async function(req, res) {
  try {
    var players = await GamePlayer.find()
      .populate('userId', 'username profile')
      .sort({ level: -1, experience: -1 })
      .limit(50)
      .select('userId level cityName stats buildings');

    var leaderboard = [];
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (!p.userId) continue;
      leaderboard.push({
        userId: p.userId._id,
        username: p.userId.username,
        profile: p.userId.profile || {},
        level: p.level,
        cityName: p.cityName,
        buildingCount: (p.buildings || []).length,
        population: logic.calculateTotalPopulation(p.buildings || [])
      });
    }

    res.json({ leaderboard: leaderboard });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

module.exports = router;