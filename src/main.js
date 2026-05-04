// RM / CL
import { GameManager } from './classes/GameManager.js';
import { initMobileLayout } from './utils/mobileLayout.js';

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', () => {
  try {
    initMobileLayout();
    const gameManager = new GameManager();
    gameManager.init();
  } catch (error) {
    console.error('CRITICAL STARTUP ERROR:', error);
    alert('Fehler beim Starten des Spiels: ' + error.message);
  }
});
