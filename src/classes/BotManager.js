// CL
function idHash(id) {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

/**
 * BOT MANAGER — host-only simulation, smoother racing line, overtakes, stuck recovery
 */
export class BotManager {
  constructor(carController, waypoints, difficulty = 'Mittel', seed = 0) {
    this.car = carController;
    this.waypoints = waypoints;
    this.difficulty = difficulty;

    this.profile = this._createProfile(difficulty, seed, carController.id);
    console.log(
      `[BOT PROFILE CREATED] id=${carController.id} maxSpeed=${this.profile.maxSpeed.toFixed(2)} lookahead=${this.profile.lookahead} lineOff=${this.profile.racingLineOffset.toFixed(1)} var=${this.profile.speedVarianceAmp.toFixed(2)}`
    );

    this.currentWaypointIndex = this._findFirstWaypoint();
    this.racingLineOffset = this.profile.racingLineOffset;
    this._linePhase = Math.sin(seed * 0.01 + idHash(carController.id)) * 40;

    this.stuckTimer = 0;
    this._stuckDist = 0;
    this._lastWpDist = Infinity;
    this.overtakeTimer = 0;
    this._lastTargetSpeedLog = 0;
    this._raceTime = 0;
  }

  _createProfile(diff, seed, id) {
    const h = idHash(id);
    const r = (Math.sin(seed * 0.001 + h * 0.01) * 0.5 + 0.5) || 0.5;
    const profiles = {
      Leicht: { speed: 7.2 + r * 1.2, steer: 0.75, braking: 0.85, risk: 0.15 },
      Mittel: { speed: 8.8 + r * 1.4, steer: 0.92, braking: 0.65, risk: 0.35 },
      Schwer: { speed: 10.2 + r * 1.6, steer: 1.05, braking: 0.48, risk: 0.65 }
    };
    const base = profiles[diff] || profiles.Mittel;
    const lookahead = 4 + Math.floor(r * 4);
    return {
      maxSpeed: base.speed,
      steerMul: base.steer,
      brakingPower: base.braking,
      riskFactor: base.risk,
      lookahead,
      racingLineOffset: (r - 0.5) * 70 * base.risk,
      speedVarianceAmp: 0.35 + r * 0.55,
      wpAdvanceDist: 130 + r * 50
    };
  }

  _findFirstWaypoint() {
    let bestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < this.waypoints.length; i++) {
      const wp = this.waypoints[i];
      const dist = Math.hypot(wp.x - this.car.x, wp.y - this.car.y);
      const dx = wp.x - this.car.x;
      const dy = wp.y - this.car.y;
      const dot = dx * Math.cos(this.car.angle) + dy * Math.sin(this.car.angle);
      if (dist < minDist && dot > 0) {
        minDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  _activeCars(allCars, playersProgress) {
    if (!playersProgress || !playersProgress.length) return allCars;
    return allCars.filter((o) => {
      const pr = playersProgress.find((p) => String(p.id) === String(o.id));
      return !pr || !pr.finished;
    });
  }

  _lookaheadCurvature() {
    const n = this.waypoints.length;
    if (n < 3) return 0;
    const a = this.waypoints[this.currentWaypointIndex];
    const mid = this.waypoints[(this.currentWaypointIndex + Math.floor(this.profile.lookahead / 2)) % n];
    const b = this.waypoints[(this.currentWaypointIndex + this.profile.lookahead) % n];
    const ang1 = Math.atan2(mid.y - a.y, mid.x - a.x);
    const ang2 = Math.atan2(b.y - mid.y, b.x - mid.x);
    let d = Math.abs(ang2 - ang1);
    while (d > Math.PI) d = Math.abs(d - Math.PI * 2);
    return Math.min(1, d * 1.4);
  }

  getInputs(dt, allCars, playersProgress) {
    const inputs = { accelerate: false, brake: false, left: false, right: false };
    if (this.waypoints.length === 0) return inputs;

    this._raceTime += dt;
    const cars = this._activeCars(allCars, playersProgress);

    const target = this.waypoints[this.currentWaypointIndex];
    let distToTarget = Math.hypot(target.x - this.car.x, target.y - this.car.y);

    if (distToTarget < this.profile.wpAdvanceDist) {
      this.currentWaypointIndex = (this.currentWaypointIndex + 1) % this.waypoints.length;
      this._lastWpDist = Infinity;
      distToTarget = Math.hypot(
        this.waypoints[this.currentWaypointIndex].x - this.car.x,
        this.waypoints[this.currentWaypointIndex].y - this.car.y
      );
    }

    const lineWobble = Math.sin(this._raceTime * 0.35 + this._linePhase) * 18 * this.profile.riskFactor;
    const lateral = this.racingLineOffset + lineWobble;
    const tx = target.x + Math.cos(this.car.angle + Math.PI / 2) * lateral;
    const ty = target.y + Math.sin(this.car.angle + Math.PI / 2) * lateral;

    const targetAngle = Math.atan2(ty - this.car.y, tx - this.car.x);
    let diff = targetAngle - this.car.angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;

    const steerEase = 0.06 / this.profile.steerMul;
    if (diff < -steerEase) inputs.left = true;
    if (diff > steerEase) inputs.right = true;

    const curvature = this._lookaheadCurvature();
    const variance = Math.sin(this._raceTime * 1.1 + idHash(this.car.id) * 0.01) * this.profile.speedVarianceAmp;
    let targetSpeed = this.profile.maxSpeed * (1 - curvature * this.profile.brakingPower * 0.95) + variance;
    targetSpeed = Math.max(2.2, Math.min(this.car.maxSpeed * 0.98, targetSpeed));

    if (Math.abs(this.car.speed) < 0.15 && Math.abs(diff) < 0.25) {
      targetSpeed = Math.min(targetSpeed + 1.2, this.car.maxSpeed * 0.85);
    }

    if (Date.now() - this._lastTargetSpeedLog > 1400) {
      console.log(
        `[BOT TARGET SPEED] id=${this.car.id} target=${targetSpeed.toFixed(2)} actual=${this.car.speed.toFixed(2)} curv=${curvature.toFixed(2)}`
      );
      this._lastTargetSpeedLog = Date.now();
    }

    if (this.car.speed < targetSpeed - 0.15) inputs.accelerate = true;
    else if (this.car.speed > targetSpeed + 1.8) inputs.brake = true;

    let overtaking = false;
    cars.forEach((other) => {
      if (other.id === this.car.id) return;
      const pr = playersProgress?.find((p) => String(p.id) === String(other.id));
      if (pr && pr.finished) return;

      const d = Math.hypot(other.x - this.car.x, other.y - this.car.y);
      if (d > 200) return;

      const relAngle = Math.atan2(other.y - this.car.y, other.x - this.car.x);
      let angDiff = relAngle - this.car.angle;
      while (angDiff < -Math.PI) angDiff += Math.PI * 2;
      while (angDiff > Math.PI) angDiff -= Math.PI * 2;

      const ahead = Math.cos(-angDiff) * d > 15;
      if (ahead && d < 120 && this.car.speed > other.speed + 0.35) {
        overtaking = true;
        this.overtakeTimer = 0.45;
        if (Math.abs(angDiff) < 0.55) {
          if (angDiff > 0) inputs.left = true;
          else inputs.right = true;
        }
      } else if (d < 95 && Math.abs(angDiff) < 0.45) {
        if (angDiff > 0) inputs.left = true;
        else inputs.right = true;
        if (d < 70) inputs.brake = true;
      }
    });

    if (this.overtakeTimer > 0) {
      this.overtakeTimer -= dt;
      if (overtaking && Date.now() > (this._nextOvertakeLog || 0)) {
        console.log(`[BOT OVERTAKE] id=${this.car.id}`);
        this._nextOvertakeLog = Date.now() + 2800;
      }
    }

    if (distToTarget + 1 >= this._lastWpDist && this.car.speed < 0.45) {
      this.stuckTimer += dt;
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
    }
    this._lastWpDist = distToTarget;

    if (this.stuckTimer > 1.8) {
      const wp = this.waypoints[this.currentWaypointIndex];
      this.car.x = wp.x - Math.cos(this.car.angle) * 40;
      this.car.y = wp.y - Math.sin(this.car.angle) * 40;
      this.car.speed = 1.2;
      this.stuckTimer = 0;
      this._lastWpDist = Infinity;
      console.log(`[BOT STUCK RESET] id=${this.car.id} -> near wp ${this.currentWaypointIndex}`);
    }

    return inputs;
  }
}
