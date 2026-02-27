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
  this.roadMap          = {};
  this.cars             = [];
  // cars init deferred until setBuildings
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
GameRenderer.prototype.setBuildings = function(b, c) {
  this.buildings = b || [];
  this.buildingTypeConfig = c || {};
  // Build road lookup map for fast neighbor checks
  this.roadMap = {};
  for (var i = 0; i < this.buildings.length; i++) {
    var bld = this.buildings[i];
    if (bld.type === 'road') {
      this.roadMap[bld.x + ',' + bld.y] = bld; // store full object for rotation
    }
  }
  // Reset cars when road network changes
  this._initCars();
};
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
    // For multi-tile buildings, use the BOTTOM-RIGHT corner for painter order
    // so all tiles of the footprint are drawn BEFORE the building
    var bCfg = this.buildingTypeConfig[b.type];
    var bSz = (bCfg && bCfg.size) || 1;
    var bOrder = (b.x + bSz - 1) + (b.y + bSz - 1) + 0.5;
    drawList.push({ kind: 1, b: b, tx: sc2.x, ty: sc2.y, order: bOrder });
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

  // ── Draw cars on roads ───────────────────────────────────
  this._updateAndDrawCars(ctx, tick);

  // Placing preview
  if (this.placingBuilding && this.hoverTile) {
    var hx = this.hoverTile.x, hy = this.hoverTile.y;
    if (hx >= 0 && hx < gs && hy >= 0 && hy < gs) {
      var pBtCfg = this.buildingTypeConfig[this.placingBuilding];
      var pSize = (pBtCfg && pBtCfg.size) || 1;
      var canPlace = true;
      for (var px = hx; px < hx + pSize; px++) {
        for (var py = hy; py < hy + pSize; py++) {
          if (!this.unlockedTiles[px + ',' + py]) { canPlace = false; break; }
        }
      }
      for (var bi = 0; bi < this.buildings.length; bi++) {
        var ob = this.buildings[bi];
        var obCfg = this.buildingTypeConfig[ob.type];
        var obSize = (obCfg && obCfg.size) || 1;
        if (hx < ob.x + obSize && hx + pSize > ob.x && hy < ob.y + obSize && hy + pSize > ob.y) {
          canPlace = false; break;
        }
      }
      var hsc = this.gridToScreen(hx, hy);
      // Draw preview tiles for all cells
      for (var ppx = hx; ppx < hx + pSize; ppx++) {
        for (var ppy = hy; ppy < hy + pSize; ppy++) {
          var ppsc = this.gridToScreen(ppx, ppy);
          this._isoPath(ctx, ppsc.x, ppsc.y);
          ctx.fillStyle = canPlace ? 'rgba(85,239,196,0.25)' : 'rgba(255,107,107,0.25)';
          ctx.fill();
          ctx.strokeStyle = canPlace ? 'rgba(85,239,196,0.8)' : 'rgba(255,107,107,0.8)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
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

  // ── Road tile overlay ──────────────────────────────────────
  if (this.roadMap && this.roadMap[key]) {
    var roadB = this.roadMap[key]; // building obj stored in roadMap
    this._drawRoadTile(ctx, gx, gy, tx, ty, roadB);
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
  // Roads are drawn as tile overlays — skip normal building drawing
  if (b.type === 'road') return;
  var tw = this.tileW, th = this.tileH;

  // Multi-tile building support
  var btConfig = this.buildingTypeConfig[b.type];
  var bSize = (btConfig && btConfig.size) || 1;

  var readyKey = b.x + ',' + b.y;
  var isReady  = !!this.readyBuildings[readyKey];
  var isSel    = this.selectedTile && this.selectedTile.x === b.x && this.selectedTile.y === b.y;

  // ── Footprint highlight for multi-tile buildings ────────────
  // Draw colored overlay on ALL tiles of the footprint
  if (bSize > 1) {
    var pulse = 0.4 + 0.35 * Math.sin(tick * 0.06);
    for (var fx = b.x; fx < b.x + bSize; fx++) {
      for (var fy = b.y; fy < b.y + bSize; fy++) {
        var fsc = this.gridToScreen(fx, fy);
        this._isoPath(ctx, fsc.x, fsc.y);
        if (isSel) {
          ctx.fillStyle = 'rgba(85,239,196,' + (0.18 + pulse * 0.15) + ')';
        } else {
          ctx.fillStyle = 'rgba(108,92,231,' + (0.12 + pulse * 0.08) + ')';
        }
        ctx.fill();
        // Border on each tile
        ctx.strokeStyle = isSel
          ? ('rgba(85,239,196,' + (0.5 + pulse * 0.4) + ')')
          : ('rgba(108,92,231,' + (0.35 + pulse * 0.3) + ')');
        ctx.lineWidth = isSel ? 1.8 : 1.2;
        ctx.stroke();
      }
    }
  }

  // cx/cy = visual center of merged footprint in isometric space
  var cx = tx + (bSize - 1) * (tw / 2);
  var cy = ty + (bSize - 1) * (th / 2) + th / 2;

  // Ready glow ring around footprint tiles
  if (isReady) {
    var rpulse = 0.5 + 0.5 * Math.sin(tick * 0.08);
    for (var rx = b.x; rx < b.x + bSize; rx++) {
      for (var ry = b.y; ry < b.y + bSize; ry++) {
        var rsc = this.gridToScreen(rx, ry);
        ctx.strokeStyle = 'rgba(85,239,196,' + (0.45 + rpulse * 0.55) + ')';
        ctx.lineWidth = 2 + rpulse;
        this._isoPath(ctx, rsc.x, rsc.y - 2);
        ctx.stroke();
      }
    }
  }

  // Draw the sprite centred on (cx, cy) — scaled up for multi-tile
  ctx.save();
  ctx.translate(cx, cy);
  this._drawBuildingSprite(ctx, b.type, b.level, tw * bSize, th * bSize, tick, b.roadVariant, b.roadRotation);
  ctx.restore();

  // Level badge — bottom-right of origin tile
  var bdx = tx + tw * 0.3;
  var bdy = ty + th * 0.85;
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.beginPath();
  ctx.roundRect(bdx - 1, bdy - 1, 26, 14, 4);
  ctx.fill();
  ctx.fillStyle = bSize > 1 ? '#a29bfe' : '#55efc4';
  ctx.font = 'bold 9px Inter,Arial,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Ур.' + b.level, bdx + 12, bdy + 6);

  // Size badge for multi-tile
  if (bSize > 1) {
    var sbx = tx - tw * 0.02;
    var sby = ty + th * 0.85;
    ctx.fillStyle = 'rgba(108,92,231,0.9)';
    ctx.beginPath();
    ctx.roundRect(sbx - 13, sby - 1, 26, 14, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 8px Inter,Arial,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(bSize + 'x' + bSize, sbx, sby + 6);
  }

  // Ready check icon
  if (isReady) {
    ctx.font = '13px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✅', tx - tw * 0.25, ty + th * 0.2);
  }

  // Selection ring — draw around ALL footprint tiles
  if (isSel) {
    this._drawMultiTileSelectionRing(ctx, b.x, b.y, bSize, tick);
  }
};

// Draw selection ring around entire footprint
GameRenderer.prototype._drawMultiTileSelectionRing = function(ctx, bx, by, bSize, tick) {
  var pulse = 0.5 + 0.5 * Math.sin(tick * 0.1);
  ctx.strokeStyle = 'rgba(85,239,196,' + (0.6 + pulse * 0.4) + ')';
  ctx.lineWidth = 2.5 + pulse;
  for (var rx = bx; rx < bx + bSize; rx++) {
    for (var ry = by; ry < by + bSize; ry++) {
      var rsc = this.gridToScreen(rx, ry);
      this._isoPath(ctx, rsc.x, rsc.y - 2);
      ctx.stroke();
    }
  }
};

// ─── Building sprites ────────────────────────────────────────
//  Origin = tile visual centre (cx, cy).
//  All sprites draw around (0, 0), going UPWARD (negative y).
//
GameRenderer.prototype._drawBuildingSprite = function(ctx, type, level, tw, th, tick, roadVariant, roadRotation) {
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
    case 'windmill':    this._sWindmill(ctx, s, level, tick);   break;
    // 2x2 variants — reuse base sprite at larger scale
    case 'farm_large':      this._sFarm(ctx, s, level, tick);       break;
    case 'quarry_large':    this._sQuarry(ctx, s, level, tick);     break;
    case 'factory_large':   this._sFactory(ctx, s, level, tick);    break;
    case 'powerplant_large':this._sPowerplant(ctx, s, level, tick); break;
    case 'house_large':     this._sHouseLarge(ctx, s, level, tick); break;
    case 'warehouse_large': this._sWarehouse(ctx, s, level, tick);  break;
    case 'market_large':    this._sMarket(ctx, s, level, tick);     break;
    case 'windmill_large':  this._sWindmill(ctx, s, level, tick);   break;
    case 'bank_large':      this._sBank(ctx, s, level, tick);       break;
    case 'hospital_large':  this._sHospital(ctx, s, level, tick);   break;
    case 'stadium_large':   this._sStadium(ctx, s, level, tick);    break;
    // Decorative
    case 'townhall':     this._sTownhall(ctx, s, level, tick);    break;
    case 'church':       this._sChurch(ctx, s, level, tick);      break;
    case 'firestation':  this._sFirestation(ctx, s, level, tick); break;
    case 'centralpark':  this._sCentralPark(ctx, s, level, tick); break;
    case 'beachlake':    this._sBeachLake(ctx, s, level, tick);   break;
    // Premium
    case 'cardealer':    this._sCarDealer(ctx, s, level, tick);   break;
    case 'military':     this._sMilitary(ctx, s, level, tick);    break;
    case 'police':       this._sPolice(ctx, s, level, tick);      break;
    case 'nuclearplant': this._sNuclearPlant(ctx, s, level, tick);break;
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

// ══════════════════════════════════════════════════════════════
//  ULTRA-DETAILED BUILDING SPRITES  — every pixel counts
// ══════════════════════════════════════════════════════════════

// ── FARM ─────────────────────────────────────────────────────
GameRenderer.prototype._sFarm = function(ctx, s, level, tick) {
  var t = tick;

  // === GROUND BASE ===
  // Rich dark soil with gradient
  var soil = ctx.createRadialGradient(0, 0, s*0.05, 0, 0, s*0.52);
  soil.addColorStop(0, '#5c3317'); soil.addColorStop(0.6, '#3d2008'); soil.addColorStop(1, '#2a1205');
  ctx.fillStyle = soil;
  ctx.beginPath(); ctx.ellipse(0, -s*0.02, s*0.5, s*0.15, 0, 0, Math.PI*2); ctx.fill();

  // Plowed furrow rows
  for (var fr = -4; fr <= 4; fr++) {
    var fx = fr * s*0.1;
    var fGrad = ctx.createLinearGradient(fx-2, -s*0.12, fx+2, s*0.04);
    fGrad.addColorStop(0, '#2a1205'); fGrad.addColorStop(0.5, '#4a2810'); fGrad.addColorStop(1, '#2a1205');
    ctx.fillStyle = fGrad;
    ctx.beginPath(); ctx.ellipse(fx, -s*0.04, 2.5, s*0.1, 0, 0, Math.PI*2); ctx.fill();
  }

  // === WOODEN FENCE ===
  // Horizontal rails
  ctx.strokeStyle = '#8B5E3C'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-s*0.48, -s*0.1); ctx.lineTo(-s*0.2, -s*0.1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.48, -s*0.04); ctx.lineTo(-s*0.2, -s*0.04); ctx.stroke();
  // Fence posts left side
  for (var fp = 0; fp < 5; fp++) {
    var fpx = -s*0.48 + fp*s*0.07;
    var fpg = ctx.createLinearGradient(fpx-2, -s*0.18, fpx+2, s*0.0);
    fpg.addColorStop(0, '#92400e'); fpg.addColorStop(1, '#5c2a0a');
    ctx.fillStyle = fpg; ctx.fillRect(fpx-2, -s*0.18, 4, s*0.18);
    // Post cap
    ctx.fillStyle = '#b87040'; ctx.beginPath(); ctx.arc(fpx, -s*0.18, 3, 0, Math.PI*2); ctx.fill();
  }
  // Right fence
  ctx.strokeStyle = '#8B5E3C'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(s*0.2, -s*0.1); ctx.lineTo(s*0.5, -s*0.1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.2, -s*0.04); ctx.lineTo(s*0.5, -s*0.04); ctx.stroke();
  for (var fp2 = 0; fp2 < 5; fp2++) {
    var fpx2 = s*0.2 + fp2*s*0.075;
    ctx.fillStyle = '#7a3a15'; ctx.fillRect(fpx2-2, -s*0.18, 4, s*0.18);
    ctx.fillStyle = '#b87040'; ctx.beginPath(); ctx.arc(fpx2, -s*0.18, 3, 0, Math.PI*2); ctx.fill();
  }

  // === CROPS ===
  var rows = Math.min(4 + Math.floor(level / 2), 10);
  for (var r = 0; r < rows; r++) {
    var rx = -s*0.14 + r * (s*0.28 / Math.max(rows-1,1));
    var sway = Math.sin(t * 0.035 + r * 0.8) * 3;
    var ht = s * (0.24 + 0.08 * Math.sin(t*0.02 + r*0.5));
    // Stem
    ctx.strokeStyle = '#4a7a1a'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(rx, -s*0.06); ctx.bezierCurveTo(rx+sway*0.3, -s*0.06-ht*0.4, rx+sway*0.7, -s*0.06-ht*0.7, rx+sway, -s*0.06-ht); ctx.stroke();
    // Leaves at intervals
    for (var lf = 0; lf < 3; lf++) {
      var lp = (lf+1)/4; var ly = -s*0.06-ht*lp; var lx = rx+sway*lp;
      ctx.strokeStyle = '#5a9a22'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(lx, ly);
      ctx.quadraticCurveTo(lx+(lf%2===0?10:-10), ly-6, lx+(lf%2===0?16:-16), ly-2); ctx.stroke();
    }
    // Wheat head — detailed
    var hx = rx+sway, hy = -s*0.06-ht;
    var wg = ctx.createLinearGradient(hx, hy-12, hx, hy);
    wg.addColorStop(0, '#f4d03f'); wg.addColorStop(0.5, '#e8b740'); wg.addColorStop(1, '#c8900a');
    ctx.fillStyle = wg;
    ctx.beginPath(); ctx.ellipse(hx, hy-6, 3.5, 9, sway*0.05, 0, Math.PI*2); ctx.fill();
    // Awns (barbs sticking out)
    ctx.strokeStyle = '#d4900a'; ctx.lineWidth = 0.7;
    for (var aw = 0; aw < 4; aw++) {
      ctx.beginPath(); ctx.moveTo(hx, hy-aw*3); ctx.lineTo(hx+6, hy-aw*3-4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx, hy-aw*3); ctx.lineTo(hx-6, hy-aw*3-4); ctx.stroke();
    }
  }

  // === BARN (main building) ===
  // Foundation
  ctx.fillStyle = '#6b4a2a'; ctx.fillRect(-s*0.28, -s*0.04, s*0.38, s*0.04);
  // Main body
  this._isoBox(ctx, -s*0.26, -s*0.52, s*0.4, s*0.48, 18, 68, 34);
  // Barn wood planks texture
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.8;
  for (var plk = 0; plk < 6; plk++) {
    ctx.beginPath(); ctx.moveTo(-s*0.26, -s*0.52 + plk*s*0.08); ctx.lineTo(s*0.14, -s*0.52 + plk*s*0.08); ctx.stroke();
  }
  // Vertical plank seams
  for (var vp = 0; vp < 4; vp++) {
    ctx.beginPath(); ctx.moveTo(-s*0.26 + vp*s*0.1, -s*0.52); ctx.lineTo(-s*0.26 + vp*s*0.1, -s*0.04); ctx.stroke();
  }
  // Main barn roof
  var roofG = ctx.createLinearGradient(-s*0.3, -s*0.76, s*0.18, -s*0.52);
  roofG.addColorStop(0, '#c0392b'); roofG.addColorStop(0.5, '#a93226'); roofG.addColorStop(1, '#7b241c');
  ctx.fillStyle = roofG;
  ctx.beginPath(); ctx.moveTo(-s*0.3, -s*0.52); ctx.lineTo(-s*0.06, -s*0.76); ctx.lineTo(s*0.18, -s*0.52); ctx.closePath(); ctx.fill();
  // Roof ridge cap
  ctx.strokeStyle = '#5a1a12'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-s*0.3, -s*0.52); ctx.lineTo(-s*0.06, -s*0.76); ctx.lineTo(s*0.18, -s*0.52); ctx.stroke();
  // Roof shingles
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.6;
  for (var sh = 1; sh < 5; sh++) {
    var sy = -s*0.52 - sh*s*0.048; var sw = s*0.48 - sh*s*0.07;
    ctx.beginPath(); ctx.moveTo(-s*0.06-sw/2, sy); ctx.lineTo(-s*0.06+sw/2, sy); ctx.stroke();
  }
  // Hay loft vent window
  ctx.fillStyle = '#1a0a00'; ctx.beginPath(); ctx.arc(-s*0.06, -s*0.62, s*0.06, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#8B5E3C'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(-s*0.06, -s*0.62, s*0.06, 0, Math.PI*2); ctx.stroke();
  // Loft X cross
  ctx.strokeStyle = '#6b3a1a'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-s*0.1, -s*0.66); ctx.lineTo(-s*0.02, -s*0.58); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.02, -s*0.66); ctx.lineTo(-s*0.1, -s*0.58); ctx.stroke();
  // Main barn doors (double)
  ctx.fillStyle = '#2d1506';
  ctx.beginPath(); ctx.roundRect(-s*0.2, -s*0.44, s*0.13, s*0.4, [2,2,0,0]); ctx.fill();
  ctx.beginPath(); ctx.roundRect(-s*0.06, -s*0.44, s*0.13, s*0.4, [2,2,0,0]); ctx.fill();
  // Door panels
  ctx.strokeStyle = '#5c3010'; ctx.lineWidth = 0.7;
  ctx.strokeRect(-s*0.18, -s*0.42, s*0.09, s*0.15); ctx.strokeRect(-s*0.18, -s*0.26, s*0.09, s*0.1);
  ctx.strokeRect(-s*0.04, -s*0.42, s*0.09, s*0.15); ctx.strokeRect(-s*0.04, -s*0.26, s*0.09, s*0.1);
  // Door hinges
  ctx.fillStyle = '#444'; ctx.beginPath(); ctx.arc(-s*0.07, -s*0.38, 2, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(-s*0.07, -s*0.28, 2, 0, Math.PI*2); ctx.fill();
  // Door gap line
  ctx.strokeStyle = '#1a0800'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-s*0.07, -s*0.44); ctx.lineTo(-s*0.07, -s*0.04); ctx.stroke();
  // Haybale inside barn (visible through door)
  ctx.fillStyle = '#d4a835';
  ctx.beginPath(); ctx.ellipse(-s*0.06, -s*0.14, s*0.05, s*0.04, 0, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#b8920a'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(-s*0.06, -s*0.18); ctx.lineTo(-s*0.06, -s*0.1); ctx.stroke();

  // === SILO ===
  var siloG = ctx.createLinearGradient(s*0.18, -s*0.52, s*0.34, 0);
  siloG.addColorStop(0, '#c8c8b8'); siloG.addColorStop(0.5, '#e8e8d8'); siloG.addColorStop(1, '#a8a898');
  ctx.fillStyle = siloG;
  ctx.beginPath(); ctx.rect(s*0.18, -s*0.48, s*0.14, s*0.48); ctx.fill();
  // Silo dome
  ctx.fillStyle = '#b0b0a0';
  ctx.beginPath(); ctx.ellipse(s*0.25, -s*0.48, s*0.07, s*0.04, 0, 0, Math.PI*2); ctx.fill();
  // Silo bands
  ctx.strokeStyle = '#888878'; ctx.lineWidth = 0.8;
  for (var sb = 1; sb < 5; sb++) { ctx.beginPath(); ctx.moveTo(s*0.18, -s*0.48+sb*s*0.1); ctx.lineTo(s*0.32, -s*0.48+sb*s*0.1); ctx.stroke(); }
  // Silo ladder
  ctx.strokeStyle = '#666'; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.moveTo(s*0.19, -s*0.46); ctx.lineTo(s*0.19, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.22, -s*0.46); ctx.lineTo(s*0.22, 0); ctx.stroke();
  for (var sl = 0; sl < 6; sl++) { ctx.beginPath(); ctx.moveTo(s*0.19, -s*0.38+sl*s*0.065); ctx.lineTo(s*0.22, -s*0.38+sl*s*0.065); ctx.stroke(); }

  // === WEATHERVANE ===
  ctx.strokeStyle = '#888'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-s*0.06, -s*0.76); ctx.lineTo(-s*0.06, -s*0.86); ctx.stroke();
  var wva = t * 0.018;
  ctx.fillStyle = '#ccc';
  ctx.beginPath(); ctx.moveTo(-s*0.06+Math.cos(wva)*10, -s*0.86+Math.sin(wva)*5);
  ctx.lineTo(-s*0.06, -s*0.86); ctx.lineTo(-s*0.06+Math.cos(wva+Math.PI)*7, -s*0.86+Math.sin(wva+Math.PI)*3);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#aaa'; ctx.beginPath(); ctx.arc(-s*0.06, -s*0.86, 2.5, 0, Math.PI*2); ctx.fill();
  // Cardinal letters
  ctx.fillStyle = 'rgba(180,180,180,0.8)'; ctx.font = 'bold 5px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('N', -s*0.06, -s*0.92);

  // === ANIMALS ===
  if (level >= 3) {
    // Chickens animated
    var ck1 = Math.sin(t*0.08) > 0.5 ? '🐔' : '🐓';
    ctx.font = '9px Arial'; ctx.textAlign='center';
    ctx.fillText(ck1, -s*0.38, -s*0.18 + Math.abs(Math.sin(t*0.12))*3);
    if (level >= 5) ctx.fillText('🐄', -s*0.44, -s*0.22);
  }

  // === IRRIGATION CHANNELS ===
  ctx.strokeStyle = 'rgba(64,164,224,0.5)'; ctx.lineWidth = 1.5;
  ctx.setLineDash([3,4]);
  ctx.beginPath(); ctx.moveTo(-s*0.14, s*0.0); ctx.lineTo(s*0.14, s*0.0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -s*0.14); ctx.lineTo(0, s*0.0); ctx.stroke();
  ctx.setLineDash([]);

  // Water droplets animated
  var wd = (t * 0.1) % 1;
  ctx.fillStyle = 'rgba(64,164,224,' + (0.6-wd*0.6) + ')';
  ctx.beginPath(); ctx.arc(-s*0.07, -s*0.07 - wd*s*0.1, 2, 0, Math.PI*2); ctx.fill();
};

// ── HOUSE ────────────────────────────────────────────────────
GameRenderer.prototype._sHouse = function(ctx, s, level, tick) {
  var t = tick;
  var floors = Math.min(1 + Math.floor(level / 5), 4);
  var fh = s * 0.25;

  // === GARDEN / LAWN ===
  var lawn = ctx.createRadialGradient(0, s*0.02, 0, 0, s*0.02, s*0.46);
  lawn.addColorStop(0, '#2d7a22'); lawn.addColorStop(1, '#1a5214');
  ctx.fillStyle = lawn;
  ctx.beginPath(); ctx.ellipse(0, s*0.02, s*0.46, s*0.08, 0, 0, Math.PI*2); ctx.fill();
  // Grass tufts
  ctx.strokeStyle = '#3a9a2a'; ctx.lineWidth = 1;
  for (var gt = 0; gt < 12; gt++) {
    var gtx = -s*0.44 + gt*s*0.08, gts = Math.sin(t*0.04+gt)*1.5;
    ctx.beginPath(); ctx.moveTo(gtx, s*0.04); ctx.lineTo(gtx+gts, s*0.0); ctx.stroke();
  }
  // Paved path to door
  ctx.fillStyle = '#d4c8b0';
  ctx.beginPath(); ctx.moveTo(-s*0.07, s*0.02); ctx.lineTo(s*0.07, s*0.02); ctx.lineTo(s*0.055, s*0.08); ctx.lineTo(-s*0.055, s*0.08); ctx.closePath(); ctx.fill();
  // Path stones
  for (var ps = 0; ps < 3; ps++) {
    ctx.fillStyle = ps%2===0 ? '#c4b89e' : '#b8ac92';
    ctx.beginPath(); ctx.ellipse(0, s*0.03 + ps*s*0.02, s*0.025, s*0.008, 0, 0, Math.PI*2); ctx.fill();
  }
  // Flower beds
  var flowerColors = ['#e53e3e','#d69e2e','#e53e3e','#a855f7'];
  for (var fl = 0; fl < 4; fl++) {
    var flx = (fl < 2 ? -s*0.42 : s*0.3) + (fl%2)*s*0.06;
    ctx.fillStyle = '#2d5a1a'; ctx.fillRect(flx, -s*0.02, s*0.08, s*0.04);
    ctx.fillStyle = flowerColors[fl];
    for (var fb = 0; fb < 3; fb++) {
      ctx.beginPath(); ctx.arc(flx+s*0.01+fb*s*0.03, -s*0.02-3+Math.sin(t*0.05+fl+fb)*1.5, 2.5, 0, Math.PI*2); ctx.fill();
    }
  }

  // === MAIN STRUCTURE (multi-floor) ===
  var wallColors = [[33,55,52],[28,50,48],[32,48,50],[27,45,54]];
  for (var f = 0; f < floors; f++) {
    var fy = -(f * fh);
    var wc = wallColors[f % 4];
    this._isoBox(ctx, -s*0.4, fy - fh, s*0.8, fh, wc[0], wc[1], wc[2]);
    // Brick coursing on each floor
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    for (var brow = 0; brow < 4; brow++) {
      for (var bcol = 0; bcol < 6; bcol++) {
        var offset = brow%2===0 ? 0 : s*0.065;
        ctx.fillRect(-s*0.38 + bcol*s*0.13 + offset, fy-fh + brow*s*0.06, s*0.12, s*0.055);
      }
    }
    // Window sills (stone)
    ctx.fillStyle = '#c8c0a8';
    // Left window
    ctx.fillRect(-s*0.34, fy-fh+s*0.17, s*0.17, s*0.02);
    // Right window
    ctx.fillRect(s*0.0, fy-fh+s*0.17, s*0.17, s*0.02);
    // Windows with detailed frames
    this._drawDetailedWindow(ctx, -s*0.32, fy-fh+s*0.04, s*0.13, s*0.13, f===0, t);
    this._drawDetailedWindow(ctx, s*0.02, fy-fh+s*0.04, s*0.13, s*0.13, f%2===1, t);
    if (f >= 2) this._drawDetailedWindow(ctx, -s*0.1, fy-fh+s*0.04, s*0.11, s*0.11, false, t);
    // Floor separator ledge
    if (f > 0) {
      ctx.fillStyle = '#c8c0a8';
      ctx.fillRect(-s*0.42, fy, s*0.84, s*0.025);
    }
    // Balcony on upper floors
    if (f > 0 && f < floors) {
      // Balcony slab
      ctx.fillStyle = '#d4c8b0'; ctx.fillRect(-s*0.36, fy+s*0.005, s*0.72, s*0.025);
      // Balcony railing posts
      ctx.strokeStyle = '#8a7a6a'; ctx.lineWidth = 0.8;
      for (var rp = -4; rp <= 4; rp++) {
        ctx.beginPath(); ctx.moveTo(rp*s*0.08, fy); ctx.lineTo(rp*s*0.08, fy-s*0.1); ctx.stroke();
      }
      // Top rail
      ctx.strokeStyle = '#a89a8a'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-s*0.36, fy-s*0.1); ctx.lineTo(s*0.36, fy-s*0.1); ctx.stroke();
      // Flower pot on balcony
      ctx.fillStyle = '#b53a1a'; ctx.fillRect(-s*0.32, fy-s*0.1, s*0.06, s*0.04);
      ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(-s*0.29, fy-s*0.12, 4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(-s*0.29, fy-s*0.15, 3, 0, Math.PI*2); ctx.fill();
    }
  }

  // === ROOF ===
  var ry = -(floors * fh);
  // Main roof faces (hip roof)
  var roofFront = ctx.createLinearGradient(-s*0.44, ry, 0, ry-s*0.34);
  roofFront.addColorStop(0, '#7a1515'); roofFront.addColorStop(1, '#5a0f0f');
  ctx.fillStyle = roofFront;
  ctx.beginPath(); ctx.moveTo(-s*0.44, ry); ctx.lineTo(0, ry-s*0.34); ctx.lineTo(s*0.44, ry); ctx.closePath(); ctx.fill();
  // Roof shingles - horizontal lines
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.8;
  for (var rsh = 1; rsh < 5; rsh++) {
    var rsy = ry + rsh*s*0.068; var rsw = s*0.88 - rsh*s*0.14;
    ctx.beginPath(); ctx.moveTo(-rsw/2, rsy); ctx.lineTo(rsw/2, rsy); ctx.stroke();
  }
  // Ridge cap highlight
  ctx.strokeStyle = '#8b1a1a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-s*0.44, ry); ctx.lineTo(0, ry-s*0.34); ctx.lineTo(s*0.44, ry); ctx.stroke();
  // Gutter along eave
  ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-s*0.44, ry); ctx.lineTo(s*0.44, ry); ctx.stroke();

  // Dormer window
  if (floors >= 2) {
    this._isoBox(ctx, -s*0.12, ry-s*0.24, s*0.24, s*0.16, 30, 50, 48);
    var dg = ctx.createLinearGradient(-s*0.15, ry-s*0.34, s*0.15, ry-s*0.24);
    dg.addColorStop(0, '#7a1515'); dg.addColorStop(1, '#5a0f0f');
    ctx.fillStyle = dg;
    ctx.beginPath(); ctx.moveTo(-s*0.15, ry-s*0.24); ctx.lineTo(0, ry-s*0.36); ctx.lineTo(s*0.15, ry-s*0.24); ctx.closePath(); ctx.fill();
    this._drawDetailedWindow(ctx, -s*0.08, ry-s*0.22, s*0.16, s*0.12, false, t);
  }

  // === CHIMNEY with detailed brickwork ===
  var chx = s*0.12, chy = ry - s*0.42;
  // Chimney body - multiple brick layers
  for (var cl = 0; cl < 5; cl++) {
    var clg = ctx.createLinearGradient(chx, chy+cl*s*0.07, chx+s*0.1, chy+(cl+1)*s*0.07);
    clg.addColorStop(0, '#7d4a32'); clg.addColorStop(1, '#5d3020');
    ctx.fillStyle = clg; ctx.fillRect(chx, chy+cl*s*0.07, s*0.1, s*0.07);
    // Mortar line
    ctx.strokeStyle = '#c8b8a0'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(chx, chy+(cl+1)*s*0.07); ctx.lineTo(chx+s*0.1, chy+(cl+1)*s*0.07); ctx.stroke();
    // Brick seams
    var boff = cl%2===0 ? 0 : s*0.025;
    ctx.beginPath(); ctx.moveTo(chx+boff+s*0.025, chy+cl*s*0.07); ctx.lineTo(chx+boff+s*0.025, chy+(cl+1)*s*0.07); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(chx+boff+s*0.07, chy+cl*s*0.07); ctx.lineTo(chx+boff+s*0.07, chy+(cl+1)*s*0.07); ctx.stroke();
  }
  // Chimney cap
  ctx.fillStyle = '#4a3020'; ctx.fillRect(chx-s*0.014, ry-s*0.44, s*0.128, s*0.025);
  // Chimney pot
  ctx.fillStyle = '#c87050'; ctx.beginPath(); ctx.arc(chx+s*0.05, ry-s*0.44, s*0.025, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#1a0a00'; ctx.beginPath(); ctx.arc(chx+s*0.05, ry-s*0.44, s*0.016, 0, Math.PI*2); ctx.fill();
  // Smoke puffs
  this._smoke(ctx, chx+s*0.05, ry-s*0.46, t, 0);
  this._smoke(ctx, chx+s*0.05, ry-s*0.46, t, 16);
  this._smoke(ctx, chx+s*0.05, ry-s*0.46, t, 32);

  // === FRONT DOOR (detailed) ===
  // Door frame
  ctx.fillStyle = '#f0e8d8'; ctx.fillRect(-s*0.1, -s*0.25, s*0.2, s*0.025);
  ctx.fillRect(-s*0.1, -s*0.25, s*0.025, s*0.25); ctx.fillRect(s*0.075, -s*0.25, s*0.025, s*0.25);
  // Door body
  ctx.fillStyle = '#4a2800';
  ctx.beginPath(); ctx.roundRect(-s*0.075, -s*0.25, s*0.15, s*0.25, [0,0,0,0]); ctx.fill();
  // Door panels
  ctx.strokeStyle = '#6b3810'; ctx.lineWidth = 0.7;
  ctx.strokeRect(-s*0.06, -s*0.23, s*0.11, s*0.08);
  ctx.strokeRect(-s*0.06, -s*0.14, s*0.11, s*0.08);
  // Door glass panel top
  ctx.fillStyle = 'rgba(186,230,253,0.4)'; ctx.fillRect(-s*0.05, -s*0.22, s*0.09, s*0.06);
  // Doorknob
  ctx.fillStyle = '#d4af37'; ctx.beginPath(); ctx.arc(s*0.05, -s*0.13, 2.5, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#b8960a'; ctx.beginPath(); ctx.arc(s*0.05, -s*0.13, 1.5, 0, Math.PI*2); ctx.fill();
  // Door number
  ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 6px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(((level*7+3)%98+1)+'', 0, -s*0.06);

  // === PORCH LIGHT ===
  var pl = 0.6 + 0.4*Math.sin(t*0.06);
  ctx.shadowColor = '#fef9c3'; ctx.shadowBlur = 14*pl;
  ctx.fillStyle = '#fef9c3'; ctx.beginPath(); ctx.arc(-s*0.12, -s*0.26, 3, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
  // Light cone
  ctx.fillStyle = 'rgba(255,250,200,0.08)';
  ctx.beginPath(); ctx.moveTo(-s*0.12, -s*0.26); ctx.lineTo(-s*0.22, -s*0.02); ctx.lineTo(-s*0.02, -s*0.02); ctx.closePath(); ctx.fill();

  // === STREET LAMP ===
  ctx.strokeStyle = '#4a4a4a'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(s*0.38, s*0.02); ctx.lineTo(s*0.38, -s*0.52); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.38, -s*0.52); ctx.bezierCurveTo(s*0.38, -s*0.62, s*0.28, -s*0.62, s*0.26, -s*0.56); ctx.stroke();
  // Lamp head
  ctx.fillStyle = '#333'; ctx.fillRect(s*0.2, -s*0.59, s*0.12, s*0.06);
  var sl2 = 0.7 + 0.3*Math.sin(t*0.07+1);
  ctx.shadowColor = '#fffde0'; ctx.shadowBlur = 18*sl2;
  ctx.fillStyle = 'rgba(255,253,220,'+sl2+')';
  ctx.beginPath(); ctx.arc(s*0.26, -s*0.56, 4, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
  // Lamp post base
  ctx.fillStyle = '#333'; ctx.fillRect(s*0.36, s*0.02, s*0.04, s*0.02);

  // === MAILBOX ===
  ctx.fillStyle = '#1d4ed8'; ctx.fillRect(-s*0.48, -s*0.1, s*0.1, s*0.07);
  ctx.fillStyle = '#1e3a8a'; ctx.fillRect(-s*0.48, -s*0.1, s*0.1, s*0.02);
  // Flag
  ctx.fillStyle = '#dc2626'; ctx.fillRect(-s*0.38, -s*0.16, s*0.04, s*0.08);
  ctx.fillStyle = '#dc2626'; ctx.fillRect(-s*0.38, -s*0.16, s*0.05, s*0.03);
  // Post
  ctx.fillStyle = '#888'; ctx.fillRect(-s*0.43, -s*0.02, s*0.02, s*0.04);
};

// Helper for detailed windows
GameRenderer.prototype._drawDetailedWindow = function(ctx, x, y, w, h, lit, tick) {
  // Outer frame
  ctx.fillStyle = '#e8e0d0'; ctx.fillRect(x-2, y-2, w+4, h+4);
  // Glass panes
  if (lit || Math.floor(tick/35) % 2 === 0) {
    ctx.shadowColor = '#fde68a'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#fef3c7';
  } else {
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(186,230,253,0.75)';
  }
  ctx.fillRect(x, y, w, h);
  // Inner frame dividers
  ctx.strokeStyle = '#c8c0b0'; ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.beginPath(); ctx.moveTo(x+w/2, y); ctx.lineTo(x+w/2, y+h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y+h/2); ctx.lineTo(x+w, y+h/2); ctx.stroke();
  // Curtain hint
  if (lit) {
    ctx.fillStyle = 'rgba(255,160,50,0.25)';
    ctx.fillRect(x, y, w*0.22, h); ctx.fillRect(x+w*0.78, y, w*0.22, h);
  }
  ctx.shadowBlur = 0;
};

// ── QUARRY ───────────────────────────────────────────────────
GameRenderer.prototype._sQuarry = function(ctx, s, level, tick) {
  var t = tick;

  // === PIT ===
  var pit = ctx.createRadialGradient(0, -s*0.04, s*0.06, 0, -s*0.04, s*0.48);
  pit.addColorStop(0, '#2d2d2d'); pit.addColorStop(0.5, '#4a4a4a'); pit.addColorStop(1, '#6b6b6b');
  ctx.fillStyle = pit;
  ctx.beginPath(); ctx.ellipse(0, -s*0.04, s*0.48, s*0.18, 0, 0, Math.PI*2); ctx.fill();
  // Pit rim
  ctx.strokeStyle = '#5a5a5a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, -s*0.04, s*0.48, s*0.18, 0, 0, Math.PI*2); ctx.stroke();
  // Rock floor texture
  ctx.strokeStyle = 'rgba(80,80,80,0.4)'; ctx.lineWidth = 0.5;
  for (var rf = 0; rf < 8; rf++) {
    var rfa = rf * Math.PI/4, rfr = s*(0.1+rf*0.035);
    ctx.beginPath(); ctx.moveTo(Math.cos(rfa)*rfr, -s*0.04+Math.sin(rfa)*rfr*0.38);
    ctx.lineTo(Math.cos(rfa+0.5)*rfr*1.1, -s*0.04+Math.sin(rfa+0.5)*rfr*0.38*1.1); ctx.stroke();
  }
  // Pit depth shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, -s*0.04, s*0.26, s*0.1, 0, 0, Math.PI*2); ctx.fill();

  // === ROCK FORMATIONS ===
  var rockData = [
    {x:-s*0.18,y:-s*0.34,rx:s*0.16,ry:s*0.2,angle:-8,h:240,s2:8,l:44},
    {x: s*0.02,y:-s*0.52,rx:s*0.13,ry:s*0.17,angle: 4,h:245,s2:6,l:46},
    {x: s*0.2, y:-s*0.36,rx:s*0.15,ry:s*0.19,angle:-5,h:238,s2:7,l:42},
    {x:-s*0.08,y:-s*0.22,rx:s*0.08,ry:s*0.1, angle: 6,h:242,s2:5,l:48},
    {x: s*0.14,y:-s*0.22,rx:s*0.07,ry:s*0.09,angle:-3,h:235,s2:6,l:45},
  ];
  rockData.forEach(function(r, i) {
    ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.angle * Math.PI/180);
    // Main rock body
    var rg = ctx.createLinearGradient(-r.rx, -r.ry, r.rx, r.ry);
    rg.addColorStop(0, 'hsl('+r.h+','+r.s2+'%,'+(r.l+14)+'%)');
    rg.addColorStop(0.4, 'hsl('+r.h+','+r.s2+'%,'+r.l+'%)');
    rg.addColorStop(1, 'hsl('+r.h+','+r.s2+'%,'+(r.l-12)+'%)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.ellipse(0, 0, r.rx, r.ry, 0, 0, Math.PI*2); ctx.fill();
    // Rock highlight (top-left)
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.ellipse(-r.rx*0.28, -r.ry*0.32, r.rx*0.38, r.ry*0.28, 0, 0, Math.PI*2); ctx.fill();
    // Crack lines
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-r.rx*0.2, -r.ry*0.3); ctx.lineTo(r.rx*0.1, r.ry*0.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r.rx*0.15, -r.ry*0.4); ctx.lineTo(-r.rx*0.05, r.ry*0.1); ctx.stroke();
    // Mineral veins
    ctx.strokeStyle = 'rgba(200,200,180,0.3)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(-r.rx*0.4, 0); ctx.quadraticCurveTo(0, -r.ry*0.2, r.rx*0.3, r.ry*0.1); ctx.stroke();
    ctx.restore();
  });

  // === CRANE / DERRICK ===
  // Base platform
  ctx.fillStyle = '#5a4a2a'; ctx.fillRect(s*0.14, -s*0.08, s*0.26, s*0.08);
  ctx.strokeStyle = '#4a3a1a'; ctx.lineWidth = 0.5;
  for (var cp = 0; cp < 3; cp++) { ctx.beginPath(); ctx.moveTo(s*0.14+cp*s*0.09, -s*0.08); ctx.lineTo(s*0.14+cp*s*0.09, 0); ctx.stroke(); }
  // Derrick frame
  ctx.strokeStyle = '#888'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(s*0.22, -s*0.06); ctx.lineTo(s*0.16, -s*0.68); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.3, -s*0.06); ctx.lineTo(s*0.36, -s*0.68); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.16, -s*0.68); ctx.lineTo(s*0.36, -s*0.68); ctx.stroke();
  // Cross braces
  ctx.lineWidth = 0.8;
  for (var cr = 0; cr < 4; cr++) {
    var cry = -s*0.08 - cr*s*0.15;
    ctx.beginPath(); ctx.moveTo(s*0.16+cr*s*0.012, cry); ctx.lineTo(s*0.36-cr*s*0.012, cry-s*0.12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s*0.36-cr*s*0.012, cry); ctx.lineTo(s*0.16+cr*s*0.012, cry-s*0.12); ctx.stroke();
  }
  // Boom arm
  ctx.strokeStyle = '#aaa'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(s*0.26, -s*0.68); ctx.lineTo(-s*0.06, -s*0.74); ctx.stroke();
  // Pulley
  ctx.fillStyle = '#666'; ctx.beginPath(); ctx.arc(-s*0.06, -s*0.74, 5, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#888'; ctx.beginPath(); ctx.arc(-s*0.06, -s*0.74, 3, 0, Math.PI*2); ctx.fill();
  // Cable
  ctx.strokeStyle = '#777'; ctx.lineWidth = 1;
  var cableLen = s*0.3 + Math.abs(Math.sin(t*0.02))*s*0.15;
  ctx.beginPath(); ctx.moveTo(-s*0.06, -s*0.74); ctx.lineTo(-s*0.06, -s*0.74+cableLen); ctx.stroke();
  // Hook
  ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(-s*0.06, -s*0.74+cableLen, 4, -Math.PI*0.5, Math.PI*0.6); ctx.stroke();

  // === PICKAXE animation ===
  var sw = Math.sin(t * 0.1) * 0.5;
  ctx.save(); ctx.translate(-s*0.3, -s*0.44); ctx.rotate(-Math.PI*0.25 + sw);
  // Handle
  var hg = ctx.createLinearGradient(0, 0, 0, s*0.32);
  hg.addColorStop(0, '#a05c2a'); hg.addColorStop(1, '#7a3c10');
  ctx.strokeStyle = hg; ctx.lineWidth = 4; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, s*0.32); ctx.stroke();
  // Handle grip wrap
  ctx.strokeStyle = 'rgba(80,40,10,0.4)'; ctx.lineWidth = 5;
  ctx.setLineDash([3,4]);
  ctx.beginPath(); ctx.moveTo(0, s*0.18); ctx.lineTo(0, s*0.32); ctx.stroke();
  ctx.setLineDash([]);
  // Pick head
  var phg = ctx.createLinearGradient(-10, -8, 10, 2);
  phg.addColorStop(0, '#d1d5db'); phg.addColorStop(0.5, '#9ca3af'); phg.addColorStop(1, '#6b7280');
  ctx.fillStyle = phg;
  ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.lineTo(6, -10); ctx.lineTo(-6, -10); ctx.closePath(); ctx.fill();
  // Pick tip highlight
  ctx.fillStyle = '#e5e7eb';
  ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-6, -10); ctx.lineTo(-4, -5); ctx.closePath(); ctx.fill();
  // Pick rear (blunt end)
  ctx.fillStyle = '#9ca3af';
  ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-14, -3); ctx.lineTo(-13, -7); ctx.lineTo(-8, -8); ctx.closePath(); ctx.fill();
  // Dust particles on impact
  if (Math.abs(sw) > 0.38) {
    ctx.fillStyle = 'rgba(200,190,150,0.7)';
    for (var dp = 0; dp < 5; dp++) {
      ctx.beginPath(); ctx.arc(Math.cos(dp*1.3)*8+Math.random()*4, s*0.36+Math.sin(dp)*4, 1.5+Math.random()*2, 0, Math.PI*2); ctx.fill();
    }
  }
  ctx.restore();

  // === MINECART TRACK ===
  ctx.strokeStyle = '#6b5030'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-s*0.46, s*0.02); ctx.lineTo(-s*0.06, -s*0.06); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.38, s*0.02); ctx.lineTo(s*0.02, -s*0.06); ctx.stroke();
  // Track ties
  ctx.strokeStyle = '#4a3420'; ctx.lineWidth = 1.5;
  for (var tk = 0; tk < 5; tk++) {
    var tkx = -s*0.42 + tk*s*0.1;
    ctx.beginPath(); ctx.moveTo(tkx, s*0.025+tk*s*0.004); ctx.lineTo(tkx+s*0.06, -s*0.04+tk*s*0.004); ctx.stroke();
  }
  // Minecart
  var cartX = -s*0.32 + Math.sin(t*0.025)*s*0.12;
  ctx.fillStyle = '#5a4a30'; ctx.fillRect(cartX, -s*0.14, s*0.16, s*0.1);
  // Cart body detail
  ctx.strokeStyle = '#3a2a10'; ctx.lineWidth = 0.5;
  ctx.strokeRect(cartX+2, -s*0.12, s*0.12, s*0.07);
  // Cart wheels
  ctx.fillStyle = '#333';
  ctx.beginPath(); ctx.arc(cartX+s*0.04, -s*0.04, 4, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cartX+s*0.12, -s*0.04, 4, 0, Math.PI*2); ctx.fill();
  // Cart contents (rocks)
  ctx.fillStyle = '#888'; ctx.beginPath(); ctx.ellipse(cartX+s*0.08, -s*0.12, s*0.05, s*0.04, 0, 0, Math.PI*2); ctx.fill();

  // === SAFETY SIGNS ===
  ctx.fillStyle = '#fbbf24'; ctx.fillRect(s*0.06, -s*0.52, s*0.1, s*0.08);
  ctx.fillStyle = '#1a1a00'; ctx.font = 'bold 6px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('⚠️', s*0.11, -s*0.48);
};

// ── FACTORY ──────────────────────────────────────────────────
GameRenderer.prototype._sFactory = function(ctx, s, level, tick) {
  var t = tick;

  // === GROUND / INDUSTRIAL YARD ===
  var yard = ctx.createLinearGradient(-s*0.5, 0, s*0.5, 0);
  yard.addColorStop(0, '#374151'); yard.addColorStop(0.5, '#4b5563'); yard.addColorStop(1, '#374151');
  ctx.fillStyle = yard;
  ctx.beginPath(); ctx.ellipse(0, s*0.02, s*0.54, s*0.09, 0, 0, Math.PI*2); ctx.fill();
  // Concrete cracks
  ctx.strokeStyle = '#2d3748'; ctx.lineWidth = 0.6; ctx.setLineDash([3,5]);
  ctx.beginPath(); ctx.moveTo(-s*0.4, s*0.01); ctx.lineTo(-s*0.15, s*0.04); ctx.lineTo(s*0.1, s*0.01); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.2, s*0.01); ctx.lineTo(s*0.42, s*0.03); ctx.stroke();
  ctx.setLineDash([]);
  // Road markings
  ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
  ctx.beginPath(); ctx.moveTo(-s*0.1, s*0.04); ctx.lineTo(s*0.1, s*0.04); ctx.stroke();
  ctx.setLineDash([]);

  // === MAIN FACTORY BUILDING ===
  this._isoBox(ctx, -s*0.46, -s*0.58, s*0.92, s*0.58, 218, 14, 36);
  // Concrete texture - horizontal bands
  ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.7;
  for (var band = 1; band < 6; band++) { ctx.beginPath(); ctx.moveTo(-s*0.46, -s*0.58+band*s*0.096); ctx.lineTo(s*0.46, -s*0.58+band*s*0.096); ctx.stroke(); }
  // Vertical expansion joints
  ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1;
  for (var vj = -3; vj <= 3; vj++) { ctx.beginPath(); ctx.moveTo(vj*s*0.14, -s*0.58); ctx.lineTo(vj*s*0.14, 0); ctx.stroke(); }

  // === ROOF ===
  ctx.fillStyle = '#3d4a5a'; ctx.fillRect(-s*0.48, -s*0.6, s*0.96, s*0.04);
  // Parapet crenelations
  for (var pc = 0; pc < 9; pc++) {
    ctx.fillStyle = pc%2===0 ? '#334155' : '#3d4a5a';
    ctx.fillRect(-s*0.46+pc*s*0.103, -s*0.64, s*0.085, s*0.06);
  }
  // Roof equipment - AC units, vents
  for (var rv = 0; rv < 3; rv++) {
    var rvx = -s*0.32 + rv*s*0.32;
    ctx.fillStyle = '#4a5568'; ctx.fillRect(rvx, -s*0.62, s*0.1, s*0.05);
    ctx.fillStyle = '#2d3748'; ctx.fillRect(rvx+s*0.01, -s*0.63, s*0.08, s*0.02);
    // AC fan animated
    var fanR = t*0.12 + rv*Math.PI*0.66;
    ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 0.8;
    for (var fb2 = 0; fb2 < 3; fb2++) {
      var fa = fanR + fb2*Math.PI*0.66;
      ctx.beginPath(); ctx.moveTo(rvx+s*0.05, -s*0.635); ctx.lineTo(rvx+s*0.05+Math.cos(fa)*4, -s*0.635+Math.sin(fa)*2); ctx.stroke();
    }
  }
  // Warning lights on roof edges
  var wl = Math.floor(t/22)%2===0;
  ctx.shadowColor = '#ef4444'; ctx.shadowBlur = wl ? 14 : 0;
  ctx.fillStyle = wl ? '#ef4444' : '#7f1d1d';
  ctx.beginPath(); ctx.arc(-s*0.42, -s*0.62, 4, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowColor = '#3b82f6'; ctx.shadowBlur = wl ? 0 : 14;
  ctx.fillStyle = wl ? '#1d4ed8' : '#3b82f6';
  ctx.beginPath(); ctx.arc(s*0.42, -s*0.62, 4, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;

  // === INDUSTRIAL WINDOWS (3 bays) ===
  for (var bay = 0; bay < 3; bay++) {
    var bx = -s*0.38 + bay*s*0.28;
    // Window bay frame
    this._isoBox(ctx, bx, -s*0.5, s*0.2, s*0.34, 208, 28, 50);
    // Multi-pane window
    ctx.fillStyle = bay===1 ? 'rgba(255,250,180,0.85)' : 'rgba(186,230,253,0.6)';
    if (bay===1) { ctx.shadowColor='#fef9c3'; ctx.shadowBlur=6; }
    ctx.fillRect(bx+s*0.01, -s*0.48, s*0.18, s*0.3);
    ctx.shadowBlur = 0;
    // Window grille (3x3 panes)
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
    ctx.strokeRect(bx+s*0.01, -s*0.48, s*0.18, s*0.3);
    ctx.beginPath(); ctx.moveTo(bx+s*0.07, -s*0.48); ctx.lineTo(bx+s*0.07, -s*0.18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx+s*0.13, -s*0.48); ctx.lineTo(bx+s*0.13, -s*0.18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx+s*0.01, -s*0.38); ctx.lineTo(bx+s*0.19, -s*0.38); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx+s*0.01, -s*0.28); ctx.lineTo(bx+s*0.19, -s*0.28); ctx.stroke();
    // Dirt/grime on lower panes
    ctx.fillStyle = 'rgba(60,50,30,0.15)'; ctx.fillRect(bx+s*0.01, -s*0.28, s*0.18, s*0.1);
  }

  // === LOADING DOCK (center) ===
  ctx.fillStyle = '#111827'; ctx.fillRect(-s*0.14, -s*0.32, s*0.28, s*0.32);
  // Dock door frame
  ctx.fillStyle = '#374151'; ctx.fillRect(-s*0.16, -s*0.34, s*0.32, s*0.02);
  ctx.fillRect(-s*0.16, -s*0.34, s*0.025, s*0.32); ctx.fillRect(s*0.135, -s*0.34, s*0.025, s*0.32);
  // Shutter strips
  for (var ss = 0; ss < 6; ss++) {
    ctx.fillStyle = ss%2===0 ? '#374151' : '#2d3748';
    ctx.fillRect(-s*0.14, -s*0.32+ss*s*0.053, s*0.28, s*0.053);
  }
  // Safety stripes on floor
  for (var sf = 0; sf < 4; sf++) {
    ctx.fillStyle = sf%2===0 ? '#fbbf24' : '#1a1a1a';
    ctx.fillRect(-s*0.16+sf*s*0.08, -s*0.03, s*0.08, s*0.03);
  }
  // Dock bumpers (rubber)
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(-s*0.17, -s*0.1, s*0.03, s*0.08);
  ctx.fillRect(s*0.14, -s*0.1, s*0.03, s*0.08);

  // === PIPE SYSTEM (left wall) ===
  ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-s*0.46, -s*0.48); ctx.lineTo(-s*0.52, -s*0.48); ctx.lineTo(-s*0.52, -s*0.22); ctx.lineTo(-s*0.46, -s*0.22); ctx.stroke();
  ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-s*0.46, -s*0.44); ctx.lineTo(-s*0.52, -s*0.44); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.46, -s*0.26); ctx.lineTo(-s*0.52, -s*0.26); ctx.stroke();
  // Pipe valve
  ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(-s*0.52, -s*0.35, 5, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#b91c1c'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-s*0.52-5, -s*0.35); ctx.lineTo(-s*0.52+5, -s*0.35); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.52, -s*0.35-5); ctx.lineTo(-s*0.52, -s*0.35+5); ctx.stroke();

  // === CHIMNEYS ===
  var nc = Math.min(2 + Math.floor(level/3), 5);
  for (var ci = 0; ci < nc; ci++) {
    var cix = -s*0.36 + ci*(s*0.72/(nc-1||1));
    // Chimney body - riveted steel
    this._isoBox(ctx, cix-s*0.055, -s*0.86, s*0.11, s*0.28, 218, 10, 28);
    // Safety bands
    ctx.fillStyle = '#fbbf24'; ctx.fillRect(cix-s*0.06, -s*0.78, s*0.12, s*0.022);
    ctx.fillStyle = '#fbbf24'; ctx.fillRect(cix-s*0.06, -s*0.65, s*0.12, s*0.022);
    // Rivets
    ctx.fillStyle = '#9ca3af';
    for (var ri2 = 0; ri2 < 3; ri2++) {
      ctx.beginPath(); ctx.arc(cix-s*0.04+ri2*s*0.04, -s*0.72, 1.5, 0, Math.PI*2); ctx.fill();
    }
    // Chimney cap
    ctx.fillStyle = '#1e293b'; ctx.beginPath(); ctx.arc(cix, -s*0.86, s*0.07, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#334155'; ctx.beginPath(); ctx.arc(cix, -s*0.86, s*0.05, 0, Math.PI*2); ctx.fill();
    // Smoke plumes
    this._smoke(ctx, cix, -s*0.86, t, ci*18, 'rgba(150,150,150,0.7)');
    this._smoke(ctx, cix, -s*0.86, t, ci*18+28, 'rgba(120,120,120,0.5)');
    // Smoke glow (night effect)
    var smg = 0.1 + 0.05*Math.sin(t*0.08+ci);
    ctx.fillStyle = 'rgba(255,150,50,'+smg+')';
    ctx.beginPath(); ctx.arc(cix, -s*0.86, s*0.04, 0, Math.PI*2); ctx.fill();
  }

  // === NEON SIGN ===
  var neon = 0.85 + 0.15*Math.sin(t*0.12);
  ctx.shadowColor = '#3b82f6'; ctx.shadowBlur = 12*neon;
  ctx.fillStyle = '#1e3a8a'; ctx.fillRect(-s*0.3, -s*0.56, s*0.6, s*0.12);
  // Sign border lights
  ctx.strokeStyle = 'rgba(96,165,250,'+neon+')'; ctx.lineWidth = 1;
  ctx.strokeRect(-s*0.3, -s*0.56, s*0.6, s*0.12);
  ctx.fillStyle = 'rgba(255,255,255,'+neon+')'; ctx.font = 'bold 8px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('⚙ FACTORY ⚙', 0, -s*0.5);
  ctx.shadowBlur = 0;

  // === FORKLIFT (small, animated) ===
  var fkx = -s*0.44 + Math.abs(Math.sin(t*0.015))*s*0.52;
  ctx.fillStyle = '#f59e0b'; ctx.fillRect(fkx, -s*0.14, s*0.12, s*0.1);
  ctx.fillStyle = '#d97706'; ctx.fillRect(fkx, -s*0.14, s*0.12, s*0.02);
  ctx.fillStyle = '#333';
  ctx.beginPath(); ctx.arc(fkx+s*0.03, -s*0.04, 3, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(fkx+s*0.09, -s*0.04, 3, 0, Math.PI*2); ctx.fill();
  // Forklift forks
  ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(fkx, -s*0.06); ctx.lineTo(fkx-s*0.06, -s*0.06); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(fkx, -s*0.1); ctx.lineTo(fkx-s*0.06, -s*0.1); ctx.stroke();
};

// ── POWERPLANT ───────────────────────────────────────────────
GameRenderer.prototype._sPowerplant = function(ctx, s, level, tick) {
  var t = tick;

  // === BASE BUILDING ===
  this._isoBox(ctx, -s*0.42, -s*0.34, s*0.84, s*0.34, 215, 20, 34);
  // Control room extension
  this._isoBox(ctx, s*0.24, -s*0.28, s*0.18, s*0.28, 215, 22, 38);
  this._drawDetailedWindow(ctx, s*0.26, -s*0.26, s*0.14, s*0.1, true, t);
  // Control panel glow inside
  ctx.fillStyle = 'rgba(0,255,100,0.15)'; ctx.fillRect(s*0.26, -s*0.16, s*0.14, s*0.1);
  // Equipment boxes on exterior
  for (var eb = 0; eb < 3; eb++) {
    this._isoBox(ctx, -s*0.4+eb*s*0.22, -s*0.28, s*0.14, s*0.14, 210, 18, 32);
    // Indicator light
    var lit2 = Math.floor(t/20+eb*7)%3===0;
    ctx.fillStyle = lit2 ? '#22c55e' : '#166534';
    ctx.beginPath(); ctx.arc(-s*0.33+eb*s*0.22, -s*0.2, 3, 0, Math.PI*2); ctx.fill();
  }

  // === COOLING TOWER (iconic hyperboloid) ===
  // Tower shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(0, s*0.02, s*0.28, s*0.06, 0, 0, Math.PI*2); ctx.fill();
  // Tower body
  var tg = ctx.createLinearGradient(-s*0.28, 0, s*0.28, -s*0.72);
  tg.addColorStop(0, '#cbd5e1'); tg.addColorStop(0.3, '#e2e8f0'); tg.addColorStop(0.6, '#f8fafc'); tg.addColorStop(1, '#94a3b8');
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(-s*0.28, 0);
  ctx.bezierCurveTo(-s*0.38, -s*0.22, -s*0.28, -s*0.44, -s*0.18, -s*0.72);
  ctx.lineTo(s*0.18, -s*0.72);
  ctx.bezierCurveTo(s*0.28, -s*0.44, s*0.38, -s*0.22, s*0.28, 0);
  ctx.closePath(); ctx.fill();
  // Tower inner shadow
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath();
  ctx.moveTo(-s*0.18, 0);
  ctx.bezierCurveTo(-s*0.26, -s*0.22, -s*0.16, -s*0.44, -s*0.08, -s*0.72);
  ctx.lineTo(s*0.08, -s*0.72);
  ctx.bezierCurveTo(s*0.16, -s*0.44, s*0.26, -s*0.22, s*0.18, 0);
  ctx.closePath(); ctx.fill();
  // Horizontal bands on tower
  ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1;
  for (var tb = 1; tb < 7; tb++) {
    var tbY = -tb*s*0.1;
    var tbW = (s*0.28 - Math.abs(tbY+s*0.36)*0.3) * 0.9;
    ctx.beginPath(); ctx.moveTo(-tbW, tbY); ctx.lineTo(tbW, tbY); ctx.stroke();
  }
  // Tower rim highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-s*0.18, -s*0.72); ctx.lineTo(s*0.18, -s*0.72); ctx.stroke();
  // Tower base detail
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-s*0.28, 0); ctx.lineTo(s*0.28, 0); ctx.stroke();

  // === STEAM OUTPUT ===
  for (var si = 0; si < 4; si++) {
    var st2 = (t * 0.45 + si*14) % 56;
    var sa = Math.max(0, 0.55 - st2/56);
    var sw2 = s*0.08 + st2*0.15;
    ctx.fillStyle = 'rgba(220,235,245,'+sa+')';
    ctx.beginPath(); ctx.arc((-0.12+si*0.08)*s, -s*0.72 - st2*0.55, sw2*0.5+3, 0, Math.PI*2); ctx.fill();
  }

  // === TRANSFORMER YARD ===
  // Fence
  ctx.strokeStyle = '#888'; ctx.lineWidth = 0.8; ctx.setLineDash([2,2]);
  ctx.strokeRect(-s*0.42, -s*0.04, s*0.62, s*0.04);
  ctx.setLineDash([]);
  // Transformers
  for (var tr = 0; tr < 3; tr++) {
    var trx = -s*0.38+tr*s*0.2;
    this._isoBox(ctx, trx, -s*0.2, s*0.1, s*0.16, 210, 15, 35);
    // Transformer insulators
    ctx.fillStyle = '#94a3b8';
    for (var ins = 0; ins < 3; ins++) {
      ctx.beginPath(); ctx.arc(trx+s*0.015+ins*s*0.035, -s*0.2, 3, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(trx+s*0.015+ins*s*0.035, -s*0.2, 1.5, 0, Math.PI*2); ctx.fill();
    }
    // HV wires
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(trx+s*0.05, -s*0.2); ctx.lineTo(trx+s*0.05, -s*0.34); ctx.stroke();
  }

  // === LIGHTNING BOLT (animated) ===
  var lp = 0.75 + 0.25*Math.sin(t*0.14);
  ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 22*lp;
  ctx.fillStyle = 'hsl(45,100%,'+(55+lp*18)+'%)';
  ctx.beginPath();
  ctx.moveTo(s*0.08, -s*0.28); ctx.lineTo(-s*0.06, -s*0.16); ctx.lineTo(s*0.02, -s*0.15);
  ctx.lineTo(-s*0.07, 0); ctx.lineTo(s*0.1, -s*0.18); ctx.lineTo(s*0.01, -s*0.18);
  ctx.closePath(); ctx.fill();
  // Inner glow
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.moveTo(s*0.06, -s*0.26); ctx.lineTo(-s*0.02, -s*0.18); ctx.lineTo(s*0.02, -s*0.17);
  ctx.lineTo(-s*0.04, -s*0.04); ctx.lineTo(s*0.07, -s*0.17); ctx.lineTo(s*0.02, -s*0.17);
  ctx.closePath(); ctx.fill();

  // === HIGH VOLTAGE WARNING ===
  ctx.fillStyle = '#fbbf24'; ctx.fillRect(-s*0.5, -s*0.14, s*0.07, s*0.07);
  ctx.fillStyle = '#1a0a00'; ctx.font = '7px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('⚡', -s*0.465, -s*0.105);
};

// ── WAREHOUSE ────────────────────────────────────────────────
GameRenderer.prototype._sWarehouse = function(ctx, s, level, tick) {
  var t = tick;

  // === CONCRETE FLOOR ===
  ctx.fillStyle = '#4b5563';
  ctx.beginPath(); ctx.ellipse(0, s*0.02, s*0.54, s*0.09, 0, 0, Math.PI*2); ctx.fill();
  // Loading ramp
  ctx.fillStyle = '#374151'; ctx.fillRect(-s*0.14, s*0.01, s*0.28, s*0.06);
  // Tire tracks
  ctx.strokeStyle = '#2d3748'; ctx.lineWidth = 1; ctx.setLineDash([2,3]);
  ctx.beginPath(); ctx.moveTo(-s*0.06, s*0.06); ctx.lineTo(-s*0.06, s*0.02); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.06, s*0.06); ctx.lineTo(s*0.06, s*0.02); ctx.stroke();
  ctx.setLineDash([]);

  // === MAIN BUILDING BODY ===
  this._isoBox(ctx, -s*0.5, -s*0.4, s*1.0, s*0.4, 28, 38, 36);
  // Cladding panels texture
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 1;
  for (var wp = -4; wp <= 4; wp++) { ctx.beginPath(); ctx.moveTo(wp*s*0.11, -s*0.4); ctx.lineTo(wp*s*0.11, 0); ctx.stroke(); }
  // Horizontal sheet joins
  for (var wh2 = 1; wh2 < 4; wh2++) { ctx.beginPath(); ctx.moveTo(-s*0.5, -wh2*s*0.1); ctx.lineTo(s*0.5, -wh2*s*0.1); ctx.stroke(); }
  // Rust stains on lower sections
  ctx.fillStyle = 'rgba(150,60,20,0.07)';
  for (var rs = 0; rs < 5; rs++) { ctx.fillRect(-s*0.48+rs*s*0.2, -s*0.12, s*0.04, s*0.12); }

  // === ARCHED METAL ROOF ===
  var roofG2 = ctx.createLinearGradient(-s*0.52, -s*0.62, s*0.52, -s*0.4);
  roofG2.addColorStop(0, '#6b7280'); roofG2.addColorStop(0.3, '#9ca3af'); roofG2.addColorStop(0.5, '#d1d5db'); roofG2.addColorStop(0.7, '#9ca3af'); roofG2.addColorStop(1, '#6b7280');
  ctx.fillStyle = roofG2;
  ctx.beginPath(); ctx.ellipse(0, -s*0.4, s*0.52, s*0.24, 0, Math.PI, 0); ctx.fill();
  // Roof ribs / purlins
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
  for (var rr = -5; rr <= 5; rr++) {
    ctx.beginPath(); ctx.ellipse(0, -s*0.4, s*0.52, s*0.24, 0, Math.PI+rr*0.18, Math.PI+(rr+0.7)*0.18); ctx.stroke();
  }
  // Ridge cap
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, -s*0.4, s*0.52, s*0.24, 0, Math.PI*1.45, Math.PI*1.55); ctx.stroke();
  // Roof vents
  for (var rtv = -1; rtv <= 1; rtv++) {
    ctx.fillStyle = '#4b5563'; ctx.fillRect(rtv*s*0.24-s*0.04, -s*0.6, s*0.08, s*0.04);
    // Vent slats
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 0.5;
    for (var vs = 0; vs < 4; vs++) { ctx.beginPath(); ctx.moveTo(rtv*s*0.24-s*0.035+vs*s*0.02, -s*0.6); ctx.lineTo(rtv*s*0.24-s*0.035+vs*s*0.02, -s*0.56); ctx.stroke(); }
  }

  // === LARGE ROLLER DOORS ===
  // Left door
  ctx.fillStyle = '#1e293b'; ctx.fillRect(-s*0.44, -s*0.37, s*0.32, s*0.37);
  // Roller shutter panels
  for (var rsd = 0; rsd < 7; rsd++) {
    ctx.fillStyle = rsd%2===0 ? '#2d3748' : '#374151';
    ctx.fillRect(-s*0.44, -s*0.37+rsd*s*0.053, s*0.32, s*0.053);
    // Panel highlight line
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(-s*0.44, -s*0.35+rsd*s*0.053); ctx.lineTo(-s*0.12, -s*0.35+rsd*s*0.053); ctx.stroke();
  }
  // Door handle bar
  ctx.fillStyle = '#6b7280'; ctx.fillRect(-s*0.36, -s*0.16, s*0.16, s*0.02);
  // Door guide rails
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-s*0.44, -s*0.37); ctx.lineTo(-s*0.44, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.12, -s*0.37); ctx.lineTo(-s*0.12, 0); ctx.stroke();

  // Right door (smaller)
  ctx.fillStyle = '#1e293b'; ctx.fillRect(s*0.08, -s*0.3, s*0.28, s*0.3);
  for (var rsd2 = 0; rsd2 < 6; rsd2++) {
    ctx.fillStyle = rsd2%2===0 ? '#2d3748' : '#374151';
    ctx.fillRect(s*0.08, -s*0.3+rsd2*s*0.05, s*0.28, s*0.05);
  }
  ctx.fillStyle = '#6b7280'; ctx.fillRect(s*0.14, -s*0.14, s*0.16, s*0.02);

  // === DOCK EQUIPMENT ===
  // Loading dock leveler
  ctx.fillStyle = '#374151'; ctx.fillRect(-s*0.5, -s*0.02, s*0.32, s*0.02);
  // Safety bollards
  var bollardColors = ['#ef4444','#fbbf24','#ef4444','#fbbf24'];
  for (var bl2 = 0; bl2 < 4; bl2++) {
    ctx.fillStyle = bollardColors[bl2];
    ctx.fillRect(-s*0.5+bl2*s*0.08, s*0.02, s*0.04, s*0.04);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(-s*0.5+bl2*s*0.08, s*0.02, s*0.02, s*0.01);
  }
  // Dock seals (rubber)
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(-s*0.45, -s*0.38, s*0.03, s*0.38);
  ctx.fillRect(-s*0.14, -s*0.38, s*0.03, s*0.38);

  // === SIGNAGE ===
  ctx.fillStyle = '#1e40af'; ctx.fillRect(-s*0.26, -s*0.44, s*0.52, s*0.09);
  ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1; ctx.strokeRect(-s*0.26, -s*0.44, s*0.52, s*0.09);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 7px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('📦 WAREHOUSE', 0, -s*0.395);
  // Warning light on sign
  var wlb = Math.floor(t/30)%2===0;
  ctx.fillStyle = wlb ? '#ef4444' : '#7f1d1d';
  ctx.beginPath(); ctx.arc(-s*0.3, -s*0.395, 3, 0, Math.PI*2); ctx.fill();

  // === SECURITY CAMERA ===
  ctx.fillStyle = '#374151'; ctx.fillRect(s*0.38, -s*0.34, s*0.06, s*0.02);
  ctx.fillStyle = '#1f2937'; ctx.fillRect(s*0.4, -s*0.36, s*0.04, s*0.04);
  // Camera eye blink
  var cam = Math.floor(t/45)%6===0;
  ctx.fillStyle = cam ? '#ef4444' : '#22c55e';
  ctx.beginPath(); ctx.arc(s*0.42, -s*0.34, 2, 0, Math.PI*2); ctx.fill();
};

// ── MARKET ───────────────────────────────────────────────────
GameRenderer.prototype._sMarket = function(ctx, s, level, tick) {
  var t = tick;

  // === COBBLESTONE PLAZA ===
  var plaza = ctx.createRadialGradient(0, s*0.02, 0, 0, s*0.02, s*0.5);
  plaza.addColorStop(0, '#d4c8b0'); plaza.addColorStop(1, '#b8a890');
  ctx.fillStyle = plaza;
  ctx.beginPath(); ctx.ellipse(0, s*0.02, s*0.5, s*0.1, 0, 0, Math.PI*2); ctx.fill();
  // Cobblestone pattern
  for (var cob = 0; cob < 18; cob++) {
    var ca = cob * Math.PI/9, cr = s*(0.12 + cob%3*0.08);
    ctx.fillStyle = cob%3===0 ? '#c4b8a0' : cob%3===1 ? '#b8ac94' : '#ccc0a8';
    ctx.beginPath(); ctx.ellipse(Math.cos(ca)*cr, s*0.02+Math.sin(ca)*cr*0.35, s*0.025, s*0.01, ca, 0, Math.PI*2); ctx.fill();
  }

  // === BUILDING BASE ===
  this._isoBox(ctx, -s*0.42, -s*0.44, s*0.84, s*0.44, 42, 58, 54);
  // Stone block texture
  ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.6;
  for (var sb2 = 0; sb2 < 4; sb2++) {
    for (var sc2 = 0; sc2 < 5; sc2++) {
      ctx.strokeRect(-s*0.4+sc2*s*0.16, -s*0.42+sb2*s*0.1, s*0.16, s*0.1);
    }
  }

  // === AWNING (scalloped, detailed) ===
  // Awning main body
  ctx.fillStyle = '#dc2626';
  ctx.beginPath(); ctx.moveTo(-s*0.46, -s*0.44);
  for (var aw2 = 0; aw2 < 7; aw2++) {
    var awx = -s*0.46 + aw2 * s*0.92/6;
    ctx.lineTo(awx + s*0.065, -s*0.58);
    ctx.quadraticCurveTo(awx + s*0.092/2 + s*0.065, -s*0.6, awx + s*0.13, -s*0.44);
  }
  ctx.closePath(); ctx.fill();
  // Awning stripes
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  for (var ast = 0; ast < 4; ast++) {
    ctx.fillRect(-s*0.44+ast*s*0.22, -s*0.58, s*0.05, s*0.14);
  }
  // Awning fringe
  ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.5;
  for (var af = 0; af < 14; af++) {
    var afx = -s*0.44+af*s*0.065;
    var afb = Math.sin(t*0.08+af*0.6)*2;
    ctx.beginPath(); ctx.moveTo(afx, -s*0.44); ctx.lineTo(afx+1, -s*0.38+afb); ctx.stroke();
  }
  // Awning rod
  ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-s*0.46, -s*0.44); ctx.lineTo(s*0.46, -s*0.44); ctx.stroke();
  // Awning support poles
  ctx.fillStyle = '#888'; ctx.fillRect(-s*0.42, -s*0.44, s*0.03, s*0.44);
  ctx.fillRect(s*0.39, -s*0.44, s*0.03, s*0.44);

  // === DISPLAY COUNTER ===
  // Counter frame
  ctx.fillStyle = '#7c3a1a'; ctx.fillRect(-s*0.36, -s*0.32, s*0.72, s*0.12);
  ctx.fillStyle = '#6b2e14'; ctx.fillRect(-s*0.36, -s*0.32, s*0.72, s*0.02);
  // Counter surface with wood grain
  ctx.fillStyle = '#9a5030'; ctx.fillRect(-s*0.36, -s*0.3, s*0.72, s*0.08);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.5;
  for (var wg3 = 0; wg3 < 8; wg3++) { ctx.beginPath(); ctx.moveTo(-s*0.36, -s*0.3+wg3*s*0.011); ctx.lineTo(s*0.36, -s*0.3+wg3*s*0.011); ctx.stroke(); }

  // === PRODUCE DISPLAY (animated) ===
  var bounce = Math.sin(t * 0.07) * 2;
  var produce = [
    {e:'🍎',x:-s*0.26,b:bounce},{e:'🍊',x:-s*0.13,b:bounce*0.8},
    {e:'🥕',x: 0,    b:bounce*1.1},{e:'🍇',x: s*0.13,b:bounce*0.9},
    {e:'🥬',x: s*0.26,b:bounce*0.7}
  ];
  ctx.font = '11px Arial'; ctx.textAlign='center';
  produce.forEach(function(p) { ctx.fillText(p.e, p.x, -s*0.3+p.b); });
  // Price tags
  ctx.fillStyle = '#fef3c7'; ctx.font = '5px Arial'; ctx.textBaseline='middle';
  produce.forEach(function(p) {
    ctx.fillRect(p.x-7, -s*0.2, 14, 6);
    ctx.fillStyle = '#7c2d12'; ctx.fillText('$'+Math.floor(level*1.5+1), p.x, -s*0.2+3);
    ctx.fillStyle = '#fef3c7';
  });

  // === STOREFRONT WINDOWS ===
  this._drawDetailedWindow(ctx, -s*0.38, -s*0.42, s*0.16, s*0.1, false, t);
  this._drawDetailedWindow(ctx, s*0.22, -s*0.42, s*0.16, s*0.1, false, t);

  // === SIGN BOARD ===
  ctx.fillStyle = '#92400e'; ctx.fillRect(-s*0.28, -s*0.56, s*0.56, s*0.12);
  ctx.strokeStyle = '#d97706'; ctx.lineWidth = 1.5; ctx.strokeRect(-s*0.28, -s*0.56, s*0.56, s*0.12);
  // Sign text with glow
  ctx.shadowColor = '#fef3c7'; ctx.shadowBlur = 4;
  ctx.fillStyle = '#fef3c7'; ctx.font = 'bold 8px Arial'; ctx.textBaseline='middle'; ctx.textAlign='center';
  ctx.fillText('🛒 РЫНОК 🛒', 0, -s*0.5);
  ctx.shadowBlur = 0;
  // Sign corner ornaments
  ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(-s*0.26, -s*0.56, 3, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(s*0.26, -s*0.56, 3, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(-s*0.26, -s*0.44, 3, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(s*0.26, -s*0.44, 3, 0, Math.PI*2); ctx.fill();

  // === STREET VENDOR ===
  if (level >= 3) {
    ctx.font = '10px Arial'; ctx.textAlign='center';
    ctx.fillText('🧑', -s*0.46, -s*0.26 + Math.abs(Math.sin(t*0.04))*3);
  }
};

// ── GARDEN ───────────────────────────────────────────────────
GameRenderer.prototype._sGarden = function(ctx, s, level, tick) {
  var t = tick;

  // === GROUND ===
  var gnd = ctx.createRadialGradient(0, 0, 0, 0, 0, s*0.5);
  gnd.addColorStop(0, '#2d7a22'); gnd.addColorStop(0.6, '#1f6018'); gnd.addColorStop(1, '#144a10');
  ctx.fillStyle = gnd;
  ctx.beginPath(); ctx.ellipse(0, 0, s*0.5, s*0.16, 0, 0, Math.PI*2); ctx.fill();

  // === STONE PATHS (cross pattern) ===
  var pathG = ctx.createLinearGradient(-s*0.5, 0, s*0.5, 0);
  pathG.addColorStop(0, '#b0a090'); pathG.addColorStop(0.5, '#d4c8b4'); pathG.addColorStop(1, '#b0a090');
  ctx.fillStyle = pathG;
  ctx.fillRect(-s*0.05, -s*0.5, s*0.1, s*0.5);
  ctx.fillRect(-s*0.5, -s*0.05, s*1.0, s*0.1);
  // Stone slabs on paths
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.7;
  for (var sl3 = -4; sl3 <= 4; sl3++) {
    ctx.strokeRect(-s*0.045, sl3*s*0.06, s*0.09, s*0.055);
  }
  for (var sl4 = -5; sl4 <= 5; sl4++) {
    ctx.strokeRect(sl4*s*0.095, -s*0.045, s*0.09, s*0.09);
  }

  // === CENTRAL FOUNTAIN ===
  // Base
  ctx.fillStyle = '#d4a574'; ctx.beginPath(); ctx.ellipse(0, -s*0.08, s*0.18, s*0.07, 0, 0, Math.PI*2); ctx.fill();
  // Basin (water)
  var water = ctx.createRadialGradient(0, -s*0.1, 0, 0, -s*0.1, s*0.14);
  water.addColorStop(0, '#38bdf8'); water.addColorStop(1, '#0284c7');
  ctx.fillStyle = water;
  ctx.beginPath(); ctx.ellipse(0, -s*0.1, s*0.14, s*0.055, 0, 0, Math.PI*2); ctx.fill();
  // Basin rim
  ctx.strokeStyle = '#c49060'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(0, -s*0.08, s*0.18, s*0.07, 0, 0, Math.PI*2); ctx.stroke();
  // Water reflection
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath(); ctx.ellipse(-s*0.04, -s*0.1, s*0.06, s*0.02, -0.5, 0, Math.PI*2); ctx.fill();
  // Water ripples
  for (var wr = 1; wr <= 3; wr++) {
    var rphase = (t*0.06 + wr*0.4) % 1;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.25 - rphase*0.25) + ')';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(0, -s*0.1, s*0.05*(1+rphase*1.2), s*0.02*(1+rphase*1.2), 0, 0, Math.PI*2); ctx.stroke();
  }
  // Center column
  ctx.fillStyle = '#c49060'; ctx.fillRect(-s*0.02, -s*0.22, s*0.04, s*0.14);
  // Water jets animated
  for (var wj2 = 0; wj2 < 4; wj2++) {
    var wa = wj2 * Math.PI/2;
    var wh3 = s*0.1 + Math.sin(t*0.1+wj2*0.8)*s*0.03;
    ctx.strokeStyle = 'rgba(125,211,252,0.75)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -s*0.2);
    ctx.quadraticCurveTo(Math.cos(wa)*s*0.1, -s*0.2-wh3, Math.cos(wa)*s*0.14, -s*0.1-s*0.02);
    ctx.stroke();
  }
  // Fountain top ornament
  ctx.fillStyle = '#c49060'; ctx.beginPath(); ctx.arc(0, -s*0.22, s*0.025, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#d4a574'; ctx.beginPath(); ctx.arc(0, -s*0.26, s*0.014, 0, Math.PI*2); ctx.fill();

  // === TREES / SHRUBS ===
  var nt = Math.min(2 + Math.floor(level/2), 6);
  var treeAngles = [0, Math.PI/2, Math.PI, Math.PI*1.5, Math.PI*0.25, Math.PI*0.75];
  for (var ti = 0; ti < nt; ti++) {
    var tang = treeAngles[ti];
    var trad = s * 0.32;
    var txx = Math.cos(tang) * trad;
    var tyy = Math.sin(tang) * trad * 0.4 - s*0.3;
    var tsw = Math.sin(t*0.04+ti*1.2) * 2;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(txx, tyy+s*0.26, s*0.09, s*0.035, 0, 0, Math.PI*2); ctx.fill();
    // Trunk with bark
    var trg = ctx.createLinearGradient(txx-2, tyy+s*0.08, txx+2, tyy+s*0.18);
    trg.addColorStop(0, '#92400e'); trg.addColorStop(1, '#6b2e0a');
    ctx.fillStyle = trg; ctx.fillRect(txx-3, tyy+s*0.04, 6, s*0.2);
    // Bark texture
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.5;
    for (var bk = 0; bk < 3; bk++) { ctx.beginPath(); ctx.moveTo(txx-2, tyy+s*0.06+bk*s*0.06); ctx.lineTo(txx+2, tyy+s*0.08+bk*s*0.06); ctx.stroke(); }
    // Three foliage layers
    var fColors = ['#166534','#15803d','#16a34a','#4ade80'];
    for (var fl3 = 0; fl3 < 4; fl3++) {
      var frad = s*(0.12-fl3*0.022);
      var fg3 = ctx.createRadialGradient(txx+tsw*0.6, tyy-fl3*s*0.065, 0, txx+tsw*0.6, tyy-fl3*s*0.065, frad);
      fg3.addColorStop(0, fColors[fl3]); fg3.addColorStop(1, '#14532d');
      ctx.fillStyle = fg3;
      ctx.beginPath(); ctx.arc(txx+tsw*0.7, tyy-fl3*s*0.07, frad, 0, Math.PI*2); ctx.fill();
      // Leaf highlights
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.arc(txx+tsw*0.7-frad*0.3, tyy-fl3*s*0.07-frad*0.3, frad*0.4, 0, Math.PI*2); ctx.fill();
    }
    // Flowers / fruits on tree
    var flc = ['#f43f5e','#a855f7','#eab308','#ec4899','#3b82f6','#10b981'][ti];
    for (var ff = 0; ff < 3; ff++) {
      var ffa = ti*0.8+ff*2.1;
      ctx.fillStyle = flc;
      ctx.beginPath(); ctx.arc(txx+tsw+Math.cos(ffa)*s*0.07, tyy-s*0.14+Math.sin(ffa)*s*0.06, 2.5, 0, Math.PI*2); ctx.fill();
    }
  }

  // === BENCH ===
  ctx.fillStyle = '#92400e'; ctx.fillRect(s*0.22, -s*0.24, s*0.16, s*0.03);
  ctx.fillStyle = '#78350f'; ctx.fillRect(s*0.24, -s*0.21, s*0.03, s*0.05);
  ctx.fillRect(s*0.33, -s*0.21, s*0.03, s*0.05);
  // Sitting figure
  if (level >= 4) { ctx.font = '9px Arial'; ctx.textAlign='center'; ctx.fillText('🧘', s*0.3, -s*0.26); }

  // === BUTTERFLIES ===
  for (var bf = 0; bf < 2; bf++) {
    var bfx = Math.cos(t*0.04+bf*2.5)*s*0.28;
    var bfy = -s*0.3 + Math.sin(t*0.07+bf*1.8)*s*0.08;
    ctx.font = '8px Arial'; ctx.textAlign='center';
    ctx.fillText('🦋', bfx, bfy);
  }
};

// ── SCHOOL ───────────────────────────────────────────────────
GameRenderer.prototype._sSchool = function(ctx, s, level, tick) {
  var t = tick;

  // === SCHOOLYARD ===
  var yard2 = ctx.createLinearGradient(-s*0.5, 0, s*0.5, 0);
  yard2.addColorStop(0, '#2d6a20'); yard2.addColorStop(0.5, '#3a8a2a'); yard2.addColorStop(1, '#2d6a20');
  ctx.fillStyle = yard2;
  ctx.beginPath(); ctx.ellipse(0, s*0.02, s*0.52, s*0.1, 0, 0, Math.PI*2); ctx.fill();
  // Paved area
  ctx.fillStyle = '#c8c0b0'; ctx.fillRect(-s*0.2, s*0.0, s*0.4, s*0.06);
  // Basketball court lines
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.8;
  ctx.strokeRect(-s*0.18, s*0.0, s*0.36, s*0.04);
  ctx.beginPath(); ctx.arc(0, s*0.02, s*0.06, -Math.PI*0.5, Math.PI*0.5); ctx.stroke();

  // === MAIN BUILDING ===
  this._isoBox(ctx, -s*0.48, -s*0.6, s*0.96, s*0.6, 52, 62, 88);
  // Yellow brick texture
  ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.lineWidth = 0.6;
  for (var br2 = 0; br2 < 6; br2++) {
    for (var bc2 = 0; bc2 < 8; bc2++) {
      var off2 = br2%2===0 ? 0 : s*0.06;
      ctx.strokeRect(-s*0.46+bc2*s*0.12+off2, -s*0.58+br2*s*0.1, s*0.11, s*0.09);
    }
  }

  // === FOUNDATION / STEPS ===
  ctx.fillStyle = '#d4c8a8'; ctx.fillRect(-s*0.5, -s*0.06, s*1.0, s*0.06);
  ctx.fillStyle = '#c8bc9c'; ctx.fillRect(-s*0.5, -s*0.12, s*1.0, s*0.06);
  ctx.fillStyle = '#bcb090'; ctx.fillRect(-s*0.46, -s*0.06, s*0.92, s*0.06);

  // === CORNICE / PEDIMENT ===
  ctx.fillStyle = '#fbbf24'; ctx.fillRect(-s*0.5, -s*0.62, s*1.0, s*0.04);
  // Dentil molding
  for (var dm = 0; dm < 16; dm++) {
    ctx.fillStyle = dm%2===0 ? '#f59e0b' : '#d97706';
    ctx.fillRect(-s*0.48+dm*s*0.06, -s*0.62, s*0.04, s*0.02);
  }

  // === CLASSICAL COLUMNS (4) ===
  for (var col = 0; col < 4; col++) {
    var colx = -s*0.38+col*s*0.24;
    // Column shadow
    ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.fillRect(colx+s*0.02, -s*0.58, s*0.04, s*0.58);
    // Column body
    var cg = ctx.createLinearGradient(colx, -s*0.58, colx+s*0.08, 0);
    cg.addColorStop(0, '#fff'); cg.addColorStop(0.4, '#f0ece0'); cg.addColorStop(1, '#ddd8c8');
    ctx.fillStyle = cg; ctx.fillRect(colx, -s*0.58, s*0.08, s*0.52);
    // Fluting (vertical grooves)
    ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.5;
    for (var fl4 = 1; fl4 < 4; fl4++) { ctx.beginPath(); ctx.moveTo(colx+fl4*s*0.02, -s*0.56); ctx.lineTo(colx+fl4*s*0.02, -s*0.06); ctx.stroke(); }
    // Capital (top)
    ctx.fillStyle = '#f0ece0'; ctx.fillRect(colx-s*0.02, -s*0.6, s*0.12, s*0.03);
    ctx.fillStyle = '#e0dcd0'; ctx.fillRect(colx-s*0.01, -s*0.62, s*0.1, s*0.02);
    // Base
    ctx.fillStyle = '#e0dcd0'; ctx.fillRect(colx-s*0.01, -s*0.06, s*0.1, s*0.02);
    ctx.fillRect(colx-s*0.02, -s*0.04, s*0.12, s*0.02);
  }

  // === WINDOWS (arched, 3) ===
  for (var w3 = 0; w3 < 3; w3++) {
    var wxx = -s*0.3+w3*s*0.28;
    // Window arch frame
    ctx.fillStyle = '#f0e8d0';
    ctx.beginPath(); ctx.arc(wxx+s*0.09, -s*0.38, s*0.09, Math.PI, 0); ctx.rect(wxx, -s*0.38, s*0.18, s*0.24); ctx.fill();
    // Glass
    ctx.fillStyle = w3===1 ? 'rgba(186,230,253,0.8)' : 'rgba(186,230,253,0.6)';
    ctx.beginPath(); ctx.arc(wxx+s*0.09, -s*0.38, s*0.07, Math.PI, 0); ctx.rect(wxx+s*0.02, -s*0.38, s*0.14, s*0.2); ctx.fill();
    // Stained glass arch color
    if (w3===1) { ctx.fillStyle = 'rgba(250,204,21,0.2)'; ctx.beginPath(); ctx.arc(wxx+s*0.09, -s*0.38, s*0.07, Math.PI, 0); ctx.fill(); }
    // Window muntins
    ctx.strokeStyle = '#d4c890'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(wxx+s*0.09, -s*0.38-s*0.07); ctx.lineTo(wxx+s*0.09, -s*0.18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(wxx+s*0.02, -s*0.3); ctx.lineTo(wxx+s*0.16, -s*0.3); ctx.stroke();
    // Arch keystone
    ctx.fillStyle = '#d4c890'; ctx.fillRect(wxx+s*0.07, -s*0.46, s*0.04, s*0.03);
  }

  // === BELL TOWER ===
  this._isoBox(ctx, -s*0.1, -s*0.82, s*0.2, s*0.22, 52, 55, 82);
  // Tower windows
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.arc(-s*0.04, -s*0.72, s*0.03, Math.PI, 0); ctx.rect(-s*0.07, -s*0.72, s*0.06, s*0.04); ctx.fill();
  ctx.beginPath(); ctx.arc(s*0.04, -s*0.72, s*0.03, Math.PI, 0); ctx.rect(s*0.01, -s*0.72, s*0.06, s*0.04); ctx.fill();
  // Spire
  ctx.fillStyle = '#d97706';
  ctx.beginPath(); ctx.moveTo(-s*0.12, -s*0.82); ctx.lineTo(0, -s*1.04); ctx.lineTo(s*0.12, -s*0.82); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#b45309'; ctx.lineWidth = 1; ctx.stroke();
  // Bell animated
  var bs3 = Math.sin(t * 0.1) * 0.3;
  ctx.save(); ctx.translate(0, -s*0.82); ctx.rotate(bs3);
  ctx.fillStyle = '#ca8a04'; ctx.beginPath(); ctx.arc(0, 0, s*0.05, 0, Math.PI); ctx.fill();
  ctx.strokeStyle = '#92400e'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, s*0.05, 0, Math.PI); ctx.stroke();
  ctx.restore();
  // Clock face
  ctx.fillStyle = '#fef3c7'; ctx.beginPath(); ctx.arc(0, -s*0.74, s*0.04, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#92400e'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(0, -s*0.74, s*0.04, 0, Math.PI*2); ctx.stroke();
  // Clock hands
  var ch = (t * 0.003) % (Math.PI*2);
  ctx.strokeStyle = '#1a0a00'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -s*0.74); ctx.lineTo(Math.cos(ch-Math.PI/2)*s*0.03, -s*0.74+Math.sin(ch-Math.PI/2)*s*0.03); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -s*0.74); ctx.lineTo(Math.cos(ch*12-Math.PI/2)*s*0.025, -s*0.74+Math.sin(ch*12-Math.PI/2)*s*0.025); ctx.stroke();

  // === FLAG ===
  ctx.strokeStyle = '#888'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(0, -s*1.04); ctx.lineTo(0, -s*1.2); ctx.stroke();
  var fw3 = Math.sin(t * 0.1) * 5;
  var fg4 = ctx.createLinearGradient(0, -s*1.2, s*0.22+fw3, -s*1.12);
  fg4.addColorStop(0, '#ef4444'); fg4.addColorStop(0.5, '#dc2626'); fg4.addColorStop(1, '#b91c1c');
  ctx.fillStyle = fg4;
  ctx.beginPath(); ctx.moveTo(0,-s*1.2); ctx.lineTo(s*0.2+fw3,-s*1.13); ctx.lineTo(0,-s*1.06); ctx.closePath(); ctx.fill();
  // Flag star
  ctx.fillStyle = '#fbbf24'; ctx.font = '5px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('★', s*0.1+fw3*0.5, -s*1.13);

  // === MAIN DOOR ===
  ctx.fillStyle = '#1e3a1e'; ctx.fillRect(-s*0.1, -s*0.32, s*0.2, s*0.32);
  ctx.beginPath(); ctx.arc(0, -s*0.32, s*0.1, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, -s*0.32, s*0.1, Math.PI, 0); ctx.stroke();
  ctx.strokeRect(-s*0.08, -s*0.3, s*0.16, s*0.28);
  // Door glass
  ctx.fillStyle = 'rgba(186,230,253,0.35)'; ctx.beginPath(); ctx.arc(0, -s*0.32, s*0.08, Math.PI, 0); ctx.fill();
  // Door handles
  ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(-s*0.02, -s*0.18, 2, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(s*0.02, -s*0.18, 2, 0, Math.PI*2); ctx.fill();
};

// ── BAKERY ───────────────────────────────────────────────────
GameRenderer.prototype._sBakery = function(ctx, s, level, tick) {
  var t = tick;

  // === COBBLESTONE GROUND ===
  ctx.fillStyle = '#c8b8a0'; ctx.beginPath(); ctx.ellipse(0, s*0.02, s*0.44, s*0.08, 0, 0, Math.PI*2); ctx.fill();
  for (var cob2 = 0; cob2 < 12; cob2++) {
    ctx.fillStyle = cob2%3===0 ? '#b4a48e' : '#c8b49e';
    ctx.beginPath(); ctx.ellipse(Math.cos(cob2*0.52)*s*0.3, s*0.02+Math.sin(cob2*0.52)*s*0.06, s*0.03, s*0.012, cob2, 0, Math.PI*2); ctx.fill();
  }

  // === BUILDING ===
  this._isoBox(ctx, -s*0.38, -s*0.5, s*0.76, s*0.5, 38, 72, 56);
  // Plaster texture with color variation
  ctx.fillStyle = 'rgba(255,250,220,0.06)';
  for (var pt = 0; pt < 12; pt++) { ctx.fillRect(-s*0.36+pt*s*0.064, -s*0.5, s*0.06, s*0.5); }

  // === HALF-TIMBERED FACADE DETAIL ===
  ctx.strokeStyle = '#5c3010'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-s*0.38, -s*0.5); ctx.lineTo(s*0.38, -s*0.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.38, -s*0.25); ctx.lineTo(s*0.38, -s*0.25); ctx.stroke();
  // Diagonal braces
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-s*0.38, -s*0.5); ctx.lineTo(-s*0.1, -s*0.25); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.38, -s*0.5); ctx.lineTo(s*0.1, -s*0.25); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.1, -s*0.5); ctx.lineTo(-s*0.38, -s*0.25); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.1, -s*0.5); ctx.lineTo(s*0.38, -s*0.25); ctx.stroke();

  // === ROOF (tile) ===
  var rg2 = ctx.createLinearGradient(-s*0.42, -s*0.5, s*0.42, -s*0.72);
  rg2.addColorStop(0, '#c2410c'); rg2.addColorStop(0.5, '#ea580c'); rg2.addColorStop(1, '#9a3412');
  ctx.fillStyle = rg2;
  ctx.beginPath(); ctx.moveTo(-s*0.42, -s*0.5); ctx.lineTo(0, -s*0.74); ctx.lineTo(s*0.42, -s*0.5); ctx.closePath(); ctx.fill();
  // Roof tiles
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.6;
  for (var rt2 = 1; rt2 < 5; rt2++) {
    var rty = -s*0.5 - rt2*s*0.048; var rtw = s*0.84-rt2*s*0.12;
    ctx.beginPath(); ctx.moveTo(-rtw/2, rty); ctx.lineTo(rtw/2, rty); ctx.stroke();
  }
  // Ridge with clay caps
  ctx.fillStyle = '#7c2d0c';
  ctx.beginPath(); ctx.moveTo(-s*0.06, -s*0.74); ctx.lineTo(0, -s*0.8); ctx.lineTo(s*0.06, -s*0.74); ctx.closePath(); ctx.fill();

  // === CHIMNEY / OVEN STACK ===
  this._isoBox(ctx, s*0.1, -s*0.62, s*0.14, s*0.14, 22, 32, 28);
  ctx.fillStyle = '#1a0a00'; ctx.fillRect(s*0.11, -s*0.64, s*0.12, s*0.03);
  // Hot glow from chimney
  var hg2 = 0.4 + 0.3*Math.sin(t*0.1);
  ctx.shadowColor = '#f97316'; ctx.shadowBlur = 16*hg2;
  ctx.fillStyle = 'rgba(249,115,22,'+hg2*0.5+')';
  ctx.beginPath(); ctx.arc(s*0.17, -s*0.62, s*0.06, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
  this._smoke(ctx, s*0.17, -s*0.64, t, 0, 'rgba(255,150,50,0.5)');
  this._smoke(ctx, s*0.17, -s*0.64, t, 22, 'rgba(200,100,20,0.35)');

  // === DISPLAY WINDOW ===
  ctx.fillStyle = '#c8a060'; ctx.fillRect(-s*0.32, -s*0.42, s*0.48, s*0.3);
  // Window glass
  ctx.fillStyle = 'rgba(255,250,230,0.7)'; ctx.fillRect(-s*0.3, -s*0.4, s*0.44, s*0.26);
  ctx.strokeStyle = '#5c3010'; ctx.lineWidth = 1.5; ctx.strokeRect(-s*0.3, -s*0.4, s*0.44, s*0.26);
  // Window dividers
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-s*0.08, -s*0.4); ctx.lineTo(-s*0.08, -s*0.14); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.3, -s*0.28); ctx.lineTo(s*0.14, -s*0.28); ctx.stroke();

  // === BAKED GOODS DISPLAY ===
  ctx.font = '10px Arial'; ctx.textAlign='center';
  var goods = ['🥐','🥖','🍞','🥨','🥧'];
  for (var g2 = 0; g2 < Math.min(goods.length, 2+Math.floor(level/2)); g2++) {
    var gx2 = -s*0.2+g2*s*0.12;
    ctx.fillText(goods[g2], gx2, -s*0.24 + Math.sin(t*0.05+g2)*1.5);
  }
  // Steam from goods
  ctx.strokeStyle = 'rgba(255,200,100,0.35)'; ctx.lineWidth = 1;
  var st3 = (t*0.05) % 1;
  ctx.beginPath(); ctx.moveTo(-s*0.16, -s*0.26); ctx.quadraticCurveTo(-s*0.12, -s*0.3-st3*s*0.08, -s*0.16+st3*s*0.04, -s*0.36); ctx.stroke();

  // === SIGNBOARD (hanging) ===
  // Chains
  ctx.strokeStyle = '#888'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(-s*0.2, -s*0.5); ctx.lineTo(-s*0.18, -s*0.58); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.2, -s*0.5); ctx.lineTo(s*0.18, -s*0.58); ctx.stroke();
  // Sign
  ctx.fillStyle = '#92400e'; ctx.beginPath(); ctx.roundRect(-s*0.24, -s*0.66, s*0.48, s*0.1, 4); ctx.fill();
  ctx.strokeStyle = '#d97706'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(-s*0.24, -s*0.66, s*0.48, s*0.1, 4); ctx.stroke();
  var sg2 = Math.sin(t*0.06) * 2;
  ctx.fillStyle = '#fef3c7'; ctx.font = 'bold 7px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('🥐 ПЕКАРНЯ', sg2*0.1, -s*0.61);

  // === FRONT DOOR ===
  ctx.fillStyle = '#3d1f05';
  ctx.beginPath(); ctx.roundRect(-s*0.09, -s*0.26, s*0.18, s*0.26, [6,6,0,0]); ctx.fill();
  // Door glass oval
  ctx.fillStyle = 'rgba(255,250,230,0.4)';
  ctx.beginPath(); ctx.ellipse(0, -s*0.18, s*0.05, s*0.06, 0, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#6b3010'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.ellipse(0, -s*0.18, s*0.05, s*0.06, 0, 0, Math.PI*2); ctx.stroke();
  // Doorbell
  var db2 = Math.floor(t/70)%12===0;
  if (db2) { ctx.font = '9px Arial'; ctx.fillText('🔔', -s*0.12, -s*0.22); }
  // Door bell screw
  ctx.fillStyle = '#888'; ctx.beginPath(); ctx.arc(-s*0.1, -s*0.2, 3, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(-s*0.1, -s*0.2, 1.5, 0, Math.PI*2); ctx.fill();
};

// ── PARK ─────────────────────────────────────────────────────
GameRenderer.prototype._sPark = function(ctx, s, level, tick) {
  var t = tick;

  // === PARK GROUND ===
  var grass = ctx.createRadialGradient(0, 0, 0, 0, 0, s*0.52);
  grass.addColorStop(0, '#2d7a22'); grass.addColorStop(0.7, '#1f6018'); grass.addColorStop(1, '#144a10');
  ctx.fillStyle = grass;
  ctx.beginPath(); ctx.ellipse(0, 0, s*0.52, s*0.17, 0, 0, Math.PI*2); ctx.fill();

  // === PATHS (curved) ===
  ctx.fillStyle = '#c8b898';
  ctx.fillRect(-s*0.05, -s*0.52, s*0.1, s*0.52);
  ctx.fillRect(-s*0.52, -s*0.05, s*1.04, s*0.1);
  // Diagonal path
  ctx.save(); ctx.rotate(Math.PI/4);
  ctx.fillRect(-s*0.05, -s*0.5, s*0.1, s*0.5);
  ctx.restore();
  ctx.save(); ctx.rotate(-Math.PI/4);
  ctx.fillRect(-s*0.05, -s*0.5, s*0.1, s*0.5);
  ctx.restore();
  // Path border
  ctx.strokeStyle = '#a89878'; ctx.lineWidth = 0.8;
  ctx.strokeRect(-s*0.052, -s*0.52, s*0.104, s*0.52);
  ctx.strokeRect(-s*0.52, -s*0.052, s*1.04, s*0.104);

  // === POND ===
  var pond2 = ctx.createRadialGradient(0, -s*0.1, 0, 0, -s*0.1, s*0.22);
  pond2.addColorStop(0, '#7dd3fc'); pond2.addColorStop(0.4, '#38bdf8'); pond2.addColorStop(1, '#0369a1');
  ctx.fillStyle = pond2;
  ctx.beginPath(); ctx.ellipse(0, -s*0.1, s*0.22, s*0.1, 0, 0, Math.PI*2); ctx.fill();
  // Pond edge stones
  ctx.strokeStyle = '#d4c8b0'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, -s*0.1, s*0.22, s*0.1, 0, 0, Math.PI*2); ctx.stroke();
  // Water reflections
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath(); ctx.ellipse(-s*0.06, -s*0.1, s*0.08, s*0.03, -0.4, 0, Math.PI*2); ctx.fill();
  // Ripples
  for (var rpl = 1; rpl <= 3; rpl++) {
    var rph = (t*0.05 + rpl*0.4) % 1;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.3-rph*0.3) + ')';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(0, -s*0.1, s*0.06*(1+rph), s*0.025*(1+rph), 0, 0, Math.PI*2); ctx.stroke();
  }
  // Duck / swan
  ctx.font = '8px Arial'; ctx.textAlign='center';
  var duckX = Math.cos(t*0.02)*s*0.12;
  var duckY = -s*0.1 + Math.sin(t*0.015)*s*0.04;
  ctx.fillText(level>=3?'🦆':'🐟', duckX, duckY);

  // === TREES (4 corners + extras by level) ===
  var treePos = [[-s*0.36,-s*0.42],[s*0.36,-s*0.42],[-s*0.36,s*0.02],[s*0.36,s*0.02],[-s*0.18,-s*0.36],[s*0.18,-s*0.36]];
  var numTrees = Math.min(4 + Math.floor(level/2), 6);
  for (var tr3 = 0; tr3 < numTrees; tr3++) {
    var tp = treePos[tr3];
    var tsw2 = Math.sin(t*0.04+tr3*1.3)*2.5;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.beginPath(); ctx.ellipse(tp[0], tp[1]+s*0.26, s*0.1, s*0.04, 0, 0, Math.PI*2); ctx.fill();
    // Trunk
    ctx.fillStyle = '#78350f'; ctx.fillRect(tp[0]-3, tp[1]+s*0.06, 6, s*0.2);
    ctx.strokeStyle = '#451a03'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(tp[0]-1, tp[1]+s*0.06); ctx.quadraticCurveTo(tp[0]+2, tp[1]+s*0.12, tp[0]-1, tp[1]+s*0.22); ctx.stroke();
    // 4 foliage layers
    for (var fl5 = 0; fl5 < 4; fl5++) {
      var fcolors = ['#14532d','#166534','#15803d','#16a34a'];
      var fg5 = ctx.createRadialGradient(tp[0]+tsw2*0.5, tp[1]-fl5*s*0.06, 0, tp[0]+tsw2*0.5, tp[1]-fl5*s*0.06, s*(0.12-fl5*0.02));
      fg5.addColorStop(0, fcolors[fl5]); fg5.addColorStop(1, '#0d3320');
      ctx.fillStyle = fg5;
      ctx.beginPath(); ctx.arc(tp[0]+tsw2*0.6, tp[1]-fl5*s*0.07, s*(0.12-fl5*0.02), 0, Math.PI*2); ctx.fill();
    }
    // Colored flowers/fruits
    var tcol = ['#f43f5e','#a855f7','#fbbf24','#3b82f6','#22c55e','#f97316'][tr3];
    for (var tf2 = 0; tf2 < 4; tf2++) {
      var tfa = tf2*Math.PI/2+tr3;
      ctx.fillStyle = tcol; ctx.beginPath(); ctx.arc(tp[0]+tsw2+Math.cos(tfa)*s*0.07, tp[1]-s*0.16+Math.sin(tfa)*s*0.06, 3, 0, Math.PI*2); ctx.fill();
    }
  }

  // === FERRIS WHEEL ===
  var fwAngle = t * 0.018;
  // Support structure
  ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-s*0.08, -s*0.5); ctx.lineTo(0, -s*0.68); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.08, -s*0.5); ctx.lineTo(0, -s*0.68); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.12, -s*0.52); ctx.lineTo(s*0.12, -s*0.52); ctx.stroke();
  // Wheel
  ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, -s*0.68, s*0.2, 0, Math.PI*2); ctx.stroke();
  ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, -s*0.68, s*0.13, 0, Math.PI*2); ctx.stroke();
  // Spokes
  for (var sp = 0; sp < 8; sp++) {
    var spa = fwAngle + sp*Math.PI/4;
    ctx.beginPath(); ctx.moveTo(0, -s*0.68); ctx.lineTo(Math.cos(spa)*s*0.2, -s*0.68+Math.sin(spa)*s*0.2); ctx.stroke();
  }
  // Center hub
  ctx.fillStyle = '#4b5563'; ctx.beginPath(); ctx.arc(0, -s*0.68, s*0.03, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#9ca3af'; ctx.beginPath(); ctx.arc(0, -s*0.68, s*0.015, 0, Math.PI*2); ctx.fill();
  // Gondolas (colored)
  var gondolaColors2 = ['#ef4444','#3b82f6','#22c55e','#f59e0b','#a855f7','#ec4899','#06b6d4','#84cc16'];
  for (var go = 0; go < 8; go++) {
    var goa = fwAngle + go*Math.PI/4;
    var gpx = Math.cos(goa)*s*0.2, gpy = -s*0.68+Math.sin(goa)*s*0.2;
    // Gondola car
    ctx.fillStyle = gondolaColors2[go];
    ctx.fillRect(gpx-4, gpy-4, 8, 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.5; ctx.strokeRect(gpx-4, gpy-4, 8, 6);
    // Gondola window
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(gpx-2, gpy-3, 4, 3);
  }

  // === PARK BENCHES ===
  var benchPos = [[s*0.26, -s*0.22], [-s*0.28, -s*0.3]];
  benchPos.forEach(function(bp) {
    ctx.fillStyle = '#92400e'; ctx.fillRect(bp[0], bp[1], s*0.18, s*0.025);
    ctx.fillStyle = '#78350f';
    ctx.fillRect(bp[0]+s*0.02, bp[1]+s*0.025, s*0.03, s*0.045);
    ctx.fillRect(bp[0]+s*0.13, bp[1]+s*0.025, s*0.03, s*0.045);
    // Backrest
    ctx.fillStyle = '#92400e'; ctx.fillRect(bp[0], bp[1]-s*0.04, s*0.18, s*0.02);
    ctx.fillRect(bp[0]+s*0.02, bp[1]-s*0.04, s*0.025, s*0.04);
    ctx.fillRect(bp[0]+s*0.13, bp[1]-s*0.04, s*0.025, s*0.04);
  });
};

// ── BANK ─────────────────────────────────────────────────────
GameRenderer.prototype._sBank = function(ctx, s, level, tick) {
  var t = tick;

  // === MARBLE PLAZA ===
  var marble = ctx.createLinearGradient(-s*0.5, 0, s*0.5, 0);
  marble.addColorStop(0, '#e2e8f0'); marble.addColorStop(0.5, '#f8fafc'); marble.addColorStop(1, '#e2e8f0');
  ctx.fillStyle = marble;
  ctx.beginPath(); ctx.ellipse(0, s*0.02, s*0.52, s*0.1, 0, 0, Math.PI*2); ctx.fill();
  // Marble veins
  ctx.strokeStyle = 'rgba(180,180,195,0.35)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(-s*0.4, s*0.02); ctx.bezierCurveTo(-s*0.2, s*0.0, s*0.1, s*0.04, s*0.4, s*0.02); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.3, s*0.05); ctx.bezierCurveTo(0, s*0.0, s*0.2, s*0.06, s*0.44, s*0.03); ctx.stroke();

  // === GRAND STEPS ===
  var stepW = [s*1.0, s*0.92, s*0.84];
  var stepH = s*0.05;
  for (var st4 = 0; st4 < 3; st4++) {
    var stg = ctx.createLinearGradient(-stepW[st4]/2, 0, stepW[st4]/2, 0);
    stg.addColorStop(0, 'hsl(210,15%,'+(88-st4*4)+'%)');
    stg.addColorStop(0.5, 'hsl(210,15%,'+(95-st4*3)+'%)');
    stg.addColorStop(1, 'hsl(210,15%,'+(88-st4*4)+'%)');
    ctx.fillStyle = stg;
    ctx.fillRect(-stepW[st4]/2, -st4*stepH, stepW[st4], stepH);
    // Step edge shadow
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(-stepW[st4]/2, -st4*stepH); ctx.lineTo(stepW[st4]/2, -st4*stepH); ctx.stroke();
  }

  // === MAIN BUILDING ===
  this._isoBox(ctx, -s*0.44, -s*0.76, s*0.88, s*0.61, 216, 8, 92);
  // Marble/granite texture
  ctx.strokeStyle = 'rgba(150,160,180,0.08)'; ctx.lineWidth = 1;
  for (var mb = 0; mb < 7; mb++) { ctx.beginPath(); ctx.moveTo(-s*0.44+mb*s*0.13, -s*0.76); ctx.lineTo(-s*0.44+mb*s*0.13, -s*0.15); ctx.stroke(); }
  for (var mr = 1; mr < 6; mr++) { ctx.beginPath(); ctx.moveTo(-s*0.44, -s*0.15-mr*s*0.12); ctx.lineTo(s*0.44, -s*0.15-mr*s*0.12); ctx.stroke(); }

  // === CLASSICAL PEDIMENT ===
  var pedG = ctx.createLinearGradient(-s*0.48, -s*0.76, s*0.48, -s*1.0);
  pedG.addColorStop(0, '#e2e8f0'); pedG.addColorStop(1, '#cbd5e1');
  ctx.fillStyle = pedG;
  ctx.beginPath(); ctx.moveTo(-s*0.48, -s*0.76); ctx.lineTo(0, -s*1.02); ctx.lineTo(s*0.48, -s*0.76); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#b0bec5'; ctx.lineWidth = 1; ctx.stroke();
  // Pediment relief (decorative)
  ctx.fillStyle = '#d4dce4';
  ctx.beginPath(); ctx.moveTo(-s*0.3, -s*0.76); ctx.lineTo(0, -s*0.9); ctx.lineTo(s*0.3, -s*0.76); ctx.closePath(); ctx.fill();
  // Acroteria (ornaments at corners)
  ctx.fillStyle = '#b0bec5';
  for (var ac = -1; ac <= 1; ac++) {
    ctx.beginPath(); ctx.arc(ac*s*0.48, -s*0.76, 4, 0, Math.PI*2); ctx.fill();
    if (ac !== 0) { ctx.beginPath(); ctx.arc(ac*s*0.48, -s*0.78, 2.5, 0, Math.PI*2); ctx.fill(); }
  }
  ctx.beginPath(); ctx.arc(0, -s*1.02, 5, 0, Math.PI*2); ctx.fill();

  // === IONIC COLUMNS (5) ===
  for (var cp3 = 0; cp3 < 5; cp3++) {
    var cxp2 = -s*0.38+cp3*s*0.19;
    // Column shadow
    ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(cxp2+s*0.02, -s*0.72, s*0.04, s*0.57);
    // Column body
    var cg2 = ctx.createLinearGradient(cxp2, -s*0.72, cxp2+s*0.08, 0);
    cg2.addColorStop(0, '#f8fafc'); cg2.addColorStop(0.35, '#e2e8f0'); cg2.addColorStop(1, '#cbd5e1');
    ctx.fillStyle = cg2; ctx.fillRect(cxp2, -s*0.72, s*0.07, s*0.57);
    // Entasis (column bulge - subtle)
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.ellipse(cxp2+s*0.02, -s*0.44, s*0.02, s*0.2, 0, 0, Math.PI*2); ctx.fill();
    // Fluting
    ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.lineWidth = 0.5;
    for (var fl6 = 1; fl6 < 4; fl6++) { ctx.beginPath(); ctx.moveTo(cxp2+fl6*s*0.0175, -s*0.7); ctx.lineTo(cxp2+fl6*s*0.0175, -s*0.15); ctx.stroke(); }
    // Ionic capital (scroll)
    ctx.fillStyle = '#dde5ed'; ctx.fillRect(cxp2-s*0.02, -s*0.72, s*0.11, s*0.025);
    ctx.fillStyle = '#cdd5dd'; ctx.fillRect(cxp2-s*0.01, -s*0.745, s*0.09, s*0.02);
    ctx.fillStyle = '#e0e8f0'; ctx.fillRect(cxp2-s*0.025, -s*0.765, s*0.12, s*0.02);
    // Volutes
    ctx.strokeStyle = '#b0bec5'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.arc(cxp2-s*0.005, -s*0.74, 3, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cxp2+s*0.075, -s*0.74, 3, 0, Math.PI*2); ctx.stroke();
    // Column base
    ctx.fillStyle = '#dde5ed'; ctx.fillRect(cxp2-s*0.01, -s*0.15, s*0.09, s*0.025);
    ctx.fillRect(cxp2-s*0.02, -s*0.125, s*0.11, s*0.02);
  }

  // === MAIN DOOR (bronze) ===
  var doorG = ctx.createLinearGradient(-s*0.12, -s*0.44, s*0.12, -s*0.1);
  doorG.addColorStop(0, '#3d5a40'); doorG.addColorStop(0.5, '#2d4a30'); doorG.addColorStop(1, '#1d3a20');
  ctx.fillStyle = doorG;
  ctx.beginPath(); ctx.roundRect(-s*0.12, -s*0.44, s*0.24, s*0.36, [8,8,0,0]); ctx.fill();
  // Door arch top
  ctx.fillStyle = '#2d4a30';
  ctx.beginPath(); ctx.arc(0, -s*0.44, s*0.12, Math.PI, 0); ctx.fill();
  // Bronze frame
  ctx.strokeStyle = '#c8a135'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, -s*0.44, s*0.12, Math.PI, 0); ctx.stroke();
  ctx.strokeRect(-s*0.1, -s*0.42, s*0.2, s*0.32);
  // Door panels (4)
  ctx.strokeStyle = '#b8912a'; ctx.lineWidth = 1;
  ctx.strokeRect(-s*0.08, -s*0.4, s*0.07, s*0.1);
  ctx.strokeRect(s*0.01, -s*0.4, s*0.07, s*0.1);
  ctx.strokeRect(-s*0.08, -s*0.28, s*0.07, s*0.1);
  ctx.strokeRect(s*0.01, -s*0.28, s*0.07, s*0.1);
  // Handles (brass bars)
  ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-s*0.04, -s*0.24); ctx.lineTo(-s*0.04, -s*0.18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.04, -s*0.24); ctx.lineTo(s*0.04, -s*0.18); ctx.stroke();

  // === GLOWING $ SIGN ===
  var gl3 = 0.75 + 0.25*Math.sin(t*0.09);
  ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = 24*gl3;
  ctx.fillStyle = 'hsl(38,100%,'+(55+gl3*20)+'%)';
  ctx.font = 'bold 22px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('$', 0, -s*0.6);
  ctx.shadowBlur = 0;
  // Decorative frame around $
  ctx.strokeStyle = 'rgba(212,175,55,0.4)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, -s*0.6, s*0.09, 0, Math.PI*2); ctx.stroke();

  // === SECURITY FEATURES ===
  // Camera left
  ctx.fillStyle = '#374151'; ctx.fillRect(-s*0.42, -s*0.58, s*0.06, s*0.025);
  ctx.fillStyle = '#1f2937'; ctx.fillRect(-s*0.4, -s*0.6, s*0.04, s*0.04);
  var cam2 = Math.floor(t/40)%2===0;
  ctx.fillStyle = cam2 ? '#ef4444' : '#22c55e';
  ctx.beginPath(); ctx.arc(-s*0.38, -s*0.58, 2.5, 0, Math.PI*2); ctx.fill();
  // Bank name plate
  ctx.fillStyle = '#1e3a5f'; ctx.fillRect(-s*0.28, -s*0.5, s*0.56, s*0.07);
  ctx.strokeStyle = '#c8a135'; ctx.lineWidth = 1; ctx.strokeRect(-s*0.28, -s*0.5, s*0.56, s*0.07);
  ctx.fillStyle = '#fde68a'; ctx.font = 'bold 6px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('NATIONAL BANK', 0, -s*0.465);
  // Flag on pediment
  ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(s*0.34, -s*0.76); ctx.lineTo(s*0.34, -s*0.9); ctx.stroke();
  ctx.fillStyle = '#ef4444'; ctx.fillRect(s*0.34, -s*0.9, s*0.1, s*0.06);
};

// ── HOSPITAL ─────────────────────────────────────────────────
GameRenderer.prototype._sHospital = function(ctx, s, level, tick) {
  var t = tick;

  // === CLEAN GROUNDS ===
  var grounds = ctx.createLinearGradient(-s*0.5, 0, s*0.5, 0);
  grounds.addColorStop(0, '#d1fae5'); grounds.addColorStop(0.5, '#ecfdf5'); grounds.addColorStop(1, '#d1fae5');
  ctx.fillStyle = grounds;
  ctx.beginPath(); ctx.ellipse(0, s*0.02, s*0.52, s*0.1, 0, 0, Math.PI*2); ctx.fill();
  // Clean concrete path
  ctx.fillStyle = '#e2e8f0'; ctx.fillRect(-s*0.12, s*0.0, s*0.24, s*0.06);
  // Path markings
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 0.5; ctx.setLineDash([2,3]);
  ctx.beginPath(); ctx.moveTo(0, s*0.0); ctx.lineTo(0, s*0.06); ctx.stroke();
  ctx.setLineDash([]);

  // === MAIN BUILDING (central tower) ===
  this._isoBox(ctx, -s*0.44, -s*0.7, s*0.88, s*0.7, 148, 18, 95);
  // Clean white stucco texture
  ctx.fillStyle = 'rgba(240,255,248,0.04)';
  for (var ws2 = 0; ws2 < 10; ws2++) { ctx.fillRect(-s*0.42+ws2*s*0.09, -s*0.7, s*0.09, s*0.7); }
  // Green trim band
  ctx.fillStyle = '#16a34a'; ctx.fillRect(-s*0.46, -s*0.72, s*0.92, s*0.04);

  // === WINGS (left and right extensions) ===
  this._isoBox(ctx, -s*0.48, -s*0.5, s*0.14, s*0.5, 148, 16, 90);
  this._isoBox(ctx, s*0.34, -s*0.5, s*0.14, s*0.5, 148, 16, 90);
  // Wing roof
  ctx.fillStyle = '#ecfdf5'; ctx.fillRect(-s*0.5, -s*0.52, s*0.16, s*0.04);
  ctx.fillRect(s*0.34, -s*0.52, s*0.16, s*0.04);

  // === RED CROSS (large, glowing) ===
  var crossGlow = 0.7 + 0.3*Math.sin(t*0.08);
  ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 14*crossGlow;
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(-s*0.06, -s*0.64, s*0.12, s*0.32);
  ctx.fillRect(-s*0.18, -s*0.52, s*0.36, s*0.12);
  ctx.shadowBlur = 0;
  // Cross inner highlight
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillRect(-s*0.04, -s*0.62, s*0.04, s*0.28);
  ctx.fillRect(-s*0.16, -s*0.5, s*0.14, s*0.08);

  // === WINDOWS (many, animated) ===
  var winPositions = [
    [-s*0.38,-s*0.68],[- s*0.22,-s*0.68],[s*0.06,-s*0.68],[s*0.22,-s*0.68],
    [-s*0.38,-s*0.54],[-s*0.22,-s*0.54],[s*0.06,-s*0.54],[s*0.22,-s*0.54],
    [-s*0.38,-s*0.4],[-s*0.22,-s*0.4],[s*0.06,-s*0.4],[s*0.22,-s*0.4],
    // Wing windows
    [-s*0.46,-s*0.44],[s*0.36,-s*0.44],[-s*0.46,-s*0.3],[s*0.36,-s*0.3]
  ];
  winPositions.forEach(function(wp3, i) {
    var on3 = Math.floor(t/38+i*1.7)%2===0;
    ctx.fillStyle = on3 ? '#fefce8' : 'rgba(186,230,253,0.7)';
    if (on3) { ctx.shadowColor = '#fef08a'; ctx.shadowBlur = 5; }
    ctx.fillRect(wp3[0], wp3[1], s*0.12, s*0.1);
    ctx.shadowBlur = 0;
    // Window frame
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 0.7; ctx.strokeRect(wp3[0], wp3[1], s*0.12, s*0.1);
    // Pane divider
    ctx.beginPath(); ctx.moveTo(wp3[0]+s*0.06, wp3[1]); ctx.lineTo(wp3[0]+s*0.06, wp3[1]+s*0.1); ctx.stroke();
  });

  // === ENTRANCE CANOPY ===
  ctx.fillStyle = '#15803d'; ctx.fillRect(-s*0.22, -s*0.3, s*0.44, s*0.04);
  ctx.fillStyle = '#166534';
  ctx.fillRect(-s*0.18, -s*0.3, s*0.03, s*0.04);
  ctx.fillRect(s*0.15, -s*0.3, s*0.03, s*0.04);
  // Canopy underside
  ctx.fillStyle = '#dcfce7'; ctx.fillRect(-s*0.2, -s*0.3, s*0.4, s*0.015);

  // === SLIDING DOORS (animated) ===
  var doorOpen = Math.abs(Math.sin(t*0.015)) * s*0.08;
  ctx.fillStyle = 'rgba(186,230,253,0.5)';
  ctx.fillRect(-s*0.18+doorOpen, -s*0.3, s*0.1-doorOpen, s*0.3);
  ctx.fillRect(s*0.08, -s*0.3, s*0.1-doorOpen, s*0.3);
  // Door frames
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
  ctx.strokeRect(-s*0.18+doorOpen, -s*0.3, s*0.1-doorOpen, s*0.3);
  ctx.strokeRect(s*0.08, -s*0.3, s*0.1-doorOpen, s*0.3);
  // Automatic door sensor
  ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(0, -s*0.3, 3, 0, Math.PI*2); ctx.fill();

  // === HELIPAD (roof) ===
  ctx.fillStyle = '#15803d'; ctx.beginPath(); ctx.arc(0, -s*0.72, s*0.07, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, -s*0.72, s*0.065, 0, Math.PI*2); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 7px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('H', 0, -s*0.72);
  // Helicopter (animated)
  if (level >= 5) {
    var heliT = (t*0.008) % 1;
    var heliX = Math.cos(heliT*Math.PI*2)*s*0.4;
    var heliY = -s*0.88 - Math.sin(heliT*Math.PI*2)*s*0.06;
    ctx.font = '10px Arial'; ctx.textAlign='center';
    ctx.fillText('🚁', heliX, heliY);
  }

  // === AMBULANCE ===
  if (level >= 3) {
    var ambX = -s*0.5 + Math.abs(Math.sin(t*0.01))*s*0.6;
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(ambX, -s*0.14, s*0.2, s*0.1);
    ctx.fillStyle = '#dc2626'; ctx.fillRect(ambX, -s*0.14, s*0.2, s*0.025);
    // Red cross on ambulance
    ctx.fillStyle = '#dc2626'; ctx.fillRect(ambX+s*0.07, -s*0.12, s*0.06, s*0.04);
    ctx.fillRect(ambX+s*0.085, -s*0.13, s*0.03, s*0.06);
    // Wheels
    ctx.fillStyle = '#1f2937';
    ctx.beginPath(); ctx.arc(ambX+s*0.05, -s*0.04, 4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(ambX+s*0.15, -s*0.04, 4, 0, Math.PI*2); ctx.fill();
    // Siren blink
    var sir = Math.floor(t/12)%2===0;
    ctx.fillStyle = sir ? '#ef4444' : '#3b82f6';
    ctx.beginPath(); ctx.arc(ambX+s*0.1, -s*0.14, 3, 0, Math.PI*2); ctx.fill();
  }
};

// ── LIBRARY ──────────────────────────────────────────────────
GameRenderer.prototype._sLibrary = function(ctx, s, level, tick) {
  var t = tick;

  // === GROUNDS ===
  var lg = ctx.createLinearGradient(-s*0.5, 0, s*0.5, 0);
  lg.addColorStop(0, '#d4a26a'); lg.addColorStop(0.5, '#e8bca0'); lg.addColorStop(1, '#d4a26a');
  ctx.fillStyle = lg; ctx.beginPath(); ctx.ellipse(0, s*0.02, s*0.5, s*0.1, 0, 0, Math.PI*2); ctx.fill();

  // === MAIN BUILDING ===
  this._isoBox(ctx, -s*0.46, -s*0.64, s*0.92, s*0.64, 38, 44, 58);
  // Warm brick texture
  ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.lineWidth = 0.6;
  for (var br3 = 0; br3 < 7; br3++) {
    for (var bc3 = 0; bc3 < 6; bc3++) {
      var off3 = br3%2===0 ? 0 : s*0.078;
      ctx.strokeRect(-s*0.44+bc3*s*0.15+off3, -s*0.62+br3*s*0.09, s*0.14, s*0.08);
    }
  }
  // Quoins (corner stones)
  ctx.fillStyle = '#c8a060';
  for (var q = 0; q < 5; q++) {
    ctx.fillRect(-s*0.46, -s*0.64+q*s*0.12, s*0.04, s*0.08);
    ctx.fillRect(s*0.42, -s*0.64+q*s*0.12, s*0.04, s*0.08);
  }

  // === CLASSICAL PEDIMENT ===
  var pG = ctx.createLinearGradient(-s*0.48, -s*0.64, s*0.48, -s*0.88);
  pG.addColorStop(0, '#c8a060'); pG.addColorStop(1, '#b8904e');
  ctx.fillStyle = pG;
  ctx.beginPath(); ctx.moveTo(-s*0.48, -s*0.64); ctx.lineTo(0, -s*0.88); ctx.lineTo(s*0.48, -s*0.64); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#a07840'; ctx.lineWidth = 1; ctx.stroke();
  // Inner pediment
  ctx.fillStyle = '#c0985e';
  ctx.beginPath(); ctx.moveTo(-s*0.3, -s*0.64); ctx.lineTo(0, -s*0.8); ctx.lineTo(s*0.3, -s*0.64); ctx.closePath(); ctx.fill();
  // Pediment detail - scroll ornament
  ctx.strokeStyle = '#d4b070'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(0, -s*0.7, s*0.04, 0, Math.PI*2); ctx.stroke();
  // Cornice
  ctx.fillStyle = '#d4a870'; ctx.fillRect(-s*0.5, -s*0.66, s*1.0, s*0.04);
  // Dentils
  for (var dn = 0; dn < 12; dn++) { ctx.fillStyle = dn%2===0 ? '#c89850' : '#d4a870'; ctx.fillRect(-s*0.48+dn*s*0.08, -s*0.66, s*0.06, s*0.02); }

  // === ARCHED WINDOWS (3) ===
  for (var lw2 = 0; lw2 < 3; lw2++) {
    var lwx2 = -s*0.32+lw2*s*0.32;
    // Stone surround
    ctx.fillStyle = '#d4a870';
    ctx.beginPath(); ctx.arc(lwx2+s*0.09, -s*0.46, s*0.11, Math.PI, 0); ctx.rect(lwx2, -s*0.46, s*0.18, s*0.28); ctx.fill();
    // Glass
    ctx.fillStyle = lw2===1 ? 'rgba(255,250,200,0.8)' : 'rgba(186,230,253,0.75)';
    if (lw2===1) { ctx.shadowColor = '#fef9c3'; ctx.shadowBlur = 8; }
    ctx.beginPath(); ctx.arc(lwx2+s*0.09, -s*0.46, s*0.085, Math.PI, 0); ctx.rect(lwx2+s*0.02, -s*0.46, s*0.14, s*0.24); ctx.fill();
    ctx.shadowBlur = 0;
    // Keystone
    ctx.fillStyle = '#a07840'; ctx.fillRect(lwx2+s*0.065, -s*0.57, s*0.05, s*0.03);
    // Sill
    ctx.fillStyle = '#d4a870'; ctx.fillRect(lwx2-s*0.01, -s*0.22, s*0.2, s*0.025);
    // Window tracery (leading)
    ctx.strokeStyle = '#b08040'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(lwx2+s*0.09, -s*0.46, s*0.085, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lwx2+s*0.09, -s*0.46-s*0.085); ctx.lineTo(lwx2+s*0.09, -s*0.22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lwx2+s*0.02, -s*0.36); ctx.lineTo(lwx2+s*0.16, -s*0.36); ctx.stroke();
  }

  // === DOOR (ornate) ===
  ctx.fillStyle = '#5c3010';
  ctx.beginPath(); ctx.roundRect(-s*0.12, -s*0.38, s*0.24, s*0.38, [6,6,0,0]); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -s*0.38, s*0.12, Math.PI, 0); ctx.fill();
  // Door surround
  ctx.strokeStyle = '#c8a060'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, -s*0.38, s*0.12, Math.PI, 0); ctx.stroke();
  ctx.strokeRect(-s*0.1, -s*0.36, s*0.2, s*0.34);
  // Door panels
  ctx.strokeStyle = '#7c4020'; ctx.lineWidth = 1;
  ctx.strokeRect(-s*0.08, -s*0.34, s*0.07, s*0.12);
  ctx.strokeRect(s*0.01, -s*0.34, s*0.07, s*0.12);
  ctx.strokeRect(-s*0.08, -s*0.2, s*0.07, s*0.12);
  ctx.strokeRect(s*0.01, -s*0.2, s*0.07, s*0.12);
  // Doorknocker (book/scroll)
  ctx.fillStyle = '#d4a060'; ctx.font = '7px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('📖', 0, -s*0.2);

  // === FLOATING BOOKS (animated) ===
  var bookBob = Math.abs(Math.sin(t*0.04))*s*0.08;
  ctx.font = '13px Arial'; ctx.textAlign='center';
  ctx.fillText('📚', -s*0.06, -s*0.9 - bookBob);
  ctx.fillText('📖', s*0.14, -s*0.84 - bookBob*0.7);
  ctx.fillText('📜', -s*0.2, -s*0.82 - bookBob*0.5);

  // === READING LAMP (window) ===
  var lmpG = 0.6 + 0.4*Math.sin(t*0.07);
  ctx.shadowColor = '#fde68a'; ctx.shadowBlur = 10*lmpG;
  ctx.fillStyle = 'rgba(253,230,138,'+lmpG*0.4+')';
  ctx.beginPath(); ctx.arc(-s*0.23, -s*0.32, s*0.06, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;

  // === STONE LION STATUES ===
  ctx.font = '11px Arial'; ctx.textAlign='center';
  ctx.fillText('🦁', -s*0.46, -s*0.08);
  ctx.fillText('🦁', s*0.46, -s*0.08);
};

// ── STADIUM ──────────────────────────────────────────────────
GameRenderer.prototype._sStadium = function(ctx, s, level, tick) {
  var t = tick;

  // === OUTER STRUCTURE ===
  // Outer concourse / bowl
  var outer = ctx.createRadialGradient(0, -s*0.2, s*0.22, 0, -s*0.2, s*0.58);
  outer.addColorStop(0, '#1f2937'); outer.addColorStop(0.6, '#374151'); outer.addColorStop(1, '#1f2937');
  ctx.fillStyle = outer;
  ctx.beginPath(); ctx.ellipse(0, -s*0.2, s*0.58, s*0.32, 0, 0, Math.PI*2); ctx.fill();
  // Stadium shell
  ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, -s*0.2, s*0.58, s*0.32, 0, 0, Math.PI*2); ctx.stroke();
  // Exterior facade panels
  ctx.strokeStyle = 'rgba(107,114,128,0.3)'; ctx.lineWidth = 1;
  for (var ep = 0; ep < 16; ep++) {
    var epa = ep*Math.PI/8;
    ctx.beginPath(); ctx.moveTo(Math.cos(epa)*s*0.52, -s*0.2+Math.sin(epa)*s*0.28);
    ctx.lineTo(Math.cos(epa)*s*0.58, -s*0.2+Math.sin(epa)*s*0.32); ctx.stroke();
  }

  // === SEATING TIERS ===
  var tierData = [
    {rx:s*0.54,ry:s*0.28,c:'#1d4ed8'},{rx:s*0.48,ry:s*0.26,c:'#dc2626'},
    {rx:s*0.42,ry:s*0.22,c:'#1d4ed8'},{rx:s*0.36,ry:s*0.19,c:'#dc2626'},
    {rx:s*0.3,ry:s*0.16,c:'#374151'},{rx:s*0.24,ry:s*0.13,c:'#374151'}
  ];
  tierData.forEach(function(tier, i) {
    // Seat color row
    ctx.fillStyle = tier.c;
    ctx.beginPath(); ctx.ellipse(0, -s*0.2, tier.rx, tier.ry, 0, 0, Math.PI*2); ctx.fill();
    // Darker inner
    var inner = ctx.createRadialGradient(0,-s*0.2,tier.rx*0.85,0,-s*0.2,tier.rx);
    inner.addColorStop(0,'rgba(0,0,0,0.1)'); inner.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = inner;
    ctx.beginPath(); ctx.ellipse(0, -s*0.2, tier.rx, tier.ry, 0, 0, Math.PI*2); ctx.fill();
    // Row lines
    if (i < 4) {
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.5;
      for (var sr = 0; sr < 4; sr++) {
        var srr = tier.rx - sr*s*0.015;
        ctx.beginPath(); ctx.ellipse(0,-s*0.2,srr,tier.ry*srr/tier.rx,0,0,Math.PI*2); ctx.stroke();
      }
    }
  });

  // === PLAYING FIELD ===
  var fieldG = ctx.createRadialGradient(0,-s*0.2,0,0,-s*0.2,s*0.23);
  fieldG.addColorStop(0,'#22c55e'); fieldG.addColorStop(0.5,'#16a34a'); fieldG.addColorStop(1,'#15803d');
  ctx.fillStyle = fieldG;
  ctx.beginPath(); ctx.ellipse(0,-s*0.2,s*0.23,s*0.13,0,0,Math.PI*2); ctx.fill();
  // Mow stripes
  for (var ms = 0; ms < 6; ms++) {
    ctx.fillStyle = ms%2===0 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.03)';
    ctx.beginPath(); ctx.ellipse(0,-s*0.2,s*(0.22-ms*0.037),s*(0.125-ms*0.021),0,0,Math.PI*2); ctx.fill();
  }
  // Field markings
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(0,-s*0.2,s*0.1,s*0.055,0,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,-s*0.33); ctx.lineTo(0,-s*0.07); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.23,-s*0.2); ctx.lineTo(s*0.23,-s*0.2); ctx.stroke();
  // Center spot
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0,-s*0.2,3,0,Math.PI*2); ctx.fill();
  // Penalty boxes
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 0.7;
  ctx.strokeRect(-s*0.08,-s*0.32,s*0.16,s*0.06);
  ctx.strokeRect(-s*0.08,-s*0.14,s*0.16,s*0.06);
  // Corner arcs
  for (var ca = 0; ca < 4; ca++) {
    var cax = ca%2===0 ? -s*0.23 : s*0.23;
    var cay = ca<2 ? -s*0.33 : -s*0.07;
    ctx.beginPath(); ctx.arc(cax,cay,s*0.03,0,Math.PI*2); ctx.stroke();
  }
  // Goal posts
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-s*0.04,-s*0.34); ctx.lineTo(-s*0.04,-s*0.38); ctx.lineTo(s*0.04,-s*0.38); ctx.lineTo(s*0.04,-s*0.34); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.04,-s*0.06); ctx.lineTo(-s*0.04,-s*0.02); ctx.lineTo(s*0.04,-s*0.02); ctx.lineTo(s*0.04,-s*0.06); ctx.stroke();

  // === FLOODLIGHTS ===
  var flPos = [[-s*0.56,-s*0.58],[s*0.56,-s*0.58],[-s*0.56,s*0.1],[s*0.56,s*0.1]];
  flPos.forEach(function(fl7, i) {
    // Mast
    ctx.fillStyle = '#6b7280'; ctx.fillRect(fl7[0]-2, fl7[1], 4, s*0.48);
    // Cross arm
    ctx.fillRect(fl7[0]-s*0.08, fl7[1], s*0.16, 3);
    // Light housing
    var lgh = 0.75 + 0.25*Math.sin(t*0.1+i);
    ctx.shadowColor = '#fef9c3'; ctx.shadowBlur = 22*lgh;
    ctx.fillStyle = 'rgba(255,250,200,'+lgh+')';
    for (var lp3 = -2; lp3 <= 2; lp3++) {
      ctx.beginPath(); ctx.arc(fl7[0]+lp3*s*0.032, fl7[1], 5, 0, Math.PI*2); ctx.fill();
    }
    ctx.shadowBlur = 0;
    // Mast base
    ctx.fillStyle = '#4b5563'; ctx.fillRect(fl7[0]-4, fl7[1]+s*0.46, 8, s*0.04);
  });

  // === SCOREBOARD ===
  ctx.fillStyle = '#111827'; ctx.fillRect(-s*0.3,-s*0.56,s*0.6,s*0.14);
  ctx.strokeStyle = '#374151'; ctx.lineWidth = 1; ctx.strokeRect(-s*0.3,-s*0.56,s*0.6,s*0.14);
  var sb2 = Math.floor(t/60)%2===0;
  ctx.fillStyle = sb2 ? '#22c55e' : '#ef4444';
  ctx.font = 'bold 7px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(Math.floor(t/120)%5 + ' : ' + Math.floor(t/80)%4, 0, -s*0.49);

  // === CROWD CELEBRATION ===
  var crowd = Math.floor(t/12)%6===0;
  if (crowd) {
    ctx.font = '8px Arial'; ctx.textAlign='center';
    for (var ce = 0; ce < 4; ce++) {
      var cex = Math.cos(t*0.15+ce)*s*0.44, cey = -s*0.2+Math.sin(t*0.12+ce)*s*0.24;
      ctx.fillText(['🎉','🎊','⚽','👏'][ce], cex, cey);
    }
  }

  // === TEAM BANNERS ===
  ctx.fillStyle = '#dc2626'; ctx.fillRect(-s*0.58,-s*0.42,s*0.06,s*0.2);
  ctx.fillStyle = '#1d4ed8'; ctx.fillRect(s*0.52,-s*0.42,s*0.06,s*0.2);
  var bw4 = Math.sin(t*0.1)*3;
  ctx.fillStyle = 'rgba(220,38,38,0.8)';
  ctx.beginPath(); ctx.moveTo(-s*0.52,-s*0.42); ctx.lineTo(-s*0.52+bw4,-s*0.34); ctx.lineTo(-s*0.52,-s*0.26); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(29,78,216,0.8)';
  ctx.beginPath(); ctx.moveTo(s*0.52,-s*0.42); ctx.lineTo(s*0.52-bw4,-s*0.34); ctx.lineTo(s*0.52,-s*0.26); ctx.closePath(); ctx.fill();
};

// ── CRYSTAL MINE ─────────────────────────────────────────────
GameRenderer.prototype._sCrystalMine = function(ctx, s, level, tick) {
  var t = tick;

  // === MAGICAL GROUND ===
  var mground = ctx.createRadialGradient(0, 0, 0, 0, 0, s*0.5);
  mground.addColorStop(0, '#4c1d95'); mground.addColorStop(0.5, '#2e1065'); mground.addColorStop(1, '#1a0840');
  ctx.fillStyle = mground;
  ctx.beginPath(); ctx.ellipse(0, -s*0.02, s*0.5, s*0.16, 0, 0, Math.PI*2); ctx.fill();
  // Crystal dust on ground
  for (var cd = 0; cd < 20; cd++) {
    var cdx = Math.cos(cd*0.31)*s*(0.1+cd%4*0.08);
    var cdy = -s*0.02 + Math.sin(cd*0.31)*s*(0.04+cd%3*0.03);
    var cdp = 0.4 + 0.4*Math.sin(t*0.08+cd*0.8);
    ctx.fillStyle = 'rgba(167,139,250,'+cdp+')';
    ctx.beginPath(); ctx.arc(cdx, cdy, 1+cd%2, 0, Math.PI*2); ctx.fill();
  }

  // === MINE ENTRANCE ===
  // Outer stone arch
  ctx.fillStyle = '#374151';
  ctx.beginPath(); ctx.arc(0, -s*0.24, s*0.32, Math.PI, 0); ctx.rect(-s*0.32, -s*0.24, s*0.64, s*0.24); ctx.fill();
  // Stone arch blocks
  ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 1;
  for (var ab2 = 0; ab2 < 12; ab2++) {
    var aa2 = Math.PI + ab2*Math.PI/12;
    ctx.beginPath();
    ctx.moveTo(Math.cos(aa2)*s*0.32, -s*0.24+Math.sin(aa2)*s*0.32);
    ctx.lineTo(Math.cos(aa2)*s*0.26, -s*0.24+Math.sin(aa2)*s*0.26);
    ctx.stroke();
  }
  // Inner arch (darker)
  ctx.fillStyle = '#0f0720';
  ctx.beginPath(); ctx.arc(0, -s*0.24, s*0.26, Math.PI, 0); ctx.rect(-s*0.26, -s*0.24, s*0.52, s*0.24); ctx.fill();
  // Purple glow from inside
  var iglow = 0.35 + 0.2*Math.sin(t*0.07);
  var ig2 = ctx.createRadialGradient(0, -s*0.16, 0, 0, -s*0.16, s*0.22);
  ig2.addColorStop(0, 'rgba(167,139,250,'+iglow+')'); ig2.addColorStop(1, 'rgba(109,40,217,0)');
  ctx.fillStyle = ig2;
  ctx.beginPath(); ctx.arc(0, -s*0.24, s*0.26, Math.PI, 0); ctx.rect(-s*0.26, -s*0.24, s*0.52, s*0.24); ctx.fill();
  // Support beams in entrance
  ctx.strokeStyle = '#5c3010'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-s*0.22, -s*0.24); ctx.lineTo(-s*0.22, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.22, -s*0.24); ctx.lineTo(s*0.22, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.26, -s*0.24); ctx.lineTo(s*0.26, -s*0.24); ctx.stroke();
  // Beam bolts
  ctx.fillStyle = '#888';
  for (var bolt = 0; bolt < 4; bolt++) {
    ctx.beginPath(); ctx.arc(-s*0.22, -bolt*s*0.06, 2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(s*0.22, -bolt*s*0.06, 2, 0, Math.PI*2); ctx.fill();
  }

  // === CRYSTALS ===
  var crystalData2 = [
    {x:-s*0.2, y:-s*0.56, size:s*0.12, rot:0.2},
    {x: s*0.04, y:-s*0.72, size:s*0.15, rot:-0.1},
    {x: s*0.22, y:-s*0.58, size:s*0.11, rot:0.3},
    {x:-s*0.08, y:-s*0.44, size:s*0.08, rot:-0.2},
    {x: s*0.14, y:-s*0.44, size:s*0.07, rot:0.15},
    {x:-s*0.34, y:-s*0.38, size:s*0.07, rot:-0.3},
    {x: s*0.36, y:-s*0.4,  size:s*0.08, rot: 0.25}
  ];
  crystalData2.forEach(function(c, i) {
    var pha = t*0.06+i*1.3;
    var cp3 = 0.85+0.15*Math.sin(pha);
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot + Math.sin(pha*0.7)*0.08);
    // Glow aura
    var aura = ctx.createRadialGradient(0, 0, 0, 0, 0, c.size*1.4);
    aura.addColorStop(0, 'rgba(167,139,250,'+(0.3*cp3)+')');
    aura.addColorStop(1, 'rgba(109,40,217,0)');
    ctx.fillStyle = aura; ctx.beginPath(); ctx.arc(0, 0, c.size*1.4, 0, Math.PI*2); ctx.fill();
    // Crystal body (hexagonal prism)
    var cg3 = ctx.createLinearGradient(-c.size*0.5, 0, c.size*0.5, c.size*0.6);
    cg3.addColorStop(0,'#e9d5ff'); cg3.addColorStop(0.3,'#c4b5fd'); cg3.addColorStop(0.6,'#8b5cf6'); cg3.addColorStop(1,'#4c1d95');
    ctx.fillStyle = cg3;
    ctx.shadowColor = '#a78bfa'; ctx.shadowBlur = 18*cp3;
    // Main crystal shape
    ctx.beginPath();
    ctx.moveTo(0, -c.size*1.8);
    ctx.lineTo(c.size*0.6, -c.size*0.4);
    ctx.lineTo(c.size*0.6, c.size*0.5);
    ctx.lineTo(0, c.size*0.7);
    ctx.lineTo(-c.size*0.6, c.size*0.5);
    ctx.lineTo(-c.size*0.6, -c.size*0.4);
    ctx.closePath(); ctx.fill();
    // Left facet (darker)
    ctx.fillStyle = 'rgba(76,29,149,0.5)';
    ctx.beginPath(); ctx.moveTo(-c.size*0.6, -c.size*0.4); ctx.lineTo(0, -c.size*1.8); ctx.lineTo(0, c.size*0.7); ctx.lineTo(-c.size*0.6, c.size*0.5); ctx.closePath(); ctx.fill();
    // Top highlight
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.moveTo(0, -c.size*1.8); ctx.lineTo(c.size*0.3, -c.size*0.4); ctx.lineTo(0, -c.size*0.6); ctx.closePath(); ctx.fill();
    // Inner secondary crystal
    ctx.fillStyle = 'rgba(237,233,254,0.25)';
    ctx.beginPath(); ctx.moveTo(0,-c.size*1.2); ctx.lineTo(c.size*0.3, -c.size*0.2); ctx.lineTo(0,c.size*0.3); ctx.lineTo(-c.size*0.3,-c.size*0.2); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.restore();
  });

  // === MINECART TRACK ===
  ctx.strokeStyle = '#7c6040'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-s*0.5, s*0.04); ctx.bezierCurveTo(-s*0.3, s*0.0, -s*0.1, -s*0.04, s*0.0, -s*0.06); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.44, s*0.04); ctx.bezierCurveTo(-s*0.24, s*0.0, -s*0.04, -s*0.04, s*0.06, -s*0.06); ctx.stroke();
  // Track ties
  for (var tk2 = 0; tk2 < 6; tk2++) {
    var tkx2 = -s*0.46 + tk2*s*0.1;
    var tky = s*0.04 - tk2*s*0.016;
    ctx.strokeStyle = '#5c4020'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(tkx2, tky); ctx.lineTo(tkx2+s*0.07, tky-s*0.014); ctx.stroke();
  }
  // Crystal-laden minecart
  var cX = -s*0.38 + Math.sin(t*0.022)*s*0.2;
  ctx.fillStyle = '#5c4020'; ctx.fillRect(cX, -s*0.14, s*0.18, s*0.1);
  ctx.strokeStyle = '#3c2810'; ctx.lineWidth = 0.5; ctx.strokeRect(cX+2,-s*0.12,s*0.14,s*0.07);
  // Crystal cargo glow
  ctx.shadowColor = '#a78bfa'; ctx.shadowBlur = 10;
  ctx.fillStyle = '#c4b5fd'; ctx.beginPath(); ctx.ellipse(cX+s*0.09,-s*0.12,s*0.06,s*0.04,0,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
  // Wheels
  ctx.fillStyle = '#333';
  ctx.beginPath(); ctx.arc(cX+s*0.04,-s*0.04,4,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cX+s*0.14,-s*0.04,4,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#888';
  ctx.beginPath(); ctx.arc(cX+s*0.04,-s*0.04,2,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cX+s*0.14,-s*0.04,2,0,Math.PI*2); ctx.fill();

  // === DANGER SIGNS ===
  ctx.fillStyle = '#7c2d0c'; ctx.fillRect(s*0.1, -s*0.54, s*0.1, s*0.08);
  ctx.fillStyle = '#fbbf24'; ctx.font = '7px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('⚠️', s*0.15, -s*0.5);
  ctx.fillStyle = '#fff'; ctx.font = '5px Arial'; ctx.fillText('MAGIC', s*0.15, -s*0.44);

  // === FLOATING PARTICLES ===
  for (var fp2 = 0; fp2 < 8; fp2++) {
    var fpa = t*0.08 + fp2*0.785;
    var fpr = s*0.34 + Math.sin(t*0.05+fp2)*s*0.1;
    var fpx2 = Math.cos(fpa)*fpr;
    var fpy = -s*0.36 + Math.sin(fpa)*s*0.14;
    var fpalpha = 0.5+0.5*Math.sin(t*0.1+fp2*1.1);
    ctx.fillStyle = 'rgba(196,181,253,'+fpalpha+')';
    ctx.beginPath(); ctx.arc(fpx2, fpy, 2+fp2%3, 0, Math.PI*2); ctx.fill();
  }
};

// ── ARCANE TOWER ─────────────────────────────────────────────
GameRenderer.prototype._sArcaneTower = function(ctx, s, level, tick) {
  var t = tick;

  // === MAGICAL GROUND ===
  var aground = ctx.createRadialGradient(0, 0, 0, 0, 0, s*0.36);
  aground.addColorStop(0, '#2e1065'); aground.addColorStop(1, '#1a0840');
  ctx.fillStyle = aground;
  ctx.beginPath(); ctx.ellipse(0, 0, s*0.36, s*0.12, 0, 0, Math.PI*2); ctx.fill();
  // Rune circle on ground
  var runePulse = 0.5 + 0.5*Math.sin(t*0.05);
  ctx.strokeStyle = 'rgba(167,139,250,'+runePulse+')'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, s*0.28, 0, Math.PI*2); ctx.stroke();
  ctx.strokeStyle = 'rgba(167,139,250,'+(runePulse*0.5)+')'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.arc(0, 0, s*0.22, 0, Math.PI*2); ctx.stroke();
  // Rune symbols
  var runeA = t * 0.03;
  for (var rn = 0; rn < 8; rn++) {
    var rna = runeA + rn*Math.PI/4;
    var rnx = Math.cos(rna)*s*0.25, rny = Math.sin(rna)*s*0.1;
    ctx.fillStyle = 'rgba(196,181,253,'+(0.6+0.4*Math.sin(t*0.06+rn))+')';
    ctx.font = '6px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(['ᚠ','ᚢ','ᚦ','ᚨ','ᚱ','ᚲ','ᚷ','ᚹ'][rn], rnx, rny);
  }

  // === STONE BASE (octagonal) ===
  var baseG = ctx.createLinearGradient(-s*0.32, -s*0.22, s*0.32, 0);
  baseG.addColorStop(0, '#4c1d95'); baseG.addColorStop(0.5, '#5b21b6'); baseG.addColorStop(1, '#3b0764');
  ctx.fillStyle = baseG;
  ctx.beginPath();
  for (var bi2 = 0; bi2 < 8; bi2++) {
    var ba = bi2*Math.PI/4 - Math.PI/8;
    if (bi2===0) ctx.moveTo(Math.cos(ba)*s*0.32, Math.sin(ba)*s*0.12);
    else ctx.lineTo(Math.cos(ba)*s*0.32, Math.sin(ba)*s*0.12);
  }
  ctx.closePath(); ctx.fill();
  // Base edge
  ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 1.5; ctx.stroke();
  // Base stone blocks
  ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.6;
  for (var bs3 = 0; bs3 < 8; bs3++) {
    var bsa = bs3*Math.PI/4;
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.cos(bsa)*s*0.32, Math.sin(bsa)*s*0.12); ctx.stroke();
  }
  // Rotating rune lights on base
  for (var rl2 = 0; rl2 < 4; rl2++) {
    var rla = t*0.04 + rl2*Math.PI/2;
    var rlp = 0.6+0.4*Math.sin(t*0.08+rl2);
    ctx.fillStyle = 'rgba(139,92,246,'+rlp+')';
    ctx.beginPath(); ctx.arc(Math.cos(rla)*s*0.24, Math.sin(rla)*s*0.08, 3, 0, Math.PI*2); ctx.fill();
  }

  // === TOWER BODY (tapered) ===
  // Back side
  var towerBG = ctx.createLinearGradient(s*0.16, -s*0.22, s*0.22, -s*0.86);
  towerBG.addColorStop(0,'#3b0764'); towerBG.addColorStop(1,'#2e1065');
  ctx.fillStyle = towerBG;
  ctx.beginPath();
  ctx.moveTo(-s*0.16,-s*0.22); ctx.lineTo(-s*0.1,-s*0.86); ctx.lineTo(s*0.1,-s*0.86); ctx.lineTo(s*0.16,-s*0.22);
  ctx.closePath(); ctx.fill();
  // Front side
  var towerG2 = ctx.createLinearGradient(-s*0.22, -s*0.22, s*0.22, -s*0.86);
  towerG2.addColorStop(0,'#5b21b6'); towerG2.addColorStop(0.5,'#7c3aed'); towerG2.addColorStop(1,'#4c1d95');
  ctx.fillStyle = towerG2;
  ctx.beginPath();
  ctx.moveTo(-s*0.22,-s*0.22); ctx.lineTo(-s*0.16,-s*0.22); ctx.lineTo(-s*0.1,-s*0.86); ctx.lineTo(s*0.1,-s*0.86);
  ctx.lineTo(s*0.16,-s*0.22); ctx.lineTo(s*0.22,-s*0.22);
  ctx.lineTo(s*0.16,-s*0.22); ctx.lineTo(s*0.1,-s*0.86);
  ctx.lineTo(-s*0.1,-s*0.86); ctx.lineTo(-s*0.16,-s*0.22);
  ctx.closePath(); ctx.fill();
  // Stone block texture on tower
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.6;
  for (var tb2 = 0; tb2 < 8; tb2++) {
    var tby2 = -s*0.24 - tb2*s*0.08;
    var tbw2 = s*0.22 - tb2*s*0.015;
    ctx.beginPath(); ctx.moveTo(-tbw2, tby2); ctx.lineTo(tbw2, tby2); ctx.stroke();
    if (tb2%2===0) { ctx.beginPath(); ctx.moveTo(0, tby2); ctx.lineTo(0, tby2-s*0.08); ctx.stroke(); }
  }
  // Edge highlights
  ctx.strokeStyle = 'rgba(139,92,246,0.4)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-s*0.22,-s*0.22); ctx.lineTo(-s*0.1,-s*0.86); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.22,-s*0.22); ctx.lineTo(s*0.1,-s*0.86); ctx.stroke();

  // === MAGICAL WINDOWS ===
  var winData = [[0,-s*0.44,s*0.06],[0,-s*0.6,s*0.055],[0,-s*0.74,s*0.045]];
  winData.forEach(function(wd, i) {
    var wglow = 0.75+0.25*Math.sin(t*0.12+i*1.5);
    ctx.shadowColor = '#c4b5fd'; ctx.shadowBlur = 18*wglow;
    // Window arch
    ctx.fillStyle = 'rgba(196,181,253,'+wglow+')';
    ctx.beginPath(); ctx.arc(wd[0], wd[1], wd[2], 0, Math.PI*2); ctx.fill();
    // Inner glow
    ctx.fillStyle = 'rgba(237,233,254,0.8)';
    ctx.beginPath(); ctx.arc(wd[0], wd[1], wd[2]*0.55, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    // Window surround
    ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(wd[0], wd[1], wd[2]*1.2, 0, Math.PI*2); ctx.stroke();
  });

  // === MAGICAL BALCONY (mid) ===
  ctx.fillStyle = '#4c1d95'; ctx.fillRect(-s*0.2, -s*0.5, s*0.4, s*0.025);
  ctx.strokeStyle = 'rgba(139,92,246,0.6)'; ctx.lineWidth = 0.8;
  for (var mbl = -3; mbl <= 3; mbl++) {
    ctx.beginPath(); ctx.moveTo(mbl*s*0.055, -s*0.5); ctx.lineTo(mbl*s*0.055, -s*0.56); ctx.stroke();
  }

  // === CONICAL ROOF ===
  var roofG3 = ctx.createLinearGradient(-s*0.18, -s*0.86, s*0.18, -s*1.22);
  roofG3.addColorStop(0,'#4c1d95'); roofG3.addColorStop(0.5,'#2e1065'); roofG3.addColorStop(1,'#1a0840');
  ctx.fillStyle = roofG3;
  ctx.beginPath(); ctx.moveTo(-s*0.18,-s*0.86); ctx.lineTo(0,-s*1.22); ctx.lineTo(s*0.18,-s*0.86); ctx.closePath(); ctx.fill();
  // Roof edge
  ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-s*0.18,-s*0.86); ctx.lineTo(0,-s*1.22); ctx.lineTo(s*0.18,-s*0.86); ctx.stroke();
  // Stars on roof
  ctx.fillStyle = 'rgba(255,253,200,0.9)';
  var starPositions = [[s*0.06,-s*0.94],[- s*0.07,-s*1.0],[s*0.03,-s*1.07],[-s*0.02,-s*0.9],[s*0.1,-s*1.04]];
  starPositions.forEach(function(sp, i) {
    var sp2 = 0.5+0.5*Math.sin(t*0.1+i*1.3);
    ctx.globalAlpha = sp2;
    ctx.beginPath(); ctx.arc(sp[0], sp[1], 1.5+sp2, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  });
  // Moon crescent
  ctx.fillStyle = 'rgba(253,230,138,0.9)'; ctx.beginPath(); ctx.arc(-s*0.04, -s*1.04, s*0.04, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#2e1065'; ctx.beginPath(); ctx.arc(-s*0.02, -s*1.05, s*0.032, 0, Math.PI*2); ctx.fill();

  // === TOP ORB (pulsing) ===
  var orbPulse = 0.65+0.35*Math.sin(t*0.1);
  ctx.shadowColor = '#c4b5fd'; ctx.shadowBlur = 30*orbPulse;
  // Outer glow sphere
  var orbG = ctx.createRadialGradient(0,-s*1.22,0,0,-s*1.22,s*0.14);
  orbG.addColorStop(0,'rgba(237,233,254,'+(0.9+orbPulse*0.1)+')');
  orbG.addColorStop(0.4,'rgba(167,139,250,'+(0.8*orbPulse)+')');
  orbG.addColorStop(1,'rgba(109,40,217,0)');
  ctx.fillStyle = orbG; ctx.beginPath(); ctx.arc(0,-s*1.22,s*0.14,0,Math.PI*2); ctx.fill();
  // Inner orb
  ctx.fillStyle = 'rgba(196,181,253,'+(0.95)+')';
  ctx.beginPath(); ctx.arc(0,-s*1.22,s*0.09,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath(); ctx.arc(-s*0.03,-s*1.26,s*0.04,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;

  // === ORBITING PARTICLES ===
  for (var op5 = 0; op5 < 5; op5++) {
    var oa3 = t*0.12 + op5*Math.PI*0.4;
    var orbR = s*0.28;
    var opx = Math.cos(oa3)*orbR;
    var opy = -s*0.84+Math.sin(oa3)*s*0.12;
    var opa = 0.7+0.3*Math.sin(t*0.15+op5);
    ctx.fillStyle = 'rgba(196,181,253,'+opa+')';
    ctx.beginPath(); ctx.arc(opx, opy, 3+op5%2, 0, Math.PI*2); ctx.fill();
    // Particle trail
    ctx.strokeStyle = 'rgba(167,139,250,'+(opa*0.3)+')'; ctx.lineWidth = 1;
    var trailA = oa3 - 0.5;
    ctx.beginPath(); ctx.arc(0,-s*0.84,orbR,trailA,oa3); ctx.stroke();
  }

  // === LIGHTNING BOLTS (from top) ===
  if (Math.floor(t/8)%20===0) {
    ctx.strokeStyle = 'rgba(196,181,253,0.8)'; ctx.lineWidth = 1.5;
    ctx.shadowColor = '#a78bfa'; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0,-s*1.22); ctx.lineTo(s*0.08,-s*1.0); ctx.lineTo(s*0.02,-s*0.96); ctx.lineTo(s*0.12,-s*0.78);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0,-s*1.22); ctx.lineTo(-s*0.09,-s*1.04); ctx.lineTo(-s*0.03,-s*0.98); ctx.lineTo(-s*0.11,-s*0.8);
    ctx.stroke();
    ctx.shadowBlur = 0;
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


// ─── Windmill sprite ──────────────────────────────────────────
GameRenderer.prototype._sWindmill = function(ctx, s, level, tick) {
  var t = tick;
  var rotSpeed = 0.018 + level * 0.003;
  var angle = t * rotSpeed;

  // === BASE FOUNDATION ===
  ctx.fillStyle = '#d1d5db';
  ctx.beginPath();
  ctx.ellipse(0, s*0.05, s*0.22, s*0.09, 0, 0, Math.PI*2);
  ctx.fill();

  // === STONE TOWER (tapered) ===
  var towerGrad = ctx.createLinearGradient(-s*0.18, -s*0.7, s*0.18, 0);
  towerGrad.addColorStop(0, '#e5e7eb');
  towerGrad.addColorStop(0.4, '#d1d5db');
  towerGrad.addColorStop(1, '#9ca3af');
  ctx.fillStyle = towerGrad;
  ctx.beginPath();
  ctx.moveTo(-s*0.18, 0);
  ctx.lineTo(-s*0.12, -s*0.70);
  ctx.lineTo(s*0.12, -s*0.70);
  ctx.lineTo(s*0.18, 0);
  ctx.closePath();
  ctx.fill();

  // Stone texture lines
  ctx.strokeStyle = 'rgba(107,114,128,0.3)';
  ctx.lineWidth = 0.8;
  for (var row = 0; row < 7; row++) {
    var ry = -row * s * 0.1;
    var rw = s*0.18 - row * s * 0.008;
    ctx.beginPath();
    ctx.moveTo(-rw, ry);
    ctx.lineTo(rw, ry);
    ctx.stroke();
    // Alternating brick joints
    if (row % 2 === 0) {
      ctx.beginPath();
      ctx.moveTo(0, ry);
      ctx.lineTo(0, ry - s*0.1);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(-rw*0.5, ry);
      ctx.lineTo(-rw*0.5, ry - s*0.1);
      ctx.stroke();
    }
  }

  // Tower right shadow
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.moveTo(s*0.12, -s*0.70);
  ctx.lineTo(s*0.18, 0);
  ctx.lineTo(s*0.22, 0);
  ctx.lineTo(s*0.16, -s*0.70);
  ctx.closePath();
  ctx.fill();

  // === DOME CAP ===
  var domeGrad = ctx.createRadialGradient(-s*0.04, -s*0.76, 0, 0, -s*0.72, s*0.2);
  domeGrad.addColorStop(0, '#fde68a');
  domeGrad.addColorStop(0.5, '#d97706');
  domeGrad.addColorStop(1, '#92400e');
  ctx.fillStyle = domeGrad;
  ctx.beginPath();
  ctx.arc(0, -s*0.72, s*0.16, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = 1;
  ctx.stroke();

  // === DOOR ===
  ctx.fillStyle = '#92400e';
  ctx.beginPath();
  ctx.roundRect(-s*0.06, -s*0.28, s*0.12, s*0.28, s*0.06);
  ctx.fill();
  ctx.fillStyle = '#78350f';
  ctx.beginPath();
  ctx.arc(0, -s*0.28, s*0.06, Math.PI, 0);
  ctx.fill();
  // Door handle
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(s*0.035, -s*0.14, 2.5, 0, Math.PI*2);
  ctx.fill();

  // === WINDOWS ===
  for (var wd = 0; wd < 2; wd++) {
    var wyy = -s*(0.42 + wd*0.16);
    ctx.fillStyle = '#1e3a5f';
    ctx.beginPath();
    ctx.arc(0, wyy, s*0.04, Math.PI, 0);
    ctx.fillRect(-s*0.04, wyy, s*0.08, s*0.04);
    ctx.fill();
    // Window shine
    ctx.fillStyle = 'rgba(147,210,255,0.5)';
    ctx.beginPath();
    ctx.arc(-s*0.01, wyy - s*0.01, s*0.018, Math.PI, 0);
    ctx.fill();
  }

  // === ROTATING SAILS (4 blades) ===
  ctx.save();
  ctx.translate(0, -s*0.72);
  ctx.rotate(angle);

  for (var blade = 0; blade < 4; blade++) {
    ctx.save();
    ctx.rotate(blade * Math.PI / 2);

    // Blade arm
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -s*0.42);
    ctx.stroke();

    // Sail fabric (tapered)
    var sailGrad = ctx.createLinearGradient(-s*0.12, 0, s*0.04, -s*0.42);
    sailGrad.addColorStop(0, 'rgba(254,243,199,0.95)');
    sailGrad.addColorStop(0.5, 'rgba(252,211,77,0.85)');
    sailGrad.addColorStop(1, 'rgba(245,158,11,0.7)');
    ctx.fillStyle = sailGrad;
    ctx.beginPath();
    ctx.moveTo(0, -s*0.04);
    ctx.lineTo(-s*0.14, -s*0.12);
    ctx.lineTo(-s*0.10, -s*0.40);
    ctx.lineTo(s*0.02, -s*0.42);
    ctx.lineTo(s*0.03, -s*0.04);
    ctx.closePath();
    ctx.fill();

    // Sail stripes
    ctx.strokeStyle = 'rgba(180,83,9,0.4)';
    ctx.lineWidth = 1;
    for (var stripe = 1; stripe < 4; stripe++) {
      var sf = stripe / 4;
      ctx.beginPath();
      ctx.moveTo(-s*0.14*sf + s*0.03*(1-sf), -s*0.04 - sf*s*0.38);
      ctx.lineTo(-s*0.10*sf + s*0.02*(1-sf), -s*0.12 - sf*s*0.28);
      ctx.stroke();
    }

    // Cross brace
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-s*0.08, -s*0.16);
    ctx.lineTo(s*0.02, -s*0.32);
    ctx.stroke();

    ctx.restore();
  }

  // Centre hub
  var hubGrad = ctx.createRadialGradient(-2, -2, 0, 0, 0, s*0.07);
  hubGrad.addColorStop(0, '#f8fafc');
  hubGrad.addColorStop(1, '#78350f');
  ctx.fillStyle = hubGrad;
  ctx.beginPath();
  ctx.arc(0, 0, s*0.07, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Hub bolt
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(0, 0, s*0.02, 0, Math.PI*2);
  ctx.fill();

  ctx.restore();

  // === WIND STREAKS (animated) ===
  for (var ws = 0; ws < 5; ws++) {
    var wt = (t * 1.2 + ws * 17) % 70;
    var wx = (ws - 2) * s*0.14;
    var walpha = Math.max(0, 0.4 - wt/70);
    ctx.strokeStyle = 'rgba(147,210,255,' + walpha + ')';
    ctx.lineWidth = 1;
    ctx.setLineDash([s*0.06, s*0.04]);
    ctx.beginPath();
    ctx.moveTo(wx - wt*0.8, -s*(0.4 + ws*0.06));
    ctx.lineTo(wx, -s*(0.4 + ws*0.06));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // === ENERGY AURA (level >= 5) ===
  if (level >= 5) {
    var ea = 0.3 + 0.2 * Math.sin(t * 0.1);
    var energyGrad = ctx.createRadialGradient(0, -s*0.4, 0, 0, -s*0.4, s*0.5);
    energyGrad.addColorStop(0, 'rgba(167,243,208,' + ea + ')');
    energyGrad.addColorStop(1, 'rgba(167,243,208,0)');
    ctx.fillStyle = energyGrad;
    ctx.beginPath();
    ctx.arc(0, -s*0.4, s*0.5, 0, Math.PI*2);
    ctx.fill();
  }
};


// ═══════════════════════════════════════════════════════════
//  ROAD TILE SYSTEM
//  Roads are drawn ON the tile surface (isometric projection).
//  Neighbor detection auto-selects segment type.
// ═══════════════════════════════════════════════════════════

// Returns which of the 4 cardinal neighbors are also roads
// N = gy-1, S = gy+1, E = gx+1, W = gx-1  (iso directions)
GameRenderer.prototype._roadNeighbors = function(gx, gy) {
  var rm = this.roadMap || {};
  return {
    n: !!rm[gx + ',' + (gy - 1)],
    s: !!rm[gx + ',' + (gy + 1)],
    e: !!rm[(gx + 1) + ',' + gy],
    w: !!rm[(gx - 1) + ',' + gy]
  };
};

// Draw a complete road tile (replaces grass, paints asphalt + markings)
GameRenderer.prototype._drawRoadTile = function(ctx, gx, gy, tx, ty, building) {
  var tw = this.tileW, th = this.tileH, td = this.tileDepth;
  var hw = tw / 2, hh = th / 2;

  // Diamond corners
  var Nx = tx,      Ny = ty;
  var Ex = tx + hw, Ey = ty + hh;
  var Sx = tx,      Sy = ty + th;
  var Wx = tx - hw, Wy = ty + hh;

  // ── Clip to diamond ──────────────────────────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(Nx, Ny); ctx.lineTo(Ex, Ey);
  ctx.lineTo(Sx, Sy); ctx.lineTo(Wx, Wy);
  ctx.closePath();
  ctx.clip();

  // ── Base asphalt colour ──────────────────────────────────────
  // Dark grey, slight directional gradient for 3D feel
  var ag = ctx.createLinearGradient(Nx, Ny, Sx, Sy);
  ag.addColorStop(0,   '#4a5260');
  ag.addColorStop(0.4, '#424c57');
  ag.addColorStop(1,   '#363e48');
  ctx.fillStyle = ag;
  ctx.fillRect(Wx, Ny, tw, th);

  // ── Procedural asphalt texture ───────────────────────────────
  // Based on the reference photo: dark matrix + scattered light aggregate (pebbles)
  // We use a seeded pseudo-random based on tile coords for stability

  var seed = gx * 1374761 + gy * 2147483647;
  function rng() { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; }

  // 1) Fine dark matrix noise — tiny dark/mid flecks
  for (var i = 0; i < 55; i++) {
    var fx = Wx + rng() * tw;
    var fy = Ny + rng() * th;
    var fs = 0.8 + rng() * 1.4;
    var fb = Math.floor(rng() * 3); // 0=very dark, 1=dark, 2=mid
    var fc = fb === 0 ? 'rgba(20,24,30,0.55)' :
             fb === 1 ? 'rgba(35,40,48,0.45)' :
                        'rgba(65,72,82,0.35)';
    ctx.fillStyle = fc;
    ctx.beginPath();
    ctx.arc(fx, fy, fs, 0, Math.PI*2);
    ctx.fill();
  }

  // 2) Medium aggregate — slightly lighter angular bits
  for (var j = 0; j < 22; j++) {
    var ax = Wx + rng() * tw;
    var ay = Ny + rng() * th;
    var as2 = 1.2 + rng() * 2.2;
    var angle = rng() * Math.PI;
    var stretch = 0.5 + rng() * 0.8;
    var lightness = 70 + Math.floor(rng() * 55); // 70–125
    ctx.fillStyle = 'rgba(' + lightness + ',' + lightness + ',' + (lightness + 8) + ',0.40)';
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, 0, as2, as2 * stretch, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  // 3) Coarse aggregate — the bright pebbles visible in the photo (white/beige/rust)
  for (var k = 0; k < 9; k++) {
    var px2 = Wx + rng() * tw;
    var py2 = Ny + rng() * th;
    var pr = 1.5 + rng() * 2.8;
    var ptype = Math.floor(rng() * 4); // 0=white, 1=beige, 2=rust, 3=grey
    var pc;
    if      (ptype === 0) pc = 'rgba(210,215,220,' + (0.55 + rng()*0.3) + ')';
    else if (ptype === 1) pc = 'rgba(185,165,130,' + (0.50 + rng()*0.3) + ')';
    else if (ptype === 2) pc = 'rgba(165,100, 80,' + (0.45 + rng()*0.3) + ')';
    else                  pc = 'rgba(140,148,155,' + (0.50 + rng()*0.3) + ')';
    // Pebble body
    ctx.fillStyle = pc;
    ctx.beginPath();
    ctx.arc(px2, py2, pr, 0, Math.PI*2);
    ctx.fill();
    // Pebble highlight (top-left shine)
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.beginPath();
    ctx.arc(px2 - pr*0.25, py2 - pr*0.25, pr*0.45, 0, Math.PI*2);
    ctx.fill();
    // Pebble shadow (bottom-right)
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.arc(px2 + pr*0.2, py2 + pr*0.2, pr*0.5, 0, Math.PI*2);
    ctx.fill();
  }

  // 4) Micro-crack lines — subtle surface wear
  for (var c2 = 0; c2 < 3; c2++) {
    var cx3 = Wx + rng() * tw;
    var cy3 = Ny + rng() * th;
    var cl = 4 + rng() * 10;
    var ca = rng() * Math.PI;
    ctx.strokeStyle = 'rgba(20,25,32,0.20)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(cx3, cy3);
    ctx.lineTo(cx3 + Math.cos(ca)*cl, cy3 + Math.sin(ca)*cl);
    ctx.stroke();
  }

  // 5) Overall slight vignette — edges slightly darker
  var vig = ctx.createRadialGradient(tx, ty+hh, hw*0.1, tx, ty+hh, hw*1.2);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = vig;
  ctx.fillRect(Wx, Ny, tw, th);

  ctx.restore();

  // ── 2.5D asphalt side faces ──────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(Wx, Wy); ctx.lineTo(Sx, Sy);
  ctx.lineTo(Sx, Sy+td); ctx.lineTo(Wx, Wy+td);
  ctx.closePath();
  ctx.fillStyle = '#22282f';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(Sx, Sy); ctx.lineTo(Ex, Ey);
  ctx.lineTo(Ex, Ey+td); ctx.lineTo(Sx, Sy+td);
  ctx.closePath();
  ctx.fillStyle = '#1a1f25';
  ctx.fill();
};

// ═══════════════════════════════════════════════════════════
//  CAR SYSTEM
// ═══════════════════════════════════════════════════════════

GameRenderer.prototype._initCars = function() {
  this.cars = [];
  var roads = [];
  var rm = this.roadMap || {};
  for (var key in rm) {
    var parts = key.split(',');
    roads.push({ x: parseInt(parts[0]), y: parseInt(parts[1]) });
  }
  if (roads.length === 0) return;

  // 1 car per 6 road tiles
  var count = Math.min(Math.max(1, Math.floor(roads.length / 6)), 8);

  var carTypes = [
    { body: '#c0392b', roof: '#922b21', trim: '#e74c3c' }, // red sedan
    { body: '#2471a3', roof: '#1a5276', trim: '#3498db' }, // blue sedan
    { body: '#d4ac0d', roof: '#a07d09', trim: '#f4d03f' }, // yellow taxi
    { body: '#1e8449', roof: '#196f3d', trim: '#27ae60' }, // green SUV
    { body: '#6c3483', roof: '#512e5f', trim: '#9b59b6' }, // purple
    { body: '#fffff0', roof: '#d5d8dc', trim: '#f0f0f0' }, // white
    { body: '#1c2833', roof: '#17202a', trim: '#2e4057' }, // black
    { body: '#e67e22', roof: '#ca6f1e', trim: '#f39c12' }, // orange
  ];

  for (var i = 0; i < count; i++) {
    var startRoad = roads[Math.floor(Math.random() * roads.length)];
    var type = carTypes[i % carTypes.length];
    this.cars.push({
      x: startRoad.x,
      y: startRoad.y,
      nx: undefined,
      ny: undefined,
      dir: Math.floor(Math.random() * 4),
      progress: Math.random(),
      body: type.body,
      roof: type.roof,
      trim: type.trim,
      speed: 0.006 + Math.random() * 0.005,
      waitTimer: Math.floor(Math.random() * 20)
    });
  }
};

var CAR_DIRS = [
  {dx: 0, dy: -1}, // 0 N
  {dx: 1, dy:  0}, // 1 E
  {dx: 0, dy:  1}, // 2 S
  {dx:-1, dy:  0}, // 3 W
];

GameRenderer.prototype._updateAndDrawCars = function(ctx, tick) {
  if (!this.cars || this.cars.length === 0) return;
  var rm = this.roadMap || {};

  for (var i = 0; i < this.cars.length; i++) {
    var car = this.cars[i];

    if (car.waitTimer > 0) {
      car.waitTimer--;
    } else {
      car.progress += car.speed;
      if (car.progress >= 1) {
        car.x = (car.nx !== undefined) ? car.nx : car.x;
        car.y = (car.ny !== undefined) ? car.ny : car.y;
        car.progress = 0;
        car.nx = undefined; car.ny = undefined;

        var options = [];
        var opposite = (car.dir + 2) % 4;
        for (var d = 0; d < 4; d++) {
          if (d === opposite) continue;
          var nd = CAR_DIRS[d];
          if (rm[(car.x+nd.dx) + ',' + (car.y+nd.dy)]) options.push(d);
        }
        if (options.length === 0) {
          var rev = CAR_DIRS[opposite];
          if (rm[(car.x+rev.dx) + ',' + (car.y+rev.dy)]) options.push(opposite);
        }
        if (options.length > 0) {
          var chosen;
          var straight = options.indexOf(car.dir);
          if (straight >= 0 && Math.random() < 0.70) chosen = car.dir;
          else chosen = options[Math.floor(Math.random() * options.length)];
          car.dir = chosen;
          var cd = CAR_DIRS[chosen];
          car.nx = car.x + cd.dx;
          car.ny = car.y + cd.dy;
        } else {
          car.waitTimer = 40;
        }
      }
    }

    var fromX = car.x, fromY = car.y;
    var toX = (car.nx !== undefined) ? car.nx : fromX;
    var toY = (car.ny !== undefined) ? car.ny : fromY;
    var t = car.progress;

    var sc1 = this.gridToScreen(fromX, fromY);
    var sc2b = this.gridToScreen(toX, toY);
    // ride slightly offset from tile centre (keep to right side of road)
    var px = sc1.x + (sc2b.x - sc1.x) * t;
    var py = (sc1.y + this.tileH*0.5) + (sc2b.y - sc1.y) * t;

    this._drawCar(ctx, px, py, car, tick);
  }
};

GameRenderer.prototype._drawCar = function(ctx, px, py, car, tick) {
  var d = car.dir;
  // The isometric view is top-down at ~30°. Cars are drawn as 2.5D top-view.
  // Size: roughly 1/4 of a tile
  var L = this.tileW * 0.22;  // car length
  var W2 = L * 0.55;           // car width

  ctx.save();
  ctx.translate(px, py);

  // Each direction gets an isometric angle:
  // In iso space: N goes up-left, E goes up-right, S goes down-right, W goes down-left
  // Angle in screen space for car orientation:
  var isoAngles = [
    -Math.PI * 0.75,  // N: up-left
     Math.PI * 0.25,  // E: up-right  (was -PI*0.25 but iso E goes right+down)
     Math.PI * 0.25,  // S: down-right
    -Math.PI * 0.75,  // W: down-left (same as N but flipped)
  ];
  // Actually let's compute directly from isometric directions
  // gridToScreen(dx,dy) gives the screen delta:
  // N(0,-1): sc= (-hw*0 + -(-1)*...wait, let me just use the actual projection
  // gridToScreen(gx+dx, gy+dy) - gridToScreen(gx,gy):
  // dsx = (dx - dy)*hw*... using iso formula tx=(gx-gy)*hw+originX
  // dsx = (dx-dy)*hw, dsy=(dx+dy)*hh
  var hw2 = this.tileW/2, hh2 = this.tileH/2;
  var dirVecs = [
    { sx: (0-(-1))*hw2, sy: (0+(-1))*hh2 },  // N: dx=0,dy=-1 -> iso dsx=(0-(-1))*hw, dsy=(0+(-1))*hh
    { sx: (1-0)*hw2,    sy: (1+0)*hh2 },       // E: dx=1,dy=0
    { sx: (0-1)*hw2,    sy: (0+1)*hh2 },        // S: dx=0,dy=1
    { sx: (-1-0)*hw2,   sy: (-1+0)*hh2 },       // W: dx=-1,dy=0
  ];
  var dv = dirVecs[d];
  var angle = Math.atan2(dv.sy, dv.sx);

  ctx.rotate(angle);

  // Now draw car: +x = forward direction, y = sideways
  // In this rotated space, car length along x, width along y

  // ── Shadow ──
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  ctx.ellipse(L*0.05, W2*0.25, L*0.54, W2*0.45, 0, 0, Math.PI*2);
  ctx.fill();

  // ── Wheels (4 corners, drawn first so body covers middle) ──
  ctx.fillStyle = '#1a1a1a';
  var wheelW = W2 * 0.28, wheelH = W2 * 0.22;
  var wheelPositions = [
    [-L*0.28, -W2*0.58],  // front-left
    [ L*0.28, -W2*0.58],  // front-right
    [-L*0.28,  W2*0.58],  // rear-left
    [ L*0.28,  W2*0.58],  // rear-right
  ];
  // wheel axle lines
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-L*0.28,-W2*0.58); ctx.lineTo(-L*0.28, W2*0.58); ctx.stroke();
  ctx.beginPath(); ctx.moveTo( L*0.28,-W2*0.58); ctx.lineTo( L*0.28, W2*0.58); ctx.stroke();
  
  for (var wi = 0; wi < 4; wi++) {
    var wx = wheelPositions[wi][0], wy2 = wheelPositions[wi][1];
    // Tyre (black ellipse)
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.ellipse(wx, wy2, wheelW, wheelH, 0, 0, Math.PI*2);
    ctx.fill();
    // Rim (grey circle)
    ctx.fillStyle = '#8a8a8a';
    ctx.beginPath();
    ctx.ellipse(wx, wy2, wheelW*0.55, wheelH*0.55, 0, 0, Math.PI*2);
    ctx.fill();
    // Rim detail
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 0.6;
    for (var sp = 0; sp < 4; sp++) {
      var sa = sp * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(wx, wy2);
      ctx.lineTo(wx + Math.cos(sa)*wheelW*0.45, wy2 + Math.sin(sa)*wheelH*0.45);
      ctx.stroke();
    }
  }

  // ── Car body (main hull) ──
  var bodyGrad = ctx.createLinearGradient(-L*0.5, -W2*0.5, L*0.5, W2*0.5);
  bodyGrad.addColorStop(0,   _lightenColor(car.body, 0.28));
  bodyGrad.addColorStop(0.45, car.body);
  bodyGrad.addColorStop(1,   _darkenColor(car.body, 0.25));
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.roundRect(-L*0.5, -W2*0.5, L, W2, 3);
  ctx.fill();

  // Body outline
  ctx.strokeStyle = _darkenColor(car.body, 0.45);
  ctx.lineWidth = 0.7;
  ctx.stroke();

  // ── Side body panels (highlight) ──
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.roundRect(-L*0.42, -W2*0.42, L*0.84, W2*0.32, 2);
  ctx.fill();

  // ── Cabin / roof area ──
  var cabinGrad = ctx.createLinearGradient(0, -W2*0.5, 0, W2*0.5);
  cabinGrad.addColorStop(0, _lightenColor(car.roof, 0.15));
  cabinGrad.addColorStop(1, car.roof);
  ctx.fillStyle = cabinGrad;
  ctx.beginPath();
  ctx.roundRect(-L*0.22, -W2*0.48, L*0.44, W2*0.96, 2);
  ctx.fill();

  // ── Windshields (front + rear) ──
  // Front windshield
  ctx.fillStyle = 'rgba(160,220,255,0.65)';
  ctx.beginPath();
  ctx.roundRect(L*0.22, -W2*0.38, L*0.14, W2*0.76, 1);
  ctx.fill();
  // Windshield glare
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.roundRect(L*0.25, -W2*0.32, L*0.06, W2*0.28, 1);
  ctx.fill();
  // Rear windshield
  ctx.fillStyle = 'rgba(140,200,240,0.55)';
  ctx.beginPath();
  ctx.roundRect(-L*0.36, -W2*0.36, L*0.14, W2*0.72, 1);
  ctx.fill();

  // ── Headlights (front) ──
  ctx.fillStyle = '#fffcd0';
  ctx.shadowColor = '#ffffaa';
  ctx.shadowBlur = 4;
  ctx.beginPath(); ctx.roundRect(L*0.42, -W2*0.42, L*0.08, W2*0.28, 1); ctx.fill();
  ctx.beginPath(); ctx.roundRect(L*0.42,  W2*0.14, L*0.08, W2*0.28, 1); ctx.fill();
  ctx.shadowBlur = 0;

  // ── Tail lights (rear) ──
  var tailPulse = 0.7 + 0.3 * Math.sin((tick || 0) * 0.18 + car.x);
  ctx.fillStyle = 'rgba(255,' + Math.round(30*tailPulse) + ',' + Math.round(30*tailPulse) + ',' + (0.85*tailPulse) + ')';
  ctx.shadowColor = 'rgba(255,50,50,0.6)';
  ctx.shadowBlur = 3 * tailPulse;
  ctx.beginPath(); ctx.roundRect(-L*0.50, -W2*0.42, L*0.08, W2*0.28, 1); ctx.fill();
  ctx.beginPath(); ctx.roundRect(-L*0.50,  W2*0.14, L*0.08, W2*0.28, 1); ctx.fill();
  ctx.shadowBlur = 0;

  // ── Roof detail (sunroof stripe) ──
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.roundRect(-L*0.16, -W2*0.35, L*0.32, W2*0.70, 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(120,190,240,0.30)';
  ctx.beginPath();
  ctx.roundRect(-L*0.14, -W2*0.32, L*0.28, W2*0.64, 2);
  ctx.fill();

  ctx.restore();
};

// ─── HOUSE LARGE (многоквартирный дом) ───────────────────────
GameRenderer.prototype._sHouseLarge = function(ctx, s, level, tick) {
  var t = tick;
  var floors = Math.min(4 + Math.floor(level / 4), 10);

  // === WIDE CONCRETE PLATFORM ===
  var platGrad = ctx.createLinearGradient(-s*0.48, -s*0.08, s*0.48, 0);
  platGrad.addColorStop(0, '#c8d8e8'); platGrad.addColorStop(1, '#a0b8cc');
  ctx.fillStyle = platGrad;
  ctx.fillRect(-s*0.48, -s*0.1, s*0.96, s*0.1);
  // Curb
  ctx.strokeStyle = '#8aa0b8'; ctx.lineWidth = 1;
  ctx.strokeRect(-s*0.48, -s*0.1, s*0.96, s*0.1);

  // === TWO TOWERS ===
  var towerOffsets = [-s*0.22, s*0.22];
  for (var t2 = 0; t2 < 2; t2++) {
    var tx2 = towerOffsets[t2];
    var tGrad = ctx.createLinearGradient(tx2-s*0.18, -floors*s*0.14, tx2+s*0.18, 0);
    tGrad.addColorStop(0, '#dce8f5'); tGrad.addColorStop(0.5, '#c0d0e0'); tGrad.addColorStop(1, '#98b0c8');
    ctx.fillStyle = tGrad;
    ctx.fillRect(tx2-s*0.18, -floors*s*0.14, s*0.36, floors*s*0.14);

    // Floor lines
    for (var f = 1; f <= floors; f++) {
      ctx.strokeStyle = 'rgba(80,110,140,0.35)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(tx2-s*0.18, -f*s*0.14); ctx.lineTo(tx2+s*0.18, -f*s*0.14); ctx.stroke();
    }

    // Windows grid
    for (var wf = 0; wf < floors; wf++) {
      for (var wc = -1; wc <= 1; wc++) {
        var isLit = (t % 300 + wf*37 + wc*17 + t2*50) % 300 > 150;
        ctx.fillStyle = isLit ? '#fff8c0' : '#b8d8f0';
        var wx3 = tx2 + wc*s*0.1;
        var wy3 = -(wf+0.75)*s*0.14;
        ctx.fillRect(wx3-s*0.035, wy3-s*0.05, s*0.07, s*0.09);
        // Window frame
        ctx.strokeStyle = 'rgba(80,110,140,0.5)'; ctx.lineWidth = 0.5;
        ctx.strokeRect(wx3-s*0.035, wy3-s*0.05, s*0.07, s*0.09);
        // Glint
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(wx3-s*0.032, wy3-s*0.048, s*0.02, s*0.04);
      }
    }

    // Balconies (every other floor)
    for (var bf = 0; bf < floors-1; bf+=2) {
      for (var bc = -1; bc <= 1; bc++) {
        var bfx = tx2 + bc*s*0.1;
        var bfy = -(bf+1)*s*0.14;
        ctx.fillStyle = '#b8cce0';
        ctx.fillRect(bfx-s*0.055, bfy, s*0.11, s*0.025);
        ctx.strokeStyle = '#8aaccf'; ctx.lineWidth = 0.5;
        ctx.strokeRect(bfx-s*0.055, bfy, s*0.11, s*0.025);
        // Balcony railing posts
        for (var rp = 0; rp <= 2; rp++) {
          ctx.strokeStyle = '#7a9cbf'; ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(bfx-s*0.045+rp*s*0.045, bfy);
          ctx.lineTo(bfx-s*0.045+rp*s*0.045, bfy-s*0.04);
          ctx.stroke();
        }
      }
    }

    // Tower top / roof
    var rtGrad = ctx.createLinearGradient(tx2-s*0.2, -floors*s*0.14-s*0.12, tx2+s*0.2, -floors*s*0.14);
    rtGrad.addColorStop(0, '#7090a8'); rtGrad.addColorStop(1, '#506880');
    ctx.fillStyle = rtGrad;
    ctx.beginPath();
    ctx.moveTo(tx2-s*0.2, -floors*s*0.14);
    ctx.lineTo(tx2, -floors*s*0.14-s*0.12);
    ctx.lineTo(tx2+s*0.2, -floors*s*0.14);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#405870'; ctx.lineWidth = 1; ctx.stroke();

    // Antenna on each tower
    ctx.strokeStyle = '#8090a0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tx2, -floors*s*0.14-s*0.12); ctx.lineTo(tx2, -floors*s*0.14-s*0.22); ctx.stroke();
    // Blinking light
    var blink = (t % 80 < 40) ? 'rgba(255,80,80,0.9)' : 'rgba(255,80,80,0.2)';
    ctx.fillStyle = blink;
    ctx.beginPath(); ctx.arc(tx2, -floors*s*0.14-s*0.22, s*0.014, 0, Math.PI*2); ctx.fill();
  }

  // === CENTRAL LOBBY ===
  var lobbyGrad = ctx.createLinearGradient(-s*0.12, -s*0.4, s*0.12, 0);
  lobbyGrad.addColorStop(0, '#e8f0f8'); lobbyGrad.addColorStop(1, '#b8cce0');
  ctx.fillStyle = lobbyGrad;
  ctx.fillRect(-s*0.12, -s*0.38, s*0.24, s*0.28);

  // Glass lobby wall
  var glGrad = ctx.createLinearGradient(-s*0.1, -s*0.36, s*0.1, -s*0.12);
  glGrad.addColorStop(0, 'rgba(150,210,255,0.85)');
  glGrad.addColorStop(0.5, 'rgba(180,225,255,0.7)');
  glGrad.addColorStop(1, 'rgba(120,190,240,0.6)');
  ctx.fillStyle = glGrad;
  ctx.fillRect(-s*0.1, -s*0.36, s*0.2, s*0.26);

  // Lobby reflections
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillRect(-s*0.08, -s*0.34, s*0.035, s*0.22);

  // Main door
  ctx.fillStyle = '#5c7a94';
  ctx.beginPath(); ctx.roundRect(-s*0.055, -s*0.18, s*0.11, s*0.18, s*0.01); ctx.fill();
  ctx.fillStyle = 'rgba(150,210,255,0.7)';
  ctx.fillRect(-s*0.045, -s*0.16, s*0.09, s*0.14);
  // Door handle
  ctx.strokeStyle = '#d4a040'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-s*0.01, -s*0.09); ctx.lineTo(s*0.01, -s*0.09); ctx.stroke();

  // Awning
  ctx.fillStyle = '#1565c0';
  ctx.beginPath();
  ctx.moveTo(-s*0.14, -s*0.2);
  ctx.lineTo(s*0.14, -s*0.2);
  ctx.lineTo(s*0.1, -s*0.16);
  ctx.lineTo(-s*0.1, -s*0.16);
  ctx.closePath(); ctx.fill();
  // Awning stripes
  for (var as = -3; as <= 3; as++) {
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(as*s*0.03, -s*0.2);
    ctx.lineTo(as*s*0.025, -s*0.16);
    ctx.stroke();
  }

  // Building name sign
  ctx.fillStyle = 'rgba(10,30,60,0.9)';
  ctx.beginPath(); ctx.roundRect(-s*0.14, -s*0.42, s*0.28, s*0.07, s*0.01); ctx.fill();
  ctx.fillStyle = '#e0f0ff';
  ctx.font = 'bold ' + Math.round(s*0.055) + 'px Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('ЖИЛОЙ КОМПЛЕКС', 0, -s*0.385);

  // Parked cars
  for (var pc = -1; pc <= 1; pc += 2) {
    ctx.save();
    ctx.translate(pc*s*0.32, -s*0.04);
    var carCol = pc < 0 ? '#c0392b' : '#2980b9';
    ctx.fillStyle = carCol;
    ctx.fillRect(-s*0.1, -s*0.065, s*0.2, s*0.065);
    ctx.fillStyle = pc < 0 ? '#a93226' : '#1a6f9a';
    ctx.fillRect(-s*0.075, -s*0.11, s*0.15, s*0.045);
    ctx.fillStyle = 'rgba(150,210,255,0.8)';
    ctx.fillRect(-s*0.06, -s*0.105, s*0.12, s*0.038);
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(-s*0.06, 0, s*0.022, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(s*0.06, 0, s*0.022, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // Trees around building
  var trees2 = [{x:-s*0.43, col:'#1b5e20'}, {x:s*0.43, col:'#1b5e20'}, {x:-s*0.43, col:'#2e7d32'}, {x:s*0.43, col:'#2e7d32'}];
  var ty_off = [-s*0.08, -s*0.08, s*0.01, s*0.01];
  for (var tr = 0; tr < trees2.length; tr++) {
    var twave = Math.sin(t*0.03+tr)*s*0.008;
    ctx.fillStyle = trees2[tr].col;
    ctx.beginPath(); ctx.arc(trees2[tr].x+twave, ty_off[tr]-s*0.12, s*0.07, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(trees2[tr].x-s*0.01, ty_off[tr]-s*0.04, s*0.02, s*0.04);
  }
};

// ─── TOWNHALL - Grand Government Building ────────────────────
GameRenderer.prototype._sTownhall = function(ctx, s, level, tick) {
  var t = tick;

  // === GRAND STAIRCASE ===
  for (var st = 0; st < 4; st++) {
    var stW = s*(1.0 - st*0.07);
    var stGrad = ctx.createLinearGradient(-stW, -(st*s*0.04), stW, -(st+1)*s*0.04);
    stGrad.addColorStop(0, ['#ede8e0','#ddd8d0','#ccc8c0','#bbb8b0'][st]);
    stGrad.addColorStop(1, ['#d8d3cb','#c8c3bb','#b8b3ab','#a8a3a0'][st]);
    ctx.fillStyle = stGrad;
    ctx.fillRect(-stW, -(st+1)*s*0.04, stW*2, s*0.04);
    ctx.strokeStyle = 'rgba(100,90,80,0.3)'; ctx.lineWidth = 0.5;
    ctx.strokeRect(-stW, -(st+1)*s*0.04, stW*2, s*0.04);
  }

  // === MAIN BODY — colonnaded facade ===
  var bodyGrad = ctx.createLinearGradient(-s*0.55, -s*0.95, s*0.55, -s*0.16);
  bodyGrad.addColorStop(0, '#f5f2ec'); bodyGrad.addColorStop(0.5, '#e8e3d8'); bodyGrad.addColorStop(1, '#d0c8b8');
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(-s*0.55, -s*0.88, s*1.1, s*0.72);

  // === 6 COLUMNS ===
  var colPositions = [-s*0.42, -s*0.25, -s*0.08, s*0.08, s*0.25, s*0.42];
  for (var cp = 0; cp < colPositions.length; cp++) {
    // Column base (plinth)
    ctx.fillStyle = '#c8c0b0';
    ctx.fillRect(colPositions[cp]-s*0.045, -s*0.2, s*0.09, s*0.04);
    // Column shaft
    var colGrad = ctx.createLinearGradient(colPositions[cp]-s*0.045, 0, colPositions[cp]+s*0.045, 0);
    colGrad.addColorStop(0, '#f8f4f0'); colGrad.addColorStop(0.3, '#ede8e0'); colGrad.addColorStop(0.7, '#e0dcd0'); colGrad.addColorStop(1, '#c8c4b8');
    ctx.fillStyle = colGrad;
    ctx.fillRect(colPositions[cp]-s*0.04, -s*0.82, s*0.08, s*0.62);
    // Fluting (vertical grooves)
    for (var fl = 0; fl < 5; fl++) {
      ctx.strokeStyle = 'rgba(150,140,120,0.25)'; ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(colPositions[cp]-s*0.028+fl*s*0.014, -s*0.82);
      ctx.lineTo(colPositions[cp]-s*0.028+fl*s*0.014, -s*0.2);
      ctx.stroke();
    }
    // Capital (Corinthian-style)
    ctx.fillStyle = '#d8d0c0';
    ctx.fillRect(colPositions[cp]-s*0.055, -s*0.84, s*0.11, s*0.04);
    ctx.beginPath();
    ctx.ellipse(colPositions[cp], -s*0.86, s*0.055, s*0.02, 0, 0, Math.PI*2);
    ctx.fill();
  }

  // === ARCHED WINDOWS (3 pairs) ===
  var winPos = [-s*0.34, -s*0.01, s*0.32];
  for (var wi = 0; wi < winPos.length; wi++) {
    // Frame
    ctx.fillStyle = '#a09080';
    ctx.beginPath(); ctx.roundRect(winPos[wi]-s*0.1, -s*0.76, s*0.2, s*0.35, s*0.1); ctx.fill();
    // Glass
    ctx.fillStyle = '#1a3a6a';
    ctx.beginPath(); ctx.roundRect(winPos[wi]-s*0.085, -s*0.74, s*0.17, s*0.32, s*0.085); ctx.fill();
    // Window dividers (cross)
    ctx.strokeStyle = '#a09080'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(winPos[wi], -s*0.74); ctx.lineTo(winPos[wi], -s*0.42); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(winPos[wi]-s*0.085, -s*0.58); ctx.lineTo(winPos[wi]+s*0.085, -s*0.58); ctx.stroke();
    // Light interior
    var wlit = (t%200+wi*70)%200 > 100;
    ctx.fillStyle = wlit ? 'rgba(255,230,120,0.35)' : 'rgba(100,160,220,0.2)';
    ctx.beginPath(); ctx.roundRect(winPos[wi]-s*0.07, -s*0.72, s*0.14, s*0.14, s*0.02); ctx.fill();
  }

  // === GRAND ENTRANCE PORTAL ===
  // Outer frame
  ctx.fillStyle = '#a09080';
  ctx.beginPath(); ctx.roundRect(-s*0.15, -s*0.44, s*0.3, s*0.44, s*0.015); ctx.fill();
  // Inner door
  ctx.fillStyle = '#2c1a08';
  ctx.beginPath(); ctx.roundRect(-s*0.12, -s*0.42, s*0.24, s*0.42, s*0.12); ctx.fill();
  // Door panels (ornate)
  for (var dp = 0; dp < 2; dp++) {
    var dpx = dp === 0 ? -s*0.1 : s*0.01;
    ctx.fillStyle = '#3d2510';
    ctx.fillRect(dpx, -s*0.4, s*0.1, s*0.18);
    ctx.fillRect(dpx, -s*0.2, s*0.1, s*0.18);
    // Panel inset
    ctx.strokeStyle = '#6b3f1a'; ctx.lineWidth = 0.8;
    ctx.strokeRect(dpx+s*0.01, -s*0.39, s*0.08, s*0.16);
    ctx.strokeRect(dpx+s*0.01, -s*0.19, s*0.08, s*0.16);
  }
  // Fanlight above door
  ctx.fillStyle = '#1a3a6a';
  ctx.beginPath(); ctx.arc(0, -s*0.42, s*0.1, Math.PI, 0); ctx.closePath(); ctx.fill();
  // Fanlight spokes
  ctx.strokeStyle = '#a09080'; ctx.lineWidth = 1;
  for (var fsp = 0; fsp < 5; fsp++) {
    var fspA = Math.PI + fsp * Math.PI/4;
    ctx.beginPath(); ctx.moveTo(0, -s*0.42);
    ctx.lineTo(Math.cos(fspA)*s*0.1, -s*0.42+Math.sin(fspA)*s*0.1);
    ctx.stroke();
  }
  // Door knockers
  ctx.fillStyle = '#d4a020';
  ctx.beginPath(); ctx.arc(-s*0.04, -s*0.28, s*0.012, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(s*0.04, -s*0.28, s*0.012, 0, Math.PI*2); ctx.fill();

  // === FRIEZE with inscription ===
  ctx.fillStyle = '#c8c0b0';
  ctx.fillRect(-s*0.58, -s*0.9, s*1.16, s*0.07);
  ctx.strokeStyle = '#b0a898'; ctx.lineWidth = 1;
  ctx.strokeRect(-s*0.58, -s*0.9, s*1.16, s*0.07);
  // Triglyph pattern
  for (var tri = -5; tri <= 5; tri++) {
    ctx.fillStyle = '#b0a890';
    ctx.fillRect(tri*s*0.1-s*0.02, -s*0.89, s*0.04, s*0.05);
  }

  // === TRIANGULAR PEDIMENT ===
  var pedGrad = ctx.createLinearGradient(0, -s*1.18, 0, -s*0.9);
  pedGrad.addColorStop(0, '#f8f4ec'); pedGrad.addColorStop(1, '#d8d0c0');
  ctx.fillStyle = pedGrad;
  ctx.beginPath();
  ctx.moveTo(-s*0.6, -s*0.9);
  ctx.lineTo(0, -s*1.2);
  ctx.lineTo(s*0.6, -s*0.9);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#c0b8a8'; ctx.lineWidth = 2; ctx.stroke();
  // Pediment relief — relief figure suggestion
  ctx.strokeStyle = 'rgba(160,150,130,0.4)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-s*0.2, -s*0.92); ctx.lineTo(-s*0.35, -s*1.0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.2, -s*0.92); ctx.lineTo(s*0.35, -s*1.0); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -s*1.0, s*0.07, 0, Math.PI*2); ctx.stroke();

  // === CENTRAL DOME ===
  // Drum
  var drumGrad = ctx.createLinearGradient(-s*0.22, -s*1.38, s*0.22, -s*1.18);
  drumGrad.addColorStop(0, '#e8e0d0'); drumGrad.addColorStop(1, '#c0b8a8');
  ctx.fillStyle = drumGrad;
  ctx.fillRect(-s*0.22, -s*1.38, s*0.44, s*0.2);
  // Drum windows
  for (var dw = -2; dw <= 2; dw++) {
    ctx.fillStyle = '#1a3a6a';
    ctx.beginPath(); ctx.arc(dw*s*0.09, -s*1.3, s*0.03, Math.PI, 0); ctx.closePath(); ctx.fill();
  }
  // Dome itself
  var domGrad = ctx.createRadialGradient(-s*0.05, -s*1.55, 0, 0, -s*1.5, s*0.3);
  domGrad.addColorStop(0, '#c8dce8'); domGrad.addColorStop(0.5, '#6696c8'); domGrad.addColorStop(1, '#1e5fa8');
  ctx.fillStyle = domGrad;
  ctx.beginPath(); ctx.arc(0, -s*1.38, s*0.3, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#1e4a88'; ctx.lineWidth = 1.5; ctx.stroke();
  // Dome ribs
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
  for (var rib = 0; rib < 8; rib++) {
    var ribA = Math.PI + rib * Math.PI/7;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ribA)*s*0.3, -s*1.38+Math.sin(ribA)*s*0.3);
    ctx.quadraticCurveTo(Math.cos(ribA)*s*0.15, -s*1.38+Math.sin(ribA)*s*0.15, 0, -s*1.68);
    ctx.stroke();
  }

  // === LANTERN + FINIAL ===
  ctx.fillStyle = '#d8d0c0';
  ctx.beginPath(); ctx.arc(0, -s*1.68, s*0.08, 0, Math.PI*2); ctx.fill();
  // Golden ball
  var gBallGrad = ctx.createRadialGradient(-s*0.02, -s*1.76, 0, 0, -s*1.76, s*0.045);
  gBallGrad.addColorStop(0, '#fff0a0'); gBallGrad.addColorStop(0.5, '#f0a000'); gBallGrad.addColorStop(1, '#c07000');
  ctx.fillStyle = gBallGrad;
  ctx.beginPath(); ctx.arc(0, -s*1.76, s*0.045, 0, Math.PI*2); ctx.fill();

  // === CLOCK FACE ===
  ctx.fillStyle = '#f8f0d0';
  ctx.beginPath(); ctx.arc(0, -s*1.28, s*0.12, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#8a7040'; ctx.lineWidth = 2; ctx.stroke();
  // Roman numeral marks
  ctx.strokeStyle = '#5a4030'; ctx.lineWidth = 1.5;
  for (var ch = 0; ch < 12; ch++) {
    var chA = ch * Math.PI/6;
    var ri = ch % 3 === 0 ? s*0.09 : s*0.1;
    ctx.beginPath();
    ctx.moveTo(Math.cos(chA-Math.PI/2)*ri, -s*1.28+Math.sin(chA-Math.PI/2)*ri);
    ctx.lineTo(Math.cos(chA-Math.PI/2)*s*0.11, -s*1.28+Math.sin(chA-Math.PI/2)*s*0.11);
    ctx.stroke();
  }
  // Hands
  var hr = (Math.floor(t/60) % 12) / 12 * Math.PI*2 - Math.PI/2;
  var mn = (t % 60) / 60 * Math.PI*2 - Math.PI/2;
  ctx.strokeStyle = '#2d1b0e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0,-s*1.28); ctx.lineTo(Math.cos(hr)*s*0.07, -s*1.28+Math.sin(hr)*s*0.07); ctx.stroke();
  ctx.strokeStyle = '#4a3020'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0,-s*1.28); ctx.lineTo(Math.cos(mn)*s*0.1, -s*1.28+Math.sin(mn)*s*0.1); ctx.stroke();
  // Center dot
  ctx.fillStyle = '#8a6030';
  ctx.beginPath(); ctx.arc(0, -s*1.28, s*0.012, 0, Math.PI*2); ctx.fill();

  // === FLAGS ===
  var flagWave = Math.sin(t * 0.05) * 0.06;
  for (var fg = -1; fg <= 1; fg += 2) {
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(fg*s*0.52, -s*0.88); ctx.lineTo(fg*s*0.52, -s*1.08); ctx.stroke();
    ctx.fillStyle = '#dc2626';
    ctx.save(); ctx.translate(fg*s*0.52, -s*1.08);
    ctx.beginPath();
    ctx.moveTo(0,0); ctx.lineTo(fg*s*0.12, s*0.03+flagWave); ctx.lineTo(fg*s*0.11, s*0.06); ctx.lineTo(0, s*0.07);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  // Exp sparkles at high level
  if (level >= 5) {
    for (var sk2 = 0; sk2 < 5; sk2++) {
      var skP = (t*0.03+sk2*1.26)%(Math.PI*2);
      var skA = 0.4+0.6*Math.sin(t*0.07+sk2);
      ctx.fillStyle = 'rgba(251,191,36,'+skA+')';
      ctx.font = Math.round(s*0.07)+'px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('✨', Math.cos(skP)*s*0.55, -s*0.6+Math.sin(skP)*s*0.25);
    }
  }
};

// ─── CHURCH — Gothic Cathedral ──────────────────────────────
GameRenderer.prototype._sChurch = function(ctx, s, level, tick) {
  var t = tick;

  // === STONE BASE PLATFORM ===
  for (var sp = 0; sp < 3; sp++) {
    ctx.fillStyle = ['#d0c8b8','#c0b8a8','#b0a898'][sp];
    ctx.fillRect(-s*(0.48-sp*0.04), -(sp+1)*s*0.04, s*(0.96-sp*0.08), s*0.04);
  }

  // === NAVE (main body) ===
  var naveGrad = ctx.createLinearGradient(-s*0.38, -s*0.7, s*0.38, -s*0.08);
  naveGrad.addColorStop(0, '#f0ece4'); naveGrad.addColorStop(0.6, '#e0dcd0'); naveGrad.addColorStop(1, '#c8c0b0');
  ctx.fillStyle = naveGrad;
  ctx.fillRect(-s*0.38, -s*0.65, s*0.76, s*0.53);

  // === SIDE AISLES ===
  for (var ai = -1; ai <= 1; ai += 2) {
    var aGrad = ctx.createLinearGradient(ai*s*0.4, -s*0.5, ai*s*0.52, 0);
    aGrad.addColorStop(0, '#ece8e0'); aGrad.addColorStop(1, '#c8c0b0');
    ctx.fillStyle = aGrad;
    ctx.fillRect(ai*s*0.38, -s*0.5, s*0.16, s*0.38);
    // Aisle roof
    ctx.fillStyle = '#8a9a88';
    ctx.beginPath();
    ctx.moveTo(ai*s*0.38, -s*0.5);
    ctx.lineTo(ai*s*0.46, -s*0.62);
    ctx.lineTo(ai*s*0.54, -s*0.5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#6a7a68'; ctx.lineWidth = 1; ctx.stroke();
  }

  // === GOTHIC WINDOWS (5 lancet) ===
  var gwPos = [-s*0.28, -s*0.14, 0, s*0.14, s*0.28];
  for (var gw = 0; gw < gwPos.length; gw++) {
    // Stone frame
    ctx.fillStyle = '#b0a898';
    ctx.beginPath(); ctx.roundRect(gwPos[gw]-s*0.06, -s*0.58, s*0.12, s*0.3, s*0.06); ctx.fill();
    // Stained glass
    var gwColors = [['#dc143c','#1e90ff'], ['#ff8c00','#228b22'], ['#9400d3','#ffd700'],
                    ['#ff8c00','#228b22'], ['#dc143c','#1e90ff']];
    ctx.fillStyle = gwColors[gw][0];
    ctx.beginPath(); ctx.roundRect(gwPos[gw]-s*0.045, -s*0.565, s*0.09, s*0.13, s*0.045); ctx.fill();
    ctx.fillStyle = gwColors[gw][1];
    ctx.fillRect(gwPos[gw]-s*0.045, -s*0.435, s*0.09, s*0.12);
    // Lead lines
    ctx.strokeStyle = 'rgba(50,40,30,0.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(gwPos[gw], -s*0.565); ctx.lineTo(gwPos[gw], -s*0.315); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gwPos[gw]-s*0.045, -s*0.435); ctx.lineTo(gwPos[gw]+s*0.045, -s*0.435); ctx.stroke();
    // Glow
    var gwGlow = ctx.createRadialGradient(gwPos[gw], -s*0.44, 0, gwPos[gw], -s*0.44, s*0.07);
    gwGlow.addColorStop(0, 'rgba(255,200,50,'+(0.15+0.1*Math.sin(t*0.04+gw))+')');
    gwGlow.addColorStop(1, 'rgba(255,200,50,0)');
    ctx.fillStyle = gwGlow; ctx.beginPath(); ctx.arc(gwPos[gw],-s*0.44,s*0.07,0,Math.PI*2); ctx.fill();
  }

  // === NAVE ROOF (Gothic pitch) ===
  ctx.fillStyle = '#6b7c6a';
  ctx.beginPath();
  ctx.moveTo(-s*0.42, -s*0.65);
  ctx.lineTo(0, -s*0.95);
  ctx.lineTo(s*0.42, -s*0.65);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#4a5c4a'; ctx.lineWidth = 1.5; ctx.stroke();
  // Roof tiles suggestion
  for (var rt = 0; rt < 6; rt++) {
    ctx.strokeStyle = 'rgba(50,65,50,0.3)'; ctx.lineWidth = 0.8;
    var rleft = -s*0.42 + rt*s*0.14;
    var rright = rleft + s*0.14;
    var rtop = -s*0.65 + (0.3 - rt*0.05)*s*0.3;
    ctx.beginPath(); ctx.moveTo(rleft, -s*0.65); ctx.lineTo(0,-s*0.95); ctx.stroke();
  }

  // === ROSE WINDOW on facade ===
  ctx.fillStyle = '#a09080';
  ctx.beginPath(); ctx.arc(0, -s*0.72, s*0.1, 0, Math.PI*2); ctx.fill();
  // Petals
  var roseColors = ['#dc143c','#ff8c00','#ffd700','#228b22','#1e90ff','#9400d3','#ff1493','#00ced1'];
  for (var rp2 = 0; rp2 < 8; rp2++) {
    var rpA = rp2 * Math.PI/4;
    ctx.fillStyle = roseColors[rp2];
    ctx.beginPath();
    ctx.moveTo(Math.cos(rpA)*s*0.035, -s*0.72+Math.sin(rpA)*s*0.035);
    ctx.arc(Math.cos(rpA)*s*0.065, -s*0.72+Math.sin(rpA)*s*0.065, s*0.035, rpA+Math.PI, rpA);
    ctx.closePath(); ctx.fill();
  }
  // Center
  ctx.fillStyle = '#ffd700';
  ctx.beginPath(); ctx.arc(0, -s*0.72, s*0.018, 0, Math.PI*2); ctx.fill();
  // Glow
  var rosGlow = ctx.createRadialGradient(0,-s*0.72,0,0,-s*0.72,s*0.12);
  rosGlow.addColorStop(0,'rgba(255,220,50,'+(0.2+0.15*Math.sin(t*0.05))+')');
  rosGlow.addColorStop(1,'rgba(255,220,50,0)');
  ctx.fillStyle=rosGlow; ctx.beginPath(); ctx.arc(0,-s*0.72,s*0.12,0,Math.PI*2); ctx.fill();

  // === MAIN PORTAL (Gothic arch) ===
  ctx.fillStyle = '#8a8070';
  ctx.beginPath();
  ctx.moveTo(-s*0.16, -s*0.12);
  ctx.lineTo(-s*0.16, -s*0.5);
  ctx.quadraticCurveTo(-s*0.16, -s*0.65, 0, -s*0.65);
  ctx.quadraticCurveTo(s*0.16, -s*0.65, s*0.16, -s*0.5);
  ctx.lineTo(s*0.16, -s*0.12);
  ctx.closePath(); ctx.fill();
  // Inner door
  ctx.fillStyle = '#2c1a08';
  ctx.beginPath();
  ctx.moveTo(-s*0.12, -s*0.12);
  ctx.lineTo(-s*0.12, -s*0.48);
  ctx.quadraticCurveTo(-s*0.12, -s*0.6, 0, -s*0.6);
  ctx.quadraticCurveTo(s*0.12, -s*0.6, s*0.12, -s*0.48);
  ctx.lineTo(s*0.12, -s*0.12);
  ctx.closePath(); ctx.fill();
  // Tympanum
  ctx.fillStyle = '#6b7c6a';
  ctx.beginPath();
  ctx.moveTo(-s*0.12, -s*0.5);
  ctx.quadraticCurveTo(0, -s*0.62, s*0.12, -s*0.5);
  ctx.lineTo(s*0.12, -s*0.48);
  ctx.quadraticCurveTo(0, -s*0.6, -s*0.12, -s*0.48);
  ctx.closePath(); ctx.fill();

  // === TWIN BELL TOWERS (Gothic spires) ===
  for (var bt2 = -1; bt2 <= 1; bt2 += 2) {
    var btx = bt2 * s*0.38;
    // Tower body
    var btGrad = ctx.createLinearGradient(btx-s*0.1, -s*1.4, btx+s*0.1, -s*0.65);
    btGrad.addColorStop(0, '#e8e0d0'); btGrad.addColorStop(1, '#c8c0b0');
    ctx.fillStyle = btGrad;
    ctx.fillRect(btx-s*0.1, -s*1.35, s*0.2, s*0.7);

    // Tower belfry openings (2 per side, 2 per tower)
    for (var bto = 0; bto < 2; bto++) {
      var btoy = -s*(0.9+bto*0.22);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath(); ctx.roundRect(btx-s*0.065, btoy, s*0.13, s*0.18, s*0.065); ctx.fill();
      // Bell visible
      if (bto === 0) {
        var bSwing = Math.sin(t*0.025+bt2*1.5)*0.2;
        ctx.save(); ctx.translate(btx, btoy+s*0.06); ctx.rotate(bSwing);
        ctx.fillStyle = '#d4a017';
        ctx.beginPath(); ctx.arc(0,0,s*0.04,0,Math.PI); ctx.closePath(); ctx.fill();
        ctx.strokeStyle='#a07010'; ctx.lineWidth=1; ctx.stroke();
        ctx.restore();
      }
    }

    // Corner buttresses
    for (var cbs = -1; cbs <= 1; cbs += 2) {
      ctx.fillStyle = '#b8b0a0';
      ctx.fillRect(btx+cbs*s*0.1, -s*1.3, s*0.04*Math.abs(cbs), s*0.65);
    }

    // Spire (tall Gothic)
    ctx.fillStyle = '#606e60';
    ctx.beginPath();
    ctx.moveTo(btx-s*0.1, -s*1.35);
    ctx.lineTo(btx, -s*1.82);
    ctx.lineTo(btx+s*0.1, -s*1.35);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#485848'; ctx.lineWidth = 1; ctx.stroke();
    // Spire crockets (Gothic ornaments)
    for (var crc = 1; crc < 4; crc++) {
      var crcY = -s*1.35 - crc*s*0.12;
      var crcW = s*0.1*(1-crc*0.22);
      ctx.fillStyle = '#6a7a68';
      ctx.beginPath(); ctx.arc(btx-crcW, crcY, s*0.018, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(btx+crcW, crcY, s*0.018, 0, Math.PI*2); ctx.fill();
    }
    // Cross finial
    ctx.strokeStyle = '#d4a017'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(btx, -s*1.82); ctx.lineTo(btx, -s*2.0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(btx-s*0.06, -s*1.94); ctx.lineTo(btx+s*0.06, -s*1.94); ctx.stroke();

    // Halo around cross
    var halo = 0.25+0.2*Math.sin(t*0.04+bt2);
    var haloG = ctx.createRadialGradient(btx,-s*1.96,0,btx,-s*1.96,s*0.12);
    haloG.addColorStop(0,'rgba(255,220,100,'+halo+')');
    haloG.addColorStop(1,'rgba(255,220,100,0)');
    ctx.fillStyle=haloG; ctx.beginPath(); ctx.arc(btx,-s*1.96,s*0.12,0,Math.PI*2); ctx.fill();
  }

  // === FLYING BUTTRESSES ===
  ctx.strokeStyle = '#b0a898'; ctx.lineWidth = 3;
  for (var fb = -1; fb <= 1; fb += 2) {
    ctx.beginPath();
    ctx.moveTo(fb*s*0.38, -s*1.0);
    ctx.quadraticCurveTo(fb*s*0.28, -s*0.8, fb*s*0.22, -s*0.65);
    ctx.stroke();
    // Buttress arch
    ctx.strokeStyle = '#a09888'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fb*s*0.38, -s*0.85);
    ctx.quadraticCurveTo(fb*s*0.3, -s*0.75, fb*s*0.22, -s*0.65);
    ctx.stroke();
  }

  // Coin floating
  if (level >= 3) {
    var cFloat = Math.sin(t*0.05)*s*0.04;
    ctx.font=Math.round(s*0.1)+'px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('🪙', 0, -s*1.1+cFloat);
  }
};

// ─── FIRESTATION — Full Emergency Complex ───────────────────
GameRenderer.prototype._sFirestation = function(ctx, s, level, tick) {
  var t = tick;

  // === CONCRETE APRON ===
  ctx.fillStyle = '#b8b4b0';
  ctx.fillRect(-s*0.55, -s*0.08, s*1.1, s*0.08);
  // Road markings
  ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 1; ctx.setLineDash([s*0.04, s*0.04]);
  ctx.beginPath(); ctx.moveTo(-s*0.55, -s*0.04); ctx.lineTo(s*0.55, -s*0.04); ctx.stroke();
  ctx.setLineDash([]);

  // === MAIN BUILDING ===
  var fsGrad = ctx.createLinearGradient(-s*0.5, -s*0.9, s*0.5, -s*0.08);
  fsGrad.addColorStop(0, '#e84040'); fsGrad.addColorStop(0.5, '#cc2828'); fsGrad.addColorStop(1, '#8a1818');
  ctx.fillStyle = fsGrad;
  ctx.fillRect(-s*0.5, -s*0.85, s, s*0.77);

  // White horizontal stripe / band
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(-s*0.5, -s*0.55, s, s*0.06);
  // Red border strips
  ctx.fillStyle = '#aa1010';
  ctx.fillRect(-s*0.5, -s*0.61, s, s*0.02);
  ctx.fillRect(-s*0.5, -s*0.51, s, s*0.02);

  // === THREE GARAGE BAYS ===
  var bayX = [-s*0.35, 0, s*0.35];
  for (var bay = 0; bay < 3; bay++) {
    var bx = bayX[bay];
    // Bay opening frame
    ctx.fillStyle = '#701010';
    ctx.fillRect(bx-s*0.14, -s*0.49, s*0.28, s*0.41);
    // Roller door
    var numStripes = 6;
    for (var ds = 0; ds < numStripes; ds++) {
      ctx.fillStyle = ds%2===0 ? '#cc2020' : '#aa1818';
      ctx.fillRect(bx-s*0.13, -s*0.48+ds*s*0.068, s*0.26, s*0.065);
    }
    // Door window strip
    ctx.fillStyle = 'rgba(150,210,255,0.7)';
    ctx.fillRect(bx-s*0.11, -s*0.48+s*0.04, s*0.22, s*0.03);

    // Fire truck in bay
    ctx.save(); ctx.translate(bx, -s*0.18);
    // Truck cab
    var truckGrad = ctx.createLinearGradient(-s*0.1, -s*0.2, s*0.1, 0);
    truckGrad.addColorStop(0,'#ff4444'); truckGrad.addColorStop(1,'#cc2020');
    ctx.fillStyle = truckGrad;
    ctx.fillRect(-s*0.1, -s*0.18, s*0.2, s*0.18);
    ctx.fillRect(-s*0.09, -s*0.28, s*0.14, s*0.1);
    // Windshield
    ctx.fillStyle = 'rgba(150,210,255,0.85)';
    ctx.fillRect(-s*0.07, -s*0.265, s*0.11, s*0.07);
    // Stripes
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(-s*0.1, -s*0.08, s*0.2, s*0.025);
    // Ladder on top
    ctx.strokeStyle = '#c0c0c0'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-s*0.09,-s*0.18); ctx.lineTo(s*0.09,-s*0.18); ctx.stroke();
    for (var rung = -3; rung <= 3; rung++) {
      ctx.beginPath(); ctx.moveTo(rung*s*0.025, -s*0.18); ctx.lineTo(rung*s*0.025, -s*0.22); ctx.stroke();
    }
    ctx.strokeStyle = '#c0c0c0'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-s*0.09,-s*0.22); ctx.lineTo(s*0.09,-s*0.22); ctx.stroke();
    // Wheels
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(-s*0.068, 0, s*0.03, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(s*0.068, 0, s*0.03, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#555';
    ctx.beginPath(); ctx.arc(-s*0.068, 0, s*0.016, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(s*0.068, 0, s*0.016, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // === OFFICE WING (upper floors) ===
  // Upper windows
  for (var uw = -4; uw <= 4; uw++) {
    if (Math.abs(uw) < 1.5) continue; // skip garage area
    var uwLit = (t % 150 + uw*31) % 150 > 80;
    ctx.fillStyle = uwLit ? '#fff8c0' : '#a8d0e8';
    ctx.fillRect(uw*s*0.1-s*0.035, -s*0.82, s*0.07, s*0.1);
    ctx.strokeStyle = 'rgba(80,80,80,0.4)'; ctx.lineWidth = 0.5;
    ctx.strokeRect(uw*s*0.1-s*0.035, -s*0.82, s*0.07, s*0.1);
  }

  // === DISPATCH TOWER ===
  ctx.fillStyle = '#b81818';
  ctx.fillRect(-s*0.06, -s*1.15, s*0.12, s*0.3);
  // Tower windows
  for (var tw2 = -1; tw2 <= 1; tw2++) {
    ctx.fillStyle = '#a8d8f0';
    ctx.fillRect(tw2*s*0.03-s*0.02, -s*1.1, s*0.04, s*0.07);
  }
  // Tower roof
  ctx.fillStyle = '#901414';
  ctx.fillRect(-s*0.08, -s*1.18, s*0.16, s*0.04);

  // === SIREN (animated, top of tower) ===
  var sirenPhase = (t % 40 < 20);
  var s1Col = sirenPhase ? '#ff2020' : '#ff8800';
  var s2Col = sirenPhase ? '#2020ff' : '#0080ff';
  // Siren body
  ctx.fillStyle = '#888';
  ctx.fillRect(-s*0.05, -s*1.28, s*0.1, s*0.08);
  // Left lens
  var sg1 = ctx.createRadialGradient(-s*0.025, -s*1.24, 0, -s*0.025, -s*1.24, s*0.06);
  sg1.addColorStop(0, s1Col); sg1.addColorStop(1, 'rgba(255,0,0,0)');
  ctx.fillStyle = sg1; ctx.beginPath(); ctx.arc(-s*0.025, -s*1.24, s*0.06, 0, Math.PI*2); ctx.fill();
  // Right lens
  var sg2 = ctx.createRadialGradient(s*0.025, -s*1.24, 0, s*0.025, -s*1.24, s*0.06);
  sg2.addColorStop(0, s2Col); sg2.addColorStop(1, 'rgba(0,0,255,0)');
  ctx.fillStyle = sg2; ctx.beginPath(); ctx.arc(s*0.025, -s*1.24, s*0.06, 0, Math.PI*2); ctx.fill();

  // === SIGN ===
  ctx.fillStyle = '#cc0000';
  ctx.fillRect(-s*0.5, -s*0.92, s, s*0.1);
  ctx.strokeStyle = '#880000'; ctx.lineWidth = 1; ctx.strokeRect(-s*0.5, -s*0.92, s, s*0.1);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold ' + Math.round(s*0.075) + 'px Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('ПОЖАРНАЯ СТАНЦИЯ', 0, -s*0.87);

  // === FLAGPOLE ===
  ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(s*0.42, -s*0.08); ctx.lineTo(s*0.42, -s*0.65); ctx.stroke();
  var fWave = Math.sin(t*0.07)*0.08;
  ctx.fillStyle = '#cc0000';
  ctx.save(); ctx.translate(s*0.42, -s*0.65);
  ctx.beginPath();
  ctx.moveTo(0,0); ctx.lineTo(s*0.14, s*0.03+fWave); ctx.lineTo(s*0.13, s*0.07); ctx.lineTo(0, s*0.06);
  ctx.closePath(); ctx.fill(); ctx.restore();

  // === HOSE REEL outside ===
  ctx.save(); ctx.translate(-s*0.42, -s*0.15);
  ctx.strokeStyle = '#d4a020'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, s*0.07, 0, Math.PI*1.6); ctx.stroke();
  ctx.fillStyle = '#c08010';
  ctx.beginPath(); ctx.arc(0, 0, s*0.03, 0, Math.PI*2); ctx.fill();
  // Hose pipe end
  ctx.strokeStyle = '#d4a020'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(Math.cos(Math.PI*1.6)*s*0.07, Math.sin(Math.PI*1.6)*s*0.07);
  ctx.lineTo(s*0.04, s*0.06); ctx.stroke();
  ctx.restore();

  // Population badge
  if (level >= 2) {
    var popFloat = Math.sin(t*0.055)*s*0.03;
    ctx.font = Math.round(s*0.1)+'px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('👥', 0, -s*1.35+popFloat);
  }
};

// ─── CENTRALPARK — 4×4 Urban Park ───────────────────────────
GameRenderer.prototype._sCentralPark = function(ctx, s, level, tick) {
  var t = tick;

  // === PARK GROUND — multi-zone lawn ===
  var parkGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, s*1.2);
  parkGrad.addColorStop(0, '#56c75a'); parkGrad.addColorStop(0.5, '#3da842'); parkGrad.addColorStop(1, '#2d8a30');
  ctx.fillStyle = parkGrad;
  ctx.beginPath(); ctx.ellipse(0, s*0.1, s*1.1, s*0.55, 0, 0, Math.PI*2); ctx.fill();

  // Park paths (diagonal grid)
  ctx.fillStyle = '#d4c4a0';
  // Main cross paths
  ctx.fillRect(-s*0.07, -s*0.45, s*0.14, s*0.65);
  ctx.fillRect(-s*0.8, -s*0.04, s*1.6, s*0.14);
  // Diagonal corner paths
  ctx.save(); ctx.translate(-s*0.35, -s*0.15); ctx.rotate(Math.PI/4);
  ctx.fillRect(-s*0.04, -s*0.28, s*0.08, s*0.56); ctx.restore();
  ctx.save(); ctx.translate(s*0.35, -s*0.15); ctx.rotate(-Math.PI/4);
  ctx.fillRect(-s*0.04, -s*0.28, s*0.08, s*0.56); ctx.restore();

  // === GRAND FOUNTAIN (center) ===
  // Basin outer rim
  ctx.fillStyle = '#8bafc8';
  ctx.beginPath(); ctx.ellipse(0, s*0.04, s*0.28, s*0.12, 0, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#c8dce8'; ctx.lineWidth = 2; ctx.stroke();
  // Water surface
  var wAnim = Math.sin(t*0.05)*0.02;
  ctx.fillStyle = '#64b5f6';
  ctx.beginPath(); ctx.ellipse(0, s*0.04+wAnim, s*0.24, s*0.1, 0, 0, Math.PI*2); ctx.fill();
  // Water shimmer
  for (var ws2 = 0; ws2 < 6; ws2++) {
    var wsA = t*0.04+ws2*1.05;
    ctx.strokeStyle = 'rgba(255,255,255,'+(0.2+0.2*Math.sin(wsA))+')'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(wsA)*s*0.1, s*0.04+Math.sin(wsA*0.7)*s*0.04);
    ctx.lineTo(Math.cos(wsA)*s*0.14, s*0.04+Math.sin(wsA*0.7)*s*0.06);
    ctx.stroke();
  }
  // Tiered fountain structure
  ctx.fillStyle = '#7cb9e8';
  ctx.beginPath(); ctx.ellipse(0, s*0.02, s*0.1, s*0.04, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#5599cc';
  ctx.beginPath(); ctx.ellipse(0, s*0.0, s*0.05, s*0.02, 0, 0, Math.PI*2); ctx.fill();
  // Fountain spout streams
  for (var fsp2 = 0; fsp2 < 6; fsp2++) {
    var fspA2 = fsp2 * Math.PI/3;
    var fspPh = (t*0.04 + fsp2*0.5) % 1;
    var fspH = fspPh * s*0.22;
    var fspAlpha = Math.max(0, 0.7*(1-fspPh));
    ctx.strokeStyle = 'rgba(100,200,255,'+fspAlpha+')'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(
      Math.cos(fspA2)*s*0.08, -fspH*0.7,
      Math.cos(fspA2)*s*0.12, -fspH+s*0.04
    );
    ctx.stroke();
  }
  // Central column
  ctx.fillStyle = '#c0d0e0';
  ctx.fillRect(-s*0.02, -s*0.2, s*0.04, s*0.22);
  ctx.fillStyle = '#e0eef8';
  ctx.beginPath(); ctx.arc(0, -s*0.22, s*0.03, 0, Math.PI*2); ctx.fill();

  // === FLOWERBEDS (4 quadrants) ===
  var fbQuads = [{x:-s*0.45,y:-s*0.25},{x:s*0.45,y:-s*0.25},{x:-s*0.45,y:s*0.22},{x:s*0.45,y:s*0.22}];
  var fbColors = [['#ff4444','#ff8800','#ffcc00'],['#ee44ee','#8844ff','#4488ff'],
                  ['#44ff88','#ffee44','#ff4488'],['#ff6644','#44aaff','#aaff44']];
  for (var fb2 = 0; fb2 < fbQuads.length; fb2++) {
    ctx.fillStyle = '#2d8a30';
    ctx.beginPath(); ctx.ellipse(fbQuads[fb2].x, fbQuads[fb2].y, s*0.14, s*0.06, 0, 0, Math.PI*2); ctx.fill();
    // Flowers
    for (var fl2 = 0; fl2 < 9; fl2++) {
      var fla = fl2 * Math.PI*2/9 + Math.sin(t*0.01+fb2)*0.05;
      var flr = (fl2 % 3)*s*0.035 + s*0.02;
      var flx = fbQuads[fb2].x + Math.cos(fla)*flr;
      var fly = fbQuads[fb2].y + Math.sin(fla)*flr*0.4;
      ctx.fillStyle = fbColors[fb2][fl2%3];
      ctx.beginPath(); ctx.arc(flx, fly, s*0.014, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff700';
      ctx.beginPath(); ctx.arc(flx, fly, s*0.006, 0, Math.PI*2); ctx.fill();
    }
  }

  // === TALL TREES (8 major trees) ===
  var bigTrees = [
    {x:-s*0.68,y:-s*0.22,h:s*0.38,r:s*0.1,c:'#1b5e20'},
    {x:s*0.68,y:-s*0.22,h:s*0.38,r:s*0.1,c:'#1b5e20'},
    {x:-s*0.68,y:s*0.16,h:s*0.32,r:s*0.09,c:'#2e7d32'},
    {x:s*0.68,y:s*0.16,h:s*0.32,r:s*0.09,c:'#2e7d32'},
    {x:-s*0.2,y:-s*0.38,h:s*0.28,r:s*0.08,c:'#388e3c'},
    {x:s*0.2,y:-s*0.38,h:s*0.28,r:s*0.08,c:'#388e3c'},
    {x:-s*0.5,y:-s*0.01,h:s*0.24,r:s*0.07,c:'#43a047'},
    {x:s*0.5,y:-s*0.01,h:s*0.24,r:s*0.07,c:'#43a047'},
  ];
  for (var bt3 = 0; bt3 < bigTrees.length; bt3++) {
    var tr3 = bigTrees[bt3];
    var twv = Math.sin(t*0.025+bt3*0.8)*s*0.012;
    // Trunk
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(tr3.x-s*0.015+twv*0.3, tr3.y, s*0.03, -tr3.h*0.35);
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath(); ctx.ellipse(tr3.x+s*0.04, tr3.y-tr3.h*0.08, tr3.r*0.9, tr3.r*0.35, 0, 0, Math.PI*2); ctx.fill();
    // 3 canopy layers
    ctx.fillStyle = tr3.c;
    ctx.beginPath(); ctx.arc(tr3.x+twv, tr3.y-tr3.h, tr3.r, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#4caf50';
    ctx.beginPath(); ctx.arc(tr3.x+twv*0.7, tr3.y-tr3.h-tr3.r*0.4, tr3.r*0.75, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#66bb6a';
    ctx.beginPath(); ctx.arc(tr3.x+twv*0.4, tr3.y-tr3.h-tr3.r*0.75, tr3.r*0.5, 0, Math.PI*2); ctx.fill();
  }

  // === BENCHES ===
  var benches2 = [{x:-s*0.22,y:-s*0.1},{x:s*0.22,y:s*0.12},{x:-s*0.08,y:s*0.25},{x:s*0.08,y:-s*0.2}];
  for (var bn2 = 0; bn2 < benches2.length; bn2++) {
    var bnA2 = Math.atan2(benches2[bn2].y, benches2[bn2].x);
    ctx.save(); ctx.translate(benches2[bn2].x, benches2[bn2].y);
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(-s*0.07, -s*0.01, s*0.14, s*0.025);
    ctx.fillStyle = '#795548';
    ctx.fillRect(-s*0.06, s*0.015, s*0.02, s*0.03);
    ctx.fillRect(s*0.04, s*0.015, s*0.02, s*0.03);
    // Backrest
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(-s*0.07, -s*0.04, s*0.14, s*0.02);
    ctx.restore();
  }

  // === LAMP POSTS (6) ===
  var lamps2 = [{x:-s*0.3,y:-s*0.18},{x:s*0.3,y:-s*0.18},{x:-s*0.3,y:s*0.12},{x:s*0.3,y:s*0.12},{x:0,y:-s*0.38},{x:0,y:s*0.3}];
  for (var lp2 = 0; lp2 < lamps2.length; lp2++) {
    ctx.strokeStyle = '#546e7a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(lamps2[lp2].x, lamps2[lp2].y); ctx.lineTo(lamps2[lp2].x, lamps2[lp2].y-s*0.2); ctx.stroke();
    var lglow = 0.4+0.3*Math.sin(t*0.04+lp2*1.1);
    var lampH = ctx.createRadialGradient(lamps2[lp2].x, lamps2[lp2].y-s*0.22, 0, lamps2[lp2].x, lamps2[lp2].y-s*0.22, s*0.08);
    lampH.addColorStop(0,'rgba(255,230,100,'+lglow+')'); lampH.addColorStop(1,'rgba(255,200,50,0)');
    ctx.fillStyle=lampH; ctx.beginPath(); ctx.arc(lamps2[lp2].x, lamps2[lp2].y-s*0.22, s*0.08, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle='#ffd740'; ctx.beginPath(); ctx.arc(lamps2[lp2].x, lamps2[lp2].y-s*0.22, s*0.02, 0, Math.PI*2); ctx.fill();
  }

  // === BIRDS ===
  if (level >= 2) {
    for (var bird2 = 0; bird2 < 5; bird2++) {
      var bP2 = (t*0.015+bird2*1.26) % (Math.PI*2);
      var bX2 = Math.cos(bP2)*s*0.55;
      var bY2 = -s*0.4 - Math.abs(Math.sin(bP2*1.3))*s*0.12 - bird2*s*0.025;
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(bX2-s*0.05, bY2);
      ctx.quadraticCurveTo(bX2, bY2-s*0.025, bX2+s*0.05, bY2);
      ctx.stroke();
    }
  }
};

// ─── BEACHLAKE — Resort Beach & Lake ────────────────────────
GameRenderer.prototype._sBeachLake = function(ctx, s, level, tick) {
  var t = tick;

  // === SAND AREA ===
  var sandGrad = ctx.createRadialGradient(s*0.1, s*0.12, 0, s*0.1, s*0.12, s*0.75);
  sandGrad.addColorStop(0,'#f5deb3'); sandGrad.addColorStop(0.5,'#e8c98e'); sandGrad.addColorStop(1,'#d4b070');
  ctx.fillStyle=sandGrad;
  ctx.beginPath(); ctx.ellipse(s*0.08, s*0.1, s*0.7, s*0.32, 0, 0, Math.PI*2); ctx.fill();

  // === LAKE (animated) ===
  var lakePhase = Math.sin(t*0.04)*0.025;
  var lakeGrad = ctx.createRadialGradient(-s*0.12, -s*0.06, 0, -s*0.12, -s*0.06, s*0.45);
  lakeGrad.addColorStop(0,'#42a5f5'); lakeGrad.addColorStop(0.5,'#1976d2'); lakeGrad.addColorStop(1,'#0d47a1');
  ctx.fillStyle=lakeGrad;
  ctx.beginPath(); ctx.ellipse(-s*0.12, -s*0.04+lakePhase, s*0.44, s*0.22, -0.1, 0, Math.PI*2); ctx.fill();
  // Shore edge
  ctx.strokeStyle = 'rgba(100,180,255,0.5)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(-s*0.12, -s*0.04, s*0.44, s*0.22, -0.1, 0, Math.PI*2); ctx.stroke();
  // Lake shimmer lines
  for (var sh2 = 0; sh2 < 7; sh2++) {
    var shA2 = t*0.025+sh2*0.9;
    var shX = -s*0.12+Math.cos(shA2)*s*0.3;
    var shY = -s*0.04+Math.sin(shA2)*s*0.12;
    ctx.strokeStyle='rgba(255,255,255,'+(0.25+0.2*Math.sin(t*0.08+sh2))+')'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(shX-s*0.04,shY); ctx.lineTo(shX+s*0.04,shY); ctx.stroke();
  }

  // === DOCK / PIER ===
  ctx.fillStyle = '#8d6e63';
  ctx.fillRect(-s*0.02, -s*0.1, s*0.14, s*0.03);
  // Dock posts
  for (var dp2 = 0; dp2 < 4; dp2++) {
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(-s*0.01+dp2*s*0.038, -s*0.1, s*0.015, s*0.08);
  }
  // Boat at dock
  ctx.fillStyle = '#e8f0f8';
  ctx.beginPath();
  ctx.moveTo(s*0.1, -s*0.12);
  ctx.lineTo(s*0.18, -s*0.12);
  ctx.lineTo(s*0.16, -s*0.07);
  ctx.lineTo(s*0.08, -s*0.07);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1565c0';
  ctx.fillRect(s*0.11, -s*0.16, s*0.05, s*0.04);
  ctx.strokeStyle = '#2196f3'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(s*0.135, -s*0.16); ctx.lineTo(s*0.135, -s*0.2); ctx.stroke();
  // Sail
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(s*0.135,-s*0.2); ctx.lineTo(s*0.175,-s*0.135); ctx.lineTo(s*0.135,-s*0.135); ctx.closePath(); ctx.fill();

  // === BEACH UMBRELLAS (3) ===
  var umbX = [s*0.25, s*0.42, s*0.12];
  var umbY = [-s*0.05, s*0.05, s*0.12];
  var umbCol = ['#e53935','#ff8f00','#1565c0'];
  var umbCol2 = ['#ffeb3b','#ff5722','#ffeb3b'];
  for (var umb2 = 0; umb2 < 3; umb2++) {
    var uvWave = Math.sin(t*0.04+umb2)*0.04;
    ctx.save(); ctx.translate(umbX[umb2], umbY[umb2]); ctx.rotate(uvWave);
    // Pole
    ctx.strokeStyle='#795548'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(0,s*0.12); ctx.lineTo(0,-s*0.22); ctx.stroke();
    // Canopy
    ctx.fillStyle=umbCol[umb2];
    ctx.beginPath(); ctx.arc(0,-s*0.22,s*0.14,Math.PI,0); ctx.fill();
    // Stripes
    for (var usp=0;usp<5;usp++) {
      var usA=Math.PI+usp*Math.PI/4;
      if(usp%2===0) {
        ctx.fillStyle=umbCol2[umb2];
        ctx.beginPath(); ctx.moveTo(0,-s*0.22);
        ctx.arc(0,-s*0.22,s*0.14,usA,usA+Math.PI/4);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
    // Beach chair
    ctx.save(); ctx.translate(umbX[umb2]+s*0.06, umbY[umb2]+s*0.08);
    ctx.fillStyle='#ff8f00';
    ctx.fillRect(-s*0.07,0,s*0.14,s*0.03);
    ctx.fillRect(-s*0.07,-s*0.07,s*0.02,s*0.07);
    ctx.fillRect(s*0.05,-s*0.07,s*0.02,s*0.07);
    ctx.restore();
  }

  // === PALM TREES ===
  var palms = [{x:-s*0.58,y:-s*0.02},{x:s*0.6,y:-s*0.1},{x:-s*0.45,y:s*0.2}];
  for (var palm = 0; palm < palms.length; palm++) {
    ctx.save(); ctx.translate(palms[palm].x, palms[palm].y);
    var palmSway = Math.sin(t*0.03+palm)*0.05;
    // Trunk (curved)
    ctx.strokeStyle='#6d4c41'; ctx.lineWidth=4;
    ctx.beginPath();
    ctx.moveTo(0, s*0.12);
    ctx.quadraticCurveTo(s*0.04+palmSway, -s*0.1, palmSway*s*3, -s*0.32);
    ctx.stroke();
    // Coconuts
    ctx.fillStyle='#8d6e63';
    ctx.beginPath(); ctx.arc(palmSway*s*3, -s*0.32, s*0.025, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(palmSway*s*3-s*0.035, -s*0.34, s*0.02, 0, Math.PI*2); ctx.fill();
    // Fronds (6)
    for (var fr = 0; fr < 6; fr++) {
      var frA = fr*Math.PI/3 + palmSway;
      var frLen = s*0.18 + Math.sin(fr)*s*0.04;
      ctx.strokeStyle='#2e7d32'; ctx.lineWidth=2.5;
      ctx.beginPath();
      ctx.moveTo(palmSway*s*3, -s*0.32);
      ctx.quadraticCurveTo(
        palmSway*s*3+Math.cos(frA)*frLen*0.5, -s*0.32+Math.sin(frA)*frLen*0.3,
        palmSway*s*3+Math.cos(frA)*frLen, -s*0.32+Math.sin(frA)*frLen*0.5
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // === BEACH VOLLEYBALL NET ===
  ctx.save(); ctx.translate(-s*0.28, s*0.15);
  ctx.strokeStyle='#8d6e63'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(-s*0.08,-s*0.12); ctx.lineTo(-s*0.08,0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.08,-s*0.12); ctx.lineTo(s*0.08,0); ctx.stroke();
  ctx.strokeStyle='#f0f0f0'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(-s*0.08,-s*0.12); ctx.lineTo(s*0.08,-s*0.12); ctx.stroke();
  // Net mesh
  for (var nm=0;nm<4;nm++) {
    ctx.strokeStyle='rgba(240,240,240,0.5)'; ctx.lineWidth=0.5;
    ctx.beginPath(); ctx.moveTo(-s*0.08+nm*s*0.05,-s*0.12); ctx.lineTo(-s*0.08+nm*s*0.05-s*0.01,0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s*0.08,(nm-2)*s*0.04-s*0.04); ctx.lineTo(s*0.08,(nm-2)*s*0.04-s*0.04); ctx.stroke();
  }
  ctx.restore();

  // Coins float
  if (level >= 2) {
    for (var c2 = 0; c2 < 4; c2++) {
      var cP2=(t*0.05+c2*1.57)%(Math.PI*2);
      ctx.globalAlpha=0.6+0.4*Math.sin(t*0.08+c2);
      ctx.font=Math.round(s*0.09)+'px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('🪙', Math.cos(cP2)*s*0.35, -s*0.15+Math.sin(cP2)*s*0.1);
      ctx.globalAlpha=1;
    }
  }
};

// ─── CARDEALER — Premium Auto Showroom ──────────────────────
GameRenderer.prototype._sCarDealer = function(ctx, s, level, tick) {
  var t = tick;

  // === PAVED LOT ===
  ctx.fillStyle = '#9e9e9e';
  ctx.fillRect(-s*0.7, -s*0.07, s*1.4, s*0.07);
  // Lot markings
  ctx.strokeStyle = '#bdbdbd'; ctx.lineWidth = 1; ctx.setLineDash([s*0.04,s*0.06]);
  for (var lm=-3; lm<=3; lm++) {
    ctx.beginPath(); ctx.moveTo(lm*s*0.18,-s*0.07); ctx.lineTo(lm*s*0.18,0); ctx.stroke();
  }
  ctx.setLineDash([]);

  // === MAIN SHOWROOM (glass & steel) ===
  // Steel frame
  ctx.fillStyle = '#78909c';
  ctx.fillRect(-s*0.6, -s*0.9, s*1.2, s*0.82);
  // Glass walls
  var glGrad2 = ctx.createLinearGradient(-s*0.55, -s*0.88, s*0.55, -s*0.12);
  glGrad2.addColorStop(0,'rgba(180,220,255,0.92)');
  glGrad2.addColorStop(0.3,'rgba(200,235,255,0.85)');
  glGrad2.addColorStop(0.7,'rgba(150,205,255,0.75)');
  glGrad2.addColorStop(1,'rgba(120,185,240,0.65)');
  ctx.fillStyle=glGrad2;
  ctx.fillRect(-s*0.55, -s*0.88, s*1.1, s*0.8);

  // Steel frame grid
  ctx.strokeStyle = '#546e7a'; ctx.lineWidth = 2;
  for (var fg2 = -2; fg2 <= 2; fg2++) {
    ctx.beginPath(); ctx.moveTo(fg2*s*0.22, -s*0.88); ctx.lineTo(fg2*s*0.22, -s*0.08); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(-s*0.55,-s*0.5); ctx.lineTo(s*0.55,-s*0.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.55,-s*0.7); ctx.lineTo(s*0.55,-s*0.7); ctx.stroke();

  // Interior light
  var ilGrad = ctx.createLinearGradient(-s*0.5, -s*0.85, -s*0.5, -s*0.15);
  ilGrad.addColorStop(0,'rgba(255,250,230,0.25)');
  ilGrad.addColorStop(1,'rgba(255,240,200,0.1)');
  ctx.fillStyle=ilGrad; ctx.fillRect(-s*0.5,-s*0.85,s,s*0.77);

  // Reflections (diagonal)
  ctx.fillStyle='rgba(255,255,255,0.12)';
  ctx.save(); ctx.translate(-s*0.5,-s*0.85);
  for(var rf=0;rf<4;rf++){
    ctx.beginPath();
    ctx.moveTo(rf*s*0.28,0); ctx.lineTo(rf*s*0.28+s*0.12,0);
    ctx.lineTo(rf*s*0.28+s*0.04,s*0.77); ctx.lineTo(rf*s*0.28-s*0.08,s*0.77);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  // === DISPLAY CARS (3 on floor, 2 on raised podiums) ===
  var displayCars2 = [
    {x:-s*0.36,y:-s*0.35,col:'#f44336',type:'sports',rot:0.1},
    {x:0,y:-s*0.42,col:'#ffc107',type:'suv',rot:0},
    {x:s*0.36,y:-s*0.35,col:'#2196f3',type:'sports',rot:-0.1},
    {x:-s*0.19,y:-s*0.22,col:'#4caf50',type:'coupe',rot:0.05},
    {x:s*0.19,y:-s*0.22,col:'#9c27b0',type:'coupe',rot:-0.05},
  ];
  for (var dc2 = 0; dc2 < displayCars2.length; dc2++) {
    var dcar = displayCars2[dc2];
    ctx.save(); ctx.translate(dcar.x, dcar.y); ctx.rotate(dcar.rot);
    // Spotlight from above
    var spotGrad = ctx.createRadialGradient(0,-s*0.04,0,0,-s*0.04,s*0.1);
    spotGrad.addColorStop(0,'rgba(255,250,230,0.25)'); spotGrad.addColorStop(1,'rgba(255,250,230,0)');
    ctx.fillStyle=spotGrad; ctx.beginPath(); ctx.ellipse(0,0,s*0.12,s*0.05,0,0,Math.PI*2); ctx.fill();
    // Car shadow
    ctx.fillStyle='rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(0, s*0.01, s*0.12, s*0.03, 0, 0, Math.PI*2); ctx.fill();
    // Car body
    var carBGrad2 = ctx.createLinearGradient(-s*0.12,-s*0.1,s*0.12,0);
    carBGrad2.addColorStop(0,dcar.col); carBGrad2.addColorStop(0.5,dcar.col); carBGrad2.addColorStop(1,'rgba(0,0,0,0.3)');
    ctx.fillStyle=carBGrad2;
    if(dcar.type==='sports'){
      ctx.beginPath();
      ctx.moveTo(-s*0.13,0); ctx.lineTo(-s*0.13,-s*0.06);
      ctx.quadraticCurveTo(-s*0.08,-s*0.12,s*0.04,-s*0.12);
      ctx.lineTo(s*0.13,-s*0.06); ctx.lineTo(s*0.13,0); ctx.closePath(); ctx.fill();
    } else if(dcar.type==='suv'){
      ctx.fillRect(-s*0.14,-s*0.12,s*0.28,s*0.12);
      ctx.fillRect(-s*0.1,-s*0.22,s*0.22,s*0.1);
    } else {
      ctx.beginPath();
      ctx.moveTo(-s*0.12,0); ctx.lineTo(-s*0.12,-s*0.07);
      ctx.lineTo(-s*0.04,-s*0.14); ctx.lineTo(s*0.08,-s*0.14);
      ctx.lineTo(s*0.12,-s*0.07); ctx.lineTo(s*0.12,0); ctx.closePath(); ctx.fill();
    }
    // Window(s)
    ctx.fillStyle='rgba(180,225,255,0.85)';
    if(dcar.type==='suv'){ ctx.fillRect(-s*0.08,-s*0.2,s*0.18,s*0.07); }
    else { ctx.beginPath(); ctx.moveTo(-s*0.04,-s*0.07); ctx.lineTo(-s*0.04,-s*0.11); ctx.lineTo(s*0.06,-s*0.11); ctx.lineTo(s*0.1,-s*0.07); ctx.closePath(); ctx.fill(); }
    // Window shine
    ctx.fillStyle='rgba(255,255,255,0.35)';
    ctx.fillRect(-s*0.025,-s*0.1,s*0.03,s*0.03);
    // Wheels
    ctx.fillStyle='#1a1a1a';
    var wpos2 = dcar.type==='suv' ? [-s*0.09,s*0.09] : [-s*0.08,s*0.08];
    for(var wpi=0;wpi<2;wpi++){
      ctx.beginPath(); ctx.arc(wpos2[wpi],0,s*0.03,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#555'; ctx.beginPath(); ctx.arc(wpos2[wpi],0,s*0.016,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='#888'; ctx.lineWidth=0.5;
      for(var sp2=0;sp2<5;sp2++){
        var spA=sp2*Math.PI*2/5;
        ctx.beginPath(); ctx.moveTo(wpos2[wpi],0); ctx.lineTo(wpos2[wpi]+Math.cos(spA)*s*0.016,Math.sin(spA)*s*0.016); ctx.stroke();
      }
      ctx.fillStyle='#1a1a1a';
    }
    ctx.restore();
  }

  // === ROOF (flat with skylight) ===
  ctx.fillStyle = '#546e7a';
  ctx.fillRect(-s*0.62, -s*0.92, s*1.24, s*0.06);
  // Skylight
  var skyGrad = ctx.createLinearGradient(-s*0.2,-s*0.92,s*0.2,-s*0.86);
  skyGrad.addColorStop(0,'rgba(150,220,255,0.5)'); skyGrad.addColorStop(1,'rgba(200,240,255,0.3)');
  ctx.fillStyle=skyGrad; ctx.fillRect(-s*0.2,-s*0.92,s*0.4,s*0.06);

  // === SIGNAGE ===
  ctx.fillStyle = '#0d47a1';
  ctx.fillRect(-s*0.62, -s*1.0, s*1.24, s*0.1);
  // Neon glow
  var neonGlow = 0.7+0.3*Math.sin(t*0.06);
  ctx.shadowColor = 'rgba(100,200,255,0.8)';
  ctx.shadowBlur = 8*neonGlow;
  ctx.fillStyle = '#40c4ff';
  ctx.font = 'bold ' + Math.round(s*0.08) + 'px Arial';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('AUTO SALON PREMIUM', 0, -s*0.95);
  ctx.shadowBlur = 0;

  // Stars / rating
  for (var sr=0;sr<5;sr++) {
    var starA = 0.3+0.3*Math.sin(t*0.08+sr*0.5);
    ctx.globalAlpha=starA;
    ctx.font=Math.round(s*0.07)+'px Arial';
    ctx.fillText('⭐', -s*0.2+sr*s*0.1, -s*1.1);
    ctx.globalAlpha=1;
  }
};

// ─── MILITARY — Full Military Base ──────────────────────────
GameRenderer.prototype._sMilitary = function(ctx, s, level, tick) {
  var t = tick;

  // === TERRAIN — military green compound ===
  ctx.fillStyle = '#4a5c2a';
  ctx.fillRect(-s*0.75, -s*0.08, s*1.5, s*0.08);

  // === PERIMETER FENCE ===
  ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
  ctx.strokeRect(-s*0.7, -s*0.08, s*1.4, 0);
  // Fence posts
  for (var fp = -6; fp <= 6; fp++) {
    ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(fp*s*0.22, -s*0.08); ctx.lineTo(fp*s*0.22, -s*0.22); ctx.stroke();
    // Barbed wire top
    ctx.strokeStyle = '#999'; ctx.lineWidth = 0.5;
    for (var bwt = 0; bwt < 3; bwt++) {
      ctx.beginPath(); ctx.moveTo(fp*s*0.22-s*0.01, -s*0.18-bwt*s*0.015); ctx.lineTo(fp*s*0.22+s*0.01, -s*0.22+bwt*s*0.01); ctx.stroke();
    }
  }
  // Barbed wire horizontal lines
  for (var bwh = 0; bwh < 3; bwh++) {
    ctx.strokeStyle = '#999'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(-s*0.7, -s*(0.12+bwh*0.03)); ctx.lineTo(s*0.7, -s*(0.12+bwh*0.03)); ctx.stroke();
  }

  // === COMMAND BUILDING ===
  var cmdGrad = ctx.createLinearGradient(-s*0.3, -s*0.78, s*0.3, -s*0.08);
  cmdGrad.addColorStop(0,'#8fae7c'); cmdGrad.addColorStop(0.5,'#6b8a56'); cmdGrad.addColorStop(1,'#4a6338');
  ctx.fillStyle=cmdGrad;
  ctx.fillRect(-s*0.3, -s*0.72, s*0.6, s*0.64);

  // Camo pattern on building
  ctx.globalAlpha=0.2;
  var camoShapes = [{x:-s*0.2,y:-s*0.55,rx:s*0.12,ry:s*0.06},{x:s*0.15,y:-s*0.4,rx:s*0.1,ry:s*0.05},
                   {x:-s*0.05,y:-s*0.22,rx:s*0.14,ry:s*0.07},{x:s*0.08,y:-s*0.62,rx:s*0.08,ry:s*0.04}];
  for(var cm2=0;cm2<camoShapes.length;cm2++){
    ctx.fillStyle=cm2%2===0?'#3d5225':'#7a8f40';
    ctx.beginPath(); ctx.ellipse(camoShapes[cm2].x,camoShapes[cm2].y,camoShapes[cm2].rx,camoShapes[cm2].ry,cm2*0.4,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=1;

  // Command windows
  for (var cw2=0;cw2<5;cw2++) {
    var cwx = -s*0.22+cw2*s*0.11;
    ctx.fillStyle='#1a2810'; ctx.fillRect(cwx,-s*0.62,s*0.08,s*0.1);
    // Window bars
    ctx.strokeStyle='#888'; ctx.lineWidth=0.8;
    for(var wb2=0;wb2<3;wb2++){ctx.beginPath();ctx.moveTo(cwx+wb2*s*0.028,-s*0.62);ctx.lineTo(cwx+wb2*s*0.028,-s*0.52);ctx.stroke();}
  }

  // Command main door
  ctx.fillStyle='#2d3a1a'; ctx.fillRect(-s*0.07,-s*0.36,s*0.14,s*0.28);
  ctx.strokeStyle='#4a5c2a'; ctx.lineWidth=2; ctx.strokeRect(-s*0.07,-s*0.36,s*0.14,s*0.28);
  ctx.fillStyle='rgba(100,150,80,0.3)'; ctx.fillRect(-s*0.06,-s*0.35,s*0.12,s*0.26);

  // === BARRACKS (2 buildings) ===
  for (var bar=-1;bar<=1;bar+=2) {
    var barX=bar*s*0.52;
    var barGrad=ctx.createLinearGradient(barX-s*0.18,-s*0.55,barX+s*0.18,-s*0.08);
    barGrad.addColorStop(0,'#7a9a64'); barGrad.addColorStop(1,'#506840');
    ctx.fillStyle=barGrad; ctx.fillRect(barX-s*0.18,-s*0.5,s*0.36,s*0.42);
    // Barracks windows
    for(var bw3=0;bw3<3;bw3++){
      ctx.fillStyle='#1a2810'; ctx.fillRect(barX-s*0.12+bw3*s*0.1,-s*0.42,s*0.07,s*0.09);
    }
    // Barracks door
    ctx.fillStyle='#2d3a1a'; ctx.fillRect(barX-s*0.04,-s*0.26,s*0.08,s*0.18);
    // Barracks roof
    ctx.fillStyle='#3d5025';
    ctx.beginPath();
    ctx.moveTo(barX-s*0.2,-s*0.5);
    ctx.lineTo(barX,-s*0.66);
    ctx.lineTo(barX+s*0.2,-s*0.5);
    ctx.closePath(); ctx.fill();
  }

  // === WATCHTOWER ===
  ctx.save(); ctx.translate(s*0.55,-s*0.05);
  // Tower legs
  ctx.strokeStyle='#4a5c2a'; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.moveTo(-s*0.07,0); ctx.lineTo(-s*0.04,-s*0.45); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.07,0); ctx.lineTo(s*0.04,-s*0.45); ctx.stroke();
  // Cross braces
  ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(-s*0.07,-s*0.1); ctx.lineTo(s*0.07,-s*0.25); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.07,-s*0.1); ctx.lineTo(-s*0.07,-s*0.25); ctx.stroke();
  // Tower platform
  ctx.fillStyle='#3d5025'; ctx.fillRect(-s*0.09,-s*0.5,s*0.18,s*0.06);
  // Tower cabin
  ctx.fillStyle='#6b8a56'; ctx.fillRect(-s*0.08,-s*0.72,s*0.16,s*0.22);
  // Tower windows
  ctx.fillStyle='rgba(30,50,20,0.8)'; ctx.fillRect(-s*0.06,-s*0.68,s*0.12,s*0.1);
  // Searchlight
  var searchAngle=(t*0.02)%(Math.PI*2);
  ctx.strokeStyle='rgba(255,255,200,0.5)'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(0,-s*0.72);
  ctx.lineTo(Math.cos(searchAngle)*s*0.35,-s*0.72+Math.sin(searchAngle)*s*0.15);
  ctx.stroke();
  ctx.restore();

  // === TANKS (2 animated) ===
  for (var tnk=0;tnk<2;tnk++) {
    var tnkX=(tnk===0?-1:1)*(s*0.35)+Math.sin(t*0.008+tnk)*s*0.06;
    var tnkY=-s*0.14+tnk*s*0.04;
    ctx.save(); ctx.translate(tnkX,tnkY);
    // Tank body
    ctx.fillStyle='#4a6338'; ctx.fillRect(-s*0.15,-s*0.11,s*0.3,s*0.11);
    // Tracks
    ctx.fillStyle='#2a3a20';
    for(var trk2=-3;trk2<=3;trk2++){
      ctx.fillRect(trk2*s*0.04-s*0.015,-s*0.02,s*0.03,s*0.04);
    }
    ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.fillRect(-s*0.14,-s*0.02,s*0.28,s*0.02);
    // Turret
    ctx.fillStyle='#3d5225'; ctx.beginPath(); ctx.ellipse(0,-s*0.11,s*0.09,s*0.06,0,0,Math.PI*2); ctx.fill();
    // Cannon
    var cannonA = tnk===0 ? 0.2 : -0.15;
    ctx.strokeStyle='#2a3a18'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(0,-s*0.11); ctx.lineTo(Math.cos(cannonA)*s*0.22,-(s*0.11+Math.sin(cannonA)*s*0.22)); ctx.stroke();
    ctx.restore();
  }

  // === RADAR DISH ===
  ctx.save(); ctx.translate(-s*0.55,-s*0.3);
  ctx.strokeStyle='#8a9a80'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,-s*0.18); ctx.stroke();
  var radarAngle=(t*0.04)%(Math.PI*2);
  ctx.save(); ctx.translate(0,-s*0.18); ctx.rotate(radarAngle);
  ctx.strokeStyle='#b0c0a0'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(0,0,s*0.1,-Math.PI*0.7,Math.PI*0.7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(Math.cos(-Math.PI*0.7)*s*0.1,Math.sin(-Math.PI*0.7)*s*0.1);
  ctx.lineTo(0,0); ctx.lineTo(Math.cos(Math.PI*0.7)*s*0.1,Math.sin(Math.PI*0.7)*s*0.1); ctx.stroke();
  // Radar sweep
  var sweepGrad=ctx.createConicalGradient ? null : null;
  ctx.fillStyle='rgba(100,200,100,'+(0.1+0.15*Math.sin(t*0.1))+')';
  ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,s*0.12,0,Math.PI*0.4); ctx.closePath(); ctx.fill();
  ctx.restore(); ctx.restore();

  // Flagpole
  ctx.strokeStyle='#7a8a70'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(0,-s*0.72); ctx.lineTo(0,-s*1.0); ctx.stroke();
  ctx.fillStyle='#cc0000'; ctx.save(); ctx.translate(0,-s*1.0);
  var fw2=Math.sin(t*0.06)*0.07;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(s*0.16,s*0.04+fw2); ctx.lineTo(s*0.15,s*0.08); ctx.lineTo(0,s*0.07); ctx.closePath(); ctx.fill();
  // Star on flag
  ctx.fillStyle='#ffff00'; ctx.font=Math.round(s*0.06)+'px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('★',s*0.08,s*0.04); ctx.restore();
};

// ─── POLICE — Police Headquarters ───────────────────────────
GameRenderer.prototype._sPolice = function(ctx, s, level, tick) {
  var t = tick;

  // === BASE PLAZA ===
  ctx.fillStyle = '#9e9e9e';
  ctx.fillRect(-s*0.65, -s*0.08, s*1.3, s*0.08);
  // Plaza tiles
  ctx.strokeStyle='rgba(255,255,255,0.2)'; ctx.lineWidth=0.5;
  for(var pt=-5;pt<=5;pt++){
    ctx.beginPath(); ctx.moveTo(pt*s*0.22,-s*0.08); ctx.lineTo(pt*s*0.22,0); ctx.stroke();
  }

  // === MAIN BUILDING (imposing government style) ===
  var polGrad2=ctx.createLinearGradient(-s*0.5,-s*1.0,s*0.5,-s*0.08);
  polGrad2.addColorStop(0,'#455a64'); polGrad2.addColorStop(0.5,'#37474f'); polGrad2.addColorStop(1,'#263238');
  ctx.fillStyle=polGrad2;
  ctx.fillRect(-s*0.5,-s*0.9,s,s*0.82);

  // Blue decorative stripe band
  ctx.fillStyle='#1565c0';
  ctx.fillRect(-s*0.5,-s*0.55,s,s*0.07);
  ctx.fillStyle='#1976d2';
  ctx.fillRect(-s*0.5,-s*0.62,s,s*0.02);
  ctx.fillRect(-s*0.5,-s*0.5,s,s*0.02);

  // === FACADE COLUMNS ===
  var polColX=[-s*0.38,-s*0.2,-s*0.04,s*0.04,s*0.2,s*0.38];
  for(var pc2=0;pc2<polColX.length;pc2++){
    var pcolGrad=ctx.createLinearGradient(polColX[pc2]-s*0.03,0,polColX[pc2]+s*0.03,0);
    pcolGrad.addColorStop(0,'#546e7a'); pcolGrad.addColorStop(0.5,'#607d8b'); pcolGrad.addColorStop(1,'#455a64');
    ctx.fillStyle=pcolGrad; ctx.fillRect(polColX[pc2]-s*0.025,-s*0.85,s*0.05,s*0.65);
    ctx.fillStyle='#37474f'; ctx.fillRect(polColX[pc2]-s*0.035,-s*0.87,s*0.07,s*0.03);
    ctx.fillRect(polColX[pc2]-s*0.035,-s*0.22,s*0.07,s*0.02);
  }

  // === WINDOWS (arched, lit) ===
  var polWinRows=2, polWinCols=5;
  for(var wr=0;wr<polWinRows;wr++){
    for(var wc2=0;wc2<polWinCols;wc2++){
      var pwx=(wc2-2)*s*0.18;
      var pwy=-s*(0.82-wr*0.25);
      // Frame
      ctx.fillStyle='#2d3a42';
      ctx.beginPath(); ctx.roundRect(pwx-s*0.065,pwy,s*0.13,s*0.2,s*0.065); ctx.fill();
      // Glass
      var pwLit=(t%180+wr*60+wc2*30)%180>90;
      ctx.fillStyle=pwLit?'rgba(255,220,80,0.4)':'rgba(30,70,120,0.7)';
      ctx.beginPath(); ctx.roundRect(pwx-s*0.05,pwy+s*0.01,s*0.1,s*0.18,s*0.05); ctx.fill();
      // Mullion
      ctx.strokeStyle='#546e7a'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(pwx,pwy); ctx.lineTo(pwx,pwy+s*0.19); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pwx-s*0.05,pwy+s*0.08); ctx.lineTo(pwx+s*0.05,pwy+s*0.08); ctx.stroke();
    }
  }

  // === GRAND ENTRANCE ===
  ctx.fillStyle='#1a2530';
  ctx.beginPath(); ctx.roundRect(-s*0.14,-s*0.42,s*0.28,s*0.42,s*0.02); ctx.fill();
  // Steps
  for(var es=0;es<3;es++){
    ctx.fillStyle=['#546e7a','#455a64','#37474f'][es];
    ctx.fillRect(-s*(0.18-es*0.02),-s*(0.06+es*0.04),s*(0.36-es*0.04),s*0.04);
  }
  // Glass doors
  var gdGrad=ctx.createLinearGradient(-s*0.12,-s*0.4,s*0.12,-s*0.12);
  gdGrad.addColorStop(0,'rgba(80,140,200,0.6)'); gdGrad.addColorStop(1,'rgba(40,90,160,0.4)');
  ctx.fillStyle=gdGrad; ctx.fillRect(-s*0.12,-s*0.4,s*0.24,s*0.34);
  ctx.strokeStyle='#607d8b'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(0,-s*0.4); ctx.lineTo(0,-s*0.06); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.12,-s*0.24); ctx.lineTo(s*0.12,-s*0.24); ctx.stroke();
  // Door handles
  ctx.strokeStyle='#ffd740'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(-s*0.04,-s*0.22); ctx.lineTo(-s*0.02,-s*0.22); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.02,-s*0.22); ctx.lineTo(s*0.04,-s*0.22); ctx.stroke();

  // === POLICE BADGE (over entrance) ===
  ctx.fillStyle='#ffd700';
  ctx.beginPath(); ctx.arc(0,-s*0.48,s*0.09,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#1565c0'; ctx.beginPath(); ctx.arc(0,-s*0.48,s*0.07,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#ffd700';
  ctx.font='bold '+Math.round(s*0.07)+'px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('★',0,-s*0.48);

  // === PATROL CARS (2) ===
  for(var pcar=0;pcar<2;pcar++){
    var pcarX=(pcar===0?-1:1)*s*0.38;
    ctx.save(); ctx.translate(pcarX,-s*0.055);
    // Car body
    ctx.fillStyle='#0d47a1'; ctx.fillRect(-s*0.11,-s*0.07,s*0.22,s*0.07);
    ctx.fillStyle='#1565c0'; ctx.fillRect(-s*0.08,-s*0.14,s*0.16,s*0.07);
    ctx.fillStyle='rgba(150,220,255,0.8)'; ctx.fillRect(-s*0.065,-s*0.135,s*0.13,s*0.055);
    // Stripe
    ctx.fillStyle='#f5f5f5'; ctx.fillRect(-s*0.11,-s*0.04,s*0.22,s*0.02);
    // Siren bar
    var sirenC=(t%30<15)?'#ff1744':'#2979ff';
    var sirenC2=(t%30<15)?'#2979ff':'#ff1744';
    ctx.fillStyle=sirenC; ctx.fillRect(-s*0.06,-s*0.16,s*0.06,s*0.025);
    ctx.fillStyle=sirenC2; ctx.fillRect(0,-s*0.16,s*0.06,s*0.025);
    // Glow
    var polSirenG=ctx.createRadialGradient(0,-s*0.148,0,0,-s*0.148,s*0.06);
    polSirenG.addColorStop(0,'rgba(255,100,100,'+(0.3+0.3*Math.sin(t*0.15))+')');
    polSirenG.addColorStop(1,'rgba(255,100,100,0)');
    ctx.fillStyle=polSirenG; ctx.beginPath(); ctx.arc(0,-s*0.148,s*0.06,0,Math.PI*2); ctx.fill();
    // Wheels
    ctx.fillStyle='#111';
    ctx.beginPath(); ctx.arc(-s*0.07,0,s*0.025,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(s*0.07,0,s*0.025,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // === LAMP POSTS ===
  var polLamps=[{x:-s*0.58},{x:s*0.58},{x:-s*0.3,y:-s*0.02},{x:s*0.3,y:-s*0.02}];
  for(var plp=0;plp<polLamps.length;plp++){
    var lpX=polLamps[plp].x, lpY=polLamps[plp].y||-s*0.03;
    ctx.strokeStyle='#546e7a'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(lpX,lpY); ctx.lineTo(lpX,lpY-s*0.45); ctx.stroke();
    var plGlow=0.4+0.3*Math.sin(t*0.05+plp*0.8);
    var plH=ctx.createRadialGradient(lpX,lpY-s*0.48,0,lpX,lpY-s*0.48,s*0.1);
    plH.addColorStop(0,'rgba(255,225,100,'+plGlow+')'); plH.addColorStop(1,'rgba(255,200,50,0)');
    ctx.fillStyle=plH; ctx.beginPath(); ctx.arc(lpX,lpY-s*0.48,s*0.1,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#ffd740'; ctx.beginPath(); ctx.arc(lpX,lpY-s*0.48,s*0.022,0,Math.PI*2); ctx.fill();
  }

  // === SIGN ===
  ctx.fillStyle='#0a2744';
  ctx.fillRect(-s*0.52,-s*0.98,s*1.04,s*0.1);
  ctx.strokeStyle='#1565c0'; ctx.lineWidth=1.5; ctx.strokeRect(-s*0.52,-s*0.98,s*1.04,s*0.1);
  ctx.fillStyle='#fff'; ctx.font='bold '+Math.round(s*0.075)+'px Arial';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('УПРАВЛЕНИЕ ПОЛИЦИИ', 0,-s*0.93);

  // === ROOF ===
  ctx.fillStyle='#263238'; ctx.fillRect(-s*0.52,-s*0.93,s*1.04,s*0.04);
  // Rooftop details
  ctx.fillStyle='#1565c0'; ctx.fillRect(-s*0.1,-s*1.02,s*0.2,s*0.1);
  ctx.fillStyle='#0d47a1'; ctx.fillRect(-s*0.08,-s*1.05,s*0.16,s*0.05);
};

// ─── NUCLEARPLANT — Atomic Power Station 4×4 ────────────────
GameRenderer.prototype._sNuclearPlant = function(ctx, s, level, tick) {
  var t = tick;

  // === VAST CONCRETE FACILITY ===
  var platGrad=ctx.createLinearGradient(-s*1.0,-s*0.12,s*1.0,0);
  platGrad.addColorStop(0,'#c8d0d8'); platGrad.addColorStop(0.5,'#b8c0c8'); platGrad.addColorStop(1,'#a0a8b0');
  ctx.fillStyle=platGrad; ctx.fillRect(-s*1.0,-s*0.12,s*2.0,s*0.12);
  // Warning border
  for(var wb4=0;wb4<8;wb4++){
    ctx.fillStyle=wb4%2===0?'#f39c12':'#2c3e50';
    ctx.fillRect(-s*1.0+wb4*s*0.08,-s*0.12,s*0.08,s*0.12);
    ctx.fillRect(s*0.36+wb4*s*0.08,-s*0.12,s*0.08,s*0.12);
  }

  // === MAIN REACTOR CONTAINMENT BUILDING ===
  var reactGrad2=ctx.createLinearGradient(-s*0.5,-s*1.0,s*0.5,-s*0.12);
  reactGrad2.addColorStop(0,'#ecf0f1'); reactGrad2.addColorStop(0.5,'#bdc3c7'); reactGrad2.addColorStop(1,'#95a5a6');
  ctx.fillStyle=reactGrad2; ctx.fillRect(-s*0.5,-s*0.9,s,s*0.78);
  // Building edge shadow
  ctx.fillStyle='rgba(0,0,0,0.15)'; ctx.fillRect(s*0.4,-s*0.9,s*0.1,s*0.78);

  // Window grid on reactor building
  for(var rwr=0;rwr<4;rwr++){
    for(var rwc=-3;rwc<=3;rwc++){
      if(Math.abs(rwc)>1 && rwr<2) continue;
      var rwAlpha=0.6+0.4*Math.sin(t*0.06+rwr*rwc);
      ctx.fillStyle='rgba(0,220,120,'+rwAlpha+')';
      ctx.fillRect(rwc*s*0.13-s*0.04,-s*(0.84-rwr*0.18),s*0.08,s*0.12);
    }
  }

  // === TWO MASSIVE COOLING TOWERS ===
  var ctPos=[{x:-s*0.72},{x:s*0.72}];
  for(var ct2=0;ct2<2;ct2++){
    var ctx2=ctPos[ct2].x;
    // Tower (hyperbolic hyperboloid shape)
    var ctGrad=ctx.createLinearGradient(ctx2-s*0.28,-s*1.35,ctx2+s*0.28,-s*0.12);
    ctGrad.addColorStop(0,'#d5d8dc'); ctGrad.addColorStop(0.4,'#bdc3c7'); ctGrad.addColorStop(1,'#95a5a6');
    ctx.fillStyle=ctGrad;
    ctx.beginPath();
    ctx.moveTo(ctx2-s*0.28,0);
    ctx.quadraticCurveTo(ctx2-s*0.14,-s*0.62,ctx2-s*0.19,-s*1.32);
    ctx.lineTo(ctx2+s*0.19,-s*1.32);
    ctx.quadraticCurveTo(ctx2+s*0.14,-s*0.62,ctx2+s*0.28,0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle='#8a9ea8'; ctx.lineWidth=1.5; ctx.stroke();

    // Tower opening
    ctx.fillStyle='#e8ecf0';
    ctx.beginPath(); ctx.ellipse(ctx2,-s*1.32,s*0.19,s*0.06,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#b8c4cc'; ctx.lineWidth=1; ctx.stroke();

    // Hazard stripes on tower
    for(var hs2=0;hs2<4;hs2++){
      var hsGrad=ctx.createLinearGradient(ctx2-s*0.28,0,ctx2+s*0.28,0);
      hsGrad.addColorStop(0,'rgba(0,0,0,0)');
      hsGrad.addColorStop(0.5,hs2%2===0?'rgba(255,165,0,0.22)':'rgba(40,40,40,0.18)');
      hsGrad.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=hsGrad;
      ctx.fillRect(ctx2-s*0.28,-s*(0.18+hs2*0.14),s*0.56,s*0.14);
    }

    // === STEAM CLOUDS (multiple, animated) ===
    for(var stm2=0;stm2<6;stm2++){
      var stmPh=(t*0.01+stm2*0.18+ct2*0.3)%1;
      var stmY=-s*1.32-stmPh*s*0.65;
      var stmR=s*0.1+stmPh*s*0.18;
      var stmA=Math.max(0,0.6*(1-stmPh));
      var stmX=ctx2+Math.sin(stmPh*4+stm2)*s*0.08;
      // Multiple overlapping puffs per cloud
      for(var puff=0;puff<3;puff++){
        var puffX=stmX+(puff-1)*stmR*0.4;
        var puffR=stmR*(0.7+puff*0.2);
        ctx.fillStyle='rgba(230,240,250,'+stmA*0.7+')';
        ctx.beginPath(); ctx.arc(puffX,stmY+puff*stmR*0.2,puffR,0,Math.PI*2); ctx.fill();
      }
    }
  }

  // === REACTOR DOME ===
  var domGrad2=ctx.createRadialGradient(-s*0.04,-s*1.05,0,0,-s*0.96,s*0.36);
  domGrad2.addColorStop(0,'#d5dbdb'); domGrad2.addColorStop(0.4,'#aab7b8'); domGrad2.addColorStop(1,'#7f8c8d');
  ctx.fillStyle=domGrad2;
  ctx.beginPath(); ctx.arc(0,-s*0.9,s*0.36,Math.PI,0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle='#626567'; ctx.lineWidth=2; ctx.stroke();

  // Dome ribs
  ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=1.5;
  for(var rib2=0;rib2<9;rib2++){
    var ribA2=Math.PI+rib2*Math.PI/8;
    var ribX=Math.cos(ribA2)*s*0.36;
    var ribY=-s*0.9+Math.sin(ribA2)*s*0.36;
    ctx.beginPath(); ctx.moveTo(ribX,ribY); ctx.lineTo(0,-s*1.26); ctx.stroke();
  }

  // Containment ring at base
  ctx.strokeStyle='#7f8c8d'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.arc(0,-s*0.9,s*0.36,Math.PI,0); ctx.stroke();

  // === ATOM SYMBOL ON DOME (animated) ===
  for(var orb2=0;orb2<3;orb2++){
    ctx.save(); ctx.translate(0,-s*0.9); ctx.rotate(orb2*Math.PI/3+t*0.025);
    ctx.strokeStyle='rgba(0,255,120,'+(0.4+0.2*Math.sin(t*0.08+orb2))+')'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.ellipse(0,0,s*0.22,s*0.08,0,0,Math.PI*2); ctx.stroke();
    // Electron
    var elAngle=t*0.025+orb2*Math.PI*2/3;
    ctx.fillStyle='rgba(100,255,160,0.85)';
    ctx.beginPath(); ctx.arc(Math.cos(elAngle)*s*0.22,Math.sin(elAngle)*s*0.08,s*0.018,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
  // Nucleus glow
  var nucGlow2=ctx.createRadialGradient(0,-s*0.9,0,0,-s*0.9,s*0.08);
  nucGlow2.addColorStop(0,'rgba(0,255,120,0.9)'); nucGlow2.addColorStop(1,'rgba(0,255,80,0)');
  ctx.fillStyle=nucGlow2; ctx.beginPath(); ctx.arc(0,-s*0.9,s*0.08,0,Math.PI*2); ctx.fill();
  // Core glow pulsing
  var coreGlow=ctx.createRadialGradient(0,-s*0.9,0,0,-s*0.9,s*0.36);
  coreGlow.addColorStop(0,'rgba(0,255,100,'+(0.08+0.06*Math.sin(t*0.06))+')');
  coreGlow.addColorStop(1,'rgba(0,255,100,0)');
  ctx.fillStyle=coreGlow; ctx.beginPath(); ctx.arc(0,-s*0.9,s*0.36,0,Math.PI*2); ctx.fill();

  // === CONTROL ROOM (side building) ===
  var crGrad=ctx.createLinearGradient(s*0.28,-s*0.62,s*0.56,-s*0.12);
  crGrad.addColorStop(0,'#b0bec5'); crGrad.addColorStop(1,'#90a4ae');
  ctx.fillStyle=crGrad; ctx.fillRect(s*0.28,-s*0.55,s*0.28,s*0.43);
  // Control room windows
  for(var crw=0;crw<6;crw++){
    ctx.fillStyle='rgba(0,220,150,'+(0.4+0.4*Math.sin(t*0.1+crw))+')';
    ctx.fillRect(s*0.31+(crw%3)*s*0.08,-s*(0.5-Math.floor(crw/3)*0.16),s*0.06,s*0.1);
  }

  // === TRANSFORMER YARD ===
  ctx.save(); ctx.translate(-s*0.75,-s*0.35);
  for(var tr4=0;tr4<3;tr4++){
    ctx.fillStyle='#8a9aa8'; ctx.fillRect(tr4*s*0.14-s*0.06,-s*0.24,s*0.1,s*0.24);
    ctx.fillStyle='#6a8088'; ctx.fillRect(tr4*s*0.14-s*0.08,-s*0.26,s*0.14,s*0.04);
    // Insulator caps
    for(var ins=0;ins<3;ins++){
      ctx.fillStyle='#c0c8d0'; ctx.beginPath(); ctx.arc(tr4*s*0.14,-(ins+0.5)*s*0.08,s*0.02,0,Math.PI*2); ctx.fill();
    }
    // HV wires
    if(tr4<2){
      ctx.strokeStyle='rgba(200,200,200,0.5)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(tr4*s*0.14,-s*0.24); ctx.quadraticCurveTo(tr4*s*0.14+s*0.07,-s*0.28,tr4*s*0.14+s*0.14,-s*0.24); ctx.stroke();
    }
  }
  ctx.restore();

  // === HAZMAT SIGNS ===
  for(var haz=0;haz<3;haz++){
    var hazX=[-s*0.88,0,s*0.88][haz];
    var hazY=-s*0.75;
    ctx.fillStyle='#f39c12'; ctx.beginPath(); ctx.arc(hazX,hazY,s*0.065,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#1a1a1a'; ctx.font=Math.round(s*0.08)+'px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('☢',hazX,hazY);
  }

  // === POWER LINES (animated arcs) ===
  if(level>=2){
    for(var pl2=0;pl2<5;pl2++){
      var plPh=(t*0.04+pl2*0.4)%(Math.PI*2);
      var plX=Math.cos(plPh)*s*0.7;
      var plY=-s*0.6+Math.sin(plPh)*s*0.25;
      var plA=0.5+0.5*Math.sin(t*0.12+pl2);
      ctx.globalAlpha=plA;
      ctx.font=Math.round(s*0.12)+'px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('⚡',plX,plY);
      ctx.globalAlpha=1;
    }
  }

  // === FACILITY PERIMETER FENCE (partial) ===
  ctx.strokeStyle='rgba(100,120,100,0.5)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(-s*1.0,-s*0.08); ctx.lineTo(-s*1.0,-s*0.3); ctx.lineTo(s*1.0,-s*0.3); ctx.lineTo(s*1.0,-s*0.08); ctx.stroke();
};


// Color helpers for cars
function _lightenColor(hex, amt) {
  try {
    var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    r = Math.min(255, Math.round(r + (255-r)*amt));
    g = Math.min(255, Math.round(g + (255-g)*amt));
    b = Math.min(255, Math.round(b + (255-b)*amt));
    return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0');
  } catch(e) { return hex; }
}
function _darkenColor(hex, amt) {
  try {
    var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    r = Math.max(0, Math.round(r * (1-amt)));
    g = Math.max(0, Math.round(g * (1-amt)));
    b = Math.max(0, Math.round(b * (1-amt)));
    return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0');
  } catch(e) { return hex; }
}


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
