
import { GameState, Player, Role, ClassType } from '../types';

declare const Peer: any;

type MessageType = 'STATE_UPDATE' | 'PLAYER_ACTION' | 'HEARTBEAT' | 'HEARTBEAT_ACK' | 'PLAYER_JOIN';

interface P2PMessage {
  type: MessageType;
  payload: any;
  senderId?: string;
}

class P2PNetwork {
  private peer: any = null;
  private connections: Record<string, any> = {};
  private isHost: boolean = false;
  private onStateChange: ((state: GameState) => void) | null = null;
  private gameState: GameState | null = null;
  private triggerAction: any = null;

  init(roomCode: string, isHost: boolean, onStateChange: (state: GameState) => void) {
    this.isHost = isHost;
    this.onStateChange = onStateChange;
    const peerId = `edu-arena-${roomCode}`;

    // Clean up existing peer if any
    if (this.peer) {
      this.peer.destroy();
      this.connections = {};
    }

    // Initialize Peer
    // Use undefined ID for guests, fixed ID for host
    this.peer = new Peer(isHost ? peerId : undefined, {
      debug: 2,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ]
      }
    });

    this.peer.on('open', (id: string) => {
      console.log(`Peer opened with ID: ${id}`);
      if (!isHost) {
        console.log(`Attempting to connect to host: ${peerId}`);
        this.connectToHost(peerId);
      }
    });

    this.peer.on('error', (err: any) => {
      console.error('Peer error:', err.type, err);
      if (err.type === 'unavailable-id' && isHost) {
        alert("이미 사용 중인 방 코드입니다. 다른 코드를 입력하세요.");
      } else if (err.type === 'peer-not-found' && !isHost) {
        alert("방을 찾을 수 없습니다. 코드를 확인하세요.");
      }
    });

    if (isHost) {
      this.peer.on('connection', (conn: any) => {
        this.setupConnection(conn);
      });
    }
  }

  private connectToHost(hostId: string) {
    const conn = this.peer.connect(hostId, {
      reliable: true
    });
    this.setupConnection(conn);
  }

  private setupConnection(conn: any) {
    conn.on('open', () => {
      this.connections[conn.peer] = conn;
      console.log('Connected to:', conn.peer);
      
      // If student connects, Host should send current state immediately
      if (this.isHost && this.gameState) {
        this.broadcastState(this.gameState);
      }
    });

    conn.on('data', (data: P2PMessage) => {
      this.handleMessage(data, conn);
    });

    conn.on('close', () => {
      console.log('Connection closed:', conn.peer);
      delete this.connections[conn.peer];
    });

    conn.on('error', (err: any) => {
      console.error('Connection error:', err);
      delete this.connections[conn.peer];
    });
  }

  private handleMessage(msg: P2PMessage, conn: any) {
    if (this.isHost) {
      if (msg.type === 'PLAYER_ACTION') {
        if (this.triggerAction) {
          this.triggerAction(msg.payload);
        }
      }
    } else {
      if (msg.type === 'STATE_UPDATE') {
        this.gameState = msg.payload;
        if (this.onStateChange) this.onStateChange(this.gameState!);
      }
    }
  }

  broadcastState(state: GameState) {
    this.gameState = state;
    const msg: P2PMessage = { type: 'STATE_UPDATE', payload: state };
    Object.values(this.connections).forEach((conn: any) => {
      if (conn.open) {
        conn.send(msg);
      }
    });
  }

  sendAction(action: any) {
    const msg: P2PMessage = { type: 'PLAYER_ACTION', payload: action };
    Object.values(this.connections).forEach((conn: any) => {
      if (conn.open) {
        conn.send(msg);
      }
    });
  }

  setActionListener(fn: any) { 
    this.triggerAction = fn; 
  }
}

export const network = new P2PNetwork();
