/*
 * Исполнимые правила только демонстрационного стола CMT, не игрового runtime.
 * Все операции сначала проверяют условия и возвращают результат; представление
 * не списывает деньги и не двигает технику самостоятельно. Это позволяет одним
 * сценарием проверить карту, таблицу команд и нижнюю панель без сервера.
 */
(function (root, factory) {
  const api = factory(typeof module !== 'undefined' && module.exports ? require('./cmt-prototype-fixtures.js') : root.CMTFixtures);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CMTModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (fixtures) {
  'use strict';
  const PHASES = ['news', 'market', 'loading', 'movement', 'construction', 'results'];
  const PRICES = { wagon: 6, locomotive: 12, equipment: 8 };
  const ok = (message, extra = {}) => ({ ok: true, message, ...extra });
  const fail = (message) => ({ ok: false, message });
  const team = (s, id) => s.teams.find((t) => t.id === id);
  const closed = (s, id) => s.roads.some((r) => r.status === 'building' && (r.from === id || r.to === id));
  const availableGoods = (s, station, owner) => s.goods.filter((g) => g.origin === station && g.status === 'available' && (!owner || g.team === owner));
  const emptyWagons = (s, station, owner) => s.wagons.filter((w) => w.station === station && w.team === owner && !w.cargo && !w.attachedTo);
  const selectionKey = (station, owner) => station + ':' + owner;

  /** Возвращает независимую демонстрацию: сценарий сбрасывает состояние целиком. */
  function create(phase = 'news') {
    const s = fixtures.create();
    Object.assign(s, { phase: PHASES.includes(phase) ? phase : 'news', round: 1, selectedStation: 4, selectedTeam: 'ruby', currentLoco: 'L1', done: {}, finishedLocos: [], detachWindow: false, buildKind: 'wagon', buildFrom: null, buildTo: null, log: [], nextId: 30, delivered: 0 });
    s.teams.forEach((t) => { t.equipment = 1; });
    // Одна физическая карточка не может одновременно лежать в колоде и вагоне.
    s.wagons.forEach((w) => { if (w.cargo) { const g = s.goods.find((item) => item.id === w.cargo.id); if (g) g.status = 'loaded'; } });
    // Неподписанный демо-проект уже оплачен до начала показываемого раунда.
    s.roads.forEach((r) => { if (r.status === 'planned') { r.owner = 'ruby'; r.kind = 'wagon'; } if (r.status === 'building') { r.owner = 'jade'; r.kind = 'locomotive'; r.readyRound = 2; } });
    return s;
  }

  /** Обход в ширину: один перегон = одно действие. Потенциальный путь используется
   * только для показа грузов; действующий исключает закрытые дороги и станции. */
  function route(s, from, to, potential = false) {
    if (!s.stations.some((x) => x.id === from) || !s.stations.some((x) => x.id === to)) return [];
    if (!potential && (closed(s, from) || closed(s, to))) return [];
    const queue = [[from]], seen = new Set([from]);
    while (queue.length) {
      const path = queue.shift(), last = path[path.length - 1];
      if (last === to) return path;
      s.roads.filter((r) => potential || r.status === 'active').forEach((r) => {
        const next = r.from === last ? r.to : r.to === last ? r.from : null;
        if (next && !seen.has(next) && (potential || !closed(s, next))) { seen.add(next); queue.push([...path, next]); }
      });
    }
    return [];
  }
  const edge = (s, a, b) => s.roads.find((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));

  /** Перераспределяет только оставшиеся карточки завершивших выбор команд.
   * Дефицит вычисляется по пустым вагонам за вычетом ещё предложенных карточек. */
  function redistribute(s, station) {
    let count = 0;
    s.teams.filter((t) => !s.done[selectionKey(station, t.id)]).forEach((t) => {
      const shortage = Math.max(0, emptyWagons(s, station, t.id).length - availableGoods(s, station, t.id).length);
      const pool = s.goods.filter((g) => g.origin === station && g.status === 'pool');
      pool.slice(0, shortage).forEach((g) => { g.team = t.id; g.status = 'available'; count++; });
    });
    return count;
  }
  function loadGood(s, id) {
    if (s.phase !== 'loading') return fail('Загрузка доступна на этапе «Загрузка».');
    const g = s.goods.find((item) => item.id === id);
    if (!g || g.status !== 'available' || g.origin !== s.selectedStation) return fail('Эта карточка уже недоступна.');
    if (closed(s, g.origin)) return fail('Станция закрыта на время строительства.');
    if (s.done[selectionKey(g.origin, g.team)]) return fail('Команда уже завершила выбор на этой станции.');
    const w = emptyWagons(s, g.origin, g.team)[0];
    if (!w) return fail('У команды нет свободного вагона на этой станции.');
    w.cargo = { id: g.id, name: g.name, origin: g.origin, destination: g.destination, revenue: g.revenue, fee: g.fee };
    g.status = 'loaded';
    return ok(g.name + ' загружен в ' + w.id + '. Назначение — станция ' + g.destination + '.');
  }
  function finishSelection(s, owner, station = s.selectedStation) {
    if (!team(s, owner)) return fail('Команда не найдена.');
    if (s.phase !== 'loading' || closed(s, station)) return fail('Сейчас завершить загрузку нельзя.');
    const key = selectionKey(station, owner);
    if (s.done[key]) return fail('Выбор этой команды уже завершён.');
    s.done[key] = true;
    availableGoods(s, station, owner).forEach((g) => { g.status = 'pool'; });
    const count = redistribute(s, station);
    return ok(team(s, owner).name + ': выбор завершён.' + (count ? ' Передано другим командам карточек: ' + count + '.' : ''));
  }
  function buy(s, kind) {
    if (s.phase !== 'market' || !PRICES[kind]) return fail('Покупка доступна на этапе «Техника».');
    if (closed(s, s.selectedStation)) return fail('На закрытой станции покупка недоступна.');
    const t = team(s, s.selectedTeam);
    if (!t) return fail('Выберите команду.');
    if (t.cash < PRICES[kind]) return fail('Недостаточно монет для покупки.');
    if (kind === 'locomotive' && s.locomotives.filter((l) => l.station === s.selectedStation).length >= 2) return fail('На станции уже два локомотива. Выберите другую станцию.');
    t.cash -= PRICES[kind];
    if (kind === 'wagon') s.wagons.push({ id: 'W' + s.nextId++, team: t.id, station: s.selectedStation, cargo: null, attachedTo: null });
    else if (kind === 'locomotive') s.locomotives.push({ id: 'L' + s.nextId++, name: 'Экспресс', team: t.id, station: s.selectedStation, actions: 4, attached: [] });
    else t.equipment++;
    return ok('Покупка для команды «' + t.name + '»: −' + PRICES[kind] + ' монет.');
  }
  function sell(s, kind, id) {
    if (!PRICES[kind]) return fail('Неизвестный вид техники.');
    if (s.phase !== 'market') return fail('Продажа доступна на этапе «Техника».');
    const t = team(s, s.selectedTeam);
    if (!t) return fail('Выберите команду.');
    if (kind === 'equipment') {
      if (t.equipment < 1) return fail('У команды нет оборудования.');
      t.equipment--;
    } else {
      const array = kind === 'wagon' ? s.wagons : s.locomotives;
      const item = array.find((a) => a.id === id);
      if (!item || item.team !== t.id || item.station !== s.selectedStation) return fail('Можно продать только технику выбранной команды на выбранной станции.');
      if (closed(s, item.station)) return fail('Станция закрыта на время строительства.');
      if (item.cargo || item.attachedTo || (item.attached && item.attached.length)) return fail('Перед продажей техника должна быть пустой и отцепленной.');
      array.splice(array.indexOf(item), 1);
    }
    t.cash += PRICES[kind] / 2;
    return ok('Техника продана. +' + PRICES[kind] / 2 + ' монет.');
  }
  function current(s) { return s.locomotives.find((l) => l.id === s.currentLoco); }
  function selectLoco(s, id) {
    const loco = s.locomotives.find((l) => l.id === id);
    if (!loco || s.phase !== 'movement') return fail('Локомотив недоступен.');
    if (s.finishedLocos.includes(id)) return fail('Ход этого локомотива уже завершён.');
    if (s.detachWindow) return fail('Сначала завершите окно отцепления кнопкой «Следующий локомотив».');
    s.currentLoco = id; s.selectedStation = loco.station; s.selectedTeam = loco.team;
    return ok('Ход локомотива «' + loco.name + '».');
  }
  function attach(s, id) {
    const l = current(s), w = s.wagons.find((v) => v.id === id);
    if (s.phase !== 'movement' || s.detachWindow || !l || s.finishedLocos.includes(l.id)) return fail('Сейчас прицеплять вагоны нельзя.');
    if (!w || w.station !== l.station || w.attachedTo || !w.cargo) return fail('Можно прицепить свободный загруженный вагон на текущей станции.');
    if (closed(s, l.station)) return fail('Станция закрыта.');
    if (l.actions < 1) return fail('У локомотива закончились действия.');
    w.attachedTo = l.id; l.attached.push(w.id); l.actions--;
    return ok(w.id + ' прицеплен. −1 действие.');
  }
  /** Сначала проверяются все платежи, затем одновременно двигается весь состав.
   * Тариф переводится от владельца вагона владельцу локомотива за каждый перегон. */
  function move(s, destination) {
    const l = current(s);
    if (s.phase !== 'movement' || s.detachWindow || !l || s.finishedLocos.includes(l.id)) return fail('Сейчас движение недоступно.');
    if (l.actions < 1) return fail('Действия закончились. Завершите ход локомотива.');
    if (destination === l.station) return fail('Локомотив уже на этой станции.');
    const r = edge(s, l.station, destination);
    if (!r || r.status !== 'active') return fail('Для движения выберите соседнюю станцию с действующей дорогой.');
    if (closed(s, l.station) || closed(s, destination)) return fail('Станция закрыта на время строительства.');
    if (s.locomotives.filter((v) => v.station === destination).length >= 2) return fail('На станции назначения уже два локомотива.');
    const wagons = s.wagons.filter((w) => w.attachedTo === l.id);
    const debits = {};
    wagons.forEach((w) => { if (w.team !== l.team) debits[w.team] = (debits[w.team] || 0) + 2; });
    if (Object.entries(debits).some(([owner, amount]) => team(s, owner).cash < amount)) return fail('Владельцу одного из вагонов не хватает монет на перегон.');
    Object.entries(debits).forEach(([owner, amount]) => { team(s, owner).cash -= amount; team(s, l.team).cash += amount; });
    l.station = destination; l.actions--; s.selectedStation = destination;
    let reward = 0, delivered = 0;
    wagons.forEach((w) => {
      w.station = destination;
      if (w.cargo && w.cargo.destination === destination) {
        reward += w.cargo.revenue; delivered++;
        team(s, w.team).cash += w.cargo.revenue;
        team(s, w.team).score += w.cargo.revenue;
        const g = s.goods.find((a) => a.id === w.cargo.id); if (g) g.status = 'delivered';
        w.cargo = null; w.attachedTo = null;
        l.attached = l.attached.filter((id) => id !== w.id);
      }
    });
    s.delivered += delivered;
    return ok('Станция ' + destination + '. −1 действие.' + (delivered ? ' Доставлено: ' + delivered + '. Выручка +' + reward + ', вагоны отцеплены.' : ' Перегон: 2 монеты за вагон.'), { delivered, reward });
  }
  function finishLoco(s) {
    const l = current(s);
    if (s.phase !== 'movement' || !l || s.detachWindow) return fail('Нет активного хода.');
    if (!s.finishedLocos.includes(l.id)) s.finishedLocos.push(l.id);
    s.detachWindow = true;
    return ok('Ход завершён. Владельцы вагонов могут бесплатно отцепить свои вагоны.');
  }
  function detach(s, id) {
    const w = s.wagons.find((a) => a.id === id);
    if (s.phase !== 'movement' || !s.detachWindow || !w || !w.attachedTo) return fail('Отцепление доступно после завершения хода локомотива.');
    const l = s.locomotives.find((a) => a.id === w.attachedTo);
    l.attached = l.attached.filter((a) => a !== w.id); w.attachedTo = null;
    return ok(w.id + ' отцеплен бесплатно; груз остаётся в вагоне.');
  }
  function nextLoco(s) {
    if (!s.detachWindow) return fail('Сначала завершите текущий ход.');
    const next = s.locomotives.find((l) => !s.finishedLocos.includes(l.id));
    if (!next) return ok('Все локомотивы завершили ход. Можно перейти к строительству.');
    s.detachWindow = false; return selectLoco(s, next.id);
  }
  /** В демо области дороги заданы в фикстуре. Для произвольной пары пользователь
   * задаёт их количество в панели — карта не выдаёт длину за число областей. */
  function project(s, areas = 1) {
    if (s.phase !== 'construction' || !s.buildFrom || !s.buildTo || s.buildFrom === s.buildTo) return fail('Выберите две разные станции.');
    if (![s.buildFrom, s.buildTo].every((id) => s.stations.some((station) => station.id === id))) return fail('Станция не найдена.');
    let r = edge(s, s.buildFrom, s.buildTo);
    if (r && r.status !== 'potential') return fail('У этой дороги уже есть проект или она построена.');
    const count = r ? r.areas : Math.max(1, Math.min(12, Math.floor(Number(areas)) || 1));
    const t = team(s, s.selectedTeam);
    if (!t) return fail('Выберите команду.');
    if (t.cash < count) return fail('Недостаточно монет на проект.');
    if (!r) {
      const p = s.stations.find((x) => x.id === s.buildFrom).point, q = s.stations.find((x) => x.id === s.buildTo).point;
      r = { id: 'r' + s.buildFrom + '-' + s.buildTo, from: s.buildFrom, to: s.buildTo, path: 'M ' + p.join(' ') + ' L ' + q.join(' '), areas: count };
      s.roads.push(r);
    }
    t.cash -= count; r.status = 'planned'; r.owner = t.id; r.kind = s.buildKind;
    return ok('Проект ' + r.from + '—' + r.to + ' оплачен: −' + count + '. Строительство можно отложить.');
  }
  function build(s) {
    const r = edge(s, s.buildFrom, s.buildTo), t = team(s, s.selectedTeam);
    if (!t) return fail('Выберите команду.');
    if (s.phase !== 'construction' || !r || r.status !== 'planned') return fail('Сначала подготовьте проект дороги.');
    if (r.owner !== t.id || r.kind !== s.buildKind) return fail('Выберите команду и тип строителя, которым принадлежит проект.');
    if (t.cash < r.areas) return fail('Недостаточно монет на строительство.');
    t.cash -= r.areas; r.status = 'building'; r.readyRound = s.round + 1;
    return ok('Строительство начато: −' + r.areas + '. Обе станции закрыты до следующего раунда.');
  }
  /** «Дальше» завершает фазу. Пропущенные выборы считаются отказом от оставшихся
   * карточек, но возможность воспользоваться перераспределением есть до перехода. */
  function next(s) {
    const i = PHASES.indexOf(s.phase);
    if (s.phase === 'movement' && s.locomotives.length) {
      if (!s.detachWindow) {
        finishLoco(s);
        return ok('Ход закончен. Можно бесплатно отцепить вагоны, затем нажать «Дальше».');
      }
      if (s.locomotives.some((l) => !s.finishedLocos.includes(l.id))) return nextLoco(s);
    }
    if (s.phase === 'results') {
      s.round++; s.phase = 'news'; s.done = {}; s.finishedLocos = []; s.detachWindow = false;
      s.locomotives.forEach((l) => { l.actions = 4; });
      s.roads.forEach((r) => { if (r.status === 'building' && r.readyRound <= s.round) r.status = 'active'; });
      // Новая колода повторяет демонстрационные предложения, сохраняя доставленные
      // карточки как историю и не дублируя карточки уже загруженных вагонов.
      const additions = fixtures.create().goods.map((g) => ({ ...g, id: g.id + '-r' + s.round, status: 'available' }));
      s.goods.forEach((g) => { if (g.status === 'available' || g.status === 'pool') g.status = 'discarded'; });
      s.goods.push(...additions);
      return ok('Раунд ' + s.round + '. Завершённые дороги открыты.');
    }
    s.phase = PHASES[i + 1];
    if (s.phase === 'movement') {
      s.finishedLocos = []; s.detachWindow = false;
      const l = s.locomotives[0]; if (l) { s.currentLoco = l.id; s.selectedStation = l.station; s.selectedTeam = l.team; }
    }
    return ok('Следующий этап.');
  }
  /** Сопоставимая с офлайновым листом таблица: деньги, количество и цена имущества. */
  function results(s) {
    return s.teams.map((t) => {
      const wagons = s.wagons.filter((w) => w.team === t.id).length, locomotives = s.locomotives.filter((l) => l.team === t.id).length;
      const assetValue = wagons * PRICES.wagon + locomotives * PRICES.locomotive + t.equipment * PRICES.equipment;
      return { ...t, wagons, locomotives, assetValue, points: t.cash + assetValue };
    }).sort((a, b) => b.points - a.points);
  }
  return { create, PHASES, PRICES, team, closed, route, edge, current, availableGoods, emptyWagons, selectionKey, loadGood, finishSelection, buy, sell, selectLoco, attach, move, finishLoco, detach, nextLoco, project, build, next, results };
}));
