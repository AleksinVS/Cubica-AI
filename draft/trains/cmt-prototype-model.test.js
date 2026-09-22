/*
 * Behavioral checks for the offline CMT interaction study.
 * Each test starts with a new fixture so a failed action cannot be hidden by
 * another test's changes. Run with `node --test draft/trains/cmt-prototype-model.test.js`.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('./cmt-prototype-model.js');

const wagon = (state, id) => state.wagons.find((item) => item.id === id);
const loco = (state, id) => state.locomotives.find((item) => item.id === id);
const good = (state, id) => state.goods.find((item) => item.id === id);
const cash = (state, id) => model.team(state, id).cash;
const snapshot = (state) => JSON.stringify(state);

test('a fresh board has independent fixtures and one physical copy of each preloaded cargo', () => {
  const first = model.create('loading');
  const second = model.create('loading');
  assert.equal(wagon(first, 'W01').cargo.id, 'G01');
  assert.equal(good(first, 'G01').status, 'loaded');
  assert.equal(first.wagons.filter((item) => item.cargo?.id === 'G01').length, 1);
  assert.equal(wagon(first, 'W04').cargo.id, 'G12');
  assert.equal(good(first, 'G12').status, 'loaded');
  assert.equal(model.loadGood(first, 'G01').ok, false);
  first.teams[0].cash = 0;
  first.wagons[0].cargo = null;
  assert.equal(cash(second, 'ruby'), 65);
  assert.equal(wagon(second, 'W01').cargo.id, 'G01');
});

test('a cargo card loads once into an eligible free wagon and updates its card state', () => {
  const state = model.create('loading');
  state.selectedStation = 4;
  const result = model.loadGood(state, 'G03');
  assert.equal(result.ok, true);
  assert.equal(wagon(state, 'W05').cargo.id, 'G03');
  assert.equal(good(state, 'G03').status, 'loaded');
  const before = snapshot(state);
  assert.equal(model.loadGood(state, 'G03').ok, false);
  assert.equal(snapshot(state), before);
});

test('loading rejects closed stations and teams without an empty wagon atomically', () => {
  const state = model.create('loading');
  state.selectedStation = 11;
  state.goods.push({ id: 'GX', name: 'Проба', origin: 11, destination: 7, team: 'ruby', revenue: 9, fee: 2, status: 'available' });
  state.wagons.push({ id: 'WX', team: 'ruby', station: 11, cargo: null, attachedTo: null });
  const closedBefore = snapshot(state);
  assert.equal(model.loadGood(state, 'GX').ok, false);
  assert.equal(snapshot(state), closedBefore);

  state.selectedStation = 4;
  state.wagons.filter((item) => item.team === 'amber' && item.station === 4).forEach((item) => { item.station = 5; });
  const noWagon = snapshot(state);
  assert.equal(model.loadGood(state, 'G07').ok, false);
  assert.equal(snapshot(state), noWagon);
});

test('finishing Azure releases unused station-4 offers to under-supplied Ruby', () => {
  const state = model.create('loading');
  state.selectedStation = 4;
  assert.equal(model.availableGoods(state, 4, 'ruby').length, 0);
  assert.equal(model.emptyWagons(state, 4, 'ruby').length, 2);
  assert.equal(model.finishSelection(state, 'azure', 4).ok, true);
  const transferred = state.goods.filter((item) => item.origin === 4 && item.team === 'ruby' && item.status === 'available');
  assert.equal(transferred.length, 2);
  assert.equal(state.goods.filter((item) => item.origin === 4 && item.team === 'jade' && item.status === 'available').length, 2);
  assert.equal(state.goods.filter((item) => item.origin === 4 && item.status === 'pool').length, 0);
  assert.equal(model.loadGood(state, transferred[0].id).ok, true);
  assert.equal(model.finishSelection(state, 'azure', 4).ok, false);
  assert.equal(state.wagons.filter((item) => item.team === 'ruby' && item.station === 4 && item.cargo).length, 2);
});

test('potential road appears in cargo preview but is never a movement permission', () => {
  const state = model.create('movement');
  assert.deepEqual(model.route(state, 4, 10, true), [4, 10]);
  assert.deepEqual(model.route(state, 4, 10), []);
  const before = snapshot(state);
  assert.equal(model.move(state, 10).ok, false);
  assert.equal(snapshot(state), before);
});

test('every wagon coupling consumes its own action; empty wagon cannot couple', () => {
  const state = model.create('movement');
  assert.equal(model.attach(state, 'W01').ok, true);
  assert.equal(loco(state, 'L1').actions, 3);
  assert.equal(model.attach(state, 'W04').ok, true);
  assert.equal(loco(state, 'L1').actions, 2);
  assert.deepEqual(loco(state, 'L1').attached, ['W01', 'W04']);
  const before = snapshot(state);
  assert.equal(model.attach(state, 'W02').ok, false);
  assert.equal(snapshot(state), before);
});

test('one edge move delivers once, detaches at destination and rewards both sides', () => {
  const state = model.create('movement');
  assert.equal(model.attach(state, 'W01').ok, true);
  assert.equal(model.attach(state, 'W04').ok, true);
  const result = model.move(state, 7);
  assert.equal(result.ok, true);
  assert.equal(result.delivered, 1);
  assert.equal(loco(state, 'L1').station, 7);
  assert.equal(loco(state, 'L1').actions, 1);
  assert.equal(wagon(state, 'W01').station, 7);
  assert.equal(wagon(state, 'W01').attachedTo, null);
  assert.equal(wagon(state, 'W01').cargo, null);
  assert.equal(good(state, 'G01').status, 'delivered');
  assert.equal(wagon(state, 'W04').attachedTo, 'L1');
  assert.equal(cash(state, 'ruby'), 79); // +2 Azure's wagon fare, +12 delivered cargo.
  assert.equal(cash(state, 'azure'), 56);
  assert.equal(state.delivered, 1);
  assert.equal(model.move(state, 4).ok, true);
  assert.equal(state.delivered, 1);
  assert.equal(cash(state, 'ruby'), 81); // Only the still-attached Azure wagon pays the return fare.
});

test('full destination, closed station and unaffordable fare reject the whole move', () => {
  const full = model.create('movement');
  loco(full, 'L3').station = 7;
  loco(full, 'L4').station = 7;
  const beforeFull = snapshot(full);
  assert.equal(model.move(full, 7).ok, false);
  assert.equal(snapshot(full), beforeFull);

  const closed = model.create('movement');
  loco(closed, 'L1').station = 23;
  const beforeClosed = snapshot(closed);
  assert.equal(model.move(closed, 11).ok, false);
  assert.equal(snapshot(closed), beforeClosed);

  const poor = model.create('movement');
  assert.equal(model.attach(poor, 'W04').ok, true);
  model.team(poor, 'azure').cash = 1;
  const beforePoor = snapshot(poor);
  assert.equal(model.move(poor, 7).ok, false);
  assert.equal(snapshot(poor), beforePoor);
  assert.equal(cash(poor, 'azure'), 1);
});

test('post-turn detach is free and cannot be used before the locomotive finishes', () => {
  const state = model.create('movement');
  assert.equal(model.attach(state, 'W04').ok, true);
  assert.equal(model.detach(state, 'W04').ok, false);
  const actions = loco(state, 'L1').actions;
  assert.equal(model.finishLoco(state).ok, true);
  assert.equal(model.attach(state, 'W01').ok, false);
  assert.equal(model.move(state, 7).ok, false);
  assert.equal(model.detach(state, 'W04').ok, true);
  assert.equal(loco(state, 'L1').actions, actions);
  assert.equal(wagon(state, 'W04').attachedTo, null);
  assert.equal(wagon(state, 'W04').cargo.id, 'G12');
  assert.equal(model.nextLoco(state).ok, true);
  assert.equal(state.currentLoco, 'L2');
});

test('market transactions are phase-, balance-, ownership- and load-guarded', () => {
  const state = model.create('market');
  const beforeLoaded = snapshot(state);
  assert.equal(model.sell(state, 'wagon', 'W01').ok, false);
  assert.equal(snapshot(state), beforeLoaded);
  assert.equal(model.buy(state, 'locomotive').ok, false); // Two locomotives already occupy station 4.
  assert.equal(model.buy(state, 'wagon').ok, true);
  assert.equal(cash(state, 'ruby'), 59);
  const bought = state.wagons.find((item) => item.id === 'W30');
  assert.equal(bought.team, 'ruby');
  assert.equal(model.sell(state, 'wagon', bought.id).ok, true);
  assert.equal(cash(state, 'ruby'), 62);
  state.selectedTeam = 'azure';
  const beforeForeign = snapshot(state);
  assert.equal(model.sell(state, 'wagon', 'W02').ok, false);
  assert.equal(snapshot(state), beforeForeign);
  state.selectedTeam = 'ruby';
  model.team(state, 'ruby').cash = 0;
  const beforePoor = snapshot(state);
  assert.equal(model.buy(state, 'wagon').ok, false);
  assert.equal(snapshot(state), beforePoor);
});

test('project and construction charge separately, honor owner/kind, and close endpoints', () => {
  const state = model.create('construction');
  state.buildFrom = 2; state.buildTo = 8; state.buildKind = 'wagon'; state.selectedTeam = 'ruby';
  const before = cash(state, 'ruby');
  assert.equal(model.project(state, 3).ok, true);
  const road = model.edge(state, 2, 8);
  assert.equal(road.status, 'planned');
  assert.equal(road.owner, 'ruby');
  assert.equal(road.kind, 'wagon');
  assert.equal(cash(state, 'ruby'), before - 3);
  assert.equal(model.closed(state, 2), false);
  assert.equal(model.closed(state, 8), false);
  state.selectedTeam = 'azure';
  const beforeWrong = snapshot(state);
  assert.equal(model.build(state).ok, false);
  assert.equal(snapshot(state), beforeWrong);
  state.selectedTeam = 'ruby'; state.buildKind = 'locomotive';
  assert.equal(model.build(state).ok, false);
  state.buildKind = 'wagon';
  assert.equal(model.build(state).ok, true);
  assert.equal(cash(state, 'ruby'), before - 6);
  assert.equal(road.status, 'building');
  assert.equal(model.closed(state, 2), true);
  assert.equal(model.closed(state, 8), true);
  assert.notDeepEqual(model.route(state, 2, 8), [2, 8]);
});

test('next advances all locomotive turns before construction; results open built roads next round', () => {
  const state = model.create('movement');
  const turnOrder = state.locomotives.map((item) => item.id);
  for (const id of turnOrder) {
    assert.equal(state.currentLoco, id);
    assert.equal(model.next(state).ok, true);
    assert.equal(state.phase, 'movement');
    assert.equal(state.detachWindow, true);
    assert.equal(model.next(state).ok, true);
    if (id !== turnOrder.at(-1)) assert.equal(state.phase, 'movement');
  }
  assert.equal(state.phase, 'construction');
  state.buildFrom = 4; state.buildTo = 10; state.selectedTeam = 'ruby'; state.buildKind = 'wagon';
  assert.equal(model.build(state).ok, true);
  assert.equal(model.closed(state, 4), true);
  assert.equal(model.next(state).ok, true);
  assert.equal(state.phase, 'results');
  assert.equal(model.next(state).ok, true);
  assert.equal(state.phase, 'news');
  assert.equal(state.round, 2);
  assert.equal(model.edge(state, 4, 10).status, 'active');
  assert.equal(model.closed(state, 4), false);
  assert.equal(state.locomotives.every((item) => item.actions === 4), true);
  assert.equal(model.results(state).length, 5);
  assert.equal(model.results(state)[0].points, model.results(state)[0].cash + model.results(state)[0].assetValue);
});
