/*
 * Enhanced Sidebar
 * https://github.com/dominikramachers/HA-Enhanced-Sidebar
 *
 * Sortiert Admin-Panels in eine einklappbare Gruppe der Home-Assistant-Seitenleiste.
 *
 * Vorgehen: Die Einträge der Seitenleiste werden nicht verschoben oder neu gebaut.
 * Das Script setzt nur Attribute und CSS-"order" auf die vorhandenen Elemente und
 * fügt eine Kopfzeile ein. Dadurch bleibt die Seitenleiste von Home Assistant
 * (Lit) unangetastet. Erkennt das Script den Aufbau nicht, passiert nichts.
 *
 * Abschalten für einen Seitenaufruf: ?es=0 an die Adresse hängen.
 * Diagnose in der Browser-Konsole: enhancedSidebarDebug()
 */
(() => {
  'use strict';

  const LOG = '[enhanced-sidebar]';

  const ORDER_UNLISTED = 500;
  const ORDER_HEADER = 9000;
  const ORDER_GROUPED = 9001;

  const DEFAULTS = {
    group_name: 'Admin',
    group_icon: 'mdi:shield-account-outline',
    auto_detect_admin: true,
    include: [],
    exclude: ['config', 'developer-tools', 'profile'],
    hidden: [],
    order: [],
    auto_collapse: true,
  };

  /* ------------------------------------------------------------------ *
   * Reine Logik (ohne DOM)
   * ------------------------------------------------------------------ */

  const cleanPath = (value) => String(value).trim().replace(/^\/+|\/+$/g, '');

  const toList = (value) => {
    if (typeof value === 'string') value = value.split(/[\n,]/);
    return Array.isArray(value) ? value.map(cleanPath).filter(Boolean) : [];
  };

  function normalizeConfig(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const pick = (key) => (r[key] === undefined || r[key] === null ? DEFAULTS[key] : r[key]);
    return {
      group_name: String(pick('group_name')).trim() || DEFAULTS.group_name,
      group_icon: String(pick('group_icon')).trim() || DEFAULTS.group_icon,
      auto_detect_admin: pick('auto_detect_admin') !== false,
      include: toList(pick('include')),
      exclude: toList(pick('exclude')),
      hidden: toList(pick('hidden')),
      order: toList(pick('order')),
      auto_collapse: pick('auto_collapse') !== false,
    };
  }

  /** Erstes Pfadsegment einer Adresse = url_path des Panels ("/lovelace/0" -> "lovelace"). */
  function panelFromHref(href) {
    if (!href) return null;
    let path = String(href).trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
      try {
        const url = new URL(path, location.href);
        if (url.origin !== location.origin) return null;
        path = url.pathname;
      } catch (err) {
        return null;
      }
    }
    path = path.split(/[?#]/)[0];
    const segment = path.split('/').filter(Boolean)[0];
    if (!segment) return null;
    try {
      return decodeURIComponent(segment);
    } catch (err) {
      return segment;
    }
  }

  /** Entscheidet für ein Panel: ausblenden, in die Gruppe, Position. */
  function classify(path, panels, cfg) {
    const hidden = cfg.hidden.includes(path);
    let grouped = false;
    if (!hidden) {
      const panel = panels && Object.prototype.hasOwnProperty.call(panels, path) ? panels[path] : null;
      const admin = cfg.auto_detect_admin && !!panel && panel.require_admin === true;
      grouped = cfg.include.includes(path) || (admin && !cfg.exclude.includes(path));
    }
    const rank = cfg.order.indexOf(path);
    return { hidden, grouped, rank: rank < 0 ? null : rank };
  }

  /* ------------------------------------------------------------------ *
   * DOM-Helfer
   * ------------------------------------------------------------------ */

  /** Sucht ein Element über alle Shadow-Roots hinweg (Breitensuche). */
  function deepQuery(start, selector) {
    const queue = [start];
    while (queue.length) {
      const node = queue.shift();
      let hit = null;
      try {
        hit = node.querySelector(selector);
      } catch (err) {
        hit = null;
      }
      if (hit) return hit;
      let all = [];
      try {
        all = node.querySelectorAll('*');
      } catch (err) {
        all = [];
      }
      for (const el of all) if (el.shadowRoot) queue.push(el.shadowRoot);
    }
    return null;
  }

  const ID_PREFIX = 'sidebar-panel-';

  /**
   * Panel eines Eintrags. Ältere Seitenleisten tragen ein href am Eintrag selbst. Neuere
   * (ha-list-item-button) haben die ID "sidebar-panel-<url_path>" und den Link im eigenen Shadow-Root.
   */
  function panelOfItem(el) {
    const href = el.getAttribute('href');
    if (href) return panelFromHref(href);
    const id = el.id || '';
    if (id.startsWith(ID_PREFIX) && id.length > ID_PREFIX.length) return id.slice(ID_PREFIX.length);
    const link = el.shadowRoot && el.shadowRoot.querySelector('a[href]');
    return link ? panelFromHref(link.getAttribute('href')) : null;
  }

  /** Alle Panel-Einträge der Seitenleiste (äußerstes Element, dessen Ziel ein Panel ist). */
  function collectItems(root, panels) {
    const found = Array.from(root.querySelectorAll('[href], [id^="' + ID_PREFIX + '"]'));
    const set = new Set(found);
    const items = [];
    for (const el of found) {
      let ancestor = el.parentElement;
      let nested = false;
      while (ancestor) {
        if (set.has(ancestor)) {
          nested = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (nested) continue;
      const path = panelOfItem(el);
      if (!path || !panels || !Object.prototype.hasOwnProperty.call(panels, path)) continue;
      items.push({ el, path });
    }
    return items;
  }

  const setAttr = (el, name, value) => {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  };
  const clearAttr = (el, name) => {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  };
  const setFlag = (el, name, on) => (on ? setAttr(el, name, '') : clearAttr(el, name));

  const CSS = `
[data-es-list]{display:flex;flex-direction:column}
[data-es-hidden]{display:none !important}
[data-es-list][data-es-collapsed]>[data-es-grouped]{display:none !important}
[data-es-grouped]{margin-inline-start:12px}
[data-es-compact]>[data-es-grouped]{margin-inline-start:0}
[data-es-header]{
  order:${ORDER_HEADER};box-sizing:border-box;display:flex;align-items:center;gap:16px;
  height:44px;min-height:44px;margin:0 4px;padding:0 12px;border-radius:6px;cursor:pointer;
  user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;
  color:var(--sidebar-text-color,var(--primary-text-color));
  font-family:var(--ha-font-family-body,var(--paper-font-body1_-_font-family,Roboto,sans-serif));
  font-size:var(--ha-font-size-m,14px);font-weight:var(--ha-font-weight-medium,500);line-height:20px;
}
[data-es-header]:hover{background:color-mix(in srgb,var(--sidebar-text-color,var(--primary-text-color)) 8%,transparent)}
[data-es-header]:focus-visible{outline:2px solid var(--primary-color);outline-offset:-2px}
[data-es-header] ha-icon{--mdc-icon-size:24px;flex:none;color:var(--sidebar-icon-color,var(--secondary-text-color))}
[data-es-header] .es-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-es-header] .es-chevron{transition:transform .2s ease}
[data-es-header][aria-expanded="true"] .es-chevron{transform:rotate(180deg)}
[data-es-compact]>[data-es-header]{justify-content:center;padding:0}
[data-es-compact]>[data-es-header] .es-label,[data-es-compact]>[data-es-header] .es-chevron{display:none}
@media (pointer:coarse){[data-es-header]{height:48px;min-height:48px}}
@media (prefers-reduced-motion:reduce){[data-es-header] .es-chevron{transition:none}}
`;

  function ensureStyle(root) {
    try {
      if ('adoptedStyleSheets' in root && typeof CSSStyleSheet === 'function') {
        const current = Array.from(root.adoptedStyleSheets);
        if (root.__esSheet && current.includes(root.__esSheet)) return;
        const sheet = root.__esSheet || new CSSStyleSheet();
        if (!root.__esSheet) sheet.replaceSync(CSS);
        root.__esSheet = sheet;
        root.adoptedStyleSheets = [...current, sheet];
        return;
      }
    } catch (err) {
      /* weiter mit <style> */
    }
    if (root.__esStyleEl && root.__esStyleEl.isConnected) return;
    const style = document.createElement('style');
    style.setAttribute('data-es-style', '');
    style.textContent = CSS;
    root.appendChild(style);
    root.__esStyleEl = style;
  }

  function buildHeader(cfg, onToggle) {
    const header = document.createElement('div');
    header.setAttribute('data-es-header', '');
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');

    const icon = document.createElement('ha-icon');
    icon.setAttribute('icon', cfg.group_icon);
    const label = document.createElement('span');
    label.className = 'es-label';
    label.textContent = cfg.group_name;
    const chevron = document.createElement('ha-icon');
    chevron.className = 'es-chevron';
    chevron.setAttribute('icon', 'mdi:chevron-down');
    header.append(icon, label, chevron);

    header.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onToggle();
    });
    header.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        onToggle();
      }
    });
    return header;
  }

  /* ------------------------------------------------------------------ *
   * Steuerung
   * ------------------------------------------------------------------ */

  function createController({ getHass, findSidebar, config }) {
    const cfg = config;
    const state = {
      expanded: !cfg.auto_collapse,
      sidebar: null,
      header: null,
      observer: null,
      resize: null,
      timer: null,
      tick: null,
      lastPath: undefined,
      applying: false,
      status: 'init',
      lastItems: [],
    };

    const OBSERVE = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'hidden', 'class', 'selected'],
    };

    function observe() {
      if (state.observer && state.sidebar && state.sidebar.shadowRoot) {
        state.observer.observe(state.sidebar.shadowRoot, OBSERVE);
      }
    }

    function schedule() {
      if (state.timer) return;
      state.timer = setTimeout(() => {
        state.timer = null;
        apply();
      }, 30);
    }

    function bindSidebar() {
      if (state.sidebar && state.sidebar.isConnected) return state.sidebar;
      const el = findSidebar();
      if (!el || !el.shadowRoot) {
        state.sidebar = null;
        return null;
      }
      if (state.observer) state.observer.disconnect();
      if (state.resize) state.resize.disconnect();
      state.sidebar = el;
      state.header = null;
      if (typeof MutationObserver === 'function') {
        state.observer = state.observer || new MutationObserver(() => schedule());
      }
      if (typeof ResizeObserver === 'function') {
        state.resize = state.resize || new ResizeObserver(() => schedule());
        state.resize.observe(el);
      }
      return el;
    }

    function removeHeader() {
      if (state.header && state.header.parentElement) state.header.remove();
      state.header = null;
    }

    function cleanup(root) {
      removeHeader();
      for (const el of root.querySelectorAll('[data-es-path],[data-es-list],[data-es-header]')) {
        if (el.hasAttribute('data-es-header')) {
          el.remove();
          continue;
        }
        clearAttr(el, 'data-es-path');
        clearAttr(el, 'data-es-grouped');
        clearAttr(el, 'data-es-hidden');
        clearAttr(el, 'data-es-list');
        clearAttr(el, 'data-es-collapsed');
        clearAttr(el, 'data-es-compact');
        el.style.removeProperty('order');
      }
    }

    function toggle() {
      state.expanded = !state.expanded;
      apply();
    }

    function apply() {
      if (state.applying) return;
      const hass = getHass();
      const sidebar = bindSidebar();
      if (!hass || !hass.panels || !sidebar) {
        state.status = 'waiting';
        return;
      }
      const root = sidebar.shadowRoot;
      state.applying = true;
      if (state.observer) state.observer.disconnect();
      try {
        ensureStyle(root);
        const items = collectItems(root, hass.panels);
        if (!items.length) {
          cleanup(root);
          state.status = 'no-items';
          state.lastItems = [];
          return;
        }

        const decisions = items.map((item) => ({ ...item, ...classify(item.path, hass.panels, cfg) }));

        // Alle gruppierten Einträge müssen in derselben Liste stehen: die mit den meisten gewinnt.
        const counts = new Map();
        for (const d of decisions) {
          if (d.grouped) counts.set(d.el.parentElement, (counts.get(d.el.parentElement) || 0) + 1);
        }
        let groupParent = null;
        let best = 0;
        for (const [parent, count] of counts) {
          if (count > best) {
            groupParent = parent;
            best = count;
          }
        }
        for (const d of decisions) {
          if (d.grouped && d.el.parentElement !== groupParent) d.grouped = false;
        }

        const orderedParents = new Set();
        let firstGrouped = null;
        for (const d of decisions) {
          let order = null;
          if (d.grouped) order = ORDER_GROUPED + (d.rank === null ? 0 : d.rank);
          else if (d.rank !== null) order = d.rank;
          else if (cfg.order.length) order = ORDER_UNLISTED;

          setAttr(d.el, 'data-es-path', d.path);
          setFlag(d.el, 'data-es-grouped', d.grouped);
          setFlag(d.el, 'data-es-hidden', d.hidden);
          if (order === null) {
            if (d.el.style.order) d.el.style.removeProperty('order');
          } else if (d.el.style.order !== String(order)) {
            d.el.style.order = String(order);
          }
          if (order !== null && d.el.parentElement) orderedParents.add(d.el.parentElement);
          if (d.grouped && !firstGrouped) firstGrouped = d.el;
        }

        // Listen markieren, die per "order" sortiert werden (alle anderen bleiben unberührt).
        const parents = new Set(decisions.map((d) => d.el.parentElement).filter(Boolean));
        for (const parent of parents) setFlag(parent, 'data-es-list', orderedParents.has(parent));

        if (groupParent && firstGrouped) {
          if (!state.header) state.header = buildHeader(cfg, toggle);
          if (state.header.parentElement !== groupParent || state.header.nextElementSibling !== firstGrouped) {
            groupParent.insertBefore(state.header, firstGrouped);
          }
          setAttr(state.header, 'aria-expanded', state.expanded ? 'true' : 'false');
          setFlag(groupParent, 'data-es-collapsed', !state.expanded);
          const width = sidebar.getBoundingClientRect ? sidebar.getBoundingClientRect().width : 0;
          setFlag(groupParent, 'data-es-compact', width > 0 && width < 120);
        } else {
          removeHeader();
        }
        for (const parent of parents) {
          if (parent !== groupParent) {
            clearAttr(parent, 'data-es-collapsed');
            clearAttr(parent, 'data-es-compact');
          }
        }

        state.lastItems = decisions;
        state.status = groupParent ? 'grouped' : 'no-group';
      } catch (err) {
        state.status = 'error';
        console.warn(LOG, 'Seitenleiste konnte nicht angepasst werden', err);
      } finally {
        state.applying = false;
        observe();
      }
    }

    function onLocation() {
      const hass = getHass();
      const path = panelFromHref(location.pathname);
      const inGroup = !!(path && classify(path, hass && hass.panels, cfg).grouped);
      if (inGroup) {
        state.expanded = true;
      } else if (cfg.auto_collapse && state.lastPath !== undefined && state.lastPath !== path) {
        state.expanded = false;
      }
      state.lastPath = path;
      schedule();
    }

    function start() {
      window.addEventListener('location-changed', onLocation);
      window.addEventListener('popstate', onLocation);
      onLocation();
      apply();
      // Die Seitenleiste kann neu aufgebaut werden (z. B. beim Wechsel Handy/Desktop).
      state.tick = setInterval(apply, 2000);
    }

    function stop() {
      window.removeEventListener('location-changed', onLocation);
      window.removeEventListener('popstate', onLocation);
      if (state.tick) clearInterval(state.tick);
      if (state.timer) clearTimeout(state.timer);
      state.tick = null;
      state.timer = null;
      if (state.observer) state.observer.disconnect();
      if (state.resize) state.resize.disconnect();
      if (state.sidebar && state.sidebar.shadowRoot) cleanup(state.sidebar.shadowRoot);
    }

    function debug() {
      const hass = getHass();
      const panels = (hass && hass.panels) || {};
      return {
        status: state.status,
        expanded: state.expanded,
        config: cfg,
        user: hass && hass.user ? { name: hass.user.name, is_admin: hass.user.is_admin } : null,
        sidebarFound: !!state.sidebar,
        items: state.lastItems.map((d) => ({
          path: d.path,
          grouped: d.grouped,
          hidden: d.hidden,
          parent: d.el.parentElement ? d.el.parentElement.tagName.toLowerCase() : null,
          tag: d.el.tagName.toLowerCase(),
        })),
        panelsAdminFlag: Object.fromEntries(
          Object.entries(panels).map(([key, panel]) => [key, panel && panel.require_admin])
        ),
      };
    }

    return { start, stop, apply, toggle, onLocation, debug, state };
  }

  /* ------------------------------------------------------------------ *
   * Start
   * ------------------------------------------------------------------ */

  const api = { normalizeConfig, panelFromHref, classify, collectItems, deepQuery, createController, DEFAULTS };

  if (globalThis.__ENHANCED_SIDEBAR_TEST__) {
    globalThis.__ENHANCED_SIDEBAR_TEST__.api = api;
    return;
  }

  async function waitFor(fn, timeout, interval = 250) {
    const end = Date.now() + timeout;
    for (;;) {
      let value = null;
      try {
        value = fn();
      } catch (err) {
        value = null;
      }
      if (value) return value;
      if (Date.now() >= end) return null;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  async function boot() {
    if (new URLSearchParams(location.search).get('es') === '0') {
      console.info(LOG, 'per ?es=0 abgeschaltet');
      return;
    }
    const ha = await waitFor(() => document.querySelector('home-assistant'), 30000);
    if (!ha) return;
    const ready = await waitFor(
      () => ha.hass && ha.hass.user && ha.hass.panels && typeof ha.hass.callWS === 'function',
      60000
    );
    if (!ready) return;

    let raw = null;
    try {
      raw = await ha.hass.callWS({ type: 'enhanced_sidebar/config' });
    } catch (err) {
      console.warn(LOG, 'Einstellungen nicht verfügbar, Standardwerte werden genutzt', err);
    }

    const controller = createController({
      getHass: () => ha.hass,
      findSidebar: () => deepQuery(document, 'ha-sidebar'),
      config: normalizeConfig(raw),
    });
    controller.start();
    window.enhancedSidebarDebug = () => controller.debug();
    console.info(LOG, 'aktiv');
  }

  boot().catch((err) => console.warn(LOG, 'Start fehlgeschlagen', err));
})();
