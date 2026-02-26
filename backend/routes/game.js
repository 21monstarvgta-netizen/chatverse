var express = require('express');
var mongoose = require('mongoose');
var GamePlayer = require('../models/GamePlayer');
var auth = require('../middleware/auth');
var config = require('../game/gameConfig');
var logic = require('../game/gameLogic');
var threats = require('../game/threats');

var router = express.Router();

function getPlayerState(player) {
  var buildings = player.buildings || [];
  return {
    level: player.level,
    experience: player.experience,
    xpNeeded: config.LEVEL_XP(player.level + 1),
    resources: player.resources,
    buildings: buildings,
    unlockedZones: player.unlockedZones || [],
    activeQuests: player.activeQuests || [],
    completedQuests: player.completedQuests || [],
    stats: player.stats || {},
    cityName: player.cityName,
    maxStorage: logic.calculateMaxStorage(buildings),
    totalEnergy: logic.calculateTotalEnergy(buildings),
    usedEnergy: logic.calculateUsedEnergy(buildings),
    totalPopulation: logic.calculateTotalPopulation(buildings),
    nextZones: logic.getNextZones(player.unlockedZones || []),
    activeThreats: (player.activeThreats || []).map(function(t) {
      return { id: t.id, type: t.type, name: t.name, emoji: t.emoji, hp: t.hp, maxHp: t.maxHp, x: t.x, y: t.y };
    })
  };
}

function updateQuestProgress(player, type, target, value) {
  if (!player.activeQuests) return;
  for (var i = 0; i < player.activeQuests.length; i++) {
    var q = player.activeQuests[i];
    if (q.type === 'build' && type === 'build' && q.target === target) {
      q.progress = (q.progress || 0) + value;
    } else if (q.type === 'build_count' && type === 'build') {
      q.progress = (q.progress || 0) + value;
    } else if (q.type === 'collect' && type === 'collect' && q.target === target) {
      q.progress = (q.progress || 0) + value;
    } else if (q.type === 'upgrade' && type === 'upgrade' && q.target === target) {
      q.progress = Math.max(q.progress || 0, value);
    } else if (q.type === 'reach_population' && type === 'population_check') {
      q.progress = logic.calculateTotalPopulation(player.buildings || []);
    } else if (q.type === 'unlock_zone' && type === 'unlock_zone') {
      q.progress = value;
    } else if (q.type === 'spend' && type === 'spend' && q.target === target) {
      q.progress = (q.progress || 0) + value;
    }
  }
}

function checkLevelUp(player) {
  var xpNeeded = config.LEVEL_XP(player.level + 1);
  var leveled = false;
  while (player.experience >= xpNeeded) {
    player.experience -= xpNeeded;
    player.level += 1;
    xpNeeded = config.LEVEL_XP(player.level + 1);
    leveled = true;
  }
  if (leveled) {
    // Add new story quests
    var storyQuests = logic.getQuestsForLevel(player.level, player.completedQuests || []);
    for (var i = 0; i < storyQuests.length; i++) {
      var sq = storyQuests[i];
      var exists = false;
      for (var j = 0; j < player.activeQuests.length; j++) {
        if (player.activeQuests[j].questId === sq.questId) { exists = true; break; }
      }
      if (!exists && (player.completedQuests || []).indexOf(sq.questId) === -1) {
        player.activeQuests.push(sq);
      }
    }
  }
  // Fill with random quests to always have 8
  logic.fillQuestsWithRandom(player.activeQuests, player.level, player.completedQuests, 8);
}

function trackSpending(player, cost) {
  var keys = Object.keys(cost);
  for (var i = 0; i < keys.length; i++) {
    updateQuestProgress(player, 'spend', keys[i], cost[keys[i]]);
  }
}

async function getOrCreatePlayer(userId) {
  var player = await GamePlayer.findOne({ userId: userId });
  if (!player) {
    var initialQuests = logic.getQuestsForLevel(1, []);
    player = new GamePlayer({ userId: userId, activeQuests: initialQuests });
    logic.fillQuestsWithRandom(player.activeQuests, 1, [], 8);
    await player.save();
  }
  return player;
}


// ── One-time coordinate migration (GRID_SIZE 25→40, offset +8) ──────────────
// Runs once on startup; skips players already migrated.
(async function runCoordMigration() {
  try {
    var players = await GamePlayer.find({});
    var migrated = 0;
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      // Skip if already migrated (buildings in new range 15-39)
      // A building at x>=12 with old grid would be at the edge; 
      // safe heuristic: if any building is at x<12 or y<12, needs migration.
      var needsMigration = false;
      if (p.buildings && p.buildings.length > 0) {
        for (var j = 0; j < p.buildings.length; j++) {
          if (p.buildings[j].x < 12 || p.buildings[j].y < 12) { needsMigration = true; break; }
        }
      } else if (p.unlockedZones && p.unlockedZones.length > 0) {
        if (p.unlockedZones[0].x1 < 12) needsMigration = true;
      }
      if (!needsMigration) continue;

      var OFFSET = 8;
      // Shift buildings
      for (var b = 0; b < (p.buildings || []).length; b++) {
        p.buildings[b].x += OFFSET;
        p.buildings[b].y += OFFSET;
      }
      // Shift unlocked zones
      for (var z = 0; z < (p.unlockedZones || []).length; z++) {
        p.unlockedZones[z].x1 += OFFSET; p.unlockedZones[z].y1 += OFFSET;
        p.unlockedZones[z].x2 += OFFSET; p.unlockedZones[z].y2 += OFFSET;
      }
      p.markModified('buildings');
      p.markModified('unlockedZones');
      await p.save();
      migrated++;
    }
    if (migrated > 0) console.log('[Migration] Shifted coords for', migrated, 'players (+8 offset)');
  } catch(e) { console.error('[Migration] Error:', e.message); }
})();

// Fix duplicate key: drop null entries on startup
(async function() {
  try {
    await GamePlayer.deleteMany({ userId: null });
    // Try to drop old index if it exists
    try {
      await GamePlayer.collection.dropIndex('user_1');
    } catch(e) {}
    try {
      await GamePlayer.collection.dropIndex('userId_1');
    } catch(e) {}
  } catch(e) {}
})();

// Get game state
router.get('/state', auth, async function(req, res) {
  try {
    var player = await getOrCreatePlayer(req.userId);

    var now = new Date();
    var result = logic.processOfflineProgress(player, player.buildings || [], now);
    player.resources = result.resources;
    player.lastOnline = now;

    // Ensure quests are filled
    logic.fillQuestsWithRandom(player.activeQuests, player.level, player.completedQuests, 8);
    // Update population quests
    updateQuestProgress(player, 'population_check', null, 0);

    player.markModified('resources');
    player.markModified('activeQuests');
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
    var player = await getOrCreatePlayer(req.userId);

    var bt = config.BUILDING_TYPES[buildingType];
    if (!bt) return res.status(400).json({ error: 'Неизвестное здание' });
    if (player.level < bt.unlockLevel) return res.status(400).json({ error: 'Требуется уровень ' + bt.unlockLevel });
    if (!logic.isTileUnlocked(x, y, player.unlockedZones)) return res.status(400).json({ error: 'Территория не открыта' });

    var occupied = false;
    for (var i = 0; i < player.buildings.length; i++) {
      if (player.buildings[i].x === x && player.buildings[i].y === y) { occupied = true; break; }
    }
    if (occupied) return res.status(400).json({ error: 'Клетка занята' });

    var totalEnergy = logic.calculateTotalEnergy(player.buildings);
    var usedEnergy = logic.calculateUsedEnergy(player.buildings);
    if (usedEnergy + bt.energyCost > totalEnergy && buildingType !== 'powerplant') {
      return res.status(400).json({ error: 'Недостаточно энергии. Построй электростанцию!' });
    }

    var cost = logic.calculateBuildCost(buildingType);
    if (!logic.canAfford(player.resources, cost)) return res.status(400).json({ error: 'Недостаточно ресурсов' });

    logic.subtractResources(player.resources, cost);
    trackSpending(player, cost);

    player.buildings.push({ type: buildingType, level: 1, x: x, y: y, lastCollected: new Date(), isProducing: true });

    player.stats.totalBuilt += 1;
    player.experience += 10 + player.level * 2;

    updateQuestProgress(player, 'build', buildingType, 1);
    updateQuestProgress(player, 'population_check', null, 0);
    checkLevelUp(player);

    player.markModified('resources');
    player.markModified('buildings');
    player.markModified('activeQuests');
    player.markModified('stats');
    await player.save();

    res.json({ success: true, player: getPlayerState(player) });
  } catch (error) {
    console.error('Build error:', error.message);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Collect single
router.post('/collect/:buildingIndex', auth, async function(req, res) {
  try {
    var player = await getOrCreatePlayer(req.userId);
    var idx = parseInt(req.params.buildingIndex);
    if (idx < 0 || idx >= player.buildings.length) return res.status(400).json({ error: 'Здание не найдено' });

    var building = player.buildings[idx];
    var bt = config.BUILDING_TYPES[building.type];
    if (!bt || bt.baseTime === 0) return res.status(400).json({ error: 'Нельзя собрать' });

    var now = new Date();
    var elapsed = Math.floor((now.getTime() - new Date(building.lastCollected).getTime()) / 1000);
    var prodTime = logic.calculateProductionTime(building.type, building.level);
    if (elapsed < prodTime) return res.status(400).json({ error: 'Ещё не готово', remaining: prodTime - elapsed });

    var cycles = Math.min(Math.floor(elapsed / prodTime), 10);
    var output = logic.calculateOutput(building.type, building.level);
    var maxStorage = logic.calculateMaxStorage(player.buildings);
    var collected = {};
    var outKeys = Object.keys(output);
    for (var i = 0; i < outKeys.length; i++) { collected[outKeys[i]] = output[outKeys[i]] * cycles; }

    logic.addResources(player.resources, collected, maxStorage);
    building.lastCollected = now;

    player.stats.totalCollected += 1;
    if (collected.coins) player.stats.totalCoinsEarned += collected.coins;
    if (collected.food) player.stats.totalFoodEarned += collected.food;
    if (collected.materials) player.stats.totalMaterialsEarned += collected.materials;
    player.experience += 5 + player.level;

    for (var j = 0; j < outKeys.length; j++) { updateQuestProgress(player, 'collect', outKeys[j], collected[outKeys[j]]); }
    updateQuestProgress(player, 'population_check', null, 0);
    checkLevelUp(player);

    player.markModified('resources');
    player.markModified('buildings');
    player.markModified('activeQuests');
    player.markModified('stats');
    await player.save();

    res.json({ success: true, collected: collected, player: getPlayerState(player) });
  } catch (error) {
    console.error('Collect error:', error.message);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Collect all
router.post('/collect-all', auth, async function(req, res) {
  try {
    var player = await getOrCreatePlayer(req.userId);
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
      var outKeys = Object.keys(output);
      for (var j = 0; j < outKeys.length; j++) {
        totalCollected[outKeys[j]] = (totalCollected[outKeys[j]] || 0) + output[outKeys[j]] * cycles;
      }
      building.lastCollected = now;
      count++;
    }

    if (count === 0) return res.json({ success: true, collected: {}, count: 0, player: getPlayerState(player) });

    logic.addResources(player.resources, totalCollected, maxStorage);
    player.stats.totalCollected += count;
    if (totalCollected.coins) player.stats.totalCoinsEarned += totalCollected.coins;
    if (totalCollected.food) player.stats.totalFoodEarned += totalCollected.food;
    if (totalCollected.materials) player.stats.totalMaterialsEarned += totalCollected.materials;
    player.experience += (5 + player.level) * count;

    var tcKeys = Object.keys(totalCollected);
    for (var k = 0; k < tcKeys.length; k++) { updateQuestProgress(player, 'collect', tcKeys[k], totalCollected[tcKeys[k]]); }
    updateQuestProgress(player, 'population_check', null, 0);
    checkLevelUp(player);

    player.markModified('resources');
    player.markModified('buildings');
    player.markModified('activeQuests');
    player.markModified('stats');
    await player.save();

    res.json({ success: true, collected: totalCollected, count: count, player: getPlayerState(player) });
  } catch (error) {
    console.error('Collect all error:', error.message);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Upgrade
router.post('/upgrade/:buildingIndex', auth, async function(req, res) {
  try {
    var player = await getOrCreatePlayer(req.userId);
    var idx = parseInt(req.params.buildingIndex);
    if (idx < 0 || idx >= player.buildings.length) return res.status(400).json({ error: 'Здание не найдено' });

    var building = player.buildings[idx];
    var bt = config.BUILDING_TYPES[building.type];
    if (!bt) return res.status(400).json({ error: 'Ошибка' });
    if (building.level >= bt.maxLevel) return res.status(400).json({ error: 'Максимальный уровень' });

    var cost = logic.calculateUpgradeCost(building.type, building.level);
    if (!logic.canAfford(player.resources, cost)) return res.status(400).json({ error: 'Недостаточно ресурсов' });

    logic.subtractResources(player.resources, cost);
    trackSpending(player, cost);
    building.level += 1;

    player.stats.totalUpgrades += 1;
    player.experience += 15 + player.level * 3;

    updateQuestProgress(player, 'upgrade', building.type, building.level);
    updateQuestProgress(player, 'population_check', null, 0);
    checkLevelUp(player);

    player.markModified('resources');
    player.markModified('buildings');
    player.markModified('activeQuests');
    player.markModified('stats');
    await player.save();

    res.json({ success: true, player: getPlayerState(player) });
  } catch (error) {
    console.error('Upgrade error:', error.message);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Demolish
router.post('/demolish/:buildingIndex', auth, async function(req, res) {
  try {
    var player = await getOrCreatePlayer(req.userId);
    var idx = parseInt(req.params.buildingIndex);
    if (idx < 0 || idx >= player.buildings.length) return res.status(400).json({ error: 'Здание не найдено' });

    var cost = logic.calculateBuildCost(player.buildings[idx].type);
    var refund = {};
    var costKeys = Object.keys(cost);
    for (var i = 0; i < costKeys.length; i++) { refund[costKeys[i]] = Math.floor(cost[costKeys[i]] * 0.3); }
    logic.addResources(player.resources, refund, logic.calculateMaxStorage(player.buildings));
    player.buildings.splice(idx, 1);

    player.markModified('resources');
    player.markModified('buildings');
    await player.save();

    res.json({ success: true, refund: refund, player: getPlayerState(player) });
  } catch (error) {
    console.error('Demolish error:', error.message);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Unlock zone
router.post('/unlock-zone', auth, async function(req, res) {
  try {
    var zone = req.body.zone;
    var player = await getOrCreatePlayer(req.userId);
    var nextZones = logic.getNextZones(player.unlockedZones || []);
    var target = null;
    for (var i = 0; i < nextZones.length; i++) {
      if (nextZones[i].direction === zone.direction) { target = nextZones[i]; break; }
    }
    if (!target) return res.status(400).json({ error: 'Зона недоступна' });
    if ((player.resources.coins || 0) < target.cost) return res.status(400).json({ error: 'Недостаточно монет' });

    player.resources.coins -= target.cost;
    updateQuestProgress(player, 'spend', 'coins', target.cost);
    player.unlockedZones.push({ x1: target.x1, y1: target.y1, x2: target.x2, y2: target.y2, direction: target.direction });
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
    console.error('Unlock zone error:', error.message);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Claim quest
router.post('/quest/claim/:questId', auth, async function(req, res) {
  try {
    var player = await getOrCreatePlayer(req.userId);
    var questId = req.params.questId;
    var questIdx = -1;
    for (var i = 0; i < player.activeQuests.length; i++) {
      if (player.activeQuests[i].questId === questId) { questIdx = i; break; }
    }
    if (questIdx === -1) return res.status(400).json({ error: 'Квест не найден' });

    var quest = player.activeQuests[questIdx];
    if ((quest.progress || 0) < quest.count) return res.status(400).json({ error: 'Квест не выполнен' });

    var reward = quest.reward || {};
    var maxStorage = logic.calculateMaxStorage(player.buildings);
    logic.addResources(player.resources, reward, maxStorage);

    player.completedQuests.push(questId);
    player.activeQuests.splice(questIdx, 1);

    player.experience += 20 + player.level * 5;

    // Add new story quests
    var storyQuests = logic.getQuestsForLevel(player.level, player.completedQuests);
    for (var j = 0; j < storyQuests.length; j++) {
      var sq = storyQuests[j];
      var exists = false;
      for (var k = 0; k < player.activeQuests.length; k++) {
        if (player.activeQuests[k].questId === sq.questId) { exists = true; break; }
      }
      if (!exists && player.completedQuests.indexOf(sq.questId) === -1) {
        player.activeQuests.push(sq);
      }
    }

    // Fill with random
    logic.fillQuestsWithRandom(player.activeQuests, player.level, player.completedQuests, 8);
    checkLevelUp(player);

    player.markModified('resources');
    player.markModified('activeQuests');
    player.markModified('completedQuests');
    await player.save();

    res.json({ success: true, reward: reward, player: getPlayerState(player) });
  } catch (error) {
    console.error('Quest claim error:', error.message);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Reset progress
router.post('/reset', auth, async function(req, res) {
  try {
    await GamePlayer.deleteOne({ userId: req.userId });
    var initialQuests = logic.getQuestsForLevel(1, []);
    var player = new GamePlayer({ userId: req.userId, activeQuests: initialQuests });
    logic.fillQuestsWithRandom(player.activeQuests, 1, [], 8);
    await player.save();

    res.json({ success: true, player: getPlayerState(player) });
  } catch (error) {
    console.error('Reset error:', error.message);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Move building
router.post('/move', auth, async function(req, res) {
  try {
    var idx = parseInt(req.body.buildingIndex);
    var x = req.body.x;
    var y = req.body.y;
    var player = await getOrCreatePlayer(req.userId);

    if (idx < 0 || idx >= player.buildings.length) return res.status(400).json({ error: 'Здание не найдено' });
    if (!logic.isTileUnlocked(x, y, player.unlockedZones)) return res.status(400).json({ error: 'Территория не открыта' });

    for (var i = 0; i < player.buildings.length; i++) {
      if (i !== idx && player.buildings[i].x === x && player.buildings[i].y === y) {
        return res.status(400).json({ error: 'Клетка занята' });
      }
    }

    player.buildings[idx].x = x;
    player.buildings[idx].y = y;

    player.markModified('buildings');
    await player.save();

    res.json({ success: true, player: getPlayerState(player) });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Crystal exchange (1 crystal = 100 of any resource)
router.post('/crystal-exchange', auth, async function(req, res) {
  try {
    var crystals = parseInt(req.body.crystals);
    var resource = req.body.resource;
    var allowed = ['coins', 'food', 'materials'];
    if (!crystals || crystals <= 0) return res.status(400).json({ error: 'Неверное количество' });
    if (allowed.indexOf(resource) === -1) return res.status(400).json({ error: 'Неверный ресурс' });

    var player = await getOrCreatePlayer(req.userId);
    if ((player.resources.crystals || 0) < crystals) return res.status(400).json({ error: 'Недостаточно кристаллов' });

    var amount = crystals * 100;
    player.resources.crystals -= crystals;
    var maxStorage = logic.calculateMaxStorage(player.buildings);
    var reward = {};
    reward[resource] = amount;
    logic.addResources(player.resources, reward, maxStorage);

    player.markModified('resources');
    await player.save();

    res.json({ success: true, received: amount, resource: resource, player: getPlayerState(player) });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});


// ===== THREATS =====

// Spawn a threat (called periodically by frontend or can be triggered manually)
router.post('/threat/spawn', auth, async function(req, res) {
  try {
    var player = await getOrCreatePlayer(req.userId);
    if (!player.activeThreats) player.activeThreats = [];

    // Max 3 threats at a time
    if (player.activeThreats.length >= 3) {
      return res.json({ success: false, message: 'Слишком много угроз уже', player: getPlayerState(player) });
    }

    var threatType = threats.rollThreatType(player.level);
    var tt = threats.THREAT_TYPES[threatType];

    // Pick a tile near the edge of unlocked area
    var buildings = player.buildings || [];
    var zones = player.unlockedZones || [];
    var gs = config.GRID_SIZE;
    var half = Math.floor(config.INITIAL_UNLOCKED / 2);
    var center = Math.floor(gs / 2);
    // spawn near random edge of initial area
    var edge = Math.floor(Math.random() * 4);
    var sx, sy;
    if (edge === 0) { sx = center - half + Math.floor(Math.random()*2); sy = center + Math.floor(Math.random()*config.INITIAL_UNLOCKED) - half; }
    else if (edge === 1) { sx = center + half - Math.floor(Math.random()*2) - 1; sy = center + Math.floor(Math.random()*config.INITIAL_UNLOCKED) - half; }
    else if (edge === 2) { sy = center - half + Math.floor(Math.random()*2); sx = center + Math.floor(Math.random()*config.INITIAL_UNLOCKED) - half; }
    else { sy = center + half - Math.floor(Math.random()*2) - 1; sx = center + Math.floor(Math.random()*config.INITIAL_UNLOCKED) - half; }

    var threat = {
      id: 't_' + Date.now() + '_' + Math.floor(Math.random()*10000),
      type: threatType,
      name: tt.name,
      emoji: tt.emoji,
      hp: tt.hp,
      maxHp: tt.hp,
      x: sx,
      y: sy,
      spawnedAt: new Date()
    };

    player.activeThreats.push(threat);
    player.markModified('activeThreats');
    await player.save();

    res.json({ success: true, threat: threat, player: getPlayerState(player) });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Attack a threat
router.post('/threat/attack/:threatId', auth, async function(req, res) {
  try {
    var player = await getOrCreatePlayer(req.userId);
    var threatId = req.params.threatId;
    var damage = parseInt(req.body.damage) || 1;
    if (damage > 3) damage = 3; // max damage per click

    if (!player.activeThreats) player.activeThreats = [];
    var idx = -1;
    for (var i = 0; i < player.activeThreats.length; i++) {
      if (player.activeThreats[i].id === threatId) { idx = i; break; }
    }
    if (idx === -1) return res.status(404).json({ error: 'Угроза не найдена' });

    var threat = player.activeThreats[idx];
    threat.hp = Math.max(0, threat.hp - damage);

    var killed = threat.hp <= 0;
    if (killed) {
      // Give reward
      var tt = threats.THREAT_TYPES[threat.type];
      var reward = tt ? tt.reward : { coins: 50 };
      var maxStorage = logic.calculateMaxStorage(player.buildings);
      logic.addResources(player.resources, reward, maxStorage);
      player.activeThreats.splice(idx, 1);
      player.experience += 25 + player.level * 3;
      checkLevelUp(player);

      player.markModified('resources');
      player.markModified('activeQuests');
    } else {
      player.activeThreats[idx] = threat;
    }

    player.markModified('activeThreats');
    await player.save();

    res.json({ success: true, killed: killed, reward: killed ? threats.THREAT_TYPES[threat.type].reward : null, player: getPlayerState(player) });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Threat attacks resources (called when timer runs out — frontend triggers this)
router.post('/threat/damage/:threatId', auth, async function(req, res) {
  try {
    var player = await getOrCreatePlayer(req.userId);
    var threatId = req.params.threatId;

    if (!player.activeThreats) player.activeThreats = [];
    var idx = -1;
    for (var i = 0; i < player.activeThreats.length; i++) {
      if (player.activeThreats[i].id === threatId) { idx = i; break; }
    }
    if (idx === -1) return res.json({ success: false, player: getPlayerState(player) });

    var threat = player.activeThreats[idx];
    var tt = threats.THREAT_TYPES[threat.type];
    var damage = tt ? tt.damage : {};

    // Apply damage to resources
    var keys = Object.keys(damage);
    for (var k = 0; k < keys.length; k++) {
      var resKey = keys[k];
      if (resKey === 'population_fear') continue; // cosmetic only for now
      if (player.resources[resKey] !== undefined) {
        player.resources[resKey] = Math.max(0, (player.resources[resKey] || 0) - damage[resKey]);
      }
    }

    // Threat leaves after attacking
    player.activeThreats.splice(idx, 1);

    player.markModified('activeThreats');
    player.markModified('resources');
    await player.save();

    res.json({ success: true, damage: damage, player: getPlayerState(player) });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Rename
router.post('/rename', auth, async function(req, res) {
  try {
    var name = req.body.name;
    if (!name || name.trim().length < 1 || name.trim().length > 30) return res.status(400).json({ error: 'Название от 1 до 30 символов' });
    var player = await getOrCreatePlayer(req.userId);
    player.cityName = name.trim();
    await player.save();
    res.json({ success: true, cityName: player.cityName });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Visit
router.get('/visit/:userId', auth, async function(req, res) {
  try {
    var player = await GamePlayer.findOne({ userId: req.params.userId }).populate('userId', 'username profile');
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
    var players = await GamePlayer.find({ userId: { $ne: null } })
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

// ── Admin: edit player currency (ONLY for @YasheNJO) ──────────────────────
router.post('/admin/set-currency', auth, async function(req, res) {
  try {
    // Restrict to the single hardcoded admin account
    if (!req.user || req.user.username !== 'YasheNJO') {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    var targetUsername = req.body.username;
    var currency       = req.body.currency; // 'coins'|'food'|'materials'|'energy'|'crystals'
    var amount         = parseInt(req.body.amount);

    if (!targetUsername) return res.status(400).json({ error: 'Укажите имя пользователя' });
    if (!['coins','food','materials','energy','crystals'].includes(currency))
      return res.status(400).json({ error: 'Неверный тип валюты' });
    if (isNaN(amount) || amount < 0)
      return res.status(400).json({ error: 'Неверное количество' });

    var User = require('../models/User');
    var targetUser = await User.findOne({ username: targetUsername });
    if (!targetUser) return res.status(404).json({ error: 'Игрок не найден: ' + targetUsername });

    var player = await GamePlayer.findOne({ userId: targetUser._id });
    if (!player) return res.status(404).json({ error: 'Игровой профиль не найден' });

    player.resources[currency] = amount;
    player.markModified('resources');
    await player.save();

    res.json({
      success: true,
      message: 'Валюта обновлена: ' + targetUsername + ' → ' + currency + ' = ' + amount
    });
  } catch (error) {
    console.error('Admin set-currency error:', error.message);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

module.exports = router;