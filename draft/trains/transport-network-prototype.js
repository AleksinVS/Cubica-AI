/*
 * Интерактивный слой для карты: данные терминалов хранятся отдельно от
 * отрисовки. Поэтому позднее их можно будет заменить ответом игрового сервера,
 * не переписывая SVG, панель управления или обработчики событий.
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_ZOOM = 1.8;
  const MIN_ZOOM = 0.7;
  const SVG_WIDTH = 1878;
  const SVG_HEIGHT = 1345;
  const CARD_WIDTH = 125;
  const CARD_HEIGHT = 88;
  const CALLOUT_DRAG_THRESHOLD = 7;
  const COINS_PER_ROW = 3;
  const COIN_GAP = 74;
  const BAR_COLORS = ['#2d7050', '#c76b38', '#386f9a', '#a65661', '#9b7b22'];
  const OPEN_STATIONS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // Граф повторяет видимые железнодорожные связи исходной карты. Обе стороны
  // перечислены явно, чтобы обход в ширину мог идти в любом направлении.
  const RAIL_GRAPH = { 1:[2,9], 2:[1,3], 3:[2], 4:[7], 5:[6], 6:[5,7,8,9], 7:[4,6], 8:[6], 9:[1,6] };
  // Топология (RAIL_GRAPH) отвечает только на вопрос «куда можно ехать».
  // Геометрия вынесена отдельно: синие маршруты повторяют изгибы рельсов, а
  // не рисуют вводящие в заблуждение прямые линии поверх карты.
  const RAIL_EDGE_PATHS = {
    '1-2':'M 1391 575 L 1326 585 L 1267 602', '1-9':'M 1391 575 L 1375 465 L 1358 252',
    '2-3':'M 1267 602 L 1207 514 L 1070 620', '4-7':'M 1128 425 L 1045 438 L 959 447',
    '5-6':'M 794 387 L 842 342 L 892 300', '6-7':'M 892 300 L 926 372 L 959 447',
    '6-8':'M 892 300 L 1094 300 L 1023 118', '6-9':'M 892 300 L 1094 300 L 1358 252'
  };
  // Fixture-таблица экономического слоя: каждая связь получает от одной до
  // десяти монет. Номинал определяет их размер и цвет в функции drawCoins.
  const COIN_FIXTURE = {
    1:{2:[1],9:[10,5,2,1]}, 2:{1:[2,1],3:[5,5,2]}, 3:{2:[1,2,5,10]},
    4:{7:[2,2,5]}, 5:{6:[1,1,2,5]}, 6:{5:[5,2],7:[10,5,2,1],8:[2,2,5],9:[10,10,5]},
    7:{4:[1,2],6:[5,2,1]}, 8:{6:[10,5,2]}, 9:{1:[1,2,5],6:[10,10,5,5,2,2,1,1,1,1]}
  };
  const REGIONS = ['Центральная Гвинея', 'Центральная Гвинея', 'Центральная Гвинея', 'Северная Гвинея', 'Белая Гвинея', 'Северная Гвинея', 'Белая Гвинея', 'Северная Гвинея', 'Северная Гвинея', 'Северная Гвинея', 'Южная Гвинея Рорштаха', 'Южная Гвинея Рорштаха', 'Нижняя Гвинея', 'Ультраправая Гвинея', 'Ультраправая Гвинея', 'Подбрюшинная Гвинея', 'Нижняя Гвинея', 'Народная Гвинея', 'Народная Гвинея', 'Левая Гвинея', 'Левая Гвинея', 'Южная Гвинея Рорштаха', 'Южная Гвинея Рорштаха'];
  // Координаты заданы в компактном пространстве исходной карты 1878 × 1345.
  const POINTS = [[1391,575],[1267,602],[1070,620],[1128,425],[794,387],[892,300],[959,447],[1023,118],[1358,252],[1234,400],[905,576],[698,569],[1380,693],[1716,741],[1598,575],[1305,875],[1455,970],[1637,860],[1690,1085],[339,863],[375,490],[688,780],[992,731]];
  // Чередуем стороны и высоту карточек, чтобы выноски не скрывали важные железнодорожные линии.
  const OFFSETS = [[38,-102],[0,80],[40,120],[-100,-130],[-166,32],[34,-112],[45,72],[36,60],[-165,-72],[38,-104],[35,80],[-159,65],[42,-112],[-70,100],[40,68],[30,100],[40,72],[-152,-106],[-154,55],[40,-102],[-153,-102],[37,66],[40,110]];

  const terminals = POINTS.map((point, index) => ({
    id: index + 1,
    point,
    offset: OFFSETS[index],
    region: REGIONS[index],
    // Каждая диаграмма использует все уникальные высоты 5..9 в иной перестановке.
    total: [5, 6, 7, 8, 9].map((_, direction) => 5 + ((index * 2 + direction * 3) % 5)),
    filled: [1 + (index % 3), 2 + ((index + 1) % 3), 1 + ((index + 2) % 3), 2 + (index % 2), 1 + ((index + 2) % 3)]
  }));
  terminals.forEach((terminal) => terminal.filled = terminal.filled.map((value, i) => Math.min(value, terminal.total[i])));

  const initialFilled = terminals.map((terminal) => [...terminal.filled]);
  const initialOffsets = terminals.map((terminal) => [...terminal.offset]);
  // sourceId и route разделены: выбор диаграммы — это действие назначения,
  // которое не должно случайно сменить текущую исходную станцию.
  const state = { sourceId: null, route: [], zoom: 1, panX: 0, panY: 0, mapDrag: null, calloutDrag: null };
  const layer = document.getElementById('annotation-layer');
  const stage = document.getElementById('map-stage');
  const viewport = document.getElementById('map-viewport');
  const form = document.getElementById('capacity-form');
  const title = document.getElementById('inspector-title');
  const description = document.getElementById('inspector-description');
  const summary = document.getElementById('terminal-summary');

  function svgElement(name, attributes, text) {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function getCardBox(terminal) {
    return {
      x: terminal.point[0] + terminal.offset[0],
      y: terminal.point[1] + terminal.offset[1],
      width: CARD_WIDTH,
      height: CARD_HEIGHT
    };
  }

  function renderCallouts() {
    // SVG пересоздаётся ради простоты. Сохраняем фокус, чтобы управление с
    // клавиатуры не «прыгало» в начало страницы после каждого изменения.
    const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focusKey : null;
    layer.replaceChildren();
    drawRoute();
    if (state.sourceId) drawCoins(state.sourceId);
    terminals.forEach((terminal) => {
      const [x, y] = terminal.point;
      const [dx, dy] = terminal.offset;
      const { x: cardX, y: cardY, width: cardW, height: cardH } = getCardBox(terminal);
      const anchorX = dx < 0 ? cardX + cardW : cardX;
      const anchorY = cardY + cardH / 2;
      const group = svgElement('g', { class: 'callout' });
      group.dataset.terminalId = terminal.id;
      group.append(svgElement('path', { class: 'callout-line', d: `M ${x} ${y} L ${x + dx * .52} ${y + dy * .52} L ${anchorX} ${anchorY}` }));
      const station = svgElement('g', { class: `station-button${state.sourceId === terminal.id ? ' is-current' : ''}${OPEN_STATIONS.has(terminal.id) ? '' : ' is-locked'}`, tabindex: '0', role: 'button', 'aria-pressed': String(state.sourceId === terminal.id), 'data-focus-key': `station-${terminal.id}`, 'aria-label': OPEN_STATIONS.has(terminal.id) ? `Станция ${String(terminal.id).padStart(2, '0')}, ${terminal.region}. Выбрать исходной станцией.` : `Терминал ${String(terminal.id).padStart(2, '0')}: маршрут ещё не открыт.` });
      station.append(svgElement('circle', { class: 'callout-number', cx: x, cy: y, r: 18 }));
      station.append(svgElement('text', { class: 'callout-number-text', x, y: y + 1 }, String(terminal.id).padStart(2, '0')));
      station.addEventListener('click', () => chooseSource(terminal.id));
      station.addEventListener('keydown', (event) => activateWithKeyboard(event, () => chooseSource(terminal.id)));
      group.append(station);
      const chartLabel = OPEN_STATIONS.has(terminal.id)
        ? `Диаграмма станции ${String(terminal.id).padStart(2, '0')}. Нажмите, чтобы выбрать пункт назначения; перетащите или используйте стрелки, чтобы переместить.`
        : `Диаграмма терминала ${String(terminal.id).padStart(2, '0')}. Маршрут ещё не открыт; перетащите или используйте стрелки, чтобы переместить.`;
      const chart = svgElement('g', { class: 'destination-chart', tabindex: '0', role: 'button', 'data-focus-key': `chart-${terminal.id}`, 'aria-label': chartLabel });
      chart.append(svgElement('rect', { class: 'callout-card', x: cardX, y: cardY, width: cardW, height: cardH, rx: 5 }));
      chart.append(svgElement('text', { class: 'callout-caption', x: cardX + 10, y: cardY + 17 }, `УЗЕЛ ${String(terminal.id).padStart(2, '0')}`));
      drawBars(chart, terminal, cardX + 10, cardY + 78);
      chart.append(svgElement('rect', { class: 'destination-hit', x: cardX, y: cardY, width: cardW, height: cardH }));
      // Короткий pointer-жест выбирает маршрут, а движение больше порога
      // переносит карточку. Это исключает случайный выбор маршрута после drag.
      chart.addEventListener('pointerdown', (event) => beginCalloutDrag(event, terminal.id));
      chart.addEventListener('keydown', (event) => handleChartKeydown(event, terminal.id));
      group.append(chart);
      layer.append(group);
    });
    if (focusKey) {
      const replacement = layer.querySelector(`[data-focus-key="${focusKey}"]`);
      if (replacement) replacement.focus({ preventScroll: true });
    }
  }

  function activateWithKeyboard(event, callback) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callback(); }
  }

  function handleChartKeydown(event, terminalId) {
    if (event.key === 'Enter' || event.key === ' ') {
      activateWithKeyboard(event, () => chooseDestination(terminalId));
      return;
    }
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 40 : 12;
    const terminal = terminals[terminalId - 1];
    terminal.offset = clampCalloutOffset(terminal, [terminal.offset[0] + direction[0] * step, terminal.offset[1] + direction[1] * step]);
    renderCallouts();
  }

  function clientPointToSvg(clientX, clientY) {
    const matrix = layer.getScreenCTM();
    const point = layer.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return matrix ? point.matrixTransform(matrix.inverse()) : point;
  }

  function clampCalloutOffset(terminal, offset) {
    // Для открытых станций оставляем запас под самую большую фикстуру из
    // десяти монет: три строки не должны обрезаться краем SVG-карты.
    const horizontalMargin = OPEN_STATIONS.has(terminal.id) ? 56 : 8;
    const topMargin = 8;
    const bottomReserve = OPEN_STATIONS.has(terminal.id) ? 304 : 8;
    const [pointX, pointY] = terminal.point;
    return [
      Math.max(horizontalMargin - pointX, Math.min(SVG_WIDTH - CARD_WIDTH - horizontalMargin - pointX, offset[0])),
      Math.max(topMargin - pointY, Math.min(SVG_HEIGHT - CARD_HEIGHT - bottomReserve - pointY, offset[1]))
    ];
  }

  function beginCalloutDrag(event, terminalId) {
    if (event.button !== 0 || state.calloutDrag || state.mapDrag) return;
    event.preventDefault();
    event.stopPropagation();
    const terminal = terminals[terminalId - 1];
    const start = clientPointToSvg(event.clientX, event.clientY);
    state.calloutDrag = {
      pointerId: event.pointerId,
      terminalId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startSvgX: start.x,
      startSvgY: start.y,
      startOffset: [...terminal.offset],
      moved: false
    };
    event.currentTarget.focus({ preventScroll: true });
    layer.setPointerCapture(event.pointerId);
  }

  function moveCalloutDrag(event) {
    const drag = state.calloutDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const clientDistance = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY);
    if (!drag.moved && clientDistance < CALLOUT_DRAG_THRESHOLD) return;
    drag.moved = true;
    layer.classList.add('is-dragging-callout');
    const current = clientPointToSvg(event.clientX, event.clientY);
    const terminal = terminals[drag.terminalId - 1];
    terminal.offset = clampCalloutOffset(terminal, [
      drag.startOffset[0] + current.x - drag.startSvgX,
      drag.startOffset[1] + current.y - drag.startSvgY
    ]);
    // Монеты вычисляются от карточки, поэтому этот же рендер двигает их вместе.
    renderCallouts();
  }

  function finishCalloutDrag(event, cancelled) {
    const drag = state.calloutDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    state.calloutDrag = null;
    layer.classList.remove('is-dragging-callout');
    if (layer.hasPointerCapture(event.pointerId)) layer.releasePointerCapture(event.pointerId);
    if (!cancelled && !drag.moved) chooseDestination(drag.terminalId);
  }

  // BFS (обход в ширину) находит путь с наименьшим количеством рёбер в графе.
  function findShortestPath(start, destination) {
    const queue = [[start]];
    const visited = new Set([start]);
    while (queue.length) {
      const path = queue.shift();
      const station = path[path.length - 1];
      if (station === destination) return path;
      (RAIL_GRAPH[station] || []).forEach((next) => { if (!visited.has(next)) { visited.add(next); queue.push([...path, next]); } });
    }
    return [];
  }

  function drawRoute() {
    if (state.route.length < 2) return;
    const routeLayer = svgElement('g', { class: 'route-layer', 'aria-hidden': 'true' });
    for (let i = 0; i < state.route.length - 1; i += 1) {
      const from = state.route[i];
      const to = state.route[i + 1];
      const key = [from, to].sort((a, b) => a - b).join('-');
      routeLayer.append(svgElement('path', { class: 'route-edge-halo', d: RAIL_EDGE_PATHS[key] }));
      routeLayer.append(svgElement('path', { class: 'route-edge', d: RAIL_EDGE_PATHS[key] }));
    }
    state.route.forEach((id) => { const [x, y] = terminals[id - 1].point; routeLayer.append(svgElement('circle', { class: 'route-stop', cx: x, cy: y, r: 24 })); });
    layer.append(routeLayer);
  }

  function drawCoins(sourceId) {
    const coinsLayer = svgElement('g', { class: 'coins-layer', 'aria-label': 'Стоимость переходов к соседним станциям' });
    (RAIL_GRAPH[sourceId] || []).forEach((neighbor) => {
      const terminal = terminals[neighbor - 1];
      const card = getCardBox(terminal);
      const values = COIN_FIXTURE[sourceId][neighbor] || [];
      const coins = svgElement('g', { role: 'img', 'pointer-events': 'none', 'aria-label': `До станции ${String(neighbor).padStart(2, '0')}: ${values.length} ${values.length === 1 ? 'монета' : 'монет'}, номиналы: ${values.join(', ')}.` });
      values.forEach((value, index) => {
        const radius = value === 10 ? 34 : value === 5 ? 31 : value === 2 ? 29 : 27;
        const fill = value === 10 ? '#d6a11e' : value === 5 ? '#b7653e' : value === 2 ? '#76a9b8' : '#d7d0bb';
        const row = Math.floor(index / COINS_PER_ROW);
        const column = index % COINS_PER_ROW;
        const rowCount = Math.min(COINS_PER_ROW, values.length - row * COINS_PER_ROW);
        // Каждая строка центрируется под своей диаграммой. Три крупных
        // монеты в строке остаются различимыми даже при масштабе карты 100%.
        const rowStartX = card.x + card.width / 2 - ((rowCount - 1) * COIN_GAP) / 2;
        const coinX = rowStartX + column * COIN_GAP;
        const coinY = card.y + card.height + 40 + row * COIN_GAP;
        coins.append(svgElement('circle', { class: 'neighbor-coin', cx: coinX, cy: coinY, r: radius, fill }));
        coins.append(svgElement('text', { class: 'coin-label', x: coinX, y: coinY + .5 }, value));
      });
      coinsLayer.append(coins);
    });
    layer.append(coinsLayer);
  }

  // Колонки собраны из отдельных сегментов: это делает и заполнение, и будущую анимацию очевидными.
  function drawBars(group, terminal, startX, bottomY) {
    const width = 16;
    const gap = 6;
    terminal.total.forEach((total, index) => {
      const height = total * 8;
      const x = startX + index * (width + gap);
      group.append(svgElement('rect', { class: 'bar-outline', x, y: bottomY - height, width, height, rx: 1, stroke: BAR_COLORS[index] }));
      for (let segment = 0; segment < total; segment += 1) {
        const y = bottomY - (segment + 1) * 8 + 1;
        group.append(svgElement('rect', { class: segment < terminal.filled[index] ? 'bar-filled' : 'bar-empty', x: x + 2, y, width: width - 4, height: 6, fill: segment < terminal.filled[index] ? BAR_COLORS[index] : undefined }));
      }
    });
  }

  function chooseSource(id) {
    if (!OPEN_STATIONS.has(id)) {
      state.route = [];
      title.textContent = 'Маршрут ещё не открыт';
      description.textContent = `Терминал ${String(id).padStart(2, '0')} пока не включён в транспортный граф. Выберите зелёную станцию 01–09.`;
      renderCallouts();
      return;
    }
    state.sourceId = id;
    state.route = [];
    const terminal = terminals.find((item) => item.id === id);
    title.textContent = `Станция ${String(id).padStart(2, '0')}`;
    description.textContent = 'Выберите диаграмму пункта назначения или настройте заполненность пяти направлений.';
    summary.hidden = false;
    document.getElementById('terminal-number').textContent = String(id).padStart(2, '0');
    document.getElementById('terminal-location').textContent = terminal.region;
    renderInspector(terminal);
    renderCallouts();
  }

  function chooseDestination(id) {
    if (!state.sourceId) {
      title.textContent = 'Сначала выберите станцию';
      description.textContent = 'Нажмите на зелёную шестерёнку станции 01–09, затем выберите диаграмму пункта назначения.';
      return;
    }
    if (!OPEN_STATIONS.has(id)) {
      state.route = [];
      title.textContent = 'Маршрут ещё не открыт';
      description.textContent = `Маршрут ${String(state.sourceId).padStart(2, '0')} → ${String(id).padStart(2, '0')} ещё не открыт.`;
      renderCallouts();
      return;
    }
    state.route = findShortestPath(state.sourceId, id);
    title.textContent = `Маршрут ${String(state.sourceId).padStart(2, '0')} → ${String(id).padStart(2, '0')}`;
    description.textContent = state.route.length < 2 ? 'Это текущая станция: путь не требуется.' : `Кратчайший путь: ${state.route.map((station) => String(station).padStart(2, '0')).join(' — ')}.`;
    renderCallouts();
  }

  function renderInspector(terminal) {
    form.replaceChildren();
    terminal.total.forEach((total, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'capacity-control';
      wrapper.style.setProperty('--bar-color', BAR_COLORS[index]);
      const inputId = `terminal-${terminal.id}-direction-${index}`;
      const label = document.createElement('label');
      label.htmlFor = inputId;
      label.textContent = `Направление ${index + 1}`;
      const output = document.createElement('output');
      output.textContent = `${terminal.filled[index]} / ${total}`;
      const input = document.createElement('input');
      input.id = inputId; input.type = 'range'; input.min = '0'; input.max = String(total); input.value = String(terminal.filled[index]);
      input.setAttribute('aria-label', `Заполненность направления ${index + 1} из ${total} сегментов`);
      input.addEventListener('input', () => { terminal.filled[index] = Number(input.value); output.textContent = `${input.value} / ${total}`; renderCallouts(); });
      wrapper.append(label, output, input); form.append(wrapper);
    });
  }

  function applyTransform() {
    const scaledWidth = stage.offsetWidth * state.zoom;
    const scaledHeight = stage.offsetHeight * state.zoom;
    if (scaledWidth > 0 && scaledHeight > 0) {
      // Карта может двигаться, но не может полностью исчезнуть из окна.
      const minPanX = Math.min(0, viewport.clientWidth - scaledWidth);
      const maxPanX = Math.max(0, viewport.clientWidth - scaledWidth);
      const minPanY = Math.min(0, viewport.clientHeight - scaledHeight);
      const maxPanY = Math.max(0, viewport.clientHeight - scaledHeight);
      state.panX = Math.max(minPanX, Math.min(maxPanX, state.panX));
      state.panY = Math.max(minPanY, Math.min(maxPanY, state.panY));
    }
    stage.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    document.getElementById('zoom-value').textContent = `${Math.round(state.zoom * 100)}%`;
  }
  function changeZoom(delta) { state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom + delta)); applyTransform(); }

  function beginMapDrag(event) {
    if (event.button !== 0 || state.mapDrag || state.calloutDrag || event.target.closest('.callout')) return;
    state.mapDrag = { pointerId: event.pointerId, startX: event.clientX - state.panX, startY: event.clientY - state.panY };
    viewport.setPointerCapture(event.pointerId);
  }

  function moveMapDrag(event) {
    const drag = state.mapDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state.panX = event.clientX - drag.startX;
    state.panY = event.clientY - drag.startY;
    applyTransform();
  }

  function finishMapDrag(event) {
    const drag = state.mapDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state.mapDrag = null;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  }

  document.getElementById('zoom-in').addEventListener('click', () => changeZoom(.1));
  document.getElementById('zoom-out').addEventListener('click', () => changeZoom(-.1));
  document.getElementById('callouts-toggle').addEventListener('change', (event) => layer.classList.toggle('callouts-hidden', !event.target.checked));
  document.getElementById('reset-button').addEventListener('click', () => {
    terminals.forEach((terminal, terminalIndex) => {
      terminal.filled = [...initialFilled[terminalIndex]];
      terminal.offset = [...initialOffsets[terminalIndex]];
    });
    state.sourceId = null; state.route = []; state.zoom = 1; state.panX = 0; state.panY = 0; state.mapDrag = null; state.calloutDrag = null;
    const calloutsToggle = document.getElementById('callouts-toggle');
    calloutsToggle.checked = true;
    layer.classList.remove('callouts-hidden');
    title.textContent = 'Выберите узел'; description.textContent = 'Нажмите на шестерёнку или инженерную выноску на карте.'; summary.hidden = true; form.replaceChildren(); renderCallouts(); applyTransform();
  });
  viewport.addEventListener('wheel', (event) => { event.preventDefault(); changeZoom(event.deltaY < 0 ? .1 : -.1); }, { passive: false });
  layer.addEventListener('pointermove', moveCalloutDrag);
  layer.addEventListener('pointerup', (event) => finishCalloutDrag(event, false));
  layer.addEventListener('pointercancel', (event) => finishCalloutDrag(event, true));
  layer.addEventListener('lostpointercapture', (event) => {
    if (state.calloutDrag && state.calloutDrag.pointerId === event.pointerId) {
      state.calloutDrag = null;
      layer.classList.remove('is-dragging-callout');
    }
  });
  viewport.addEventListener('pointerdown', beginMapDrag);
  viewport.addEventListener('pointermove', moveMapDrag);
  viewport.addEventListener('pointerup', finishMapDrag);
  viewport.addEventListener('pointercancel', finishMapDrag);
  viewport.addEventListener('lostpointercapture', (event) => { if (state.mapDrag && state.mapDrag.pointerId === event.pointerId) state.mapDrag = null; });
  viewport.addEventListener('keydown', (event) => {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(.1); }
    if (event.key === '-') { event.preventDefault(); changeZoom(-.1); }
    const mapDirections = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (event.target === viewport && mapDirections[event.key]) {
      event.preventDefault();
      const step = event.shiftKey ? 100 : 35;
      state.panX += mapDirections[event.key][0] * step;
      state.panY += mapDirections[event.key][1] * step;
      applyTransform();
    }
    // Escape сначала отменяет только маршрут, а следующим нажатием — источник.
    if (event.key === 'Escape' && state.route.length) { event.preventDefault(); state.route = []; title.textContent = `Станция ${String(state.sourceId).padStart(2, '0')}`; description.textContent = 'Маршрут очищен. Выберите диаграмму пункта назначения.'; renderCallouts(); }
    else if (event.key === 'Escape' && state.sourceId) { event.preventDefault(); state.sourceId = null; title.textContent = 'Выберите узел'; description.textContent = 'Нажмите на зелёную шестерёнку станции 01–09.'; summary.hidden = true; form.replaceChildren(); renderCallouts(); }
  });

  document.querySelector('.map-image').addEventListener('load', applyTransform);
  // Пересчитываем допустимый pan после смены размера окна или CSS-breakpoint,
  // иначе карта могла бы остаться за пределами уже уменьшившегося viewport.
  window.addEventListener('resize', applyTransform);

  renderCallouts();
  applyTransform();
}());
