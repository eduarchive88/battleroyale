
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

export interface Player {
  id: string;
  name: string;
  teamId: string;
  role: Role;
  classType: ClassType;
  points: number;
}

export interface Team {
  id: string;
  name: string;
  points: number;
  stats: CharacterStats;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  isDead: boolean;
  classType: ClassType;
}

export interface CharacterStats {
  str: number;
  int: number;
  dex: number;
  atk: number;
  def: number;
  range: number;
}

export interface Quiz {
  question: string;
  options: string[];
  answer: number; // 0-3
}

export interface GameState {
  isStarted: boolean;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  quizzes: Quiz[];
  roomCode?: string;
  currentQuizIndex: number;
  phase: 'QUIZ' | 'BATTLE';
}
