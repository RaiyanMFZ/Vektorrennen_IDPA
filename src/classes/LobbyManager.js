// RM
/** Host/join lobby capacity (UI + sync). */
export const LOBBY_PLAYER_MIN = 2;
export const LOBBY_PLAYER_MAX = 4;

export function clampLobbyPlayers(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return LOBBY_PLAYER_MAX;
  return Math.min(LOBBY_PLAYER_MAX, Math.max(LOBBY_PLAYER_MIN, Math.floor(v)));
}

export class LobbyManager {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this.slotsContainer = document.getElementById('lobby-slots');
    this.btnStartRace = document.getElementById('btn-start-race');
    this.btnLeave = document.getElementById('btn-leave-lobby');
    this.statusText = document.getElementById('lobby-status');
    this.chatInput = document.getElementById('chat-input');
    this.btnSendChat = document.getElementById('btn-send-chat');
    this.chatMessages = document.getElementById('chat-messages');
    
    this.globalChat = document.getElementById('global-chat-container');
    this.chatWindow = document.getElementById('chat-window');
    this.chatToggle = document.getElementById('chat-toggle-btn');
    this.chatClose = document.getElementById('btn-close-chat');
    this.notificationDot = document.getElementById('chat-notification-dot');

    this.isChatOpen = false;
    this.unreadCount = 0;

    // Default colors for players
    this.availableColors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
    
    this.players = [];

    // Map selection in lobby
    this.maps = this.gameManager.mapSelection.maps;
    this.currentMapIndex = 0;
    this.rounds = 4;
    this.difficulty = 'Mittel';
    this.bannedPlayers = []; // List of IDs that are not allowed to join THIS lobby

    this.mapPreviewImage = document.getElementById('map-preview-image');

    this.bindEvents();
  }

  bindEvents() {
    this.btnStartRace.addEventListener('click', () => {
      // Only host can start
      if (!this.gameManager.networkManager.isHost) return;

      if (this.checkAllReady()) {
        const raceId = Math.floor(Date.now()).toString();
        const raceSeed = Math.floor(Math.random() * 1000000);
        this.gameManager.startRace(raceId, raceSeed);
      }
    });

    this.btnLeave.addEventListener('click', () => {
      this.gameManager.goToStartMenu();
    });

    // Map selectors
    document.getElementById('btn-map-prev').addEventListener('click', () => this.changeMap(-1));
    document.getElementById('btn-map-next').addEventListener('click', () => this.changeMap(1));
    
    // Lap selectors
    document.getElementById('btn-laps-prev').addEventListener('click', () => this.changeRounds(-1));
    document.getElementById('btn-laps-next').addEventListener('click', () => this.changeRounds(1));

    // Difficulty selectors
    document.getElementById('btn-diff-prev').addEventListener('click', () => this.changeDifficulty(-1));
    document.getElementById('btn-diff-next').addEventListener('click', () => this.changeDifficulty(1));

    // Chat events
    this.btnSendChat.addEventListener('click', () => this.sendChatMessage());
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChatMessage();
    });

    this.chatToggle.addEventListener('click', () => this.toggleChat());
    this.chatClose.addEventListener('click', () => this.toggleChat(false));

    /* Ein Listener — funktioniert zuverlässiger auf Touch nach innerHTML-Updates */
    this.slotsContainer.addEventListener('click', (e) => {
      const ready = e.target.closest('.ready-toggle-btn');
      if (ready) {
        this.toggleReady(ready.dataset.id);
        return;
      }
      const kick = e.target.closest('.kick-btn');
      if (kick) {
        this.kickPlayer(kick.dataset.id);
        return;
      }
      const color = e.target.closest('.color-btn');
      if (color && color.dataset.id != null && color.dataset.color != null) {
        this.changeColor(color.dataset.id, color.dataset.color);
      }
    });
  }

  init(isJoining = false, playerName = 'Spieler 1', lobbyCode = '#0000', totalPlayers = 4) {
    const cap = clampLobbyPlayers(totalPlayers);
    console.log(`[CLEAR OLD LOBBY STATE] lobbyCode: ${lobbyCode}, totalPlayers: ${totalPlayers} → capped ${cap}`);
    this.bannedPlayers = [];
    this.totalPlayers = cap;
    
    // Explicitly reset settings to default
    this.rounds = 4;
    this.difficulty = 'Mittel';
    console.log(`[NEW LOBBY SETTINGS RESET] lapsToWin=${this.rounds}, aiDifficulty=${this.difficulty}`);
    document.getElementById('settings-laps').textContent = this.rounds;
    document.getElementById('settings-diff').textContent = this.difficulty;
    console.log(
      `[LOBBY SETTINGS] lapsToWin=${this.rounds}, aiDifficulty=${this.difficulty}, lobbySize=${this.totalPlayers}`
    );

    // Build fresh slot list
    const localId = String(this.gameManager.localPlayerId);
    const isHost = this.gameManager.networkManager.isHost;
    const firstSlotId = isHost ? 1 : localId;
    const slots = [
      { id: firstSlotId, networkId: localId, name: `${playerName} (Du)`, isHuman: true, isReady: false, color: this.availableColors[0], isHost: isHost }
    ];
    for (let i = 2; i <= cap; i++) {
      slots.push({
        id: i,
        name: `Bot ${i - 1}`,
        isHuman: false,
        isReady: true,
        color: this.availableColors[(i - 1) % this.availableColors.length]
      });
    }
    this.players = slots;

    const isHostNow = this.gameManager.networkManager.isHost;
    console.log(`[HOST CHECK] localId: ${localId}, isHost: ${isHostNow}`);

    // Update code display
    document.querySelector('.code-value').textContent = lobbyCode.startsWith('#') ? lobbyCode : `#${lobbyCode}`;

    // Host only UI
    if (isHostNow) {
        this.btnStartRace.classList.remove('hidden');
        document.querySelectorAll('.selector-btn').forEach(btn => btn.classList.remove('hidden'));
    } else {
        this.btnStartRace.classList.add('hidden');
        document.querySelectorAll('.selector-btn').forEach(btn => btn.classList.add('hidden'));
    }

    if (this.globalChat) {
      this.globalChat.classList.remove('hidden');
    }
    this.unreadCount = 0;
    this.updateNotificationDot();
    this.chatMessages.innerHTML = '<div class="chat-msg system">Willkommen im Chat!</div>';
    this.toggleChat(false);

    this.renderSlots();
    this.updateMapPreview();
    this.checkAllReady();
    this.setLiveChatRaceMode(false);

    if (isHostNow) {
        this.broadcastState();
    } else {
        console.log(`[JOIN LOBBY SUCCESS] Sending join packet to host for ${playerName}`);
        this.gameManager.networkManager.send({
            type: 'join_lobby',
            lobbyId: lobbyCode,
            name: playerName,
            playerId: localId
        });
    }
  }

  addNetworkPlayer(name, playerId) {
    const pId = String(playerId);
    console.log(`[JOIN SUCCESS] lobbyId: ${this.gameManager.currentLobbyCode}, playerId: ${pId}`);
    
    // Check for ban
    if (this.bannedPlayers.includes(pId)) {
      console.log(`[JOIN BLOCKED] Lobby ${this.gameManager.currentLobbyCode}, Player ${pId} is banned.`);
      this.gameManager.networkManager.sendToPeer(pId, { type: 'kicked', reason: 'ban' });
      return;
    }

    // [JOIN CHECK DUPLICATE]
    const existingPlayer = this.players.find(p => String(p.networkId) === pId);
    if (existingPlayer) {
      console.log(`[JOIN CHECK DUPLICATE] Player ${name} already in lobby. Updating name.`);
      existingPlayer.name = name;
      existingPlayer.isHuman = true;
      this.renderSlots();
      this.broadcastState();
      return;
    }

    // [JOIN REPLACE BOT]
    const nextSlot = this.players.find(p => !p.isHuman);
    if (nextSlot) {
      console.log(`[JOIN REPLACE BOT] slotId: ${nextSlot.id}, playerId: ${pId}, name: ${name}`);
      nextSlot.networkId = pId;
      nextSlot.name = name;
      nextSlot.isHuman = true;
      nextSlot.isReady = false;
      
      this.normalizeLobbySlots();
      this.renderSlots();
      this.broadcastState();
    } else {
      console.warn('[LOBBY FULL] No bot slots available to replace.');
    }
  }

  normalizeLobbySlots() {
    const total = clampLobbyPlayers(this.totalPlayers || this.players.length || LOBBY_PLAYER_MAX);
    const beforeSlots = JSON.stringify(this.players.map(p => ({ id: p.id, name: p.name, human: p.isHuman })));
    console.log(`[LOBBY NORMALIZE BEFORE] slots: ${beforeSlots}`);

    // 1. Collect unique humans (no duplicate networkIds)
    const uniqueHumans = [];
    const seenIds = new Set();
    this.players.forEach(p => {
      if (p.isHuman) {
        const netId = p.networkId ? String(p.networkId) : String(p.id);
        if (!seenIds.has(netId)) {
          seenIds.add(netId);
          uniqueHumans.push(p);
        }
      }
    });

    // 2. Re-create slots up to totalPlayers
    const newPlayers = [];
    const host = uniqueHumans[0] || { id: 1, name: 'Host', isHuman: true, isReady: false, color: this.availableColors[0] };
    host.id = 1;
    // CRITICAL: Ensure host has its networkId even if re-created
    if (!host.networkId && this.gameManager.networkManager.isHost) {
        host.networkId = String(this.gameManager.localPlayerId);
    }
    newPlayers.push(host);

    for (let i = 1; i < total; i++) {
      if (uniqueHumans[i]) {
        const p = uniqueHumans[i];
        p.id = i + 1;
        newPlayers.push(p);
      } else {
        newPlayers.push({
          id: i + 1,
          name: `Bot ${i}`,
          isHuman: false,
          isReady: true,
          color: this.availableColors[i % this.availableColors.length]
        });
      }
    }

    this.players = newPlayers;
    const afterSlots = JSON.stringify(this.players.map(p => ({ id: p.id, name: p.name, human: p.isHuman })));
    console.log(`[LOBBY NORMALIZE AFTER] slots: ${afterSlots}`);
  }

  replaceHumanWithBot(id, reason = 'leave') {
    const slot = this.players.find(p => String(p.id) === String(id));
    if (slot && slot.isHuman) {
      console.log(`[BOT REPLACEMENT] Replacing slot ${id} with Bot. Reason: ${reason}`);
      slot.isHuman = false;
      slot.isReady = true;
      slot.networkId = null;
      slot.name = `Bot ${slot.id - 1}`;
      
      this.renderSlots();
      this.checkAllReady();
      this.broadcastState();
    }
  }

  updateFromHost(data) {
    const state = data.state;
    if (!state) return;
    
    const currentCode = this.gameManager.currentLobbyCode;
    const incomingCode = state.lobbyCode;
    console.log(`[LOBBY UPDATE RECEIVED] lobbyId: ${incomingCode}, currentLobbyId: ${currentCode}`);
    
    if (incomingCode && incomingCode !== currentCode) {
      console.warn(`[IGNORE OLD LOBBY UPDATE] updateLobbyId: ${incomingCode}, currentLobbyId: ${currentCode}`);
      return;
    }

    console.log(`[LOBBY UPDATE] Received sync from host for code: ${incomingCode}`);
    console.log(
      `[LOBBY UPDATE RECEIVED] slots=${JSON.stringify(
        (state.players || []).map((s) => ({
          id: s.id,
          networkId: s.networkId,
          type: s.isHuman ? 'human' : 'bot',
          ready: !!s.isReady
        }))
      )}`
    );

    if (state.bannedPlayers) this.bannedPlayers = state.bannedPlayers;
    this.players = Array.isArray(state.players) ? state.players : this.players;
    this.totalPlayers = clampLobbyPlayers(
      state.totalPlayers != null ? state.totalPlayers : this.players.length || this.totalPlayers || LOBBY_PLAYER_MAX
    );
    this.normalizeLobbySlots();
    const maxMap = Math.max(0, this.maps.length - 1);
    const mi = Number(state.mapIndex);
    this.currentMapIndex = Number.isFinite(mi) ? Math.max(0, Math.min(mi, maxMap)) : 0;
    this.rounds = state.lapsToWin != null ? state.lapsToWin : state.rounds;
    this.difficulty = state.aiDifficulty != null ? state.aiDifficulty : state.difficulty;
    
    document.getElementById('settings-laps').textContent = this.rounds;
    document.getElementById('settings-diff').textContent = this.difficulty;
    
    // Mark 'Du' for the client correctly
    const localId = String(this.gameManager.localPlayerId);
    this.players.forEach(p => {
        const isMe = String(p.networkId) === localId || String(p.id) === localId;
        if (isMe) {
            if (!p.name.includes('(Du)')) p.name += ' (Du)';
        } else {
            p.name = p.name.replace(' (Du)', '');
        }
    });

    this.renderSlots();
    this.updateMapPreview();
    this.checkAllReady();
  }

  changeMap(dir) {
    if (!this.gameManager.networkManager.isHost && this.gameManager.networkManager.connection) return;
    const n = this.maps.length;
    if (n === 0) return;
    this.currentMapIndex = (this.currentMapIndex + dir + n) % n;
    console.log(`[MAP SELECT] Index changed to: ${this.currentMapIndex} (${this.maps[this.currentMapIndex].id})`);
    this.updateMapPreview();
    this.broadcastState();
  }

  changeRounds(dir) {
    if (!this.gameManager.networkManager.isHost && this.gameManager.networkManager.connection) return;
    this.rounds = Math.max(3, Math.min(7, this.rounds + dir));
    document.getElementById('settings-laps').textContent = this.rounds;
    this.broadcastState();
  }

  changeDifficulty(dir) {
    if (!this.gameManager.networkManager.isHost && this.gameManager.networkManager.connection) return;
    const diffs = ['Leicht', 'Mittel', 'Schwer'];
    let idx = diffs.indexOf(this.difficulty);
    idx = (idx + dir + diffs.length) % diffs.length;
    this.difficulty = diffs[idx];
    document.getElementById('settings-diff').textContent = this.difficulty;
    this.broadcastState();
  }

  selectColor(playerId, color) {
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      player.color = color;
      this.renderSlots();
      this.broadcastState();
    }
  }

  updateMapPreview() {
    const isHost = this.gameManager.networkManager.isHost;
    const settingsPanel = document.querySelector('.lobby-settings-panel');
    if (settingsPanel) {
      if (!isHost) settingsPanel.classList.add('locked');
      else settingsPanel.classList.remove('locked');
    }

    let map = this.maps[this.currentMapIndex];
    if (!map) {
        console.warn("[DEFAULT MAP USED] Selected map missing. Using fallback.");
        map = this.maps[0];
        this.currentMapIndex = 0;
    }
    
    document.getElementById('settings-map-name').textContent = map.name || "Sand Circuit";
    document.getElementById('current-map-name').textContent = map.name || "Sand Circuit";
    
    if (this.mapPreviewImage) {
      this.mapPreviewImage.src = map.image || '';
      this.mapPreviewImage.onerror = () => {
        this.mapPreviewImage.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='; // Transparent pixel
      };
    }
  }

  renderSlots() {
    this.slotsContainer.innerHTML = '';

    const count = this.players.length;
    // Always show ALL cards in ONE row — no wrapping
    this.slotsContainer.style.gridTemplateColumns = `repeat(${count}, 1fr)`;
    this.slotsContainer.dataset.count = count;
    
    this.players.forEach((player) => {
      const card = document.createElement('div');
      card.className = `lobby-slot-card ${player.isReady ? 'ready' : ''}`;
      
      const localId = String(this.gameManager.localPlayerId);
      // ALWAYS use networkId for identifying "Me" in multiplayer
      const isMySlot = String(player.networkId) === localId;
      
      // Update UI inputs with current name if it's me
      if (isMySlot) {
          const startInput = document.getElementById('player-name-input-start');
          const joinInput = document.getElementById('join-name-input');
          const cleanName = player.name.replace(' (Du)', '');
          if (startInput) startInput.value = cleanName;
          if (joinInput) joinInput.value = cleanName;
      }

      const displayName = isMySlot ? `${player.name.replace(' (Du)', '')} (Du)` : player.name.replace(' (Du)', '');
      const typeLabel = player.isHost ? '👑 Host' : (player.isHuman ? 'Mensch' : 'KI-Bot');

      card.innerHTML = `
        <div class="card-header">
          <div class="player-name-display ${isMySlot ? 'is-me' : ''}">
            ${displayName}
          </div>
          <span class="player-type-badge">${typeLabel}</span>
        </div>
        
        <div class="car-preview-box">
          <canvas class="car-preview-canvas" id="car-canvas-${player.id}"></canvas>
        </div>

        <div class="slot-color-picker">
          ${this.availableColors.map(color => `
            <button type="button" class="color-btn ${player.color === color ? 'selected' : ''}" 
                    style="background-color: ${color}"
                    data-id="${player.id}" data-color="${color}"></button>
          `).join('')}
        </div>

        <div class="ready-status">
          <div class="check-icon">✔</div>
          ${player.isHuman ? `
            ${(() => {
              const showReady = isMySlot;
              console.log(
                `[READY BUTTON RENDER] playerId=${player.networkId || player.id}, visible=${showReady}`
              );
              return showReady
                ? `<button type="button" class="btn ${player.isReady ? 'secondary' : 'primary'} ready-toggle-btn" data-id="${player.id}">
                ${player.isReady ? 'BEREIT' : 'NICHT BEREIT'}
              </button>`
                : `<span class="other-ready-label">${player.isReady ? 'BEREIT' : 'WARTET...'}</span>`;
            })()}
          ` : `
            <span class="bot-ready-label">AUTOMATISCH BEREIT</span>
          `}
          ${(this.gameManager.networkManager.isHost && player.isHuman && !isMySlot) ? `
            <button type="button" class="btn danger kick-btn" data-id="${player.id}">KICKEN</button>
          ` : ''}
        </div>
      `;

      this.slotsContainer.appendChild(card);
      this.drawCarPreview(player.id, player.color);
    });

    this.attachSlotEvents();
  }

  attachSlotEvents() {
    /* Ready / Farbe / Kick: zentral in bindEvents → slotsContainer (click-Delegation) */
    console.log('[LOBBY SLOTS] UI updated (delegated slot clicks).');

    /* 
    document.querySelectorAll('.player-name-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const id = parseInt(e.target.dataset.id);
        const player = this.players.find(p => p.id === id);
        if (player) player.name = e.target.value || `Spieler ${player.id}`;
      });
    });
    */
  }

  drawCarPreview(playerId, color) {
    const canvas = document.getElementById(`car-canvas-${playerId}`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = 140;
    canvas.width = size;
    canvas.height = size;

    ctx.save();
    ctx.translate(size/2, size/2);
    ctx.rotate(-Math.PI / 2); // Face upwards
    ctx.scale(1.8, 1.8);

    // F1 Car Drawing Logic (High detail for preview)
    const L = 50, W = 26;
    const darkColor = '#0f172a';
    const silver = '#94a3b8';
    const highlight = 'rgba(255,255,255,0.3)';

    // 1. Suspension arms
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(L/3, 0); ctx.lineTo(L/2-5, -W/2);
    ctx.moveTo(L/3, 0); ctx.lineTo(L/2-5, W/2);
    ctx.moveTo(-L/4, 0); ctx.lineTo(-L/2+10, -W/2);
    ctx.moveTo(-L/4, 0); ctx.lineTo(-L/2+10, W/2);
    ctx.stroke();

    // 2. Wheels (with depth)
    ctx.fillStyle = '#020617';
    [
      [L/2-12, -W/2-5, 12, 8], [L/2-12, W/2-3, 12, 8], // Front
      [-L/2+5, -W/2-7, 15, 10], [-L/2+5, W/2-3, 15, 10] // Rear
    ].forEach(([wx, wy, ww, wh]) => {
      ctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(wx, wy, ww, 2); // Rim highlight
      ctx.fillStyle = '#020617';
    });

    // 3. Main Chassis
    const chassisGrad = ctx.createLinearGradient(-L/2, 0, L/2, 0);
    chassisGrad.addColorStop(0, color);
    chassisGrad.addColorStop(1, this._adjustColor(color, -30));
    ctx.fillStyle = chassisGrad;

    ctx.beginPath();
    ctx.moveTo(-L/2+5, -W/4);
    ctx.bezierCurveTo(0, -W/1.2, L/3, -W/3, L/2-5, -2);
    ctx.lineTo(L/2-5, 2);
    ctx.bezierCurveTo(L/3, W/3, 0, W/1.2, -L/2+5, W/4);
    ctx.closePath();
    ctx.fill();

    // 4. Front Wing
    ctx.fillStyle = darkColor;
    ctx.fillRect(L/2-4, -W/1.1, 5, W*1.8);
    ctx.fillStyle = highlight;
    ctx.fillRect(L/2-4, -W/1.1, 5, 2);

    // 5. Rear Wing
    ctx.fillStyle = darkColor;
    ctx.fillRect(-L/2-3, -W/1.1, 7, W*1.8);
    ctx.fillStyle = color;
    ctx.fillRect(-L/2-3, -W/1.1, 2, W*1.8); // Rear wing endplate detail

    // 6. Cockpit & Halo
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(-2, 0, 10, 6, 0, 0, Math.PI*2);
    ctx.fill();
    
    // Halo
    ctx.strokeStyle = darkColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(-2, 0, 8, -Math.PI/1.8, Math.PI/1.8);
    ctx.stroke();

    // 7. Glossy highlight
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.ellipse(5, -W/6, 15, 3, Math.PI/10, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();
  }

  _adjustColor(hex, amt) {
    let usePound = false;
    if (hex[0] == "#") { hex = hex.slice(1); usePound = true; }
    let num = parseInt(hex, 16);
    let r = (num >> 16) + amt;
    if (r > 255) r = 255; else if (r < 0) r = 0;
    let b = ((num >> 8) & 0x00FF) + amt;
    if (b > 255) b = 255; else if (b < 0) b = 0;
    let g = (num & 0x0000FF) + amt;
    if (g > 255) g = 255; else if (g < 0) g = 0;
    return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
  }

  kickPlayer(id) {
    if (!this.gameManager.networkManager.isHost) return;
    
    const slot = this.players.find(p => String(p.id) === String(id));
    if (slot && slot.isHuman && String(slot.id) !== "1") {
      const kickedNetworkId = slot.networkId;
      console.log(`[LOBBY KICK] Host kicking player in slot ${id} (NetworkID: ${kickedNetworkId})`);
      
      // Add to ban list (authoritative on host)
      if (kickedNetworkId && !this.bannedPlayers.includes(kickedNetworkId)) {
        this.bannedPlayers.push(kickedNetworkId);
      }

      // Tell the client they are kicked
      this.gameManager.networkManager.send({ type: 'kicked', reason: 'kick' });
      
      // Give it a moment to send, then replace with bot
      setTimeout(() => {
        this.replaceHumanWithBot(id, 'kick');
      }, 100);
    }
  }

  toggleReady(id) {
    const slot = this.players.find(p => String(p.id) === String(id));
    if (!slot || !slot.isHuman) return;

    const localId = String(this.gameManager.localPlayerId);
    const isMySlot = String(slot.networkId) === localId || String(slot.id) === localId;

    if (!isMySlot) {
      console.warn(`[READY DENIED] Player ${id} cannot toggle slot ${slot.id}`);
      return;
    }

    slot.isReady = !slot.isReady;
    console.log(`[READY CLICK] playerId=${slot.networkId || slot.id}, ready=${slot.isReady}`);
    console.log(`[READY SLOT UPDATED] slotId: ${slot.id}, playerId: ${slot.networkId || slot.id}, ready: ${slot.isReady}`);
    
    this.renderSlots();
    this.checkAllReady();
    
    if (this.gameManager.networkManager.isHost) {
      this.broadcastState();
    } else {
      this.gameManager.networkManager.send({ 
        type: 'ready_toggle', 
        id: id, 
        isReady: slot.isReady 
      });
    }
  }

  changeColor(id, color) {
    const slot = this.players.find(p => String(p.id) === String(id));
    if (!slot || !slot.isHuman) return;

    // Only allow changing your own color
    const isMySlot = (this.gameManager.networkManager.isHost && slot.id === 1) || (!this.gameManager.networkManager.isHost && slot.id !== 1);
    if (!isMySlot) return;

    // Check if color is already taken
    const isTaken = this.players.some(p => p.color === color && String(p.id) !== String(id));
    if (isTaken) return;

    slot.color = color;
    this.renderSlots();
    
    if (this.gameManager.networkManager.isHost) {
      this.broadcastState();
    } else {
      this.gameManager.networkManager.send({ type: 'color_change', id: id, color: color });
    }
  }

  checkAllReady() {
    // Bots are always ready, only check humans
    const allReady = this.players.every(p => !p.isHuman || p.isReady);
    console.log(`[READY RECALC] allHumansReady: ${allReady}`);
    this.btnStartRace.disabled = !allReady;
    
    if (allReady) {
      this.statusText.textContent = "Alle Spieler bereit! Host kann Map wählen.";
      this.statusText.style.color = "var(--success)";
    } else {
      this.statusText.textContent = "Warte auf alle Spieler (BEREIT)...";
      this.statusText.style.color = "var(--neon-accent)";
    }

    return allReady;
  }

  getPlayers() {
    return this.players;
  }

  /** Nach Rennende: gleiche Lobby, Menschen nicht bereit, Bots bereit */
  resetAfterRace() {
    this.players.forEach((p) => {
      if (p.isHuman) p.isReady = false;
      else p.isReady = true;
    });
    this.renderSlots();
    this.checkAllReady();
    if (this.gameManager.networkManager.isHost) {
      this.broadcastState();
    }
  }

  hideChat() {
    if (this.globalChat) {
      console.log('[CHAT HIDDEN]');
      this.globalChat.classList.add('hidden');
      this.toggleChat(false);
      this.unreadCount = 0;
      this.updateNotificationDot();
    }
  }

  /**
   * Während Rennen + Countdown: Chat-UI deaktivieren, Fokus entfernen (Tastatur fürs Fahren).
   * @param {boolean} racing true = Rennphase / Spiel-Screen
   */
  setLiveChatRaceMode(racing) {
    this._liveChatRaceMode = !!racing;
    if (this.chatInput) {
      this.chatInput.disabled = !!racing;
      if (racing) this.chatInput.blur();
    }
    if (this.chatToggle) {
      if (racing) {
        this.chatToggle.setAttribute('tabindex', '-1');
        this.chatToggle.setAttribute('aria-disabled', 'true');
      } else {
        this.chatToggle.removeAttribute('tabindex');
        this.chatToggle.removeAttribute('aria-disabled');
      }
    }
    if (this.btnSendChat) {
      this.btnSendChat.disabled = !!racing;
    }
    if (racing) this.toggleChat(false);
  }

  sendChatMessage() {
    if (this.gameManager.state === 'game') return;
    const text = this.chatInput.value.trim();
    if (!text) return;

    // Find local player name
    const localId = String(this.gameManager.localPlayerId);
    const mySlot = this.players.find(
      (p) => String(p.networkId) === localId || String(p.id) === localId
    );
    
    const playerName = mySlot ? mySlot.name.replace(' (Du)', '') : 'Spieler';

    console.log(`[CHAT SEND] lobbyId: ${this.gameManager.currentLobbyCode}, senderId: ${localId}, text: ${text}`);
    this.gameManager.networkManager.send({
      type: 'chat_message',
      lobbyId: this.gameManager.currentLobbyCode,
      senderId: localId,
      name: playerName,
      text: text,
      timestamp: Date.now()
    });

    this.addChatMessage(playerName, text, false, true, localId);
    this.chatInput.value = '';
  }

  addChatMessage(name, text, isSystem = false, isMe = false, senderId = null) {
    if (!this.chatMessages) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${isSystem ? 'system' : ''}`;
    
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (isSystem) {
      msgDiv.textContent = text;
    } else {
      msgDiv.innerHTML = `<span class="name">${name}</span><span class="text">${text}</span><span class="time">${timeStr}</span>`;
    }

    this.chatMessages.appendChild(msgDiv);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

    // Handle notifications (Only if not me and not system)
    const localId = String(this.gameManager.localPlayerId);
    const isActuallyMe = isMe || (senderId && String(senderId) === localId);

    if (!isActuallyMe && !isSystem && !this.isChatOpen) {
      this.unreadCount++;
      console.log(`[CHAT UNREAD ADD] unreadCount: ${this.unreadCount}`);
      this.updateNotificationDot();
    }
  }

  toggleChat(forceState) {
    const nextOpen = forceState !== undefined ? forceState : !this.isChatOpen;
    if (nextOpen && this.gameManager.state === 'game') return;

    this.isChatOpen = nextOpen;

    if (this.isChatOpen) {
      console.log('[CHAT OPEN]');
      this.chatWindow.classList.remove('hidden');
      this.unreadCount = 0;
      console.log('[CHAT READ] unreadCount=0');
      this.updateNotificationDot();
      this.chatInput.focus();
    } else {
      console.log('[CHAT CLOSE]');
      this.chatWindow.classList.add('hidden');
      if (this.chatInput) this.chatInput.blur();
    }
  }

  updateNotificationDot() {
    if (this.unreadCount > 0) {
      this.notificationDot.classList.remove('hidden');
      this.notificationDot.textContent = this.unreadCount;
    } else {
      this.notificationDot.classList.add('hidden');
      this.notificationDot.textContent = '';
    }
  }

  applyReadyFromNetwork(slotId, isReady) {
    const slot = this.players.find((p) => String(p.id) === String(slotId));
    if (!slot || !slot.isHuman) return;
    slot.isReady = !!isReady;
    console.log(`[READY UPDATE RECEIVED] playerId=${slot.networkId || slot.id}, ready=${slot.isReady}`);
    this.renderSlots();
    this.checkAllReady();
    this.broadcastState();
  }

  broadcastState() {
    if (!this.gameManager.networkManager.isHost) return;

    const state = {
      lobbyCode: this.gameManager.currentLobbyCode,
      totalPlayers: this.totalPlayers,
      players: this.players,
      mapIndex: this.currentMapIndex,
      rounds: this.rounds,
      lapsToWin: this.rounds,
      difficulty: this.difficulty,
      aiDifficulty: this.difficulty,
      bannedPlayers: this.bannedPlayers
    };

    console.log(`[LOBBY BROADCAST] lobbyId: ${state.lobbyCode}, slots: ${this.players.length}`);
    this.gameManager.networkManager.broadcast({
      type: 'lobby_sync',
      state: state
    });
  }
}
