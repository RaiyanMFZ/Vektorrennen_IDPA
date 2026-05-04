// CL / OP
import { CarController } from './CarController.js';
import { TrackManager } from './TrackManager.js';
import { InputManager } from './InputManager.js';
import { BotManager } from './BotManager.js';
import { getStartPositionsForPlayerCount } from '../utils/mapValidation.js';

function resolveSectorsAndFinish(mapData) {
  if (!mapData) return { sectors: [], finishLine: null };
  const cps = mapData.checkpoints || [];
  const sectors =
    mapData.sectorCheckpoints && mapData.sectorCheckpoints.length > 0
      ? mapData.sectorCheckpoints
      : cps.length > 1
        ? cps.slice(0, -1)
        : cps;
  const finishLine =
    mapData.finishLine != null ? mapData.finishLine : cps.length > 0 ? cps[cps.length - 1] : null;
  return { sectors, finishLine };
}

function pointInRect(x, y, r) {
  if (!r) return false;
  if (r.angle != null && Number.isFinite(r.angle)) {
    const dx = x - r.x;
    const dy = y - r.y;
    const c = Math.cos(r.angle);
    const s = Math.sin(r.angle);
    const lx = dx * c + dy * s;
    const ly = -dx * s + dy * c;
    return Math.abs(lx) < r.width / 2 && Math.abs(ly) < r.height / 2;
  }
  return x > r.x - r.width / 2 && x < r.x + r.width / 2 && y > r.y - r.height / 2 && y < r.y + r.height / 2;
}

/**
 * RACE MANAGER — laps, finish line, sync, ranking hand-off
 */
export class RaceManager {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this.trackManager = new TrackManager('game-canvas');
    this.inputManager = new InputManager();
    this.uiManager = gameManager.uiManager;

    this.reset();
  }

  reset() {
    /** Laufende Countdown-/Game-Loops invalidieren (ohne RAF-Kette „hängen zu lassen“). */
    this._raceEpoch = (this._raceEpoch || 0) + 1;
    this.cars = [];
    this.bots = [];
    this.playersProgress = [];
    this.camera = { x: 1600, y: 900, zoom: 0.8 };
    this.isRunning = false;
    this.raceStartTime = 0;
    this.maxLaps = 3;
    this.finishCount = 0;
    this.currentRaceId = null;
    this.lastSyncTime = 0;
    this.raceSettings = null;
    this._endScreenScheduled = false;
    this._gates = { sectors: [], finishLine: null };
    this._lastBotHostLog = 0;
  }

  stopRaceAndReset() {
    this.isRunning = false;
    this._endScreenScheduled = false;
    this.reset();
  }

  stopGameplayLoop() {
    this.isRunning = false;
  }

  initRace(players, mapData, rounds, seed, difficulty, raceId, raceMeta = {}) {
    console.log(`[RACE STATE RECEIVED] raceId: ${raceId}, mapId: ${mapData.id}, players:`, players);
    this.reset();
    this.currentRaceId = raceId != null ? String(raceId) : null;
    this.trackManager.loadMap(mapData);
    this._gates = resolveSectorsAndFinish(this.trackManager.mapData);

    this.camera.zoom = this.trackManager.cameraZoom;
    this.camera.x = this.trackManager.cameraOffset.x;
    this.camera.y = this.trackManager.cameraOffset.y;

    const lapsToWin = rounds != null ? Number(rounds) : null;
    this.maxLaps = lapsToWin != null && !Number.isNaN(lapsToWin) ? lapsToWin : 3;
    this.raceSettings = {
      lapsToWin: this.maxLaps,
      aiDifficulty: difficulty,
      lobbySize: raceMeta.lobbySize,
      mapId: raceMeta.mapId != null ? raceMeta.mapId : mapData.id
    };

    this.localPlayerId = String(this.gameManager.localPlayerId);
    console.log(`[MAP LOAD SUCCESS] loadedTrackName: ${mapData.name}, localPlayerId: ${this.localPlayerId}`);

    const spawnList = getStartPositionsForPlayerCount(mapData, players.length);

    players.forEach((p, i) => {
      const pId = String(p.id);
      const isLocal = pId === this.localPlayerId;
      const displayName =
        (p.name || '').replace(' (Du)', '').trim() || (p.isHuman ? `Spieler ${pId}` : `Bot ${Math.max(1, i)}`);
      console.log(`[RACE] Spawning car for ${displayName} (ID: ${pId}, Local: ${isLocal})`);

      const pos = spawnList[i] || { x: 1100 + i * 55, y: 400, angle: Math.PI };

      const car = new CarController(pos.x, pos.y, pos.angle, p.color, p.isHuman, pId, displayName);
      this.cars.push(car);

      this.playersProgress.push({
        id: pId,
        name: displayName,
        isHuman: p.isHuman !== false,
        lap: 1,
        nextCheckpoint: 0,
        finished: false,
        rank: i + 1,
        totalTime: 0,
        _sectorLatch: false,
        _finishLatch: false,
        _sentFinishSync: false,
        /** Nur Ziellinie: erst zählen, wenn man die Linie einmal verlassen hat (Spawn auf Start) */
        _armedForLap: false
      });

      if (p.isHuman === false && this.gameManager.networkManager.isHost) {
        const waypoints = this.trackManager.getWaypoints();
        this.bots.push(new BotManager(car, waypoints, difficulty, seed));
      }
    });

    console.log(`[MAP LOAD SUCCESS] Race ready. Local ID: ${this.localPlayerId}`);

    const myHud = this.playersProgress.find((p) => p.id === this.localPlayerId);
    if (myHud) {
      this.uiManager.updateHUD(Math.min(myHud.lap, this.maxLaps), this.maxLaps, 0, myHud.rank);
    }
  }

  startCountdown(startTime) {
    const t = Number(startTime);
    this.raceStartTime = Number.isFinite(t) ? t : Date.now() + 4000;
    console.log(`[COUNTDOWN START] raceEpoch=${this._raceEpoch}, startAt=${this.raceStartTime}`);

    const epochAtCountdown = this._raceEpoch;

    const myProg0 = this.playersProgress.find((p) => p.id === this.localPlayerId);
    this.uiManager.updateHUD(
      Math.min(myProg0?.lap ?? 1, this.maxLaps),
      this.maxLaps,
      0,
      myProg0?.rank ?? 1
    );

    const countLoop = () => {
      if (this._raceEpoch !== epochAtCountdown) return;
      const now = Date.now();
      const diff = this.raceStartTime - now;

      try {
        if (diff > 0) {
          this.uiManager.showCountdown(Math.ceil(diff / 1000));
          this.draw();
          requestAnimationFrame(countLoop);
        } else {
          console.log(`[RACE START] GO! raceId: ${this.currentRaceId}`);
          this.uiManager.showCountdown(0);
          setTimeout(() => this.uiManager.hideCountdown(), 1000);
          this.startLoop(epochAtCountdown);
        }
      } catch (e) {
        console.error('[COUNTDOWN]', e);
        if (this._raceEpoch === epochAtCountdown) {
          this.startLoop(epochAtCountdown);
        }
      }
    };
    requestAnimationFrame(countLoop);
  }

  startLoop(epochAtStart) {
    if (epochAtStart != null && this._raceEpoch !== epochAtStart) return;
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    const loopEpoch = this._raceEpoch;
    requestAnimationFrame(() => this.gameLoop(loopEpoch));
  }

  gameLoop(epochAtStart) {
    if (!this.isRunning) return;
    if (epochAtStart != null && this._raceEpoch !== epochAtStart) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    try {
      this.update(dt);

      const resized = this.trackManager.resizeIfNeeded();
      if (resized) {
        this.trackManager.fitCameraToTrack();
        this.camera.zoom = this.trackManager.cameraZoom;
      }

      /* Feste Kartenmitte (Sand + Forest) — kein Nachfahren des Autos */
      this.camera.x = this.trackManager.cameraOffset.x;
      this.camera.y = this.trackManager.cameraOffset.y;
      this.camera.zoom = this.trackManager.cameraZoom;

      this.trackManager.cameraOffset = { x: this.camera.x, y: this.camera.y };
      this.trackManager.cameraZoom = this.camera.zoom;

      const myProg = this.playersProgress.find((p) => p.id === this.localPlayerId);
      if (myProg && !myProg.finished) {
        const elapsed = Date.now() - this.raceStartTime;
        this.uiManager.updateHUD(Math.min(myProg.lap, this.maxLaps), this.maxLaps, Math.max(0, elapsed), myProg.rank);
      }

      this.draw();
      /* draw() kann bei Resize fitCameraToTrack ausführen — Zoom für den nächsten Frame übernehmen */
      this.camera.zoom = this.trackManager.cameraZoom;
    } catch (e) {
      console.error('[GAMELOOP]', e);
    }

    if (this.isRunning && (epochAtStart == null || this._raceEpoch === epochAtStart)) {
      requestAnimationFrame(() => this.gameLoop(epochAtStart));
    }
  }

  update(dt) {
    const isHost = this.gameManager.networkManager.isHost;
    const { sectors, finishLine } = this._gates;

    this.cars.forEach((car) => {
      const isLocal = car.id === this.localPlayerId;
      const progress = this.playersProgress.find((p) => p.id === car.id);
      if (progress && progress.finished) return;

      let inputs = { accelerate: false, brake: false, left: false, right: false };

      if (isLocal) {
        const allowInput = progress && !progress.finished;
        inputs = this.inputManager.getInputs(allowInput);
      } else if (!car.isHuman && isHost) {
        const bot = this.bots.find((b) => b.car === car);
        if (bot) inputs = bot.getInputs(dt, this.cars, this.playersProgress);
      } else {
        return;
      }

      car.update(inputs, dt, this.trackManager);
      this.updateProgressGates(car, progress, sectors, finishLine);
    });

    this.updateRanks();

    const now = Date.now();
    if (now - this.lastSyncTime > 30) {
      this.sendSyncPackets();
      this.lastSyncTime = now;
    }
  }

  updateProgressGates(car, progress, sectors, finishLine) {
    if (!progress || !this.trackManager.mapData || progress.finished) return;

    if (sectors.length === 0 && finishLine) {
      this._finishLineOnlyLap(car, progress, finishLine);
      return;
    }

    if (sectors.length === 0 || !finishLine) {
      this._legacyCheckpointPass(car, progress);
      return;
    }

    if (progress.nextCheckpoint < sectors.length) {
      /* Nach Zieldurchfahrt bleibt _finishLatch sonst true, während wir wieder Sektoren abarbeiten → keine weitere Runde. */
      progress._finishLatch = false;
      const i = progress.nextCheckpoint;
      const cp = sectors[i];
      const inside = pointInRect(car.x, car.y, cp);
      if (inside && !progress._sectorLatch) {
        progress.nextCheckpoint++;
        progress._sectorLatch = true;
        console.log(`[CHECKPOINT PASSED] ${progress.name} sector ${i + 1}/${sectors.length}`);
      }
      if (!inside) progress._sectorLatch = false;
      return;
    }

    const insideF = pointInRect(car.x, car.y, finishLine);
    if (insideF && !progress._finishLatch) {
      progress._finishLatch = true;
      console.log(`[FINISH LINE HIT] ${progress.name}`);
      progress.lap++;
      progress.nextCheckpoint = 0;
      progress._sectorLatch = false;

      if (progress.lap > this.maxLaps) {
        this.finishPlayer(progress);
      } else {
        console.log(`[LAP COMPLETE] ${progress.name} -> lap ${progress.lap} / ${this.maxLaps}`);
      }
    }
    if (!insideF) progress._finishLatch = false;
  }

  /** Rundenlogik nur Ziellinie (keine Sektoren). Erst nach Verlassen der Linie wird die nächste Durchfahrt gezählt. */
  _finishLineOnlyLap(car, progress, finishLine) {
    const inside = pointInRect(car.x, car.y, finishLine);
    if (!inside) {
      progress._finishLatch = false;
      progress._armedForLap = true;
      return;
    }
    if (progress._armedForLap && !progress._finishLatch) {
      progress._finishLatch = true;
      progress.lap++;
      progress.nextCheckpoint = 0;
      progress._sectorLatch = false;
      if (progress.lap > this.maxLaps) {
        this.finishPlayer(progress);
      }
    }
  }

  _legacyCheckpointPass(car, progress) {
    const checkpoints = this.trackManager.mapData.checkpoints || [];
    if (checkpoints.length === 0) return;
    const cpIdx = progress.nextCheckpoint % checkpoints.length;
    const cp = checkpoints[cpIdx];
    if (!cp) return;
    const inside = pointInRect(car.x, car.y, cp);
    if (inside && !progress._sectorLatch) {
      progress._sectorLatch = true;
      progress.nextCheckpoint++;
      console.log(`[CHECKPOINT PASSED] ${progress.name} legacy index ${cpIdx}`);
      if (progress.nextCheckpoint >= checkpoints.length) {
        progress.nextCheckpoint = 0;
        progress.lap++;
        console.log(`[LAP COMPLETE] ${progress.name} - lap ${progress.lap}`);
        if (progress.lap > this.maxLaps) this.finishPlayer(progress);
      }
    }
    if (!inside) progress._sectorLatch = false;
  }

  updateRanks() {
    const { sectors, finishLine } = this._gates;
    this.playersProgress.forEach((p) => {
      if (p.finished) {
        p.distToNext = 1e6;
        return;
      }
      const car = this.cars.find((c) => c.id === p.id);
      if (car) {
        let tx;
        let ty;
        if (sectors.length && finishLine && p.nextCheckpoint < sectors.length) {
          const cp = sectors[p.nextCheckpoint];
          tx = cp.x;
          ty = cp.y;
        } else if (finishLine) {
          tx = finishLine.x;
          ty = finishLine.y;
        } else {
          const cps = this.trackManager.mapData.checkpoints || [];
          const cp = cps[p.nextCheckpoint % (cps.length || 1)] || { x: car.x, y: car.y };
          tx = cp.x;
          ty = cp.y;
        }
        p.distToNext = Math.hypot(tx - car.x, ty - car.y);
      }
    });

    this.playersProgress
      .slice()
      .sort((a, b) => {
        if (b.lap !== a.lap) return b.lap - a.lap;
        if (b.nextCheckpoint !== a.nextCheckpoint) return b.nextCheckpoint - a.nextCheckpoint;
        return a.distToNext - b.distToNext;
      })
      .forEach((p, i) => {
        if (p.rank !== i + 1) p.rank = i + 1;
      });
  }

  finishPlayer(progress) {
    if (progress.finished) return;
    this.finishCount++;
    progress.finished = true;
    progress.totalTime = Date.now() - this.raceStartTime;
    progress.placement = this.finishCount;

    const car = this.cars.find((c) => c.id === progress.id);
    if (car) {
      car.speed = 0;
    }

    console.log(
      `[PLAYER FINISHED] ${progress.name} place=${progress.placement} timeMs=${progress.totalTime} human=${progress.isHuman}`
    );

    this.tryScheduleRankingScreen();
  }

  tryScheduleRankingScreen() {
    const allDone = this.playersProgress.every((p) => p.finished);
    if (!allDone || this._endScreenScheduled) return;
    this._endScreenScheduled = true;
    console.log('[RANKING CREATED]');
    setTimeout(() => this.gameManager.showEndScreen(), 600);
  }

  sendSyncPackets() {
    const myCar = this.cars.find((c) => c.id === this.localPlayerId);
    const myProg = this.playersProgress.find((p) => p.id === this.localPlayerId);
    if (myCar && myProg && (!myProg.finished || !myProg._sentFinishSync)) {
      this.gameManager.networkManager.send({
        type: 'car_sync',
        lobbyId: this.gameManager.currentLobbyCode,
        raceId: this.currentRaceId,
        id: myCar.id,
        name: myProg.name,
        x: myCar.x,
        y: myCar.y,
        angle: myCar.angle,
        speed: myProg.finished ? 0 : myCar.speed,
        lap: myProg.lap,
        checkpointIndex: myProg.nextCheckpoint,
        finished: myProg.finished
      });
      if (myProg.finished) myProg._sentFinishSync = true;
    }

    if (this.gameManager.networkManager.isHost && this.bots.length > 0) {
      const botData = this.bots.map((b) => {
        const prog = this.playersProgress.find((p) => p.id === b.car.id);
        return {
          id: b.car.id,
          name: prog ? prog.name : b.car.name,
          x: b.car.x,
          y: b.car.y,
          angle: b.car.angle,
          speed: b.car.speed,
          lap: prog.lap,
          checkpointIndex: prog.nextCheckpoint,
          finished: prog.finished
        };
      });
      this.gameManager.networkManager.send({
        type: 'bot_sync',
        lobbyId: this.gameManager.currentLobbyCode,
        raceId: this.currentRaceId,
        bots: botData
      });
      if (Date.now() - this._lastBotHostLog > 1200) {
        console.log(`[BOT HOST UPDATE] bots=${this.bots.length} raceId=${this.currentRaceId}`);
        this._lastBotHostLog = Date.now();
      }
    }
  }

  syncRemotePlayer(data) {
    const id = String(data.id);
    if (id === this.localPlayerId) return;

    let car = this.cars.find((c) => c.id === id);
    let prog = this.playersProgress.find((p) => p.id === id);

    if (prog && prog.finished && !data.finished) {
      return;
    }

    if (!car) {
      console.log(`[REMOTE APPLY] New player car created: ${id}`);
      car = new CarController(data.x, data.y, data.angle, '#3b82f6', true, id, data.name || `Spieler ${id}`);
      this.cars.push(car);
      if (!prog) {
        prog = {
          id,
          name: data.name || `Spieler ${id}`,
          isHuman: true,
          lap: data.lap,
          nextCheckpoint: data.checkpointIndex,
          finished: !!data.finished,
          rank: 99,
          _sectorLatch: false,
          _finishLatch: false,
          _sentFinishSync: false,
          _armedForLap: false
        };
        this.playersProgress.push(prog);
      }
    }

    if (prog && prog.finished) return;

    if (prog && !prog.finished && data.finished) {
      car.applyPosition(data.x, data.y, data.angle);
      car.speed = 0;
      if (data.name) prog.name = String(data.name).replace(' (Du)', '').trim();
      if (data.name) car.name = String(data.name).replace(' (Du)', '').trim();
      prog.lap = data.lap;
      prog.nextCheckpoint = data.checkpointIndex;
      this.finishPlayer(prog);
      return;
    }

    if (!data.finished) {
      car.applyPosition(data.x, data.y, data.angle);
      car.speed = data.speed;
    }

    if (prog) {
      if (data.name) prog.name = String(data.name).replace(' (Du)', '').trim();
      prog.lap = data.lap;
      prog.nextCheckpoint = data.checkpointIndex;
      if (data.name) car.name = String(data.name).replace(' (Du)', '').trim();
    }
  }

  syncBots(data) {
    if (this.gameManager.networkManager.isHost) return;

    data.bots.forEach((bData) => {
      const id = String(bData.id);
      let car = this.cars.find((c) => c.id === id);
      let prog = this.playersProgress.find((p) => p.id === id);

      if (prog && prog.finished && !bData.finished) return;

      if (!car) {
        console.log(`[BOT APPLY] New bot car created: ${id}`);
        car = new CarController(bData.x, bData.y, bData.angle, '#94a3b8', false, id, bData.name || `Bot ${id}`);
        this.cars.push(car);
        if (!prog) {
          prog = {
            id,
            name: bData.name || `Bot ${id}`,
            isHuman: false,
            lap: bData.lap,
            nextCheckpoint: bData.checkpointIndex,
            finished: !!bData.finished,
            rank: 99,
            _sectorLatch: false,
            _finishLatch: false,
            _sentFinishSync: false,
            _armedForLap: false
          };
          this.playersProgress.push(prog);
        }
      }

      if (prog && prog.finished) return;

      if (prog && !prog.finished && bData.finished) {
        car.applyPosition(bData.x, bData.y, bData.angle);
        car.speed = 0;
        if (bData.name) {
          car.name = bData.name;
          prog.name = bData.name;
        }
        prog.lap = bData.lap;
        prog.nextCheckpoint = bData.checkpointIndex;
        this.finishPlayer(prog);
        return;
      }

      if (!bData.finished) {
        car.applyPosition(bData.x, bData.y, bData.angle);
        car.speed = bData.speed;
      }
      if (bData.name) {
        car.name = bData.name;
        if (prog) prog.name = bData.name;
      }
      if (prog) {
        prog.lap = bData.lap;
        prog.nextCheckpoint = bData.checkpointIndex;
      }
    });
  }

  draw() {
    this.trackManager.draw(
      this.cars,
      (ctx) => {
        this.cars.forEach((car) => {
          const prog = this.playersProgress.find((p) => p.id === car.id);
          const rank = prog ? prog.rank : null;
          car.drawLabel(ctx, rank, { hide: prog ? prog.finished : false });
        });
      },
      (car) => {
        const prog = this.playersProgress.find((p) => p.id === car.id);
        return !prog || !prog.finished;
      }
    );
  }
}
