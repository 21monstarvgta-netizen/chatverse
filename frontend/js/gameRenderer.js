// Canvas-based game renderer with touch support

var GameRenderer = function(canvas, viewport) {
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  this.viewport = viewport;

  this.gridSize = 25;
  this.tileSize = 64;
  this.camera = { x: 0, y: 0 };
  this.zoom = 1;
  this.minZoom = 0.3;
  this.maxZoom = 2;

  this.buildings = [];
  this.unlockedTiles = {};
  this.selectedTile = null;
  this.hoverTile = null;
  this.placingBuilding = null;

  this.isDragging = false;
  this.dragStart = { x: 0, y: 0 };
  this.cameraStart = { x: 0, y: 0 };

  // Touch
  this.touches = {};
  this.pinchStartDist = 0;
  this.pinchStartZoom = 1;

  // Colors
  this.grassColors = ['#2d5a27', '#2a5424', '#305e2a', '#28502a', '#336630'];
  this.lockedColor = '#1a1a2e';
  this.gridLineColor = 'rgba(85, 239, 196, 0.08)';
  this.selectedColor = 'rgba(85, 239, 196, 0.4)';
  this.hoverColor = 'rgba(85, 239, 196, 0.2)';
  this.unlockedBorderColor = 'rgba(85, 239, 196, 0.3)';

  // Pre-generate grass pattern
  this.grassPattern = {};
  for (var gx = 0; gx < this.gridSize; gx++) {
    for (var gy = 0; gy < this.gridSize; gy++) {
      this.grassPattern[gx + ',' + gy] = this.grassColors[Math.floor(Math.random() * this.grassColors.length)];
    }
  }

  this.buildingTypeConfig = {};
  this.readyBuildings = {};

  this.resize();
  this.setupEvents();
  this.centerCamera();
};

GameRenderer.prototype.resize = function() {
  var rect = this.viewport.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  this.canvas.width = rect.width * dpr;
  this.canvas.height = rect.height * dpr;
  this.canvas.style.width = rect.width + 'px';
  this.canvas.style.height = rect.height + 'px';
  this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  this.canvasWidth = rect.width;
  this.canvasHeight = rect.height;
};

GameRenderer.prototype.centerCamera = function() {
  var center = Math.floor(this.gridSize / 2);
  this.camera.x = center * this.tileSize - this.canvasWidth / 2 / this.zoom;
  this.camera.y = center * this.tileSize - this.canvasHeight / 2 / this.zoom;
};

GameRenderer.prototype.setupEvents = function() {
  var self = this;

  // Mouse
  this.viewport.addEventListener('mousedown', function(e) { self.onPointerDown(e.clientX, e.clientY, e); });
  window.addEventListener('mousemove', function(e) { self.onPointerMove(e.clientX, e.clientY); });
  window.addEventListener('mouseup', function() { self.onPointerUp(); });
  this.viewport.addEventListener('wheel', function(e) {
    e.preventDefault();
    var delta = e.deltaY > 0 ? 0.9 : 1.1;
    self.zoomAt(e.clientX, e.clientY, delta);
  }, { passive: false });

  // Touch
  this.viewport.addEventListener('touchstart', function(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      self.onPointerDown(e.touches[0].clientX, e.touches[0].clientY, e);
    } else if (e.touches.length === 2) {
      self.pinchStartDist = self.getTouchDist(e.touches);
      self.pinchStartZoom = self.zoom;
    }
  }, { passive: false });

  this.viewport.addEventListener('touchmove', function(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      self.onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      var dist = self.getTouchDist(e.touches);
      var scale = dist / self.pinchStartDist;
      var midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      var midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      self.zoom = Math.max(self.minZoom, Math.min(self.maxZoom, self.pinchStartZoom * scale));
    }
  }, { passive: false });

  this.viewport.addEventListener('touchend', function(e) {
    self.onPointerUp();
  });

  // Click
  this.viewport.addEventListener('click', function(e) {
    if (self.wasDragging) return;
    var rect = self.viewport.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var worldX = mx / self.zoom + self.camera.x;
    var worldY = my / self.zoom + self.camera.y;
    var tileX = Math.floor(worldX / self.tileSize);
    var tileY = Math.floor(worldY / self.tileSize);
    if (tileX >= 0 && tileX < self.gridSize && tileY >= 0 && tileY < self.gridSize) {
      self.onTileClick(tileX, tileY);
    }
  });

  window.addEventListener('resize', function() { self.resize(); });
};

GameRenderer.prototype.getTouchDist = function(touches) {
  var dx = touches[0].clientX - touches[1].clientX;
  var dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
};

GameRenderer.prototype.onPointerDown = function(x, y, e) {
  this.isDragging = true;
  this.wasDragging = false;
  this.dragStart = { x: x, y: y };
  this.cameraStart = { x: this.camera.x, y: this.camera.y };
};

GameRenderer.prototype.onPointerMove = function(x, y) {
  if (!this.isDragging) return;
  var dx = x - this.dragStart.x;
  var dy = y - this.dragStart.y;
  if (Math.abs(dx) > 5 || Math.abs(dy) > 5) this.wasDragging = true;
  this.camera.x = this.cameraStart.x - dx / this.zoom;
  this.camera.y = this.cameraStart.y - dy / this.zoom;
};

GameRenderer.prototype.onPointerUp = function() {
  this.isDragging = false;
};

GameRenderer.prototype.zoomAt = function(screenX, screenY, factor) {
  var rect = this.viewport.getBoundingClientRect();
  var mx = screenX - rect.left;
  var my = screenY - rect.top;
  var worldX = mx / this.zoom + this.camera.x;
  var worldY = my / this.zoom + this.camera.y;
  this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
  this.camera.x = worldX - mx / this.zoom;
  this.camera.y = worldY - my / this.zoom;
};

GameRenderer.prototype.onTileClick = function(x, y) {
  if (this.onTileClickCallback) {
    this.onTileClickCallback(x, y);
  }
};

GameRenderer.prototype.setBuildings = function(buildings, config) {
  this.buildings = buildings || [];
  this.buildingTypeConfig = config || {};
};

GameRenderer.prototype.setUnlockedTiles = function(unlockedTiles) {
  this.unlockedTiles = unlockedTiles || {};
};

GameRenderer.prototype.setReadyBuildings = function(readyMap) {
  this.readyBuildings = readyMap || {};
};

GameRenderer.prototype.render = function() {
  var ctx = this.ctx;
  var ts = this.tileSize;
  var cam = this.camera;
  var z = this.zoom;

  ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
  ctx.save();
  ctx.scale(z, z);
  ctx.translate(-cam.x, -cam.y);

  // Visible range
  var startX = Math.max(0, Math.floor(cam.x / ts));
  var startY = Math.max(0, Math.floor(cam.y / ts));
  var endX = Math.min(this.gridSize, Math.ceil((cam.x + this.canvasWidth / z) / ts) + 1);
  var endY = Math.min(this.gridSize, Math.ceil((cam.y + this.canvasHeight / z) / ts) + 1);

  // Draw tiles
  for (var x = startX; x < endX; x++) {
    for (var y = startY; y < endY; y++) {
      var key = x + ',' + y;
      var isUnlocked = this.unlockedTiles[key];
      var px = x * ts;
      var py = y * ts;

      if (isUnlocked) {
        ctx.fillStyle = this.grassPattern[key] || '#2d5a27';
        ctx.fillRect(px, py, ts, ts);
        // Subtle grid
        ctx.strokeStyle = this.gridLineColor;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px, py, ts, ts);
        // Grass detail
        if (Math.random() > 0.97) {
          ctx.fillStyle = 'rgba(85, 239, 196, 0.15)';
          ctx.fillRect(px + 10, py + 20, 3, 8);
        }
      } else {
        ctx.fillStyle = this.lockedColor;
        ctx.fillRect(px, py, ts, ts);
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px, py, ts, ts);
        // Lock icon for edge tiles
        var adjacent = this.unlockedTiles[(x-1)+','+y] || this.unlockedTiles[(x+1)+','+y] ||
                       this.unlockedTiles[x+','+(y-1)] || this.unlockedTiles[x+','+(y+1)];
        if (adjacent) {
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.font = Math.round(ts * 0.3) + 'px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('🔒', px + ts / 2, py + ts / 2);
        }
      }
    }
  }

  // Draw buildings
  for (var i = 0; i < this.buildings.length; i++) {
    var b = this.buildings[i];
    var bx = b.x * ts;
    var by = b.y * ts;
    var bt = this.buildingTypeConfig[b.type];
    var emoji = bt ? bt.emoji : '❓';

    // Building background
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.roundRect(bx + 4, by + 4, ts - 8, ts - 8, 8);
    ctx.fill();

    // Building shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.roundRect(bx + 6, by + 6, ts - 12, ts - 12, 6);
    ctx.fill();

    // Building body
    var readyKey = b.x + ',' + b.y;
    var isReady = this.readyBuildings[readyKey];
    ctx.fillStyle = isReady ? 'rgba(85, 239, 196, 0.25)' : 'rgba(40, 70, 40, 0.7)';
    ctx.beginPath();
    ctx.roundRect(bx + 4, by + 4, ts - 8, ts - 8, 8);
    ctx.fill();

    // Ready glow
    if (isReady) {
      ctx.strokeStyle = 'rgba(85, 239, 196, 0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(bx + 4, by + 4, ts - 8, ts - 8, 8);
      ctx.stroke();
    }

    // Emoji
    var fontSize = Math.round(ts * 0.45);
    ctx.font = fontSize + 'px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, bx + ts / 2, by + ts / 2 - 4);

    // Level badge
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.roundRect(bx + ts - 22, by + ts - 20, 18, 14, 4);
    ctx.fill();
    ctx.fillStyle = '#55efc4';
    ctx.font = 'bold 9px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.fillText(b.level, bx + ts - 13, by + ts - 11);

    // Ready indicator
    if (isReady) {
      ctx.fillStyle = '#55efc4';
      ctx.font = Math.round(ts * 0.22) + 'px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('✅', bx + 14, by + 14);
    }
  }

  // Placing building preview
  if (this.placingBuilding && this.hoverTile) {
    var hx = this.hoverTile.x * ts;
    var hy = this.hoverTile.y * ts;
    var canPlace = this.unlockedTiles[this.hoverTile.x + ',' + this.hoverTile.y] &&
                   !this.buildings.some(function(b) { return b.x === this.hoverTile.x && b.y === this.hoverTile.y; }.bind(this));

    ctx.fillStyle = canPlace ? 'rgba(85, 239, 196, 0.3)' : 'rgba(255, 107, 107, 0.3)';
    ctx.fillRect(hx, hy, ts, ts);
    ctx.strokeStyle = canPlace ? 'rgba(85, 239, 196, 0.8)' : 'rgba(255, 107, 107, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(hx, hy, ts, ts);

    var pbt = this.buildingTypeConfig[this.placingBuilding];
    if (pbt) {
      ctx.font = Math.round(ts * 0.5) + 'px Arial';
      ctx.globalAlpha = 0.7;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pbt.emoji, hx + ts / 2, hy + ts / 2);
      ctx.globalAlpha = 1;
    }
  }

  // Selected tile highlight
  if (this.selectedTile) {
    var sx = this.selectedTile.x * ts;
    var sy = this.selectedTile.y * ts;
    ctx.strokeStyle = this.selectedColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(sx + 1, sy + 1, ts - 2, ts - 2);
  }

  ctx.restore();

  var self = this;
  requestAnimationFrame(function() { self.render(); });
};

// Polyfill roundRect for older browsers
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
    this.moveTo(x + r.tl, y);
    this.lineTo(x + w - r.tr, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r.tr);
    this.lineTo(x + w, y + h - r.br);
    this.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
    this.lineTo(x + r.bl, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r.bl);
    this.lineTo(x, y + r.tl);
    this.quadraticCurveTo(x, y, x + r.tl, y);
    this.closePath();
  };
}