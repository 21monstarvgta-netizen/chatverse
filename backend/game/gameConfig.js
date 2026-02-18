// Game configuration - all balance constants

const GRID_SIZE = 25;
const INITIAL_UNLOCKED = 8;

const BUILDING_TYPES = {
  farm: {
    name: 'Ферма',
    emoji: '🌾',
    description: 'Производит еду',
    baseCost: { coins: 100, materials: 50 },
    baseOutput: { food: 10 },
    baseTime: 300, // 5 minutes in seconds
    maxLevel: 50,
    category: 'production',
    unlockLevel: 1,
    energyCost: 1
  },
  quarry: {
    name: 'Каменоломня',
    emoji: '⛏️',
    description: 'Добывает материалы',
    baseCost: { coins: 200, food: 100 },
    baseOutput: { materials: 8 },
    baseTime: 900, // 15 minutes
    maxLevel: 50,
    category: 'production',
    unlockLevel: 2,
    energyCost: 2
  },
  factory: {
    name: 'Фабрика',
    emoji: '🏭',
    description: 'Конвертирует ресурсы в монеты',
    baseCost: { coins: 500, materials: 200, food: 100 },
    baseOutput: { coins: 25 },
    baseTime: 1800, // 30 minutes
    maxLevel: 50,
    category: 'production',
    unlockLevel: 4,
    energyCost: 3
  },
  powerplant: {
    name: 'Электростанция',
    emoji: '⚡',
    description: 'Производит энергию',
    baseCost: { coins: 800, materials: 300 },
    baseOutput: { energy: 5 },
    baseTime: 1200, // 20 minutes
    maxLevel: 30,
    category: 'infrastructure',
    unlockLevel: 3,
    energyCost: 0
  },
  house: {
    name: 'Жилой дом',
    emoji: '🏠',
    description: 'Увеличивает население',
    baseCost: { coins: 150, materials: 80 },
    baseOutput: { population: 5 },
    baseTime: 600, // 10 minutes
    maxLevel: 50,
    category: 'residential',
    unlockLevel: 1,
    energyCost: 1
  },
  warehouse: {
    name: 'Склад',
    emoji: '📦',
    description: 'Увеличивает хранилище',
    baseCost: { coins: 300, materials: 150 },
    baseOutput: { storage: 100 },
    baseTime: 0, // instant passive
    maxLevel: 30,
    category: 'infrastructure',
    unlockLevel: 2,
    energyCost: 1
  },
  market: {
    name: 'Рынок',
    emoji: '🏪',
    description: 'Пассивный доход монет',
    baseCost: { coins: 400, materials: 100, food: 50 },
    baseOutput: { coins: 5 },
    baseTime: 600,
    maxLevel: 40,
    category: 'commercial',
    unlockLevel: 5,
    energyCost: 2
  },
  garden: {
    name: 'Сад',
    emoji: '🌳',
    description: 'Производит еду и красоту',
    baseCost: { coins: 120, food: 30 },
    baseOutput: { food: 6, experience: 2 },
    baseTime: 480,
    maxLevel: 40,
    category: 'decoration',
    unlockLevel: 3,
    energyCost: 1
  },
  school: {
    name: 'Школа',
    emoji: '🏫',
    description: 'Генерирует опыт',
    baseCost: { coins: 600, materials: 200, food: 150 },
    baseOutput: { experience: 15 },
    baseTime: 900,
    maxLevel: 30,
    category: 'special',
    unlockLevel: 6,
    energyCost: 2
  },
  bakery: {
    name: 'Пекарня',
    emoji: '🧁',
    description: 'Конвертирует еду в монеты',
    baseCost: { coins: 250, materials: 60, food: 80 },
    baseOutput: { coins: 12 },
    baseTime: 720,
    maxLevel: 40,
    category: 'commercial',
    unlockLevel: 4,
    energyCost: 1
  },
  park: {
    name: 'Парк',
    emoji: '🎡',
    description: 'Увеличивает население и опыт',
    baseCost: { coins: 350, materials: 120 },
    baseOutput: { population: 3, experience: 5 },
    baseTime: 900,
    maxLevel: 30,
    category: 'decoration',
    unlockLevel: 7,
    energyCost: 1
  },
  bank: {
    name: 'Банк',
    emoji: '🏦',
    description: 'Большой доход монет',
    baseCost: { coins: 2000, materials: 500 },
    baseOutput: { coins: 50 },
    baseTime: 3600,
    maxLevel: 25,
    category: 'commercial',
    unlockLevel: 10,
    energyCost: 4
  },
  hospital: {
    name: 'Больница',
    emoji: '🏥',
    description: 'Увеличивает макс. население',
    baseCost: { coins: 1000, materials: 400, food: 200 },
    baseOutput: { population: 10 },
    baseTime: 1200,
    maxLevel: 20,
    category: 'special',
    unlockLevel: 8,
    energyCost: 3
  },
  library: {
    name: 'Библиотека',
    emoji: '📚',
    description: 'Большой опыт',
    baseCost: { coins: 800, materials: 250 },
    baseOutput: { experience: 25 },
    baseTime: 1500,
    maxLevel: 25,
    category: 'special',
    unlockLevel: 9,
    energyCost: 2
  },
  stadium: {
    name: 'Стадион',
    emoji: '🏟️',
    description: 'Много населения и монет',
    baseCost: { coins: 5000, materials: 1000, food: 500 },
    baseOutput: { population: 20, coins: 30 },
    baseTime: 3600,
    maxLevel: 15,
    category: 'special',
    unlockLevel: 15,
    energyCost: 5
  }
};

const RESOURCE_DEFAULTS = {
  coins: 500,
  food: 200,
  materials: 100,
  energy: 10,
  population: 0,
  experience: 0,
  crystals: 5,
  maxStorage: 500
};

const ZONE_UNLOCK_COST = function(zoneNumber) {
  return Math.floor(500 * Math.pow(zoneNumber, 2));
};

const LEVEL_XP = function(level) {
  return Math.floor(100 * Math.pow(level, 2));
};

const INCOME_FORMULA = function(base, level) {
  return Math.floor(base * Math.pow(1.18, level - 1));
};

const UPGRADE_COST_FORMULA = function(base, level) {
  return Math.floor(base * Math.pow(1.32, level));
};

const PRODUCTION_TIME_FORMULA = function(baseTime, level) {
  return Math.floor(baseTime * (1 + (level - 1) * 0.03));
};

// Quest templates
const QUEST_TEMPLATES = [
  // Level 1-5
  { type: 'build', target: 'farm', count: 1, reward: { coins: 200 }, minLevel: 1, description: 'Построй ферму' },
  { type: 'build', target: 'house', count: 1, reward: { coins: 150 }, minLevel: 1, description: 'Построй дом' },
  { type: 'collect', target: 'food', count: 50, reward: { coins: 100 }, minLevel: 1, description: 'Собери 50 еды' },
  { type: 'collect', target: 'coins', count: 200, reward: { food: 100, materials: 50 }, minLevel: 1, description: 'Заработай 200 монет' },
  { type: 'upgrade', target: 'farm', count: 2, reward: { coins: 300, crystals: 1 }, minLevel: 2, description: 'Улучши ферму до 2 уровня' },
  { type: 'build', target: 'quarry', count: 1, reward: { coins: 400 }, minLevel: 2, description: 'Построй каменоломню' },
  { type: 'build', target: 'warehouse', count: 1, reward: { coins: 300 }, minLevel: 2, description: 'Построй склад' },
  { type: 'collect', target: 'materials', count: 100, reward: { coins: 200 }, minLevel: 2, description: 'Собери 100 материалов' },
  { type: 'build', target: 'powerplant', count: 1, reward: { coins: 500, crystals: 2 }, minLevel: 3, description: 'Построй электростанцию' },
  { type: 'build', target: 'garden', count: 1, reward: { coins: 200 }, minLevel: 3, description: 'Построй сад' },
  { type: 'upgrade', target: 'house', count: 3, reward: { coins: 400 }, minLevel: 3, description: 'Улучши дом до 3 уровня' },
  { type: 'collect', target: 'food', count: 200, reward: { coins: 300, crystals: 1 }, minLevel: 3, description: 'Собери 200 еды' },

  // Level 4-7
  { type: 'build', target: 'factory', count: 1, reward: { coins: 600, crystals: 2 }, minLevel: 4, description: 'Построй фабрику' },
  { type: 'build', target: 'bakery', count: 1, reward: { coins: 400 }, minLevel: 4, description: 'Построй пекарню' },
  { type: 'upgrade', target: 'quarry', count: 3, reward: { coins: 500, materials: 200 }, minLevel: 4, description: 'Улучши каменоломню до 3 ур.' },
  { type: 'collect', target: 'coins', count: 1000, reward: { crystals: 3 }, minLevel: 4, description: 'Заработай 1000 монет' },
  { type: 'build', target: 'market', count: 1, reward: { coins: 500, crystals: 2 }, minLevel: 5, description: 'Построй рынок' },
  { type: 'upgrade', target: 'farm', count: 5, reward: { coins: 800, crystals: 2 }, minLevel: 5, description: 'Улучши ферму до 5 ур.' },
  { type: 'reach_population', target: 'population', count: 20, reward: { coins: 600 }, minLevel: 5, description: 'Достигни 20 населения' },
  { type: 'build_count', target: 'any', count: 10, reward: { coins: 1000, crystals: 3 }, minLevel: 5, description: 'Построй 10 зданий' },
  { type: 'build', target: 'school', count: 1, reward: { coins: 800, crystals: 3 }, minLevel: 6, description: 'Построй школу' },
  { type: 'build', target: 'park', count: 1, reward: { coins: 500, crystals: 2 }, minLevel: 7, description: 'Построй парк' },
  { type: 'collect', target: 'materials', count: 500, reward: { coins: 600, crystals: 2 }, minLevel: 6, description: 'Собери 500 материалов' },
  { type: 'upgrade', target: 'factory', count: 5, reward: { coins: 1000, crystals: 3 }, minLevel: 6, description: 'Улучши фабрику до 5 ур.' },

  // Level 8-12
  { type: 'build', target: 'hospital', count: 1, reward: { coins: 1200, crystals: 4 }, minLevel: 8, description: 'Построй больницу' },
  { type: 'reach_population', target: 'population', count: 50, reward: { coins: 1000, crystals: 3 }, minLevel: 8, description: 'Достигни 50 населения' },
  { type: 'build', target: 'library', count: 1, reward: { coins: 1000, crystals: 3 }, minLevel: 9, description: 'Построй библиотеку' },
  { type: 'collect', target: 'coins', count: 5000, reward: { crystals: 5 }, minLevel: 9, description: 'Заработай 5000 монет' },
  { type: 'build', target: 'bank', count: 1, reward: { coins: 2000, crystals: 5 }, minLevel: 10, description: 'Построй банк' },
  { type: 'upgrade', target: 'house', count: 10, reward: { coins: 1500, crystals: 4 }, minLevel: 10, description: 'Улучши дом до 10 ур.' },
  { type: 'build_count', target: 'any', count: 25, reward: { coins: 2000, crystals: 5 }, minLevel: 10, description: 'Построй 25 зданий' },
  { type: 'unlock_zone', target: 'zone', count: 3, reward: { coins: 3000, crystals: 5 }, minLevel: 10, description: 'Открой 3 зоны' },
  { type: 'reach_population', target: 'population', count: 100, reward: { coins: 2000, crystals: 5 }, minLevel: 11, description: 'Достигни 100 населения' },
  { type: 'collect', target: 'food', count: 2000, reward: { coins: 1500, crystals: 3 }, minLevel: 11, description: 'Собери 2000 еды' },

  // Level 13+
  { type: 'upgrade', target: 'bank', count: 5, reward: { coins: 3000, crystals: 5 }, minLevel: 13, description: 'Улучши банк до 5 ур.' },
  { type: 'build', target: 'stadium', count: 1, reward: { coins: 5000, crystals: 10 }, minLevel: 15, description: 'Построй стадион' },
  { type: 'build_count', target: 'any', count: 50, reward: { coins: 5000, crystals: 8 }, minLevel: 15, description: 'Построй 50 зданий' },
  { type: 'reach_population', target: 'population', count: 200, reward: { coins: 3000, crystals: 6 }, minLevel: 15, description: 'Достигни 200 населения' },
  { type: 'collect', target: 'coins', count: 20000, reward: { crystals: 10 }, minLevel: 15, description: 'Заработай 20000 монет' },
  { type: 'upgrade', target: 'stadium', count: 5, reward: { coins: 8000, crystals: 10 }, minLevel: 18, description: 'Улучши стадион до 5 ур.' },
  { type: 'unlock_zone', target: 'zone', count: 8, reward: { coins: 10000, crystals: 15 }, minLevel: 20, description: 'Открой 8 зон' },
  { type: 'reach_population', target: 'population', count: 500, reward: { coins: 10000, crystals: 15 }, minLevel: 20, description: 'Достигни 500 населения' },
  { type: 'build_count', target: 'any', count: 100, reward: { coins: 15000, crystals: 20 }, minLevel: 25, description: 'Построй 100 зданий' },
  { type: 'collect', target: 'coins', count: 100000, reward: { crystals: 25 }, minLevel: 25, description: 'Заработай 100000 монет' }
];

module.exports = {
  GRID_SIZE,
  INITIAL_UNLOCKED,
  BUILDING_TYPES,
  RESOURCE_DEFAULTS,
  ZONE_UNLOCK_COST,
  LEVEL_XP,
  INCOME_FORMULA,
  UPGRADE_COST_FORMULA,
  PRODUCTION_TIME_FORMULA,
  QUEST_TEMPLATES
};