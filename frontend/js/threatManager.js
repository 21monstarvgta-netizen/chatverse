// ===== THREAT MANAGER =====
// Handles spawning, display, and combat for threats

var ThreatManager = function(game) {
  this.game = game;
  this.threats = [];
  this.spawnTimer = null;
  this.attackTimers = {};
  this.SPAWN_INTERVAL = 120000; // 2 minutes between potential spawns
  this.ATTACK_DELAY   = 30000;  // threat attacks after 30s if not killed
};

ThreatManager.prototype.start = function() {
  var self = this;
  // Sync threats from server state
  this.syncThreats(this.game.player.activeThreats || []);

  // Spawn timer
  this.spawnTimer = setInterval(function() {
    // Random chance: 60% each tick
    if (Math.random() < 0.6) self.requestSpawn();
  }, this.SPAWN_INTERVAL);
};

ThreatManager.prototype.stop = function() {
  if (this.spawnTimer) clearInterval(this.spawnTimer);
  var keys = Object.keys(this.attackTimers);
  for (var i = 0; i < keys.length; i++) clearTimeout(this.attackTimers[keys[i]]);
  this.attackTimers = {};
};

ThreatManager.prototype.syncThreats = function(serverThreats) {
  var self = this;
  this.threats = serverThreats || [];
  // Set up attack timers for existing threats
  for (var i = 0; i < this.threats.length; i++) {
    (function(threat) {
      if (!self.attackTimers[threat.id]) {
        var elapsed = Date.now() - new Date(threat.spawnedAt || Date.now()).getTime();
        var remaining = Math.max(1000, self.ATTACK_DELAY - elapsed);
        self.attackTimers[threat.id] = setTimeout(function() {
          self.threatAttacks(threat.id);
        }, remaining);
      }
    })(this.threats[i]);
  }
  this._updateRenderer();
};

ThreatManager.prototype._updateRenderer = function() {
  if (this.game.renderer) {
    this.game.renderer.setThreats(this.threats);
  }
};

ThreatManager.prototype.requestSpawn = async function() {
  // Don't spawn if visiting another city
  if (this.game.visitingUserId) return;
  // Don't spawn if no buildings
  if (!this.game.player || !this.game.player.buildings || this.game.player.buildings.length === 0) return;

  try {
    var data = await apiRequest('/game/threat/spawn', { method: 'POST' });
    if (data.success && data.threat) {
      this.game.player = data.player;
      this.threats = data.player.activeThreats || [];
      this._updateRenderer();
      this._showThreatAlert(data.threat);
      this._scheduleThreatAttack(data.threat);
      this.game.ui.updateResources(this.game.player);
    }
  } catch(e) {
    // silently fail
  }
};

ThreatManager.prototype._showThreatAlert = function(threat) {
  // Show alert panel
  var panel = document.getElementById('threat-alert-panel');
  var name  = document.getElementById('threat-alert-name');
  var desc  = document.getElementById('threat-alert-desc');
  var emoji = document.getElementById('threat-alert-emoji');
  if (!panel) return;

  emoji.textContent = threat.emoji;
  name.textContent  = '⚠️ ' + threat.name + ' нападает!';
  desc.textContent  = '30 секунд до атаки! Нажми на врага чтобы убить его!';

  panel.classList.remove('hidden');
  panel.classList.add('threat-pulse');

  // Auto-hide after 6 seconds
  setTimeout(function() { panel.classList.add('hidden'); panel.classList.remove('threat-pulse'); }, 6000);
};

ThreatManager.prototype._scheduleThreatAttack = function(threat) {
  var self = this;
  if (this.attackTimers[threat.id]) return;
  this.attackTimers[threat.id] = setTimeout(function() {
    self.threatAttacks(threat.id);
  }, this.ATTACK_DELAY);
};

ThreatManager.prototype.threatAttacks = async function(threatId) {
  delete this.attackTimers[threatId];
  // Find threat in local list
  var threat = null;
  for (var i = 0; i < this.threats.length; i++) {
    if (this.threats[i].id === threatId) { threat = this.threats[i]; break; }
  }
  if (!threat) return; // already killed

  try {
    var data = await apiRequest('/game/threat/damage/' + threatId, { method: 'POST' });
    this.game.player = data.player;
    this.threats = data.player.activeThreats || [];
    this._updateRenderer();
    this.game.ui.updateResources(this.game.player);

    // Show damage message
    if (data.damage) {
      var dmgParts = [];
      var icons = { coins: '🪙', food: '🍞', materials: '🪨', crystals: '💎' };
      for (var key in data.damage) {
        if (icons[key] && data.damage[key] > 0) dmgParts.push('-' + data.damage[key] + ' ' + icons[key]);
      }
      if (threat) {
        showToast('💥 ' + (threat.emoji||'') + ' ' + (threat.name||'Враг') + ' атаковал! ' + dmgParts.join(' '), 'error');
      }
    }
  } catch(e) {
    // Remove from local list anyway
    this.threats = this.threats.filter(function(t){ return t.id !== threatId; });
    this._updateRenderer();
  }
};

ThreatManager.prototype.attackThreat = async function(threatId) {
  try {
    var data = await apiRequest('/game/threat/attack/' + threatId, {
      method: 'POST',
      body: JSON.stringify({ damage: 1 })
    });
    this.game.player = data.player;
    this.threats = data.player.activeThreats || [];
    this._updateRenderer();
    this.game.ui.updateResources(this.game.player);

    if (data.killed) {
      // Clear attack timer
      if (this.attackTimers[threatId]) {
        clearTimeout(this.attackTimers[threatId]);
        delete this.attackTimers[threatId];
      }
      var reward = data.reward || {};
      var parts = [];
      var icons = { coins:'🪙', food:'🍞', materials:'🪨', crystals:'💎' };
      for (var key in reward) { if (icons[key]) parts.push('+' + reward[key] + ' ' + icons[key]); }
      showToast('⚔️ Враг побеждён! ' + parts.join(' '), 'success');
    } else {
      // Find updated threat
      var updated = null;
      for (var i = 0; i < this.threats.length; i++) {
        if (this.threats[i].id === threatId) { updated = this.threats[i]; break; }
      }
      if (updated) showToast('⚔️ Удар! Осталось HP: ' + updated.hp + '/' + updated.maxHp, 'info');
    }
  } catch(e) {
    showToast(e.message, 'error');
  }
};

ThreatManager.prototype.handleTileClick = function(x, y) {
  // Check if a threat is at this tile
  for (var i = 0; i < this.threats.length; i++) {
    var t = this.threats[i];
    if (Math.floor(t.x) === x && Math.floor(t.y) === y) {
      this.showThreatPanel(t);
      return true; // consumed click
    }
  }
  return false;
};

ThreatManager.prototype.showThreatPanel = function(threat) {
  var panel = document.getElementById('threat-combat-panel');
  if (!panel) return;

  document.getElementById('threat-combat-emoji').textContent = threat.emoji;
  document.getElementById('threat-combat-name').textContent  = threat.name;
  this.updateThreatCombatPanel(threat);

  panel.classList.remove('hidden');

  var self = this;
  var attackBtn = document.getElementById('threat-attack-btn');
  if (attackBtn) {
    attackBtn.onclick = function() {
      self.attackThreat(threat.id).then(function() {
        // Refresh panel with updated threat
        var updated = null;
        for (var i = 0; i < self.threats.length; i++) {
          if (self.threats[i].id === threat.id) { updated = self.threats[i]; break; }
        }
        if (updated) {
          self.updateThreatCombatPanel(updated);
        } else {
          panel.classList.add('hidden');
        }
      });
    };
  }
  var closeBtn = document.getElementById('threat-combat-close');
  if (closeBtn) closeBtn.onclick = function() { panel.classList.add('hidden'); };
};

ThreatManager.prototype.updateThreatCombatPanel = function(threat) {
  var hpBar = document.getElementById('threat-hp-bar');
  var hpText = document.getElementById('threat-hp-text');
  if (!hpBar || !hpText) return;
  var pct = Math.max(0, Math.min(100, (threat.hp / threat.maxHp) * 100));
  hpBar.style.width = pct + '%';
  hpBar.style.background = pct > 50 ? '#22c55e' : pct > 25 ? '#f59e0b' : '#ef4444';
  hpText.textContent = threat.hp + ' / ' + threat.maxHp + ' HP';
};
