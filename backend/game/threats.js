// ===== THREAT SYSTEM =====
// Threats spawn randomly, attack buildings/resources if not killed

var THREAT_TYPES = {
  bear: {
    name: 'Медведь',
    emoji: '🐻',
    description: 'Атакует фермы и уничтожает урожай',
    hp: 3,
    reward: { food: 50, coins: 100 },
    targets: ['farm', 'garden', 'bakery'],
    damage: { food: 200, materials: 0 },
    spawnLevelMin: 1,
    rarity: 40
  },
  wolf: {
    name: 'Волк',
    emoji: '🐺',
    description: 'Нападает на жителей, снижает население',
    hp: 4,
    reward: { coins: 150, food: 30 },
    targets: ['house', 'hospital'],
    damage: { population_fear: 1 },
    spawnLevelMin: 2,
    rarity: 30
  },
  bandits: {
    name: 'Бандиты',
    emoji: '🗡️',
    description: 'Грабят монеты из рынка и банка',
    hp: 6,
    reward: { coins: 300, crystals: 1 },
    targets: ['market', 'bank', 'bakery'],
    damage: { coins: 500 },
    spawnLevelMin: 3,
    rarity: 20
  },
  dragon: {
    name: 'Дракон',
    emoji: '🐉',
    description: 'Сжигает постройки и ворует ресурсы',
    hp: 12,
    reward: { coins: 1000, crystals: 3, materials: 200 },
    targets: ['factory', 'powerplant', 'stadium', 'arcanetower'],
    damage: { coins: 1000, materials: 500 },
    spawnLevelMin: 8,
    rarity: 8
  },
  goblin: {
    name: 'Гоблин-вор',
    emoji: '👺',
    description: 'Ворует материалы со склада',
    hp: 2,
    reward: { coins: 80, materials: 50 },
    targets: ['warehouse', 'quarry'],
    damage: { materials: 300 },
    spawnLevelMin: 2,
    rarity: 25
  },
  demon: {
    name: 'Демон',
    emoji: '👿',
    description: 'Разрушает магические строения',
    hp: 15,
    reward: { coins: 1500, crystals: 5 },
    targets: ['crystalmine', 'arcanetower', 'library'],
    damage: { coins: 800, crystals: 2 },
    spawnLevelMin: 12,
    rarity: 5
  }
};

function getAvailableThreats(level) {
  return Object.keys(THREAT_TYPES).filter(function(k) {
    return THREAT_TYPES[k].spawnLevelMin <= level;
  });
}

function rollThreatType(level) {
  var available = getAvailableThreats(level);
  if (!available.length) return 'bear';
  var totalRarity = available.reduce(function(s,k){ return s + THREAT_TYPES[k].rarity; }, 0);
  var roll = Math.random() * totalRarity;
  var acc = 0;
  for (var i = 0; i < available.length; i++) {
    acc += THREAT_TYPES[available[i]].rarity;
    if (roll <= acc) return available[i];
  }
  return available[0];
}

module.exports = { THREAT_TYPES: THREAT_TYPES, rollThreatType: rollThreatType };
