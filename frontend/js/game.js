// Main game controller

var game;

var Game = function() {
  this.player = null;
  this.config = null;
  this.renderer = null;
  this.ui = null;
  this.placingType = null;
  this.visitingUserId = null;
  this.timerInterval = null;
  this.init();
};

Game.prototype.init = async function() {
  if (!requireAuth()) return;
  try {
    var data = await apiRequest('/game/state');
    this.player = data.player;
    this.config = data.config;

    this.renderer = new GameRenderer(
      document.getElementById('game-canvas'),
      document.getElementById('game-viewport')
    );
    this.ui = new GameUI(this);

    this.updateRendererState();
    this.renderer.render();
    this.ui.updateResources(this.player);
    this.ui.renderBuildList(this.config.buildingTypes, this.player.level, this.player.resources);
    this.ui.renderQuests(this.player.activeQuests);

    var self = this;
    this.renderer.onTileClickCallback = function(x, y) { self.onTileClick(x, y); };

    this.setupEvents();
    this.startTimerUpdates();

    // Show offline progress
    if (data.player.offlineCollected) {
      var oc = data.player.offlineCollected;
      var parts = [];
      for (var r in oc) {
        if (oc[r] > 0) {
          var icon = { coins: '🪙', food: '🍞', materials: '🪨', energy: '⚡', experience: '✨' }[r] || r;
          parts.push(icon + '+' + oc[r]);
        }
      }
      if (parts.length > 0) {
        showToast('Пока вас не было: ' + parts.join(' '), 'success');
      }
    }

    document.getElementById('game-loading').classList.add('hidden');
    document.getElementById('game-app').classList.remove('hidden');
  } catch (error) {
    console.error('Game init error:', error);
    showToast('Ошибка загрузки игры', 'error');
  }
};

Game.prototype.setupEvents = function() {
  var self = this;

  document.getElementById('game-back-btn').addEventListener('click', function() {
    window.location.href = '/';
  });

  document.getElementById('city-rename-btn').addEventListener('click', function() {
    var name = prompt('Название города:', self.player.cityName);
    if (name !== null && name.trim()) self.renameCity(name.trim());
  });

  // Bottom tabs
  document.querySelectorAll('.bottom-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      self.ui.switchPanel(tab.dataset.tab);
    });
  });

  // Build categories
  document.querySelectorAll('.build-cat-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.build-cat-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      self.ui.selectedBuildCategory = btn.dataset.cat;
      self.ui.renderBuildList(self.config.buildingTypes, self.player.level, self.player.resources);
    });
  });

  // Panel close buttons
  document.getElementById('close-build-panel').addEventListener('click', function() {
    document.getElementById('panel-build').classList.add('hidden');
  });
  document.getElementById('close-quests-panel').addEventListener('click', function() {
    document.getElementById('panel-quests').classList.add('hidden');
  });
  document.getElementById('close-social-panel').addEventListener('click', function() {
    document.getElementById('panel-social').classList.add('hidden');
  });
  document.getElementById('close-building-info').addEventListener('click', function() {
    self.ui.hideBuildingInfo();
    self.renderer.selectedTile = null;
  });

  // Zone unlock
  document.getElementById('zone-cancel').addEventListener('click', function() {
    document.getElementById('zone-unlock-modal').classList.add('hidden');
  });

  // Visit back
  document.getElementById('visit-back').addEventListener('click', function() {
    self.exitVisitMode();
  });

  // Escape to cancel placing
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      self.cancelPlacing();
      self.ui.hideBuildingInfo();
      self.renderer.selectedTile = null;
    }
  });
};

Game.prototype.updateRendererState = function() {
  // Build unlocked tiles map
  var unlockedTiles = {};
  var gs = this.config.gridSize;
  var half = Math.floor(this.config.initialUnlocked / 2);
  var center = Math.floor(gs / 2);

  // Initial area
  for (var x = center - half; x < center + half; x++) {
    for (var y = center - half; y < center + half; y++) {
      unlockedTiles[x + ',' + y] = true;
    }
  }

  // Unlocked zones
  var zones = this.player.unlockedZones || [];
  for (var i = 0; i < zones.length; i++) {
    var z = zones[i];
    for (var zx = z.x1; zx <= z.x2; zx++) {
      for (var zy = z.y1; zy <= z.y2; zy++) {
        unlockedTiles[zx + ',' + zy] = true;
      }
    }
  }

  this.renderer.setUnlockedTiles(unlockedTiles);
  this.renderer.setBuildings(this.player.buildings, this.config.buildingTypes);
  this.updateReadyState();
};

Game.prototype.updateReadyState = function() {
  var readyMap = {};
  var now = Date.now();
  for (var i = 0; i < this.player.buildings.length; i++) {
    var b = this.player.buildings[i];
    var bt = this.config.buildingTypes[b.type];
    if (!bt || bt.baseTime === 0) continue;
    var prodTime = Math.floor(bt.baseTime * (1 + (b.level - 1) * 0.03)) * 1000;
    var elapsed = now - new Date(b.lastCollected).getTime();
    if (elapsed >= prodTime) {
      readyMap[b.x + ',' + b.y] = true;
    }
  }
  this.renderer.setReadyBuildings(readyMap);
};

Game.prototype.startTimerUpdates = function() {
  var self = this;
  this.timerInterval = setInterval(function() {
    self.updateReadyState();
  }, 5000);
};

Game.prototype.onTileClick = function(x, y) {
  if (this.visitingUserId) return;

  var key = x + ',' + y;
  var isUnlocked = this.renderer.unlockedTiles[key];

  if (this.placingType) {
    if (!isUnlocked) {
      showToast('Территория не открыта', 'error');
      return;
    }
    var occupied = this.player.buildings.some(function(b) { return b.x === x && b.y === y; });
    if (occupied) {
      showToast('Клетка занята', 'error');
      return;
    }
    this.placeBuilding(this.placingType, x, y);
    return;
  }

  // Check if there's a building
  var buildingIndex = -1;
  for (var i = 0; i < this.player.buildings.length; i++) {
    if (this.player.buildings[i].x === x && this.player.buildings[i].y === y) {
      buildingIndex = i;
      break;
    }
  }

  if (buildingIndex >= 0) {
    this.renderer.selectedTile = { x: x, y: y };
    this.ui.showBuildingInfo(this.player.buildings[buildingIndex], buildingIndex, this.config.buildingTypes);
  } else if (!isUnlocked) {
    this.showZoneUnlock(x, y);
  } else {
    this.renderer.selectedTile = null;
    this.ui.hideBuildingInfo();
  }
};

Game.prototype.startPlacing = function(type) {
  this.placingType = type;
  this.renderer.placingBuilding = type;
  showToast('Нажмите на свободную клетку для строительства', 'info');

  // Track mouse for preview
  var self = this;
  this.renderer.viewport.addEventListener('mousemove', function handler(e) {
    if (!self.placingType) {
      self.renderer.viewport.removeEventListener('mousemove', handler);
      return;
    }
    var rect = self.renderer.viewport.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var worldX = mx / self.renderer.zoom + self.renderer.camera.x;
    var worldY = my / self.renderer.zoom + self.renderer.camera.y;
    var tileX = Math.floor(worldX / self.renderer.tileSize);
    var tileY = Math.floor(worldY / self.renderer.tileSize);
    self.renderer.hoverTile = { x: tileX, y: tileY };
  });
};

Game.prototype.cancelPlacing = function() {
  this.placingType = null;
  this.renderer.placingBuilding = null;
  this.renderer.hoverTile = null;
};

Game.prototype.placeBuilding = async function(type, x, y) {
  try {
    var data = await apiRequest('/game/build', {
      method: 'POST',
      body: JSON.stringify({ buildingType: type, x: x, y: y })
    });
    this.player = data.player;
    this.updateRendererState();
    this.ui.updateResources(this.player);
    this.ui.renderBuildList(this.config.buildingTypes, this.player.level, this.player.resources);
    this.ui.renderQuests(this.player.activeQuests);
    this.cancelPlacing();
    showToast(this.config.buildingTypes[type].emoji + ' Построено!', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
};

Game.prototype.collectBuilding = async function(buildingIndex) {
  try {
    var data = await apiRequest('/game/collect/' + buildingIndex, { method: 'POST' });
    this.player = data.player;
    this.updateRendererState();
    this.ui.updateResources(this.player);
    this.ui.renderQuests(this.player.activeQuests);

    var parts = [];
    for (var r in data.collected) {
      if (data.collected[r] > 0) {
        var icon = { coins: '🪙', food: '🍞', materials: '🪨', energy: '⚡', experience: '✨' }[r] || r;
        parts.push(icon + '+' + data.collected[r]);
      }
    }
    showToast(parts.join(' '), 'success');
    this.ui.showBuildingInfo(this.player.buildings[buildingIndex], buildingIndex, this.config.buildingTypes);
  } catch (e) {
    showToast(e.message, 'error');
  }
};

Game.prototype.collectAll = async function() {
  try {
    var data = await apiRequest('/game/collect-all', { method: 'POST' });
    this.player = data.player;
    this.updateRendererState();
    this.ui.updateResources(this.player);
    this.ui.renderQuests(this.player.activeQuests);

    if (data.count === 0) {
      showToast('Ничего не готово', 'info');
    } else {
      var parts = [];
      for (var r in data.collected) {
        if (data.collected[r] > 0) {
          var icon = { coins: '🪙', food: '🍞', materials: '🪨', energy: '⚡', experience: '✨' }[r] || r;
          parts.push(icon + '+' + data.collected[r]);
        }
      }
      showToast('Собрано из ' + data.count + ' зданий: ' + parts.join(' '), 'success');
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
};

Game.prototype.upgradeBuilding = async function(buildingIndex) {
  try {
    var data = await apiRequest('/game/upgrade/' + buildingIndex, { method: 'POST' });
    this.player = data.player;
    this.updateRendererState();
    this.ui.updateResources(this.player);
    this.ui.renderBuildList(this.config.buildingTypes, this.player.level, this.player.resources);
    this.ui.renderQuests(this.player.activeQuests);
    showToast('⬆️ Улучшено!', 'success');
    this.ui.showBuildingInfo(this.player.buildings[buildingIndex], buildingIndex, this.config.buildingTypes);
  } catch (e) {
    showToast(e.message, 'error');
  }
};

Game.prototype.demolishBuilding = async function(buildingIndex) {
  if (!confirm('Снести здание? Вернётся 30% ресурсов.')) return;
  try {
    var data = await apiRequest('/game/demolish/' + buildingIndex, { method: 'POST' });
    this.player = data.player;
    this.updateRendererState();
    this.ui.updateResources(this.player);
    this.ui.renderBuildList(this.config.buildingTypes, this.player.level, this.player.resources);
    this.ui.hideBuildingInfo();
    this.renderer.selectedTile = null;
    showToast('🗑️ Снесено', 'info');
  } catch (e) {
    showToast(e.message, 'error');
  }
};

Game.prototype.showZoneUnlock = function(x, y) {
  var nextZones = this.player.nextZones;
  if (!nextZones || nextZones.length === 0) {
    showToast('Нет доступных территорий', 'info');
    return;
  }

  // Find which zone this tile belongs to
  var targetZone = null;
  for (var i = 0; i < nextZones.length; i++) {
    var z = nextZones[i];
    if (x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) {
      targetZone = z;
      break;
    }
  }

  if (!targetZone) {
    // Show first available zone info
    targetZone = nextZones[0];
  }

  this.pendingZone = targetZone;
  var dirs = { north: 'Север', south: 'Юг', west: 'Запад', east: 'Восток' };
  document.getElementById('zone-unlock-info').innerHTML =
    'Направление: <strong>' + (dirs[targetZone.direction] || targetZone.direction) + '</strong><br>' +
    'Стоимость: <strong>🪙 ' + targetZone.cost + '</strong><br>' +
    'У вас: 🪙 ' + (this.player.resources.coins || 0);

  var self = this;
  document.getElementById('zone-confirm').onclick = function() {
    self.unlockZone();
  };

  document.getElementById('zone-unlock-modal').classList.remove('hidden');
};

Game.prototype.unlockZone = async function() {
  if (!this.pendingZone) return;
  try {
    var data = await apiRequest('/game/unlock-zone', {
      method: 'POST',
      body: JSON.stringify({ zone: this.pendingZone })
    });
    this.player = data.player;
    this.updateRendererState();
    this.ui.updateResources(this.player);
    this.ui.renderQuests(this.player.activeQuests);
    document.getElementById('zone-unlock-modal').classList.add('hidden');
    showToast('🗺️ Территория открыта!', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
};

Game.prototype.claimQuest = async function(questId) {
  try {
    var data = await apiRequest('/game/quest/claim/' + questId, { method: 'POST' });
    this.player = data.player;
    this.updateRendererState();
    this.ui.updateResources(this.player);
    this.ui.renderBuildList(this.config.buildingTypes, this.player.level, this.player.resources);
    this.ui.renderQuests(this.player.activeQuests);

    var parts = [];
    for (var r in data.reward) {
      var icon = { coins: '🪙', food: '🍞', materials: '🪨', crystals: '💎', experience: '✨' }[r] || r;
      parts.push(icon + '+' + data.reward[r]);
    }
    showToast('🎁 Награда: ' + parts.join(' '), 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
};

Game.prototype.renameCity = async function(name) {
  try {
    var data = await apiRequest('/game/rename', {
      method: 'POST',
      body: JSON.stringify({ name: name })
    });
    this.player.cityName = data.cityName;
    document.getElementById('city-name').textContent = data.cityName;
    showToast('Город переименован!', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
};

Game.prototype.loadLeaderboard = async function() {
  try {
    var data = await apiRequest('/game/leaderboard');
    this.ui.renderLeaderboard(data.leaderboard);
  } catch (e) {
    showToast('Ошибка загрузки', 'error');
  }
};

Game.prototype.visitCity = async function(userId) {
  try {
    var data = await apiRequest('/game/visit/' + userId);
    var city = data.city;

    this.visitingUserId = userId;
    this.renderer.setBuildings(city.buildings, this.config.buildingTypes);

    // Build unlocked tiles for visited city
    var unlockedTiles = {};
    var gs = this.config.gridSize;
    var half = Math.floor(this.config.initialUnlocked / 2);
    var center = Math.floor(gs / 2);
    for (var x = center - half; x < center + half; x++) {
      for (var y = center - half; y < center + half; y++) {
        unlockedTiles[x + ',' + y] = true;
      }
    }
    var zones = city.unlockedZones || [];
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      for (var zx = z.x1; zx <= z.x2; zx++) {
        for (var zy = z.y1; zy <= z.y2; zy++) {
          unlockedTiles[zx + ',' + zy] = true;
        }
      }
    }
    this.renderer.setUnlockedTiles(unlockedTiles);
    this.renderer.centerCamera();

    var ownerName = city.owner ? city.owner.username : 'Неизвестный';
    document.getElementById('visit-banner-text').textContent = '👁 ' + escapeHTML(city.cityName) + ' — ' + escapeHTML(ownerName) + ' (Ур.' + city.level + ')';
    document.getElementById('visit-banner').classList.remove('hidden');

    // Hide panels
    document.querySelectorAll('.game-panel').forEach(function(p) { p.classList.add('hidden'); });
    document.querySelector('.game-bottom-bar').style.display = 'none';

    showToast('Просмотр города: ' + city.cityName, 'info');
  } catch (e) {
    showToast(e.message, 'error');
  }
};

Game.prototype.exitVisitMode = function() {
  this.visitingUserId = null;
  this.updateRendererState();
  this.renderer.centerCamera();
  document.getElementById('visit-banner').classList.add('hidden');
  document.querySelector('.game-bottom-bar').style.display = '';
};

document.addEventListener('DOMContentLoaded', function() {
  game = new Game();
});