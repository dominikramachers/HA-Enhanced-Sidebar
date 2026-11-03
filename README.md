# HA-Enhanced-Sidebar

Eine einklappbare **Admin-Gruppe** für die Seitenleiste von Home Assistant.

- Dashboards und Panels für alle Nutzer bleiben ganz normal in der Seitenleiste.
- Alles, was nur Administratoren sehen (Admin-Dashboards, Add-ons wie Terminal, File editor, Zigbee2MQTT, HACS …), wandert automatisch in **eine** Gruppe („Admin“), die zugeklappt ist.
- Nicht-Administratoren bekommen diese Panels von Home Assistant ohnehin nicht geliefert und sehen die Gruppe deshalb nicht.
- Läuft in jeder Oberfläche, auch in der Companion-App (Handy und Tablet), weil das Script über das Frontend von Home Assistant geladen wird.

## Funktionen

- Admin-Panels werden **automatisch erkannt** (`require_admin`). Neue Add-ons und Admin-Dashboards landen ohne Konfiguration in der Gruppe.
- Die Gruppe ist beim Laden **zugeklappt**, klappt auf einer ihrer Seiten **automatisch auf** und beim Wechsel auf eine andere Seite wieder zu (abschaltbar).
- Optional: einzelne Panels **zusätzlich** in die Gruppe legen oder **nie** hineinlegen, Panels **für alle ausblenden** (z. B. Verlauf, Logbuch, Medien) und die **Reihenfolge** festlegen.
- Funktioniert mit der schmalen Seitenleiste (nur Symbole) und mit dem Menü auf dem Handy. Bedienung per Touch und Tastatur (Enter/Leertaste), Animation respektiert „Bewegung reduzieren“.
- Die Einträge von Home Assistant werden **nicht verschoben oder neu gebaut**. Das Script setzt nur Markierungen und eine Kopfzeile. Erkennt es den Aufbau der Seitenleiste nicht (zum Beispiel nach einem Update von Home Assistant), tut es nichts und die normale Seitenleiste bleibt.

## Installation

### Über HACS

1. HACS → ⋮ → **Benutzerdefinierte Repositories**
2. Repository: `https://github.com/dominikramachers/HA-Enhanced-Sidebar`, Typ: **Integration**
3. **Enhanced Sidebar** herunterladen und Home Assistant neu starten.
4. Einstellungen → Geräte & Dienste → **Integration hinzufügen** → *Enhanced Sidebar*.
5. Browser neu laden (in der App: App schließen und neu öffnen).

Es sind keine Änderungen an `configuration.yaml` nötig. Voraussetzung ist Home Assistant **2026.6** oder neuer.

### Manuell

Den Ordner `custom_components/enhanced_sidebar` nach `config/custom_components/` kopieren, neu starten und die Integration wie oben hinzufügen.

## Einstellungen

Einstellungen → Geräte & Dienste → Enhanced Sidebar → **Konfigurieren**. Änderungen wirken nach dem Neuladen der Seite.

| Einstellung | Bedeutung | Standard |
| --- | --- | --- |
| Name der Gruppe | Beschriftung in der Seitenleiste | `Admin` |
| Symbol der Gruppe | MDI-Symbol | `mdi:shield-account-outline` |
| Admin-Panels automatisch erkennen | Alle Admin-Panels in die Gruppe | an |
| Gruppe automatisch zuklappen | Zu beim Laden und beim Verlassen der Gruppe | an |
| Zusätzlich in die Gruppe | URL-Pfade, die immer in die Gruppe sollen | leer |
| Nie in die Gruppe | URL-Pfade, die nie in die Gruppe sollen | `config`, `developer-tools`, `profile` |
| Ausblenden (für alle) | URL-Pfade, die für alle verschwinden | leer |
| Reihenfolge der Einträge | URL-Pfade in der gewünschten Reihenfolge, Rest folgt | leer |

Der **URL-Pfad** ist der Teil der Adresse nach dem ersten Slash, bei `https://ha.example/dienste-uebersicht` also `dienste-uebersicht`.

## Hinweise

- Nicht zusammen mit anderen Seitenleisten-Plugins betreiben, die Einträge umsortieren oder ausblenden (Custom Sidebar, Sidebar Organizer, Easy Sidebar Pro). Beide würden dieselbe Seitenleiste verändern.
- Für einen Seitenaufruf abschalten: `?es=0` an die Adresse hängen, zum Beispiel `https://ha.example/lovelace/0?es=0`.
- Diagnose: In der Browser-Konsole `enhancedSidebarDebug()` aufrufen. Das zeigt, welche Einträge erkannt wurden und welche Panels als Admin-Panel gelten. Bitte bei Fehlermeldungen im Issue mit angeben.

## Lizenz

MIT, siehe [LICENSE](LICENSE).

## Entwicklung

```bash
npm ci && npm test                       # Frontend-Script (jsdom)
pip install pytest-homeassistant-custom-component && pytest   # Integration
```

Das Script liegt in `custom_components/enhanced_sidebar/frontend/enhanced-sidebar.js`. Die Frontend-Tests bauen den Aufbau der Seitenleiste nach (`home-assistant` → `home-assistant-main` → `ha-sidebar`, jeweils mit Shadow-Root). Sie ersetzen keinen Test in einer echten Home-Assistant-Instanz.

---

## English

A collapsible **admin group** for the Home Assistant sidebar. Dashboards for everyone stay in the sidebar as usual; everything only administrators can see (admin dashboards, add-ons, HACS …) is grouped automatically under a collapsed "Admin" entry. It works in the browser and in the Companion app. Install it through HACS as a custom repository (type *Integration*, Home Assistant 2026.6 or newer), add the integration under Settings → Devices & services and reload the page. Settings (group name and icon, auto-detection, include/exclude lists, hidden panels, order, auto-collapse) are in the integration options. Add `?es=0` to a URL to disable the script for that page load; run `enhancedSidebarDebug()` in the browser console for diagnostics.
