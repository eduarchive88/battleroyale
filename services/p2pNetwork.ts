
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

  // 방 코드에서 PeerJS ID로 사용할 수 없는 문자 제거
  private sanitizeId(code: string): string {
    return `edu-arena-${code.trim().toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  }

  init(roomCode: string, isHost: boolean, onStateChange: (state: GameState) => void) {
    this.isHost = isHost;
    this.onStateChange = onStateChange;
    const peerId = this.sanitizeId(roomCode);

    if (this.peer) {
      this.peer.destroy();
      this.connections = {};
    }

    // PeerJS 서버 연결 (공용 서버 사용 시 신뢰성을 위해 STUN 서버 명시)
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
      if (!isHost) {
        // 약간의 지연을 주어 호스트가 완전히 등록될 시간을 벌어줌
        setTimeout(() => {
          this.connectToHost(peerId);
        }, 500);
      }
    });

    this.peer.on('error', (err: any) => {
      console.error('[P2P] Peer Error:', err.type, err);
      if (err.type === 'unavailable-id') {
        alert("이미 존재하는 방 코드입니다. 다른 코드를 입력해주세요.");
      } else if (err.type === 'peer-not-found') {
        alert("방을 찾을 수 없습니다. 방 코드가 정확한지, 교사가 방을 먼저 만들었는지 확인하세요.");
      }
    });

    if (isHost) {
      this.peer.on('connection', (conn: any) => {
        this.setupConnection(conn);
      });
    }
  }

  private connectToHost(hostId: string) {
    console.log(`[P2P] Connecting to Host: ${hostId}`);
    const conn = this.peer.connect(hostId, {
      reliable: true,
      metadata: { timestamp: Date.now() }
    });
    this.setupConnection(conn);
  }

  private setupConnection(conn: any) {
    conn.on('open', () => {
      this.connections[conn.peer] = conn;
      console.log(`[P2P] Data Channel Open: ${conn.peer}`);
      
      if (this.isHost && this.gameState) {
        // 호스트는 새로운 연결이 오면 즉시 현재 상태 브로드캐스트
        this.broadcastState(this.gameState);
      }
    });

    conn.on('data', (data: P2PMessage) => {
      this.handleMessage(data, conn);
    });

    conn.on('close', () => {
      console.log(`[P2P] Connection Closed: ${conn.peer}`);
      delete this.connections[conn.peer];
    });

    conn.on('error', (err: any) => {
      console.error(`[P2P] Connection Error:`, err);
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
