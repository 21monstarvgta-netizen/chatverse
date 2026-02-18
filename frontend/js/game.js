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
    showToast('Ошибка загрузки игры: ' + error.message, 'error');
  }
};

Game.prototype.setupEvents = function() {
  var self = this;

  var backBtn = document.getElementById('game-back-btn');
  if (backBtn) backBtn.addEventListener('click', function() {
    window.location.href = '/';
  });

  var centerBtn = document.getElementById('game-center-btn');
  if (centerBtn) centerBtn.addEventListener('click', function() {
    self.renderer.resize();
    self.renderer.centerCamera();
  });

  var renameBtn = document.getElementById('city-rename-btn');
  if (renameBtn) renameBtn.addEventListener('click', function() {
    var name = prompt('Название города:', self.player.cityName);
    if (name !== null && name.trim()) self.renameCity(name.trim());
  });

  var cancelPlacing = document.getElementById('cancel-placing');
  if (cancelPlacing) cancelPlacing.addEventListener('click', function() {
    self.cancelPlacing();
  });

  document.querySelectorAll('.bottom-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      self.ui.switchPanel(tab.dataset.tab);
    });
  });

  document.querySelectorAll('.build-cat-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.build-cat-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      self.ui.selectedBuildCategory = btn.dataset.cat;
      self.ui.renderBuildList(self.config.buildingTypes, self.player.level, self.player.resources);
    });
  });

  var closeBuild = document.getElementById('close-build-panel');
  if (closeBuild) closeBuild.addEventListener('click', function() {
    document.getElementById('panel-build').classList.add('hidden');
  });

  var closeQuests = document.getElementById('close-quests-panel');
  if (closeQuests) closeQuests.addEventListener('click', function() {
    document.getElementById('panel-quests').classList.add('hidden');
  });

  var closeSocial = document.getElementById('close-social-panel');
  if (closeSocial) closeSocial.addEventListener('click', function() {
    document.getElementById('panel-social').classList.add('hidden');
  });

  var closeInfo = document.getElementById('close-building-info');
  if (closeInfo) closeInfo.addEventListener('click', function() {
    self.ui.hideBuildingInfo();
    self.renderer.selectedTile = null;
  });

  var zoneCancel = document.getElementById('zone-cancel');
  if (zoneCancel) zoneCancel.addEventListener('click', function() {
    document.getElementById('zone-unlock-modal').classList.add('hidden');
  });

  var visitBack = document.getElementById('visit-back');
  if (visitBack) visitBack.addEventListener('click', function() {
    self.exitVisitMode();
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      self.cancelPlacing();
      self.ui.hideBuildingInfo();
      self.renderer.selectedTile = null;
    }
  });
};

  // Zone unlock
  document.getElementById('zone-cancel').addEventListener('click', function() {
    document.getElementById('zone-unlock-modal').classList.add('hidden');
  });

  // Visit back
  document.getElementById('visit-back').addEventListener('click', function() {
    self.exitVisitMode();
  });

  // Escape to cancel
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      self.cancelPlacing();
      self.ui.hideBuildingInfo();
      self.renderer.selectedTile = null;
    }
  });
};

Game.prototype.updateRendererState = function() {
  var unlockedTiles = {};
  var gs = this.config.gridSize;
  var half = Math.floor(this.config.initialUnlocked / 2);
  var center = Math.floor(gs / 2);

  for (var x = center - half; x < center + half; x++) {
    for (var y = center - half; y < center + half; y++) {
      unlockedTiles[x + ',' + y] = true;
    }
  }

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
  var buildings = this.player.buildings || [];
  for (var i = 0; i < buildings.length; i++) {
    var b = buildings[i];
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
    var buildings = this.player.buildings || [];
    var occupied = false;
    for (var i = 0; i < buildings.length; i++) {
      if (buildings[i].x === x && buildings[i].y === y) { occupied = true; break; }
    }
    if (occupied) {
      showToast('Клетка занята', 'error');
      return;
    }
    this.placeBuilding(this.placingType, x, y);
    return;
  }

  // Check building
  var buildingIndex = -1;
  var pBuildings = this.player.buildings || [];
  for (var j = 0; j < pBuildings.length; j++) {
    if (pBuildings[j].x === x && pBuildings[j].y === y) {
      buildingIndex = j;
      break;
    }
  }

  if (buildingIndex >= 0) {
    this.renderer.selectedTile = { x: x, y: y };
    this.ui.showBuildingInfo(pBuildings[buildingIndex], buildingIndex, this.config.buildingTypes);
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
  document.getElementById('placing-banner').classList.remove('hidden');
  // Close panels
  document.querySelectorAll('.game-panel').forEach(function(p) { p.classList.add('hidden'); });
};

Game.prototype.cancelPlacing = function() {
  this.placingType = null;
  this.renderer.placingBuilding = null;
  this.renderer.hoverTile = null;
  document.getElementById('placing-banner').classList.add('hidden');
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
      showToast('Собрано из ' + data.count + ': ' + parts.join(' '), 'success');
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

  var targetZone = null;
  for (var i = 0; i < nextZones.length; i++) {
    var z = nextZones[i];
    if (x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) {
      targetZone = z;
      break;
    }
  }
  if (!targetZone) targetZone = nextZones[0];

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