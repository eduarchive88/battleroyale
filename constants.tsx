
import { ClassType, CharacterStats } from './types';

export const CLASS_BASE_STATS: Record<ClassType, CharacterStats & { hp: number; mp: number }> = {
  [ClassType.WARRIOR]: { atk: 25, def: 20, range: 60, speed: 4, atkSpeed: 1, hp: 200, mp: 60 },
  [ClassType.MAGE]: { atk: 30, def: 8, range: 300, speed: 3.5, atkSpeed: 0.8, hp: 100, mp: 150 },
  [ClassType.ARCHER]: { atk: 20, def: 12, range: 400, speed: 4.5, atkSpeed: 1.2, hp: 120, mp: 80 },
  [ClassType.ROGUE]: { atk: 22, def: 10, range: 40, speed: 5.5, atkSpeed: 1.8, hp: 110, mp: 100 },
};

export const COSTS = {
  ITEM: 4,
  SKILL: 6,
  STAT: 3
};

export const SKILLS_INFO: Record<ClassType, { id: string; name: string; desc: string; mp: number }[]> = {
  [ClassType.WARRIOR]: [
    { id: 'w_speed', name: '질주', desc: '2초간 이속 증가', mp: 15 },
    { id: 'w_invinc', name: '무적', desc: '2초간 무적', mp: 25 },
    { id: 'w_double', name: '분노', desc: '2초간 공격력 2배', mp: 20 }
  ],
  [ClassType.ROGUE]: [
    { id: 'r_tele', name: '습격', desc: '무작위 적 뒤로 이동', mp: 20 },
    { id: 'r_aspeed', name: '난도질', desc: '2초간 공속 2배', mp: 15 },
    { id: 'r_hide', name: '은신', desc: '2초간 투명화', mp: 30 }
  ],
  [ClassType.MAGE]: [
    { id: 'm_laser', name: '라이트닝', desc: '직선 레이저 발사', mp: 25 },
    { id: 'm_thunder', name: '벼락치기', desc: '광역 벼락', mp: 40 },
    { id: 'm_ice', name: '아이스볼', desc: '맞은 적 1초 스턴', mp: 20 }
  ],
  [ClassType.ARCHER]: [
    { id: 'a_multi', name: '멀티샷', desc: '화살 5개 발사', mp: 25 },
    { id: 'a_range', name: '저격', desc: '사거리 3배', mp: 20 },
    { id: 'a_aspeed', name: '속사', desc: '공속 2배', mp: 20 }
  ]
};
