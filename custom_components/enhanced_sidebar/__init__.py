"""Enhanced Sidebar: einklappbare Admin-Gruppe in der Home-Assistant-Seitenleiste.

Die Integration liefert ein kleines Frontend-Script aus (über
``frontend.add_extra_js_url``, also in jeder Oberfläche inklusive Companion-App)
und stellt dem Script die Einstellungen über einen Websocket-Befehl bereit.

Sicherheit: Das Script ändert nur die Darstellung der Seitenleiste im Browser.
Erkennt es den Aufbau der Seitenleiste nicht, tut es nichts und die normale
Seitenleiste bleibt unverändert. Mit ``?es=0`` in der Adresse wird es für den
Seitenaufruf abgeschaltet.
"""

from __future__ import annotations

import hashlib
import logging

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback

from .const import (
    DEFAULT_OPTIONS,
    DOMAIN,
    FRONTEND_FILE,
    FRONTEND_URL,
    WS_GET_CONFIG,
)

try:  # pragma: no cover - fehlt in sehr alten Versionen
    from homeassistant.components.frontend import remove_extra_js_url
except ImportError:  # pragma: no cover
    remove_extra_js_url = None  # type: ignore[assignment]

_LOGGER = logging.getLogger(__name__)

_KEY_REGISTERED = "registered"
_KEY_VERSION = "version"
_KEY_URL = "url"


def _asset_version() -> str:
    """Kurzer Hash des Scripts, damit Browser nach Updates neu laden."""
    try:
        return hashlib.sha1(FRONTEND_FILE.read_bytes()).hexdigest()[:8]  # noqa: S324
    except OSError:
        return "0"


@websocket_api.websocket_command({vol.Required("type"): WS_GET_CONFIG})
@callback
def ws_get_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Einstellungen an das Frontend-Script liefern (für alle angemeldeten Nutzer)."""
    options: dict[str, object] = dict(DEFAULT_OPTIONS)
    entries = hass.config_entries.async_entries(DOMAIN)
    if entries:
        options.update(entries[0].options)
    connection.send_result(msg["id"], options)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Script ausliefern und im Frontend registrieren."""
    data = hass.data.setdefault(DOMAIN, {})

    if not data.get(_KEY_REGISTERED):
        data[_KEY_VERSION] = await hass.async_add_executor_job(_asset_version)
        await hass.http.async_register_static_paths(
            [StaticPathConfig(FRONTEND_URL, str(FRONTEND_FILE), True)]
        )
        websocket_api.async_register_command(hass, ws_get_config)
        data[_KEY_REGISTERED] = True

    url = f"{FRONTEND_URL}?v={data[_KEY_VERSION]}"
    add_extra_js_url(hass, url)
    data[_KEY_URL] = url

    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    _LOGGER.debug("Enhanced Sidebar registriert (%s)", url)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Script wieder aus dem Frontend entfernen (wirkt nach Browser-Neuladen)."""
    url = hass.data.get(DOMAIN, {}).pop(_KEY_URL, None)
    if url and remove_extra_js_url is not None:
        remove_extra_js_url(hass, url)
    return True


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Nach geänderten Einstellungen neu laden."""
    await hass.config_entries.async_reload(entry.entry_id)
