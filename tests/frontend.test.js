// Tests für das Frontend-Script. Der Aufbau der Seitenleiste ist hier nachgebaut
// (home-assistant > home-assistant-main > ha-sidebar, jeweils mit Shadow-Root).
// Er ersetzt keinen Test in einer echten Home-Assistant-Instanz.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SCRIPT = fs.readFileSync(
  path.join(__dirname, '..', 'custom_components', 'enhanced_sidebar', 'frontend', 'enhanced-sidebar.js'),
  'utf8'
);

function loadApi(url = 'http://ha.test/mein-zuhause') {
  const dom = new JSDOM('<!doctype html><body></body>', { url, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.__ENHANCED_SIDEBAR_TEST__ = {};
  dom.window.eval(SCRIPT);
  return { dom, api: dom.window.__ENHANCED_SIDEBAR_TEST__.api };
}

const PANELS = {
  lovelace: { require_admin: false },
  'mein-zuhause': { require_admin: false },
  'heizung-uebersicht': { require_admin: false },
  history: { require_admin: false },
  logbook: { require_admin: false },
  'dienste-uebersicht': { require_admin: true },
  'kiosk-test': { require_admin: true },
  a0d7b954_ssh: { require_admin: true },
  hacs: { require_admin: true },
  config: { require_admin: true },
  'developer-tools': { require_admin: true },
  profile: { require_admin: false },
};

/** Baut Seitenleiste mit Shadow-Roots und liefert Zugriffspunkte. */
function buildSidebar(dom, hrefs, { bottom = ['/config', '/profile'] } = {}) {
  const doc = dom.window.document;
  const ha = doc.createElement('home-assistant');
  doc.body.append(ha);
  const haRoot = ha.attachShadow({ mode: 'open' });
  const main = doc.createElement('home-assistant-main');
  haRoot.append(main);
  const mainRoot = main.attachShadow({ mode: 'open' });
  const sidebar = doc.createElement('ha-sidebar');
  mainRoot.append(sidebar);
  const root = sidebar.attachShadow({ mode: 'open' });

  const list = doc.createElement('ha-md-list');
  for (const href of hrefs) {
    const item = doc.createElement('ha-md-list-item');
    item.setAttribute('href', href);
    item.textContent = href;
    list.append(item);
  }
  const bottomList = doc.createElement('ha-md-list');
  for (const href of bottom) {
    const item = doc.createElement('ha-md-list-item');
    item.setAttribute('href', href);
    bottomList.append(item);
  }
  root.append(list, bottomList);
  return { ha, sidebar, root, list, bottomList };
}

function makeController(api, dom, sb, panels, rawConfig, user = { name: 'Dominik', is_admin: true }) {
  const hass = { panels, user };
  return api.createController({
    getHass: () => hass,
    findSidebar: () => api.deepQuery(dom.window.document, 'ha-sidebar'),
    config: api.normalizeConfig(rawConfig),
  });
}

const HREFS = [
  '/lovelace/0',
  '/mein-zuhause',
  '/heizung-uebersicht',
  '/dienste-uebersicht',
  '/history',
  '/kiosk-test',
  '/a0d7b954_ssh',
  '/hacs',
];

test('normalizeConfig: Standardwerte, Listen aus Text, Pfade bereinigt', () => {
  const { api } = loadApi();
  const def = api.normalizeConfig(null);
  assert.equal(def.group_name, 'Admin');
  assert.equal(def.auto_detect_admin, true);
  assert.deepEqual([...def.exclude], ['config', 'developer-tools', 'profile']);

  const cfg = api.normalizeConfig({
    group_name: '  Weitere  ',
    include: '/kalender-uebersicht/, pakete-uebersicht\nenergie-uebersicht',
    hidden: ['history', ' logbook '],
    auto_collapse: false,
  });
  assert.equal(cfg.group_name, 'Weitere');
  assert.deepEqual([...cfg.include], ['kalender-uebersicht', 'pakete-uebersicht', 'energie-uebersicht']);
  assert.deepEqual([...cfg.hidden], ['history', 'logbook']);
  assert.equal(cfg.auto_collapse, false);
});

test('panelFromHref: erstes Pfadsegment, nur gleiche Herkunft', () => {
  const { api } = loadApi();
  assert.equal(api.panelFromHref('/lovelace/0'), 'lovelace');
  assert.equal(api.panelFromHref('/dienste-uebersicht?x=1#a'), 'dienste-uebersicht');
  assert.equal(api.panelFromHref('http://ha.test/hacs'), 'hacs');
  assert.equal(api.panelFromHref('https://other.example/hacs'), null);
  assert.equal(api.panelFromHref('/'), null);
  assert.equal(api.panelFromHref(''), null);
  assert.equal(api.panelFromHref(null), null);
});

test('classify: Admin-Panels, Ausnahmen, Include, Hidden, Reihenfolge', () => {
  const { api } = loadApi();
  const cfg = (raw) => api.normalizeConfig(raw);

  assert.equal(api.classify('dienste-uebersicht', PANELS, cfg({})).grouped, true);
  assert.equal(api.classify('mein-zuhause', PANELS, cfg({})).grouped, false);
  // Standard-Ausnahmen
  assert.equal(api.classify('config', PANELS, cfg({})).grouped, false);
  assert.equal(api.classify('developer-tools', PANELS, cfg({})).grouped, false);
  // eigene Ausnahme
  assert.equal(api.classify('hacs', PANELS, cfg({ exclude: ['hacs'] })).grouped, false);
  // Include gewinnt gegen Exclude und gilt auch für Nicht-Admin-Panels
  assert.equal(api.classify('mein-zuhause', PANELS, cfg({ include: ['mein-zuhause'] })).grouped, true);
  assert.equal(api.classify('hacs', PANELS, cfg({ exclude: ['hacs'], include: ['hacs'] })).grouped, true);
  // Automatik aus
  assert.equal(api.classify('hacs', PANELS, cfg({ auto_detect_admin: false })).grouped, false);
  // Ausgeblendet wird nie gruppiert
  const hidden = api.classify('hacs', PANELS, cfg({ hidden: ['hacs'] }));
  assert.equal(hidden.hidden, true);
  assert.equal(hidden.grouped, false);
  // Rang
  assert.equal(api.classify('hacs', PANELS, cfg({ order: ['kiosk-test', 'hacs'] })).rank, 1);
  assert.equal(api.classify('hacs', PANELS, cfg({})).rank, null);
  // Panel ohne require_admin-Angabe wird nicht gruppiert
  assert.equal(api.classify('x', { x: {} }, cfg({})).grouped, false);
  assert.equal(api.classify('x', null, cfg({})).grouped, false);
});

test('Admin-Gruppe: Kopfzeile, Markierungen, zugeklappt, Reihenfolge', () => {
  const { dom, api } = loadApi();
  const sb = buildSidebar(dom, HREFS);
  const c = makeController(api, dom, sb, PANELS, {});
  c.apply();

  assert.equal(c.state.status, 'grouped');
  const headers = sb.root.querySelectorAll('[data-es-header]');
  assert.equal(headers.length, 1);
  assert.equal(headers[0].querySelector('.es-label').textContent, 'Admin');
  assert.equal(headers[0].getAttribute('aria-expanded'), 'false');

  const grouped = [...sb.root.querySelectorAll('[data-es-grouped]')].map((e) => e.getAttribute('data-es-path'));
  assert.deepEqual(grouped, ['dienste-uebersicht', 'kiosk-test', 'a0d7b954_ssh', 'hacs']);

  // Kopfzeile steht direkt vor dem ersten Admin-Eintrag
  assert.equal(headers[0].nextElementSibling.getAttribute('href'), '/dienste-uebersicht');
  assert.equal(sb.list.hasAttribute('data-es-list'), true);
  assert.equal(sb.list.hasAttribute('data-es-collapsed'), true);
  for (const el of sb.root.querySelectorAll('[data-es-grouped]')) assert.equal(el.style.order, '9002');

  // normale Einträge und die untere Liste bleiben unberührt
  const normal = sb.list.querySelector('[href="/mein-zuhause"]');
  assert.equal(normal.hasAttribute('data-es-grouped'), false);
  assert.equal(normal.style.order, '');
  assert.equal(sb.bottomList.hasAttribute('data-es-list'), false);
  assert.equal(sb.bottomList.querySelector('[href="/config"]').hasAttribute('data-es-grouped'), false);
});

test('Ein-/Ausklappen per Klick und Tastatur', () => {
  const { dom, api } = loadApi();
  const sb = buildSidebar(dom, HREFS);
  const c = makeController(api, dom, sb, PANELS, {});
  c.apply();

  const header = sb.root.querySelector('[data-es-header]');
  header.click();
  assert.equal(header.getAttribute('aria-expanded'), 'true');
  assert.equal(sb.list.hasAttribute('data-es-collapsed'), false);

  header.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(header.getAttribute('aria-expanded'), 'false');
  assert.equal(sb.list.hasAttribute('data-es-collapsed'), true);

  header.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  assert.equal(header.getAttribute('aria-expanded'), 'true');
});

test('Wiederholtes apply ändert nichts (idempotent, genau eine Kopfzeile)', () => {
  const { dom, api } = loadApi();
  const sb = buildSidebar(dom, HREFS);
  const c = makeController(api, dom, sb, PANELS, {});
  c.apply();
  const html = sb.root.innerHTML;
  c.apply();
  c.apply();
  assert.equal(sb.root.innerHTML, html);
  assert.equal(sb.root.querySelectorAll('[data-es-header]').length, 1);
});

test('Navigation: öffnet bei Admin-Seite, klappt bei anderer Seite zu', () => {
  const { dom, api } = loadApi('http://ha.test/mein-zuhause');
  const sb = buildSidebar(dom, HREFS);
  const c = makeController(api, dom, sb, PANELS, {});
  c.start();
  assert.equal(sb.list.hasAttribute('data-es-collapsed'), true);

  dom.reconfigure({ url: 'http://ha.test/dienste-uebersicht' });
  c.onLocation();
  c.apply();
  assert.equal(sb.list.hasAttribute('data-es-collapsed'), false);

  dom.reconfigure({ url: 'http://ha.test/heizung-uebersicht' });
  c.onLocation();
  c.apply();
  assert.equal(sb.list.hasAttribute('data-es-collapsed'), true);
  c.stop();
});

test('Direktaufruf einer Admin-Seite: Gruppe startet offen', () => {
  const { dom, api } = loadApi('http://ha.test/hacs');
  const sb = buildSidebar(dom, HREFS);
  const c = makeController(api, dom, sb, PANELS, {});
  c.start();
  assert.equal(sb.list.hasAttribute('data-es-collapsed'), false);
  c.stop();
});

test('auto_collapse aus: Gruppe startet offen und bleibt bei Navigation offen', () => {
  const { dom, api } = loadApi('http://ha.test/mein-zuhause');
  const sb = buildSidebar(dom, HREFS);
  const c = makeController(api, dom, sb, PANELS, { auto_collapse: false });
  c.start();
  assert.equal(sb.list.hasAttribute('data-es-collapsed'), false);
  dom.reconfigure({ url: 'http://ha.test/heizung-uebersicht' });
  c.onLocation();
  c.apply();
  assert.equal(sb.list.hasAttribute('data-es-collapsed'), false);
  c.stop();
});

test('Nicht-Admin: keine Admin-Panels vorhanden, keine Gruppe', () => {
  const { dom, api } = loadApi();
  const userPanels = Object.fromEntries(Object.entries(PANELS).filter(([, p]) => !p.require_admin));
  const sb = buildSidebar(dom, ['/lovelace/0', '/mein-zuhause', '/heizung-uebersicht', '/history'], { bottom: ['/profile'] });
  const c = makeController(api, dom, sb, userPanels, {}, { name: 'Sina', is_admin: false });
  c.apply();
  assert.equal(c.state.status, 'no-group');
  assert.equal(sb.root.querySelectorAll('[data-es-header]').length, 0);
  assert.equal(sb.list.hasAttribute('data-es-list'), false);
});

test('Include, Hidden und Reihenfolge', () => {
  const { dom, api } = loadApi();
  const sb = buildSidebar(dom, HREFS);
  const c = makeController(api, dom, sb, PANELS, {
    include: ['heizung-uebersicht'],
    hidden: ['history'],
    order: ['mein-zuhause', 'lovelace'],
  });
  c.apply();

  const q = (p) => sb.list.querySelector(`[data-es-path="${p}"]`);
  assert.equal(q('heizung-uebersicht').hasAttribute('data-es-grouped'), true);
  assert.equal(q('history').hasAttribute('data-es-hidden'), true);
  assert.equal(q('mein-zuhause').style.order, '0');
  assert.equal(q('lovelace').style.order, '1');
  // nicht aufgeführte Einträge nach den aufgeführten
  assert.equal(q('history').style.order, '500');
  assert.equal(sb.list.hasAttribute('data-es-list'), true);
});

test('Gruppierte Einträge in einer anderen Liste: Original ausgeblendet, Kopie in der Gruppe', () => {
  const { dom, api } = loadApi();
  // Admin-Panel "hacs" steht in der unteren Liste, die übrigen oben
  const sb = buildSidebar(dom, HREFS.filter((h) => h !== '/hacs'), { bottom: ['/hacs', '/config'] });
  const c = makeController(api, dom, sb, PANELS, {});
  c.apply();
  const original = sb.bottomList.querySelector('[href="/hacs"]');
  assert.equal(original.hasAttribute('data-es-grouped'), false);
  assert.equal(original.hasAttribute('data-es-hidden'), true);
  const proxy = sb.list.querySelector('[data-es-proxy="hacs"]');
  assert.ok(proxy);
  assert.equal(proxy.hasAttribute('data-es-grouped'), true);
  assert.equal(proxy.hasAttribute('href'), false);
  // 3 echte Einträge + 1 Kopie
  assert.equal(sb.root.querySelectorAll('[data-es-grouped]').length, 4);
});

test('Unbekannter Aufbau: keine Seitenleiste oder keine Einträge -> nichts passiert', () => {
  const { dom, api } = loadApi();
  const hass = { panels: PANELS, user: { is_admin: true } };

  const none = api.createController({
    getHass: () => hass,
    findSidebar: () => null,
    config: api.normalizeConfig({}),
  });
  none.apply();
  assert.equal(none.state.status, 'waiting');

  const sb = buildSidebar(dom, [], { bottom: [] });
  const empty = makeController(api, dom, sb, PANELS, {});
  empty.apply();
  assert.equal(empty.state.status, 'no-items');
  assert.equal(sb.root.querySelectorAll('[data-es-header]').length, 0);

  // href-Ziele, die keine Panels sind (externe Links, Unbekanntes), werden ignoriert
  const sb2 = buildSidebar(dom, ['https://example.com/hacs', '/gibt-es-nicht'], { bottom: [] });
  const other = makeController(api, dom, sb2, PANELS, {});
  other.apply();
  assert.equal(other.state.status, 'no-items');
});

test('Wird die Kopfzeile von außen entfernt, setzt das nächste apply sie wieder ein', () => {
  const { dom, api } = loadApi();
  const sb = buildSidebar(dom, HREFS);
  const c = makeController(api, dom, sb, PANELS, {});
  c.apply();
  sb.root.querySelector('[data-es-header]').remove();
  c.apply();
  assert.equal(sb.root.querySelectorAll('[data-es-header]').length, 1);
});

test('stop() räumt alle Markierungen wieder auf', () => {
  const { dom, api } = loadApi();
  const sb = buildSidebar(dom, HREFS);
  const c = makeController(api, dom, sb, PANELS, { order: ['hacs'] });
  c.start();
  c.stop();
  assert.equal(sb.root.querySelectorAll('[data-es-header]').length, 0);
  assert.equal(sb.root.querySelectorAll('[data-es-grouped],[data-es-hidden],[data-es-list],[data-es-path]').length, 0);
  assert.equal(sb.root.querySelector('[href="/hacs"]').style.order, '');
});

test('Angezeigter Gruppenname wird als Text eingesetzt (kein HTML)', () => {
  const { dom, api } = loadApi();
  const sb = buildSidebar(dom, HREFS);
  const c = makeController(api, dom, sb, PANELS, { group_name: '<img src=x onerror=alert(1)>' });
  c.apply();
  const label = sb.root.querySelector('.es-label');
  assert.equal(label.children.length, 0);
  assert.equal(label.textContent, '<img src=x onerror=alert(1)>');
});

test('Aufbau von Home Assistant 2026.10: ha-list-item-button mit ID, Link im Shadow-Root, Eintraege in <slot>', () => {
  const { dom, api } = loadApi();
  const doc = dom.window.document;
  const ha = doc.createElement('home-assistant');
  doc.body.append(ha);
  const main = doc.createElement('home-assistant-main');
  ha.attachShadow({ mode: 'open' }).append(main);
  const sidebar = doc.createElement('ha-sidebar');
  main.attachShadow({ mode: 'open' }).append(sidebar);
  const root = sidebar.attachShadow({ mode: 'open' });
  const nav = doc.createElement('ha-list-nav');
  const slot = doc.createElement('slot');
  nav.attachShadow({ mode: 'open' });
  nav.append(slot);
  const paths = ['mein-zuhause', 'core_configurator', 'dienste-uebersicht', 'hacs', 'todo'];
  for (const path of paths) {
    const item = doc.createElement('ha-list-item-button');
    item.id = 'sidebar-panel-' + path;
    item.attachShadow({ mode: 'open' }).innerHTML = '<a href="/' + path + '"></a>';
    slot.append(item);
  }
  root.append(nav);

  const panels = {
    'mein-zuhause': { require_admin: false },
    core_configurator: { require_admin: true },
    'dienste-uebersicht': { require_admin: true },
    hacs: { require_admin: true },
    todo: { require_admin: false },
  };
  const hass = { panels, user: { is_admin: true } };
  const c = api.createController({
    getHass: () => hass,
    findSidebar: () => api.deepQuery(doc, 'ha-sidebar'),
    config: api.normalizeConfig({ hidden: ['todo'], order: ['mein-zuhause'] }),
  });
  c.apply();

  assert.equal(c.state.status, 'grouped');
  assert.equal(root.querySelector('#sidebar-panel-todo').hasAttribute('data-es-hidden'), true);
  assert.equal(root.querySelector('#sidebar-panel-mein-zuhause').hasAttribute('data-es-grouped'), false);
  for (const path of ['core_configurator', 'dienste-uebersicht', 'hacs']) {
    assert.equal(root.querySelector('#sidebar-panel-' + path).hasAttribute('data-es-grouped'), true, path);
  }
  const header = root.querySelector('[data-es-header]');
  assert.ok(header);
  assert.equal(header.parentElement, slot);
  assert.equal(slot.hasAttribute('data-es-collapsed'), true);
});

/** Aufbau wie in Home Assistant 2026.10: Hauptliste und feste untere Liste mit Einstellungen, Benachrichtigungen, Profil. */
function buildRealSidebar(dom, { badge = '' } = {}) {
  const doc = dom.window.document;
  const ha = doc.createElement('home-assistant');
  doc.body.append(ha);
  const main = doc.createElement('home-assistant-main');
  ha.attachShadow({ mode: 'open' }).append(main);
  const sidebar = doc.createElement('ha-sidebar');
  main.attachShadow({ mode: 'open' }).append(sidebar);
  const root = sidebar.attachShadow({ mode: 'open' });

  const item = (parent, id, text, extra = '') => {
    const el = doc.createElement('ha-list-item-button');
    el.id = id;
    el.innerHTML = '<ha-svg-icon slot="start"></ha-svg-icon>' + (extra ? '<span slot="start">' + extra.replace(/<[^>]+>/g, '') + '</span>' : '') + '<span slot="headline">' + text + '</span>' + extra;
    parent.append(el);
    return el;
  };
  const navMain = doc.createElement('ha-list-nav');
  const slotMain = doc.createElement('slot');
  navMain.append(slotMain);
  for (const [path, text] of [['mein-zuhause', 'Übersicht'], ['heizung-uebersicht', 'Heizen'], ['hacs', 'HACS'], ['dienste-uebersicht', 'Dienste']]) {
    item(slotMain, 'sidebar-panel-' + path, text);
  }
  const navBottom = doc.createElement('ha-list-nav');
  const slotBottom = doc.createElement('slot');
  slotBottom.setAttribute('name', 'fixed-navigation');
  navBottom.append(slotBottom);
  const config = item(slotBottom, 'sidebar-config', 'Einstellungen', badge ? '<span slot="end">' + badge + '</span>' : '');
  config.setAttribute('href', '/config');
  const notifications = item(slotBottom, 'sidebar-notifications', 'Benachrichtigungen');
  const profile = item(slotBottom, 'sidebar-profile', 'Profil');
  profile.setAttribute('href', '/profile');
  root.append(navMain, navBottom);
  return { root, slotMain, slotBottom, config, notifications, profile, doc };
}

const REAL_PANELS = {
  'mein-zuhause': { require_admin: false },
  'heizung-uebersicht': { require_admin: false },
  hacs: { require_admin: true },
  'dienste-uebersicht': { require_admin: true },
  config: { require_admin: true },
  profile: { require_admin: false },
};

function realController(api, dom, rawConfig) {
  const hass = { panels: REAL_PANELS, user: { is_admin: true } };
  return api.createController({
    getHass: () => hass,
    findSidebar: () => api.deepQuery(dom.window.document, 'ha-sidebar'),
    config: api.normalizeConfig(rawConfig),
  });
}

test('Einstellungen bleiben unten, wenn settings_in_group aus ist', () => {
  const { dom, api } = loadApi();
  const sb = buildRealSidebar(dom, { badge: '2' });
  const c = realController(api, dom, { order: ['mein-zuhause'] });
  c.apply();
  assert.equal(sb.config.hasAttribute('data-es-hidden'), false);
  assert.equal(sb.root.querySelectorAll('[data-es-proxy]').length, 0);
  // die untere Liste behält ihre Reihenfolge, auch wenn eine eigene Reihenfolge gesetzt ist
  assert.equal(sb.config.style.order, '');
  assert.equal(sb.notifications.style.order, '');
  assert.equal(sb.profile.style.order, '');
  assert.equal(sb.root.querySelector('[data-es-header] .es-badge').textContent, '');
});

test('settings_in_group: Kopie in der Gruppe, Original ausgeblendet, Badge an der Kopfzeile', () => {
  const { dom, api } = loadApi();
  const sb = buildRealSidebar(dom, { badge: '2' });
  const c = realController(api, dom, { settings_in_group: true });
  c.apply();

  assert.equal(c.state.status, 'grouped');
  assert.equal(sb.config.hasAttribute('data-es-hidden'), true);
  const proxy = sb.slotMain.querySelector('[data-es-proxy="config"]');
  assert.ok(proxy);
  assert.equal(proxy.querySelector('[slot="headline"]').textContent, 'Einstellungen');
  assert.equal(proxy.id, '');
  assert.equal(proxy.hasAttribute('href'), false);
  assert.equal(proxy.querySelector('[data-es-badge]').textContent, '2');
  // die Zahl im Symbol-Slot der Originals wird nicht mitkopiert
  assert.equal(proxy.querySelectorAll('span[slot="start"]').length, 0);
  assert.equal(proxy.querySelectorAll('span').length, 2); // Beschriftung + Badge
  // Kopie steht als erster Eintrag direkt hinter der Kopfzeile (kleinste Ordnungszahl der Gruppe)
  assert.equal(proxy.style.order, '9001');
  assert.equal(sb.slotMain.querySelector('#sidebar-panel-hacs').style.order, '9002');
  // Kopfzeile zeigt die Zahl, solange zugeklappt
  assert.equal(sb.root.querySelector('[data-es-header] .es-badge').textContent, '2');
  // Benachrichtigungen und Profil bleiben unberührt
  assert.equal(sb.notifications.hasAttribute('data-es-hidden'), false);
  assert.equal(sb.profile.hasAttribute('data-es-hidden'), false);
});

test('Badge der Einstellungen wird nachgeführt und verschwindet wieder', () => {
  const { dom, api } = loadApi();
  const sb = buildRealSidebar(dom, { badge: '2' });
  const c = realController(api, dom, { settings_in_group: true });
  c.apply();
  sb.config.querySelector('[slot="end"]').textContent = '5';
  c.apply();
  assert.equal(sb.root.querySelector('[data-es-header] .es-badge').textContent, '5');
  assert.equal(sb.root.querySelector('[data-es-proxy] [data-es-badge]').textContent, '5');
  sb.config.querySelector('[slot="end"]').remove();
  c.apply();
  assert.equal(sb.root.querySelector('[data-es-header] .es-badge').textContent, '');
  assert.equal(sb.root.querySelector('[data-es-proxy] [data-es-badge]'), null);
});

test('Klick auf die Kopie von Einstellungen öffnet /config', () => {
  const { dom, api } = loadApi();
  const sb = buildRealSidebar(dom);
  const c = realController(api, dom, { settings_in_group: true });
  c.apply();
  const events = [];
  dom.window.addEventListener('location-changed', (ev) => events.push(ev));
  const proxy = sb.root.querySelector('[data-es-proxy="config"]');
  proxy.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(dom.window.location.pathname, '/config');
  assert.equal(events.length, 1);
});

test('Ohne Badge bleibt die Kopfzeile ohne Zahl; stop() entfernt Kopie und Markierungen', () => {
  const { dom, api } = loadApi();
  const sb = buildRealSidebar(dom);
  const c = realController(api, dom, { settings_in_group: true });
  c.start();
  assert.equal(sb.root.querySelector('[data-es-header] .es-badge').textContent, '');
  c.stop();
  assert.equal(sb.root.querySelectorAll('[data-es-proxy],[data-es-header],[data-es-hidden],[data-es-grouped]').length, 0);
  assert.equal(sb.config.hasAttribute('data-es-hidden'), false);
});

test('Wechsel auf /config klappt die Gruppe auf', () => {
  const { dom, api } = loadApi();
  buildRealSidebar(dom);
  dom.reconfigure({ url: 'http://localhost/config/dashboard' });
  const c = realController(api, dom, { settings_in_group: true });
  c.onLocation();
  c.apply();
  assert.equal(c.state.expanded, true);
});

/* ---------------------------------------------------------------------- *
 * group_style: popup
 * ---------------------------------------------------------------------- */

const POPUP = { group_style: 'popup', settings_in_group: true };

const key = (dom, el, k) => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true }));
const rowsOf = (dom) => Array.from(dom.window.document.querySelectorAll('[data-es-popup] a'));

test('normalizeConfig: group_style nur popup oder dropdown', () => {
  const { api } = loadApi();
  assert.equal(api.normalizeConfig(null).group_style, 'dropdown');
  assert.equal(api.normalizeConfig({ group_style: 'popup' }).group_style, 'popup');
  assert.equal(api.normalizeConfig({ group_style: 'quatsch' }).group_style, 'dropdown');
});

test('Popup: Admin-Button im unteren Bereich vor Benachrichtigungen, Einträge ausgeblendet, keine Kopien', () => {
  const { dom, api } = loadApi();
  const sb = buildRealSidebar(dom, { badge: '2' });
  const c = realController(api, dom, POPUP);
  c.apply();

  assert.equal(c.state.status, 'grouped');
  const header = sb.root.querySelector('[data-es-header]');
  assert.ok(header);
  assert.equal(header.parentElement, sb.slotBottom);
  assert.equal(header.nextElementSibling, sb.config); // Einstellungen ist (ausgeblendet) das erste Original
  assert.equal(header.hasAttribute('data-es-popup-btn'), true);
  assert.equal(header.getAttribute('aria-haspopup'), 'menu');
  assert.equal(header.querySelector('.es-chevron').getAttribute('icon'), 'mdi:chevron-right');
  // Gruppenmitglieder sind ausgeblendet, die normale Liste bleibt sichtbar
  for (const path of ['hacs', 'dienste-uebersicht']) {
    assert.equal(sb.slotMain.querySelector('#sidebar-panel-' + path).hasAttribute('data-es-hidden'), true, path);
  }
  assert.equal(sb.config.hasAttribute('data-es-hidden'), true);
  assert.equal(sb.notifications.hasAttribute('data-es-hidden'), false);
  assert.equal(sb.slotMain.querySelector('#sidebar-panel-mein-zuhause').hasAttribute('data-es-hidden'), false);
  assert.equal(sb.root.querySelectorAll('[data-es-proxy]').length, 0);
  // Zahl der offenen Einträge sitzt am Button, auch wenn nichts offen ist
  assert.equal(header.querySelector('.es-badge').textContent, '2');
  // kein Popup, solange nichts geklickt wurde
  assert.equal(rowsOf(dom).length, 0);
  // wiederholtes apply: genau ein Button, gleiche Position
  c.apply();
  c.apply();
  assert.equal(sb.root.querySelectorAll('[data-es-header]').length, 1);
});

test('Popup: Klick öffnet das Fenster im body, Einstellungen zuerst, aktuelle Seite markiert', () => {
  const { dom, api } = loadApi('http://ha.test/hacs');
  const sb = buildRealSidebar(dom, { badge: '2' });
  const c = realController(api, dom, POPUP);
  c.start();
  const header = sb.root.querySelector('[data-es-header]');
  header.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.equal(header.getAttribute('aria-expanded'), 'true');
  const popup = dom.window.document.querySelector('[data-es-popup]');
  assert.ok(popup);
  assert.equal(popup.parentElement, dom.window.document.body);
  assert.equal(popup.getAttribute('role'), 'menu');
  const rows = rowsOf(dom);
  assert.deepEqual(rows.map((r) => r.getAttribute('data-es-path')), ['config', 'hacs', 'dienste-uebersicht']);
  assert.deepEqual(rows.map((r) => r.querySelector('.es-label').textContent), ['Einstellungen', 'HACS', 'Dienste']);
  assert.equal(rows[0].getAttribute('href'), '/config');
  assert.equal(rows[0].querySelector('.es-badge').textContent, '2');
  assert.equal(rows[1].getAttribute('aria-current'), 'page');
  assert.equal(rows[0].hasAttribute('aria-current'), false);
  assert.ok(dom.window.document.querySelector('style[data-es-popup-style]'));
  c.stop();
});

test('Popup: Klick auf einen Eintrag navigiert und schließt, Strg-Klick bleibt ein normaler Link', () => {
  const { dom, api } = loadApi();
  const sb = buildRealSidebar(dom);
  const c = realController(api, dom, POPUP);
  c.start();
  const header = sb.root.querySelector('[data-es-header]');
  header.click();
  const events = [];
  dom.window.addEventListener('location-changed', (ev) => events.push(ev));

  rowsOf(dom)[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  assert.equal(dom.window.location.pathname, '/mein-zuhause');
  assert.equal(events.length, 0);
  assert.ok(dom.window.document.querySelector('[data-es-popup]'));

  rowsOf(dom)[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(dom.window.location.pathname, '/hacs');
  assert.equal(events.length, 1);
  assert.equal(dom.window.document.querySelector('[data-es-popup]'), null);
  assert.equal(header.getAttribute('aria-expanded'), 'false');
  c.stop();
});

test('Popup: schließt per Escape und bei Klick daneben, nicht bei Klick im Popup', () => {
  const { dom, api } = loadApi();
  const sb = buildRealSidebar(dom);
  const c = realController(api, dom, POPUP);
  c.start();
  const header = sb.root.querySelector('[data-es-header]');
  const doc = dom.window.document;
  const pointer = (el) => el.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, composed: true }));

  header.click();
  pointer(doc.querySelector('[data-es-popup]'));
  assert.ok(doc.querySelector('[data-es-popup]'), 'Klick im Popup lässt es offen');
  pointer(header);
  assert.ok(doc.querySelector('[data-es-popup]'), 'Klick auf den Button wird vom Button selbst behandelt');
  pointer(doc.body);
  assert.equal(doc.querySelector('[data-es-popup]'), null, 'Klick daneben schließt');

  header.click();
  key(dom, doc.querySelector('[data-es-popup] a'), 'Escape');
  assert.equal(doc.querySelector('[data-es-popup]'), null, 'Escape schließt');

  header.click();
  header.click();
  assert.equal(doc.querySelector('[data-es-popup]'), null, 'zweiter Klick auf den Button schließt');
  c.stop();
});

test('Popup: Tastatur öffnet mit Fokus auf dem ersten Eintrag, Pfeiltasten wandern, Navigation schließt', () => {
  const { dom, api } = loadApi();
  const sb = buildRealSidebar(dom);
  const c = realController(api, dom, POPUP);
  c.start();
  const header = sb.root.querySelector('[data-es-header]');
  const doc = dom.window.document;

  key(dom, header, 'Enter');
  let rows = rowsOf(dom);
  assert.equal(doc.activeElement, rows[0]);
  key(dom, rows[0], 'ArrowDown');
  assert.equal(doc.activeElement, rows[1]);
  key(dom, rows[1], 'ArrowUp');
  key(dom, rows[0], 'ArrowUp');
  assert.equal(doc.activeElement, rows[rows.length - 1], 'springt ans Ende');
  key(dom, rows[0], 'Home');
  assert.equal(doc.activeElement, rows[0]);
  key(dom, rows[0], 'End');
  assert.equal(doc.activeElement, rows[rows.length - 1]);

  // Seitenwechsel von außen schließt das Popup
  dom.window.history.pushState(null, '', '/heizung-uebersicht');
  dom.window.dispatchEvent(new dom.window.CustomEvent('location-changed'));
  assert.equal(doc.querySelector('[data-es-popup]'), null);
  c.stop();
});

test('Popup: Inhalt folgt dem Badge der Einstellungen, Fokus bleibt erhalten', () => {
  const { dom, api } = loadApi();
  const sb = buildRealSidebar(dom, { badge: '2' });
  const c = realController(api, dom, POPUP);
  c.start();
  const header = sb.root.querySelector('[data-es-header]');
  key(dom, header, 'Enter');
  const doc = dom.window.document;
  assert.equal(doc.activeElement.getAttribute('data-es-path'), 'config');

  sb.config.querySelector('[slot="end"]').textContent = '7';
  c.apply();
  assert.equal(rowsOf(dom)[0].querySelector('.es-badge').textContent, '7');
  assert.equal(doc.activeElement.getAttribute('data-es-path'), 'config', 'Fokus wandert nicht weg');
  assert.equal(header.querySelector('.es-badge').textContent, '7');

  sb.config.querySelector('[slot="end"]').remove();
  c.apply();
  assert.equal(rowsOf(dom)[0].querySelector('.es-badge'), null);
  c.stop();
});

test('Popup: schmale Ansicht wird zum Fenster am unteren Rand und schließt die Seitenleiste nach der Auswahl', () => {
  const { dom, api } = loadApi();
  dom.window.matchMedia = () => ({ matches: true });
  const sb = buildRealSidebar(dom);
  const c = realController(api, dom, POPUP);
  c.start();
  sb.root.querySelector('[data-es-header]').click();
  const popup = dom.window.document.querySelector('[data-es-popup]');
  assert.equal(popup.hasAttribute('data-es-sheet'), true);
  assert.equal(popup.style.left, '');

  const toggles = [];
  sb.root.host.addEventListener('hass-toggle-menu', (ev) => toggles.push(ev.detail.open));
  rowsOf(dom)[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(toggles, [false]);
  c.stop();
});

test('Popup: breite Ansicht sitzt rechts neben der Seitenleiste auf Höhe des Buttons', () => {
  const { dom, api } = loadApi();
  const sb = buildRealSidebar(dom);
  const sidebar = sb.root.host;
  sidebar.getBoundingClientRect = () => ({ left: 0, right: 256, top: 0, bottom: 800, width: 256, height: 800 });
  dom.window.innerHeight = 800;
  const c = realController(api, dom, POPUP);
  c.apply();
  sb.root.querySelector('[data-es-header]').getBoundingClientRect = () => ({ left: 0, right: 256, top: 640, bottom: 680, width: 256, height: 40 });
  sb.root.querySelector('[data-es-header]').click();
  const popup = dom.window.document.querySelector('[data-es-popup]');
  assert.equal(popup.hasAttribute('data-es-sheet'), false);
  assert.equal(popup.style.left, '264px');
  assert.equal(popup.style.bottom, '120px');
  assert.equal(popup.style.maxHeight, '672px');
  c.stop();
});

test('Popup: ohne Mitglieder kein Button; stop() räumt Popup, Stil und Button auf', () => {
  const { dom, api } = loadApi();
  const sb = buildRealSidebar(dom);
  const none = realController(api, dom, { group_style: 'popup', auto_detect_admin: false });
  none.apply();
  assert.equal(none.state.status, 'no-group');
  assert.equal(sb.root.querySelectorAll('[data-es-header]').length, 0);
  none.stop();

  const c = realController(api, dom, POPUP);
  c.start();
  sb.root.querySelector('[data-es-header]').click();
  assert.ok(dom.window.document.querySelector('[data-es-popup]'));
  c.stop();
  assert.equal(dom.window.document.querySelector('[data-es-popup]'), null);
  assert.equal(dom.window.document.querySelector('style[data-es-popup-style]'), null);
  assert.equal(sb.root.querySelectorAll('[data-es-header],[data-es-hidden],[data-es-grouped]').length, 0);
  assert.equal(sb.config.hasAttribute('data-es-hidden'), false);
});

test('Popup: ohne untere Liste steht der Button am Ende der Hauptliste', () => {
  const { dom, api } = loadApi();
  const doc = dom.window.document;
  const sb = buildSidebar(dom, ['/mein-zuhause', '/hacs', '/dienste-uebersicht'], { bottom: [] });
  const c = makeController(api, dom, sb, PANELS, { group_style: 'popup' });
  c.apply();
  const header = sb.root.querySelector('[data-es-header]');
  assert.equal(header.parentElement, sb.list);
  assert.equal(header.nextElementSibling, null);
  assert.equal(sb.list.hasAttribute('data-es-list'), true);
  assert.equal(doc.querySelector('[data-es-popup]'), null);
});

test('Dropdown bleibt Standard: kein Popup-Stil, Chevron zeigt nach unten', () => {
  const { dom, api } = loadApi();
  const sb = buildRealSidebar(dom);
  const c = realController(api, dom, { settings_in_group: true });
  c.start();
  const header = sb.root.querySelector('[data-es-header]');
  assert.equal(header.hasAttribute('data-es-popup-btn'), false);
  assert.equal(header.querySelector('.es-chevron').getAttribute('icon'), 'mdi:chevron-down');
  header.click();
  assert.equal(dom.window.document.querySelector('[data-es-popup]'), null);
  assert.equal(dom.window.document.querySelector('style[data-es-popup-style]'), null);
  c.stop();
});
