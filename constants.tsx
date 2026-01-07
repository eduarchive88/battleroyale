
import { ClassType, CharacterStats } from './types';

export const CLASS_CONFIGS: Record<ClassType, CharacterStats & { hp: number }> = {
  [ClassType.WARRIOR]: { str: 15, int: 5, dex: 10, atk: 20, def: 15, range: 40, hp: 200 },
  [ClassType.MAGE]: { str: 5, int: 20, dex: 10, atk: 25, def: 5, range: 250, hp: 100 },
  [ClassType.ARCHER]: { str: 10, int: 10, dex: 15, atk: 18, def: 10, range: 350, hp: 120 },
  [ClassType.ROGUE]: { str: 12, int: 8, dex: 18, atk: 22, def: 8, range: 50, hp: 110 },
};

export const UPGRADE_COSTS = {
  STAT: 10,
  WEAPON: 30,
  SKILL: 50
};
