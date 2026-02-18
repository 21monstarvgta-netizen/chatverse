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
  this.placingBuilding = null;
  this.hoverTile = null;

  this.isDragging = false;
  this.wasDragging = false;
  this.dragStart = { x: 0, y: 0 };
  this.cameraStart = { x: 0, y: 0 };

  // Touch pinch
  this.lastTouchDist = 0;
  this.lastTouchMid = { x: 0, y: 0 };
  this.activeTouches = 0;

  // Colors — pre-generate once, never change
  this.grassColors = ['#2d5a27', '#2a5424', '#305e2a', '#28502a', '#336630'];
  this.lockedColor = '#1a1a2e';
  this.gridLineColor = 'rgba(85, 239, 196, 0.08)';
  this.selectedColor = 'rgba(85, 239, 196, 0.4)';

  // Pre-generate grass pattern ONCE
  this.grassMap = {};
  this.grassDetailMap = {};
  for (var gx = 0; gx < this.gridSize; gx++) {
    for (var gy = 0; gy < this.gridSize; gy++) {
      var key = gx + ',' + gy;
      this.grassMap[key] = this.grassColors[(gx * 7 + gy * 13 + gx * gy) % this.grassColors.length];
      // Fixed grass detail positions
      var hash = (gx * 31 + gy * 17) % 100;
      if (hash < 8) {
        this.grassDetailMap[key] = {
          dx: 10 + (hash * 5) % 40,
          dy: 15 + (hash * 3) % 35
        };
      }
    }
  }

  this.readyBuildings = {};
  this.buildingTypeConfig = {};
  this.onTileClickCallback = null;

  this.resize();
  this.setupEvents();
  this.centerCamera();

  // Start render loop
  var self = this;
  this._renderLoop = function() {
    self.render();
    self._rafId = requestAnimationFrame(self._renderLoop);
  };
  this._rafId = requestAnimationFrame(this._renderLoop);
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

  // === MOUSE ===
  this.viewport.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    self.isDragging = true;
    self.wasDragging = false;
    self.dragStart = { x: e.clientX, y: e.clientY };
    self.cameraStart = { x: self.camera.x, y: self.camera.y };
  });

  window.addEventListener('mousemove', function(e) {
    if (!self.isDragging) return;
    var dx = e.clientX - self.dragStart.x;
    var dy = e.clientY - self.dragStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) self.wasDragging = true;
    self.camera.x = self.cameraStart.x - dx / self.zoom;
    self.camera.y = self.cameraStart.y - dy / self.zoom;
  });

  window.addEventListener('mouseup', function() {
    self.isDragging = false;
  });

  // Mouse hover for placing preview
  this.viewport.addEventListener('mousemove', function(e) {
    if (!self.placingBuilding) return;
    var rect = self.viewport.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var worldX = mx / self.zoom + self.camera.x;
    var worldY = my / self.zoom + self.camera.y;
    self.hoverTile = {
      x: Math.floor(worldX / self.tileSize),
      y: Math.floor(worldY / self.tileSize)
    };
  });

  // Mouse wheel zoom
  this.viewport.addEventListener('wheel', function(e) {
    e.preventDefault();
    var factor = e.deltaY > 0 ? 0.9 : 1.1;
    self.zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });

  // Click (only if not dragging)
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
      if (self.onTileClickCallback) self.onTileClickCallback(tileX, tileY);
    }
  });

  // === TOUCH ===
  this.viewport.addEventListener('touchstart', function(e) {
    var touches = e.touches;
    self.activeTouches = touches.length;

    if (touches.length === 1) {
      self.isDragging = true;
      self.wasDragging = false;
      self.dragStart = { x: touches[0].clientX, y: touches[0].clientY };
      self.cameraStart = { x: self.camera.x, y: self.camera.y };
    } else if (touches.length === 2) {
      // Start pinch
      self.isDragging = false;
      self.lastTouchDist = self.getTouchDist(touches[0], touches[1]);
      self.lastTouchMid = self.getTouchMid(touches[0], touches[1]);
      self.cameraStart = { x: self.camera.x, y: self.camera.y };
    }
  }, { passive: true });

  this.viewport.addEventListener('touchmove', function(e) {
    e.preventDefault();
    var touches = e.touches;

    if (touches.length === 1 && self.activeTouches === 1) {
      // Pan
      var dx = touches[0].clientX - self.dragStart.x;
      var dy = touches[0].clientY - self.dragStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) self.wasDragging = true;
      self.camera.x = self.cameraStart.x - dx / self.zoom;
      self.camera.y = self.cameraStart.y - dy / self.zoom;
    } else if (touches.length === 2) {
      // Pinch zoom
      self.wasDragging = true;
      var dist = self.getTouchDist(touches[0], touches[1]);
      var mid = self.getTouchMid(touches[0], touches[1]);

      if (self.lastTouchDist > 0) {
        var scale = dist / self.lastTouchDist;
        var newZoom = Math.max(self.minZoom, Math.min(self.maxZoom, self.zoom * scale));

        // Zoom towards midpoint
        var rect = self.viewport.getBoundingClientRect();
        var mx = mid.x - rect.left;
        var my = mid.y - rect.top;
        var worldX = mx / self.zoom + self.camera.x;
        var worldY = my / self.zoom + self.camera.y;

        self.zoom = newZoom;
        self.camera.x = worldX - mx / self.zoom;
        self.camera.y = worldY - my / self.zoom;
      }

      self.lastTouchDist = dist;
      self.lastTouchMid = mid;
    }
  }, { passive: false });

  this.viewport.addEventListener('touchend', function(e) {
    var wasDrag = self.wasDragging;
    var touchCount = self.activeTouches;

    if (e.touches.length === 0) {
      self.isDragging = false;
      self.activeTouches = 0;
      self.lastTouchDist = 0;

      // Tap detection — only if it was a single finger and not a drag
      if (!wasDrag && touchCount === 1 && e.changedTouches.length === 1) {
        var touch = e.changedTouches[0];
        var rect = self.viewport.getBoundingClientRect();
        var mx = touch.clientX - rect.left;
        var my = touch.clientY - rect.top;
        var worldX = mx / self.zoom + self.camera.x;
        var worldY = my / self.zoom + self.camera.y;
        var tileX = Math.floor(worldX / self.tileSize);
        var tileY = Math.floor(worldY / self.tileSize);
        if (tileX >= 0 && tileX < self.gridSize && tileY >= 0 && tileY < self.gridSize) {
          if (self.onTileClickCallback) self.onTileClickCallback(tileX, tileY);
        }
      }
    } else {
      self.activeTouches = e.touches.length;
      if (e.touches.length === 1) {
        // Went from 2 fingers to 1 — restart drag
        self.isDragging = true;
        self.dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        self.cameraStart = { x: self.camera.x, y: self.camera.y };
      }
    }
  }, { passive: true });

  // Resize
  window.addEventListener('resize', function() { self.resize(); });
};

GameRenderer.prototype.getTouchDist = function(t1, t2) {
  var dx = t1.clientX - t2.clientX;
  var dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
};

GameRenderer.prototype.getTouchMid = function(t1, t2) {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2
  };
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

GameRenderer.prototype.setBuildings = function(buildings, config) {
  this.buildings = buildings || [];
  this.buildingTypeConfig = config || {};
};

GameRenderer.prototype.setUnlockedTiles = function(tiles) {
  this.unlockedTiles = tiles || {};
};

GameRenderer.prototype.setReadyBuildings = function(readyMap) {
  this.readyBuildings = readyMap || {};
};

GameRenderer.prototype.render = function() {
  var ctx = this.ctx;
  var ts = this.tileSize;
  var cam = this.camera;
  var z = this.zoom;
  var w = this.canvasWidth;
  var h = this.canvasHeight;

  // Clear
  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.scale(z, z);
  ctx.translate(-cam.x, -cam.y);

  // Visible tile range
  var startX = Math.max(0, Math.floor(cam.x / ts));
  var startY = Math.max(0, Math.floor(cam.y / ts));
  var endX = Math.min(this.gridSize, Math.ceil((cam.x + w / z) / ts) + 1);
  var endY = Math.min(this.gridSize, Math.ceil((cam.y + h / z) / ts) + 1);

  // === Draw tiles ===
  for (var x = startX; x < endX; x++) {
    for (var y = startY; y < endY; y++) {
      var key = x + ',' + y;
      var px = x * ts;
      var py = y * ts;
      var isUnlocked = !!this.unlockedTiles[key];

      if (isUnlocked) {
        // Grass
        ctx.fillStyle = this.grassMap[key] || '#2d5a27';
        ctx.fillRect(px, py, ts, ts);

        // Grid line
        ctx.strokeStyle = this.gridLineColor;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px, py, ts, ts);

        // Grass detail (fixed position, doesn't flicker)
        var detail = this.grassDetailMap[key];
        if (detail) {
          ctx.fillStyle = 'rgba(85, 239, 196, 0.12)';
          ctx.fillRect(px + detail.dx, py + detail.dy, 3, 7);
          ctx.fillRect(px + detail.dx + 6, py + detail.dy + 3, 2, 5);
        }
      } else {
        // Locked
        ctx.fillStyle = this.lockedColor;
        ctx.fillRect(px, py, ts, ts);
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px, py, ts, ts);

        // Show lock on adjacent tiles
        var hasAdj = this.unlockedTiles[(x-1)+','+y] ||
                     this.unlockedTiles[(x+1)+','+y] ||
                     this.unlockedTiles[x+','+(y-1)] ||
                     this.unlockedTiles[x+','+(y+1)];
        if (hasAdj) {
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(px, py, ts, ts);
          ctx.font = Math.round(ts * 0.3) + 'px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.fillText('🔒', px + ts / 2, py + ts / 2);
        }
      }
    }
  }

  // === Draw buildings ===
  for (var i = 0; i < this.buildings.length; i++) {
    var b = this.buildings[i];
    if (b.x < startX - 1 || b.x > endX || b.y < startY - 1 || b.y > endY) continue;

    var bx = b.x * ts;
    var by = b.y * ts;
    var bt = this.buildingTypeConfig[b.type];
    var emoji = bt ? bt.emoji : '❓';
    var readyKey = b.x + ',' + b.y;
    var isReady = !!this.readyBuildings[readyKey];

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    this.drawRoundRect(ctx, bx + 6, by + 8, ts - 12, ts - 12, 6);
    ctx.fill();

    // Body
    ctx.fillStyle = isReady ? 'rgba(40, 120, 60, 0.8)' : 'rgba(30, 50, 30, 0.75)';
    this.drawRoundRect(ctx, bx + 4, by + 4, ts - 8, ts - 8, 8);
    ctx.fill();

    // Ready glow border
    if (isReady) {
      ctx.strokeStyle = 'rgba(85, 239, 196, 0.7)';
      ctx.lineWidth = 2;
      this.drawRoundRect(ctx, bx + 4, by + 4, ts - 8, ts - 8, 8);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      this.drawRoundRect(ctx, bx + 4, by + 4, ts - 8, ts - 8, 8);
      ctx.stroke();
    }

    // Emoji
    ctx.font = Math.round(ts * 0.42) + 'px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, bx + ts / 2, by + ts / 2 - 3);

    // Level badge
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    this.drawRoundRect(ctx, bx + ts - 23, by + ts - 20, 19, 15, 4);
    ctx.fill();
    ctx.fillStyle = '#55efc4';
    ctx.font = 'bold 9px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('' + b.level, bx + ts - 13, by + ts - 12);

    // Ready checkmark
    if (isReady) {
      ctx.font = Math.round(ts * 0.2) + 'px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✅', bx + 14, by + 14);
    }
  }

  // === Placing preview ===
  if (this.placingBuilding && this.hoverTile) {
    var hx = this.hoverTile.x;
    var hy = this.hoverTile.y;
    if (hx >= 0 && hx < this.gridSize && hy >= 0 && hy < this.gridSize) {
      var hpx = hx * ts;
      var hpy = hy * ts;
      var hKey = hx + ',' + hy;
      var canPlace = !!this.unlockedTiles[hKey];
      // Check occupied
      for (var bi = 0; bi < this.buildings.length; bi++) {
        if (this.buildings[bi].x === hx && this.buildings[bi].y === hy) {
          canPlace = false;
          break;
        }
      }

      ctx.fillStyle = canPlace ? 'rgba(85, 239, 196, 0.3)' : 'rgba(255, 107, 107, 0.3)';
      ctx.fillRect(hpx, hpy, ts, ts);
      ctx.strokeStyle = canPlace ? 'rgba(85, 239, 196, 0.8)' : 'rgba(255, 107, 107, 0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(hpx + 1, hpy + 1, ts - 2, ts - 2);

      var pbt = this.buildingTypeConfig[this.placingBuilding];
      if (pbt) {
        ctx.globalAlpha = 0.6;
        ctx.font = Math.round(ts * 0.45) + 'px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pbt.emoji, hpx + ts / 2, hpy + ts / 2);
        ctx.globalAlpha = 1;
      }
    }
  }

  // === Selected tile highlight ===
  if (this.selectedTile) {
    var sx = this.selectedTile.x * ts;
    var sy = this.selectedTile.y * ts;
    ctx.strokeStyle = this.selectedColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(sx + 1, sy + 1, ts - 2, ts - 2);
  }

  ctx.restore();
};

// Helper: draw rounded rectangle
GameRenderer.prototype.drawRoundRect = function(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};