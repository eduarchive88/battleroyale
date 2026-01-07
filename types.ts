
export enum Role {
  QUIZ = 'QUIZ',
  SUPPORT = 'SUPPORT',
  COMBAT = 'COMBAT'
}

export enum ClassType {
  WARRIOR = 'WARRIOR',
  MAGE = 'MAGE',
  ARCHER = 'ARCHER',
  ROGUE = 'ROGUE'
}

export interface CharacterStats {
  atk: number;
  def: number;
  range: number;
  speed: number;
  atkSpeed: number;
}

export interface Team {
  id: string;
  name: string;
  points: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  x: number;
  y: number;
  angle: number;
  isDead: boolean;
  classType: ClassType;
  stats: CharacterStats;
  items: { weapon: boolean; armor: boolean; boots: boolean };
  unlockedSkills: string[];
  activeEffects: { type: string; until: number }[];
  skillCooldowns: Record<string, number>;
  lastAtkTime: number;
  totalDamageDealt?: number; // 추가: 점수 합산용
}

export interface Quiz {
  question: string;
  options: string[];
  answer: number;
}

export interface GameState {
  isStarted: boolean;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  quizzes: Quiz[];
  roomCode?: string;
  currentQuizIndex: number;
  phase: 'QUIZ' | 'BATTLE' | 'GAME_OVER'; // GAME_OVER 단계 추가
  timer: number;
  winnerTeamId?: string; // 추가: 최종 우승팀
}

export interface Player {
  id: string;
  name: string;
  teamId: string;
  role: Role;
  classType: ClassType;
  points: number;
  hasSubmittedQuiz?: boolean;
}
