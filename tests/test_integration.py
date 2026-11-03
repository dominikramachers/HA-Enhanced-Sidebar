"""Tests für Einrichtung, Optionen und Websocket-Befehl."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.enhanced_sidebar.const import (
    CONF_EXCLUDE,
    CONF_GROUP_NAME,
    CONF_HIDDEN,
    CONF_INCLUDE,
    CONF_SETTINGS_IN_GROUP,
    DEFAULT_OPTIONS,
    DOMAIN,
    WS_GET_CONFIG,
)


async def _setup(hass: HomeAssistant, options: dict | None = None) -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN, unique_id=DOMAIN, data={}, options=options or dict(DEFAULT_OPTIONS)
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_config_flow_creates_entry_with_defaults(hass: HomeAssistant) -> None:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert result["type"] is FlowResultType.FORM

    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["options"] == DEFAULT_OPTIONS


async def test_only_one_instance(hass: HomeAssistant) -> None:
    await _setup(hass)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


async def test_setup_and_unload(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    assert entry.state is ConfigEntryState.LOADED

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.NOT_LOADED

    # Erneutes Laden darf die statischen Pfade nicht doppelt registrieren
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED


async def test_websocket_returns_options(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, {**DEFAULT_OPTIONS, CONF_GROUP_NAME: "Weitere", CONF_HIDDEN: ["history"]})

    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": WS_GET_CONFIG})
    msg = await client.receive_json()

    assert msg["success"]
    assert msg["result"][CONF_GROUP_NAME] == "Weitere"
    assert msg["result"][CONF_HIDDEN] == ["history"]
    # fehlende Werte kommen aus den Standardwerten
    assert msg["result"][CONF_EXCLUDE] == DEFAULT_OPTIONS[CONF_EXCLUDE]


async def test_options_flow_cleans_input(hass: HomeAssistant) -> None:
    entry = await _setup(hass)

    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "init"

    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {
            CONF_GROUP_NAME: "   ",
            CONF_INCLUDE: ["/kalender-uebersicht/", "kalender-uebersicht", " ", "pakete-uebersicht"],
            CONF_HIDDEN: ["history", "logbook"],
            CONF_SETTINGS_IN_GROUP: True,
        },
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    options = result["data"]
    assert options[CONF_GROUP_NAME] == "Admin"  # leer -> Standardname
    assert options[CONF_INCLUDE] == ["kalender-uebersicht", "pakete-uebersicht"]
    assert options[CONF_HIDDEN] == ["history", "logbook"]
    assert options[CONF_EXCLUDE] == DEFAULT_OPTIONS[CONF_EXCLUDE]
    assert options[CONF_SETTINGS_IN_GROUP] is True
    assert DEFAULT_OPTIONS[CONF_SETTINGS_IN_GROUP] is False
