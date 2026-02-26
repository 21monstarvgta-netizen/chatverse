// ============================================================
//  GameRenderer — 2.5D Isometric (fixed coordinate system)
// ============================================================
//
//  COORDINATE CONVENTIONS (critical — every function must agree):
//
//  gridToScreen(gx, gy) maps grid cell → the TOP VERTEX of the
//  diamond tile (the pointy-top corner):
//
//       top (tx, ty)           ← gridToScreen returns this
//      /            \
//  left              right
//      \            /
//       bottom
//
//  tx = (gx - gy) * tileW/2  + originX
//  ty = (gx + gy) * tileH/2  + originY
//
//  The diamond's four corners relative to (tx, ty):
//    top    = (tx,           ty)
//    right  = (tx + tileW/2, ty + tileH/2)
//    bottom = (tx,           ty + tileH)
//    left   = (tx - tileW/2, ty + tileH/2)
//
//  Center of the tile = (tx, ty + tileH/2)
//
//  Buildings are drawn centred on the tile's visual centre,
//  which sits at (tx + tileW/2, ty + tileH/2) when using the
//  path helper _isoPath that starts from the left corner.
//
//  screenToGrid is the EXACT inverse of gridToScreen.
// ============================================================

var GameRenderer = function(canvas, viewport) {
  this.canvas   = canvas;
  this.ctx      = canvas.getContext('2d');
  this.viewport = viewport;

  this.gridSize       = 40;
  this.initialUnlocked = 10;
  this.tileW     = 96;   // full diamond width  (left→right)
  this.tileH     = 48;   // full diamond height (top→bottom)
  this.tileDepth = 18;   // 2.5D side extrusion (downward)

  this.camera  = { x: 0, y: 0 };
  this.zoom    = 1;
  this.minZoom = 0.18;
  this.maxZoom = 2.5;

  this.buildings        = [];
  this.unlockedTiles    = {};
  this.selectedTile     = null;
  this.placingBuilding  = null;
  this.hoverTile        = null;
  this.readyBuildings   = {};
  this.buildingTypeConfig = {};
  this.onTileClickCallback = null;
  this.threats = [];

  this.isDragging    = false;
  this.wasDragging   = false;
  this.dragStart     = { x: 0, y: 0 };
  this.cameraStart   = { x: 0, y: 0 };
  this.lastTouchDist = 0;
  this.activeTouches = 0;

  this._buildTerrain();
  this._tick = 0;

  this.resize();
  this.setupEvents();
  this.centerCamera();

  var self = this;
  this._renderLoop = function() {
    self._tick++;
    self.render();
    self._rafId = requestAnimationFrame(self._renderLoop);
  };
  this._rafId = requestAnimationFrame(this._renderLoop);
};

// ─── Terrain ─────────────────────────────────────────────────
GameRenderer.prototype._buildTerrain = function() {
  this.terrainMap = {};
  for (var x = 0; x < this.gridSize; x++) {
    for (var y = 0; y < this.gridSize; y++) {
      var h = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100;
      this.terrainMap[x + ',' + y] = h < 54 ? 0 : h < 74 ? 1 : h < 84 ? 2 : h < 93 ? 3 : 4;
    }
  }
};

// ─── Coordinate helpers ──────────────────────────────────────
//
//  gridToScreen returns the TOP VERTEX (north corner) of the tile diamond.
//
GameRenderer.prototype.gridToScreen = function(gx, gy) {
  return {
    x: (gx - gy) * (this.tileW / 2),
    y: (gx + gy) * (this.tileH / 2)
  };
};

//  screenToGrid is the exact inverse.
//  Given a raw screen point (already in world-space after camera/zoom),
//  returns the grid cell that point falls in.
//
GameRenderer.prototype.screenToGrid = function(wx, wy) {
  var tw2 = this.tileW / 2;
  var th2 = this.tileH / 2;
  //  gx - gy = wx / tw2   →  (1)
  //  gx + gy = wy / th2   →  (2)
  //  gx = ((1) + (2)) / 2
  //  gy = ((2) - (1)) / 2
  var sum  = wy / th2;
  var diff = wx / tw2;
  return {
    x: Math.floor((sum + diff) / 2),
    y: Math.floor((sum - diff) / 2)
  };
};

// ─── Resize / center ─────────────────────────────────────────
GameRenderer.prototype.resize = function() {
  var rect = this.viewport.getBoundingClientRect();
  var dpr  = window.devicePixelRatio || 1;
  this.canvas.width        = rect.width  * dpr;
  this.canvas.height       = rect.height * dpr;
  this.canvas.style.width  = rect.width  + 'px';
  this.canvas.style.height = rect.height + 'px';
  this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  this.canvasWidth  = rect.width;
  this.canvasHeight = rect.height;
};

GameRenderer.prototype.centerCamera = function() {
  // Centre on the true middle of the initial unlocked zone.
  // With GRID_SIZE=40 and INITIAL_UNLOCKED=10:
  //   half = 5, center = 20
  //   unlocked tiles: x/y in [15, 19]  →  visual centre = tile 17,17
  var gs   = this.gridSize;
  var half = Math.floor(this.initialUnlocked / 2);   // 5
  var mid  = Math.floor(gs / 2) - Math.floor(half / 2) - 1; // 17 for gs=40, half=5
  var sc   = this.gridToScreen(mid, mid);
  this.camera.x = sc.x - this.canvasWidth  / 2 / this.zoom;
  this.camera.y = (sc.y + this.tileH / 2) - this.canvasHeight / 2 / this.zoom;
};

// Centre on centroid of given buildings array
GameRenderer.prototype.centerOnBuildings = function(buildings) {
  if (!buildings || buildings.length === 0) { this.centerCamera(); return; }
  var sumX = 0, sumY = 0;
  for (var i = 0; i < buildings.length; i++) { sumX += buildings[i].x; sumY += buildings[i].y; }
  var cx = sumX / buildings.length;
  var cy = sumY / buildings.length;
  var sc = this.gridToScreen(cx, cy);
  this.camera.x = sc.x - this.canvasWidth  / 2 / this.zoom;
  this.camera.y = (sc.y + this.tileH / 2) - this.canvasHeight / 2 / this.zoom;
};

// ─── Input ───────────────────────────────────────────────────
GameRenderer.prototype.setupEvents = function() {
  var self = this;

  this.viewport.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    self.isDragging  = true;
    self.wasDragging = false;
    self.dragStart   = { x: e.clientX, y: e.clientY };
    self.cameraStart = { x: self.camera.x, y: self.camera.y };
  });

  window.addEventListener('mousemove', function(e) {
    if (self.isDragging) {
      var dx = e.clientX - self.dragStart.x;
      var dy = e.clientY - self.dragStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) self.wasDragging = true;
      self.camera.x = self.cameraStart.x - dx / self.zoom;
      self.camera.y = self.cameraStart.y - dy / self.zoom;
    }
    var rect = self.viewport.getBoundingClientRect();
    var wx   = (e.clientX - rect.left)  / self.zoom + self.camera.x;
    var wy   = (e.clientY - rect.top)   / self.zoom + self.camera.y;
    self.hoverTile = self.screenToGrid(wx, wy);
  });

  window.addEventListener('mouseup', function(e) {
    if (!self.isDragging) return;
    self.isDragging = false;
    if (!self.wasDragging) {
      var rect = self.viewport.getBoundingClientRect();
      var wx   = (e.clientX - rect.left) / self.zoom + self.camera.x;
      var wy   = (e.clientY - rect.top)  / self.zoom + self.camera.y;
      var g    = self.screenToGrid(wx, wy);
      if (g.x >= 0 && g.x < self.gridSize && g.y >= 0 && g.y < self.gridSize)
        if (self.onTileClickCallback) self.onTileClickCallback(g.x, g.y);
    }
  });

  this.viewport.addEventListener('wheel', function(e) {
    e.preventDefault();
    self.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 0.9);
  }, { passive: false });

  // ── Touch ──
  this.viewport.addEventListener('touchstart', function(e) {
    self.activeTouches = e.touches.length;
    if (e.touches.length === 1) {
      self.isDragging  = true;
      self.wasDragging = false;
      self.dragStart   = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      self.cameraStart = { x: self.camera.x, y: self.camera.y };
    } else if (e.touches.length === 2) {
      self.lastTouchDist = self._touchDist(e.touches[0], e.touches[1]);
      self.wasDragging   = true;
    }
  }, { passive: true });

  this.viewport.addEventListener('touchmove', function(e) {
    e.preventDefault();
    var t = e.touches;
    if (t.length === 1) {
      var dx = t[0].clientX - self.dragStart.x;
      var dy = t[0].clientY - self.dragStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) self.wasDragging = true;
      self.camera.x = self.cameraStart.x - dx / self.zoom;
      self.camera.y = self.cameraStart.y - dy / self.zoom;
    } else if (t.length === 2) {
      self.wasDragging = true;
      var dist = self._touchDist(t[0], t[1]);
      var mid  = self._touchMid(t[0], t[1]);
      if (self.lastTouchDist > 0) {
        var rect  = self.viewport.getBoundingClientRect();
        var mx    = mid.x - rect.left;
        var my    = mid.y - rect.top;
        var wx    = mx / self.zoom + self.camera.x;
        var wy    = my / self.zoom + self.camera.y;
        var newZ  = Math.max(self.minZoom, Math.min(self.maxZoom, self.zoom * dist / self.lastTouchDist));
        self.zoom     = newZ;
        self.camera.x = wx - mx / newZ;
        self.camera.y = wy - my / newZ;
      }
      self.lastTouchDist = dist;
    }
  }, { passive: false });

  this.viewport.addEventListener('touchend', function(e) {
    var wasDrag = self.wasDragging;
    var tc      = self.activeTouches;
    if (e.touches.length === 0) {
      self.isDragging    = false;
      self.activeTouches = 0;
      self.lastTouchDist = 0;
      if (!wasDrag && tc === 1 && e.changedTouches.length === 1) {
        var touch = e.changedTouches[0];
        var rect  = self.viewport.getBoundingClientRect();
        var wx    = (touch.clientX - rect.left) / self.zoom + self.camera.x;
        var wy    = (touch.clientY - rect.top)  / self.zoom + self.camera.y;
        var g     = self.screenToGrid(wx, wy);
        if (g.x >= 0 && g.x < self.gridSize && g.y >= 0 && g.y < self.gridSize)
          if (self.onTileClickCallback) self.onTileClickCallback(g.x, g.y);
      }
    } else {
      self.activeTouches = e.touches.length;
      if (e.touches.length === 1) {
        self.isDragging  = true;
        self.dragStart   = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        self.cameraStart = { x: self.camera.x, y: self.camera.y };
      }
    }
  }, { passive: true });

  window.addEventListener('resize', function() { self.resize(); });
};

GameRenderer.prototype._touchDist = function(a, b) {
  var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
  return Math.sqrt(dx * dx + dy * dy);
};
GameRenderer.prototype._touchMid = function(a, b) {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
};
GameRenderer.prototype.zoomAt = function(sx, sy, f) {
  var rect = this.viewport.getBoundingClientRect();
  var mx = sx - rect.left, my = sy - rect.top;
  var wx = mx / this.zoom + this.camera.x;
  var wy = my / this.zoom + this.camera.y;
  this.zoom     = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * f));
  this.camera.x = wx - mx / this.zoom;
  this.camera.y = wy - my / this.zoom;
};

// ─── Setters ─────────────────────────────────────────────────
GameRenderer.prototype.setBuildings     = function(b, c) { this.buildings = b || []; this.buildingTypeConfig = c || {}; };
GameRenderer.prototype.setUnlockedTiles = function(t)    { this.unlockedTiles = t || {}; };
GameRenderer.prototype.setReadyBuildings= function(r)    { this.readyBuildings = r || {}; };
GameRenderer.prototype.setThreats       = function(t)    { this.threats = t || []; };

// ─── Tile diamond path ───────────────────────────────────────
//
//  IMPORTANT: This draws a diamond whose TOP CORNER is at (tx, ty).
//  Every tile uses this, buildings use the same (tx,ty) reference.
//
//       (tx, ty)           ← top / north
//      /         \
//  (tx-hw, ty+hh)  (tx+hw, ty+hh)   ← left/right / west/east
//      \         /
//       (tx, ty+tileH)    ← bottom / south
//
GameRenderer.prototype._isoPath = function(ctx, tx, ty) {
  var hw = this.tileW / 2;
  var hh = this.tileH / 2;
  ctx.beginPath();
  ctx.moveTo(tx,      ty);          // top
  ctx.lineTo(tx + hw, ty + hh);     // right
  ctx.lineTo(tx,      ty + this.tileH); // bottom
  ctx.lineTo(tx - hw, ty + hh);     // left
  ctx.closePath();
};

// ─── Main render ─────────────────────────────────────────────
GameRenderer.prototype.render = function() {
  var ctx = this.ctx;
  var cam = this.camera, z = this.zoom;
  var W   = this.canvasWidth, H = this.canvasHeight;
  var tick = this._tick;

  // Background
  var sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0d1b2a');
  sky.addColorStop(1, '#1a2f1a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.scale(z, z);
  ctx.translate(-cam.x, -cam.y);

  // ── Visible-cell range ──────────────────────────────────────
  //
  //  Instead of trying to invert the iso projection for the frustum,
  //  we scan ALL grid cells and test whether their screen rect is visible.
  //  This is O(gridSize²) but gridSize is 40 so it's only 1600 cells —
  //  well within budget, and it eliminates all culling bugs.
  //
  var tw  = this.tileW, th = this.tileH, td = this.tileDepth;
  var hw  = tw / 2, hh = th / 2;
  var gs  = this.gridSize;

  // World-space viewport bounds (with a generous margin for buildings)
  var viewL = cam.x - tw;
  var viewT = cam.y - th * 8;    // buildings can be tall
  var viewR = cam.x + W / z + tw;
  var viewB = cam.y + H / z + td + th;

  // Collect visible items in painter order (gx+gy ascending, ties: gy)
  var drawList = [];

  for (var gx = 0; gx < gs; gx++) {
    for (var gy = 0; gy < gs; gy++) {
      // Top corner of this tile in world space
      var sc = this.gridToScreen(gx, gy);
      var tx = sc.x, ty2 = sc.y;

      // Tile bounding box: x in [tx-hw … tx+hw], y in [ty … ty+th+td]
      if (tx + hw < viewL || tx - hw > viewR) continue;
      if (ty2 + th + td < viewT || ty2 > viewB)  continue;

      drawList.push({ kind: 0, gx: gx, gy: gy, tx: tx, ty: ty2, order: gx + gy });
    }
  }

  for (var i = 0; i < this.buildings.length; i++) {
    var b  = this.buildings[i];
    var sc2 = this.gridToScreen(b.x, b.y);
    // buildings extend upward — add a bigger margin
    if (sc2.x + hw < viewL || sc2.x - hw > viewR) continue;
    if (sc2.y + th < viewT - th * 5 || sc2.y > viewB) continue;
    drawList.push({ kind: 1, b: b, tx: sc2.x, ty: sc2.y, order: b.x + b.y + 0.5 });
  }

  for (var ti = 0; ti < this.threats.length; ti++) {
    var th2 = this.threats[ti];
    var sc3 = this.gridToScreen(Math.floor(th2.x), Math.floor(th2.y));
    drawList.push({ kind: 2, th: th2, tx: sc3.x, ty: sc3.y, order: Math.floor(th2.x) + Math.floor(th2.y) + 0.4 });
  }

  // Sort: lower order first; ties broken by gy (tiles before buildings at same sum)
  drawList.sort(function(a, b) {
    var d = a.order - b.order;
    if (d !== 0) return d;
    return (a.gy || 0) - (b.gy || 0);
  });

  for (var di = 0; di < drawList.length; di++) {
    var item = drawList[di];
    if (item.kind === 0)      this._drawTile(ctx, item.gx, item.gy, item.tx, item.ty, tick);
    else if (item.kind === 1) this._drawBuilding(ctx, item.b, item.tx, item.ty, tick);
    else                      this._drawThreat(ctx, item.th, item.tx, item.ty, tick);
  }

  // Placing preview
  if (this.placingBuilding && this.hoverTile) {
    var hx = this.hoverTile.x, hy = this.hoverTile.y;
    if (hx >= 0 && hx < gs && hy >= 0 && hy < gs) {
      var hsc = this.gridToScreen(hx, hy);
      var hKey = hx + ',' + hy;
      var canPlace = !!this.unlockedTiles[hKey];
      for (var bi = 0; bi < this.buildings.length; bi++) {
        if (this.buildings[bi].x === hx && this.buildings[bi].y === hy) { canPlace = false; break; }
      }
      this._drawPlacingPreview(ctx, hsc.x, hsc.y, canPlace, tick);
    }
  }

  // Selected ring
  if (this.selectedTile) {
    var ssc = this.gridToScreen(this.selectedTile.x, this.selectedTile.y);
    this._drawSelectionRing(ctx, ssc.x, ssc.y, tick);
  }

  // Zone preview highlight
  if (this.previewZone) {
    var pz = this.previewZone;
    var pulse = 0.4 + 0.4 * Math.sin(tick * 0.1);
    for (var pzx = pz.x1; pzx <= pz.x2; pzx++) {
      for (var pzy = pz.y1; pzy <= pz.y2; pzy++) {
        var psc = this.gridToScreen(pzx, pzy);
        this._isoPath(ctx, psc.x, psc.y);
        ctx.fillStyle = 'rgba(250,204,21,' + (0.18 + pulse * 0.2) + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(250,204,21,' + (0.7 + pulse * 0.3) + ')';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  ctx.restore();
};

// ─── Draw tile ───────────────────────────────────────────────
//  tx,ty = top corner of the diamond (from gridToScreen)
GameRenderer.prototype._drawTile = function(ctx, gx, gy, tx, ty, tick) {
  var tw = this.tileW, th = this.tileH, td = this.tileDepth;
  var hw = tw / 2, hh = th / 2;
  var key = gx + ',' + gy;
  var isUnlocked = !!this.unlockedTiles[key];

  if (!isUnlocked) {
    this._isoPath(ctx, tx, ty);
    ctx.fillStyle = '#0c1118';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Faint border glow if adjacent to unlocked
    var adj = this.unlockedTiles[(gx-1)+','+gy] || this.unlockedTiles[(gx+1)+','+gy] ||
              this.unlockedTiles[gx+','+(gy-1)]  || this.unlockedTiles[gx+','+(gy+1)];
    if (adj) {
      this._isoPath(ctx, tx, ty);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fill();
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillText('🔒', tx, ty + hh); // centre of diamond
    }
    return;
  }

  var ter = this.terrainMap[key] || 0;

  // Top-face colours  [light, dark]
  var topC = [
    ['#3d7a47','#2d6135'],  // 0 normal grass
    ['#2a5c2e','#1f4822'],  // 1 dark grass
    ['#3d7a47','#4e9459'],  // 2 flower
    ['#515c6e','#3d4756'],  // 3 stone
    ['#2d7a8c','#1e5a6e'],  // 4 water
  ][ter];

  // Top diamond face
  var g = ctx.createLinearGradient(tx, ty, tx, ty + th);
  g.addColorStop(0, topC[0]);
  g.addColorStop(1, topC[1]);
  this._isoPath(ctx, tx, ty);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // 2.5D side faces (only south-west and south-east edges are visible)
  //   SW side: left corner → bottom corner, extruded downward
  //   SE side: bottom corner → right corner, extruded downward
  var lx = tx - hw, ly = ty + hh;  // left corner
  var bx = tx,      by = ty + th;  // bottom corner
  var rx = tx + hw, ry = ty + hh;  // right corner

  // SW face (left side)
  ctx.beginPath();
  ctx.moveTo(lx,      ly);
  ctx.lineTo(bx,      by);
  ctx.lineTo(bx,      by + td);
  ctx.lineTo(lx,      ly + td);
  ctx.closePath();
  ctx.fillStyle = this._shade(topC[1], 0.75);
  ctx.fill();

  // SE face (right side)
  ctx.beginPath();
  ctx.moveTo(bx,      by);
  ctx.lineTo(rx,      ry);
  ctx.lineTo(rx,      ry + td);
  ctx.lineTo(bx,      by + td);
  ctx.closePath();
  ctx.fillStyle = this._shade(topC[1], 0.55);
  ctx.fill();

  // Terrain decoration (in tile centre area)
  var cx = tx, cy = ty + hh; // visual centre
  if (ter === 2) {
    ctx.font = '9px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(((gx * 53 + gy * 37) % 2 === 0) ? '🌸' : '🌼', cx, cy);
  } else if (ter === 3) {
    ctx.fillStyle = 'rgba(130,140,155,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 4, 6, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (ter === 0 || ter === 1) {
    var gh = (gx * 41 + gy * 23) % 30;
    if (gh < 7) {
      ctx.strokeStyle = 'rgba(100,210,100,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - 4, cy + 4); ctx.lineTo(cx - 6, cy - 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 4, cy + 4); ctx.lineTo(cx + 6, cy - 2); ctx.stroke();
    }
  } else if (ter === 4) {
    var ws = (tick * 0.04 + (gx + gy) * 0.4) % 1;
    ctx.strokeStyle = 'rgba(130,220,255,' + (0.25 + ws * 0.4) + ')';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - 10, cy); ctx.lineTo(cx, cy - 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 2,  cy + 3); ctx.lineTo(cx + 12, cy); ctx.stroke();
  }

  // Hover highlight
  if (this.hoverTile && this.hoverTile.x === gx && this.hoverTile.y === gy) {
    this._isoPath(ctx, tx, ty);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fill();
  }
};

GameRenderer.prototype._shade = function(hex, f) {
  var r = parseInt(hex.slice(1,3), 16);
  var g = parseInt(hex.slice(3,5), 16);
  var b = parseInt(hex.slice(5,7), 16);
  return 'rgb(' + Math.round(r*f) + ',' + Math.round(g*f) + ',' + Math.round(b*f) + ')';
};

// ─── Draw building ───────────────────────────────────────────
//  tx,ty = top corner of the diamond (from gridToScreen)
//  Buildings are drawn centred on the tile's visual centre: (tx, ty + tileH/2)
GameRenderer.prototype._drawBuilding = function(ctx, b, tx, ty, tick) {
  var tw = this.tileW, th = this.tileH;
  var cx = tx;                // horizontal centre of tile = tx (top corner x)
  var cy = ty + th / 2;      // vertical centre of tile

  var readyKey = b.x + ',' + b.y;
  var isReady  = !!this.readyBuildings[readyKey];
  var isSel    = this.selectedTile && this.selectedTile.x === b.x && this.selectedTile.y === b.y;

  // Ready glow ring around tile
  if (isReady) {
    var pulse = 0.5 + 0.5 * Math.sin(tick * 0.08);
    ctx.strokeStyle = 'rgba(85,239,196,' + (0.45 + pulse * 0.55) + ')';
    ctx.lineWidth = 2 + pulse;
    this._isoPath(ctx, tx, ty - 2);
    ctx.stroke();
  }

  // Draw the sprite centred on (cx, cy)
  ctx.save();
  ctx.translate(cx, cy);
  this._drawBuildingSprite(ctx, b.type, b.level, tw, th, tick);
  ctx.restore();

  // Level badge — bottom-right of tile
  var bdx = tx + tw * 0.3;
  var bdy = ty + th * 0.85;
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.beginPath();
  ctx.roundRect(bdx - 1, bdy - 1, 26, 14, 4);
  ctx.fill();
  ctx.fillStyle = '#55efc4';
  ctx.font = 'bold 9px Inter,Arial,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Ур.' + b.level, bdx + 12, bdy + 6);

  // Ready check icon — top-left of tile
  if (isReady) {
    ctx.font = '13px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✅', tx - tw * 0.25, ty + th * 0.2);
  }

  // Selection ring
  if (isSel) {
    this._drawSelectionRing(ctx, tx, ty, tick);
  }
};

// ─── Building sprites ────────────────────────────────────────
//  Origin = tile visual centre (cx, cy).
//  All sprites draw around (0, 0), going UPWARD (negative y).
//
GameRenderer.prototype._drawBuildingSprite = function(ctx, type, level, tw, th, tick) {
  // Scale: fit within ~70% of tile width, grow slightly with level
  var s = (tw * 0.70) * Math.min(1 + (level - 1) * 0.04, 1.55);
  ctx.save();
  switch (type) {
    case 'farm':        this._sFarm(ctx, s, level, tick);       break;
    case 'house':       this._sHouse(ctx, s, level, tick);      break;
    case 'quarry':      this._sQuarry(ctx, s, level, tick);     break;
    case 'factory':     this._sFactory(ctx, s, level, tick);    break;
    case 'powerplant':  this._sPowerplant(ctx, s, level, tick); break;
    case 'warehouse':   this._sWarehouse(ctx, s, level, tick);  break;
    case 'market':      this._sMarket(ctx, s, level, tick);     break;
    case 'garden':      this._sGarden(ctx, s, level, tick);     break;
    case 'school':      this._sSchool(ctx, s, level, tick);     break;
    case 'bakery':      this._sBakery(ctx, s, level, tick);     break;
    case 'park':        this._sPark(ctx, s, level, tick);       break;
    case 'bank':        this._sBank(ctx, s, level, tick);       break;
    case 'hospital':    this._sHospital(ctx, s, level, tick);   break;
    case 'library':     this._sLibrary(ctx, s, level, tick);    break;
    case 'stadium':     this._sStadium(ctx, s, level, tick);    break;
    case 'crystalmine': this._sCrystalMine(ctx, s, level, tick);break;
    case 'arcanetower': this._sArcaneTower(ctx, s, level, tick);break;
    default:
      ctx.font = Math.round(s * 0.5) + 'px Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('❓', 0, -s * 0.2);
  }
  ctx.restore();
};

// ── Helpers for sprites ──────────────────────────────────────
// box2d: a simple 2.5D box. x,y = top-left of the FRONT FACE, w=width, h=height, d=depth
GameRenderer.prototype._box = function(ctx, x, y, w, h, topC, frontC, sideC) {
  var d = h * 0.28;
  // top face
  ctx.fillStyle = topC;
  ctx.fillRect(x, y - d, w, d);
  // front face
  ctx.fillStyle = frontC;
  ctx.fillRect(x, y, w, h);
  // right side face
  ctx.beginPath();
  ctx.moveTo(x + w, y - d);
  ctx.lineTo(x + w + d * 0.55, y - d * 0.55);
  ctx.lineTo(x + w + d * 0.55, y + h - d * 0.55);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fillStyle = sideC;
  ctx.fill();
};

GameRenderer.prototype._win = function(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(186,230,253,0.8)';
  ctx.fillRect(x, y, w, h);
};

// ── Sprites (all centred on 0,0, extending upward) ──────────

GameRenderer.prototype._sFarm = function(ctx, s, level, tick) {
  // Soil strip
  ctx.fillStyle = '#5c3317';
  ctx.fillRect(-s * 0.5, -s * 0.06, s, s * 0.1);
  // Crop rows
  var rows = Math.min(3 + Math.floor(level / 3), 8);
  for (var r = 0; r < rows; r++) {
    var rx = -s * 0.44 + r * (s * 0.88 / (rows - 1 || 1));
    var grow = 0.5 + 0.5 * Math.sin(tick * 0.03 + r);
    ctx.strokeStyle = '#4a9e4a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(rx, -s * 0.05); ctx.lineTo(rx, -s * 0.05 - s * 0.3 * grow); ctx.stroke();
    ctx.fillStyle = '#e8b740';
    ctx.beginPath(); ctx.ellipse(rx, -s * 0.05 - s * 0.3 * grow - 3, 3, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Barn
  this._box(ctx, -s * 0.18, -s * 0.46, s * 0.36, s * 0.22, '#a0522d', '#8b4513', '#6b3410');
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.moveTo(-s*0.2,-s*0.46); ctx.lineTo(0,-s*0.68); ctx.lineTo(s*0.2,-s*0.46); ctx.closePath(); ctx.fill();
};

GameRenderer.prototype._sHouse = function(ctx, s, level, tick) {
  var floors = Math.min(1 + Math.floor(level / 7), 4);
  var fh = s * 0.22;
  var cols = ['#d4a97a','#c8885e','#d4a97a','#b87850'];
  for (var f = 0; f < floors; f++) {
    var fy = -f * fh;
    var c = cols[f % 4];
    this._box(ctx, -s*0.36, fy - fh, s*0.72, fh, this._shade(c, 1.15), c, this._shade(c, 0.72));
    this._win(ctx, -s*0.24, fy - fh + 3, s*0.14, s*0.12);
    this._win(ctx, s*0.08, fy - fh + 3, s*0.14, s*0.12);
  }
  // Roof
  var roofY = -floors * fh;
  ctx.fillStyle = '#8b1a1a';
  ctx.beginPath(); ctx.moveTo(-s*0.4, roofY); ctx.lineTo(0, roofY - s*0.28); ctx.lineTo(s*0.4, roofY); ctx.closePath(); ctx.fill();
  // Chimney + smoke
  ctx.fillStyle = '#6d4c41';
  ctx.fillRect(s*0.1, roofY - s*0.3, s*0.08, s*0.18);
  var smk = (tick * 0.5) % 30;
  ctx.strokeStyle = 'rgba(200,200,200,' + (0.55 - smk / 55) + ')';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(s*0.14, roofY - s*0.3 - smk * 0.45, smk * 0.22, 0, Math.PI * 2); ctx.stroke();
};

GameRenderer.prototype._sQuarry = function(ctx, s, level, tick) {
  ctx.fillStyle = '#6b7280';
  ctx.beginPath(); ctx.ellipse(0, 0, s*0.44, s*0.16, 0, 0, Math.PI*2); ctx.fill();
  var rocks = [[-0.14,-0.28,0.17,0.2],[-0.02,-0.44,0.13,0.17],[0.12,-0.3,0.15,0.19]];
  rocks.forEach(function(r) {
    ctx.fillStyle = '#9ca3af';
    ctx.beginPath(); ctx.ellipse(s*r[0],s*r[1],s*r[2],s*r[3],r[0]*0.5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#d1d5db';
    ctx.beginPath(); ctx.ellipse(s*r[0]-2,s*r[1]-2,s*r[2]*0.38,s*r[3]*0.3,0,0,Math.PI*2); ctx.fill();
  });
  var sw = Math.sin(tick * 0.12) * 0.32;
  ctx.save(); ctx.translate(s*0.2,-s*0.34); ctx.rotate(sw);
  ctx.strokeStyle = '#92400e'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,s*0.22); ctx.stroke();
  ctx.fillStyle = '#718096'; ctx.fillRect(-4,0,8,6); ctx.restore();
};

GameRenderer.prototype._sFactory = function(ctx, s, level, tick) {
  this._box(ctx,-s*0.42,-s*0.5,s*0.84,s*0.5,'#94a3b8','#64748b','#475569');
  var nc = Math.min(2+Math.floor(level/4),5);
  for (var ci = 0; ci < nc; ci++) {
    var cx2 = -s*0.34+ci*(s*0.68/(nc-1||1));
    ctx.fillStyle='#4b5563'; ctx.fillRect(cx2-4,-s*0.72,8,s*0.24);
    var off=(tick*0.8+ci*15)%40;
    ctx.strokeStyle='rgba(180,180,180,'+(0.6-off/62)+')'; ctx.lineWidth=4-off/14;
    ctx.beginPath(); ctx.moveTo(cx2,-s*0.72); ctx.bezierCurveTo(cx2+6,-s*0.72-off*0.4,cx2-4,-s*0.72-off*0.6,cx2,-s*0.72-off*0.82); ctx.stroke();
  }
  ctx.fillStyle='rgba(255,200,50,0.65)';
  for (var wi=0;wi<3;wi++) ctx.fillRect(-s*0.32+wi*s*0.24,-s*0.42,s*0.14,s*0.14);
};

GameRenderer.prototype._sPowerplant = function(ctx, s, level, tick) {
  ctx.fillStyle='#94a3b8'; ctx.beginPath();
  ctx.moveTo(-s*0.28,0); ctx.quadraticCurveTo(-s*0.4,-s*0.3,-s*0.2,-s*0.62); ctx.lineTo(s*0.2,-s*0.62);
  ctx.quadraticCurveTo(s*0.4,-s*0.3,s*0.28,0); ctx.closePath(); ctx.fill();
  var st=(tick*0.6)%38;
  ctx.strokeStyle='rgba(230,230,230,'+(0.55-st/65)+')'; ctx.lineWidth=5;
  ctx.beginPath(); ctx.arc(0,-s*0.62-st*0.42,st*0.22,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle='#fbbf24'; ctx.beginPath();
  ctx.moveTo(s*0.04,-s*0.45); ctx.lineTo(-s*0.04,-s*0.28); ctx.lineTo(s*0.02,-s*0.28); ctx.lineTo(-s*0.05,-s*0.1);
  ctx.lineTo(s*0.1,-s*0.3); ctx.lineTo(s*0.02,-s*0.3); ctx.closePath(); ctx.fill();
};

GameRenderer.prototype._sWarehouse = function(ctx, s, level, tick) {
  this._box(ctx,-s*0.46,-s*0.38,s*0.92,s*0.38,'#b45309','#92400e','#78350f');
  ctx.fillStyle='#6b7280'; ctx.beginPath(); ctx.ellipse(0,-s*0.38,s*0.48,s*0.2,0,Math.PI,0); ctx.fill();
  ctx.fillStyle='#451a03'; ctx.beginPath(); ctx.arc(0,-s*0.13,s*0.16,Math.PI,0); ctx.rect(-s*0.16,-s*0.13,s*0.32,s*0.13); ctx.fill();
};

GameRenderer.prototype._sMarket = function(ctx, s, level, tick) {
  this._box(ctx,-s*0.38,-s*0.42,s*0.76,s*0.42,'#fde68a','#fbbf24','#f59e0b');
  ctx.fillStyle='#dc2626'; ctx.beginPath(); ctx.moveTo(-s*0.42,-s*0.42);
  for (var aw=0;aw<5;aw++){var awx=-s*0.42+aw*s*0.84/4; ctx.lineTo(awx+s*0.1,-s*0.51); ctx.lineTo(awx+s*0.21,-s*0.42);}
  ctx.closePath(); ctx.fill();
  ctx.font='10px Arial'; ctx.textAlign='center';
  ctx.fillText('🍎',-s*0.18,-s*0.22+Math.sin(tick*0.05)*2);
  ctx.fillText('🥕',s*0.1,-s*0.22+Math.sin(tick*0.05+1)*2);
};

GameRenderer.prototype._sGarden = function(ctx, s, level, tick) {
  for(var f=-3;f<=3;f++){ctx.fillStyle='#d4a574'; ctx.fillRect(f*s*0.13-2,-s*0.1,4,s*0.14);}
  ctx.fillStyle='#d4a574'; ctx.fillRect(-s*0.42,-s*0.04,s*0.84,3);
  var nt=Math.min(1+Math.floor(level/3),5);
  for(var t=0;t<nt;t++){
    var tx=-s*0.28+t*(s*0.56/(nt-1||1)), sw=Math.sin(tick*0.04+t)*2;
    ctx.fillStyle='#166534'; ctx.beginPath(); ctx.arc(tx+sw,-s*0.38,s*0.13,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#15803d'; ctx.beginPath(); ctx.arc(tx+sw,-s*0.5,s*0.1,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#8b5cf6'; ctx.beginPath(); ctx.arc(tx+sw,-s*0.58,s*0.07,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#92400e'; ctx.fillRect(tx-2,-s*0.26,4,s*0.14);
  }
};

GameRenderer.prototype._sSchool = function(ctx, s, level, tick) {
  this._box(ctx,-s*0.44,-s*0.54,s*0.88,s*0.54,'#fef9c3','#fef3c7','#fde68a');
  ctx.fillStyle='#e5e7eb'; for(var c=0;c<4;c++) ctx.fillRect(-s*0.36+c*s*0.24,-s*0.48,7,s*0.36);
  ctx.strokeStyle='#9ca3af'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(0,-s*0.54); ctx.lineTo(0,-s*0.82); ctx.stroke();
  var fw=Math.sin(tick*0.1)*4;
  ctx.fillStyle='#ef4444'; ctx.beginPath(); ctx.moveTo(0,-s*0.82); ctx.lineTo(s*0.2+fw,-s*0.74); ctx.lineTo(0,-s*0.66); ctx.closePath(); ctx.fill();
  ctx.fillStyle='rgba(186,230,253,.8)';
  [[-s*0.26,-s*0.44],[s*0.08,-s*0.44],[-s*0.26,-s*0.3],[s*0.08,-s*0.3]].forEach(function(w){ctx.fillRect(w[0],w[1],s*0.16,s*0.1);});
};

GameRenderer.prototype._sBakery = function(ctx, s, level, tick) {
  this._box(ctx,-s*0.32,-s*0.44,s*0.64,s*0.44,'#fde68a','#f59e0b','#d97706');
  ctx.fillStyle='#78350f'; ctx.fillRect(s*0.1,-s*0.5,s*0.1,s*0.1);
  var ar=(tick*0.5)%26; ctx.strokeStyle='rgba(255,190,80,'+(0.8-ar/26)+')'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(s*0.15,-s*0.5-ar*0.36,ar*0.2,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle='#7c2d12'; ctx.fillRect(-s*0.22,-s*0.56,s*0.44,s*0.1);
  ctx.fillStyle='#fef3c7'; ctx.font='bold 7px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('ПЕКАРНЯ',0,-s*0.51);
};

GameRenderer.prototype._sPark = function(ctx, s, level, tick) {
  ctx.fillStyle='#0ea5e9'; ctx.beginPath(); ctx.ellipse(0,-s*0.06,s*0.22,s*0.1,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#38bdf8'; ctx.lineWidth=1; ctx.beginPath(); ctx.ellipse(0,-s*0.06,s*0.22,s*0.1,0,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle='#d4a574'; ctx.fillRect(-3,-s*0.18,6,s*0.34); ctx.fillRect(-s*0.34,-3,s*0.68,6);
  [[-s*0.3,-s*0.36],[s*0.3,-s*0.36],[-s*0.3,s*0.1],[s*0.3,s*0.1]].forEach(function(pt,i){
    var sw=Math.sin(tick*0.04+i)*2;
    ctx.fillStyle='#166534'; ctx.beginPath(); ctx.arc(pt[0]+sw,pt[1],s*0.13,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#92400e'; ctx.fillRect(pt[0]-2,pt[1]+s*0.11,4,s*0.11);
  });
  var ang=tick*0.02;
  ctx.strokeStyle='#6b7280'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,-s*0.52,s*0.18,0,Math.PI*2); ctx.stroke();
  for(var sp=0;sp<6;sp++){
    var a=ang+sp*Math.PI/3;
    ctx.beginPath(); ctx.moveTo(0,-s*0.52); ctx.lineTo(Math.cos(a)*s*0.18,-s*0.52+Math.sin(a)*s*0.18); ctx.stroke();
    ctx.fillStyle='#f87171'; ctx.fillRect(Math.cos(a)*s*0.18-3,-s*0.52+Math.sin(a)*s*0.18-3,6,6);
  }
};

GameRenderer.prototype._sBank = function(ctx, s, level, tick) {
  this._box(ctx,-s*0.44,-s*0.64,s*0.88,s*0.64,'#f8fafc','#e2e8f0','#cbd5e1');
  ctx.fillStyle='#94a3b8'; for(var p=0;p<5;p++) ctx.fillRect(-s*0.38+p*s*0.19,-s*0.56,7,s*0.44);
  ctx.fillStyle='#e2e8f0'; ctx.beginPath(); ctx.moveTo(-s*0.46,-s*0.64); ctx.lineTo(0,-s*0.88); ctx.lineTo(s*0.46,-s*0.64); ctx.closePath(); ctx.fill();
  var gl=0.7+0.3*Math.sin(tick*0.08);
  ctx.fillStyle='rgba(250,204,21,'+gl+')'; ctx.font='bold 18px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('$',0,-s*0.36);
};

GameRenderer.prototype._sHospital = function(ctx, s, level, tick) {
  this._box(ctx,-s*0.4,-s*0.6,s*0.8,s*0.6,'#f0fdf4','#dcfce7','#bbf7d0');
  ctx.fillStyle='#ef4444'; ctx.fillRect(-s*0.04,-s*0.5,s*0.08,s*0.22); ctx.fillRect(-s*0.12,-s*0.42,s*0.24,s*0.08);
  var lo=Math.floor(tick/30)%2===0;
  ctx.fillStyle=lo?'rgba(255,250,150,.9)':'rgba(186,230,253,.7)';
  [[-s*0.28,-s*0.5],[-s*0.28,-s*0.36],[s*0.16,-s*0.5],[s*0.16,-s*0.36]].forEach(function(w){ctx.fillRect(w[0],w[1],s*0.1,s*0.1);});
  ctx.strokeStyle='#22c55e'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,-s*0.64,s*0.12,0,Math.PI*2); ctx.stroke();
  ctx.font='bold 10px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#22c55e'; ctx.fillText('H',0,-s*0.64);
};

GameRenderer.prototype._sLibrary = function(ctx, s, level, tick) {
  this._box(ctx,-s*0.42,-s*0.58,s*0.84,s*0.58,'#fef3c7','#fde68a','#f59e0b');
  [[-s*0.3,-s*0.5],[-s*0.08,-s*0.5],[s*0.14,-s*0.5]].forEach(function(w){
    ctx.fillStyle='rgba(186,230,253,.8)'; ctx.beginPath(); ctx.arc(w[0]+s*0.07,w[1],s*0.08,Math.PI,0); ctx.rect(w[0],w[1],s*0.14,s*0.12); ctx.fill();
  });
  var by=s*0.12*Math.abs(Math.sin(tick*0.04));
  ctx.font='12px Arial'; ctx.textAlign='center'; ctx.fillText('📚',0,-s*0.68-by);
};

GameRenderer.prototype._sStadium = function(ctx, s, level, tick) {
  ctx.fillStyle='#374151'; ctx.beginPath(); ctx.ellipse(0,-s*0.18,s*0.46,s*0.26,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#4b5563'; ctx.beginPath(); ctx.ellipse(0,-s*0.18,s*0.35,s*0.18,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#15803d'; ctx.beginPath(); ctx.ellipse(0,-s*0.18,s*0.26,s*0.12,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.beginPath(); ctx.ellipse(0,-s*0.18,s*0.1,s*0.06,0,0,Math.PI*2); ctx.stroke();
  [[-s*0.44,-s*0.54],[s*0.44,-s*0.54]].forEach(function(l){
    ctx.fillStyle='#9ca3af'; ctx.fillRect(l[0]-2,l[1],4,s*0.38);
    var lg=0.6+0.4*Math.sin(tick*0.1);
    ctx.fillStyle='rgba(255,250,150,'+lg+')'; ctx.beginPath(); ctx.arc(l[0],l[1],8,0,Math.PI*2); ctx.fill();
  });
  if(Math.floor(tick/20)%3===0){ctx.font='9px Arial'; ctx.textAlign='center'; ctx.fillText('🎉',s*Math.sin(tick*0.15)*0.2,-s*0.48);}
};

GameRenderer.prototype._sCrystalMine = function(ctx, s, level, tick) {
  // Mine entrance arch
  ctx.fillStyle='#374151'; ctx.beginPath(); ctx.arc(0,-s*0.2,s*0.28,Math.PI,0); ctx.rect(-s*0.28,-s*0.2,s*0.56,s*0.22); ctx.fill();
  ctx.fillStyle='#1f2937'; ctx.beginPath(); ctx.arc(0,-s*0.2,s*0.2,Math.PI,0); ctx.rect(-s*0.2,-s*0.2,s*0.4,s*0.2); ctx.fill();
  // Crystals
  var cp=0.8+0.2*Math.sin(tick*0.1);
  [[-.18,-.52,.09],[-.04,-.65,.12],[.14,-.55,.1]].forEach(function(c,i){
    var pha=tick*0.08+i*0.8;
    ctx.save(); ctx.translate(s*c[0],s*c[1]); ctx.rotate(Math.sin(pha)*0.05);
    ctx.shadowColor='#a78bfa'; ctx.shadowBlur=8*cp;
    ctx.fillStyle='#8b5cf6'; ctx.beginPath();
    ctx.moveTo(0,-s*c[2]*1.4); ctx.lineTo(s*c[2]*0.5,0); ctx.lineTo(0,s*c[2]*0.5); ctx.lineTo(-s*c[2]*0.5,0); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#c4b5fd'; ctx.beginPath(); ctx.moveTo(0,-s*c[2]*1.4); ctx.lineTo(s*c[2]*0.2,0); ctx.lineTo(0,-s*c[2]*0.5); ctx.closePath(); ctx.fill();
    ctx.shadowBlur=0; ctx.restore();
  });
};

GameRenderer.prototype._sArcaneTower = function(ctx, s, level, tick) {
  this._box(ctx,-s*0.22,-s*0.18,s*0.44,s*0.18,'#4c1d95','#6d28d9','#5b21b6');
  ctx.fillStyle='#7c3aed'; ctx.beginPath();
  ctx.moveTo(-s*0.22,-s*0.18); ctx.lineTo(-s*0.15,-s*0.76); ctx.lineTo(s*0.15,-s*0.76); ctx.lineTo(s*0.22,-s*0.18); ctx.closePath(); ctx.fill();
  var op=0.5+0.5*Math.sin(tick*0.1);
  ctx.shadowColor='#c4b5fd'; ctx.shadowBlur=16*op;
  ctx.fillStyle='#a78bfa'; ctx.beginPath(); ctx.arc(0,-s*0.84,s*0.12,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#ede9fe'; ctx.beginPath(); ctx.arc(-s*0.04,-s*0.88,s*0.05,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;
  for(var op2=0;op2<3;op2++){
    var oa=tick*0.1+op2*Math.PI*2/3;
    ctx.fillStyle='rgba(196,181,253,.85)'; ctx.beginPath(); ctx.arc(Math.cos(oa)*s*0.22,-s*0.84+Math.sin(oa)*s*0.1,3,0,Math.PI*2); ctx.fill();
  }
};

// ─── Threat drawing ──────────────────────────────────────────
//  tx,ty = top corner of the tile
GameRenderer.prototype._drawThreat = function(ctx, threat, tx, ty, tick) {
  var tw = this.tileW, th = this.tileH;
  var cx = tx;            // horizontal centre
  var cy = ty + th / 2;  // vertical centre

  var bob   = Math.sin(tick * 0.1) * 4;
  var pulse = 0.7 + 0.3 * Math.sin(tick * 0.15);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(cx, cy + 6, 18, 7, 0, 0, Math.PI * 2); ctx.fill();

  // Pulsing ring
  ctx.strokeStyle = 'rgba(239,68,68,' + pulse + ')';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy - 8 + bob, 24, 0, Math.PI * 2); ctx.stroke();

  // Sprite
  ctx.font = '26px Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(threat.emoji || '👾', cx, cy - 10 + bob);

  // HP bar
  var bw = 40, bh = 6;
  var hp = Math.max(0, Math.min(1, (threat.hp / threat.maxHp) || 0));
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(cx - bw/2 - 1, cy - 38 + bob, bw + 2, bh + 2);
  ctx.fillStyle = hp > 0.5 ? '#22c55e' : hp > 0.25 ? '#f59e0b' : '#ef4444';
  ctx.fillRect(cx - bw/2, cy - 37 + bob, bw * hp, bh);

  // Name tag
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.beginPath(); ctx.roundRect(cx - 30, cy - 51 + bob, 60, 12, 4); ctx.fill();
  ctx.fillStyle = '#fef2f2'; ctx.font = 'bold 8px Inter,Arial,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(threat.name || 'Враг', cx, cy - 45 + bob);
};

// ─── Placing preview ─────────────────────────────────────────
GameRenderer.prototype._drawPlacingPreview = function(ctx, tx, ty, canPlace, tick) {
  var pulse = 0.5 + 0.5 * Math.sin(tick * 0.12);
  this._isoPath(ctx, tx, ty);
  ctx.fillStyle = canPlace
    ? 'rgba(85,239,196,' + (0.18 + pulse * 0.2) + ')'
    : 'rgba(255,107,107,0.3)';
  ctx.fill();
  ctx.strokeStyle = canPlace
    ? ('rgba(85,239,196,' + (0.7 + pulse * 0.3) + ')')
    : 'rgba(255,107,107,0.85)';
  ctx.lineWidth = 2; ctx.stroke();
};

// ─── Selection ring ──────────────────────────────────────────
GameRenderer.prototype._drawSelectionRing = function(ctx, tx, ty, tick) {
  var pulse = 0.5 + 0.5 * Math.sin(tick * 0.1);
  ctx.strokeStyle = 'rgba(85,239,196,' + (0.55 + pulse * 0.45) + ')';
  ctx.lineWidth = 2 + pulse;
  this._isoPath(ctx, tx, ty - 2);
  ctx.stroke();
};

// ─── roundRect polyfill ──────────────────────────────────────
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
    this.beginPath();
    this.moveTo(x+r,y); this.lineTo(x+w-r,y);
    this.quadraticCurveTo(x+w,y,x+w,y+r); this.lineTo(x+w,y+h-r);
    this.quadraticCurveTo(x+w,y+h,x+w-r,y+h); this.lineTo(x+r,y+h);
    this.quadraticCurveTo(x,y+h,x,y+h-r); this.lineTo(x,y+r);
    this.quadraticCurveTo(x,y,x+r,y); this.closePath();
  };
}
