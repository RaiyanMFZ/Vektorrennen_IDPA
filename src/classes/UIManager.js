// RM
export class UIManager {
  constructor() {
    this.screens = {
      start: document.getElementById('start-screen'),
      'lobby-screen': document.getElementById('lobby-screen'),
      joinLobby: document.getElementById('join-lobby-screen'),
      'map-selection-screen': document.getElementById('map-selection-screen'),
      game: document.getElementById('game-screen'),
      end: document.getElementById('end-screen')
    };

    this.hud = {
      lap: document.getElementById('hud-lap-val'),
      time: document.getElementById('hud-time-val'),
      pos: document.getElementById('hud-pos-val')
    };

    this.countdownText = document.getElementById('countdown-text');
    this.countdownOverlay = document.getElementById('countdown-overlay');
    this.winnerName = document.getElementById('winner-name');
    this.leaderboard = document.getElementById('leaderboard');
    this.lobbyStatus = document.getElementById('lobby-status');
  }

  showScreen(screenName) {
    // Hide all screens
    Object.values(this.screens).forEach(screen => {
      screen.classList.add('hidden');
    });

    // Show requested screen
    if (this.screens[screenName]) {
      this.screens[screenName].classList.remove('hidden');
    } else {
      console.error(`Screen ${screenName} not found!`);
    }

    // Floating chat: nur Menü/Lobby/Ergebnis — während Rennen & Countdown (game) ausgeblendet
    const chatContainer = document.getElementById('global-chat-container');
    if (chatContainer) {
      const hideChat = screenName === 'start' || screenName === 'joinLobby' || screenName === 'game';
      chatContainer.classList.toggle('hidden', hideChat);
    }
  }

  updateHUD(lap, maxLaps, timeMs, position) {
    if (this.hud.lap) this.hud.lap.textContent = `${lap}/${maxLaps}`;
    if (this.hud.time) this.hud.time.textContent = this.formatTime(timeMs);
    if (this.hud.pos) this.hud.pos.textContent = `${position}.`;
  }

  formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor((ms % 1000) / 10);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
  }

  showCountdown(number) {
    this.countdownOverlay.classList.remove('hidden');
    this.countdownText.textContent = number === 0 ? 'GO!' : number;
  }

  hideCountdown() {
    this.countdownOverlay.classList.add('hidden');
  }

  showEndScreen(results, localPlayerId) {
    this.showScreen('end');

    if (results.length > 0) {
      // Find winner's base name (strip "(Du)" if present)
      const winnerName = results[0].name.split(' (')[0];
      this.winnerName.textContent = winnerName;
      this.winnerName.style.color = results[0].color;
    }

    this.leaderboard.innerHTML = '';
    results.forEach((res, index) => {
      let displayName = res.name.split(' (')[0];
      if (String(res.id) === String(localPlayerId)) {
        displayName += ' (Du)';
      }

      const typeLabel = res.isHuman === false ? 'Bot' : 'Mensch';
      const item = document.createElement('div');
      item.className = 'leaderboard-item';
      item.style.gap = '1rem';
      item.innerHTML = `
        <span style="min-width:2.5rem;font-weight:700">${index + 1}.</span>
        <span style="flex:1;color:${res.color || '#e2e8f0'};font-weight:700">${displayName}</span>
        <span style="opacity:0.85;min-width:4.5rem">${typeLabel}</span>
        <span style="font-variant-numeric:tabular-nums">${this.formatTime(res.totalTime)}</span>
      `;
      this.leaderboard.appendChild(item);
    });
  }
}
