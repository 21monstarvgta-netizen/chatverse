var config = require('./gameConfig');

function calculateOutput(buildingType, level) {
  var bt = config.BUILDING_TYPES[buildingType];
  if (!bt) return {};
  var result = {};
  var keys = Object.keys(bt.baseOutput);
  for (var i = 0; i < keys.length; i++) {
    result[keys[i]] = config.INCOME_FORMULA(bt.baseOutput[keys[i]], level);
  }
  return result;
}

function calculateUpgradeCost(buildingType, currentLevel) {
  var bt = config.BUILDING_TYPES[buildingType];
  if (!bt) return {};
  var result = {};
  var keys = Object.keys(bt.baseCost);
  for (var i = 0; i < keys.length; i++) {
    result[keys[i]] = config.UPGRADE_COST_FORMULA(bt.baseCost[keys[i]], currentLevel);
  }
  return result;
}

function calculateBuildCost(buildingType) {
  var bt = config.BUILDING_TYPES[buildingType];
  if (!bt) return {};
  var result = {};
  var keys = Object.keys(bt.baseCost);
  for (var i = 0; i < keys.length; i++) {
    result[keys[i]] = bt.baseCost[keys[i]];
  }
  return result;
}

function calculateProductionTime(buildingType, level) {
  var bt = config.BUILDING_TYPES[buildingType];
  if (!bt || bt.baseTime === 0) return 0;
  return config.PRODUCTION_TIME_FORMULA(bt.baseTime, level);
}

function canAfford(resources, cost) {
  var keys = Object.keys(cost);
  for (var i = 0; i < keys.length; i++) {
    if ((resources[keys[i]] || 0) < cost[keys[i]]) return false;
  }
  return true;
}

function subtractResources(resources, cost) {
  var keys = Object.keys(cost);
  for (var i = 0; i < keys.length; i++) {
    resources[keys[i]] = (resources[keys[i]] || 0) - cost[keys[i]];
  }
  return resources;
}

function addResources(resources, reward, maxStorage) {
  maxStorage = maxStorage || 1000000000;
  var keys = Object.keys(reward);
  for (var i = 0; i < keys.length; i++) {
    var res = keys[i];
    if (res === 'energy' || res === 'population' || res === 'experience' || res === 'crystals') {
      resources[res] = (resources[res] || 0) + reward[res];
    } else {
      resources[res] = Math.min((resources[res] || 0) + reward[res], maxStorage);
    }
  }
  return resources;
}

function isTileUnlocked(x, y, unlockedZones) {
  var centerX = Math.floor(config.GRID_SIZE / 2);
  var centerY = Math.floor(config.GRID_SIZE / 2);
  var halfInit = Math.floor(config.INITIAL_UNLOCKED / 2);
  if (x >= centerX - halfInit && x < centerX + halfInit &&
      y >= centerY - halfInit && y < centerY + halfInit) {
    return true;
  }
  if (unlockedZones) {
    for (var i = 0; i < unlockedZones.length; i++) {
      var zone = unlockedZones[i];
      if (x >= zone.x1 && x <= zone.x2 && y >= zone.y1 && y <= zone.y2) return true;
    }
  }
  return false;
}

function getNextZones(unlockedZones) {
  unlockedZones = unlockedZones || [];
  var centerX = Math.floor(config.GRID_SIZE / 2);
  var centerY = Math.floor(config.GRID_SIZE / 2);
  var halfInit = Math.floor(config.INITIAL_UNLOCKED / 2);
  var zoneNum = unlockedZones.length + 1;

  // Build the bounding rectangle of ALL currently unlocked territory
  // (initial zone + all purchased zones)
  var expandedX1 = centerX - halfInit;
  var expandedY1 = centerY - halfInit;
  var expandedX2 = centerX + halfInit - 1;
  var expandedY2 = centerY + halfInit - 1;

  for (var i = 0; i < unlockedZones.length; i++) {
    expandedX1 = Math.min(expandedX1, unlockedZones[i].x1);
    expandedY1 = Math.min(expandedY1, unlockedZones[i].y1);
    expandedX2 = Math.max(expandedX2, unlockedZones[i].x2);
    expandedY2 = Math.max(expandedY2, unlockedZones[i].y2);
  }

  var size = 2;
  var candidates = [];
  var gs = config.GRID_SIZE;

  // Zones expand as STRIPS that share a full edge with current territory.
  // This ensures every new zone is visually connected (no dark-tile gaps) in iso view.
  //
  // In iso projection:
  //   screen-up-left  = x decreases  → North strip: x in [x1-size..x1-1], y in [y1..y2]
  //   screen-down-right = x increases → South strip: x in [x2+1..x2+size], y in [y1..y2]
  //   screen-up-right = y decreases   → East  strip: y in [y1-size..y1-1], x in [x1..x2]
  //   screen-down-left = y increases  → West  strip: y in [y2+1..y2+size], x in [x1..x2]

  // North (upper-left on screen): full-height strip to the left
  if (expandedX1 - size >= 0)
    candidates.push({ x1: expandedX1 - size, y1: expandedY1, x2: expandedX1 - 1, y2: expandedY2, direction: 'north' });
  // South (lower-right on screen): full-height strip to the right
  if (expandedX2 + size < gs)
    candidates.push({ x1: expandedX2 + 1, y1: expandedY1, x2: expandedX2 + size, y2: expandedY2, direction: 'south' });
  // East (upper-right on screen): full-width strip above
  if (expandedY1 - size >= 0)
    candidates.push({ x1: expandedX1, y1: expandedY1 - size, x2: expandedX2, y2: expandedY1 - 1, direction: 'east' });
  // West (lower-left on screen): full-width strip below
  if (expandedY2 + size < gs)
    candidates.push({ x1: expandedX1, y1: expandedY2 + 1, x2: expandedX2, y2: expandedY2 + size, direction: 'west' });

  candidates = candidates.filter(function(c) {
    for (var j = 0; j < unlockedZones.length; j++) {
      if (c.x1 === unlockedZones[j].x1 && c.y1 === unlockedZones[j].y1 &&
          c.x2 === unlockedZones[j].x2 && c.y2 === unlockedZones[j].y2) return false;
    }
    return true;
  });

  return candidates.map(function(c, idx) {
    c.cost = config.ZONE_UNLOCK_COST(zoneNum + idx);
    c.zoneNumber = zoneNum + idx;
    return c;
  });
}

function calculateTotalEnergy(buildings) {
  var total = config.RESOURCE_DEFAULTS.energy;
  if (!buildings) return total;
  for (var i = 0; i < buildings.length; i++) {
    if (buildings[i].type === 'powerplant') {
      var bt = config.BUILDING_TYPES.powerplant;
      if (bt && bt.baseOutput && bt.baseOutput.energy)
        total += config.INCOME_FORMULA(bt.baseOutput.energy, buildings[i].level);
    }
  }
  return total;
}

function calculateUsedEnergy(buildings) {
  var used = 0;
  if (!buildings) return used;
  for (var i = 0; i < buildings.length; i++) {
    var bt = config.BUILDING_TYPES[buildings[i].type];
    if (bt) used += (bt.energyCost || 0);
  }
  return used;
}

function calculateMaxStorage(buildings) {
  var base = config.RESOURCE_DEFAULTS.maxStorage;
  if (!buildings) return base;
  for (var i = 0; i < buildings.length; i++) {
    if (buildings[i].type === 'warehouse') {
      var bt = config.BUILDING_TYPES.warehouse;
      if (bt && bt.baseOutput && bt.baseOutput.storage)
        base += config.INCOME_FORMULA(bt.baseOutput.storage, buildings[i].level);
    }
  }
  return base;
}

function calculateTotalPopulation(buildings) {
  var pop = 0;
  if (!buildings) return pop;
  for (var i = 0; i < buildings.length; i++) {
    var bt = config.BUILDING_TYPES[buildings[i].type];
    if (bt && bt.baseOutput && bt.baseOutput.population)
      pop += config.INCOME_FORMULA(bt.baseOutput.population, buildings[i].level);
  }
  return pop;
}

function processOfflineProgress(player, buildings, now) {
  var lastOnline = player.lastOnline ? new Date(player.lastOnline) : new Date(now);
  var nowDate = new Date(now);
  var elapsed = Math.floor((nowDate.getTime() - lastOnline.getTime()) / 1000);
  if (elapsed <= 0) return { resources: player.resources, collected: {} };
  elapsed = Math.min(elapsed, 8 * 3600);

  var maxStorage = calculateMaxStorage(buildings);
  var collected = {};

  if (buildings) {
    for (var i = 0; i < buildings.length; i++) {
      var b = buildings[i];
      var bt = config.BUILDING_TYPES[b.type];
      if (!bt || bt.baseTime === 0) continue;
      var prodTime = calculateProductionTime(b.type, b.level);
      if (prodTime <= 0) continue;
      var cycles = Math.min(Math.floor(elapsed / prodTime), 10);
      if (cycles <= 0) continue;
      var output = calculateOutput(b.type, b.level);
      var outputKeys = Object.keys(output);
      for (var j = 0; j < outputKeys.length; j++) {
        collected[outputKeys[j]] = (collected[outputKeys[j]] || 0) + output[outputKeys[j]] * cycles;
      }
    }
  }

  addResources(player.resources, collected, maxStorage);
  return { resources: player.resources, collected: collected };
}

// Generate random quest based on player level
function generateRandomQuest(level, existingIds) {
  existingIds = existingIds || [];
  var pools = config.RANDOM_QUEST_POOLS;
  var questTypes = ['build', 'collect', 'upgrade', 'spend', 'collect', 'build'];
  var chosenType = questTypes[Math.floor(Math.random() * questTypes.length)];
  var pool = pools[chosenType];
  if (!pool || pool.length === 0) { chosenType = 'collect'; pool = pools.collect; }

  var template = pool[Math.floor(Math.random() * pool.length)];
  var questId = 'r_' + Date.now() + '_' + Math.floor(Math.random() * 10000);

  // Avoid duplicates
  var attempts = 0;
  while (existingIds.indexOf(questId) >= 0 && attempts < 10) {
    questId = 'r_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    attempts++;
  }

  var quest = { questId: questId, type: chosenType, progress: 0 };
  var levelMult = 1 + (level - 1) * 0.5;

  if (chosenType === 'build') {
    // Check if building is unlocked
    var bt = config.BUILDING_TYPES[template.target];
    if (bt && bt.unlockLevel > level) {
      // Pick a simpler building
      var simpleBuildings = ['farm', 'house', 'quarry', 'garden'];
      template = { target: simpleBuildings[Math.floor(Math.random() * simpleBuildings.length)], desc: 'Построй здание', base_reward: 200 };
      bt = config.BUILDING_TYPES[template.target];
      if (bt) template.desc = 'Построй ' + bt.name.toLowerCase();
    }
    quest.target = template.target;
    quest.count = 1 + Math.floor(Math.random() * Math.min(3, level));
    quest.description = template.desc + (quest.count > 1 ? ' (' + quest.count + ' шт.)' : '');
    quest.reward = { coins: Math.floor(template.base_reward * levelMult), crystals: Math.max(1, Math.floor(level / 3)) };
  } else if (chosenType === 'collect') {
    var amount = Math.floor(template.multiplier * levelMult * (1 + Math.random()));
    amount = Math.round(amount / 10) * 10;
    quest.target = template.target;
    quest.count = amount;
    quest.description = template.desc.replace('{n}', amount);
    var rewardCoins = Math.floor(amount * 0.5);
    quest.reward = { coins: rewardCoins, crystals: Math.max(1, Math.floor(level / 4)) };
  } else if (chosenType === 'upgrade') {
    var targetLevel = 2 + Math.floor(Math.random() * Math.min(level * 2, 15));
    quest.target = template.target;
    quest.count = targetLevel;
    quest.description = template.desc.replace('{n}', targetLevel);
    quest.reward = { coins: Math.floor(300 * levelMult), materials: Math.floor(100 * levelMult), crystals: Math.max(1, Math.floor(level / 3)) };
  } else if (chosenType === 'spend') {
    var spendAmount = Math.floor(template.multiplier * levelMult * (1 + Math.random()));
    spendAmount = Math.round(spendAmount / 10) * 10;
    quest.target = template.target;
    quest.count = spendAmount;
    quest.description = template.desc.replace('{n}', spendAmount);
    quest.reward = { crystals: Math.max(2, Math.floor(level / 2)), coins: Math.floor(spendAmount * 0.3) };
  }

  return quest;
}

function getQuestsForLevel(level, completedQuestIds) {
  completedQuestIds = completedQuestIds || [];
  var available = [];

  // Add story quests
  for (var i = 0; i < config.QUEST_TEMPLATES.length; i++) {
    var q = config.QUEST_TEMPLATES[i];
    if (q.minLevel <= level && completedQuestIds.indexOf(q.id) === -1) {
      available.push({
        questId: q.id,
        type: q.type,
        target: q.target,
        count: q.count,
        reward: q.reward,
        description: '⭐ ' + q.description,
        progress: 0
      });
    }
  }

  return available.slice(0, 3);
}

function fillQuestsWithRandom(activeQuests, level, completedQuestIds, maxQuests) {
  maxQuests = maxQuests || 8;
  var existingIds = activeQuests.map(function(q) { return q.questId; });
  var needed = maxQuests - activeQuests.length;

  for (var i = 0; i < needed; i++) {
    var rq = generateRandomQuest(level, existingIds.concat(completedQuestIds || []));
    activeQuests.push(rq);
    existingIds.push(rq.questId);
  }

  return activeQuests;
}

module.exports = {
  calculateOutput: calculateOutput,
  calculateUpgradeCost: calculateUpgradeCost,
  calculateBuildCost: calculateBuildCost,
  calculateProductionTime: calculateProductionTime,
  canAfford: canAfford,
  subtractResources: subtractResources,
  addResources: addResources,
  isTileUnlocked: isTileUnlocked,
  getNextZones: getNextZones,
  calculateTotalEnergy: calculateTotalEnergy,
  calculateUsedEnergy: calculateUsedEnergy,
  calculateMaxStorage: calculateMaxStorage,
  calculateTotalPopulation: calculateTotalPopulation,
  processOfflineProgress: processOfflineProgress,
  getQuestsForLevel: getQuestsForLevel,
  generateRandomQuest: generateRandomQuest,
  fillQuestsWithRandom: fillQuestsWithRandom
};