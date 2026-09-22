/*
 * Offline fixture for the CMT (cargo, movement and trade) interaction study.
 * The prototype consumes this plain JSON-like model instead of reaching a
 * server, so every create() call returns independent arrays and objects.
 */
(function (root, factory) {
  'use strict';
  const fixtures = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = fixtures;
  if (root) root.CMTFixtures = fixtures;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // These three arrays deliberately mirror transport-network-prototype.js.
  // Keeping the map coordinates here makes this file usable as a standalone
  // browser fixture while preserving the visual map's station geometry.
  const REGIONS = ['Центральная Гвинея', 'Центральная Гвинея', 'Центральная Гвинея', 'Северная Гвинея', 'Белая Гвинея', 'Северная Гвинея', 'Белая Гвинея', 'Северная Гвинея', 'Северная Гвинея', 'Северная Гвинея', 'Южная Гвинея Рорштаха', 'Южная Гвинея Рорштаха', 'Нижняя Гвинея', 'Ультраправая Гвинея', 'Ультраправая Гвинея', 'Подбрюшинная Гвинея', 'Нижняя Гвинея', 'Народная Гвинея', 'Народная Гвинея', 'Левая Гвинея', 'Левая Гвинея', 'Южная Гвинея Рорштаха', 'Южная Гвинея Рорштаха'];
  const POINTS = [[1391,575],[1267,602],[1070,620],[1128,425],[794,387],[892,300],[959,447],[1023,118],[1358,252],[1234,400],[905,576],[698,569],[1380,693],[1716,741],[1598,575],[1305,875],[1455,970],[1637,860],[1690,1085],[339,863],[375,490],[688,780],[992,731]];
  const OFFSETS = [[38,-102],[0,80],[40,120],[-100,-130],[-166,32],[34,-112],[45,72],[36,60],[-165,-72],[38,-104],[35,80],[-159,65],[42,-112],[-70,100],[40,68],[30,100],[40,72],[-152,-106],[-154,55],[40,-102],[-153,-102],[37,66],[40,110]];

  const TEAM_FIXTURES = [
    { id: 'ruby', name: 'Рубин', color: '#b85b50', short: 'Ру', cash: 65 },
    { id: 'azure', name: 'Лазурь', color: '#467d9b', short: 'Ла', cash: 58 },
    { id: 'jade', name: 'Нефрит', color: '#53856c', short: 'Не', cash: 52 },
    { id: 'amber', name: 'Янтарь', color: '#bb9444', short: 'Ян', cash: 47 },
    { id: 'violet', name: 'Аметист', color: '#8c739e', short: 'Ам', cash: 40 }
  ];

  function makeStations() {
    return POINTS.map((point, index) => ({
      id: index + 1,
      name: `Станция ${String(index + 1).padStart(2, '0')}`,
      region: REGIONS[index],
      point: [...point],
      offset: [...OFFSETS[index]]
    }));
  }

  function makeRoads() {
    const active = {
      '1-2': 'M 1391 575 L 1326 585 L 1267 602', '1-9': 'M 1391 575 L 1375 465 L 1358 252',
      '2-3': 'M 1267 602 L 1207 514 L 1070 620', '4-7': 'M 1128 425 L 1045 438 L 959 447',
      '5-6': 'M 794 387 L 842 342 L 892 300', '6-7': 'M 892 300 L 926 372 L 959 447',
      '6-8': 'M 892 300 L 1094 300 L 1023 118', '6-9': 'M 892 300 L 1094 300 L 1358 252'
    };
    const edges = Object.entries(active).map(([key, path]) => {
      const [from, to] = key.split('-').map(Number);
      return { id: `r${from}-${to}`, from, to, path, status: 'active', areas: 1, owner: null, kind: null };
    });
    const stationPoint = (id) => POINTS[id - 1];
    const straight = (from, to, status, areas) => {
      const [x1, y1] = stationPoint(from); const [x2, y2] = stationPoint(to);
      return { id: `r${from}-${to}`, from, to, path: `M ${x1} ${y1} L ${x2} ${y2}`, status, areas, owner: null, kind: null };
    };
    // Only the building road closes its endpoints. A planned road is unavailable
    // for travel but does not close its stations. Potential links sketch growth.
    edges.push(straight(4, 10, 'planned', 2), straight(11, 23, 'building', 2));
    [[7,11],[5,12],[1,15],[1,13],[13,16],[13,17],[15,14],[14,18],[17,19],[18,19],[12,21],[21,20],[12,22],[22,23]]
      .forEach(([from, to]) => edges.push(straight(from, to, 'potential', 1 + ((from + to) % 4))));
    return edges;
  }

  function makeWagons() {
    const wagons = [];
    const teams = ['ruby', 'ruby', 'ruby', 'azure', 'azure', 'jade', 'jade', 'jade', 'jade', 'amber', 'amber', 'violet'];
    teams.forEach((team, index) => {
      const cargo = index === 0 ? { id: 'G01', name: 'Лес', origin: 4, destination: 7, revenue: 12, fee: 2 } : index === 3 ? { id: 'G12', name: 'Сталь', origin: 4, destination: 6, revenue: 16, fee: 2 } : null;
      wagons.push({ id: `W${String(index + 1).padStart(2, '0')}`, team, station: 4, cargo, attachedTo: null });
    });
    [['jade', 6], ['amber', 6], ['violet', 7], ['ruby', 9], ['azure', 10], ['jade', 12]].forEach(([team, station], index) => {
      wagons.push({ id: `W${String(13 + index).padStart(2, '0')}`, team, station, cargo: null, attachedTo: null });
    });
    return wagons;
  }

  function makeGoods() {
    return [
      { id: 'G01', name: 'Лес', origin: 4, destination: 7, team: 'ruby', revenue: 12, fee: 2, status: 'available' },
      { id: 'G03', name: 'Почта', origin: 4, destination: 9, team: 'azure', revenue: 10, fee: 2, status: 'available' },
      { id: 'G04', name: 'Зерно', origin: 4, destination: 10, team: 'azure', revenue: 14, fee: 2, status: 'available' },
      { id: 'G05', name: 'Уголь', origin: 4, destination: 12, team: 'azure', revenue: 18, fee: 2, status: 'available' },
      { id: 'G06', name: 'Ткань', origin: 4, destination: 7, team: 'jade', revenue: 11, fee: 2, status: 'available' },
      { id: 'G07', name: 'Медь', origin: 4, destination: 6, team: 'amber', revenue: 15, fee: 2, status: 'available' },
      { id: 'G08', name: 'Чай', origin: 4, destination: 9, team: 'violet', revenue: 8, fee: 2, status: 'available' },
      { id: 'G09', name: 'Сталь', origin: 6, destination: 1, team: 'jade', revenue: 16, fee: 2, status: 'available' },
      { id: 'G10', name: 'Соль', origin: 7, destination: 4, team: 'azure', revenue: 13, fee: 2, status: 'available' },
      { id: 'G11', name: 'Машины', origin: 1, destination: 10, team: 'amber', revenue: 22, fee: 2, status: 'available' },
      { id: 'G12', name: 'Сталь', origin: 4, destination: 6, team: 'azure', revenue: 16, fee: 2, status: 'available' }
    ];
  }

  function create() {
    return {
      stations: makeStations(),
      teams: TEAM_FIXTURES.map((team) => ({ ...team, score: 0 })),
      locomotives: [
        { id: 'L1', name: 'Стрела', team: 'ruby', station: 4, actions: 4, attached: [] },
        { id: 'L2', name: 'Молния', team: 'azure', station: 4, actions: 4, attached: [] },
        { id: 'L3', name: 'Изумруд', team: 'jade', station: 6, actions: 4, attached: [] },
        { id: 'L4', name: 'Янтарный ход', team: 'amber', station: 1, actions: 4, attached: [] }
      ],
      wagons: makeWagons(),
      goods: makeGoods(),
      roads: makeRoads(),
      news: [
        { title: 'Северный узел готовится к сезону', body: 'Станция 04 принимает больше заказов на лес и сталь; диспетчеры советуют заранее бронировать вагоны.', tag: 'Рынок', impact: 'Заказы уже на станции 04. Подготовьте парк к отправлению.' },
        { title: 'Инженеры расширяют сеть', body: 'Новые соединения открывают короткие пути к грузовым станциям. Проверьте готовые дороги и выберите следующее направление.', tag: 'Строительство', impact: 'Проект можно отложить. Строящиеся дороги открываются с новым раундом.' },
        { title: 'Почтовый груз ищет свободный состав', body: 'На станции 04 накопились срочные отправления Лазури — часть заказа может перейти соседней команде.', tag: 'Грузы', impact: 'Завершённый выбор освобождает оставшиеся карточки для команд с пустыми вагонами.' }
      ]
    };
  }

  return { create };
}));
