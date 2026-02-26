var GRID_SIZE = 40;
var INITIAL_UNLOCKED = 10;

var BUILDING_TYPES = {
  farm: {
    name: 'Ферма',
    emoji: '🌾',
    description: 'Производит еду',
    baseCost: { coins: 100, materials: 50 },
    baseOutput: { food: 10 },
    baseTime: 300,
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
    baseTime: 900,
    maxLevel: 50,
    category: 'production',
    unlockLevel: 1,
    energyCost: 2
  },
  factory: {
    name: 'Фабрика',
    emoji: '🏭',
    description: 'Конвертирует ресурсы в монеты',
    baseCost: { coins: 500, materials: 200, food: 100 },
    baseOutput: { coins: 25 },
    baseTime: 1800,
    maxLevel: 50,
    category: 'production',
    unlockLevel: 3,
    energyCost: 3
  },
  powerplant: {
    name: 'Электростанция',
    emoji: '⚡',
    description: 'Производит энергию',
    baseCost: { coins: 800, materials: 300 },
    baseOutput: { energy: 5 },
    baseTime: 1200,
    maxLevel: 30,
    category: 'infrastructure',
    unlockLevel: 2,
    energyCost: 0
  },
  house: {
    name: 'Жилой дом',
    emoji: '🏠',
    description: 'Увеличивает население',
    baseCost: { coins: 150, materials: 80 },
    baseOutput: { population: 5 },
    baseTime: 600,
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
    baseTime: 0,
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
    unlockLevel: 4,
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
    unlockLevel: 2,
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
    unlockLevel: 5,
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
    unlockLevel: 3,
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
    unlockLevel: 5,
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
    unlockLevel: 8,
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
    unlockLevel: 6,
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
    unlockLevel: 7,
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
    unlockLevel: 12,
    energyCost: 5
  },
  crystalmine: {
    name: 'Кристальная шахта',
    emoji: '💎',
    description: 'Добывает кристаллы (~1 в час). Донат-валюта для обмена!',
    baseCost: { coins: 50000, materials: 20000, food: 10000 },
    baseOutput: { crystals: 1 },
    baseTime: 3600,
    maxLevel: 10,
    category: 'special',
    unlockLevel: 15,
    energyCost: 8
  },
  arcanetower: {
    name: 'Магическая башня',
    emoji: '🗼',
    description: 'Усиливает производство опыта и монет',
    baseCost: { coins: 30000, materials: 15000, food: 8000 },
    baseOutput: { experience: 100, coins: 200 },
    baseTime: 7200,
    maxLevel: 10,
    category: 'special',
    unlockLevel: 13,
    energyCost: 6
  }
};

var RESOURCE_DEFAULTS = {
  coins: 5000,
  food: 2000,
  materials: 1000,
  energy: 10,
  population: 0,
  experience: 0,
  crystals: 50,
  maxStorage: 50000
};

// Fixed story quests
var QUEST_TEMPLATES = [
  { id: 's1', type: 'build', target: 'farm', count: 1, reward: { coins: 300, materials: 200 }, minLevel: 1, description: 'Построй первую ферму' },
  { id: 's2', type: 'build', target: 'house', count: 1, reward: { coins: 300, food: 200 }, minLevel: 1, description: 'Построй первый дом' },
  { id: 's3', type: 'build', target: 'quarry', count: 1, reward: { coins: 400, crystals: 5 }, minLevel: 1, description: 'Построй каменоломню' },
  { id: 's4', type: 'collect', target: 'food', count: 50, reward: { coins: 300 }, minLevel: 1, description: 'Собери 50 еды' },
  { id: 's5', type: 'collect', target: 'materials', count: 50, reward: { coins: 300 }, minLevel: 1, description: 'Собери 50 материалов' },
  { id: 's6', type: 'build', target: 'powerplant', count: 1, reward: { coins: 500, crystals: 5 }, minLevel: 2, description: 'Построй электростанцию' },
  { id: 's7', type: 'build', target: 'garden', count: 1, reward: { coins: 300 }, minLevel: 2, description: 'Построй сад' },
  { id: 's8', type: 'build', target: 'warehouse', count: 1, reward: { coins: 400 }, minLevel: 2, description: 'Построй склад' },
  { id: 's9', type: 'upgrade', target: 'farm', count: 3, reward: { coins: 500, crystals: 3 }, minLevel: 2, description: 'Улучши ферму до 3 ур.' },
  { id: 's10', type: 'upgrade', target: 'house', count: 3, reward: { coins: 500 }, minLevel: 2, description: 'Улучши дом до 3 ур.' },
  { id: 's11', type: 'build', target: 'factory', count: 1, reward: { coins: 600, crystals: 5 }, minLevel: 3, description: 'Построй фабрику' },
  { id: 's12', type: 'build', target: 'bakery', count: 1, reward: { coins: 500 }, minLevel: 3, description: 'Построй пекарню' },
  { id: 's13', type: 'build_count', target: 'any', count: 5, reward: { coins: 800, crystals: 5 }, minLevel: 2, description: 'Построй 5 зданий' },
  { id: 's14', type: 'build_count', target: 'any', count: 10, reward: { coins: 1500, crystals: 8 }, minLevel: 3, description: 'Построй 10 зданий' },
  { id: 's15', type: 'collect', target: 'coins', count: 1000, reward: { crystals: 10 }, minLevel: 3, description: 'Заработай 1000 монет' },
  { id: 's16', type: 'build', target: 'market', count: 1, reward: { coins: 800, crystals: 5 }, minLevel: 4, description: 'Построй рынок' },
  { id: 's17', type: 'upgrade', target: 'quarry', count: 5, reward: { coins: 800, materials: 500 }, minLevel: 4, description: 'Улучши каменоломню до 5 ур.' },
  { id: 's18', type: 'reach_population', target: 'population', count: 20, reward: { coins: 1000 }, minLevel: 4, description: 'Достигни 20 населения' },
  { id: 's19', type: 'build', target: 'school', count: 1, reward: { coins: 1000, crystals: 8 }, minLevel: 5, description: 'Построй школу' },
  { id: 's20', type: 'build', target: 'park', count: 1, reward: { coins: 800, crystals: 5 }, minLevel: 5, description: 'Построй парк' },
  { id: 's21', type: 'build_count', target: 'any', count: 20, reward: { coins: 2000, crystals: 10 }, minLevel: 5, description: 'Построй 20 зданий' },
  { id: 's22', type: 'collect', target: 'food', count: 1000, reward: { coins: 1000, crystals: 5 }, minLevel: 5, description: 'Собери 1000 еды' },
  { id: 's23', type: 'build', target: 'hospital', count: 1, reward: { coins: 1500, crystals: 8 }, minLevel: 6, description: 'Построй больницу' },
  { id: 's24', type: 'build', target: 'library', count: 1, reward: { coins: 1200, crystals: 8 }, minLevel: 7, description: 'Построй библиотеку' },
  { id: 's25', type: 'reach_population', target: 'population', count: 50, reward: { coins: 2000, crystals: 10 }, minLevel: 7, description: 'Достигни 50 населения' },
  { id: 's26', type: 'build', target: 'bank', count: 1, reward: { coins: 3000, crystals: 10 }, minLevel: 8, description: 'Построй банк' },
  { id: 's27', type: 'collect', target: 'coins', count: 10000, reward: { crystals: 15 }, minLevel: 8, description: 'Заработай 10000 монет' },
  { id: 's28', type: 'build_count', target: 'any', count: 40, reward: { coins: 5000, crystals: 15 }, minLevel: 9, description: 'Построй 40 зданий' },
  { id: 's29', type: 'unlock_zone', target: 'zone', count: 3, reward: { coins: 5000, crystals: 10 }, minLevel: 8, description: 'Открой 3 зоны' },
  { id: 's30', type: 'reach_population', target: 'population', count: 100, reward: { coins: 5000, crystals: 15 }, minLevel: 10, description: 'Достигни 100 населения' },
  { id: 's31', type: 'build', target: 'stadium', count: 1, reward: { coins: 8000, crystals: 20 }, minLevel: 12, description: 'Построй стадион' },
  { id: 's32', type: 'build_count', target: 'any', count: 70, reward: { coins: 10000, crystals: 20 }, minLevel: 15, description: 'Построй 70 зданий' },
  { id: 's33', type: 'collect', target: 'coins', count: 50000, reward: { crystals: 30 }, minLevel: 15, description: 'Заработай 50000 монет' },
  { id: 's34', type: 'reach_population', target: 'population', count: 300, reward: { coins: 15000, crystals: 25 }, minLevel: 18, description: 'Достигни 300 населения' },
  { id: 's35', type: 'unlock_zone', target: 'zone', count: 8, reward: { coins: 20000, crystals: 30 }, minLevel: 20, description: 'Открой 8 зон' },
  { id: 's36', type: 'build', target: 'arcanetower', count: 1, reward: { coins: 20000, crystals: 15 }, minLevel: 13, description: 'Построй Магическую башню' },
  { id: 's37', type: 'build', target: 'crystalmine', count: 1, reward: { coins: 50000, crystals: 25 }, minLevel: 15, description: 'Построй Кристальную шахту' }
];

// Random quest generators
var RANDOM_QUEST_POOLS = {
  build: [
    { target: 'farm', desc: 'Построй ферму', base_reward: 200 },
    { target: 'house', desc: 'Построй дом', base_reward: 200 },
    { target: 'quarry', desc: 'Построй каменоломню', base_reward: 300 },
    { target: 'garden', desc: 'Построй сад', base_reward: 200 },
    { target: 'factory', desc: 'Построй фабрику', base_reward: 400 },
    { target: 'bakery', desc: 'Построй пекарню', base_reward: 300 },
    { target: 'market', desc: 'Построй рынок', base_reward: 400 },
    { target: 'powerplant', desc: 'Построй электростанцию', base_reward: 500 },
    { target: 'warehouse', desc: 'Построй склад', base_reward: 300 },
    { target: 'school', desc: 'Построй школу', base_reward: 500 },
    { target: 'park', desc: 'Построй парк', base_reward: 400 },
    { target: 'arcanetower', desc: 'Построй Магическую башню', base_reward: 5000 },
    { target: 'crystalmine', desc: 'Построй Кристальную шахту', base_reward: 10000 }
  ],
  collect: [
    { target: 'coins', desc: 'Заработай {n} монет', multiplier: 500 },
    { target: 'food', desc: 'Собери {n} еды', multiplier: 200 },
    { target: 'materials', desc: 'Собери {n} материалов', multiplier: 150 }
  ],
  upgrade: [
    { target: 'farm', desc: 'Улучши ферму до {n} ур.' },
    { target: 'house', desc: 'Улучши дом до {n} ур.' },
    { target: 'quarry', desc: 'Улучши каменоломню до {n} ур.' },
    { target: 'factory', desc: 'Улучши фабрику до {n} ур.' }
  ],
  spend: [
    { target: 'coins', desc: 'Потрать {n} монет', multiplier: 300 },
    { target: 'food', desc: 'Потрать {n} еды', multiplier: 100 },
    { target: 'materials', desc: 'Потрать {n} материалов', multiplier: 80 }
  ]
};

function ZONE_UNLOCK_COST(zoneNumber) {
  return Math.floor(500 * Math.pow(zoneNumber, 2));
}

function LEVEL_XP(level) {
  return Math.floor(50 * level + 20);
}

function INCOME_FORMULA(base, level) {
  return Math.floor(base * Math.pow(1.18, level - 1));
}

function UPGRADE_COST_FORMULA(base, level) {
  return Math.floor(base * Math.pow(1.32, level));
}

function PRODUCTION_TIME_FORMULA(baseTime, level) {
  return Math.floor(baseTime * (1 + (level - 1) * 0.03));
}

module.exports = {
  GRID_SIZE: GRID_SIZE,
  INITIAL_UNLOCKED: INITIAL_UNLOCKED,
  BUILDING_TYPES: BUILDING_TYPES,
  RESOURCE_DEFAULTS: RESOURCE_DEFAULTS,
  ZONE_UNLOCK_COST: ZONE_UNLOCK_COST,
  LEVEL_XP: LEVEL_XP,
  INCOME_FORMULA: INCOME_FORMULA,
  UPGRADE_COST_FORMULA: UPGRADE_COST_FORMULA,
  PRODUCTION_TIME_FORMULA: PRODUCTION_TIME_FORMULA,
  QUEST_TEMPLATES: QUEST_TEMPLATES,
  RANDOM_QUEST_POOLS: RANDOM_QUEST_POOLS
};