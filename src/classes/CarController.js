// RM
/**
 * CAR CONTROLLER (REFINED COLLISION)
 */
export class CarController {
  constructor(x, y, angle, color, isHuman = true, id = '1', name = 'Spieler') {
    this.id = id;
    this.name = name;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.color = color;
    this.isHuman = isHuman;

    this.speed = 0;
    this.maxSpeed = isHuman ? 11.8 : 10.2;
    this.accel = 0.19;
    this.friction = 0.979;
    this.steerPower = 0.022;

    this.radius = 14; // Lenient radius
    this.lastValidPos = { x: x, y: y };
    this.steerInput = 0; // For smooth steering
    /** Letzte Steuerung für Pfeil (Mensch + Host-Bots); Client-Bots: nur Geschwindigkeit */
    this._drawInputs = { accelerate: false, brake: false, left: false, right: false };
    /** Geschwindigkeit in Weltkoordinaten (m/Frame-äquivalent), nach update gesetzt */
    this._velWorld = { x: 0, y: 0 };
  }

  /**
   * v_world = |speed| entlang Blickrichtung (wie die Physik).
   * v_body = (v·ê_vorne, v·ê_rechts) mit ê_vorne=(cos θ,sin θ), ê_rechts=(-sin θ,cos θ).
   * Pfeilrichtung = norm( v_body + λ · (Gas/Bremse, 0) ); nur longitudinal, kein Links/Rechts.
   */
  _velocityWorld() {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return { x: c * this.speed, y: s * this.speed };
  }

  _velocityBodyFromWorld(vw) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const vwx = vw.x;
    const vwy = vw.y;
    return {
      vf: vwx * c + vwy * s,
      vr: -vwx * s + vwy * c
    };
  }

  _computeArrowDirectionBody() {
    const { vf, vr } = this._velocityBodyFromWorld(this._velocityWorld());

    const inp = this._drawInputs || {};
    const ix = (inp.accelerate ? 1 : 0) - (inp.brake ? 1 : 0);
    const inx = ix === 0 ? 0 : Math.sign(ix);
    const hasKeys = !!(inp.accelerate || inp.brake);
    const lam = hasKeys ? Math.min(0.58, 0.26 + 0.06 * Math.min(Math.abs(vf), 12)) : 0;

    let dx = vf + lam * inx;
    let dy = vr;
    let n = Math.hypot(dx, dy);
    if (n < 1e-6) {
      if (Math.abs(this.speed) > 0.08) {
        return { nx: Math.sign(this.speed) || 1, ny: 0 };
      }
      return null;
    }
    return { nx: dx / n, ny: dy / n };
  }

  update(inputs, dt, trackManager) {
    this._drawInputs = {
      accelerate: !!inputs.accelerate,
      brake: !!inputs.brake,
      left: !!inputs.left,
      right: !!inputs.right
    };

    if (inputs.accelerate) this.speed += this.accel;
    if (inputs.brake) this.speed -= this.accel * 1.5;

    this.speed *= this.friction;
    const cap = this.maxSpeed;
    if (this.speed > cap) this.speed = cap;
    if (this.speed < -cap * 0.55) this.speed = -cap * 0.55;
    if (Math.abs(this.speed) < 0.05) this.speed = 0;

    // Smooth Steering Interpolation
    let targetSteer = 0;
    if (inputs.left) targetSteer = -1;
    if (inputs.right) targetSteer = 1;
    this.steerInput += (targetSteer - this.steerInput) * 0.14;

    // Lenken reduziert Geschwindigkeit (Reifenreibung / Kurvenkraft)
    const st = Math.abs(this.steerInput);
    if (st > 0.04 && Math.abs(this.speed) > 0.12) {
      const slow = 1 - st * 0.11 * Math.min(dt * 60, 2.8) * 0.45;
      this.speed *= Math.max(0.72, slow);
    }

    const turnSpeed = this.speed * this.steerPower * this.steerInput * (dt * 60);
    this.angle += turnSpeed;

    // Movement with high-precision sub-steps
    const substeps = 3;
    let nextX = this.x;
    let nextY = this.y;

    for (let s = 0; s < substeps; s++) {
        const stepDt = dt / substeps;
        const moveX = Math.cos(this.angle) * this.speed * (stepDt * 60);
        const moveY = Math.sin(this.angle) * this.speed * (stepDt * 60);
        
        const testX = nextX + moveX;
        const testY = nextY + moveY;

        // Multi-point collision (Front & Sides)
        if (this._checkCollisions(testX, testY, trackManager)) {
            nextX = testX;
            nextY = testY;
            this.lastValidPos = { x: nextX, y: nextY };
        } else {
            // Collision response
            this.speed *= 0.3; // Speed penalty for hitting wall
            // console.log(`[MOVE BLOCKED] id: ${this.id}, pos: ${Math.floor(testX)},${Math.floor(testY)}`);
            break;
        }
    }

    this.x = nextX;
    this.y = nextY;

    this._velWorld = this._velocityWorld();

    // if (this.speed > 0.1) {
    //     console.log(`[CAR UPDATE] id: ${this.id}, pos: ${Math.floor(this.x)},${Math.floor(this.y)}, vel: ${this.speed.toFixed(2)}`);
    // }
  }

  _checkCollisions(x, y, trackManager) {
    // Check center point
    if (!trackManager.isOnTrack(x, y)) return false;
    
    // Check 4 points around the car for better coverage (smaller than car visual)
    const offsets = [
        { dx: 9, dy: 0 }, { dx: -9, dy: 0 },
        { dx: 0, dy: 5 }, { dx: 0, dy: -5 }
    ];
    
    for (const off of offsets) {
        const tx = x + Math.cos(this.angle) * off.dx - Math.sin(this.angle) * off.dy;
        const ty = y + Math.sin(this.angle) * off.dx + Math.cos(this.angle) * off.dy;
        if (!trackManager.isOnTrack(tx, ty)) return false;
    }

    return true;
  }

  applyPosition(x, y, angle) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this._velWorld = this._velocityWorld();
  }

  draw(ctx) {
    ctx.save();
    
    // 1. Drop Shadow
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 8;
    ctx.shadowOffsetY = 8;

    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    const vis = 1.22;
    ctx.scale(vis, vis);

    // Visual Car (F1 Style — scaled up; collision stays tighter than full visual)
    const W = 70, H = 36;
    const bodyColor = this.color || '#ef4444';

    // Reset shadow for main body parts to keep them crisp
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Rear Wing
    ctx.fillStyle = '#111';
    ctx.fillRect(-W/2, -H/2, 12, H);

    // Wheels
    ctx.fillStyle = '#000';
    ctx.fillRect(-W/3, -H/2 - 4, 18, 10); // Rear Left
    ctx.fillRect(-W/3, H/2 - 6, 18, 10);  // Rear Right
    ctx.fillRect(W/5, -H/2 - 4, 15, 8);   // Front Left
    ctx.fillRect(W/5, H/2 - 4, 15, 8);    // Front Right

    // Main Body
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(-W/2 + 10, -H/3);
    ctx.lineTo(W/2, 0);
    ctx.lineTo(-W/2 + 10, H/3);
    ctx.closePath();
    ctx.fill();

    // Sidepods
    ctx.fillStyle = bodyColor;
    ctx.fillRect(-W/4, -H/2.2, 30, 8);
    ctx.fillRect(-W/4, H/2.2 - 8, 30, 8);

    // Front Wing
    ctx.fillStyle = '#111';
    ctx.fillRect(W/2 - 10, -H/2, 15, H);

    // Cockpit
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.ellipse(-5, 0, 12, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Helmet
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-2, 0, 4, 0, Math.PI * 2);
    ctx.fill();

    // Vektorpfeil: nur Gas/Bremse (longitudinal), Gerade — kein Links/Rechts
    const inp = this._drawInputs || {};
    const inMag = Math.abs((inp.accelerate ? 1 : 0) - (inp.brake ? 1 : 0));
    const dir = this._computeArrowDirectionBody();
    if (dir && (Math.abs(this.speed) > 0.1 || inMag > 0.001)) {
      const nx = dir.nx;
      const ny = dir.ny;
      const arrowLen = 22 + Math.abs(this.speed) * 13 + (inMag > 0 ? inMag * 8 : 0);
      const sx = W / 2 + 5;
      const sy = 0;
      const ex = sx + nx * arrowLen;
      const ey = sy + ny * arrowLen;

      ctx.strokeStyle = '#00f2ff';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const tipX = ex;
      const tipY = ey;
      const tanX = nx;
      const tanY = ny;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      const ah = 11;
      const aw = 6;
      const bx = tipX - tanX * ah;
      const by = tipY - tanY * ah;
      const px = -tanY * aw;
      const py = tanX * aw;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(bx + px, by + py);
      ctx.lineTo(bx - px, by - py);
      ctx.closePath();
      ctx.fillStyle = '#00f2ff';
      ctx.fill();
    }

    ctx.restore();
  }

  drawLabel(ctx, rank, options = {}) {
    if (options.hide) return;
    ctx.save();
    ctx.translate(this.x, this.y - 25);

    ctx.textAlign = 'center';

    const label = (this.name || '').replace(' (Du)', '').trim() || 'Spieler';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = 'bold 12px "Rajdhani", sans-serif';
    ctx.shadowBlur = 4;
    ctx.shadowColor = 'black';
    ctx.fillText(label.toUpperCase(), 0, 0);

    if (rank) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.strokeStyle = 'rgba(0, 242, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(-18, 8, 36, 18, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#00f2ff';
      ctx.font = 'bold 11px "Orbitron", sans-serif';
      ctx.fillText(`P${rank}`, 0, 21);
    }

    ctx.restore();
  }
}
