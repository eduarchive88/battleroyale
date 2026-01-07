
import { GameState } from '../types';

declare const Peer: any;

type MessageType = 'STATE_UPDATE' | 'PLAYER_ACTION';

interface P2PMessage {
  type: MessageType;
  payload: any;
}

class P2PNetwork {
  private peer: any = null;
  private connections: Record<string, any> = {};
  private isHost: boolean = false;
  private onStateChange: ((state: GameState) => void) | null = null;
  private gameState: GameState | null = null;
  private triggerAction: any = null;

  private sanitizeId(code: string): string {
    return `edu-arena-${code.trim().toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  }

  init(roomCode: string, isHost: boolean, onStateChange: (state: GameState) => void, onReady?: () => void) {
    this.isHost = isHost;
    this.onStateChange = onStateChange;
    const peerId = this.sanitizeId(roomCode);

    if (this.peer) {
      this.peer.destroy();
      this.connections = {};
    }

    this.peer = new Peer(isHost ? peerId : undefined, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    this.peer.on('open', (id: string) => {
      console.log(`[P2P] Peer Opened. ID: ${id}`);
      if (onReady) onReady();
      
      if (!isHost) {
        setTimeout(() => {
          this.connectToHost(peerId);
        }, 500);
      }
    });

    this.peer.on('error', (err: any) => {
      console.error('[P2P] Peer Error:', err.type, err);
      if (err.type === 'unavailable-id') {
        alert("이미 존재하는 방 코드입니다. 다른 코드를 입력해주세요.");
        window.location.reload(); // 강제 리로드로 상태 초기화
      } else if (err.type === 'peer-not-found') {
        alert("방을 찾을 수 없습니다. 코드를 확인하세요.");
        window.location.reload();
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
      if (this.isHost && this.gameState) {
        this.broadcastState(this.gameState);
      }
    });

    conn.on('data', (data: P2PMessage) => {
      this.handleMessage(data, conn);
    });

    conn.on('close', () => {
      delete this.connections[conn.peer];
    });

    conn.on('error', (err: any) => {
      delete this.connections[conn.peer];
    });
  }

  private handleMessage(msg: P2PMessage, conn: any) {
    if (this.isHost) {
      if (msg.type === 'PLAYER_ACTION' && this.triggerAction) {
        this.triggerAction(msg.payload);
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
      if (conn.open) conn.send(msg);
    });
  }

  sendAction(action: any) {
    const msg: P2PMessage = { type: 'PLAYER_ACTION', payload: action };
    Object.values(this.connections).forEach((conn: any) => {
      if (conn.open) conn.send(msg);
    });
  }

  setActionListener(fn: any) { 
    this.triggerAction = fn; 
  }
}

export const network = new P2PNetwork();
