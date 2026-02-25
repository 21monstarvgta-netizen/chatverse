var game;

var Game = function() {
  this.player = null;
  this.config = null;
  this.renderer = null;
  this.ui = null;
  this.placingType = null;
  this.visitingUserId = null;
  this.threatManager = null;
  this.timerInterval = null;
  this.init();
};

Game.prototype.init = async function() {
  if (!requireAuth()) return;
  try {
    var data = await apiRequest('/game/state');
    this.player = data.player;
    this.config = data.config;

    document.getElementById('game-loading').classList.add('hidden');
    document.getElementById('game-app').classList.remove('hidden');

    var self = this;
    await new Promise(function(resolve) { setTimeout(resolve, 100); });

    self.renderer = new GameRenderer(
      document.getElementById('game-canvas'),
      document.getElementById('game-viewport')
    );
    self.ui = new GameUI(self);

    self.updateRendererState();
    self.renderer.centerCamera();
    self.renderer.resize();

    self.ui.updateResources(self.player);
    self.ui.renderBuildList(self.config.buildingTypes, self.player.level, self.player.resources);
    self.ui.renderQuests(self.player.activeQuests);

    self.renderer.onTileClickCallback = function(x, y) { self.onTileClick(x, y); };

    self.setupEvents();
    self.startTimerUpdates();
    // Init threat manager
    self.threatManager = new ThreatManager(self);
    self.threatManager.start();
    // Sync initial threats to renderer
    if (self.player.activeThreats && self.player.activeThreats.length > 0) {
      self.renderer.setThreats(self.player.activeThreats);
    }

    console.log('Game loaded. Tiles:', Object.keys(self.renderer.unlockedTiles).length,
      'Canvas:', self.renderer.canvasWidth, 'x', self.renderer.canvasHeight);

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
  } catch (error) {
    console.error('Game init error:', error);
    showToast('Ошибка загрузки игры: ' + error.message, 'error');
  }
};

Game.prototype.setupEvents = function() {
  var self = this;

  var backBtn = document.getElementById('game-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', function() {
      window.location.href = '/';
    });
  }

  var centerBtn = document.getElementById('game-center-btn');
  if (centerBtn) {
    centerBtn.addEventListener('click', function() {
      self.renderer.resize();
      self.renderer.centerCamera();
    });
  }

  var renameBtn = document.getElementById('city-rename-btn');
  if (renameBtn) {
    renameBtn.addEventListener('click', function() {
      var name = prompt('Название города:', self.player.cityName);
      if (name !== null && name.trim()) self.renameCity(name.trim());
    });
  }

  var resetBtn = document.getElementById('game-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', function() {
      if (!confirm('Сбросить весь прогресс? Это нельзя отменить!')) return;
      if (!confirm('Вы уверены? Все здания, ресурсы и квесты будут удалены!')) return;
      self.resetProgress();
    });
  }

  var cancelPlacingBtn = document.getElementById('cancel-placing');
  if (cancelPlacingBtn) {
    cancelPlacingBtn.addEventListener('click', function() {
      self.cancelPlacing();
    });
  }

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
  if (closeBuild) {
    closeBuild.addEventListener('click', function() {
      document.getElementById('panel-build').classList.add('hidden');
    });
  }

  var closeQuests = document.getElementById('close-quests-panel');
  if (closeQuests) {
    closeQuests.addEventListener('click', function() {
      document.getElementById('panel-quests').classList.add('hidden');
    });
  }

  var closeSocial = document.getElementById('close-social-panel');
  if (closeSocial) {
    closeSocial.addEventListener('click', function() {
      document.getElementById('panel-social').classList.add('hidden');
    });
  }

  var closeInfo = document.getElementById('close-building-info');
  if (closeInfo) {
    closeInfo.addEventListener('click', function() {
      self.ui.hideBuildingInfo();
      self.renderer.selectedTile = null;
    });
  }

  var zoneCancel = document.getElementById('zone-cancel');
  if (zoneCancel) {
    zoneCancel.addEventListener('click', function() {
      document.getElementById('zone-unlock-modal').classList.add('hidden');
    });
  }

  var visitBack = document.getElementById('visit-back');
  if (visitBack) {
    visitBack.addEventListener('click', function() {
      self.exitVisitMode();
    });
  }

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
  this.renderer.setBuildings(this.player.buildings || [], this.config.buildingTypes);
  this.renderer.setThreats(this.player.activeThreats || []);
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
  // Check threat click first
  if (this.threatManager && this.threatManager.handleTileClick(x, y)) return;

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
  var banner = document.getElementById('placing-banner');
  if (banner) banner.classList.remove('hidden');
  document.querySelectorAll('.game-panel').forEach(function(p) { p.classList.add('hidden'); });
};

Game.prototype.cancelPlacing = function() {
  this.placingType = null;
  this.renderer.placingBuilding = null;
  this.renderer.hoverTile = null;
  var banner = document.getElementById('placing-banner');
  if (banner) banner.classList.add('hidden');
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
  var infoEl = document.getElementById('zone-unlock-info');
  if (infoEl) {
    infoEl.innerHTML =
      'Направление: <strong>' + (dirs[targetZone.direction] || targetZone.direction) + '</strong><br>' +
      'Стоимость: <strong>🪙 ' + targetZone.cost + '</strong><br>' +
      'У вас: 🪙 ' + (this.player.resources.coins || 0);
  }

  var self = this;
  var confirmBtn = document.getElementById('zone-confirm');
  if (confirmBtn) {
    confirmBtn.onclick = function() {
      self.unlockZone();
    };
  }
  var modal = document.getElementById('zone-unlock-modal');
  if (modal) modal.classList.remove('hidden');
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
    var modal = document.getElementById('zone-unlock-modal');
    if (modal) modal.classList.add('hidden');
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
    var el = document.getElementById('city-name');
    if (el) el.textContent = data.cityName;
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
    this.renderer.setBuildings(city.buildings || [], this.config.buildingTypes);

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
    var bannerText = document.getElementById('visit-banner-text');
    if (bannerText) bannerText.textContent = '👁 ' + escapeHTML(city.cityName) + ' — ' + escapeHTML(ownerName) + ' (Ур.' + city.level + ')';
    var banner = document.getElementById('visit-banner');
    if (banner) banner.classList.remove('hidden');

    document.querySelectorAll('.game-panel').forEach(function(p) { p.classList.add('hidden'); });
    var bottomBar = document.querySelector('.game-bottom-bar');
    if (bottomBar) bottomBar.style.display = 'none';

    showToast('Просмотр города: ' + city.cityName, 'info');
  } catch (e) {
    showToast(e.message, 'error');
  }
};

Game.prototype.exitVisitMode = function() {
  this.visitingUserId = null;
  this.updateRendererState();
  this.renderer.centerCamera();
  var banner = document.getElementById('visit-banner');
  if (banner) banner.classList.add('hidden');
  var bottomBar = document.querySelector('.game-bottom-bar');
  if (bottomBar) bottomBar.style.display = '';
};

Game.prototype.resetProgress = async function() {
  try {
    var data = await apiRequest('/game/reset', { method: 'POST' });
    this.player = data.player;
    this.updateRendererState();
    this.renderer.centerCamera();
    this.ui.updateResources(this.player);
    this.ui.renderBuildList(this.config.buildingTypes, this.player.level, this.player.resources);
    this.ui.renderQuests(this.player.activeQuests);
    showToast('🔄 Прогресс сброшен!', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
};

// ===== MOVE BUILDING =====
Game.prototype.startMovingBuilding = function(buildingIndex) {
  this.movingBuildingIndex = buildingIndex;
  this.ui.hideBuildingInfo();
  this.renderer.selectedTile = null;
  var moveBanner = document.getElementById('move-banner');
  if (moveBanner) moveBanner.classList.remove('hidden');
  var self = this;
  // Temporary override: next tile click will move the building
  this._prevOnTileClick = this.renderer.onTileClickCallback;
  this.renderer.onTileClickCallback = function(x, y) {
    self.finishMovingBuilding(x, y);
  };
  showToast('🏗️ Выберите новое место для здания', 'info');
};

Game.prototype.finishMovingBuilding = async function(x, y) {
  var idx = this.movingBuildingIndex;
  // Restore callback
  this.renderer.onTileClickCallback = this._prevOnTileClick;
  this._prevOnTileClick = null;
  this.movingBuildingIndex = null;
  var moveBanner = document.getElementById('move-banner');
  if (moveBanner) moveBanner.classList.add('hidden');

  if (idx === undefined || idx === null) return;

  // Check tile is unlocked
  var key = x + ',' + y;
  if (!this.renderer.unlockedTiles[key]) {
    showToast('Территория не открыта', 'error');
    return;
  }
  // Check not occupied by another building (not self)
  var buildings = this.player.buildings || [];
  for (var i = 0; i < buildings.length; i++) {
    if (i !== idx && buildings[i].x === x && buildings[i].y === y) {
      showToast('Клетка занята', 'error');
      return;
    }
  }

  try {
    var data = await apiRequest('/game/move', {
      method: 'POST',
      body: JSON.stringify({ buildingIndex: idx, x: x, y: y })
    });
    this.player = data.player;
    this.updateRendererState();
    this.ui.updateResources(this.player);
    showToast('✅ Здание перемещено!', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
};

Game.prototype.cancelMoving = function() {
  if (this._prevOnTileClick) {
    this.renderer.onTileClickCallback = this._prevOnTileClick;
    this._prevOnTileClick = null;
  }
  this.movingBuildingIndex = null;
  var moveBanner = document.getElementById('move-banner');
  if (moveBanner) moveBanner.classList.add('hidden');
};

// ===== CRYSTAL EXCHANGE =====
Game.prototype.showCrystalExchange = function() {
  var modal = document.getElementById('crystal-exchange-modal');
  if (modal) {
    document.getElementById('crystal-exchange-have').textContent = this.player.resources.crystals || 0;
    document.getElementById('crystal-amount').value = 1;
    this.updateCrystalExchangePreview();
    modal.classList.remove('hidden');
  }
};

Game.prototype.updateCrystalExchangePreview = function() {
  var amount = parseInt(document.getElementById('crystal-amount').value) || 0;
  var resource = document.getElementById('crystal-resource').value;
  var icons = { coins: '🪙', food: '🍞', materials: '🪨' };
  var preview = document.getElementById('crystal-exchange-preview');
  if (preview) {
    preview.textContent = amount + ' 💎 → ' + (amount * 100) + ' ' + (icons[resource] || '') + resource;
  }
};

Game.prototype.confirmCrystalExchange = async function() {
  var amount = parseInt(document.getElementById('crystal-amount').value) || 0;
  var resource = document.getElementById('crystal-resource').value;
  if (amount <= 0) { showToast('Укажите количество кристаллов', 'error'); return; }
  if ((this.player.resources.crystals || 0) < amount) { showToast('Недостаточно кристаллов', 'error'); return; }
  try {
    var data = await apiRequest('/game/crystal-exchange', {
      method: 'POST',
      body: JSON.stringify({ crystals: amount, resource: resource })
    });
    this.player = data.player;
    this.ui.updateResources(this.player);
    var modal = document.getElementById('crystal-exchange-modal');
    if (modal) modal.classList.add('hidden');
    var icons = { coins: '🪙', food: '🍞', materials: '🪨' };
    showToast('💎 Обмен выполнен! +' + (amount * 100) + ' ' + (icons[resource] || '') + resource, 'success');
  } catch(e) {
    showToast(e.message, 'error');
  }
};

document.addEventListener('DOMContentLoaded', function() {
  game = new Game();
});