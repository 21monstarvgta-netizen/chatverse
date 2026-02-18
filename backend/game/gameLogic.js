var config = require('./gameConfig');

function calculateOutput(buildingType, level) {
  var bt = config.BUILDING_TYPES[buildingType];
  if (!bt) return {};
  var result = {};
  var keys = Object.keys(bt.baseOutput);
  for (var i = 0; i < keys.length; i++) {
    var res = keys[i];
    result[res] = config.INCOME_FORMULA(bt.baseOutput[res], level);
  }
  return result;
}

function calculateUpgradeCost(buildingType, currentLevel) {
  var bt = config.BUILDING_TYPES[buildingType];
  if (!bt) return {};
  var result = {};
  var keys = Object.keys(bt.baseCost);
  for (var i = 0; i < keys.length; i++) {
    var res = keys[i];
    result[res] = config.UPGRADE_COST_FORMULA(bt.baseCost[res], currentLevel);
  }
  return result;
}

function calculateBuildCost(buildingType) {
  var bt = config.BUILDING_TYPES[buildingType];
  if (!bt) return {};
  var result = {};
  var keys = Object.keys(bt.baseCost);
  for (var i = 0; i < keys.length; i++) {
    var res = keys[i];
    result[res] = bt.baseCost[res];
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
    var res = keys[i];
    if ((resources[res] || 0) < cost[res]) return false;
  }
  return true;
}

function subtractResources(resources, cost) {
  var keys = Object.keys(cost);
  for (var i = 0; i < keys.length; i++) {
    var res = keys[i];
    resources[res] = (resources[res] || 0) - cost[res];
  }
  return resources;
}

function addResources(resources, reward, maxStorage) {
  maxStorage = maxStorage || 999999;
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
      if (x >= zone.x1 && x <= zone.x2 && y >= zone.y1 && y <= zone.y2) {
        return true;
      }
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

  var baseX1 = centerX - halfInit;
  var baseY1 = centerY - halfInit;
  var baseX2 = centerX + halfInit - 1;
  var baseY2 = centerY + halfInit - 1;

  var expandedX1 = baseX1;
  var expandedY1 = baseY1;
  var expandedX2 = baseX2;
  var expandedY2 = baseY2;

  for (var i = 0; i < unlockedZones.length; i++) {
    expandedX1 = Math.min(expandedX1, unlockedZones[i].x1);
    expandedY1 = Math.min(expandedY1, unlockedZones[i].y1);
    expandedX2 = Math.max(expandedX2, unlockedZones[i].x2);
    expandedY2 = Math.max(expandedY2, unlockedZones[i].y2);
  }

  var size = 4;
  var candidates = [];

  if (expandedY1 - size >= 0) {
    candidates.push({
      x1: expandedX1, y1: expandedY1 - size,
      x2: expandedX2, y2: expandedY1 - 1,
      direction: 'north'
    });
  }
  if (expandedY2 + size < config.GRID_SIZE) {
    candidates.push({
      x1: expandedX1, y1: expandedY2 + 1,
      x2: expandedX2, y2: expandedY2 + size,
      direction: 'south'
    });
  }
  if (expandedX1 - size >= 0) {
    candidates.push({
      x1: expandedX1 - size, y1: expandedY1,
      x2: expandedX1 - 1, y2: expandedY2,
      direction: 'west'
    });
  }
  if (expandedX2 + size < config.GRID_SIZE) {
    candidates.push({
      x1: expandedX2 + 1, y1: expandedY1,
      x2: expandedX2 + size, y2: expandedY2,
      direction: 'east'
    });
  }

  candidates = candidates.filter(function(c) {
    for (var j = 0; j < unlockedZones.length; j++) {
      if (c.x1 === unlockedZones[j].x1 && c.y1 === unlockedZones[j].y1 &&
          c.x2 === unlockedZones[j].x2 && c.y2 === unlockedZones[j].y2) {
        return false;
      }
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
      if (bt && bt.baseOutput && bt.baseOutput.energy) {
        total += config.INCOME_FORMULA(bt.baseOutput.energy, buildings[i].level);
      }
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
      if (bt && bt.baseOutput && bt.baseOutput.storage) {
        base += config.INCOME_FORMULA(bt.baseOutput.storage, buildings[i].level);
      }
    }
  }
  return base;
}

function calculateTotalPopulation(buildings) {
  var pop = 0;
  if (!buildings) return pop;
  for (var i = 0; i < buildings.length; i++) {
    var bt = config.BUILDING_TYPES[buildings[i].type];
    if (bt && bt.baseOutput && bt.baseOutput.population) {
      pop += config.INCOME_FORMULA(bt.baseOutput.population, buildings[i].level);
    }
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
      var cycles = Math.floor(elapsed / prodTime);
      if (cycles <= 0) continue;
      cycles = Math.min(cycles, 10);

      var output = calculateOutput(b.type, b.level);
      var outputKeys = Object.keys(output);
      for (var j = 0; j < outputKeys.length; j++) {
        var res = outputKeys[j];
        var amount = output[res] * cycles;
        collected[res] = (collected[res] || 0) + amount;
      }
    }
  }

  addResources(player.resources, collected, maxStorage);
  return { resources: player.resources, collected: collected };
}

function getQuestsForLevel(level, completedQuestIds) {
  completedQuestIds = completedQuestIds || [];
  var available = [];
  for (var i = 0; i < config.QUEST_TEMPLATES.length; i++) {
    var q = config.QUEST_TEMPLATES[i];
    if (q.minLevel <= level && completedQuestIds.indexOf(i) === -1) {
      available.push({
        questId: i,
        type: q.type,
        target: q.target,
        count: q.count,
        reward: q.reward,
        description: q.description,
        progress: 0
      });
    }
  }
  return available.slice(0, 5);
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
  getQuestsForLevel: getQuestsForLevel
};