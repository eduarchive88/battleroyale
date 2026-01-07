
import { GameState } from '../types';

declare global {
  interface Window {
    Peer: any;
  }
}

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

  // 라이브러리 로드 여부를 확인하는 헬퍼
  private async ensurePeerLib(): Promise<boolean> {
    if (typeof window.Peer !== 'undefined') return true;
    
    // 최대 3초간 라이브러리 로드 대기
    for (let i = 0; i < 30; i++) {
      if (typeof window.Peer !== 'undefined') return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  async init(roomCode: string, isHost: boolean, onStateChange: (state: GameState) => void, onReady?: () => void) {
    const hasLib = await this.ensurePeerLib();
    if (!hasLib) {
      alert("통신 라이브러리(PeerJS)를 불러오지 못했습니다. 인터넷 연결을 확인하거나 페이지를 새로고침해주세요.");
      return;
    }

    this.isHost = isHost;
    this.onStateChange = onStateChange;
    const peerId = this.sanitizeId(roomCode);

    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (e) {
        console.error("Peer destroy error", e);
      }
      this.peer = null;
    }

    this.peer = new window.Peer(isHost ? peerId : undefined, {
      debug: 2,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    this.peer.on('open', (id: string) => {
      console.log(`[P2P] Registered with ID: ${id}`);
      if (onReady) onReady();
      
      if (!isHost) {
        setTimeout(() => this.connectToHost(peerId), 500);
      }
    });

    this.peer.on('error', (err: any) => {
      console.error('[P2P] Error:', err.type, err);
      if (err.type === 'unavailable-id') {
        alert("이미 사용 중인 방 코드입니다. 다른 코드를 입력해주세요.");
      } else if (err.type === 'peer-not-found') {
        alert("방을 찾을 수 없습니다. 교사가 먼저 전장을 생성했는지 확인하세요.");
      }
      // 강제 초기화를 위해 이벤트를 전파하거나 페이지 리로드 유도
      if (isHost) window.location.reload();
    });

    if (isHost) {
      this.peer.on('connection', (conn: any) => {
        this.setupConnection(conn);
      });
    }
  }

  private connectToHost(hostId: string) {
    if (!this.peer || this.peer.destroyed) return;
    const conn = this.peer.connect(hostId, { reliable: true });
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

    conn.on('close', () => delete this.connections[conn.peer]);
    conn.on('error', () => delete this.connections[conn.peer]);
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
