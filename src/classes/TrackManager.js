// RM / OP
/**
 * TRACK MANAGER (LAYERED RENDERING & CAMERA)
 */
export class TrackManager {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.mapData = null;
    this.splinePath = [];
    this.cachedBackground = null;
    this.cachedOverlay = null; // Layer for bridges/overpasses
    
    // Design Constants
    this.HW = 160; // Wider track for better look
    this.BW = 35;  // Curb width
    this.cameraZoom = 1.0;
    this.cameraOffset = { x: 0, y: 0 };
    /** Forest „8“: zwei Halbbögen — Unterführung (Unterarm im Cache, Überarm + Autos darüber) */
    this._forestPathUnder = null;
    this._forestPathOver = null;
    /** Zuletzt gesetzte Anzeige-Pixelgröße (clientWidth/Height), um unnötige Resets zu vermeiden */
    this._displayPixelW = 0;
    this._displayPixelH = 0;
  }

  /**
   * Canvas-Bitmap an die tatsächliche Layout-Größe des Elements anpassen (nicht window — vermeidet Flex/Skalierungsfehler).
   * @returns {boolean} true wenn die Größe geändert und Caches invalidiert wurden
   */
  resizeIfNeeded() {
    if (!this.canvas) return false;
    const cw = Math.max(1, Math.floor(this.canvas.clientWidth));
    const ch = Math.max(1, Math.floor(this.canvas.clientHeight));
    if (cw === this._displayPixelW && ch === this._displayPixelH) return false;
    this._displayPixelW = cw;
    this._displayPixelH = ch;
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.cachedBackground = null;
    this.cachedOverlay = null;
    return true;
  }

  loadMap(mapData) {
    if (!mapData || !this.canvas || !this.ctx) {
      console.error('[TrackManager] loadMap: fehlendes Canvas oder Kontext');
      return;
    }
    this.mapData = mapData;
    this.resizeIfNeeded();

    if (mapData.controlPoints) {
      const seg = mapData.id === 'forest-loop' ? 64 : 40;
      this.splinePath = this.generateSplinePath(mapData.controlPoints, seg);
    } else {
      this.splinePath = [];
    }

    if (mapData.id === 'forest-loop') {
      const t0 = -Math.PI / 4;
      this._forestPathUnder = this._sampleForestLissajousArc(t0, t0 + Math.PI, 150);
      this._forestPathOver = this._sampleForestLissajousArc(t0 + Math.PI, t0 + 2 * Math.PI, 150);
    } else {
      this._forestPathUnder = null;
      this._forestPathOver = null;
    }

    this.cachedBackground = null;
    this.cachedOverlay = null;
    this.fitCameraToTrack();
    
    console.log(`[CAMERA FIT] mapId: ${mapData.id}, zoom: ${this.cameraZoom.toFixed(2)}`);
  }

  fitCameraToTrack() {
    if (!this.mapData) return;
    
    let minX = 10000, minY = 10000, maxX = -10000, maxY = -10000;

    if (this.mapData.id === 'sand-circuit') {
      const LX = 800, RX = 2400, CY = 900, R = 500, HW = this.HW;
      minX = LX - R - HW - 50;
      maxX = RX + R + HW + 50;
      minY = CY - R - HW - 50;
      maxY = CY + R + HW + 50;
    } else if (this.splinePath.length > 0) {
      this.splinePath.forEach(p => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      });
      minX -= (this.HW + 80);
      maxX += (this.HW + 80);
      minY -= (this.HW + 80);
      maxY += (this.HW + 80);
    } else {
      minX = 0; maxX = this.mapData.width || 3200;
      minY = 0; maxY = this.mapData.height || 1800;
    }

    const coarse =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(pointer: coarse)').matches;
    const iphoneTight = coarse && window.matchMedia('(max-width: 400px)').matches;
    const iphonePortrait = coarse && window.matchMedia('(max-width: 430px)').matches;
    const phoneNarrow = coarse && window.matchMedia('(max-width: 520px)').matches;
    const phoneLowLandscape =
      coarse &&
      window.matchMedia('(max-height: 520px)').matches &&
      window.matchMedia('(orientation: landscape)').matches;

    /* Etwas mehr Rand auf Touch — iPhone näher an die Strecke als zuvor (moderateres Zoom-out) */
    let framePad = 200;
    if (iphoneTight) framePad = 300;
    else if (iphonePortrait) framePad = 280;
    else if (phoneNarrow) framePad = 260;
    else if (phoneLowLandscape) framePad = 280;

    const trackW = maxX - minX + framePad;
    const trackH = maxY - minY + framePad;

    const zoomW = this.canvas.width / trackW;
    const zoomH = this.canvas.height / trackH;
    this.cameraZoom = Math.min(zoomW, zoomH);

    /* Touch: leicht rauszoomen; iPhone spürbar näher an der Strecke */
    if (coarse) {
      if (iphoneTight) {
        this.cameraZoom *= 0.62;
      } else if (iphonePortrait) {
        this.cameraZoom *= 0.66;
      } else if (phoneNarrow) {
        this.cameraZoom *= 0.72;
      } else if (phoneLowLandscape) {
        this.cameraZoom *= 0.76;
      }
    }
    
    this.cameraOffset = {
      x: minX + (maxX - minX) / 2,
      y: minY + (maxY - minY) / 2
    };
  }

  generateSplinePath(pts, segments = 30) {
    const path = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      for (let t = 0; t < 1; t += 1/segments) {
        const t2 = t*t, t3 = t2*t;
        const f1 = -0.5*t3 + t2 - 0.5*t, f2 = 1.5*t3 - 2.5*t2 + 1.0, f3 = -1.5*t3 + 2.0*t2 + 0.5*t, f4 = 0.5*t3 - 0.5*t2;
        path.push({ x: p0.x*f1 + p1.x*f2 + p2.x*f3 + p3.x*f4, y: p0.y*f1 + p1.y*f2 + p2.y*f3 + p3.y*f4 });
      }
    }
    return path;
  }

  /**
   * REFINED COLLISION (No Stuttering)
   */
  isOnTrack(x, y) {
    if (!this.mapData) return true;

    // 1. Sand Circuit (Geometric Check)
    if (this.mapData.id === 'sand-circuit') {
      const LX = 800, RX = 2400, CY = 900, R = 500, HW = this.HW;

      // Horizontal Straights
      if (Math.abs(y - (CY - R)) <= HW && x >= LX && x <= RX) return true;
      if (Math.abs(y - (CY + R)) <= HW && x >= LX && x <= RX) return true;

      // Curves
      if (x < LX) return Math.hypot(x - LX, y - CY) <= R + HW && Math.hypot(x - LX, y - CY) >= R - HW;
      if (x > RX) return Math.hypot(x - RX, y - CY) <= R + HW && Math.hypot(x - RX, y - CY) >= R - HW;

      // NOTE: Bridge is an overpass, no collision here to allow driving under it
      return false;
    }

    // 2. Spline Maps
    if (this.splinePath.length > 0) {
      const driveRadius = this.HW + 5;
      let on = false;
      for (const p of this.splinePath) {
        if (Math.hypot(x - p.x, y - p.y) < driveRadius) {
          on = true;
          break;
        }
      }
      if (!on) return false;
      if (Array.isArray(this.mapData.forbiddenZones) && this.mapData.forbiddenZones.length > 0) {
        for (const z of this.mapData.forbiddenZones) {
          if (this._pointInCenterRect(x, y, z)) return false;
        }
      }
      return true;
    }
    return true;
  }

  /** Wie RaceManager.pointInRect: x,y = Mittelpunkt, width/height volle Ausdehnung. */
  _pointInCenterRect(x, y, r) {
    if (!r || r.width == null || r.height == null) return false;
    return (
      x > r.x - r.width / 2 &&
      x < r.x + r.width / 2 &&
      y > r.y - r.height / 2 &&
      y < r.y + r.height / 2
    );
  }

  _distPointToSegmentSq(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    let t = ab2 < 1e-10 ? 0 : (apx * abx + apy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * abx;
    const cy = ay + t * aby;
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy;
  }

  _minDistSqToOpenPolyline(px, py, path) {
    let best = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const d = this._distPointToSegmentSq(px, py, a.x, a.y, b.x, b.y);
      if (d < best) best = d;
    }
    return best;
  }

  _forestNearestArm(x, y) {
    if (!this._forestPathUnder?.length || !this._forestPathOver?.length) return 'over';
    const du = this._minDistSqToOpenPolyline(x, y, this._forestPathUnder);
    const ov = this._minDistSqToOpenPolyline(x, y, this._forestPathOver);
    return du <= ov ? 'under' : 'over';
  }

  /**
   * LAYERED DRAWING
   */
  draw(cars, drawUIFunc, shouldDrawCar) {
    if (!this.mapData || !this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const resized = this.resizeIfNeeded();
    if (resized) this.fitCameraToTrack();

    /* Sicherer Ausgangspunkt pro Frame (verhindert „eingefrorene“/kaskadierte Transformationen nach Fehlern) */
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const W = this.mapData.width || 3200;
    const H = this.mapData.height || 1800;
    const drawCar = typeof shouldDrawCar === 'function' ? shouldDrawCar : () => true;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Fill the entire canvas background first (prevents black bars)
    ctx.fillStyle = this.mapData.bgColor || '#1e293b';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    
    // Apply Camera (Centered on target)
    ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
    ctx.scale(this.cameraZoom, this.cameraZoom);
    ctx.translate(-this.cameraOffset.x, -this.cameraOffset.y);

    // 1. Background Layer (Cached)
    if (!this.cachedBackground) this._preRender(W, H);
    if (this.cachedBackground && this.cachedBackground.width > 0) {
      ctx.drawImage(this.cachedBackground, 0, 0);
    }

    const forestSplit =
      this.mapData.id === 'forest-loop' &&
      this._forestPathUnder?.length &&
      this._forestPathOver?.length;

    if (!forestSplit) {
      this._drawStartLine(ctx);
    }

    if (!this.cachedOverlay) this._preRenderOverlay(W, H);
    if (this.cachedOverlay && this.cachedOverlay.width > 0) {
      ctx.drawImage(this.cachedOverlay, 0, 0);
    }

    if (forestSplit) {
      const HW = this.HW;
      const ASPHALT = '#333333';
      cars.forEach((car) => {
        if (!drawCar(car)) return;
        if (this._forestNearestArm(car.x, car.y) === 'under') car.draw(ctx);
      });
      this._strokeForestOpenArm(ctx, this._forestPathOver, HW, ASPHALT);
      this._drawStartLine(ctx);
      cars.forEach((car) => {
        if (!drawCar(car)) return;
        if (this._forestNearestArm(car.x, car.y) !== 'under') car.draw(ctx);
      });
    } else {
      cars.forEach((car) => {
        if (drawCar(car)) car.draw(ctx);
      });
    }

    /* Brücke über Autos (nur Sand); Schatten im Boden-Cache */
    if (this._getBridgeRect()) {
      ctx.save();
      this._drawBridgeDeckOnly(ctx);
      ctx.restore();
    }

    // Namensschilder über allem
    if (drawUIFunc) drawUIFunc(ctx);

    ctx.restore();
  }

  _preRender(W, H) {
    this.cachedBackground = document.createElement('canvas');
    this.cachedBackground.width = W;
    this.cachedBackground.height = H;
    const ctx = this.cachedBackground.getContext('2d');

    // High Quality Sand Texture with variations
    ctx.fillStyle = this.mapData.bgColor || '#d4c090';
    ctx.fillRect(0, 0, W, H);
    
    // 1. Noise/Grit
    for (let i = 0; i < 25000; i++) {
        ctx.fillStyle = 'rgba(0,0,0,0.035)';
        ctx.fillRect(Math.random() * W, Math.random() * H, 2.5, 2.5);
    }

    // 2. Sand Variations (Dunes effect)
    for (let i = 0; i < 15; i++) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.beginPath();
        ctx.ellipse(Math.random()*W, Math.random()*H, 200 + Math.random()*400, 100 + Math.random()*200, Math.random()*Math.PI, 0, Math.PI*2);
        ctx.fill();
    }

    // 3. Small Stones
    for (let i = 0; i < 150; i++) {
        ctx.fillStyle = '#bca67a';
        ctx.beginPath();
        ctx.arc(Math.random()*W, Math.random()*H, 2 + Math.random()*4, 0, Math.PI*2);
        ctx.fill();
    }

    // Grid (Subtle)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 400) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 400) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    if (this.mapData.id === 'sand-circuit') {
      this._drawComplexOval(ctx, false); // false = don't draw bridge top
      this._drawBridgeShadowOnly(ctx);
    } else if (
      this.mapData.id === 'forest-loop' &&
      this._forestPathUnder?.length &&
      this._forestPathOver?.length
    ) {
      this._strokeForestOpenArm(ctx, this._forestPathUnder, this.HW, '#333333');
    } else {
      this._drawComplexSpline(ctx);
    }

    this._drawDecorations(ctx, W, H);
  }

  _preRenderOverlay(W, H) {
    this.cachedOverlay = document.createElement('canvas');
    this.cachedOverlay.width = W;
    this.cachedOverlay.height = H;
    const ctx = this.cachedOverlay.getContext('2d');
    /* Sand: Brückendeck wird nach den Autos gezeichnet → Fahrt „unter“ der Brücke */
  }

  _drawComplexOval(ctx, drawBridge) {
    const { HW, BW } = this;
    const LX = 800, RX = 2400, CY = 900, R = 500;
    const ASPHALT = '#333333';

    // Curbs Outer
    this._oval(ctx, LX, RX, CY, R + HW + BW/2);
    this._strokeCurbs(ctx);

    // Track Surface
    this._oval(ctx, LX, RX, CY, R);
    ctx.lineWidth = HW * 2;
    ctx.strokeStyle = ASPHALT;
    ctx.stroke();

    // Center Line
    this._oval(ctx, LX, RX, CY, R);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.setLineDash([30, 40]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Curbs Inner
    this._oval(ctx, LX, RX, CY, R - HW - BW/2);
    this._strokeCurbs(ctx);

    if (drawBridge) this._drawBridgeTop(ctx);
  }

  /** Nur Sand: vertikale Brücke */
  _getBridgeRect() {
    const m = this.mapData;
    if (!m) return null;
    if (m.id === 'sand-circuit') return { x: 1500, y: 100, w: 200, h: 1600 };
    return null;
  }

  _bridgeAreaContains(x, y, pad = 0) {
    const br = this._getBridgeRect();
    if (!br) return false;
    const px = pad + 20;
    const py = pad + 20;
    return (
      x >= br.x - px &&
      x <= br.x + br.w + px &&
      y >= br.y - py &&
      y <= br.y + br.h + py
    );
  }

  /** Brückenschatten im Boden-Cache (Sand). */
  _drawBridgeShadowOnly(ctx) {
    const br = this._getBridgeRect();
    if (!br) return;
    const px = 14;
    const py = 10;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(br.x - px, br.y - py, br.w + 2 * px, br.h + 2 * py);
  }

  /** Brückendeck — nur Sand (vertikal). */
  _drawBridgeDeckOnly(ctx) {
    const br = this._getBridgeRect();
    if (!br) return;
    const ASPHALT = '#333333';
    const curbW = Math.min(22, Math.max(14, br.w * 0.11));
    ctx.fillStyle = ASPHALT;
    ctx.fillRect(br.x, br.y, br.w, br.h);

    this._drawRectCurbs(ctx, br.x, br.y, curbW, br.h);
    this._drawRectCurbs(ctx, br.x + br.w - curbW, br.y, curbW, br.h);
    const mx = br.x + br.w / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3;
    ctx.setLineDash([28, 36]);
    ctx.beginPath();
    ctx.moveTo(mx, br.y);
    ctx.lineTo(mx, br.y + br.h);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawBridgeTop(ctx) {
    this._drawBridgeShadowOnly(ctx);
    this._drawBridgeDeckOnly(ctx);
  }

  _sampleForestLissajousArc(t0, t1, samples) {
    const ax = 900;
    const ay = 455;
    const cx = 1600;
    const cy = 900;
    const pts = [];
    for (let i = 0; i <= samples; i++) {
      const u = t0 + (i / samples) * (t1 - t0);
      pts.push({ x: cx + ax * Math.sin(u), y: cy + ay * Math.sin(2 * u) });
    }
    return pts;
  }

  _centroid2(path) {
    if (!path.length) return { x: 0, y: 0 };
    let sx = 0;
    let sy = 0;
    for (const p of path) {
      sx += p.x;
      sy += p.y;
    }
    const n = path.length;
    return { x: sx / n, y: sy / n };
  }

  _meanDistToRef(path, ref) {
    let s = 0;
    for (const p of path) {
      s += Math.hypot(p.x - ref.x, p.y - ref.y);
    }
    return path.length ? s / path.length : 0;
  }

  _offsetOpenPolyline(path, dist) {
    const n = path.length;
    if (n < 2) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      let dx;
      let dy;
      if (i === 0) {
        dx = path[1].x - path[0].x;
        dy = path[1].y - path[0].y;
      } else if (i === n - 1) {
        dx = path[n - 1].x - path[n - 2].x;
        dy = path[n - 1].y - path[n - 2].y;
      } else {
        dx = path[i + 1].x - path[i - 1].x;
        dy = path[i + 1].y - path[i - 1].y;
      }
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const nx = -dy;
      const ny = dx;
      out.push({ x: path[i].x + nx * dist, y: path[i].y + ny * dist });
    }
    return out;
  }

  _chaikinOpen(path, iterations = 1) {
    let cur = path.map((p) => ({ x: p.x, y: p.y }));
    for (let it = 0; it < iterations; it++) {
      const n = cur.length;
      if (n < 3) break;
      const out = [];
      out.push({ ...cur[0] });
      for (let i = 0; i < n - 1; i++) {
        const p = cur[i];
        const q = cur[i + 1];
        out.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y });
        out.push({ x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y });
      }
      out.push({ ...cur[n - 1] });
      cur = out;
    }
    return cur;
  }

  _strokeCurbsOnOpenPath(ctx, path, opt = {}) {
    if (path.length < 2) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.miterLimit = 2;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    this._strokeCurbs(ctx, opt.curbWidth);
    ctx.restore();
  }

  /**
   * Offener Arm: Randstreifen nur auf der Außenseite (zum Streckeninneren / Kreuzung hin innen ohne Rot-Weiß).
   */
  _strokeForestOpenArm(ctx, path, HW, ASPHALT) {
    if (path.length < 2) return;
    const FCX = 1600;
    const FCY = 900;
    let left = this._offsetOpenPolyline(path, HW);
    let right = this._offsetOpenPolyline(path, -HW);
    left = this._chaikinOpen(left, 1);
    right = this._chaikinOpen(right, 1);
    const mid0 = { x: (path[0].x + path[Math.min(1, path.length - 1)].x) / 2, y: (path[0].y + path[Math.min(1, path.length - 1)].y) / 2 };
    const l0 = { x: (left[0].x + left[Math.min(1, left.length - 1)].x) / 2, y: (left[0].y + left[Math.min(1, left.length - 1)].y) / 2 };
    const r0 = { x: (right[0].x + right[Math.min(1, right.length - 1)].x) / 2, y: (right[0].y + right[Math.min(1, right.length - 1)].y) / 2 };
    const dL = Math.hypot(l0.x - FCX, l0.y - FCY);
    const dR = Math.hypot(r0.x - FCX, r0.y - FCY);
    const outer = dL > dR ? left : right;
    const inner = dL > dR ? right : left;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.lineWidth = HW * 2;
    ctx.strokeStyle = ASPHALT;
    ctx.stroke();
    ctx.restore();

    this._strokeCurbsOnOpenPath(ctx, outer, { curbWidth: 26 });

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(inner[0].x, inner[0].y);
    for (let i = 1; i < inner.length; i++) ctx.lineTo(inner[i].x, inner[i].y);
    ctx.strokeStyle = 'rgba(0,0,0,0.24)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.setLineDash([22, 30]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawComplexSpline(ctx) {
    if (this.splinePath.length < 2) return;
    const { HW, BW } = this;
    const ASPHALT = '#333333';
    const center = this.splinePath;

    if (this.mapData.id === 'forest-loop' && this._forestPathUnder?.length && this._forestPathOver?.length) {
      return;
    }

    this._strokeSpline(ctx, center, (HW + BW) * 2);
    this._strokeSpline(ctx, center, HW * 2, ASPHALT);
    this._strokeSpline(ctx, center, 3, 'rgba(255,255,255,0.5)', [30, 40]);
    this._strokeSpline(ctx, center, (HW - BW) * 2);

    const ref = this._centroid2(center);
    const dOut = HW + BW * 0.48;
    const outerA = this._offsetClosedPolyline(center, dOut);
    const outerB = this._offsetClosedPolyline(center, -dOut);
    const outer =
      this._meanDistToRef(outerA, ref) >= this._meanDistToRef(outerB, ref) ? outerA : outerB;
    if (outer.length >= 3) {
      this._strokeCurbsOnPath(ctx, outer, { curbWidth: BW });
    }
  }

  /** Eine Chaikin-Runde auf geschlossener Polyline — mildert Spitzen an der Kreuzung. */
  _chaikinClosed(path, iterations = 1) {
    let cur = path.map((p) => ({ x: p.x, y: p.y }));
    for (let it = 0; it < iterations; it++) {
      const n = cur.length;
      if (n < 3) break;
      const out = [];
      for (let i = 0; i < n; i++) {
        const p = cur[i];
        const q = cur[(i + 1) % n];
        out.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y });
        out.push({ x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y });
      }
      cur = out;
    }
    return cur;
  }

  _offsetClosedPolyline(path, dist) {
    const n = path.length;
    if (n < 3) return path.map((p) => ({ x: p.x, y: p.y }));
    const out = [];
    for (let i = 0; i < n; i++) {
      const p0 = path[(i - 1 + n) % n];
      const p1 = path[i];
      const p2 = path[(i + 1) % n];
      let dx = p2.x - p0.x;
      let dy = p2.y - p0.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const nx = -dy;
      const ny = dx;
      out.push({ x: p1.x + nx * dist, y: p1.y + ny * dist });
    }
    return out;
  }

  _strokeCurbsOnPath(ctx, path, opt = {}) {
    if (path.length < 2) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.miterLimit = 2;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.closePath();
    this._strokeCurbs(ctx, opt.curbWidth);
    ctx.restore();
  }

  _oval(ctx, lx, rx, cy, r) {
    ctx.beginPath();
    ctx.arc(lx, cy, r, Math.PI/2, -Math.PI/2);
    ctx.lineTo(rx, cy - r);
    ctx.arc(rx, cy, r, -Math.PI/2, Math.PI/2);
    ctx.lineTo(lx, cy + r);
    ctx.closePath();
  }

  _strokeSpline(ctx, path, width, color = null, dash = []) {
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (const p of path) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.lineWidth = width;
    if (color) ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _strokeCurbs(ctx, lineWidth = null) {
    ctx.lineWidth = lineWidth != null ? lineWidth : this.BW;
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([60, 60]);
    ctx.stroke();
    ctx.strokeStyle = '#e11d48'; // Red
    ctx.lineDashOffset = 60;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  _drawRectCurbs(ctx, x, y, w, h) {
    const step = 60;
    for (let i = 0; i < h; i += step) {
      ctx.fillStyle = (Math.floor(i/step)%2===0) ? '#fff' : '#e11d48';
      ctx.fillRect(x, y+i, w, Math.min(step, h-i));
    }
  }

  _drawDecorations(ctx, W, H) {
    let seed = 0;
    for (let i = 0; i < this.mapData.name.length; i++) seed += this.mapData.name.charCodeAt(i);
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

    for (let i = 0; i < 40; i++) {
      const x = rnd() * W, y = rnd() * H;
      if (this._bridgeAreaContains(x, y, 50)) continue;
      if (!this.isOnTrack(x, y)) this._drawTree(ctx, x, y, rnd());
    }
  }

  _drawTree(ctx, x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.arc(5, 5, 20 + r*10, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#166534';
    ctx.beginPath(); ctx.arc(0, 0, 20 + r*10, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  _drawStartLine(ctx) {
    if (!this.mapData || !this.mapData.startPos) return;
    const { x, y, angle } = this.mapData.startPos;
    const HW = this.HW;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    
    const size = 30; // Checkered square size
    const cols = 2;
    const rows = Math.floor((HW * 2) / size);
    
    // Draw background for start line
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, -HW, size * cols, HW * 2);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#fff' : '#000';
        ctx.fillRect(c * size, -HW + r * size, size, size);
      }
    }
    
    ctx.restore();
  }

  getWaypoints() {
    const m = this.mapData;
    if (m?.botWaypoints && m.botWaypoints.length >= 3) {
      return m.botWaypoints;
    }
    if (this.splinePath.length > 0) return this.splinePath;
    const LX = 800, RX = 2400, CY = 900, R = 500;
    const pts = [];
    for (let x = RX; x >= LX; x -= 200) pts.push({ x, y: CY - R });
    for (let a = -Math.PI/2; a >= -Math.PI*1.5; a -= 0.1) pts.push({ x: LX + Math.cos(a)*R, y: CY + Math.sin(a)*R });
    for (let x = LX; x <= RX; x += 200) pts.push({ x, y: CY + R });
    for (let a = Math.PI/2; a >= -Math.PI/2; a -= 0.1) pts.push({ x: RX + Math.cos(a)*R, y: CY + Math.sin(a)*R });
    return pts;
  }
}
