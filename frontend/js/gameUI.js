// Game UI manager

var GameUI = function(game) {
  this.game = game;
  this.activePanel = 'build';
  this.selectedBuildCategory = 'all';
};

GameUI.prototype.updateResources = function(player) {
  document.getElementById('res-coins').textContent = this.formatNum(player.resources.coins || 0);
  document.getElementById('res-food').textContent = this.formatNum(player.resources.food || 0);
  document.getElementById('res-materials').textContent = this.formatNum(player.resources.materials || 0);
  document.getElementById('res-energy').textContent = (player.usedEnergy || 0) + '/' + (player.totalEnergy || 0);
  document.getElementById('res-population').textContent = this.formatNum(player.totalPopulation || 0);
  document.getElementById('res-crystals').textContent = this.formatNum(player.resources.crystals || 0);

  document.getElementById('level-badge').textContent = 'Ур. ' + player.level;
  var xpPct = player.xpNeeded > 0 ? Math.min(100, Math.floor(player.experience / player.xpNeeded * 100)) : 0;
  document.getElementById('xp-bar-fill').style.width = xpPct + '%';
  document.getElementById('city-name').textContent = player.cityName || 'Мой город';
};

GameUI.prototype.formatNum = function(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
};

GameUI.prototype.renderBuildList = function(buildingTypes, playerLevel, resources) {
  var list = document.getElementById('build-list');
  var self = this;
  var keys = Object.keys(buildingTypes);
  var category = this.selectedBuildCategory;

  var filtered = keys.filter(function(key) {
    var bt = buildingTypes[key];
    if (category === 'all') return true;
    return bt.category === category;
  });

  list.innerHTML = filtered.map(function(key) {
    var bt = buildingTypes[key];
    var locked = playerLevel < bt.unlockLevel;
    var costStr = Object.keys(bt.baseCost).map(function(r) {
      var icon = { coins: '🪙', food: '🍞', materials: '🪨' }[r] || r;
      var have = resources[r] || 0;
      var need = bt.baseCost[r];
      var color = have >= need ? '#55efc4' : '#ff6b6b';
      return '<span style="color:' + color + '">' + icon + need + '</span>';
    }).join(' ');

    return '<div class="build-item' + (locked ? ' locked' : '') + '" data-type="' + key + '">' +
      '<div class="build-item-emoji">' + bt.emoji + '</div>' +
      '<div class="build-item-info">' +
      '<div class="build-item-name">' + bt.name + '</div>' +
      '<div class="build-item-desc">' + bt.description + '</div>' +
      (locked ? '<div class="build-item-lock">🔒 Уровень ' + bt.unlockLevel + '</div>' :
        '<div class="build-item-cost">' + costStr + ' ⚡' + bt.energyCost + '</div>') +
      '</div></div>';
  }).join('');

  list.querySelectorAll('.build-item:not(.locked)').forEach(function(el) {
    el.addEventListener('click', function() {
      self.game.startPlacing(el.dataset.type);
    });
  });
};

GameUI.prototype.renderQuests = function(quests) {
  var list = document.getElementById('quests-list');
  var self = this;

  if (!quests || quests.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">Все квесты выполнены! 🎉</div>';
    this.updateQuestBadge(0);
    return;
  }

  var completedCount = 0;
  list.innerHTML = quests.map(function(q) {
    var pct = Math.min(100, Math.floor(q.progress / q.count * 100));
    var done = q.progress >= q.count;
    if (done) completedCount++;
    var rewardStr = Object.keys(q.reward).map(function(r) {
      var icon = { coins: '🪙', food: '🍞', materials: '🪨', crystals: '💎', experience: '✨' }[r] || r;
      return icon + q.reward[r];
    }).join(' ');

    return '<div class="quest-item' + (done ? ' completed' : '') + '">' +
      '<div class="quest-desc">' + q.description + '</div>' +
      '<div class="quest-progress-bar"><div class="quest-progress-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="quest-progress-text">' + Math.min(q.progress, q.count) + ' / ' + q.count + '</div>' +
      '<div class="quest-reward">Награда: ' + rewardStr + '</div>' +
      (done ? '<button class="quest-claim-btn" data-quest-id="' + q.questId + '">🎁 Забрать</button>' : '') +
      '</div>';
  }).join('');

  list.querySelectorAll('.quest-claim-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      self.game.claimQuest(btn.dataset.questId);
    });
  });

  this.updateQuestBadge(completedCount);
};

GameUI.prototype.updateQuestBadge = function(count) {
  var badge = document.getElementById('quest-badge');
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
};

GameUI.prototype.renderLeaderboard = function(leaderboard) {
  var list = document.getElementById('leaderboard-list');
  var self = this;

  if (!leaderboard || leaderboard.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">Пока никого нет</div>';
    return;
  }

  list.innerHTML = leaderboard.map(function(p, idx) {
    var rankClass = idx === 0 ? ' gold' : idx === 1 ? ' silver' : idx === 2 ? ' bronze' : '';
    var rankText = idx < 3 ? ['🥇', '🥈', '🥉'][idx] : (idx + 1);
    return '<div class="leader-item" data-user-id="' + p.userId + '">' +
      '<div class="leader-rank' + rankClass + '">' + rankText + '</div>' +
      '<div class="leader-info">' +
      '<div class="leader-name">' + escapeHTML(p.username) + '</div>' +
      '<div class="leader-stats">' + escapeHTML(p.cityName) + ' · Ур.' + p.level + ' · 🏠' + p.buildingCount + ' · 👥' + p.population + '</div>' +
      '</div></div>';
  }).join('');

  list.querySelectorAll('.leader-item').forEach(function(el) {
    el.addEventListener('click', function() {
      self.game.visitCity(el.dataset.userId);
    });
  });
};

GameUI.prototype.showBuildingInfo = function(building, buildingIndex, config) {
  var panel = document.getElementById('building-info-panel');
  var bt = config[building.type];
  if (!bt) return;

  document.getElementById('building-info-emoji').textContent = bt.emoji;
  document.getElementById('building-info-name').textContent = bt.name;
  document.getElementById('building-info-level').textContent = 'Ур. ' + building.level + ' / ' + bt.maxLevel;

  // Output
  var outputHTML = '<strong>Производство:</strong> ';
  var baseOutput = bt.baseOutput;
  for (var r in baseOutput) {
    var actual = Math.floor(baseOutput[r] * Math.pow(1.18, building.level - 1));
    var icon = { coins: '🪙', food: '🍞', materials: '🪨', energy: '⚡', population: '👥', experience: '✨', storage: '📦' }[r] || r;
    outputHTML += icon + actual + ' ';
  }
  document.getElementById('building-info-output').innerHTML = outputHTML;

  // Timer
  if (bt.baseTime > 0) {
    var prodTime = Math.floor(bt.baseTime * (1 + (building.level - 1) * 0.03));
    var elapsed = Math.floor((Date.now() - new Date(building.lastCollected).getTime()) / 1000);
    var remaining = Math.max(0, prodTime - elapsed);

    if (remaining > 0) {
      var min = Math.floor(remaining / 60);
      var sec = remaining % 60;
      document.getElementById('building-info-timer').innerHTML = '⏱️ Готово через: ' + min + 'м ' + sec + 'с';
    } else {
      document.getElementById('building-info-timer').innerHTML = '✅ <strong style="color:#55efc4">Готово к сбору!</strong>';
    }
  } else {
    document.getElementById('building-info-timer').innerHTML = '♾️ Пассивный бонус';
  }

  // Actions
  var actionsHTML = '';
  if (bt.baseTime > 0) {
    var isReady = bt.baseTime > 0 && Math.floor((Date.now() - new Date(building.lastCollected).getTime()) / 1000) >= Math.floor(bt.baseTime * (1 + (building.level - 1) * 0.03));
    actionsHTML += '<button class="btn btn-primary btn-sm" style="width:auto;" ' + (isReady ? '' : 'disabled') + ' onclick="game.collectBuilding(' + buildingIndex + ')">💰 Собрать</button>';
  }
  if (building.level < bt.maxLevel) {
    // Calculate upgrade cost
    var upgCost = {};
    for (var uc in bt.baseCost) {
      upgCost[uc] = Math.floor(bt.baseCost[uc] * Math.pow(1.32, building.level));
    }
    var upgStr = Object.keys(upgCost).map(function(r) {
      var icon = { coins: '🪙', food: '🍞', materials: '🪨' }[r] || r;
      return icon + upgCost[r];
    }).join(' ');
    actionsHTML += '<button class="btn btn-secondary btn-sm" onclick="game.upgradeBuilding(' + buildingIndex + ')">⬆️ ' + upgStr + '</button>';
  }
  actionsHTML += '<button class="btn btn-ghost btn-sm" style="color:#ff6b6b;" onclick="game.demolishBuilding(' + buildingIndex + ')">🗑️</button>';
  actionsHTML += '<button class="btn btn-ghost btn-sm" style="color:#fdcb6e;" onclick="game.startMovingBuilding(' + buildingIndex + ')">🏗️ Переставить</button>';

  document.getElementById('building-info-actions').innerHTML = actionsHTML;
  panel.classList.remove('hidden');
};

GameUI.prototype.hideBuildingInfo = function() {
  document.getElementById('building-info-panel').classList.add('hidden');
};

GameUI.prototype.switchPanel = function(tabName) {
  this.activePanel = tabName;
  document.querySelectorAll('.bottom-tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelector('[data-tab="' + tabName + '"]').classList.add('active');

  document.querySelectorAll('.game-panel').forEach(function(p) { p.classList.add('hidden'); });

  if (tabName === 'build') {
    document.getElementById('panel-build').classList.remove('hidden');
  } else if (tabName === 'quests') {
    document.getElementById('panel-quests').classList.remove('hidden');
  } else if (tabName === 'social') {
    document.getElementById('panel-social').classList.remove('hidden');
    this.game.loadLeaderboard();
  } else if (tabName === 'collect') {
    this.game.collectAll();
  }
};