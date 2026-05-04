// CL
/**
 * NetworkManager handles P2P connections using PeerJS.
 */
export class NetworkManager {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this.peer = null;
    this.connections = {}; // Map of peerId -> connection
    this.isHost = false;
    this.onDataReceived = null;
    this.onDisconnected = null;
  }

  get peerId() {
    return this.peer && this.peer.id ? this.peer.id : '';
  }

  /**
   * Initialize Peer as Host
   */
  hostLobby(code, callback) {
    this.isHost = true;
    const peerId = `vektor-race-${code}`;
    
    if (typeof Peer === 'undefined') {
      console.error('[NETWORK ERROR] PeerJS not loaded. Offline mode only.');
      return;
    }

    try {
      this.peer = new Peer(peerId);
      this.peer.on('open', (id) => {
        console.log('Lobby hosted with ID:', id);
        this.gameManager.localPlayerId = String(id);
        callback(true);
      });
      this.peer.on('connection', (conn) => {
        console.log(`[P2P CONNECTED] Incoming from: ${conn.peer}`);
        this.setupConnection(conn);
      });
      this.peer.on('error', (err) => {
        console.error('Peer error:', err);
        callback(false);
      });
    } catch (e) {
      console.error('[NETWORK ERROR] Peer creation failed:', e);
    }
  }

  /**
   * Initialize Peer as Client and join
   */
  joinLobby(code, callback) {
    if (typeof Peer === 'undefined') {
      console.error('[NETWORK ERROR] PeerJS library not loaded.');
      callback(false);
      return;
    }
    this.isHost = false;
    this.peer = new Peer();

    this.peer.on('open', (id) => {
      this.gameManager.localPlayerId = String(id);
      const targetId = `vektor-race-${code}`;
      const conn = this.peer.connect(targetId);
      
      conn.on('open', () => {
        console.log(`[P2P CONNECTED] Outgoing to: ${targetId}`);
        console.log(`[LOBBY FOUND BY CODE] Connected to host with code: ${code}`);
        this.setupConnection(conn);
        callback(true);
      });

      // Handle timeout
      setTimeout(() => {
        if (!conn.open) {
          callback(false);
        }
      }, 5000);
    });

    this.peer.on('error', (err) => {
      console.error('Join error:', err);
      callback(false);
    });
  }

  setupConnection(conn) {
    this.connections[conn.peer] = conn;

    conn.on('data', (data) => {
      if (this.onDataReceived) {
        this.onDataReceived(data, conn.peer);
      }
    });

    conn.on('close', () => {
      console.log(`[P2P DISCONNECTED] peerId: ${conn.peer}`);
      delete this.connections[conn.peer];
      if (this.onDisconnected) {
        this.onDisconnected(conn.peer);
      }
    });

    conn.on('error', (err) => {
      console.error(`[P2P ERROR] peerId: ${conn.peer}, error:`, err);
      delete this.connections[conn.peer];
    });
  }

  send(data) {
    // console.log(`[P2P SEND] type: ${data.type}`);
    this.broadcast(data);
  }

  sendToPeer(peerId, data) {
    const conn = this.connections[peerId];
    if (conn && conn.open) {
      conn.send(data);
    }
  }

  broadcast(data) {
    // console.log(`[P2P BROADCAST] type: ${data.type}`);
    Object.values(this.connections).forEach(conn => {
      if (conn.open) {
        conn.send(data);
      }
    });
  }

  closeAllConnections() {
    console.log('[NETWORK] Closing all existing connections.');
    Object.values(this.connections).forEach(conn => {
      conn.close();
    });
    this.connections = {};
  }
}
