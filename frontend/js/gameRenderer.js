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

// Gradient helper
GameRenderer.prototype._grad = function(ctx, x1, y1, x2, y2, stops) {
  var g = ctx.createLinearGradient(x1, y1, x2, y2);
  stops.forEach(function(s) { g.addColorStop(s[0], s[1]); });
  return g;
};

// Radial gradient helper
GameRenderer.prototype._radgrad = function(ctx, x, y, r1, r2, stops) {
  var g = ctx.createRadialGradient(x, y, r1, x, y, r2);
  stops.forEach(function(s) { g.addColorStop(s[0], s[1]); });
  return g;
};

// Detailed isometric box with gradient faces
GameRenderer.prototype._isoBox = function(ctx, x, y, w, h, hue, sat, lit) {
  var d = h * 0.32;
  // Top face - gradient
  var tg = ctx.createLinearGradient(x, y-d, x+w, y);
  tg.addColorStop(0, 'hsl('+hue+','+sat+'%,'+(lit+12)+'%)');
  tg.addColorStop(1, 'hsl('+hue+','+sat+'%,'+(lit+4)+'%)');
  ctx.fillStyle = tg;
  ctx.fillRect(x, y - d, w, d);
  // Front face - gradient
  var fg = ctx.createLinearGradient(x, y, x, y+h);
  fg.addColorStop(0, 'hsl('+hue+','+sat+'%,'+lit+'%)');
  fg.addColorStop(1, 'hsl('+hue+','+sat+'%,'+(lit-8)+'%)');
  ctx.fillStyle = fg;
  ctx.fillRect(x, y, w, h);
  // Right side face
  ctx.beginPath();
  ctx.moveTo(x+w, y-d);
  ctx.lineTo(x+w+d*0.6, y-d*0.6);
  ctx.lineTo(x+w+d*0.6, y+h-d*0.6);
  ctx.lineTo(x+w, y+h);
  ctx.closePath();
  var sg = ctx.createLinearGradient(x+w, y, x+w+d*0.6, y+h);
  sg.addColorStop(0, 'hsl('+hue+','+sat+'%,'+(lit-14)+'%)');
  sg.addColorStop(1, 'hsl('+hue+','+sat+'%,'+(lit-22)+'%)');
  ctx.fillStyle = sg;
  ctx.fill();
  // Edge highlight on top-left
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y-d); ctx.lineTo(x+w, y-d); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y-d); ctx.lineTo(x, y+h); ctx.stroke();
};

// Window with glow effect
GameRenderer.prototype._isoWin = function(ctx, x, y, w, h, lit, tick) {
  var on = lit || Math.floor(tick / 40) % 2 === 0;
  if (on) {
    ctx.shadowColor = '#fde68a'; ctx.shadowBlur = 6;
    ctx.fillStyle = '#fef3c7';
  } else {
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(186,230,253,0.7)';
  }
  ctx.fillRect(x, y, w, h);
  // Frame
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, w, h);
  // Cross divider
  ctx.beginPath();
  ctx.moveTo(x + w/2, y); ctx.lineTo(x + w/2, y + h);
  ctx.moveTo(x, y + h/2); ctx.lineTo(x + w, y + h/2);
  ctx.stroke();
  ctx.shadowBlur = 0;
};

// Smoke particle
GameRenderer.prototype._smoke = function(ctx, x, y, tick, offset, color) {
  var t = (tick * 0.5 + offset) % 50;
  var alpha = Math.max(0, 0.6 - t / 50);
  var spread = t * 0.3;
  ctx.strokeStyle = color || ('rgba(180,180,180,' + alpha + ')');
  ctx.lineWidth = Math.max(1, 4 - t * 0.06);
  ctx.beginPath();
  ctx.arc(x + Math.sin(t * 0.3) * spread, y - t * 0.7, spread * 0.5 + 2, 0, Math.PI * 2);
  ctx.stroke();
};

// Roof triangle
GameRenderer.prototype._roof = function(ctx, x, y, w, h, col1, col2) {
  var g = ctx.createLinearGradient(x, y - h, x + w, y);
  g.addColorStop(0, col1);
  g.addColorStop(1, col2);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w/2, y - h);
  ctx.lineTo(x + w, y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
};

// ── FARM ─────────────────────────────────────────────────────
GameRenderer.prototype._sFarm = function(ctx, s, level, tick) {
  // Ground / soil patches
  var sg = ctx.createLinearGradient(-s*0.5, -s*0.08, s*0.5, 0);
  sg.addColorStop(0, '#3d2008'); sg.addColorStop(1, '#5c3317');
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.ellipse(0, -s*0.02, s*0.48, s*0.12, 0, 0, Math.PI*2); ctx.fill();

  // Crop rows with animated wheat
  var rows = Math.min(3 + Math.floor(level / 2), 9);
  for (var r = 0; r < rows; r++) {
    var rx = -s*0.42 + r * (s*0.84 / (rows-1||1));
    var sway = Math.sin(tick * 0.035 + r * 0.7) * 2.5;
    var height = s * (0.22 + 0.1 * Math.sin(tick * 0.02 + r));
    // Stem
    ctx.strokeStyle = '#5a8a2a';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(rx, -s*0.06); ctx.lineTo(rx + sway, -s*0.06 - height); ctx.stroke();
    // Leaves
    ctx.strokeStyle = '#6aaa30';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(rx, -s*0.06 - height*0.4);
    ctx.quadraticCurveTo(rx + 8 + sway, -s*0.06 - height*0.35, rx + 12, -s*0.06 - height*0.25);
    ctx.stroke();
    // Wheat head
    var wg = ctx.createLinearGradient(rx, -s*0.06-height, rx, -s*0.06-height-8);
    wg.addColorStop(0, '#e8b740'); wg.addColorStop(1, '#f4d03f');
    ctx.fillStyle = wg;
    ctx.beginPath(); ctx.ellipse(rx + sway, -s*0.06 - height - 5, 3, 7, sway*0.1, 0, Math.PI*2); ctx.fill();
  }

  // Barn - detailed
  this._isoBox(ctx, -s*0.2, -s*0.46, s*0.4, s*0.28, 25, 65, 35);
  // Barn roof
  this._roof(ctx, -s*0.24, -s*0.46, s*0.48, s*0.22, '#c0392b', '#922b21');
  // Barn door
  ctx.fillStyle = '#4a2800';
  ctx.fillRect(-s*0.07, -s*0.38, s*0.14, s*0.2);
  ctx.strokeStyle = '#6b3c10'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(0, -s*0.38); ctx.lineTo(0, -s*0.18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.07, -s*0.28); ctx.lineTo(0, -s*0.28); ctx.stroke();
  // Barn X detail
  ctx.strokeStyle = '#7d4a1e'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-s*0.16, -s*0.44); ctx.lineTo(s*0.16, -s*0.18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.16, -s*0.44); ctx.lineTo(-s*0.16, -s*0.18); ctx.stroke();
  // Weathervane
  ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -s*0.68); ctx.lineTo(0, -s*0.76); ctx.stroke();
  var wv = tick * 0.02;
  ctx.fillStyle = '#aaa';
  ctx.beginPath(); ctx.moveTo(Math.cos(wv)*8, -s*0.76+Math.sin(wv)*4);
  ctx.lineTo(0, -s*0.76); ctx.lineTo(Math.cos(wv+Math.PI)*5, -s*0.76+Math.sin(wv+Math.PI)*2);
  ctx.closePath(); ctx.fill();
};

// ── HOUSE ────────────────────────────────────────────────────
GameRenderer.prototype._sHouse = function(ctx, s, level, tick) {
  var floors = Math.min(1 + Math.floor(level / 6), 4);
  var fh = s * 0.24;
  var wallHues = [30, 28, 32, 27];
  for (var f = 0; f < floors; f++) {
    var fy = -f * fh;
    var h = wallHues[f % 4];
    this._isoBox(ctx, -s*0.38, fy - fh, s*0.76, fh, h, 50, 50);
    // Windows
    this._isoWin(ctx, -s*0.28, fy - fh + s*0.04, s*0.14, s*0.12, false, tick);
    this._isoWin(ctx, s*0.06, fy - fh + s*0.04, s*0.14, s*0.12, f===0, tick);
    if (f > 1) this._isoWin(ctx, -s*0.1, fy - fh + s*0.04, s*0.12, s*0.1, false, tick);
  }
  // Foundation
  ctx.fillStyle = '#5a4a3a'; ctx.fillRect(-s*0.4, 0, s*0.8, s*0.04);
  // Roof
  var ry = -floors * fh;
  this._roof(ctx, -s*0.42, ry, s*0.84, s*0.32, '#8b1a1a', '#5a1111');
  // Dormer window in roof
  if (floors >= 2) {
    this._isoBox(ctx, -s*0.1, ry - s*0.22, s*0.2, s*0.14, 30, 50, 48);
    this._roof(ctx, -s*0.13, ry - s*0.22, s*0.26, s*0.1, '#8b1a1a', '#5a1111');
  }
  // Chimney
  ctx.fillStyle = '#6d4c41'; ctx.fillRect(s*0.1, ry - s*0.36, s*0.1, s*0.22);
  ctx.fillStyle = '#5d3c31'; ctx.fillRect(s*0.08, ry - s*0.38, s*0.14, s*0.04);
  // Smoke
  this._smoke(ctx, s*0.15, ry - s*0.36, tick, 0);
  this._smoke(ctx, s*0.15, ry - s*0.36, tick, 18);
  // Door
  ctx.fillStyle = '#4a2800';
  ctx.beginPath(); ctx.roundRect(-s*0.08, -s*0.22, s*0.16, s*0.22, [4, 4, 0, 0]); ctx.fill();
  ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(-s*0.02, -s*0.11, 2, 0, Math.PI*2); ctx.fill();
};

// ── QUARRY ───────────────────────────────────────────────────
GameRenderer.prototype._sQuarry = function(ctx, s, level, tick) {
  // Pit
  var pg = ctx.createRadialGradient(0, -s*0.04, s*0.1, 0, -s*0.04, s*0.44);
  pg.addColorStop(0, '#374151'); pg.addColorStop(1, '#6b7280');
  ctx.fillStyle = pg;
  ctx.beginPath(); ctx.ellipse(0, -s*0.04, s*0.44, s*0.16, 0, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(0, -s*0.04, s*0.44, s*0.16, 0, 0, Math.PI*2); ctx.stroke();

  // Rock formations
  var rocks = [
    [-0.16,-0.32, 0.18,0.22, 15],
    [-0.04,-0.50, 0.14,0.19, 10],
    [ 0.14,-0.34, 0.16,0.20, -8]
  ];
  rocks.forEach(function(r, i) {
    var rg = ctx.createLinearGradient(s*r[0], s*r[1]-s*r[3], s*r[0]+s*r[2], s*r[1]);
    rg.addColorStop(0, '#d1d5db'); rg.addColorStop(0.5, '#9ca3af'); rg.addColorStop(1, '#6b7280');
    ctx.fillStyle = rg;
    ctx.save(); ctx.rotate(r[4] * Math.PI/180);
    ctx.beginPath(); ctx.ellipse(s*r[0], s*r[1], s*r[2], s*r[3], 0, 0, Math.PI*2); ctx.fill();
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.ellipse(s*r[0]-s*r[2]*0.25, s*r[1]-s*r[3]*0.3, s*r[2]*0.35, s*r[3]*0.28, 0, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    // Crack lines
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(s*r[0]-4, s*r[1]-8); ctx.lineTo(s*r[0]+2, s*r[1]+2); ctx.stroke();
  });

  // Crane/pickaxe animation
  var sw2 = Math.sin(tick * 0.12) * 0.35;
  ctx.save(); ctx.translate(s*0.22, -s*0.36); ctx.rotate(sw2);
  // Handle
  var hg = ctx.createLinearGradient(0, 0, 0, s*0.28);
  hg.addColorStop(0, '#92400e'); hg.addColorStop(1, '#78350f');
  ctx.strokeStyle = '#92400e'; ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, s*0.26); ctx.stroke();
  // Pick head
  ctx.fillStyle = '#9ca3af';
  ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.lineTo(4, -8); ctx.lineTo(-4, -8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d1d5db';
  ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-4, -8); ctx.lineTo(-3, -4); ctx.closePath(); ctx.fill();
  // Dust if hitting
  if (Math.abs(sw2) > 0.28) {
    ctx.fillStyle = 'rgba(200,190,170,0.5)';
    for (var d2 = 0; d2 < 3; d2++) {
      ctx.beginPath(); ctx.arc(Math.random()*14-7, s*0.28+Math.random()*6, 2+Math.random()*3, 0, Math.PI*2); ctx.fill();
    }
  }
  ctx.restore();

  // Rope/chain support
  ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 1;
  ctx.setLineDash([2,2]);
  ctx.beginPath(); ctx.moveTo(-s*0.3, -s*0.6); ctx.lineTo(s*0.22, -s*0.36); ctx.stroke();
  ctx.setLineDash([]);
};

// ── FACTORY ──────────────────────────────────────────────────
GameRenderer.prototype._sFactory = function(ctx, s, level, tick) {
  // Main building body
  this._isoBox(ctx, -s*0.44, -s*0.54, s*0.88, s*0.54, 220, 15, 38);
  // Roof detail - concrete ledge
  ctx.fillStyle = '#475569';
  ctx.fillRect(-s*0.46, -s*0.56, s*0.92, s*0.04);

  // Windows - row of industrial windows
  for (var wi = 0; wi < 3; wi++) {
    this._isoBox(ctx, -s*0.36 + wi*s*0.26, -s*0.44, s*0.18, s*0.28, 210, 30, 52);
    this._isoWin(ctx, -s*0.32 + wi*s*0.26, -s*0.42, s*0.14, s*0.2, wi===1, tick);
  }

  // Loading bay door
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(-s*0.12, -s*0.28, s*0.24, s*0.28);
  // Door stripes
  for (var ds = 0; ds < 4; ds++) {
    ctx.fillStyle = ds%2===0 ? '#fbbf24' : '#1e293b';
    ctx.fillRect(-s*0.12, -s*0.28 + ds*s*0.07, s*0.24, s*0.07);
  }

  // Chimneys
  var nc = Math.min(2 + Math.floor(level/3), 5);
  for (var ci = 0; ci < nc; ci++) {
    var cx2 = -s*0.36 + ci*(s*0.72/(nc-1||1));
    // Chimney body
    this._isoBox(ctx, cx2-s*0.05, -s*0.78, s*0.1, s*0.26, 220, 10, 30);
    // Chimney cap
    ctx.fillStyle = '#334155';
    ctx.fillRect(cx2-s*0.07, -s*0.78, s*0.14, s*0.03);
    // Smoke
    this._smoke(ctx, cx2, -s*0.78, tick, ci*15, null);
    this._smoke(ctx, cx2, -s*0.78, tick, ci*15+25, null);
  }

  // Sign
  ctx.fillStyle = '#1e40af';
  ctx.fillRect(-s*0.28, -s*0.52, s*0.56, s*0.1);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 7px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('FACTORY', 0, -s*0.47);
};

// ── POWERPLANT ───────────────────────────────────────────────
GameRenderer.prototype._sPowerplant = function(ctx, s, level, tick) {
  // Base building
  this._isoBox(ctx, -s*0.38, -s*0.3, s*0.76, s*0.3, 215, 20, 35);

  // Cooling tower - iconic shape
  var tg = ctx.createLinearGradient(-s*0.26, -s*0.7, s*0.26, 0);
  tg.addColorStop(0, '#94a3b8'); tg.addColorStop(0.5, '#cbd5e1'); tg.addColorStop(1, '#94a3b8');
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(-s*0.26, 0);
  ctx.quadraticCurveTo(-s*0.34, -s*0.35, -s*0.18, -s*0.68);
  ctx.lineTo(s*0.18, -s*0.68);
  ctx.quadraticCurveTo(s*0.34, -s*0.35, s*0.26, 0);
  ctx.closePath(); ctx.fill();
  // Cooling tower interior shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.moveTo(-s*0.16, 0);
  ctx.quadraticCurveTo(-s*0.24, -s*0.35, -s*0.1, -s*0.66);
  ctx.lineTo(s*0.1, -s*0.66);
  ctx.quadraticCurveTo(s*0.24, -s*0.35, s*0.16, 0);
  ctx.closePath(); ctx.fill();
  // Rim highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-s*0.18, -s*0.68); ctx.lineTo(s*0.18, -s*0.68); ctx.stroke();

  // Steam coming out
  for (var si = 0; si < 3; si++) {
    var st2 = (tick * 0.4 + si*18) % 52;
    var sa = 0.5 - st2/52;
    if (sa > 0) {
      ctx.fillStyle = 'rgba(220,220,220,' + sa + ')';
      ctx.beginPath(); ctx.arc((-0.1+si*0.1)*s, -s*0.68 - st2*0.5, 4+st2*0.3, 0, Math.PI*2); ctx.fill();
    }
  }

  // Lightning bolt symbol
  var lp = 0.7 + 0.3*Math.sin(tick*0.15);
  ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 12*lp;
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.moveTo(s*0.06, -s*0.26); ctx.lineTo(-s*0.06, -s*0.14); ctx.lineTo(s*0.02, -s*0.14);
  ctx.lineTo(-s*0.06, 0); ctx.lineTo(s*0.08, -s*0.16); ctx.lineTo(0, -s*0.16);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;

  // Control building
  this._isoBox(ctx, s*0.26, -s*0.24, s*0.14, s*0.24, 215, 25, 40);
  this._isoWin(ctx, s*0.28, -s*0.22, s*0.1, s*0.08, true, tick);
};

// ── WAREHOUSE ────────────────────────────────────────────────
GameRenderer.prototype._sWarehouse = function(ctx, s, level, tick) {
  // Main warehouse body - wide and low
  this._isoBox(ctx, -s*0.48, -s*0.36, s*0.96, s*0.36, 30, 40, 38);
  // Arched metal roof
  var rg = ctx.createLinearGradient(-s*0.5, -s*0.56, s*0.5, -s*0.36);
  rg.addColorStop(0, '#94a3b8'); rg.addColorStop(0.5, '#cbd5e1'); rg.addColorStop(1, '#64748b');
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.ellipse(0, -s*0.36, s*0.5, s*0.22, 0, Math.PI, 0); ctx.fill();
  // Roof ribs
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1;
  for (var ri = -3; ri <= 3; ri++) {
    ctx.beginPath(); ctx.ellipse(0, -s*0.36, s*0.5, s*0.22, 0, Math.PI+ri*0.22, Math.PI+(ri+0.5)*0.22); ctx.stroke();
  }
  // Large doors
  ctx.fillStyle = '#1e293b';
  ctx.beginPath(); ctx.arc(-s*0.2, -s*0.18, s*0.18, Math.PI, 0); ctx.rect(-s*0.38, -s*0.18, s*0.36, s*0.18); ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.fillRect(-s*0.36, -s*0.34, s*0.34, s*0.18);
  // Door panels
  ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-s*0.19, -s*0.34); ctx.lineTo(-s*0.19, -s*0.16); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.36, -s*0.25); ctx.lineTo(-s*0.02, -s*0.25); ctx.stroke();
  // Loading dock
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(-s*0.5, -s*0.02, s, s*0.02);
  // Forklift indicator light
  var fl = Math.floor(tick/25)%2===0;
  ctx.fillStyle = fl ? '#ef4444' : '#374151';
  ctx.beginPath(); ctx.arc(s*0.42, -s*0.28, 4, 0, Math.PI*2); ctx.fill();
};

// ── MARKET ───────────────────────────────────────────────────
GameRenderer.prototype._sMarket = function(ctx, s, level, tick) {
  // Building base
  this._isoBox(ctx, -s*0.4, -s*0.4, s*0.8, s*0.4, 45, 55, 52);
  // Awning - scalloped
  ctx.fillStyle = '#dc2626';
  ctx.beginPath(); ctx.moveTo(-s*0.44, -s*0.4);
  for (var aw = 0; aw < 6; aw++) {
    var ax = -s*0.44 + aw * s*0.88/5;
    ctx.lineTo(ax + s*0.07, -s*0.54);
    ctx.lineTo(ax + s*0.147, -s*0.4);
  }
  ctx.closePath(); ctx.fill();
  // Awning stripes
  ctx.fillStyle = '#b91c1c';
  for (var as = 0; as < 3; as++) {
    ctx.fillRect(-s*0.44 + as*s*0.32, -s*0.54, s*0.08, s*0.14);
  }
  // Awning edge
  ctx.strokeStyle = '#7f1d1d'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-s*0.44, -s*0.4); ctx.lineTo(s*0.44, -s*0.4); ctx.stroke();

  // Counter/display
  ctx.fillStyle = '#92400e'; ctx.fillRect(-s*0.34, -s*0.3, s*0.68, s*0.1);
  // Produce display - animated bounce
  var b = Math.sin(tick * 0.06) * 1.5;
  ctx.font = '11px Arial'; ctx.textAlign = 'center';
  ctx.fillText('🍎', -s*0.2, -s*0.3 + b);
  ctx.fillText('🥕', 0, -s*0.3 + b*0.7);
  ctx.fillText('🍇', s*0.2, -s*0.3 + b*1.2);
  // Sign
  ctx.fillStyle = '#fef3c7';
  ctx.fillRect(-s*0.22, -s*0.52, s*0.44, s*0.1);
  ctx.fillStyle = '#78350f'; ctx.font = 'bold 7px Arial'; ctx.textBaseline = 'middle';
  ctx.fillText('РЫНОК', 0, -s*0.47);
};

// ── GARDEN ───────────────────────────────────────────────────
GameRenderer.prototype._sGarden = function(ctx, s, level, tick) {
  // Stone path
  var pg2 = ctx.createLinearGradient(-s*0.44, 0, s*0.44, 0);
  pg2.addColorStop(0, '#9ca3af'); pg2.addColorStop(0.5, '#d1d5db'); pg2.addColorStop(1, '#9ca3af');
  for (var pp = -3; pp <= 3; pp++) {
    ctx.fillStyle = pg2;
    ctx.beginPath(); ctx.ellipse(pp*s*0.14, -s*0.04, s*0.06, s*0.04, 0, 0, Math.PI*2); ctx.fill();
  }
  ctx.fillStyle = '#b0b0b0'; ctx.fillRect(-s*0.44, -s*0.02, s*0.88, s*0.02);

  // Central fountain
  ctx.fillStyle = '#0369a1';
  ctx.beginPath(); ctx.ellipse(0, -s*0.12, s*0.14, s*0.06, 0, 0, Math.PI*2); ctx.fill();
  // Fountain basin
  ctx.strokeStyle = '#d4a574'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, -s*0.12, s*0.14, s*0.06, 0, 0, Math.PI*2); ctx.stroke();
  // Water jet
  var wt = (tick * 0.08) % (Math.PI * 2);
  ctx.strokeStyle = 'rgba(125,211,252,0.8)'; ctx.lineWidth = 1.5;
  for (var wj = 0; wj < 4; wj++) {
    var wa = wj * Math.PI/2 + wt*0.1;
    var wh2 = s*0.08 + Math.sin(tick*0.1+wj)*s*0.02;
    ctx.beginPath(); ctx.moveTo(0, -s*0.12);
    ctx.quadraticCurveTo(Math.cos(wa)*s*0.08, -s*0.12-wh2, Math.cos(wa)*s*0.12, -s*0.12-s*0.02);
    ctx.stroke();
  }

  // Trees/bushes
  var nt = Math.min(2 + Math.floor(level/2), 6);
  for (var t = 0; t < nt; t++) {
    var angle2 = t * (Math.PI*2/nt);
    var tr = s * 0.28;
    var tx2 = Math.cos(angle2) * tr;
    var ty2 = Math.sin(angle2) * tr * 0.4 - s*0.28;
    var sw3 = Math.sin(tick*0.04+t) * 1.5;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(tx2, ty2 + s*0.24, s*0.08, s*0.03, 0, 0, Math.PI*2); ctx.fill();
    // Trunk
    var tg2 = ctx.createLinearGradient(tx2, ty2+s*0.2, tx2, ty2);
    tg2.addColorStop(0, '#78350f'); tg2.addColorStop(1, '#92400e');
    ctx.fillStyle = tg2; ctx.fillRect(tx2-2, ty2, 4, s*0.16);
    // Foliage layers
    var colors2 = ['#166534','#15803d','#16a34a'];
    for (var fl2 = 0; fl2 < 3; fl2++) {
      var fg2 = ctx.createRadialGradient(tx2+sw3, ty2-fl2*s*0.06, 0, tx2+sw3, ty2-fl2*s*0.06, s*(0.11-fl2*0.02));
      fg2.addColorStop(0, colors2[fl2]); fg2.addColorStop(1, '#14532d');
      ctx.fillStyle = fg2;
      ctx.beginPath(); ctx.arc(tx2+sw3, ty2-fl2*s*0.08, s*(0.11-fl2*0.02), 0, Math.PI*2); ctx.fill();
    }
    // Flowers
    ctx.fillStyle = ['#f43f5e','#a855f7','#eab308','#ec4899'][t%4];
    ctx.beginPath(); ctx.arc(tx2+sw3+s*0.04, ty2-s*0.22, 3, 0, Math.PI*2); ctx.fill();
  }
};

// ── SCHOOL ───────────────────────────────────────────────────
GameRenderer.prototype._sSchool = function(ctx, s, level, tick) {
  // Main building
  this._isoBox(ctx, -s*0.46, -s*0.56, s*0.92, s*0.56, 55, 60, 90);
  // Roof ledge
  ctx.fillStyle = '#fbbf24'; ctx.fillRect(-s*0.48, -s*0.58, s*0.96, s*0.04);
  // Columns
  for (var c2 = 0; c2 < 4; c2++) {
    this._isoBox(ctx, -s*0.38+c2*s*0.24, -s*0.5, s*0.06, s*0.5, 55, 20, 82);
  }
  // Windows - arched tops
  for (var w2 = 0; w2 < 3; w2++) {
    var wx = -s*0.3 + w2*s*0.28;
    // Arch
    ctx.fillStyle = 'rgba(186,230,253,0.8)';
    ctx.beginPath(); ctx.arc(wx+s*0.08, -s*0.38, s*0.08, Math.PI, 0); ctx.rect(wx, -s*0.38, s*0.16, s*0.2); ctx.fill();
    ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 1;
    ctx.strokeRect(wx, -s*0.38, s*0.16, s*0.2);
  }
  // Bell tower
  this._isoBox(ctx, -s*0.08, -s*0.76, s*0.16, s*0.2, 55, 25, 78);
  ctx.fillStyle = '#b45309';
  ctx.beginPath(); ctx.moveTo(-s*0.1, -s*0.76); ctx.lineTo(0, -s*0.94); ctx.lineTo(s*0.1, -s*0.76); ctx.closePath(); ctx.fill();
  // Bell
  var bs2 = Math.sin(tick * 0.08) * 0.2;
  ctx.fillStyle = '#ca8a04'; ctx.strokeStyle = '#a16207'; ctx.lineWidth = 1;
  ctx.save(); ctx.translate(0, -s*0.78); ctx.rotate(bs2);
  ctx.beginPath(); ctx.arc(0, 0, s*0.05, 0, Math.PI); ctx.fill(); ctx.stroke();
  ctx.restore();
  // Flag
  ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -s*0.94); ctx.lineTo(0, -s*1.08); ctx.stroke();
  var fw2 = Math.sin(tick * 0.1) * 4;
  ctx.fillStyle = '#ef4444';
  ctx.beginPath(); ctx.moveTo(0,-s*1.08); ctx.lineTo(s*0.18+fw2,-s*1.01); ctx.lineTo(0,-s*0.95); ctx.closePath(); ctx.fill();
  // Door
  ctx.fillStyle = '#92400e';
  ctx.beginPath(); ctx.roundRect(-s*0.08, -s*0.28, s*0.16, s*0.28, [6,6,0,0]); ctx.fill();
  ctx.fillStyle = '#fbbf24'; ctx.font = '8px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('⭐', 0, -s*0.14);
};

// ── BAKERY ───────────────────────────────────────────────────
GameRenderer.prototype._sBakery = function(ctx, s, level, tick) {
  this._isoBox(ctx, -s*0.34, -s*0.46, s*0.68, s*0.46, 40, 70, 58);
  // Roof with tiles
  this._roof(ctx, -s*0.38, -s*0.46, s*0.76, s*0.24, '#c2410c', '#9a3412');
  // Chimney/oven stack
  this._isoBox(ctx, s*0.08, -s*0.56, s*0.12, s*0.14, 25, 30, 30);
  this._smoke(ctx, s*0.14, -s*0.56, tick, 0, 'rgba(255,160,50,0.5)');
  this._smoke(ctx, s*0.14, -s*0.56, tick, 20, 'rgba(200,120,30,0.4)');
  // Window display
  this._isoBox(ctx, -s*0.26, -s*0.38, s*0.36, s*0.26, 30, 40, 65);
  // Bread display
  ctx.fillStyle = '#fbbf24';
  for (var b2 = 0; b2 < 3; b2++) {
    ctx.beginPath(); ctx.ellipse(-s*0.18+b2*s*0.1, -s*0.24, s*0.04, s*0.03, 0, 0, Math.PI*2); ctx.fill();
  }
  // Sign board
  ctx.fillStyle = '#92400e'; ctx.fillRect(-s*0.28, -s*0.52, s*0.56, s*0.08);
  ctx.fillStyle = '#fef3c7'; ctx.font = 'bold 7px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('🥐 ПЕКАРНЯ', 0, -s*0.48);
  // Door bell
  var db = Math.floor(tick/60)%8===0;
  if (db) { ctx.font = '8px Arial'; ctx.fillText('🔔', -s*0.3, -s*0.34); }
};

// ── PARK ─────────────────────────────────────────────────────
GameRenderer.prototype._sPark = function(ctx, s, level, tick) {
  // Pond
  var pond = ctx.createRadialGradient(0, -s*0.08, 0, 0, -s*0.08, s*0.22);
  pond.addColorStop(0, '#38bdf8'); pond.addColorStop(1, '#0284c7');
  ctx.fillStyle = pond;
  ctx.beginPath(); ctx.ellipse(0, -s*0.08, s*0.22, s*0.1, 0, 0, Math.PI*2); ctx.fill();
  // Water ripple
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  var rp = (tick * 0.05) % 1;
  ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(0, -s*0.08, s*0.1*(1+rp), s*0.04*(1+rp), 0, 0, Math.PI*2); ctx.stroke();

  // Paths
  var pg3 = ctx.createLinearGradient(-s*0.44, 0, s*0.44, 0);
  pg3.addColorStop(0, '#d4a574'); pg3.addColorStop(0.5, '#e8c99e'); pg3.addColorStop(1, '#d4a574');
  ctx.fillStyle = pg3;
  ctx.fillRect(-s*0.04, -s*0.6, s*0.08, s*0.6);
  ctx.fillRect(-s*0.44, -s*0.04, s*0.88, s*0.08);

  // Trees at corners - animated sway
  var tpos = [[-s*0.32,-s*0.46],[s*0.32,-s*0.46],[-s*0.32,s*0.04],[s*0.32,s*0.04]];
  tpos.forEach(function(tp, i) {
    var sw4 = Math.sin(tick*0.04+i*1.1)*2;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(tp[0], tp[1]+s*0.24, s*0.08, s*0.03, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#78350f'; ctx.fillRect(tp[0]-2, tp[1]+s*0.08, 4, s*0.14);
    var tcs = ['#166534','#15803d','#16a34a'];
    tcs.forEach(function(tc, li) {
      ctx.fillStyle = tc;
      ctx.beginPath(); ctx.arc(tp[0]+sw4, tp[1]-(li*s*0.06), s*(0.1-li*0.015), 0, Math.PI*2); ctx.fill();
    });
  });

  // Ferris wheel / carousel
  var ang2 = tick * 0.02;
  ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, -s*0.56, s*0.16, 0, Math.PI*2); ctx.stroke();
  ctx.fillStyle = '#6b7280'; ctx.beginPath(); ctx.arc(0, -s*0.56, 3, 0, Math.PI*2); ctx.fill();
  var colors3 = ['#ef4444','#3b82f6','#22c55e','#f59e0b','#a855f7','#ec4899'];
  for (var sp2 = 0; sp2 < 6; sp2++) {
    var a2 = ang2 + sp2*Math.PI/3;
    var px = Math.cos(a2)*s*0.16, py = -s*0.56+Math.sin(a2)*s*0.16;
    ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -s*0.56); ctx.lineTo(px, py); ctx.stroke();
    ctx.fillStyle = colors3[sp2];
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI*2); ctx.fill();
  }
};

// ── BANK ─────────────────────────────────────────────────────
GameRenderer.prototype._sBank = function(ctx, s, level, tick) {
  // Grand base/steps
  ctx.fillStyle = '#cbd5e1'; ctx.fillRect(-s*0.48, -s*0.06, s*0.96, s*0.06);
  ctx.fillStyle = '#e2e8f0'; ctx.fillRect(-s*0.44, -s*0.1, s*0.88, s*0.04);

  // Main building
  this._isoBox(ctx, -s*0.42, -s*0.7, s*0.84, s*0.64, 220, 10, 90);
  // Pediment/classical roof
  ctx.fillStyle = '#f1f5f9';
  ctx.beginPath(); ctx.moveTo(-s*0.46, -s*0.7); ctx.lineTo(0, -s*0.94); ctx.lineTo(s*0.46, -s*0.7); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1; ctx.stroke();
  // Pediment detail
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath(); ctx.moveTo(-s*0.3, -s*0.7); ctx.lineTo(0, -s*0.86); ctx.lineTo(s*0.3, -s*0.7); ctx.closePath(); ctx.fill();

  // Columns
  for (var cp2 = 0; cp2 < 5; cp2++) {
    var cxp = -s*0.36 + cp2*s*0.18;
    this._isoBox(ctx, cxp, -s*0.64, s*0.06, s*0.58, 220, 8, 85);
    // Capital
    ctx.fillStyle = '#e2e8f0'; ctx.fillRect(cxp - 2, -s*0.64, s*0.06+4, s*0.03);
  }

  // Main door
  ctx.fillStyle = '#1e3a5f';
  ctx.beginPath(); ctx.roundRect(-s*0.1, -s*0.38, s*0.2, s*0.32, [8,8,0,0]); ctx.fill();
  // Door details
  ctx.strokeStyle = '#c8a135'; ctx.lineWidth = 1.5;
  ctx.strokeRect(-s*0.08, -s*0.36, s*0.16, s*0.28);
  ctx.beginPath(); ctx.arc(0, -s*0.1, s*0.06, Math.PI, 0); ctx.stroke();

  // Glowing $ sign
  var gl2 = 0.7 + 0.3*Math.sin(tick*0.08);
  ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 18*gl2;
  ctx.fillStyle = 'hsl(45,100%,' + (55+gl2*15) + '%)';
  ctx.font = 'bold 20px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('$', 0, -s*0.52);
  ctx.shadowBlur = 0;

  // Security camera blink
  var bl = Math.floor(tick/30)%2===0;
  ctx.fillStyle = bl ? '#ef4444' : '#374151';
  ctx.beginPath(); ctx.arc(s*0.38, -s*0.54, 3, 0, Math.PI*2); ctx.fill();
};

// ── HOSPITAL ─────────────────────────────────────────────────
GameRenderer.prototype._sHospital = function(ctx, s, level, tick) {
  // Main building - white
  this._isoBox(ctx, -s*0.42, -s*0.64, s*0.84, s*0.64, 150, 20, 95);
  // Roof
  ctx.fillStyle = '#dcfce7'; ctx.fillRect(-s*0.44, -s*0.66, s*0.88, s*0.04);

  // Wings
  this._isoBox(ctx, -s*0.44, -s*0.44, s*0.12, s*0.44, 150, 15, 90);
  this._isoBox(ctx, s*0.32, -s*0.44, s*0.12, s*0.44, 150, 15, 90);

  // Large red cross
  ctx.fillStyle = '#dc2626';
  ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 6;
  ctx.fillRect(-s*0.05, -s*0.58, s*0.1, s*0.28);
  ctx.fillRect(-s*0.15, -s*0.48, s*0.3, s*0.1);
  ctx.shadowBlur = 0;

  // Windows - alternating lights
  var wpos = [[-s*0.32,-s*0.58],[-s*0.16,-s*0.58],[s*0.1,-s*0.58],[s*0.26,-s*0.58],
              [-s*0.32,-s*0.44],[-s*0.16,-s*0.44],[s*0.1,-s*0.44],[s*0.26,-s*0.44]];
  wpos.forEach(function(wp, i) {
    var on2 = Math.floor(tick/40+i)%2===0;
    ctx.fillStyle = on2 ? '#fef9c3' : 'rgba(186,230,253,0.7)';
    if (on2) { ctx.shadowColor = '#fef08a'; ctx.shadowBlur = 4; }
    ctx.fillRect(wp[0], wp[1], s*0.1, s*0.1);
    ctx.shadowBlur = 0;
  });

  // Entrance canopy
  ctx.fillStyle = '#16a34a';
  ctx.fillRect(-s*0.18, -s*0.28, s*0.36, s*0.04);
  ctx.fillStyle = '#166534'; ctx.fillRect(-s*0.14, -s*0.28, s*0.04, s*0.04);
  ctx.fillRect(s*0.1, -s*0.28, s*0.04, s*0.04);
  // Doors
  ctx.fillStyle = 'rgba(186,230,253,0.5)';
  ctx.fillRect(-s*0.12, -s*0.28, s*0.1, s*0.28);
  ctx.fillRect(s*0.02, -s*0.28, s*0.1, s*0.28);

  // Helicopter pad sign on roof
  ctx.fillStyle = '#15803d';
  ctx.beginPath(); ctx.arc(0, -s*0.68, s*0.06, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 6px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('H', 0, -s*0.68);
};

// ── LIBRARY ──────────────────────────────────────────────────
GameRenderer.prototype._sLibrary = function(ctx, s, level, tick) {
  this._isoBox(ctx, -s*0.44, -s*0.6, s*0.88, s*0.6, 40, 45, 60);
  // Classic brick texture
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (var br = 0; br < 5; br++) {
    for (var bc = 0; bc < 8; bc++) {
      if ((br+bc)%2===0) ctx.fillRect(-s*0.42+bc*s*0.1, -s*0.56+br*s*0.1, s*0.1, s*0.1);
    }
  }
  // Pediment
  ctx.fillStyle = '#d4a26a';
  ctx.beginPath(); ctx.moveTo(-s*0.46, -s*0.6); ctx.lineTo(0, -s*0.82); ctx.lineTo(s*0.46, -s*0.6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#b8864e';
  ctx.beginPath(); ctx.moveTo(-s*0.28, -s*0.6); ctx.lineTo(0, -s*0.74); ctx.lineTo(s*0.28, -s*0.6); ctx.closePath(); ctx.fill();
  // Arched windows
  for (var lw = 0; lw < 3; lw++) {
    var lwx = -s*0.3+lw*s*0.3;
    ctx.fillStyle = 'rgba(186,230,253,0.75)';
    ctx.beginPath(); ctx.arc(lwx+s*0.08, -s*0.44, s*0.08, Math.PI, 0); ctx.rect(lwx, -s*0.44, s*0.16, s*0.24); ctx.fill();
    ctx.strokeStyle = '#b8864e'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(lwx+s*0.08, -s*0.44, s*0.08, Math.PI, 0); ctx.stroke();
    ctx.strokeRect(lwx, -s*0.44, s*0.16, s*0.24);
  }
  // Floating books
  var by2 = Math.abs(Math.sin(tick*0.04))*s*0.08;
  ctx.font = '13px Arial'; ctx.textAlign='center';
  ctx.fillText('📚', 0, -s*0.82 - by2);
  // Door
  ctx.fillStyle = '#78350f';
  ctx.beginPath(); ctx.roundRect(-s*0.1, -s*0.34, s*0.2, s*0.34, [6,6,0,0]); ctx.fill();
  ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1; ctx.strokeRect(-s*0.08, -s*0.32, s*0.16, s*0.3);
};

// ── STADIUM ──────────────────────────────────────────────────
GameRenderer.prototype._sStadium = function(ctx, s, level, tick) {
  // Outer bowl
  var og = ctx.createRadialGradient(0, -s*0.2, s*0.2, 0, -s*0.2, s*0.52);
  og.addColorStop(0, '#374151'); og.addColorStop(1, '#1f2937');
  ctx.fillStyle = og;
  ctx.beginPath(); ctx.ellipse(0, -s*0.2, s*0.52, s*0.28, 0, 0, Math.PI*2); ctx.fill();
  // Stadium tiers - colored seating
  var tierColors = ['#dc2626','#1d4ed8','#dc2626','#1d4ed8'];
  for (var tier = 0; tier < 4; tier++) {
    ctx.fillStyle = tierColors[tier];
    ctx.beginPath(); ctx.ellipse(0, -s*0.2, s*(0.48-tier*0.06), s*(0.24-tier*0.03), 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -s*0.2, s*(0.42-tier*0.06), s*(0.21-tier*0.03), 0, 0, Math.PI*2); ctx.fill();
  }
  // Field
  var fg3 = ctx.createRadialGradient(0, -s*0.2, 0, 0, -s*0.2, s*0.2);
  fg3.addColorStop(0, '#16a34a'); fg3.addColorStop(1, '#15803d');
  ctx.fillStyle = fg3;
  ctx.beginPath(); ctx.ellipse(0, -s*0.2, s*0.2, s*0.1, 0, 0, Math.PI*2); ctx.fill();
  // Field lines
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(0, -s*0.2, s*0.1, s*0.05, 0, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -s*0.3); ctx.lineTo(0, -s*0.1); ctx.stroke();
  // Floodlights
  [[-s*0.5,-s*0.56],[s*0.5,-s*0.56]].forEach(function(l) {
    ctx.fillStyle = '#6b7280'; ctx.fillRect(l[0]-2, l[1], 4, s*0.4);
    var lg2 = 0.7+0.3*Math.sin(tick*0.1);
    ctx.shadowColor = '#fef9c3'; ctx.shadowBlur = 20*lg2;
    ctx.fillStyle = 'rgba(255,250,200,'+lg2+')';
    ctx.beginPath(); ctx.arc(l[0], l[1], 7, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
  });
  // Crowd celebration
  if (Math.floor(tick/15)%4===0) {
    ctx.font = '9px Arial'; ctx.textAlign='center';
    ctx.fillText('🎉', Math.sin(tick*0.2)*s*0.3, -s*0.42);
    ctx.fillText('🎊', Math.cos(tick*0.15)*s*0.25, -s*0.48);
  }
};

// ── CRYSTAL MINE ─────────────────────────────────────────────
GameRenderer.prototype._sCrystalMine = function(ctx, s, level, tick) {
  // Ground / rocky base
  var bg3 = ctx.createRadialGradient(0, 0, 0, 0, 0, s*0.44);
  bg3.addColorStop(0, '#3b1f6e'); bg3.addColorStop(1, '#1f1035');
  ctx.fillStyle = bg3;
  ctx.beginPath(); ctx.ellipse(0, -s*0.04, s*0.44, s*0.14, 0, 0, Math.PI*2); ctx.fill();

  // Mine entrance arch
  ctx.fillStyle = '#374151';
  ctx.beginPath(); ctx.arc(0, -s*0.22, s*0.28, Math.PI, 0); ctx.rect(-s*0.28, -s*0.22, s*0.56, s*0.22); ctx.fill();
  // Arch bricks
  ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 1;
  for (var ab = 0; ab < 8; ab++) {
    var aa = Math.PI + ab * Math.PI/8;
    ctx.beginPath(); ctx.moveTo(Math.cos(aa)*s*0.28, -s*0.22+Math.sin(aa)*s*0.28);
    ctx.lineTo(Math.cos(aa)*s*0.24, -s*0.22+Math.sin(aa)*s*0.24); ctx.stroke();
  }
  // Dark interior with glow
  ctx.fillStyle = '#0f0720';
  ctx.beginPath(); ctx.arc(0, -s*0.22, s*0.22, Math.PI, 0); ctx.rect(-s*0.22, -s*0.22, s*0.44, s*0.22); ctx.fill();
  // Interior purple glow
  var gp = 0.3 + 0.2*Math.sin(tick*0.08);
  var ig = ctx.createRadialGradient(0, -s*0.14, 0, 0, -s*0.14, s*0.18);
  ig.addColorStop(0, 'rgba(167,139,250,'+gp+')'); ig.addColorStop(1, 'rgba(109,40,217,0)');
  ctx.fillStyle = ig;
  ctx.beginPath(); ctx.arc(0, -s*0.22, s*0.22, Math.PI, 0); ctx.rect(-s*0.22, -s*0.22, s*0.44, s*0.22); ctx.fill();

  // Crystals emerging from mine entrance
  var crystalData = [[-0.16,-0.54,0.1],[0.0,-0.68,0.13],[0.18,-0.56,0.1],[-0.06,-0.46,0.08],[0.1,-0.44,0.07]];
  crystalData.forEach(function(c3, i) {
    var pha2 = tick*0.06+i*1.2;
    var cp2 = 0.8+0.2*Math.sin(pha2);
    ctx.save(); ctx.translate(s*c3[0], s*c3[1]); ctx.rotate(Math.sin(pha2*0.7)*0.08);
    // Glow
    ctx.shadowColor = '#a78bfa'; ctx.shadowBlur = 14*cp2;
    // Crystal body
    var cg2 = ctx.createLinearGradient(-s*c3[2]*0.5, 0, s*c3[2]*0.5, s*c3[2]);
    cg2.addColorStop(0, '#c4b5fd'); cg2.addColorStop(0.4, '#8b5cf6'); cg2.addColorStop(1, '#4c1d95');
    ctx.fillStyle = cg2;
    ctx.beginPath();
    ctx.moveTo(0, -s*c3[2]*1.6); ctx.lineTo(s*c3[2]*0.55, 0); ctx.lineTo(0, s*c3[2]*0.55); ctx.lineTo(-s*c3[2]*0.55, 0);
    ctx.closePath(); ctx.fill();
    // Highlight facet
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.moveTo(0,-s*c3[2]*1.6); ctx.lineTo(s*c3[2]*0.25,0); ctx.lineTo(0,-s*c3[2]*0.4); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.restore();
  });

  // Minecart track
  ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-s*0.28, 0); ctx.lineTo(-s*0.24, -s*0.12); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.28, 0); ctx.lineTo(s*0.24, -s*0.12); ctx.stroke();
  for (var tr2 = 0; tr2 < 5; tr2++) {
    var tx3 = -s*0.26 + tr2*s*0.13;
    ctx.beginPath(); ctx.moveTo(tx3, -tr2*s*0.024); ctx.lineTo(tx3+s*0.02, -s*0.12+tr2*s*0.024); ctx.stroke();
  }
};

// ── ARCANE TOWER ─────────────────────────────────────────────
GameRenderer.prototype._sArcaneTower = function(ctx, s, level, tick) {
  // Stone base
  this._isoBox(ctx, -s*0.3, -s*0.2, s*0.6, s*0.2, 270, 20, 25);
  // Base decoration - runes
  var rp2 = 0.5 + 0.5*Math.sin(tick*0.05);
  ctx.fillStyle = 'rgba(167,139,250,' + rp2 + ')';
  for (var r2 = 0; r2 < 4; r2++) {
    var ra = tick*0.03 + r2*Math.PI/2;
    ctx.beginPath(); ctx.arc(Math.cos(ra)*s*0.22, -s*0.1+Math.sin(ra)*s*0.06, 2, 0, Math.PI*2); ctx.fill();
  }

  // Tower body - tapered
  var tg3 = ctx.createLinearGradient(-s*0.22, -s*0.2, s*0.22, 0);
  tg3.addColorStop(0, '#5b21b6'); tg3.addColorStop(1, '#7c3aed');
  ctx.fillStyle = tg3;
  ctx.beginPath();
  ctx.moveTo(-s*0.22, -s*0.2); ctx.lineTo(-s*0.14, -s*0.82); ctx.lineTo(s*0.14, -s*0.82); ctx.lineTo(s*0.22, -s*0.2);
  ctx.closePath(); ctx.fill();
  // Tower edge highlights
  ctx.strokeStyle = 'rgba(196,181,253,0.4)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-s*0.22,-s*0.2); ctx.lineTo(-s*0.14,-s*0.82); ctx.stroke();

  // Tower windows - magical glow
  var winGlow = 0.7+0.3*Math.sin(tick*0.12);
  [[0,-s*0.44],[0,-s*0.6]].forEach(function(wp2, i) {
    ctx.shadowColor = '#c4b5fd'; ctx.shadowBlur = 12*winGlow;
    ctx.fillStyle = 'rgba(196,181,253,' + winGlow + ')';
    ctx.beginPath(); ctx.arc(wp2[0], wp2[1], s*0.05, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
  });

  // Conical roof with stars
  var roofG = ctx.createLinearGradient(-s*0.18, -s*0.82, s*0.18, -s*1.14);
  roofG.addColorStop(0, '#4c1d95'); roofG.addColorStop(1, '#2e1065');
  ctx.fillStyle = roofG;
  ctx.beginPath(); ctx.moveTo(-s*0.18,-s*0.82); ctx.lineTo(0,-s*1.14); ctx.lineTo(s*0.18,-s*0.82); ctx.closePath(); ctx.fill();
  // Roof stars
  ctx.fillStyle = '#fef3c7';
  [[s*0.06,-s*0.92],[- s*0.06,-s*0.98],[s*0.02,-s*1.04]].forEach(function(st) {
    ctx.beginPath(); ctx.arc(st[0], st[1], 1.5, 0, Math.PI*2); ctx.fill();
  });

  // Orbiting magic orb
  var op3 = 0.5+0.5*Math.sin(tick*0.1);
  ctx.shadowColor = '#c4b5fd'; ctx.shadowBlur = 20*op3;
  ctx.fillStyle = 'rgba(167,139,250,' + (0.8+0.2*op3) + ')';
  ctx.beginPath(); ctx.arc(0, -s*1.14, s*0.1, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#ede9fe';
  ctx.beginPath(); ctx.arc(-s*0.03, -s*1.18, s*0.04, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;

  // 3 orbiting particles
  for (var op4 = 0; op4 < 3; op4++) {
    var oa2 = tick*0.1 + op4*Math.PI*2/3;
    ctx.fillStyle = 'rgba(196,181,253,0.9)';
    ctx.beginPath(); ctx.arc(Math.cos(oa2)*s*0.24, -s*0.84+Math.sin(oa2)*s*0.1, 3, 0, Math.PI*2); ctx.fill();
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
