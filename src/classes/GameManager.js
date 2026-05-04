// CL / RM
import { UIManager } from './UIManager.js';
import { LobbyManager, clampLobbyPlayers } from './LobbyManager.js';
import { MapSelection } from './MapSelection.js';
import { RaceManager } from './RaceManager.js';
import { NetworkManager } from './NetworkManager.js';

/**
 * GAME MANAGER (REWRITE - FULL SYNC)
 * Responsibilities: Screen transitions, Global State, Network Message Hub.
 */
export class GameManager {
  constructor() {
    this.networkManager = new NetworkManager(this);
    this.uiManager = new UIManager();
    this.mapSelection = new MapSelection(this);
    this.lobbyManager = new LobbyManager(this);
    this.raceManager = new RaceManager(this);
    
    this.state = 'start'; 
    this.localPlayerId = String(Math.floor(Math.random() * 10000)); // Unique ID per session
    this.playerName = localStorage.getItem('vektor_player_name') || '';
    console.log(`[PLAYER NAME LOADED] playerId: ${this.localPlayerId}, name: ${this.playerName}`);
    this.currentLobbyCode = '';

    // CRITICAL: Bind network callback
    this.networkManager.onDataReceived = (data, peerId) => this.handleNetworkData(data, peerId);

    this.bindEvents();
  }

  init() {
    this.uiManager.showScreen('start');
    const nameInput = document.getElementById('player-name-input-start');
    if (nameInput) nameInput.value = this.playerName;
  }

  bindEvents() {
    document.getElementById('btn-create-lobby').addEventListener('click', () => this.createLobby());
    document.getElementById('btn-join-lobby').addEventListener('click', () => this.uiManager.showScreen('joinLobby'));
    document.getElementById('btn-confirm-join').addEventListener('click', () => this.joinLobby());
    document.getElementById('btn-cancel-join').addEventListener('click', () => this.uiManager.showScreen('start'));
    document.getElementById('btn-to-menu').addEventListener('click', () => this.goToStartMenu());
    document.getElementById('btn-kicked-ok').addEventListener('click', () => {
        document.getElementById('kicked-overlay').classList.add('hidden');
        this.goToStartMenu();
    });

    // Setup Modal buttons
    document.getElementById('btn-setup-confirm').addEventListener('click', () => this.confirmLobbySetup());
    document.getElementById('btn-setup-cancel').addEventListener('click', () => {
        document.getElementById('player-count-overlay').classList.add('hidden');
    });
  }

  goToStartMenu() {
    this.raceManager.stopRaceAndReset();
    this.state = 'start';
    this.lobbyManager.setLiveChatRaceMode(false);
    this.uiManager.showScreen('start');
  }

  returnToLobby() {
    this.raceManager.stopRaceAndReset();
    this.state = 'lobby';
    this.lobbyManager.resetAfterRace();
    this.lobbyManager.setLiveChatRaceMode(false);
    this.uiManager.showScreen('lobby-screen');
  }

  createLobby() {
    const nameInput = document.getElementById('player-name-input-start');
    const name = nameInput.value.trim();
    if (!name) {
        alert("Bitte gib einen Namen ein!");
        return;
    }
    this.playerName = name;
    localStorage.setItem('vektor_player_name', name);

    console.log('[LOBBY SETUP OPEN]');
    this.showPlayerCountSetup();
  }

  showPlayerCountSetup() {
    const overlay = document.getElementById('player-count-overlay');
    const grid = document.getElementById('player-count-grid');
    grid.innerHTML = '';
    
    [2, 3, 4].forEach((count) => {
      const btn = document.createElement('button');
      btn.className = 'player-count-btn';
      if (count === 4) btn.classList.add('selected');
      btn.innerHTML = `${count}<span>Spieler</span>`;
      btn.dataset.count = count;
      btn.onclick = () => {
        document.querySelectorAll('.player-count-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        console.log(`[LOBBY SIZE SELECTED] size: ${count}`);
      };
      grid.appendChild(btn);
    });

    overlay.classList.remove('hidden');
  }

  confirmLobbySetup() {
    const selectedBtn = document.querySelector('.player-count-btn.selected');
    const lobbySize = clampLobbyPlayers(selectedBtn ? parseInt(selectedBtn.dataset.count, 10) : 4);
    
    document.getElementById('player-count-overlay').classList.add('hidden');

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    this.currentLobbyCode = code;

    this.showLobbyInfoModal(code, lobbySize);
  }

  showLobbyInfoModal(code, lobbySize) {
    console.log(`[INFO MODAL SHOW] lobbyCode: ${code}`);
    const overlay = document.getElementById('lobby-info-overlay');
    const codeDisplay = document.getElementById('info-modal-code');
    if (codeDisplay) codeDisplay.textContent = `#${code}`;
    overlay.classList.remove('hidden');

    const okBtn = document.getElementById('btn-lobby-info-ok');
    okBtn.onclick = () => {
      console.log('[INFO MODAL CONFIRM]');
      overlay.classList.add('hidden');
      this.startHosting(code, lobbySize);
    };
  }

  startHosting(code, lobbySize) {
    console.log(`[CREATE LOBBY] lobbyId: vektor-race-${code}, lobbyCode: ${code}, lobbySize: ${lobbySize}, hostId: ${this.localPlayerId}`);
    
    this.networkManager.hostLobby(code, (success) => {
      if (success) {
        this.state = 'lobby';
        this.lobbyManager.init(false, this.playerName, code, lobbySize);
        this.uiManager.showScreen('lobby-screen');
      }
    });
  }

  joinLobby() {
    const nameInput = document.getElementById('join-name-input');
    const name = nameInput.value.trim();
    if (!name) {
        alert("Bitte gib einen Namen ein!");
        return;
    }
    this.playerName = name;
    localStorage.setItem('vektor_player_name', name);
    console.log(`[PLAYER NAME SET] playerId: ${this.localPlayerId}, name: ${this.playerName}`);

    const codeInput = document.getElementById('join-code-input').value.trim();
    if (!codeInput) return;
    const code = codeInput;
    this.currentLobbyCode = code;
    console.log(`[JOIN CODE ENTERED] code: ${code}`);
    console.log(`[JOIN WITH NAME] lobbyCode: ${code}, playerId: ${this.localPlayerId}, name: ${this.playerName}`);
    
    this.networkManager.joinLobby(code, (success) => {
      if (success) {
        this.state = 'lobby';
        console.log(`[JOIN LOBBY SUCCESS] code: ${code}, localId: ${this.localPlayerId}, name: ${this.playerName}`);
        this.lobbyManager.init(true, this.playerName, code);
        this.uiManager.showScreen('lobby-screen');
      } else {
        alert("Lobby nicht gefunden!");
      }
    });
  }

  buildRacePayloadFromLobby() {
    const lm = this.lobbyManager;
    const map = this.mapSelection.maps[lm.currentMapIndex];
    const lobbySize = clampLobbyPlayers(lm.totalPlayers || (lm.players && lm.players.length) || 2);
    const localPid = String(this.localPlayerId);
    /** Race-Car-ID muss mit gameManager.localPlayerId übereinstimmen, sonst bleibt das eigene Auto in update() „eingefroren“. */
    const players = lm.players.map((p) => {
      const isHuman = !!p.isHuman;
      const net = p.networkId != null && String(p.networkId) !== '' ? String(p.networkId) : '';
      const sid = String(p.id);
      const isLocalHuman = isHuman && (net === localPid || sid === localPid);
      const carId = isHuman ? (isLocalHuman ? localPid : net || sid) : sid;
      let name = (p.name || '').replace(' (Du)', '').trim();
      if (!isHuman) {
        name = name || `Bot ${Math.max(1, Number(p.id) - 1)}`;
      } else if (!name) {
        name = `Spieler ${carId}`;
      }
      return { id: carId, name, color: p.color, isHuman };
    });

    return {
      lapsToWin: lm.rounds,
      aiDifficulty: lm.difficulty,
      lobbySize,
      mapId: map.id,
      players
    };
  }

  startRace(raceId, raceSeed) {
    const rs = this.buildRacePayloadFromLobby();
    console.log(
      `[LOBBY SETTINGS] lapsToWin=${rs.lapsToWin}, aiDifficulty=${rs.aiDifficulty}, lobbySize=${rs.lobbySize}`
    );
    console.log(`[RACE STATE CREATED BY HOST] lobbyId: ${this.currentLobbyCode}, raceId: ${raceId}`);

    const data = {
      type: 'pre_start_race',
      mapId: rs.mapId,
      players: rs.players,
      lapsToWin: rs.lapsToWin,
      aiDifficulty: rs.aiDifficulty,
      lobbySize: rs.lobbySize,
      rounds: rs.lapsToWin,
      difficulty: rs.aiDifficulty,
      raceSeed: raceSeed,
      raceId: raceId,
      raceStartTime: Date.now() + 4000
    };

    console.log(`[RACE STATE SENT] Broadcasting to all peers...`);
    this.networkManager.broadcast(data);
    this.prepareRace(data);
  }

  handleNetworkData(data, peerId) {
    if (!data || !data.type) return;

    // Normalize IDs
    const senderId = data.id ? String(data.id) : null;

    switch (data.type) {
      case 'lobby_sync':
        this.lobbyManager.updateFromHost(data);
        break;
      case 'join_lobby':
        if (this.networkManager.isHost) {
            this.lobbyManager.addNetworkPlayer(data.name, data.playerId);
        }
        break;
      case 'ready_toggle':
        if (this.networkManager.isHost) {
          this.lobbyManager.applyReadyFromNetwork(data.id, data.isReady);
        }
        break;
      case 'pre_start_race':
        console.log(`[RACE STATE RECEIVED] hostMapId: ${data.mapId}, raceId: ${data.raceId}`);
        console.log(`[RACE STATE APPLIED] Syncing to host's race configuration.`);
        this.prepareRace(data);
        break;
      case 'car_sync':
        if (this.state === 'game') {
          // console.log(`[RACE NET RECEIVE] car_sync from ${senderId}`);
          this.raceManager.syncRemotePlayer(data);
        }
        break;
      case 'bot_sync':
        if (this.state === 'game') {
          // console.log(`[RACE NET RECEIVE] bot_sync from host`);
          this.raceManager.syncBots(data);
        }
        break;
      case 'chat_message':
        if (this.state === 'game') break;
        if (data.lobbyId === this.currentLobbyCode) {
          console.log(`[CHAT RECEIVE] lobbyId: ${data.lobbyId}, senderId: ${data.senderId}, text: ${data.text}`);
          this.lobbyManager.addChatMessage(data.name, data.text, false, false, data.senderId);
        } else {
          console.log(`[IGNORE OLD CHAT] messageLobbyId: ${data.lobbyId}, currentLobbyId: ${this.currentLobbyCode}`);
        }
        break;
      case 'kicked':
        console.log(`[KICKED BY HOST] reason: ${data.reason}`);
        this.lobbyManager.setLiveChatRaceMode(false);
        this.uiManager.showScreen('start');
        document.getElementById('kicked-overlay').classList.remove('hidden');
        break;
    }
  }

  prepareRace(data) {
    this.state = 'game';
    const mapId = data.mapId != null ? data.mapId : this.mapSelection.maps[this.lobbyManager.currentMapIndex]?.id;
    let map = this.mapSelection.getMapById(mapId);
    if (!map) {
      console.warn(`[RACE] Unknown mapId ${mapId}, using first map.`);
      map = this.mapSelection.maps[0];
    }
    const lapsToWin = data.lapsToWin != null ? data.lapsToWin : data.rounds;
    const aiDifficulty = data.aiDifficulty != null ? data.aiDifficulty : data.difficulty;
    let lobbySize =
      data.lobbySize != null ? data.lobbySize : Array.isArray(data.players) ? data.players.length : undefined;
    if (lobbySize != null) lobbySize = clampLobbyPlayers(lobbySize);

    console.log(
      `[RACE SETTINGS APPLIED] lapsToWin=${lapsToWin}, aiDifficulty=${aiDifficulty}, lobbySize=${lobbySize}`
    );
    console.log(`[MAP LOAD] loadedTrackName: ${map.name}, mapId: ${map.id}`);

    const players = Array.isArray(data.players) ? data.players : [];
    const normalizedPlayers = this.normalizeRacePlayersFromPayload(players, lobbySize);

    /** Spiel-Screen zuerst: Canvas hat dann echte Größe (nicht display:none) — sonst können draw/init hängen bleiben. */
    this.uiManager.showScreen('game');

    this.raceManager.initRace(normalizedPlayers, map, lapsToWin, data.raceSeed, aiDifficulty, data.raceId, {
      lobbySize,
      mapId: map.id
    });
    this.raceManager.inputManager.resetKeys();
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    this.lobbyManager.setLiveChatRaceMode(true);
    this.raceManager.startCountdown(data.raceStartTime);
  }

  /**
   * Stellt sicher: Anzahl Autos = Lobby-Spielerliste, lokales Auto nutzt immer localPlayerId als id.
   */
  normalizeRacePlayersFromPayload(players, lobbySize) {
    const localPid = String(this.localPlayerId);
    const capped = clampLobbyPlayers(lobbySize != null ? lobbySize : players.length || 2);
    const n = Math.min(players.length, capped);
    const list = players.slice(0, n);
    return list.map((p, idx) => {
      const isHuman = p.isHuman !== false;
      if (!isHuman) return { ...p, id: String(p.id != null ? p.id : ''), isHuman: false };
      const net = p.networkId != null && String(p.networkId) !== '' ? String(p.networkId) : '';
      const sid = String(p.id != null ? p.id : '');
      const isLocalHuman = net === localPid || sid === localPid;
      const id = isLocalHuman ? localPid : net || sid || `h-${idx}`;
      return { ...p, id, isHuman: true };
    });
  }

  showEndScreen() {
    this.raceManager.stopGameplayLoop();
    this.state = 'end';
    this.lobbyManager.setLiveChatRaceMode(false);
    const sorted = this.raceManager.playersProgress
      .filter((p) => p.finished && p.placement != null)
      .sort((a, b) => (a.placement || 99) - (b.placement || 99));
    const results = sorted.map((p) => {
      const car = this.raceManager.cars.find((c) => c.id === p.id);
      return {
        id: p.id,
        name: p.name,
        totalTime: p.totalTime || 0,
        color: car ? car.color : '#94a3b8',
        isHuman: p.isHuman !== false
      };
    });
    this.uiManager.showEndScreen(results, this.localPlayerId);
  }
}
