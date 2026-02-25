// ============================================================
//  GameRenderer — 2.5D Isometric renderer (pure Canvas 2D)
// ============================================================

var GameRenderer = function(canvas, viewport) {
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  this.viewport = viewport;

  this.gridSize = 40;
  this.tileW = 96;
  this.tileH = 48;
  this.tileDepth = 20;
  this.camera = { x: 0, y: 0 };
  this.zoom = 1;
  this.minZoom = 0.2;
  this.maxZoom = 2.5;

  this.buildings = [];
  this.unlockedTiles = {};
  this.selectedTile = null;
  this.placingBuilding = null;
  this.hoverTile = null;
  this.readyBuildings = {};
  this.buildingTypeConfig = {};
  this.onTileClickCallback = null;
  this.threats = [];

  this.isDragging = false;
  this.wasDragging = false;
  this.dragStart = { x: 0, y: 0 };
  this.cameraStart = { x: 0, y: 0 };
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

GameRenderer.prototype._buildTerrain = function() {
  this.terrainMap = {};
  var gs = this.gridSize;
  for (var x = 0; x < gs; x++) {
    for (var y = 0; y < gs; y++) {
      var hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      var r = hash % 100;
      var type = r < 55 ? 0 : r < 75 ? 1 : r < 85 ? 2 : r < 93 ? 3 : 4;
      this.terrainMap[x + ',' + y] = type;
    }
  }
};

GameRenderer.prototype.gridToScreen = function(gx, gy) {
  return {
    x: (gx - gy) * this.tileW / 2,
    y: (gx + gy) * this.tileH / 2
  };
};

GameRenderer.prototype.screenToGrid = function(sx, sy) {
  var tw = this.tileW, th = this.tileH;
  var gx = (sx / (tw / 2) + sy / (th / 2)) / 2;
  var gy = (sy / (th / 2) - sx / (tw / 2)) / 2;
  return { x: Math.floor(gx), y: Math.floor(gy) };
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
  var sc = this.gridToScreen(center, center);
  this.camera.x = sc.x - this.canvasWidth / 2 / this.zoom;
  this.camera.y = sc.y - this.canvasHeight / 2 / this.zoom;
};

GameRenderer.prototype.setupEvents = function() {
  var self = this;

  this.viewport.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    self.isDragging = true; self.wasDragging = false;
    self.dragStart = { x: e.clientX, y: e.clientY };
    self.cameraStart = { x: self.camera.x, y: self.camera.y };
  });
  window.addEventListener('mousemove', function(e) {
    if (self.isDragging) {
      var dx = e.clientX - self.dragStart.x, dy = e.clientY - self.dragStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) self.wasDragging = true;
      self.camera.x = self.cameraStart.x - dx / self.zoom;
      self.camera.y = self.cameraStart.y - dy / self.zoom;
    }
    var rect = self.viewport.getBoundingClientRect();
    self.hoverTile = self.screenToGrid((e.clientX-rect.left)/self.zoom+self.camera.x, (e.clientY-rect.top)/self.zoom+self.camera.y);
  });
  window.addEventListener('mouseup', function(e) {
    if (!self.isDragging) return;
    self.isDragging = false;
    if (!self.wasDragging) {
      var rect = self.viewport.getBoundingClientRect();
      var g = self.screenToGrid((e.clientX-rect.left)/self.zoom+self.camera.x, (e.clientY-rect.top)/self.zoom+self.camera.y);
      if (g.x >= 0 && g.x < self.gridSize && g.y >= 0 && g.y < self.gridSize)
        if (self.onTileClickCallback) self.onTileClickCallback(g.x, g.y);
    }
  });
  this.viewport.addEventListener('wheel', function(e) {
    e.preventDefault();
    self.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 0.91);
  }, { passive: false });

  this.viewport.addEventListener('touchstart', function(e) {
    self.activeTouches = e.touches.length;
    if (e.touches.length === 1) {
      self.isDragging = true; self.wasDragging = false;
      self.dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      self.cameraStart = { x: self.camera.x, y: self.camera.y };
    } else if (e.touches.length === 2) {
      self.lastTouchDist = self.getTouchDist(e.touches[0], e.touches[1]);
      self.wasDragging = true;
    }
  }, { passive: true });
  this.viewport.addEventListener('touchmove', function(e) {
    e.preventDefault();
    var t = e.touches;
    if (t.length === 1) {
      var dx = t[0].clientX - self.dragStart.x, dy = t[0].clientY - self.dragStart.y;
      if (Math.abs(dx)>3||Math.abs(dy)>3) self.wasDragging = true;
      self.camera.x = self.cameraStart.x - dx/self.zoom;
      self.camera.y = self.cameraStart.y - dy/self.zoom;
    } else if (t.length === 2) {
      self.wasDragging = true;
      var dist = self.getTouchDist(t[0],t[1]), mid = self.getTouchMid(t[0],t[1]);
      if (self.lastTouchDist > 0) {
        var sc = dist/self.lastTouchDist, nz = Math.max(self.minZoom,Math.min(self.maxZoom,self.zoom*sc));
        var rect = self.viewport.getBoundingClientRect();
        var mx = mid.x-rect.left, my = mid.y-rect.top;
        var wx = mx/self.zoom+self.camera.x, wy = my/self.zoom+self.camera.y;
        self.zoom = nz; self.camera.x = wx-mx/nz; self.camera.y = wy-my/nz;
      }
      self.lastTouchDist = dist;
    }
  }, { passive: false });
  this.viewport.addEventListener('touchend', function(e) {
    var wasDrag = self.wasDragging, tc = self.activeTouches;
    if (e.touches.length === 0) {
      self.isDragging = false; self.activeTouches = 0; self.lastTouchDist = 0;
      if (!wasDrag && tc===1 && e.changedTouches.length===1) {
        var touch = e.changedTouches[0], rect = self.viewport.getBoundingClientRect();
        var g = self.screenToGrid((touch.clientX-rect.left)/self.zoom+self.camera.x,(touch.clientY-rect.top)/self.zoom+self.camera.y);
        if (g.x>=0&&g.x<self.gridSize&&g.y>=0&&g.y<self.gridSize)
          if (self.onTileClickCallback) self.onTileClickCallback(g.x,g.y);
      }
    } else {
      self.activeTouches = e.touches.length;
      if (e.touches.length===1) {
        self.isDragging = true;
        self.dragStart = {x:e.touches[0].clientX,y:e.touches[0].clientY};
        self.cameraStart = {x:self.camera.x,y:self.camera.y};
      }
    }
  }, { passive: true });
  window.addEventListener('resize', function(){ self.resize(); });
};

GameRenderer.prototype.getTouchDist = function(t1,t2){ var dx=t1.clientX-t2.clientX,dy=t1.clientY-t2.clientY; return Math.sqrt(dx*dx+dy*dy); };
GameRenderer.prototype.getTouchMid  = function(t1,t2){ return {x:(t1.clientX+t2.clientX)/2,y:(t1.clientY+t2.clientY)/2}; };
GameRenderer.prototype.zoomAt = function(sx,sy,f){ var rect=this.viewport.getBoundingClientRect(),mx=sx-rect.left,my=sy-rect.top,wx=mx/this.zoom+this.camera.x,wy=my/this.zoom+this.camera.y; this.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.zoom*f)); this.camera.x=wx-mx/this.zoom; this.camera.y=wy-my/this.zoom; };

GameRenderer.prototype.setBuildings    = function(b,c){ this.buildings=b||[]; this.buildingTypeConfig=c||{}; };
GameRenderer.prototype.setUnlockedTiles= function(t){ this.unlockedTiles=t||{}; };
GameRenderer.prototype.setReadyBuildings=function(r){ this.readyBuildings=r||{}; };
GameRenderer.prototype.setThreats     = function(t){ this.threats=t||[]; };

// ─── MAIN RENDER ───────────────────────────────────────────
GameRenderer.prototype.render = function() {
  var ctx = this.ctx, cam = this.camera, z = this.zoom, w = this.canvasWidth, h = this.canvasHeight, tick = this._tick;

  var sky = ctx.createLinearGradient(0,0,0,h);
  sky.addColorStop(0,'#0d1b2a'); sky.addColorStop(1,'#1a2f1a');
  ctx.fillStyle = sky; ctx.fillRect(0,0,w,h);

  ctx.save();
  ctx.scale(z,z);
  ctx.translate(-cam.x,-cam.y);

  var margin = 4;
  var tl = this.screenToGrid(cam.x - this.tileW*2, cam.y - this.tileH*4);
  var br = this.screenToGrid(cam.x + w/z + this.tileW*2, cam.y + h/z + this.tileH*6);
  var x0=Math.max(0,tl.x-margin), y0=Math.max(0,tl.y-margin);
  var x1=Math.min(this.gridSize-1,br.x+margin), y1=Math.min(this.gridSize-1,br.y+margin);

  var drawList = [];
  for (var gx=x0; gx<=x1; gx++) for (var gy=y0; gy<=y1; gy++)
    drawList.push({type:'tile',gx:gx,gy:gy,order:gx+gy});
  for (var i=0; i<this.buildings.length; i++) {
    var b=this.buildings[i];
    if (b.x<x0||b.x>x1||b.y<y0||b.y>y1) continue;
    drawList.push({type:'building',b:b,gx:b.x,gy:b.y,order:b.x+b.y+0.5});
  }
  for (var ti=0; ti<this.threats.length; ti++) {
    var th=this.threats[ti];
    drawList.push({type:'threat',th:th,gx:Math.floor(th.x),gy:Math.floor(th.y),order:Math.floor(th.x)+Math.floor(th.y)+0.4});
  }
  drawList.sort(function(a,b){ return a.order!==b.order?a.order-b.order:a.gy-b.gy; });

  for (var di=0; di<drawList.length; di++) {
    var item=drawList[di];
    if (item.type==='tile') this._drawTile(ctx,item.gx,item.gy,tick);
    else if (item.type==='building') this._drawBuilding(ctx,item.b,tick);
    else if (item.type==='threat') this._drawThreat(ctx,item.th,tick);
  }

  if (this.placingBuilding && this.hoverTile) {
    var hx=this.hoverTile.x, hy=this.hoverTile.y;
    if (hx>=0&&hx<this.gridSize&&hy>=0&&hy<this.gridSize) {
      var hKey=hx+','+hy, canPlace=!!this.unlockedTiles[hKey];
      for (var bi=0; bi<this.buildings.length; bi++) if (this.buildings[bi].x===hx&&this.buildings[bi].y===hy){canPlace=false;break;}
      this._drawPlacingPreview(ctx,hx,hy,canPlace,tick);
    }
  }
  if (this.selectedTile) this._drawSelectionRing(ctx,this.selectedTile.x,this.selectedTile.y,tick);

  ctx.restore();
};

// ─── ISO PATH ─────────────────────────────────────────────
GameRenderer.prototype._isoPath = function(ctx,sx,sy) {
  var tw=this.tileW, th=this.tileH;
  ctx.beginPath();
  ctx.moveTo(sx+tw/2, sy);
  ctx.lineTo(sx+tw,   sy+th/2);
  ctx.lineTo(sx+tw/2, sy+th);
  ctx.lineTo(sx,      sy+th/2);
  ctx.closePath();
};

// ─── DRAW TILE ────────────────────────────────────────────
GameRenderer.prototype._drawTile = function(ctx,gx,gy,tick) {
  var sc=this.gridToScreen(gx,gy), sx=sc.x, sy=sc.y;
  var tw=this.tileW, th=this.tileH, td=this.tileDepth;
  var key=gx+','+gy, isUnlocked=!!this.unlockedTiles[key];

  if (!isUnlocked) {
    this._isoPath(ctx,sx,sy); ctx.fillStyle='#0c1118'; ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.lineWidth=0.5; ctx.stroke();
    var hasAdj=this.unlockedTiles[(gx-1)+','+gy]||this.unlockedTiles[(gx+1)+','+gy]||
               this.unlockedTiles[gx+','+(gy-1)]||this.unlockedTiles[gx+','+(gy+1)];
    if (hasAdj) {
      this._isoPath(ctx,sx,sy); ctx.fillStyle='rgba(255,255,255,0.05)'; ctx.fill();
      ctx.font='12px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillStyle='rgba(255,255,255,0.2)';
      ctx.fillText('🔒',sx+tw/2,sy+th/2);
    }
    return;
  }

  var ter=this.terrainMap[key]||0;
  var topColors=[['#3d7a47','#2d6135'],['#2a5c2e','#1f4822'],['#3d7a47','#4e9459'],['#505a68','#3d4756'],['#2d7a8c','#1e5a6e']];
  var tc=topColors[ter];

  // top diamond
  var tg=ctx.createLinearGradient(sx+tw/2,sy,sx+tw/2,sy+th);
  tg.addColorStop(0,tc[0]); tg.addColorStop(1,tc[1]);
  this._isoPath(ctx,sx,sy); ctx.fillStyle=tg; ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,0.12)'; ctx.lineWidth=0.5; ctx.stroke();

  // 2.5D sides
  if (td>0) {
    // left side
    ctx.beginPath();
    ctx.moveTo(sx,sy+th/2); ctx.lineTo(sx+tw/2,sy+th); ctx.lineTo(sx+tw/2,sy+th+td); ctx.lineTo(sx,sy+th/2+td); ctx.closePath();
    ctx.fillStyle=this._darken(tc[1],0.72); ctx.fill();
    // right side
    ctx.beginPath();
    ctx.moveTo(sx+tw/2,sy+th); ctx.lineTo(sx+tw,sy+th/2); ctx.lineTo(sx+tw,sy+th/2+td); ctx.lineTo(sx+tw/2,sy+th+td); ctx.closePath();
    ctx.fillStyle=this._darken(tc[1],0.55); ctx.fill();
  }

  // terrain details
  if (ter===2) {
    ctx.font='9px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(((gx*53+gy*37)%2===0)?'🌸':'🌼', sx+tw*0.5, sy+th*0.45);
  } else if (ter===3) {
    ctx.fillStyle='rgba(120,130,145,0.5)';
    ctx.beginPath(); ctx.ellipse(sx+tw*0.46,sy+th*0.52,5,3,0,0,Math.PI*2); ctx.fill();
  } else if (ter===0) {
    var gh=(gx*41+gy*23)%30;
    if (gh<7) {
      ctx.strokeStyle='rgba(120,220,120,0.32)'; ctx.lineWidth=1;
      var gx2=sx+tw*0.4+gh*2, gy2=sy+th*0.5;
      ctx.beginPath(); ctx.moveTo(gx2,gy2); ctx.lineTo(gx2-2,gy2-6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx2+5,gy2); ctx.lineTo(gx2+4,gy2-5); ctx.stroke();
    }
  } else if (ter===4) {
    // water sparkle
    var ws=(tick*0.04+(gx+gy)*0.5)%1;
    ctx.strokeStyle='rgba(130,220,255,'+(0.3+ws*0.4)+')'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(sx+tw*0.35,sy+th*0.48); ctx.lineTo(sx+tw*0.46,sy+th*0.44); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx+tw*0.54,sy+th*0.56); ctx.lineTo(sx+tw*0.65,sy+th*0.52); ctx.stroke();
  }

  if (this.hoverTile&&this.hoverTile.x===gx&&this.hoverTile.y===gy) {
    this._isoPath(ctx,sx,sy); ctx.fillStyle='rgba(255,255,255,0.07)'; ctx.fill();
  }
};

GameRenderer.prototype._darken = function(hex,f) {
  var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return 'rgb('+Math.round(r*f)+','+Math.round(g*f)+','+Math.round(b*f)+')';
};
GameRenderer.prototype._lighten = function(hex,f) { return this._darken(hex,f); };

// ─── DRAW BUILDING ────────────────────────────────────────
GameRenderer.prototype._drawBuilding = function(ctx,b,tick) {
  var sc=this.gridToScreen(b.x,b.y), sx=sc.x, sy=sc.y;
  var tw=this.tileW, th=this.tileH;
  var cx=sx+tw/2;
  var readyKey=b.x+','+b.y, isReady=!!this.readyBuildings[readyKey];
  var isSelected=this.selectedTile&&this.selectedTile.x===b.x&&this.selectedTile.y===b.y;

  if (isReady) {
    var pulse=0.5+0.5*Math.sin(tick*0.08);
    ctx.strokeStyle='rgba(85,239,196,'+(0.5+pulse*0.5)+')'; ctx.lineWidth=2+pulse;
    this._isoPath(ctx,sx,sy-2); ctx.stroke();
  }

  ctx.save();
  ctx.translate(cx, sy+4);
  this._drawBuildingSprite(ctx, b.type, b.level, tw, th, tick);
  ctx.restore();

  // level badge
  ctx.fillStyle='rgba(0,0,0,0.78)';
  ctx.beginPath(); ctx.roundRect(cx+16,sy+th-6,24,14,4); ctx.fill();
  ctx.fillStyle='#55efc4'; ctx.font='bold 9px Inter,Arial,sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Ур.'+b.level, cx+28, sy+th+1);

  if (isReady) { ctx.font='13px Arial'; ctx.textAlign='center'; ctx.fillText('✅',cx-tw*0.28,sy+2); }
  if (isSelected) this._drawSelectionRing(ctx,b.x,b.y,tick);
};

// ─── BUILDING SPRITES ─────────────────────────────────────
GameRenderer.prototype._drawBuildingSprite = function(ctx,type,level,tw,th,tick) {
  var s=Math.min(tw,th*2.2)*0.72;
  s=Math.min(s*(1+(level-1)*0.04), s*1.6);
  ctx.save();
  switch(type){
    case 'farm':       this._spriteFarm(ctx,s,level,tick);break;
    case 'house':      this._spriteHouse(ctx,s,level,tick);break;
    case 'quarry':     this._spriteQuarry(ctx,s,level,tick);break;
    case 'factory':    this._spriteFactory(ctx,s,level,tick);break;
    case 'powerplant': this._spritePowerplant(ctx,s,level,tick);break;
    case 'warehouse':  this._spriteWarehouse(ctx,s,level,tick);break;
    case 'market':     this._spriteMarket(ctx,s,level,tick);break;
    case 'garden':     this._spriteGarden(ctx,s,level,tick);break;
    case 'school':     this._spriteSchool(ctx,s,level,tick);break;
    case 'bakery':     this._spriteBakery(ctx,s,level,tick);break;
    case 'park':       this._spritePark(ctx,s,level,tick);break;
    case 'bank':       this._spriteBank(ctx,s,level,tick);break;
    case 'hospital':   this._spriteHospital(ctx,s,level,tick);break;
    case 'library':    this._spriteLibrary(ctx,s,level,tick);break;
    case 'stadium':    this._spriteStadium(ctx,s,level,tick);break;
    case 'crystalmine':this._spriteCrystalMine(ctx,s,level,tick);break;
    case 'arcanetower':this._spriteArcaneTower(ctx,s,level,tick);break;
    default:           this._spriteDefault(ctx,s,tick);
  }
  ctx.restore();
};

GameRenderer.prototype._box2d = function(ctx,x,y,w,h,topC,frontC,sideC) {
  var d=w*0.18;
  ctx.fillStyle=topC; ctx.fillRect(x,y-d,w,d);
  ctx.fillStyle=frontC; ctx.fillRect(x,y,w,h);
  ctx.beginPath(); ctx.moveTo(x+w,y-d); ctx.lineTo(x+w+d*0.5,y-d*0.5); ctx.lineTo(x+w+d*0.5,y+h-d*0.5); ctx.lineTo(x+w,y+h); ctx.closePath();
  ctx.fillStyle=sideC; ctx.fill();
};

GameRenderer.prototype._spriteFarm = function(ctx,s,level,tick) {
  ctx.fillStyle='#5c3317'; ctx.fillRect(-s*.48,-s*.08,s*.96,s*.12);
  var rows=Math.min(3+Math.floor(level/3),7);
  for(var r=0;r<rows;r++){
    var rx=-s*.44+r*(s*.88/(rows-1||1)), grow=.5+.5*Math.sin(tick*.03+r*.9);
    ctx.strokeStyle='#4a9e4a'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(rx,-s*.06); ctx.lineTo(rx,-s*.06-s*.32*grow); ctx.stroke();
    ctx.fillStyle='#e8b740'; ctx.beginPath(); ctx.ellipse(rx,-s*.06-s*.32*grow-3,3,5,0,0,Math.PI*2); ctx.fill();
  }
  this._box2d(ctx,-s*.18,-s*.22,s*.38,s*.2,'#a0522d','#8b4513','#6b3410');
  ctx.fillStyle='#c0392b'; ctx.beginPath(); ctx.moveTo(-s*.2,-s*.22); ctx.lineTo(0,-s*.46); ctx.lineTo(s*.2,-s*.22); ctx.closePath(); ctx.fill();
};

GameRenderer.prototype._spriteHouse = function(ctx,s,level,tick) {
  var floors=Math.min(1+Math.floor(level/7),4);
  var fh=s*.24;
  for(var f=0;f<floors;f++){
    var fy=-f*fh;
    var wc=['#d4a97a','#c8885e','#d4a97a','#c8885e'][f%4];
    this._box2d(ctx,-s*.38,fy-fh,s*.76,fh,this._lightenStr(wc),wc,this._darkenStr(wc,.75));
    ctx.fillStyle='rgba(200,235,255,.75)';
    ctx.fillRect(-s*.24,fy-fh+3,s*.15,s*.13); ctx.fillRect(s*.07,fy-fh+3,s*.15,s*.13);
  }
  ctx.fillStyle='#8b1a1a'; ctx.beginPath();
  ctx.moveTo(-s*.42,-floors*fh); ctx.lineTo(0,-floors*fh-s*.3); ctx.lineTo(s*.42,-floors*fh); ctx.closePath(); ctx.fill();
  ctx.fillStyle='#6d4c41'; ctx.fillRect(s*.1,-floors*fh-s*.32,s*.09,s*.2);
  var smk=(tick*.5)%32;
  ctx.strokeStyle='rgba(200,200,200,'+(0.6-smk/55)+')'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.arc(s*.145,-floors*fh-s*.32-smk*.5,smk*.25,0,Math.PI*2); ctx.stroke();
};

GameRenderer.prototype._darkenStr = function(hex,f) {
  try{var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return 'rgb('+Math.round(r*f)+','+Math.round(g*f)+','+Math.round(b*f)+')';}catch(e){return hex;}
};
GameRenderer.prototype._lightenStr = function(hex) {
  try{var r=Math.min(255,parseInt(hex.slice(1,3),16)*1.2),g=Math.min(255,parseInt(hex.slice(3,5),16)*1.2),b=Math.min(255,parseInt(hex.slice(5,7),16)*1.2); return 'rgb('+Math.round(r)+','+Math.round(g)+','+Math.round(b)+')';}catch(e){return hex;}
};

GameRenderer.prototype._spriteQuarry = function(ctx,s,level,tick) {
  ctx.fillStyle='#6b7280'; ctx.beginPath(); ctx.ellipse(0,0,s*.44,s*.18,0,0,Math.PI*2); ctx.fill();
  [[-.15,-.28,.17,.21],[-.04,-.43,.13,.17],[.1,-.31,.15,.2]].forEach(function(r){
    ctx.fillStyle='#9ca3af'; ctx.beginPath(); ctx.ellipse(s*r[0],s*r[1],s*r[2],s*r[3],r[0]*.5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#d1d5db'; ctx.beginPath(); ctx.ellipse(s*r[0]-2,s*r[1]-2,s*r[2]*.35,s*r[3]*.28,0,0,Math.PI*2); ctx.fill();
  });
  var sw=Math.sin(tick*.12)*.35;
  ctx.save(); ctx.translate(s*.2,-s*.35); ctx.rotate(sw);
  ctx.strokeStyle='#92400e'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,s*.22); ctx.stroke();
  ctx.fillStyle='#718096'; ctx.fillRect(-4,0,8,6);
  ctx.restore();
};

GameRenderer.prototype._spriteFactory = function(ctx,s,level,tick) {
  this._box2d(ctx,-s*.42,-s*.52,s*.84,s*.52,'#94a3b8','#64748b','#475569');
  var nc=Math.min(2+Math.floor(level/4),5);
  for(var ci=0;ci<nc;ci++){
    var cx2=-s*.34+ci*(s*.68/(nc-1||1));
    ctx.fillStyle='#4b5563'; ctx.fillRect(cx2-4,-s*.72,8,s*.22);
    var off=(tick*.8+ci*15)%40;
    ctx.strokeStyle='rgba(180,180,180,'+(0.6-off/60)+')'; ctx.lineWidth=4-off/15;
    ctx.beginPath(); ctx.moveTo(cx2,-s*.72); ctx.bezierCurveTo(cx2+6,-s*.72-off*.4,cx2-4,-s*.72-off*.6,cx2,-s*.72-off*.8); ctx.stroke();
  }
  ctx.fillStyle='rgba(255,200,50,.6)';
  for(var wi=0;wi<3;wi++) ctx.fillRect(-s*.32+wi*s*.24,-s*.44,s*.13,s*.13);
};

GameRenderer.prototype._spritePowerplant = function(ctx,s,level,tick) {
  ctx.fillStyle='#94a3b8'; ctx.beginPath();
  ctx.moveTo(-s*.28,0); ctx.quadraticCurveTo(-s*.4,-s*.3,-s*.2,-s*.62); ctx.lineTo(s*.2,-s*.62);
  ctx.quadraticCurveTo(s*.4,-s*.3,s*.28,0); ctx.closePath(); ctx.fill();
  var st=(tick*.6)%35;
  ctx.strokeStyle='rgba(230,230,230,'+(0.55-st/64)+')'; ctx.lineWidth=5+st*.08;
  ctx.beginPath(); ctx.arc(0,-s*.62-st*.4,st*.22,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle='#fbbf24'; ctx.beginPath();
  ctx.moveTo(s*.04,-s*.46); ctx.lineTo(-s*.04,-s*.28); ctx.lineTo(s*.02,-s*.28); ctx.lineTo(-s*.05,-s*.1); ctx.lineTo(s*.1,-s*.3); ctx.lineTo(s*.02,-s*.3); ctx.closePath(); ctx.fill();
};

GameRenderer.prototype._spriteWarehouse = function(ctx,s,level,tick) {
  this._box2d(ctx,-s*.48,-s*.4,s*.96,s*.4,'#b45309','#92400e','#78350f');
  ctx.fillStyle='#6b7280'; ctx.beginPath(); ctx.ellipse(0,-s*.4,s*.5,s*.22,0,Math.PI,0); ctx.fill();
  ctx.fillStyle='#451a03'; ctx.beginPath(); ctx.arc(0,-s*.14,s*.16,Math.PI,0); ctx.rect(-s*.16,-s*.14,s*.32,s*.14); ctx.fill();
};

GameRenderer.prototype._spriteMarket = function(ctx,s,level,tick) {
  this._box2d(ctx,-s*.4,-s*.44,s*.8,s*.44,'#fde68a','#fbbf24','#f59e0b');
  ctx.fillStyle='#dc2626'; ctx.beginPath(); ctx.moveTo(-s*.44,-s*.44);
  for(var aw=0;aw<5;aw++){var awx=-s*.44+aw*s*.88/4; ctx.lineTo(awx+s*.1,-s*.52); ctx.lineTo(awx+s*.22,-s*.44);}
  ctx.closePath(); ctx.fill();
  ctx.font='10px Arial'; ctx.textAlign='center';
  ctx.fillText('🍎',-s*.18,-s*.22+Math.sin(tick*.05)*2);
  ctx.fillText('🥕',s*.1,-s*.22+Math.sin(tick*.05+1)*2);
};

GameRenderer.prototype._spriteGarden = function(ctx,s,level,tick) {
  for(var f2=-3;f2<=3;f2++){ctx.fillStyle='#d4a574'; ctx.fillRect(f2*s*.13-2,-s*.12,4,s*.16);}
  ctx.fillStyle='#d4a574'; ctx.fillRect(-s*.42,-s*.06,s*.84,3);
  var nt=Math.min(1+Math.floor(level/3),5);
  for(var t=0;t<nt;t++){
    var tx=-s*.28+t*(s*.56/(nt-1||1)), sway=Math.sin(tick*.04+t)*2;
    ctx.fillStyle='#166534'; ctx.beginPath(); ctx.arc(tx+sway,-s*.38,s*.13,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#15803d'; ctx.beginPath(); ctx.arc(tx+sway,-s*.5,s*.1,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#8b5cf6'; ctx.beginPath(); ctx.arc(tx+sway,-s*.58,s*.07,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#92400e'; ctx.fillRect(tx-2,-s*.26,4,s*.14);
  }
};

GameRenderer.prototype._spriteSchool = function(ctx,s,level,tick) {
  this._box2d(ctx,-s*.44,-s*.56,s*.88,s*.56,'#fef9c3','#fef3c7','#fde68a');
  ctx.fillStyle='#e5e7eb'; for(var c2=0;c2<4;c2++) ctx.fillRect(-s*.36+c2*s*.24,-s*.5,7,s*.38);
  ctx.strokeStyle='#9ca3af'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(0,-s*.56); ctx.lineTo(0,-s*.84); ctx.stroke();
  var fw=Math.sin(tick*.1)*4;
  ctx.fillStyle='#ef4444'; ctx.beginPath(); ctx.moveTo(0,-s*.84); ctx.lineTo(s*.2+fw,-s*.76); ctx.lineTo(0,-s*.68); ctx.closePath(); ctx.fill();
  ctx.fillStyle='rgba(186,230,253,.8)';
  [[-s*.26,-s*.46],[s*.08,-s*.46],[-s*.26,-s*.32],[s*.08,-s*.32]].forEach(function(w){ctx.fillRect(w[0],w[1],s*.16,s*.1);});
};

GameRenderer.prototype._spriteBakery = function(ctx,s,level,tick) {
  this._box2d(ctx,-s*.34,-s*.46,s*.68,s*.46,'#fde68a','#f59e0b','#d97706');
  ctx.fillStyle='#78350f'; ctx.fillRect(s*.1,-s*.52,s*.1,s*.1);
  var ar=(tick*.5)%26; ctx.strokeStyle='rgba(255,190,80,'+(0.8-ar/26)+')'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(s*.15,-s*.52-ar*.38,ar*.2,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle='#7c2d12'; ctx.fillRect(-s*.22,-s*.58,s*.44,s*.1);
  ctx.fillStyle='#fef3c7'; ctx.font='bold 7px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('ПЕКАРНЯ',0,-s*.53);
};

GameRenderer.prototype._spritePark = function(ctx,s,level,tick) {
  ctx.fillStyle='#0ea5e9'; ctx.beginPath(); ctx.ellipse(0,-s*.08,s*.22,s*.1,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#38bdf8'; ctx.lineWidth=1; ctx.beginPath(); ctx.ellipse(0,-s*.08,s*.22,s*.1,0,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle='#d4a574'; ctx.fillRect(-3,-s*.2,6,s*.36); ctx.fillRect(-s*.34,-3,s*.68,6);
  [[-s*.3,-s*.38],[s*.3,-s*.38],[-s*.3,s*.1],[s*.3,s*.1]].forEach(function(t,i){
    var sw=Math.sin(tick*.04+i)*2;
    ctx.fillStyle='#166534'; ctx.beginPath(); ctx.arc(t[0]+sw,t[1],s*.13,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#92400e'; ctx.fillRect(t[0]-2,t[1]+s*.11,4,s*.11);
  });
  var ang=tick*.02;
  ctx.strokeStyle='#6b7280'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,-s*.55,s*.18,0,Math.PI*2); ctx.stroke();
  for(var sp=0;sp<6;sp++){
    var a=ang+sp*Math.PI/3;
    ctx.beginPath(); ctx.moveTo(0,-s*.55); ctx.lineTo(Math.cos(a)*s*.18,-s*.55+Math.sin(a)*s*.18); ctx.stroke();
    ctx.fillStyle='#f87171'; ctx.fillRect(Math.cos(a)*s*.18-3,-s*.55+Math.sin(a)*s*.18-3,6,6);
  }
};

GameRenderer.prototype._spriteBank = function(ctx,s,level,tick) {
  this._box2d(ctx,-s*.44,-s*.66,s*.88,s*.66,'#f8fafc','#e2e8f0','#cbd5e1');
  ctx.fillStyle='#94a3b8'; for(var p2=0;p2<5;p2++) ctx.fillRect(-s*.38+p2*s*.19,-s*.58,7,s*.46);
  ctx.fillStyle='#e2e8f0'; ctx.beginPath(); ctx.moveTo(-s*.46,-s*.66); ctx.lineTo(0,-s*.9); ctx.lineTo(s*.46,-s*.66); ctx.closePath(); ctx.fill();
  var gl=0.7+0.3*Math.sin(tick*.08);
  ctx.fillStyle='rgba(250,204,21,'+gl+')'; ctx.font='bold 18px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('$',0,-s*.38);
};

GameRenderer.prototype._spriteHospital = function(ctx,s,level,tick) {
  this._box2d(ctx,-s*.42,-s*.62,s*.84,s*.62,'#f0fdf4','#dcfce7','#bbf7d0');
  ctx.fillStyle='#ef4444'; ctx.fillRect(-s*.04,-s*.52,s*.08,s*.22); ctx.fillRect(-s*.12,-s*.44,s*.24,s*.08);
  var lo=Math.floor(tick/30)%2===0;
  ctx.fillStyle=lo?'rgba(255,250,150,.9)':'rgba(186,230,253,.7)';
  [[-s*.28,-s*.52],[-s*.28,-s*.38],[s*.16,-s*.52],[s*.16,-s*.38]].forEach(function(w){ctx.fillRect(w[0],w[1],s*.1,s*.1);});
  ctx.strokeStyle='#22c55e'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(0,-s*.66,s*.12,0,Math.PI*2); ctx.stroke();
  ctx.font='bold 10px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#22c55e'; ctx.fillText('H',0,-s*.66);
};

GameRenderer.prototype._spriteLibrary = function(ctx,s,level,tick) {
  this._box2d(ctx,-s*.42,-s*.6,s*.84,s*.6,'#fef3c7','#fde68a','#f59e0b');
  [[-s*.3,-s*.52],[-s*.08,-s*.52],[s*.16,-s*.52]].forEach(function(w){
    ctx.fillStyle='rgba(186,230,253,.8)'; ctx.beginPath(); ctx.arc(w[0]+s*.07,w[1],s*.08,Math.PI,0); ctx.rect(w[0],w[1],s*.14,s*.12); ctx.fill();
  });
  var by2=s*.12*Math.abs(Math.sin(tick*.04));
  ctx.font='12px Arial'; ctx.textAlign='center'; ctx.fillText('📚',0,-s*.7-by2);
};

GameRenderer.prototype._spriteStadium = function(ctx,s,level,tick) {
  ctx.fillStyle='#374151'; ctx.beginPath(); ctx.ellipse(0,-s*.2,s*.46,s*.28,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#4b5563'; ctx.beginPath(); ctx.ellipse(0,-s*.2,s*.35,s*.19,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#15803d'; ctx.beginPath(); ctx.ellipse(0,-s*.2,s*.26,s*.13,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.beginPath(); ctx.ellipse(0,-s*.2,s*.1,s*.06,0,0,Math.PI*2); ctx.stroke();
  [[-s*.44,-s*.56],[s*.44,-s*.56]].forEach(function(l){
    ctx.fillStyle='#9ca3af'; ctx.fillRect(l[0]-2,l[1],4,s*.38);
    var lg=0.6+0.4*Math.sin(tick*.1);
    ctx.fillStyle='rgba(255,250,150,'+lg+')'; ctx.beginPath(); ctx.arc(l[0],l[1],8,0,Math.PI*2); ctx.fill();
  });
  if(Math.floor(tick/20)%3===0){ctx.font='9px Arial'; ctx.textAlign='center'; ctx.fillText('🎉',s*Math.sin(tick*.15)*.2,-s*.5);}
};

GameRenderer.prototype._spriteCrystalMine = function(ctx,s,level,tick) {
  ctx.fillStyle='#374151'; ctx.beginPath(); ctx.arc(0,-s*.22,s*.28,Math.PI,0); ctx.rect(-s*.28,-s*.22,s*.56,s*.22); ctx.fill();
  ctx.fillStyle='#1f2937'; ctx.beginPath(); ctx.arc(0,-s*.22,s*.2,Math.PI,0); ctx.rect(-s*.2,-s*.22,s*.4,s*.2); ctx.fill();
  var cp=0.8+0.2*Math.sin(tick*.1);
  [[-.18,-.52,.09],[-.04,-.65,.12],[.14,-.55,.1]].forEach(function(c,i){
    var pha=tick*.08+i*.8;
    ctx.save(); ctx.translate(s*c[0],s*c[1]); ctx.rotate(Math.sin(pha)*.05);
    ctx.shadowColor='#a78bfa'; ctx.shadowBlur=8*cp;
    ctx.fillStyle='#8b5cf6'; ctx.beginPath(); ctx.moveTo(0,-s*c[2]*1.4); ctx.lineTo(s*c[2]*.5,0); ctx.lineTo(0,s*c[2]*.5); ctx.lineTo(-s*c[2]*.5,0); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#c4b5fd'; ctx.beginPath(); ctx.moveTo(0,-s*c[2]*1.4); ctx.lineTo(s*c[2]*.2,0); ctx.lineTo(0,-s*c[2]*.5); ctx.closePath(); ctx.fill();
    ctx.shadowBlur=0; ctx.restore();
  });
  for(var sp=0;sp<4;sp++){
    var sa=tick*.06+sp*Math.PI/2, sr=s*.3+Math.sin(tick*.1+sp)*s*.05;
    ctx.fillStyle='rgba(196,181,253,.6)'; ctx.beginPath(); ctx.arc(Math.cos(sa)*sr,-s*.35+Math.sin(sa)*sr*.5,2,0,Math.PI*2); ctx.fill();
  }
};

GameRenderer.prototype._spriteArcaneTower = function(ctx,s,level,tick) {
  this._box2d(ctx,-s*.22,-s*.2,s*.44,s*.2,'#4c1d95','#6d28d9','#5b21b6');
  ctx.fillStyle='#7c3aed'; ctx.beginPath();
  ctx.moveTo(-s*.22,-s*.2); ctx.lineTo(-s*.16,-s*.78); ctx.lineTo(s*.16,-s*.78); ctx.lineTo(s*.22,-s*.2); ctx.closePath(); ctx.fill();
  var op=0.5+0.5*Math.sin(tick*.1);
  ctx.shadowColor='#c4b5fd'; ctx.shadowBlur=16*op;
  ctx.fillStyle='#a78bfa'; ctx.beginPath(); ctx.arc(0,-s*.86,s*.12,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#ede9fe'; ctx.beginPath(); ctx.arc(-s*.04,-s*.9,s*.05,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;
  for(var op2=0;op2<3;op2++){
    var oa=tick*.1+op2*Math.PI*2/3;
    ctx.fillStyle='rgba(196,181,253,.85)'; ctx.beginPath(); ctx.arc(Math.cos(oa)*s*.24,-s*.86+Math.sin(oa)*s*.1,3,0,Math.PI*2); ctx.fill();
  }
  ctx.fillStyle='rgba(196,181,253,.5)'; ctx.font='8px Arial'; ctx.textAlign='center';
  ctx.fillText('✦',0,-s*.46); ctx.fillText('✦',0,-s*.62);
};

GameRenderer.prototype._spriteDefault = function(ctx,s,tick) {
  ctx.fillStyle='#6b7280'; ctx.fillRect(-s*.3,-s*.5,s*.6,s*.5);
  ctx.font=Math.round(s*.38)+'px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('❓',0,-s*.25);
};

// ─── THREAT ───────────────────────────────────────────────
GameRenderer.prototype._drawThreat = function(ctx,threat,tick) {
  var sc=this.gridToScreen(threat.x,threat.y), cx=sc.x+this.tileW/2, cy=sc.y+this.tileH/2;
  var bob=Math.sin(tick*.1)*4, pulse=0.7+0.3*Math.sin(tick*.15);
  ctx.fillStyle='rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(cx,cy+4,20,8,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='rgba(239,68,68,'+pulse+')'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.arc(cx,cy-8+bob,26,0,Math.PI*2); ctx.stroke();
  ctx.font='28px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(threat.emoji||'👾',cx,cy-10+bob);
  var bw=42,bh=6,hp=(threat.hp/threat.maxHp)||0;
  ctx.fillStyle='rgba(0,0,0,.7)'; ctx.fillRect(cx-bw/2-1,cy-40+bob,bw+2,bh+2);
  ctx.fillStyle=hp>.5?'#22c55e':hp>.25?'#f59e0b':'#ef4444';
  ctx.fillRect(cx-bw/2,cy-39+bob,bw*hp,bh);
  ctx.fillStyle='rgba(0,0,0,.8)'; ctx.beginPath(); ctx.roundRect(cx-32,cy-54+bob,64,13,4); ctx.fill();
  ctx.fillStyle='#fef2f2'; ctx.font='bold 8px Inter,Arial,sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(threat.name||'Враг',cx,cy-47+bob);
};

// ─── PLACING / SELECTION ─────────────────────────────────
GameRenderer.prototype._drawPlacingPreview = function(ctx,gx,gy,canPlace,tick) {
  var sc=this.gridToScreen(gx,gy), pulse=0.5+0.5*Math.sin(tick*.12);
  this._isoPath(ctx,sc.x,sc.y);
  ctx.fillStyle=canPlace?'rgba(85,239,196,'+(0.2+pulse*.2)+')':'rgba(255,107,107,.3)'; ctx.fill();
  ctx.strokeStyle=canPlace?('rgba(85,239,196,'+(0.7+pulse*.3)+')'):'rgba(255,107,107,.8)'; ctx.lineWidth=2; ctx.stroke();
};
GameRenderer.prototype._drawSelectionRing = function(ctx,gx,gy,tick) {
  var sc=this.gridToScreen(gx,gy), pulse=0.5+0.5*Math.sin(tick*.1);
  ctx.strokeStyle='rgba(85,239,196,'+(0.6+pulse*.4)+')'; ctx.lineWidth=2+pulse;
  this._isoPath(ctx,sc.x,sc.y-2); ctx.stroke();
};

// ─── roundRect polyfill ───────────────────────────────────
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r) {
    this.beginPath();
    this.moveTo(x+r,y); this.lineTo(x+w-r,y);
    this.quadraticCurveTo(x+w,y,x+w,y+r); this.lineTo(x+w,y+h-r);
    this.quadraticCurveTo(x+w,y+h,x+w-r,y+h); this.lineTo(x+r,y+h);
    this.quadraticCurveTo(x,y+h,x,y+h-r); this.lineTo(x,y+r);
    this.quadraticCurveTo(x,y,x+r,y); this.closePath();
  };
}
