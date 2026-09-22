/*
 * Представление автономного игрового стола CMT. Карта остаётся фоном; SVG хранит
 * выноски и маршруты в координатах исходника. Отдельная модель управляет правилами,
 * а это представление синхронно обновляет карту, команды и состав станции.
 */
(function () {
  'use strict';
  const M = window.CMTModel, $ = (id) => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg', TRAIN_ORBIT_DURATION = 3600, TRAIN_ORBIT_RADIUS = 34;
  const trainAnimationEpoch = performance.now();
  const layer = $('annotation-layer'), stage = $('map-stage'), viewport = $('map-viewport');
  const CARD_W = 154, CARD_H = 108;
  // Прямой вход в тестовый этап не занимает место в игровом интерфейсе.
  const requestedPhase = new URLSearchParams(location.search).get('phase');
  let state = M.create(M.PHASES.includes(requestedPhase) ? requestedPhase : 'news'), hoverStation = null, routePreview = null, pinnedRoute = null, drag = null, toastTimer, buildAreas = 2;
  const camera = { zoom: 1.3, x: 0, y: 0 }, chartOffsets = {};
  let sidebarCollapsed = matchMedia('(max-width:519px)').matches;
  // Места выносок учитывают не только карточку, но и монеты под ней.
  // Координаты не меняют положение станций или геометрию железных дорог.
  const LAYOUT = {1:[1450,470],2:[1230,655],3:[1030,660],4:[1060,285],5:[600,325],6:[750,155],7:[1010,470],8:[990,140],9:[1410,170],10:[1270,365],11:[750,590],12:[510,440],13:[1410,760],14:[1680,840],15:[1600,450],16:[1180,915],17:[1390,1050],18:[1530,735],19:[1560,1135],20:[260,925],21:[260,340],22:[535,775],23:[970,790]};
  const PHASE_INFO = [
    ['Новость раунда', 'Прочитайте новость, затем переходите к торговле.'],
    ['Техника', 'Выберите команду и станцию. Покупка и продажа — в составе внизу.'],
    ['Загрузка', 'Выберите станцию. Нажмите монету у назначения, чтобы загрузить вагон её команды.'],
    ['Движение', 'Нажмите вагон у назначения, чтобы прицепить его. Нажмите соседнюю станцию, чтобы ехать.'],
    ['Дороги', 'Выберите команду, тип строителя и две станции на карте.'],
    ['Итоги раунда', 'Дальше — новый раунд. Построенные дороги откроются, действия восстановятся.']
  ];
  const station = (id) => state.stations.find((s) => s.id === id);
  const num = (id) => String(id).padStart(2, '0');
  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const button = (action, label, extra = '', cls = 'small-button') => '<button class="' + cls + '" data-action="' + action + '" ' + extra + '>' + label + '</button>';
  function svgElement(name, attributes = {}, text) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([k, v]) => { if (v !== undefined) element.setAttribute(k, String(v)); });
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function notice(result) {
    if (!result) return;
    $('toast').textContent = result.message; $('toast').className = 'toast' + (result.ok ? '' : ' error'); $('toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4800);
  }
  /** Сохраняет клавиатурный фокус при перерисовке, чтобы карта оставалась доступной. */
  function render() {
    const active=document.activeElement, key=active?.dataset?.focusKey;
    const action=active?.dataset?.action, id=active?.dataset?.id, kind=active?.dataset?.kind;
    const sidebarSource=active?.closest('#sidebar-compact,#sidebar-expanded')?.id;
    renderShell(); renderContext(); renderCompactSidebar(); renderDock(); renderMap();
    let replacement=key?document.querySelector('[data-focus-key="' + key + '"]'):null;
    if(!replacement && action) {
      const scope=sidebarSource?$(sidebarSource):document;
      replacement=[...scope.querySelectorAll('[data-action]')].find((node)=>node.dataset.action===action&&node.dataset.id===id&&node.dataset.kind===kind&&!node.disabled&&node.getClientRects().length);
      // Завершённая команда становится статусом, а не действием. Продолжаем
      // клавиатурный обход в той же полоске, не прыгая на дубликат галочки в SVG.
      if(!replacement&&sidebarSource==='sidebar-compact'&&action==='finish-selection') {
        replacement=scope.querySelector('[data-action="finish-selection"]:not(:disabled)')||$('next-phase');
      }
      if(!replacement&&sidebarSource)replacement=$('sidebar-toggle');
    }
    // После исчезновения купленной карточки/проданной техники возвращаемся
    // к станции, а не в начало документа. Следующий Tab продолжает сценарий.
    if(!replacement && (key||action))replacement=layer.querySelector('[data-station="'+state.selectedStation+'"]');
    replacement?.focus({preventScroll:true});
  }
  /** Постоянно виден лишь текущий шаг; сводки появляются там, где нужны для решения. */
  function renderShell() {
    const shell=document.querySelector('.application-shell');
    if(shell.dataset.phase!==state.phase) {
      $('sidebar-scroll').scrollTop=0;
    }
    shell.dataset.phase=state.phase;
    // На итогах карта остаётся фоном; Tab не должен уходить в её станции.
    viewport.inert=state.phase==='results';
    syncSidebar();
    const index=M.PHASES.indexOf(state.phase),info=PHASE_INFO[index];
    const moving=state.phase==='movement', hasNext=state.locomotives.some((l)=>!state.finishedLocos.includes(l.id));
    const hint=moving&&state.detachWindow?'Ход завершён. Теперь вагоны можно бесплатно отцепить значком ↶ в составе.':info[1];
    $('phase-inspector').innerHTML='<p class="phase-kicker">Раунд '+num(state.round)+' · '+(index+1)+' / 6</p><h1>'+info[0]+'</h1><p class="phase-copy">'+hint+'</p>';
    // Одна главная кнопка последовательно закрывает ход, окно отцепления и этап.
    const nextLabel=moving ? (state.detachWindow?(hasNext?'Следующий поезд':'Дальше'):'Завершить ход') : 'Дальше';
    $('next-phase').innerHTML='<span class="next-label">'+nextLabel+'</span><span class="next-icon" aria-hidden="true">'+(moving&&!state.detachWindow?'✓':'→')+'</span>';
    $('next-phase').setAttribute('aria-label',nextLabel);
    $('next-phase').title=nextLabel;
    const showTeams=['market','construction'].includes(state.phase);
    $('teams-section').hidden=!showTeams;
    if(showTeams) {
      const market=state.phase==='market';
      $('team-table').innerHTML=(market?'<div class="team-head"><span>Команда</span><span title="Вагоны">В</span><span title="Локомотивы">Л</span><span title="Оборудование">О</span><span title="Монеты">◉</span></div>':'')+state.teams.map((t)=>'<button class="team-row'+(market?'':' compact')+(t.id===state.selectedTeam?' selected':'')+'" data-action="team" data-id="'+t.id+'" aria-pressed="'+(t.id===state.selectedTeam)+'" aria-label="Команда '+t.name+', '+t.cash+' монет"><span class="team-name"><i class="team-dot" style="--team:'+t.color+'"></i>'+t.name+'</span>'+(market?'<span class="team-count">'+state.wagons.filter((w)=>w.team===t.id).length+'</span><span class="team-count">'+state.locomotives.filter((l)=>l.team===t.id).length+'</span><span class="team-count">'+t.equipment+'</span>':'')+'<strong>'+t.cash+(market?'':' ◉')+'</strong></button>').join('');
    } else $('team-table').replaceChildren();
    $('map-legend').hidden=state.phase!=='construction';
    $('results-panel').hidden=state.phase!=='results';
    if(state.phase==='results') {
      $('results-panel').innerHTML='<h2 id="results-title">Имущество и деньги</h2><table class="result-table"><thead><tr><th>Команда</th><th title="Вагоны">Ваг.</th><th title="Локомотивы">Локо.</th><th title="Оборудование">Обор.</th><th>Монеты</th><th>Баллы</th></tr></thead><tbody>'+M.results(state).map((t)=>'<tr><td><span class="team-name"><i class="team-dot" style="--team:'+t.color+'"></i>'+t.name+'</span></td><td>'+t.wagons+'</td><td>'+t.locomotives+'</td><td>'+t.equipment+'</td><td>'+t.cash+'</td><td><strong>'+t.points+'</strong></td></tr>').join('')+'</tbody></table><p class="result-note">Баллы = монеты + стоимость техники.</p>';
    }
  }
  /** Контекст этапа заменяет предыдущий, а не накапливает панели и подсказки. */
  function renderContext() {
    const s=station(state.selectedStation),t=M.team(state,state.selectedTeam);
    let html='';
    if(state.phase==='news') {
      const n=state.news[(state.round-1)%state.news.length];
      html='<article class="context-card"><h2>'+esc(n.title)+'</h2><div class="news-body">'+esc(n.body)+'</div><div class="news-impact">'+esc(n.impact)+'</div></article>';
    } else if(state.phase==='market') {
      html='<div class="context-card"><h2>Оборудование · '+t.equipment+'</h2>'+button('buy','+ Купить · 8 ◉','data-kind="equipment"'+(t.cash<8?' disabled':''))+button('sell','− Продать · 4 ◉','data-kind="equipment"'+(!t.equipment?' disabled':''),'quiet-button')+'<p>Техника продаётся за половину цены. Сначала освободите её от груза и сцепки.</p></div>';
    } else if(state.phase==='loading') {
      html='<div class="context-card"><h2>Станция '+num(s.id)+(M.closed(state,s.id)?' · закрыта':'')+'</h2><p class="loading-label">Вагонов с грузом / всего</p>'+state.teams.map((a)=>{
        const stock=state.wagons.filter((w)=>w.station===s.id&&w.team===a.id),done=state.done[M.selectionKey(s.id,a.id)];
        return '<div class="loading-row"><span class="team-name"><i class="team-dot" style="--team:'+a.color+'"></i>'+a.name+'</span><span><strong>'+stock.filter((w)=>w.cargo).length+' / '+stock.length+'</strong>'+(done?'<small>✓ Выбор завершён</small>':'')+'</span></div>';
      }).join('')+'<p>✓ над столбцом завершает выбор команды и передаёт остаток товаров командам с пустыми вагонами.</p><p>Цветной сегмент — с грузом, серый — пустой. Наведение на монету покажет маршрут.</p></div>';
    } else if(state.phase==='movement') {
      const l=M.current(state);
      html=l?'<div class="context-card"><h2><span class="team-name"><i class="team-dot" style="--team:'+M.team(state,l.team).color+'"></i>'+M.team(state,l.team).name+' · '+esc(l.name)+'</span></h2><p>Станция '+num(l.station)+' · '+l.attached.length+' ваг. в составе</p>'+(!state.detachWindow?'<div class="action-count">'+l.actions+' <span>действия осталось</span></div><p>Прицепление — 1 действие.<br>Перегон — 1 действие, 2 ◉ за вагон от его владельца.</p>':'<p>«'+(state.locomotives.some((a)=>!state.finishedLocos.includes(a.id))?'Следующий поезд':'Дальше')+'» закроет окно отцепления.</p>')+'</div>':'<p>Локомотивов нет. Переходите дальше.</p>';
    } else if(state.phase==='construction') {
      const r=M.edge(state,state.buildFrom,state.buildTo);
      html='<div class="context-card"><div class="segmented-control">'+['wagon','locomotive'].map((kind)=>button('build-kind',kind==='wagon'?'Вагоны':'Локомотивы','data-id="'+kind+'" aria-pressed="'+(kind===state.buildKind)+'"',kind===state.buildKind?'active':'')).join('')+'</div><div class="road-summary">'+(state.buildFrom?num(state.buildFrom):'—')+'<span>→</span>'+(state.buildTo?num(state.buildTo):'—')+'</div>';
      if(state.buildTo) {
        html+='<p>'+(r?r.areas+' обл. · '+({active:'дорога действует',planned:'проект готов',building:'строится',potential:'можно проектировать'}[r.status]):'Новая дорога')+'</p>';
        if(!r) html+='<label class="context-stat">Областей <input id="build-areas" type="number" min="1" max="12" value="'+buildAreas+'" style="width:52px"></label>';
        if(!r||r.status==='potential') html+=button('project','Спроектировать · '+(r?.areas||buildAreas)+' ◉');
        if(r?.status==='planned') html+=button('build','Построить · '+r.areas+' ◉');
      }
      if(state.buildFrom)html+=button('clear-build','Сбросить выбор','','quiet-button');
      html+='<p>По 1 ◉ за область за каждый этап. Проект можно оставить. Стройка закроет обе станции до нового раунда.</p></div><div class="road-log">'+state.roads.filter((road)=>['planned','building'].includes(road.status)).map((road)=>button('road',num(road.from)+'—'+num(road.to)+' · '+(road.status==='planned'?'проект':'строится')+' · '+(road.kind==='wagon'?'вагоны':'локомотивы'),'data-id="'+road.id+'"')).join('')+'</div>';
    } else if(state.phase==='results') {
      html='<div class="context-card"><div class="context-stat"><span>Доставлено грузов</span><strong>'+state.delivered+'</strong></div></div>';
    }
    $('context-panel').innerHTML=html;
  }
  /** Иконки отрисованы локально: одинаковый контур и никакой зависимости от шрифтов/сети. */
  function uiIcon(name) {
    const paths={
      round:'<path d="M4 8a8 8 0 1 1-1 7M4 3v5h5"/>',
      news:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h3m3 0h2M8 18h8"/>',
      market:'<path d="M3 8h18l-2-5H5zM5 8v12h14V8M9 20v-7h6v7"/>',
      loading:'<path d="M4 12v8h16v-8M12 3v12m-4-4 4 4 4-4"/>',
      movement:'<rect x="5" y="3" width="14" height="15" rx="4"/><path d="M5 10h14M8 7h8M8 21l2-3m6 3-2-3"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>',
      construction:'<path d="m4 20 10-10m-4-5 5-3 7 7-4 4-8-8ZM3 17l4 4"/>',
      project:'<path d="m4 15 11-11 5 5L9 20l-6 1zM13 6l5 5"/>',
      results:'<path d="M8 21V10h8v11M2 21V15h6m8 0h6v6M10 5l2-3 2 3"/>',
      cash:'<circle cx="12" cy="12" r="9"/><path d="M9 8h6M9 12h6m-6 4h6"/>',
      equipment:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
      station:'<path d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 1 1 14 0Z"/><circle cx="12" cy="9" r="2"/>',
      actions:'<path d="m13 2-8 12h6l-1 8 9-13h-7z"/>',
      wagon:'<rect x="3" y="5" width="18" height="12" rx="1"/><path d="M1 17h22M7 17v3m10-3v3"/>',
      detach:'<path d="M9 7H6a4 4 0 0 0 0 8h3m6-8h3a4 4 0 0 1 0 8h-3M13 3l-2 18"/>',
      areas:'<path d="M3 3h18v18H3zM3 12h18M12 3v18"/>',
      expand:'<path d="m14 5-7 7 7 7"/>'
    };
    return '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.equipment)+'</svg>';
  }
  /** Цвет кодирует команду, форма — тип техники: круг/локомотив, квадрат/вагон. */
  function teamShape(t,kind) {return '<i class="team-shape '+kind+'" style="--team:'+t.color+'" aria-hidden="true"></i>';}
  function compactMetric(icon,value,label) {return '<span class="compact-metric" title="'+esc(label)+'" aria-label="'+esc(label)+'" tabindex="0">'+uiIcon(icon)+'<strong>'+value+'</strong></span>';}
  function compactAction(action,icon,value,label,extra='') {return button(action,uiIcon(icon)+'<span>'+value+'</span>','title="'+esc(label)+'" aria-label="'+esc(label)+'" '+extra,'compact-action');}
  /** Компактный режим читает ту же модель и вызывает те же действия, не создавая
      вторую игровую логику. Подсказки сохраняют смысл элементов без подписей. */
  function renderCompactSidebar() {
    const phase=state.phase,index=M.PHASES.indexOf(phase),s=station(state.selectedStation),t=M.team(state,state.selectedTeam);
    let html='<div class="compact-section compact-phase">'+compactMetric('round',num(state.round),'Раунд '+state.round)+
      compactAction('expand-sidebar',phase,(index+1)+'/6',PHASE_INFO[index][0]+'. Развернуть подробности')+'</div>';
    if(phase==='news') {
      const news=state.news[(state.round-1)%state.news.length];
      html+='<div class="compact-section">'+compactAction('expand-sidebar','news','',news.title+'. Читать новость')+'</div>';
    }
    if(['market','construction'].includes(phase)) {
      html+='<div class="compact-teams">'+state.teams.map((a)=>{
        const locos=state.locomotives.filter((l)=>l.team===a.id).length,wagons=state.wagons.filter((w)=>w.team===a.id).length;
        const label=a.name+': '+locos+' локомотивов, '+wagons+' вагонов, '+a.equipment+' оборудования, '+a.cash+' монет';
        return '<button class="compact-team'+(a.id===state.selectedTeam?' selected':'')+'" data-action="team" data-id="'+a.id+'" aria-pressed="'+(a.id===state.selectedTeam)+'" title="'+label+'" aria-label="'+label+'"><span class="compact-team-top"><b>'+esc(a.name.slice(0,3))+'</b><span>'+uiIcon('cash')+a.cash+'</span></span>'+
          '<span class="compact-fleet"><span>'+teamShape(a,'locomotive')+locos+'</span><span>'+teamShape(a,'wagon')+wagons+'</span>'+(phase==='market'?'<span>'+uiIcon('equipment')+a.equipment+'</span>':'')+'</span></button>';
      }).join('')+'</div>';
    }
    if(phase==='market') {
      html+='<div class="compact-section">'+compactMetric('equipment',t.equipment,t.name+': оборудование')+
        compactAction('buy','equipment','+8','Купить оборудование за 8 монет','data-kind="equipment"'+(t.cash<8?' disabled':''))+
        compactAction('sell','equipment','−4','Продать оборудование за 4 монеты','data-kind="equipment"'+(!t.equipment?' disabled':''))+'</div>';
    } else if(phase==='loading') {
      html+='<div class="compact-section">'+compactMetric('station',num(s.id),'Станция '+num(s.id)+(M.closed(state,s.id)?', закрыта':''))+'</div><div class="compact-teams">';
      html+=state.teams.map((a)=>{
        const stock=state.wagons.filter((w)=>w.station===s.id&&w.team===a.id),filled=stock.filter((w)=>w.cargo).length,done=state.done[M.selectionKey(s.id,a.id)];
        const label=a.name+': '+filled+' загружено из '+stock.length+(done?', выбор завершён':', завершить выбор');
        return '<div class="compact-load-row"><span title="'+esc(a.name)+'">'+teamShape(a,'wagon')+'<b>'+esc(a.name.slice(0,3))+'</b></span><button data-action="finish-selection" data-id="'+a.id+'" title="'+label+'" aria-label="'+label+'"'+(done||M.closed(state,s.id)?' disabled':'')+'><strong>'+filled+'/'+stock.length+'</strong><span class="'+(done?'is-done':'')+'" aria-hidden="true">✓</span></button></div>';
      }).join('')+'</div>';
    } else if(phase==='movement') {
      const loco=M.current(state);
      if(loco) {
        const owner=M.team(state,loco.team);
        html+='<div class="compact-section"><div class="compact-owner" title="'+owner.name+' · '+esc(loco.name)+'">'+teamShape(owner,'locomotive')+'<b>'+esc(owner.name.slice(0,3))+'</b></div>'+
          compactMetric('station',num(loco.station),'Текущая станция')+compactMetric('wagon',loco.attached.length,'Вагонов в составе')+
          compactMetric(state.detachWindow?'detach':'actions',state.detachWindow?'✓':loco.actions,state.detachWindow?'Окно бесплатного отцепления':'Осталось действий')+'</div>';
      }
    } else if(phase==='construction') {
      const road=M.edge(state,state.buildFrom,state.buildTo),price=road?.areas||buildAreas;
      html+='<div class="compact-section compact-build"><div class="compact-builder">'+['wagon','locomotive'].map((kind)=>button('build-kind',teamShape(t,kind),'data-id="'+kind+'" title="'+(kind==='wagon'?'Строят вагоны':'Строят локомотивы')+'" aria-label="'+(kind==='wagon'?'Строят вагоны':'Строят локомотивы')+'" aria-pressed="'+(state.buildKind===kind)+'"','compact-action'+(state.buildKind===kind?' active':''))).join('')+'</div>'+
        '<div class="compact-pair" title="Выбранные станции">'+(state.buildFrom?num(state.buildFrom):'—')+' → '+(state.buildTo?num(state.buildTo):'—')+'</div>';
      if(state.buildTo) {
        if(!road)html+='<label class="compact-metric" title="Количество областей">'+uiIcon('areas')+'<input id="build-areas-compact" aria-label="Количество областей" type="number" min="1" max="12" value="'+buildAreas+'"></label>';
        else html+=compactMetric('areas',road.areas,'Количество областей');
        if(!road||road.status==='potential')html+=compactAction('project','project',price,'Спроектировать за '+price+' монет');
        if(road?.status==='planned')html+=compactAction('build','construction',price,'Построить за '+price+' монет');
      }
      if(state.buildFrom)html+=compactAction('clear-build','round','','Сбросить выбранную пару');
      html+='</div>';
      html+='<div class="compact-section">'+state.roads.filter((r)=>['planned','building'].includes(r.status)).map((r)=>compactAction('road',r.status==='planned'?'project':'construction',num(r.from)+'–'+num(r.to),(r.status==='planned'?'Проект':'Строится')+' '+r.from+'–'+r.to,'data-id="'+r.id+'"')).join('')+'</div>';
    } else if(phase==='results') html+='<div class="compact-section">'+compactMetric('loading',state.delivered,'Доставлено грузов')+'</div>';
    $('sidebar-compact').innerHTML=html;
  }

  function assetIcon(loco, color) {
    return '<svg class="asset-icon" style="--team:' + color + '" viewBox="0 0 32 22" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6">' + (loco ? '<path d="M3 15V5h8v10M11 8h13v7H3M20 8V2h4v6M1 4h12M24 15h5l-3-4"/><path d="M6 8h3v3H6z"/>' : '<rect x="3" y="3" width="24" height="12" rx="2"/><path d="M10 4v10m9-10v10M0 15h30"/>') + '<circle cx="8" cy="18" r="2.5"/><circle cx="23" cy="18" r="2.5"/></g></svg>';
  }
  function renderDock() {
    $('station-dock').hidden=!['market','movement'].includes(state.phase);
    if($('station-dock').hidden)return;
    const id = hoverStation || state.selectedStation, s = station(id), preview = !!hoverStation && hoverStation !== state.selectedStation;
    const locos = state.locomotives.filter((l) => l.station === id), wagons = state.wagons.filter((w) => w.station === id), closed = M.closed(state,id);
    $('dock-heading').innerHTML='<div class="dock-top"><div class="dock-title-group"><h2 id="dock-title">Станция '+num(id)+'</h2><small>'+(closed?'Закрыта':preview?'Предпросмотр':'')+'</small></div>'+
      (state.phase==='market'&&!preview?'<div class="dock-actions">'+button('buy','+ Вагон · 6 ◉','data-kind="wagon"'+(closed||M.team(state,state.selectedTeam).cash<6?' disabled':''))+button('buy','+ Локомотив · 12 ◉','data-kind="locomotive"'+(closed||locos.length>=2||M.team(state,state.selectedTeam).cash<12?' disabled':''))+'</div>':'')+'</div>';
    $('station-stock').innerHTML = [...locos.map((l) => ({ ...l, loco:true })), ...wagons].map((a) => {
      const t = M.team(state,a.team), cargo = a.cargo;
      let action = '';
      if (!preview && state.phase === 'market' && a.team === state.selectedTeam) action = button('sell','−','data-id="' + a.id + '" data-kind="' + (a.loco ? 'locomotive' : 'wagon') + '" aria-label="Продать ' + a.id + '" title="Продать ' + a.id + '"' + (cargo || a.attachedTo || a.attached?.length || closed ? ' disabled' : ''),'asset-action sell');
      if (!preview && state.phase === 'movement' && !a.loco) {
        if (a.attachedTo && state.detachWindow) action = button('detach','↶','data-id="' + a.id + '" title="Отцепить ' + a.id + ' бесплатно после хода" aria-label="Отцепить ' + a.id + '"' + (!state.detachWindow ? ' disabled' : ''),'asset-action');
        else if (cargo && !a.attachedTo && !state.detachWindow && M.current(state)?.station === id) action = button('attach','+','data-id="' + a.id + '" title="Прицепить ' + a.id + ': 1 действие" aria-label="Прицепить ' + a.id + '"' + (state.detachWindow || M.current(state)?.station !== id ? ' disabled' : ''),'asset-action');
      }
      const attached = a.loco ? state.wagons.filter((w) => w.attachedTo === a.id) : [];
      const revenue = a.loco ? attached.reduce((sum,w) => sum + (w.cargo?.revenue || 0),0) : cargo?.revenue || 0;
      const destination = a.loco ? (attached[0]?.cargo?.destination || null) : cargo?.destination;
      return '<article class="asset-card' + (a.loco && a.id === state.currentLoco ? ' is-current' : '') + '" style="--team:'+t.color+'">' + assetIcon(a.loco,t.color) + '<header><strong>' + (a.loco ? esc(a.name) : 'Вагон ' + a.id) + '</strong><small>' + (a.loco ? a.id : t.short) + '</small>'+action+'</header><div class="cargo-name">' + (a.loco ? t.name + ' · ' + attached.length + ' ваг. · ' + a.actions + ' д.' : cargo ? esc(cargo.name) + (a.attachedTo ? ' · сцеплен' : ' · свободен') : 'Пустой · ' + t.name) + '</div><div class="asset-stats"><div><strong>' + revenue + '</strong><span>выручка</span></div><div><strong>' + (destination ? num(destination) : '—') + '</strong><span>станция</span></div><div><strong>' + (a.loco ? (attached.length ? attached.length * 2 : 0) : cargo ? 2 : 0) + '</strong><span>ставка</span></div></div>' + '</article>';
    }).join('') || '<p class="empty-stock">На станции пока нет техники.' + (state.phase === 'market' ? ' Купите первую единицу кнопкой «+».' : '') + '</p>';
  }

  /** Диаграммы показывают реальные вагоны: высота = количество, цвет = груз. */
  function baseOffset(s) { return LAYOUT[s.id] ? [LAYOUT[s.id][0]-s.point[0],LAYOUT[s.id][1]-s.point[1]] : s.offset; }
  function cardBox(s) { const offset = chartOffsets[s.id] || baseOffset(s); return { x:s.point[0] + offset[0], y:s.point[1] + offset[1] }; }
  /** У пустой станции нет диаграммы. Исключение — выбранная станция с товарами:
      команды без вагонов тоже должны иметь возможность передать остаток. */
  function hasChart(s) { return state.phase==='loading' && (state.wagons.some((w)=>w.station===s.id) || (s.id===state.selectedStation && state.goods.some((g)=>g.origin===s.id && ['available','pool'].includes(g.status)))); }
  /** Предложение следует за диаграммой, а без неё располагается под станцией. */
  function offerBox(s) { return hasChart(s)?cardBox(s):{x:s.point[0]-CARD_W/2,y:s.point[1]-CARD_H+48}; }
  function drawChart(s, parent) {
    if(!hasChart(s))return;
    const box = cardBox(s), selected = s.id === state.selectedStation;
    const wrap = svgElement('g',{class:'chart-wrap','data-chart-wrap':s.id});
    const group = svgElement('g',{class:'destination-chart' + (selected?' selected':''),role:'button',tabindex:0,'data-chart':s.id,'data-focus-key':'chart-'+s.id,'aria-label':'Диаграмма станции '+num(s.id)+'. Нажмите для маршрута, перетащите или используйте стрелки.'});
    const anchorX = box.x < s.point[0] ? box.x + CARD_W : box.x;
    wrap.append(svgElement('path',{class:'callout-line',d:'M '+s.point.join(' ')+' L '+anchorX+' '+(box.y+CARD_H-23)+' H '+(box.x+CARD_W)}));
    group.append(svgElement('rect',{class:'chart-bg',x:box.x,y:box.y,width:CARD_W,height:CARD_H,rx:7}));
    group.append(svgElement('text',{class:'chart-number',x:box.x+9,y:box.y+69},num(s.id)));
    group.append(svgElement('text',{class:'chart-drag-hint',x:box.x+CARD_W-9,y:box.y+18},'⠿'));
    state.teams.forEach((t,i) => {
      const stock = state.wagons.filter((w) => w.station===s.id && w.team===t.id);
      const loaded = stock.filter((w)=>w.cargo).length;
      const x = box.x+43+i*21, bottom = box.y+87, h = Math.max(7,stock.length*12);
      group.append(svgElement('rect',{class:'bar-outline',x,y:bottom-h,width:15,height:h,rx:2,style:'stroke:'+t.color}));
      for(let j=0;j<stock.length;j++) group.append(svgElement('rect',{class:j<loaded?'bar-filled':'bar-empty',x:x+2,y:bottom-(j+1)*12+2,width:11,height:8,rx:1,fill:j<loaded?t.color:undefined}));
      group.append(svgElement('text',{class:'chart-team-mark',x:x+7.5,y:bottom+13},t.short));
    });
    wrap.append(group);
    if(selected && state.phase==='loading') state.teams.forEach((t,i)=>{
      const done=state.done[M.selectionKey(s.id,t.id)], x=box.x+50+i*21;
      const check=svgElement('g',{class:'selection-check'+(done?' done':''),style:'--team:'+t.color,role:'button',tabindex:0,'data-action':'finish-selection','data-id':t.id,'aria-label':t.name+': завершить выбор над диаграммой','data-focus-key':'check-'+t.id});
      check.append(svgElement('circle',{cx:x,cy:box.y-13,r:9}));check.append(svgElement('text',{x,y:box.y-13},'✓'));wrap.append(check);
    });
    parent.append(wrap);
  }
  /** Зубья шестерёнки рисуются поверх исходного маркера, сохраняя номер читаемым. */
  function gearPath(x,y) {
    const points=Array.from({length:48},(_,i)=>{const radius=i%4<2?23:19, angle=i*Math.PI/24;return (x+Math.cos(angle)*radius)+','+(y+Math.sin(angle)*radius);});
    return 'M '+points.join(' L ')+' Z';
  }
  function drawStation(s,parent) {
    const [x,y]=s.point, closed=M.closed(state,s.id), locos=state.locomotives.filter((l)=>l.station===s.id);
    const target=state.wagons.some((w)=>w.attachedTo===state.currentLoco && w.cargo?.destination===s.id);
    const g=svgElement('g',{class:'station-button'+(closed?' closed':'')+(locos.length>=2?' congested':''),role:'button',tabindex:0,'data-station':s.id,'data-focus-key':'station-'+s.id,'aria-label':'Станция '+num(s.id)+(closed?', закрыта':''),'aria-pressed':s.id===state.selectedStation});
    if(s.id===state.selectedStation || s.id===state.buildFrom || s.id===state.buildTo) g.append(svgElement('circle',{class:'station-selected',cx:x,cy:y,r:29}));
    if(target && state.phase==='movement') g.append(svgElement('circle',{class:'station-destination',cx:x,cy:y,r:36}));
    const visual=svgElement('g',{class:'station-visual'});
    visual.append(svgElement('path',{class:'gear',d:gearPath(x,y)}));visual.append(svgElement('circle',{class:'station-core',cx:x,cy:y,r:14}));visual.append(svgElement('text',{class:'station-number',x,y:y+1},s.id));
    if(closed) visual.append(svgElement('path',{class:'station-closed',d:'M '+(x-23)+' '+(y-23)+' L '+(x+23)+' '+(y+23)}));
    g.append(visual);g.append(svgElement('circle',{class:'station-hit',cx:x,cy:y,r:29}));
    const count=state.goods.filter((a)=>a.origin===s.id && ['available','pool'].includes(a.status)).length;
    if(state.phase==='loading' && (count || s.id===state.selectedStation)) {
      g.append(svgElement('rect',{class:'station-deck',x:x-17,y:y+43,width:34,height:20,rx:5}));
      g.append(svgElement('text',{class:'station-deck-label',x,y:y+58},count));
    }
    parent.append(g);
  }
  function drawRoute(parent) {
    const info=routePreview || pinnedRoute;
    $('route-caption').hidden=!info;
    if(!info)return;
    $('route-caption').textContent=info.text;
    for(let i=0;i<info.path.length-1;i++){
      const r=M.edge(state,info.path[i],info.path[i+1]);if(!r)continue;
      parent.append(svgElement('path',{class:'route-halo',d:r.path}));
      parent.append(svgElement('path',{class:'route-highlight'+(r.status!=='active'?' potential':''),d:r.path,style:'--route:'+info.color}));
    }
  }
  function previewCargo(g) {
    const path=M.route(state,g.origin,g.destination,true);
    const pending=path.some((id,i)=>i>0&&M.edge(state,path[i-1],id)?.status!=='active');
    routePreview={path,color:M.team(state,g.team).color,text:g.name+' · '+g.revenue+' ◉ · '+path.map(num).join(' → ')+(pending?' · часть дороги ещё не построена':'')};
    renderRouteOnly();
  }
  /** Отдельный слой маршрута не пересоздаёт монету под указателем при наведении. */
  function renderRouteOnly() { const g=layer.querySelector('#routes');if(g){g.replaceChildren();drawRoute(g);} }
  function drawCargo(parent) {
    if(state.phase!=='loading')return;
    const byTarget={};
    M.availableGoods(state,state.selectedStation).forEach((g)=>{(byTarget[g.destination] ||= []).push(g);});
    Object.entries(byTarget).forEach(([id,goods])=>{
      const box=offerBox(station(Number(id)));
      goods.forEach((g,i)=>{
        const t=M.team(state,g.team),y=box.y+CARD_H+27+Math.floor(i/4)*44;
        let x=box.x+CARD_W/2+(i%4-(Math.min(goods.length,4)-1)/2)*44;
        // Сохраняем монеты под выноской, но сдвигаем от маркера станции,
        // если её круг оказался под номиналом после компоновки диаграмм.
        if(state.stations.some((s)=>Math.hypot(s.point[0]-x,s.point[1]-y)<51))x+=60;
        const can=M.emptyWagons(state,g.origin,g.team).length>0&&!M.closed(state,g.origin);
        const coin=svgElement('g',{class:'cargo-coin'+(!can?' unavailable':''),style:'--team:'+t.color,tabindex:0,role:'button','data-good':g.id,'data-action':'load','data-id':g.id,'data-focus-key':'good-'+g.id,'aria-label':t.name+': '+g.name+', '+g.revenue+' монет, до станции '+num(g.destination),'aria-disabled':!can});
        coin.append(svgElement('title',{},t.name+' · '+g.name+' · '+num(g.origin)+' → '+num(g.destination)+' · '+g.revenue+' монет'+(!can?' · нет пустого вагона':'')));
        coin.append(svgElement('circle',{class:'coin-body',cx:x,cy:y,r:19+(g.revenue>=15?1:0)}));coin.append(svgElement('circle',{class:'coin-ring',cx:x,cy:y,r:14}));coin.append(svgElement('text',{x,y:y+1},g.revenue));parent.append(coin);
      });
    });
  }
  function drawWagonOffers(parent) {
    const l=M.current(state);if(state.phase!=='movement'||state.detachWindow||!l)return;
    const counts={},offers=state.wagons.filter((w)=>w.station===l.station&&w.cargo&&!w.attachedTo);
    offers.forEach((w)=>{
      const dest=w.cargo.destination, box=offerBox(station(dest)), index=counts[dest]||0;counts[dest]=index+1;
      const total=offers.filter((a)=>a.cargo.destination===dest).length;
      const x=box.x+CARD_W/2-22+(index%3-(Math.min(total,3)-1)/2)*51,y=box.y+CARD_H+20+Math.floor(index/3)*37,t=M.team(state,w.team),p=station(dest).point;
      // Без диаграммы тонкая линия явно связывает предложение с назначением,
      // чтобы соседняя станция не выглядела его фактическим местоположением.
      parent.append(svgElement('path',{class:'offer-leader',d:'M '+p[0]+' '+(p[1]+28)+' V '+(p[1]+46)+' L '+(x+22)+' '+(y-4)}));
      const g=svgElement('g',{class:'wagon-map',style:'--team:'+t.color,role:'button',tabindex:0,'data-action':'attach','data-id':w.id,'data-wagon':w.id,'data-focus-key':'wagon-'+w.id,'aria-label':'Прицепить '+w.id+', на станции '+num(l.station)+', едет до '+num(dest)});
      g.append(svgElement('title',{},w.id+' находится на '+num(l.station)+', назначение '+num(dest)+'. Прицепить: 1 действие.'));
      g.append(svgElement('rect',{x,y,width:45,height:23,rx:3}));g.append(svgElement('text',{x:x+22,y:y+16},w.id));
      g.append(svgElement('circle',{cx:x+10,cy:y+25,r:3}));g.append(svgElement('circle',{cx:x+34,cy:y+25,r:3}));parent.append(g);
    });
  }
  function drawStationAnimations(parent) {
    if(!['market','loading','movement'].includes(state.phase))return;
    const elapsed=performance.now()-trainAnimationEpoch, group=svgElement('g',{class:'station-animation-layer','aria-hidden':'true'});
    state.stations.forEach((s)=>{
      const locos=state.locomotives.filter((l)=>l.station===s.id);
      locos.forEach((l,i)=>drawOrbitingLocomotive(group,...s.point,{className:i?'is-blue':'is-red',body:M.team(state,l.team).color,trim:'#d3a033',scale:i?.48:.52,orbitOffset:i*TRAIN_ORBIT_DURATION/Math.max(1,locos.length),smokeOffset:i*120},elapsed));
    });parent.append(group);
  }
  function renderMap() {
    layer.replaceChildren();
    const roads=svgElement('g',{'aria-hidden':'true'});
    state.roads.forEach((r)=>{if(r.status!=='potential'||state.phase==='construction')roads.append(svgElement('path',{class:'rail-overlay '+r.status,d:r.path}));});
    layer.append(roads);
    const routes=svgElement('g',{id:'routes','aria-hidden':'true'});drawRoute(routes);layer.append(routes);
    const charts=svgElement('g',{});state.stations.filter((s)=>s.id!==state.selectedStation).forEach((s)=>drawChart(s,charts));drawChart(station(state.selectedStation),charts);layer.append(charts);
    const stations=svgElement('g',{});state.stations.forEach((s)=>drawStation(s,stations));layer.append(stations);
    drawStationAnimations(layer);drawCargo(layer);drawWagonOffers(layer);
  }
  function chooseStation(id) {
    hoverStation=null;routePreview=null;pinnedRoute=null;
    if(state.phase==='movement'&&!state.detachWindow){notice(M.move(state,id));render();return;}
    state.selectedStation=id;
    if(state.phase==='construction'){
      if(!state.buildFrom||state.buildTo){state.buildFrom=id;state.buildTo=null;}
      else if(state.buildFrom!==id)state.buildTo=id;
    }
    render();
  }
  function chooseChart(id) {
    const path=M.route(state,state.selectedStation,id,state.phase==='loading'||state.phase==='construction');
    pinnedRoute={path,color:M.team(state,state.selectedTeam).color,text:path.length?'Маршрут '+path.map(num).join(' → '):'До станции '+num(id)+' пока нет действующего маршрута'};
    routePreview=null;renderRouteOnly();
  }
  /** Одно место связывает UI-действия и модель; все экраны видят один результат. */
  document.addEventListener('click',(event)=>{
    const target=event.target.closest('[data-action]');if(!target)return;
    const a=target.dataset.action,id=target.dataset.id,kind=target.dataset.kind;
    let result;
    if(a==='expand-sidebar'){setSidebarCollapsed(false);return;}
    if(a==='team'){state.selectedTeam=id;render();return;}
    if(a==='load')result=M.loadGood(state,id);
    if(a==='finish-selection')result=M.finishSelection(state,id);
    if(a==='buy')result=M.buy(state,kind);
    if(a==='sell')result=M.sell(state,kind,id);
    if(a==='loco')result=M.selectLoco(state,id);
    if(a==='attach')result=M.attach(state,id);
    if(a==='detach')result=M.detach(state,id);
    if(a==='finish-loco')result=M.finishLoco(state);
    if(a==='next-loco')result=state.locomotives.some((l)=>!state.finishedLocos.includes(l.id))?M.nextLoco(state):M.next(state);
    if(a==='build-kind')state.buildKind=id;
    if(a==='clear-build'){state.buildFrom=null;state.buildTo=null;}
    if(a==='project')result=M.project(state,buildAreas);
    if(a==='build')result=M.build(state);
    if(a==='road'){const r=state.roads.find((r)=>r.id===id);state.buildFrom=r.from;state.buildTo=r.to;state.selectedTeam=r.owner;state.buildKind=r.kind;state.selectedStation=r.from;}
    if(result){routePreview=null;pinnedRoute=null;notice(result);}
    render();
  });
  document.addEventListener('input',(event)=>{
    if(!['build-areas','build-areas-compact'].includes(event.target.id))return;
    buildAreas=Math.max(1,Math.min(12,Math.floor(Number(event.target.value))||1));
    document.querySelectorAll('[data-action="project"]').forEach((quote)=>{
      if(quote.closest('#sidebar-compact')){quote.innerHTML=uiIcon('project')+'<span>'+buildAreas+'</span>';quote.title='Спроектировать за '+buildAreas+' монет';quote.setAttribute('aria-label',quote.title);}
      else quote.textContent='Спроектировать · '+buildAreas+' ◉';
    });
    ['build-areas','build-areas-compact'].forEach((id)=>{if($(id)&&$(id)!==event.target)$(id).value=buildAreas;});
  });
  layer.addEventListener('click',(event)=>{const node=event.target.closest('[data-station]');if(node)chooseStation(Number(node.dataset.station));});
  layer.addEventListener('pointerover',(event)=>{
    const stationNode=event.target.closest('[data-station]');
    if(stationNode&&!stationNode.contains(event.relatedTarget)){hoverStation=Number(stationNode.dataset.station);renderDock();}
    const coin=event.target.closest('[data-good]');
    if(coin&&!coin.contains(event.relatedTarget)){const g=state.goods.find((g)=>g.id===coin.dataset.good);if(g)previewCargo(g);}
    const wagon=event.target.closest('[data-wagon]');
    if(wagon&&!wagon.contains(event.relatedTarget)){const w=state.wagons.find((w)=>w.id===wagon.dataset.wagon);if(w?.cargo)previewCargo({...w.cargo,origin:w.station,team:w.team});}
  });
  layer.addEventListener('pointerout',(event)=>{
    const stationNode=event.target.closest('[data-station]');
    if(stationNode&&!stationNode.contains(event.relatedTarget)){hoverStation=null;renderDock();}
    const offer=event.target.closest('[data-good],[data-wagon]');
    if(offer&&!offer.contains(event.relatedTarget)){routePreview=null;renderRouteOnly();}
  });
  layer.addEventListener('focusin',(event)=>{const c=event.target.closest('[data-good]');if(c){const g=state.goods.find((g)=>g.id===c.dataset.good);if(g)previewCargo(g);}});
  layer.addEventListener('focusout',()=>{routePreview=null;renderRouteOnly();});
  function point(clientX,clientY) {const p=layer.createSVGPoint();p.x=clientX;p.y=clientY;return p.matrixTransform(layer.getScreenCTM().inverse());}
  function clampOffset(s,offset) {return [Math.max(15-s.point[0],Math.min(1878-CARD_W-15-s.point[0],offset[0])),Math.max(25-s.point[1],Math.min(1345-CARD_H-145-s.point[1],offset[1]))];}
  function transform() {
    stage.style.setProperty('--camera-zoom',camera.zoom);
    const width=stage.offsetWidth*camera.zoom,height=stage.offsetHeight*camera.zoom;
    camera.x=Math.max(Math.min(0,viewport.clientWidth-width),Math.min(Math.max(0,viewport.clientWidth-width),camera.x));
    camera.y=Math.max(Math.min(0,viewport.clientHeight-height),Math.min(Math.max(0,viewport.clientHeight-height),camera.y));
    stage.style.transform='translate('+camera.x+'px,'+camera.y+'px) scale('+camera.zoom+')';
    $('zoom-value').textContent=Math.round(camera.zoom*100)+'%';
  }
  function zoom(delta,clientX,clientY) {
    const rect=viewport.getBoundingClientRect(),x=clientX===undefined?rect.width/2:clientX-rect.left,y=clientY===undefined?rect.height/2:clientY-rect.top;
    const before=camera.zoom;camera.zoom=Math.max(.35,Math.min(Math.max(3.5,viewport.clientHeight/stage.offsetHeight*1.8),camera.zoom+delta));const ratio=camera.zoom/before;
    camera.x=x-(x-camera.x)*ratio;camera.y=y-(y-camera.y)*ratio;transform();
  }
  function focusMap(all=false) {
    if(all){camera.zoom=Math.min(1,viewport.clientHeight/(viewport.clientWidth*1345/1878));camera.x=(viewport.clientWidth-stage.offsetWidth*camera.zoom)/2;camera.y=0;}
    else {camera.zoom=Math.max(viewport.clientWidth<600?2.7:1.45,viewport.clientHeight/stage.offsetHeight*1.3);const p=station(state.selectedStation).point,scale=stage.offsetWidth/1878*camera.zoom;camera.x=viewport.clientWidth/2-p[0]*scale;camera.y=viewport.clientHeight*(['market','movement'].includes(state.phase)?.43:.52)-p[1]*scale;}
    transform();
  }
  // Захват указателя лежит на неизменяемом viewport, поэтому перерисовка SVG
  // не обрывает drag. Порог отделяет перенос диаграммы от выбора маршрута.
  viewport.addEventListener('pointerdown',(event)=>{
    if(event.button!==0||drag)return;
    const chart=event.target.closest('[data-chart]');
    if(!chart&&event.target.closest('[data-station],[data-action]'))return;
    // Захват указателя сам по себе не отменяет браузерное выделение текста.
    // Отменяем его начало для обоих видов переноса, в том числе при выходе
    // указателя с карты на карточки нижней панели.
    event.preventDefault();
    const p=point(event.clientX,event.clientY);
    drag={pointer:event.pointerId,chart:chart?Number(chart.dataset.chart):null,start:[event.clientX,event.clientY],p,offset:chart?[...(chartOffsets[chart.dataset.chart]||baseOffset(station(Number(chart.dataset.chart))))]:null,camera:[camera.x,camera.y],moved:false};
    (chart||viewport).focus({preventScroll:true});
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove',(event)=>{
    if(!drag||drag.pointer!==event.pointerId)return;
    const dx=event.clientX-drag.start[0],dy=event.clientY-drag.start[1];
    if(!drag.moved&&Math.hypot(dx,dy)<7)return;drag.moved=true;
    if(drag.chart){const p=point(event.clientX,event.clientY);chartOffsets[drag.chart]=clampOffset(station(drag.chart),[drag.offset[0]+p.x-drag.p.x,drag.offset[1]+p.y-drag.p.y]);renderMap();}
    else{camera.x=drag.camera[0]+dx;camera.y=drag.camera[1]+dy;transform();}
  });
  function endDrag(event,cancelled=false){
    if(!drag||drag.pointer!==event.pointerId)return;const ended=drag;drag=null;
    if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);
    if(ended.chart&&!ended.moved&&!cancelled)chooseChart(ended.chart);
  }
  viewport.addEventListener('pointerup',(e)=>endDrag(e));viewport.addEventListener('pointercancel',(e)=>endDrag(e,true));
  viewport.addEventListener('lostpointercapture',(e)=>{if(drag?.pointer===e.pointerId)drag=null;});
  viewport.addEventListener('wheel',(e)=>{e.preventDefault();zoom(e.deltaY<0?.1:-.1,e.clientX,e.clientY);},{passive:false});
  layer.addEventListener('keydown',(event)=>{
    const chart=event.target.closest('[data-chart]'),s=event.target.closest('[data-station]'),action=event.target.closest('[data-action]');
    if(event.key==='Enter'||event.key===' '){event.preventDefault();if(chart)chooseChart(Number(chart.dataset.chart));else if(s)chooseStation(Number(s.dataset.station));else if(action)action.dispatchEvent(new MouseEvent('click',{bubbles:true}));}
    const dirs={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(chart&&dirs[event.key]){event.preventDefault();event.stopPropagation();const id=Number(chart.dataset.chart),offset=chartOffsets[id]||baseOffset(station(id)),d=dirs[event.key],step=event.shiftKey?40:12;chartOffsets[id]=clampOffset(station(id),[offset[0]+d[0]*step,offset[1]+d[1]*step]);render();}
  });
  viewport.addEventListener('keydown',(e)=>{
    if(e.key==='Escape'){pinnedRoute=null;routePreview=null;renderRouteOnly();}
    if(e.target!==viewport)return;
    if(e.key==='+'||e.key==='=')zoom(.1);if(e.key==='-')zoom(-.1);
    const dirs={ArrowLeft:[35,0],ArrowRight:[-35,0],ArrowUp:[0,35],ArrowDown:[0,-35]};
    if(dirs[e.key]){e.preventDefault();camera.x+=dirs[e.key][0];camera.y+=dirs[e.key][1];transform();}
  });
  $('next-phase').addEventListener('click',()=>{
    const before=state.phase,result=M.next(state);hoverStation=null;routePreview=null;pinnedRoute=null;render();
    if(before===state.phase||state.phase==='movement')notice(result);else $('toast').hidden=true;
    if(before!==state.phase||state.phase==='movement')focusMap();
  });
  /** Сворачивание меняет только представление. Решение пользователя сохраняется
      при переходе этапов; скрытая версия не участвует в фокусе и чтении экрана. */
  function syncSidebar() {
    document.querySelector('.application-shell').classList.toggle('sidebar-collapsed',sidebarCollapsed);
    $('sidebar-expanded').hidden=sidebarCollapsed;
    $('sidebar-compact').hidden=!sidebarCollapsed;
    $('sidebar-toggle').setAttribute('aria-expanded',String(!sidebarCollapsed));
    $('sidebar-toggle').setAttribute('aria-label',sidebarCollapsed?'Развернуть сайдбар':'Свернуть сайдбар');
    $('sidebar-toggle').title=sidebarCollapsed?'Развернуть сайдбар':'Свернуть сайдбар';
    $('sidebar-toggle').innerHTML='<span aria-hidden="true">'+(sidebarCollapsed?'‹':'›')+'</span>';
  }
  function setSidebarCollapsed(collapsed) {
    // Сохраняем мировой масштаб и точку в центре карты при изменении её ширины.
    const oldWidth=viewport.clientWidth,scale=stage.offsetWidth*camera.zoom/1878;
    const center=[(oldWidth/2-camera.x)/scale,(viewport.clientHeight/2-camera.y)/scale];
    sidebarCollapsed=collapsed;syncSidebar();
    camera.zoom=scale*1878/stage.offsetWidth;
    camera.x=viewport.clientWidth/2-center[0]*scale;
    camera.y=viewport.clientHeight/2-center[1]*scale;
    transform();
    $('sidebar-toggle').focus({preventScroll:true});
  }
  $('sidebar-toggle').addEventListener('click',()=>setSidebarCollapsed(!sidebarCollapsed));
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&!sidebarCollapsed&&$('game-sidebar').contains(e.target))setSidebarCollapsed(true);});
  $('zoom-in').addEventListener('click',()=>zoom(.1));$('zoom-out').addEventListener('click',()=>zoom(-.1));
  $('fit-map').addEventListener('click',()=>focusMap(true));$('focus-map').addEventListener('click',()=>focusMap());
  window.addEventListener('resize',()=>{syncSidebar();focusMap();});
  $('map-stage').querySelector('img').addEventListener('load',()=>focusMap());
  syncSidebar();render();focusMap();

  function drawOrbitingLocomotive(parent, centerX, centerY, palette, elapsed) {
    const orbitProgress = (elapsed + palette.orbitOffset) % TRAIN_ORBIT_DURATION;
    const orbit = svgElement('g', {
      class: `train-orbit ${palette.className}`,
      style: `transform-origin:${centerX}px ${centerY}px;--orbit-delay:${-orbitProgress}ms`
    });
    const carrier = svgElement('g', { transform: `translate(${centerX} ${centerY - TRAIN_ORBIT_RADIUS}) scale(${palette.scale})` });
    drawSmoke(carrier, elapsed, palette.smokeOffset);
    drawLocomotive(carrier, palette);
    orbit.append(carrier);
    parent.append(orbit);
  }

  function drawSmoke(parent, elapsed, phaseOffset) {
    const smoke = svgElement('g', { class: 'train-smoke', transform: 'translate(10 -25)', 'aria-hidden': 'true' });
    const puffDuration = 1200;
    for (let index = 0; index < 5; index += 1) {
      const puffProgress = (elapsed + phaseOffset + index * 240) % puffDuration;
      const puff = svgElement('g', { class: 'smoke-puff', style: `--smoke-delay:${-puffProgress}ms` });
      // Несколько перекрывающихся частей дают клубу рисованный силуэт вместо
      // геометрически идеального круга из ранних вариантов прототипа.
      puff.append(svgElement('circle', { cx: 0, cy: 0, r: 3.4 }));
      puff.append(svgElement('circle', { cx: 3.2, cy: -1.8, r: 2.6 }));
      puff.append(svgElement('circle', { cx: -2.8, cy: -2.2, r: 2.4 }));
      smoke.append(puff);
    }
    parent.append(smoke);
  }

  function drawLocomotive(parent, palette) {
    const train = svgElement('g', {
      class: `locomotive ${palette.className}`,
      style: `--train-body:${palette.body};--train-trim:${palette.trim}`,
      'aria-hidden': 'true'
    });

    // Тёмный контур и слегка преувеличенные детали сохраняют читаемый силуэт
    // на общей карте: кабина слева, котёл и решётка — спереди справа.
    train.append(svgElement('rect', { class: 'train-chassis', x: -29, y: 3, width: 55, height: 7, rx: 2 }));
    train.append(svgElement('rect', { class: 'train-body', x: -28, y: -17, width: 17, height: 21, rx: 2 }));
    train.append(svgElement('path', { class: 'train-roof', d: 'M -31 -17 Q -30 -21 -26 -21 H -10 Q -7 -20 -7 -17 Z' }));
    train.append(svgElement('rect', { class: 'train-window', x: -24, y: -13, width: 9, height: 8, rx: 1 }));
    train.append(svgElement('rect', { class: 'train-boiler', x: -12, y: -12, width: 33, height: 16, rx: 8 }));
    train.append(svgElement('circle', { class: 'train-front', cx: 20, cy: -4, r: 8 }));
    train.append(svgElement('circle', { class: 'train-front-cap', cx: 22, cy: -4, r: 3 }));
    train.append(svgElement('path', { class: 'train-dark', d: 'M 7 -13 L 7 -24 L 14 -24 L 13 -13 Z' }));
    train.append(svgElement('rect', { class: 'train-trim', x: 5, y: -27, width: 11, height: 4, rx: 1 }));
    train.append(svgElement('rect', { class: 'train-trim', x: -8, y: -17, width: 4, height: 7, rx: 2 }));
    train.append(svgElement('path', { class: 'train-cowcatcher', d: 'M 23 3 L 34 13 L 22 13 Z' }));

    [-19, -3, 14].forEach((wheelX) => {
      const wheel = svgElement('g', { class: 'train-wheel', transform: `translate(${wheelX} 9)` });
      wheel.append(svgElement('circle', { class: 'train-wheel-outer', cx: 0, cy: 0, r: 6 }));
      wheel.append(svgElement('circle', { class: 'train-wheel-rim', cx: 0, cy: 0, r: 3.7 }));
      wheel.append(svgElement('path', { class: 'train-wheel-spokes', d: 'M -3.5 0 H 3.5 M 0 -3.5 V 3.5 M -2.5 -2.5 L 2.5 2.5 M 2.5 -2.5 L -2.5 2.5' }));
      train.append(wheel);
    });

    parent.append(train);
  }


}());
