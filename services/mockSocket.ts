
// Vercel 자체에는 상태 저장 서버가 없으므로, 브라우저의 통신 API를 활용합니다.
// 실제 운영을 위해서는 추후에 별도의 백엔드가 필요할 수 있으나, 현재는 프론트엔드 내에서 최대한 구현합니다.

type Callback = (data: any) => void;

class MockSocket {
  private listeners: Record<string, Callback[]> = {};
  private channel: BroadcastChannel;
  private state: any = {
    roomCode: '',
    players: {},
    teams: {},
    isStarted: false,
    quizzes: [],
    currentQuizIndex: 0
  };

  constructor() {
    this.channel = new BroadcastChannel('edu_arena_channel');
    this.channel.onmessage = (event) => {
      const { type, data } = event.data;
      if (type === 'stateUpdate') {
        this.state = { ...this.state, ...data };
        this.trigger('stateChange', this.state);
      }
    };
  }

  subscribe(event: string, cb: Callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
    return () => {
      this.listeners[event] = this.listeners[event].filter(l => l !== cb);
    };
  }

  private trigger(event: string, data: any) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }

  emit(event: string, data: any) {
    // 로컬 상태 업데이트
    this.state = { ...this.state, ...data };
    
    // 다른 탭/기기로 전송 (동일 도메인 한정)
    this.channel.postMessage({
      type: 'stateUpdate',
      data: this.state
    });

    // 로컬 리스너 실행
    this.trigger('stateChange', this.state);
  }

  getState() {
    return this.state;
  }
}

export const socket = new MockSocket();
