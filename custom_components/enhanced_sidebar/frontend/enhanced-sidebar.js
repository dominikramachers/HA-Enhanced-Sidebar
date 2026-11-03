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
  const ORDER_PROXY = 9001;
  const ORDER_GROUPED = 9002;

  const DEFAULTS = {
    group_name: 'Admin',
    group_icon: 'mdi:shield-account-outline',
    auto_detect_admin: true,
    include: [],
    exclude: ['config', 'developer-tools', 'profile'],
    hidden: [],
    order: [],
    auto_collapse: true,
    settings_in_group: false,
    group_style: 'dropdown',
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
    const include = toList(pick('include'));
    // "Einstellungen in die Gruppe" ist die Kurzform für "config" unter "Zusätzlich in die Gruppe"
    if (pick('settings_in_group') === true && !include.includes('config')) include.push('config');
    return {
      group_name: String(pick('group_name')).trim() || DEFAULTS.group_name,
      group_icon: String(pick('group_icon')).trim() || DEFAULTS.group_icon,
      auto_detect_admin: pick('auto_detect_admin') !== false,
      include,
      exclude: toList(pick('exclude')),
      hidden: toList(pick('hidden')),
      order: toList(pick('order')),
      auto_collapse: pick('auto_collapse') !== false,
      group_style: pick('group_style') === 'popup' ? 'popup' : 'dropdown',
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

  /** Zahl im Badge eines Eintrags (offene Updates/Reparaturen an "Einstellungen"), sonst "". */
  function badgeText(el) {
    const candidates = Array.from(el.querySelectorAll('.badge, .notification-badge, [slot="end"]'));
    for (const child of Array.from(el.children)) {
      const slot = child.getAttribute('slot');
      if (slot !== 'start' && slot !== 'headline' && !candidates.includes(child)) candidates.push(child);
    }
    for (const node of candidates) {
      if (node.hasAttribute('data-es-badge')) continue;
      const text = (node.textContent || '').trim();
      if (/^\d+\+?$/.test(text)) return text;
    }
    return '';
  }

  /** Öffnet ein Panel wie ein Link von Home Assistant (ohne Neuladen der Seite). */
  function navigate(path) {
    history.pushState(null, '', '/' + path);
    window.dispatchEvent(new CustomEvent('location-changed', { bubbles: true, composed: true, detail: { replace: false } }));
  }

  /** Schmale Ansicht (Handy/App): Seitenleiste ist ein Overlay, das Popup wird zum Fenster am unteren Rand. */
  const isNarrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 870px)').matches;

  /** Beschriftung eines Eintrags der Seitenleiste. */
  function labelOfItem(el, panels, path) {
    const headline = el.querySelector('[slot="headline"]');
    const text = headline ? (headline.textContent || '').trim() : '';
    if (text) return text;
    const panel = panels && panels[path];
    return (panel && panel.title) || path;
  }

  /** Symbol eines Eintrags als neues Element (für das Popup). */
  function makeIcon(orig, path, panels) {
    const src = orig.querySelector('[slot="start"]:not(span)') || orig.querySelector('ha-svg-icon, ha-icon');
    let icon;
    if (src && src.localName === 'ha-svg-icon') {
      icon = document.createElement('ha-svg-icon');
      if (src.path) icon.path = src.path;
    } else {
      icon = document.createElement('ha-icon');
      const panel = panels && panels[path];
      const name = (src && (src.icon || src.getAttribute('icon'))) || (panel && panel.icon) || 'mdi:view-dashboard';
      icon.setAttribute('icon', name);
    }
    icon.className = 'es-icon';
    return icon;
  }

  /**
   * Eintrag aus einer anderen Liste (z. B. "Einstellungen" im unteren Bereich) in der Gruppe:
   * Der Original-Eintrag bleibt an seinem Platz (nur ausgeblendet), in der Gruppe steht eine Kopie
   * mit Symbol und Beschriftung. Ein Klick öffnet dieselbe Seite wie ein Link von Home Assistant.
   */
  function buildProxy(orig, path) {
    const proxy = orig.cloneNode(true);
    for (const attr of Array.from(proxy.attributes)) {
      if (attr.name === 'id' || attr.name === 'href' || attr.name.startsWith('data-es-')) proxy.removeAttribute(attr.name);
    }
    // Nur Symbol und Beschriftung übernehmen; Zahlen (Badge, auch im Symbol-Slot der schmalen Leiste) setzt syncProxy
    for (const child of Array.from(proxy.children)) {
      const slot = child.getAttribute('slot');
      const isBadge = /^\d+\+?$/.test((child.textContent || '').trim());
      if ((slot !== 'start' && slot !== 'headline') || isBadge) child.remove();
    }
    // Symbole bekommen ihr Bild über eine Eigenschaft, die cloneNode nicht mitnimmt
    const icon = orig.querySelector('[slot="start"]:not(span)') || orig.querySelector('ha-svg-icon');
    const iconCopy = proxy.querySelector('[slot="start"]:not(span)') || proxy.querySelector('ha-svg-icon');
    if (icon && iconCopy && 'path' in icon && icon.path) iconCopy.path = icon.path;
    proxy.setAttribute('data-es-proxy', path);
    proxy.setAttribute('role', 'listitem');
    proxy.setAttribute('tabindex', '0');
    const go = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      navigate(path);
    };
    proxy.addEventListener('click', go);
    proxy.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') go(ev);
    });
    return proxy;
  }

  /** Zustand (ausgewählt, Badge) des Originals auf die Kopie übertragen. */
  function syncProxy(orig, proxy) {
    const cls = orig.className || '';
    if (proxy.className !== cls) proxy.className = cls;
    for (const name of ['selected', 'active', 'aria-current']) {
      const value = orig.getAttribute(name);
      if (value === null) clearAttr(proxy, name);
      else setAttr(proxy, name, value);
    }
    const text = badgeText(orig);
    let badge = proxy.querySelector('[data-es-badge]');
    if (!text) {
      if (badge) badge.remove();
    } else {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'es-badge';
        badge.setAttribute('slot', 'end');
        badge.setAttribute('data-es-badge', '');
        proxy.append(badge);
      }
      if (badge.textContent !== text) badge.textContent = text;
    }
    return text;
  }

  const setAttr = (el, name, value) => {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  };
  const clearAttr = (el, name) => {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  };
  const setFlag = (el, name, on) => (on ? setAttr(el, name, '') : clearAttr(el, name));

  const BADGE_CSS = `.es-badge{
  box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex:none;
  min-width:20px;height:20px;padding:0 6px;border-radius:10px;
  background:var(--accent-color,#ff9800);color:var(--text-accent-color,var(--text-primary-color,#fff));
  font-size:12px;font-weight:500;line-height:20px;
}`;

  const CSS = `
[data-es-list]{display:flex;flex-direction:column}
[data-es-hidden]{display:none !important}
[data-es-list][data-es-collapsed]>[data-es-grouped]{display:none !important}
[data-es-grouped]{margin-inline-start:12px}
[data-es-compact]>[data-es-grouped]{margin-inline-start:0}
[data-es-header]{
  order:${ORDER_HEADER};box-sizing:border-box;display:flex;align-items:center;gap:16px;
  height:44px;min-height:44px;margin:0 4px 4px;padding:0 12px;border-radius:6px;cursor:pointer;
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
${BADGE_CSS}
[data-es-header]{position:relative}
[data-es-header] .es-badge{margin-inline-start:auto}
[data-es-header][aria-expanded="true"] .es-badge,[data-es-header] .es-badge:empty{display:none}
[data-es-proxy]{cursor:pointer}
[data-es-compact]>[data-es-header]{justify-content:center;padding:0}
[data-es-compact]>[data-es-header] .es-label,[data-es-compact]>[data-es-header] .es-chevron{display:none}
[data-es-compact]>[data-es-header] .es-badge{position:absolute;top:2px;right:6px;min-width:16px;height:16px;padding:0 4px;font-size:10px;line-height:16px}
@media (pointer:coarse){[data-es-header]{height:48px;min-height:48px}}
@media (prefers-reduced-motion:reduce){[data-es-header] .es-chevron{transition:none}}
[data-es-header][data-es-popup-btn]{height:40px;min-height:40px}
@media (pointer:coarse){[data-es-header][data-es-popup-btn]{height:44px;min-height:44px}}
[data-es-header][data-es-popup-btn] .es-chevron{transform:none;opacity:.7}
[data-es-header][data-es-popup-btn][aria-expanded="true"]{background:color-mix(in srgb,var(--sidebar-text-color,var(--primary-text-color)) 8%,transparent)}
[data-es-header][data-es-popup-btn][aria-expanded="true"] .es-badge:not(:empty){display:inline-flex}
`;

  // Das Popup liegt direkt im <body> (nicht im Shadow-Root der Seitenleiste), damit es nie abgeschnitten wird.
  const POPUP_CSS = `
[data-es-popup]{
  position:fixed;z-index:1000;box-sizing:border-box;min-width:220px;max-width:min(320px,calc(100vw - 16px));
  overflow-y:auto;padding:6px;border-radius:12px;
  background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color,#212121);
  border:1px solid var(--divider-color,rgba(127,127,127,.3));box-shadow:0 8px 28px rgba(0,0,0,.35);
  font-family:var(--ha-font-family-body,var(--paper-font-body1_-_font-family,Roboto,sans-serif));
  font-size:var(--ha-font-size-m,14px);animation:es-pop .12s ease-out;
}
[data-es-popup][data-es-sheet]{left:8px;right:8px;max-width:none;bottom:calc(8px + env(safe-area-inset-bottom,0px))}
[data-es-popup] a{
  display:flex;align-items:center;gap:16px;box-sizing:border-box;height:44px;padding:0 12px;border-radius:8px;
  color:inherit;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent;
  font-weight:var(--ha-font-weight-medium,500);line-height:20px;
}
[data-es-popup][data-es-sheet] a{height:52px}
[data-es-popup] a:hover{background:color-mix(in srgb,var(--primary-text-color,#212121) 8%,transparent)}
[data-es-popup] a:focus-visible{outline:2px solid var(--primary-color,#03a9f4);outline-offset:-2px;background:color-mix(in srgb,var(--primary-text-color,#212121) 8%,transparent)}
[data-es-popup] a[aria-current="page"]{color:var(--primary-color,#03a9f4);background:color-mix(in srgb,var(--primary-color,#03a9f4) 12%,transparent)}
[data-es-popup] a[aria-current="page"] .es-icon{color:var(--primary-color,#03a9f4)}
[data-es-popup] .es-icon{--mdc-icon-size:24px;flex:none;display:inline-flex;color:var(--secondary-text-color,#727272)}
[data-es-popup] .es-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${BADGE_CSS}
@keyframes es-pop{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){[data-es-popup]{animation:none}}
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
    const popup = cfg.group_style === 'popup';
    if (popup) {
      header.setAttribute('data-es-popup-btn', '');
      header.setAttribute('aria-haspopup', 'menu');
    }

    const icon = document.createElement('ha-icon');
    icon.setAttribute('icon', cfg.group_icon);
    const label = document.createElement('span');
    label.className = 'es-label';
    label.textContent = cfg.group_name;
    const chevron = document.createElement('ha-icon');
    chevron.className = 'es-chevron';
    chevron.setAttribute('icon', popup ? 'mdi:chevron-right' : 'mdi:chevron-down');
    const badge = document.createElement('span');
    badge.className = 'es-badge';
    header.append(icon, label, badge, chevron);

    header.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onToggle(false);
    });
    header.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        onToggle(true);
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
      proxies: new Map(),
      // Popup-Darstellung
      open: false,
      popupEl: null,
      popupSig: '',
      members: [],
    };
    const popupMode = cfg.group_style === 'popup';

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

    /* ---- Popup (group_style: popup) ---- */

    function ensurePopupStyle() {
      if (document.querySelector('style[data-es-popup-style]')) return;
      const style = document.createElement('style');
      style.setAttribute('data-es-popup-style', '');
      style.textContent = POPUP_CSS;
      (document.head || document.documentElement).appendChild(style);
    }

    function buildRow(member) {
      const row = document.createElement('a');
      row.setAttribute('href', '/' + member.path);
      row.setAttribute('role', 'menuitem');
      row.setAttribute('data-es-path', member.path);
      if (member.selected) row.setAttribute('aria-current', 'page');
      const label = document.createElement('span');
      label.className = 'es-label';
      label.textContent = member.label;
      row.append(member.makeIcon(), label);
      if (member.badge) {
        const badge = document.createElement('span');
        badge.className = 'es-badge';
        badge.textContent = member.badge;
        row.append(badge);
      }
      row.addEventListener('click', (ev) => {
        // Mit Strg/Cmd/Shift oder Mittelklick bleibt es ein normaler Link (neuer Tab)
        if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
        closePopup(false);
        navigate(member.path);
        if (isNarrow() && state.sidebar) {
          // In der schmalen Ansicht ist die Seitenleiste ein Overlay: nach der Auswahl schließen
          state.sidebar.dispatchEvent(
            new CustomEvent('hass-toggle-menu', { bubbles: true, composed: true, detail: { open: false } })
          );
        }
      });
      return row;
    }

    function placePopup() {
      const el = state.popupEl;
      const header = state.header;
      if (!el || !header) return;
      const narrow = isNarrow();
      setFlag(el, 'data-es-sheet', narrow);
      if (narrow) {
        el.style.removeProperty('left');
        el.style.removeProperty('bottom');
        el.style.maxHeight = Math.round(window.innerHeight * 0.7) + 'px';
        return;
      }
      const headerRect = header.getBoundingClientRect();
      const sidebarRect = state.sidebar ? state.sidebar.getBoundingClientRect() : headerRect;
      const bottom = Math.max(8, Math.round(window.innerHeight - headerRect.bottom));
      el.style.left = Math.round(sidebarRect.right + 8) + 'px';
      el.style.bottom = bottom + 'px';
      el.style.maxHeight = Math.max(120, window.innerHeight - bottom - 8) + 'px';
    }

    function renderPopup() {
      if (!state.open) return;
      if (!state.members.length) {
        closePopup(false);
        return;
      }
      const sig = JSON.stringify(state.members.map((m) => [m.path, m.label, m.badge, m.selected]));
      if (!state.popupEl) {
        const el = document.createElement('div');
        el.setAttribute('data-es-popup', '');
        el.setAttribute('role', 'menu');
        el.setAttribute('aria-label', cfg.group_name);
        document.body.append(el);
        state.popupEl = el;
        state.popupSig = '';
      }
      if (sig !== state.popupSig) {
        const active = document.activeElement && document.activeElement.getAttribute
          ? document.activeElement.getAttribute('data-es-path')
          : null;
        const inPopup = !!(active && state.popupEl.contains(document.activeElement));
        state.popupEl.replaceChildren(...state.members.map(buildRow));
        state.popupSig = sig;
        if (inPopup) {
          const again = Array.from(state.popupEl.children).find((row) => row.getAttribute('data-es-path') === active);
          if (again) again.focus();
        }
      }
      placePopup();
    }

    function onDocPointer(ev) {
      const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
      if ((state.popupEl && path.includes(state.popupEl)) || (state.header && path.includes(state.header))) return;
      closePopup(false);
    }

    function onDocKey(ev) {
      if (!state.popupEl) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closePopup(true);
        return;
      }
      if (ev.key === 'Tab') {
        closePopup(false);
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)) return;
      const rows = Array.from(state.popupEl.children);
      if (!rows.length) return;
      ev.preventDefault();
      const index = rows.indexOf(document.activeElement);
      let next;
      if (ev.key === 'Home') next = 0;
      else if (ev.key === 'End') next = rows.length - 1;
      else if (ev.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % rows.length;
      else next = index < 0 ? rows.length - 1 : (index - 1 + rows.length) % rows.length;
      rows[next].focus();
    }

    function openPopup(viaKeyboard) {
      if (state.open || !state.members.length) return;
      state.open = true;
      ensurePopupStyle();
      document.addEventListener('pointerdown', onDocPointer, true);
      document.addEventListener('keydown', onDocKey, true);
      if (state.header) setAttr(state.header, 'aria-expanded', 'true');
      renderPopup();
      if (viaKeyboard && state.popupEl && state.popupEl.firstElementChild) state.popupEl.firstElementChild.focus();
    }

    function closePopup(focusHeader) {
      if (!state.open) return;
      state.open = false;
      document.removeEventListener('pointerdown', onDocPointer, true);
      document.removeEventListener('keydown', onDocKey, true);
      if (state.popupEl) state.popupEl.remove();
      state.popupEl = null;
      state.popupSig = '';
      if (state.header) {
        setAttr(state.header, 'aria-expanded', 'false');
        if (focusHeader && typeof state.header.focus === 'function') state.header.focus();
      }
    }

    function cleanup(root) {
      closePopup(false);
      removeHeader();
      state.proxies.clear();
      for (const el of root.querySelectorAll('[data-es-path],[data-es-list],[data-es-header],[data-es-proxy]')) {
        if (el.hasAttribute('data-es-header') || el.hasAttribute('data-es-proxy')) {
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

    function toggle(viaKeyboard) {
      if (popupMode) {
        if (state.open) closePopup(false);
        else openPopup(viaKeyboard === true);
        return;
      }
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

        // Dropdown: Alle gruppierten Einträge müssen in derselben Liste stehen: die mit den meisten gewinnt.
        // (Im Popup-Modus sind die Einträge nur ausgeblendet und stehen im Popup, dort gibt es keine Liste.)
        let groupParent = null;
        for (const d of decisions) d.proxied = false;
        if (!popupMode) {
          const counts = new Map();
          for (const d of decisions) {
            if (d.grouped) counts.set(d.el.parentElement, (counts.get(d.el.parentElement) || 0) + 1);
          }
          let best = 0;
          for (const [parent, count] of counts) {
            if (count > best) {
              groupParent = parent;
              best = count;
            }
          }
          // Einträge aus anderen Listen (z. B. "Einstellungen" unten) stehen als Kopie in der Gruppe.
          for (const d of decisions) {
            if (d.grouped && d.el.parentElement !== groupParent) {
              d.grouped = false;
              d.proxied = !!groupParent;
            }
          }
        }

        // Hauptliste = Liste mit den meisten Einträgen. Nur dort bekommen nicht aufgeführte Einträge
        // einen Platz hinter den aufgeführten; die untere Liste (Einstellungen, Benachrichtigungen,
        // Profil) behält ihre Reihenfolge von Home Assistant.
        const sizes = new Map();
        for (const d of decisions) sizes.set(d.el.parentElement, (sizes.get(d.el.parentElement) || 0) + 1);
        let mainParent = null;
        for (const [parent, count] of sizes) if (!mainParent || count > sizes.get(mainParent)) mainParent = parent;

        const orderedParents = new Set();
        let firstGrouped = null;
        for (const d of decisions) {
          let order = null;
          if (d.grouped) order = popupMode ? null : ORDER_GROUPED + (d.rank === null ? 0 : d.rank);
          else if (d.rank !== null) order = d.rank;
          else if (cfg.order.length && d.el.parentElement === mainParent) order = ORDER_UNLISTED;

          setAttr(d.el, 'data-es-path', d.path);
          setFlag(d.el, 'data-es-grouped', d.grouped);
          setFlag(d.el, 'data-es-hidden', d.hidden || d.proxied || (popupMode && d.grouped));
          if (order === null) {
            if (d.el.style.order) d.el.style.removeProperty('order');
          } else if (d.el.style.order !== String(order)) {
            d.el.style.order = String(order);
          }
          if (order !== null && d.el.parentElement) orderedParents.add(d.el.parentElement);
          if (d.grouped && !firstGrouped) firstGrouped = d.el;
        }

        // Kopien für Einträge aus anderen Listen
        let proxyBadge = 0;
        const wanted = new Set();
        for (const d of decisions) {
          if (!d.proxied) continue;
          wanted.add(d.path);
          let proxy = state.proxies.get(d.path);
          if (!proxy || !proxy.isConnected || proxy.parentElement !== groupParent) {
            if (proxy) proxy.remove();
            proxy = buildProxy(d.el, d.path);
            state.proxies.set(d.path, proxy);
            groupParent.append(proxy);
          }
          const text = syncProxy(d.el, proxy);
          proxyBadge += parseInt(text, 10) || 0;
          const order = d.rank === null ? ORDER_PROXY : ORDER_GROUPED + d.rank;
          setFlag(proxy, 'data-es-grouped', true);
          if (proxy.style.order !== String(order)) proxy.style.order = String(order);
          orderedParents.add(groupParent);
          if (!firstGrouped) firstGrouped = proxy;
        }
        for (const [path, proxy] of Array.from(state.proxies)) {
          if (!wanted.has(path)) {
            proxy.remove();
            state.proxies.delete(path);
          }
        }

        // Listen markieren, die per "order" sortiert werden (alle anderen bleiben unberührt).
        const parents = new Set(decisions.map((d) => d.el.parentElement).filter(Boolean));
        for (const parent of parents) setFlag(parent, 'data-es-list', orderedParents.has(parent));

        let headerParent = null;
        let hasGroup = false;
        if (popupMode) {
          // Admin-Button im unteren Bereich (Einstellungen/Profil), direkt über "Benachrichtigungen".
          // Gibt es keinen unteren Bereich, steht er am Ende der Hauptliste.
          const members = decisions.filter((d) => d.grouped);
          const bottomParent =
            decisions
              .filter((d) => d.path === 'config' || d.path === 'profile')
              .map((d) => d.el.parentElement)
              .find((parent) => parent && parent !== mainParent) || null;
          headerParent = bottomParent || mainParent;
          hasGroup = members.length > 0 && !!headerParent;

          state.members = members
            .map((d, index) => {
              const own = d.el.parentElement !== mainParent && d.rank === null;
              const text = badgeText(d.el);
              return {
                path: d.path,
                label: labelOfItem(d.el, hass.panels, d.path),
                badge: text,
                selected: d.path === state.lastPath,
                sortKey: own ? ORDER_PROXY : ORDER_GROUPED + (d.rank === null ? 0 : d.rank),
                index,
                makeIcon: () => makeIcon(d.el, d.path, hass.panels),
              };
            })
            .sort((a, b) => a.sortKey - b.sortKey || a.index - b.index);

          if (hasGroup) {
            if (!state.header) state.header = buildHeader(cfg, toggle);
            if (bottomParent) {
              const anchor = Array.from(bottomParent.children).find((child) => child !== state.header) || null;
              if (state.header.parentElement !== bottomParent || state.header.nextElementSibling !== anchor) {
                bottomParent.insertBefore(state.header, anchor);
              }
              if (state.header.style.order) state.header.style.removeProperty('order');
            } else {
              if (state.header.parentElement !== mainParent || state.header.nextElementSibling) mainParent.append(state.header);
              orderedParents.add(mainParent);
              setFlag(mainParent, 'data-es-list', true);
            }
            setAttr(state.header, 'aria-expanded', state.open ? 'true' : 'false');
            const total = members.reduce((sum, d) => sum + (parseInt(badgeText(d.el), 10) || 0), 0);
            const headerBadge = state.header.querySelector('.es-badge');
            const badgeValue = total > 0 ? String(total) : '';
            if (headerBadge && headerBadge.textContent !== badgeValue) headerBadge.textContent = badgeValue;
            const width = sidebar.getBoundingClientRect ? sidebar.getBoundingClientRect().width : 0;
            setFlag(headerParent, 'data-es-compact', width > 0 && width < 120);
            renderPopup();
          } else {
            closePopup(false);
            removeHeader();
          }
        } else if (groupParent && firstGrouped) {
          headerParent = groupParent;
          hasGroup = true;
          if (!state.header) state.header = buildHeader(cfg, toggle);
          if (state.header.parentElement !== groupParent || state.header.nextElementSibling !== firstGrouped) {
            groupParent.insertBefore(state.header, firstGrouped);
          }
          setAttr(state.header, 'aria-expanded', state.expanded ? 'true' : 'false');
          const headerBadge = state.header.querySelector('.es-badge');
          const badgeValue = proxyBadge > 0 ? String(proxyBadge) : '';
          if (headerBadge && headerBadge.textContent !== badgeValue) headerBadge.textContent = badgeValue;
          setFlag(groupParent, 'data-es-collapsed', !state.expanded);
          const width = sidebar.getBoundingClientRect ? sidebar.getBoundingClientRect().width : 0;
          setFlag(groupParent, 'data-es-compact', width > 0 && width < 120);
        } else {
          removeHeader();
        }
        for (const parent of parents) {
          if (parent !== headerParent) {
            clearAttr(parent, 'data-es-collapsed');
            clearAttr(parent, 'data-es-compact');
          }
        }
        if (popupMode && headerParent) clearAttr(headerParent, 'data-es-collapsed');

        state.lastItems = decisions;
        state.status = hasGroup ? 'grouped' : 'no-group';
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
      if (popupMode) {
        // Das Popup schließt bei jeder Navigation; "selected" im Popup folgt der aktuellen Seite.
        if (state.lastPath !== path) closePopup(false);
      } else if (inGroup) {
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
      closePopup(false);
      const popupStyle = document.querySelector('style[data-es-popup-style]');
      if (popupStyle) popupStyle.remove();
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
