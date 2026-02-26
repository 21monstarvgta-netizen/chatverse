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

// ── helper to build reward string ───────────────────────────
GameUI.prototype._rewardStr = function(reward) {
  if (!reward || !Object.keys(reward).length) return '—';
  return Object.keys(reward).filter(function(r) { return reward[r] > 0; }).map(function(r) {
    var icon = { coins: '🪙', food: '🍞', materials: '🪨', crystals: '💎', experience: '✨', energy: '⚡' }[r] || r;
    return icon + reward[r];
  }).join(' ');
};

// ── Switch quest tabs ────────────────────────────────────────
GameUI.prototype.switchQuestTab = function(tab) {
  var storySection = document.getElementById('quest-story-section');
  var dailySection = document.getElementById('quest-daily-section');
  var tabStory = document.getElementById('tab-story-quests');
  var tabDaily = document.getElementById('tab-daily-quests');
  if (tab === 'story') {
    storySection.classList.remove('hidden');
    dailySection.classList.add('hidden');
    tabStory.classList.add('active');
    tabDaily.classList.remove('active');
  } else {
    storySection.classList.add('hidden');
    dailySection.classList.remove('hidden');
    tabStory.classList.remove('active');
    tabDaily.classList.add('active');
    if (this.game) this.game.loadDailyQuests();
  }
};

// ── Story quests ─────────────────────────────────────────────
GameUI.prototype.renderQuests = function(quests) {
  var list = document.getElementById('quests-list');
  var self = this;
  var storyQuests = (quests || []).filter(function(q) {
    return !q.questId || q.questId.indexOf('daily_') !== 0;
  });
  if (!storyQuests.length) {
    list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">Все квесты выполнены! 🎉</div>';
    this.updateQuestBadge(0);
    return;
  }
  var completedCount = 0;
  list.innerHTML = storyQuests.map(function(q) {
    var pct = Math.min(100, Math.floor((q.progress || 0) / q.count * 100));
    var done = (q.progress || 0) >= q.count;
    if (done) completedCount++;
    return '<div class="quest-item' + (done ? ' completed' : '') + '">' +
      '<div class="quest-desc">' + escapeHTML(q.description) + '</div>' +
      '<div class="quest-progress-bar"><div class="quest-progress-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="quest-progress-text">' + Math.min(q.progress || 0, q.count) + ' / ' + q.count + '</div>' +
      '<div class="quest-reward">Награда: ' + self._rewardStr(q.reward) + '</div>' +
      (done ? '<button class="quest-claim-btn" data-quest-id="' + q.questId + '">🎁 Забрать</button>' : '') +
      '</div>';
  }).join('');
  list.querySelectorAll('.quest-claim-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { self.game.claimQuest(btn.dataset.questId); });
  });
  this.updateQuestBadge(completedCount);
};

// ── Daily quests ─────────────────────────────────────────────
GameUI.prototype.renderDailyQuests = function(dailyQuests) {
  var list = document.getElementById('daily-quests-list');
  var self = this;
  if (!list) return;
  if (!dailyQuests || !dailyQuests.length) {
    list.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--text-muted);">' +
      '<div style="font-size:36px;margin-bottom:8px;">🌅</div>' +
      '<div>Ежедневных квестов пока нет</div>' +
      '<div style="font-size:11px;margin-top:6px;opacity:0.7;">Администратор скоро добавит новые задания</div></div>';
    this.updateDailyBadge(0);
    return;
  }
  var readyCount = 0;
  list.innerHTML = dailyQuests.map(function(q) {
    var pct = Math.min(100, Math.floor((q.progress || 0) / q.count * 100));
    var claimed = q.claimed;
    var done = q.done;
    if (done && !claimed) readyCount++;
    var remaining = Math.max(0, new Date(q.expiresAt) - Date.now());
    var hrs  = Math.floor(remaining / 3600000);
    var mins = Math.floor((remaining % 3600000) / 60000);
    var timerStr = remaining > 0 ? (hrs + 'ч ' + mins + 'м') : 'Истёк';
    var timerColor = remaining < 3600000 ? '#ef4444' : remaining < 10800000 ? '#f59e0b' : '#22c55e';
    return '<div class="quest-item daily-quest-item' + (claimed ? ' claimed' : done ? ' completed' : '') + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
        '<div style="flex:1;">' +
          '<div class="daily-quest-title">🌅 ' + escapeHTML(q.title) + '</div>' +
          '<div class="quest-desc" style="margin-top:3px;">' + escapeHTML(q.description) + '</div>' +
        '</div>' +
        '<div style="color:' + timerColor + ';white-space:nowrap;font-size:11px;padding-top:2px;">⏰ ' + timerStr + '</div>' +
      '</div>' +
      (!claimed ?
        '<div class="quest-progress-bar" style="margin-top:8px;"><div class="quest-progress-fill daily-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="quest-progress-text">' + Math.min(q.progress || 0, q.count) + ' / ' + q.count + '</div>'
      : '<div class="quest-progress-text" style="color:#22c55e;margin-top:6px;">✅ Получено</div>') +
      '<div class="quest-reward">Награда: ' + self._rewardStr(q.reward) + '</div>' +
      (done && !claimed ? '<button class="quest-claim-btn daily-claim-btn" data-quest-id="' + q.questId + '">🎁 Забрать награду!</button>' : '') +
      '</div>';
  }).join('');
  list.querySelectorAll('.daily-claim-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { self.game.claimDailyQuest(btn.dataset.questId); });
  });
  this.updateDailyBadge(readyCount);
};

GameUI.prototype.updateQuestBadge = function(count) {
  var badge = document.getElementById('quest-badge');
  if (!badge) return;
  if (count > 0) { badge.textContent = count; badge.classList.remove('hidden'); }
  else { badge.classList.add('hidden'); }
};

GameUI.prototype.updateDailyBadge = function(count) {
  var badge = document.getElementById('daily-badge');
  if (!badge) return;
  if (count > 0) { badge.textContent = '!'; badge.classList.remove('hidden'); }
  else { badge.classList.add('hidden'); }
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