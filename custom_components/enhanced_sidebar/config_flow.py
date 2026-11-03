"""Einrichtung und Einstellungen von Enhanced Sidebar."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    BooleanSelector,
    IconSelector,
    TextSelector,
    TextSelectorConfig,
)

from .const import (
    CONF_AUTO_COLLAPSE,
    CONF_AUTO_DETECT_ADMIN,
    CONF_EXCLUDE,
    CONF_GROUP_ICON,
    CONF_GROUP_NAME,
    CONF_HIDDEN,
    CONF_INCLUDE,
    CONF_ORDER,
    DEFAULT_OPTIONS,
    DOMAIN,
    LIST_KEYS,
)

_LIST_SELECTOR = TextSelector(TextSelectorConfig(multiple=True))


def _schema() -> vol.Schema:
    return vol.Schema(
        {
            vol.Optional(CONF_GROUP_NAME): TextSelector(),
            vol.Optional(CONF_GROUP_ICON): IconSelector(),
            vol.Optional(CONF_AUTO_DETECT_ADMIN): BooleanSelector(),
            vol.Optional(CONF_AUTO_COLLAPSE): BooleanSelector(),
            vol.Optional(CONF_INCLUDE): _LIST_SELECTOR,
            vol.Optional(CONF_EXCLUDE): _LIST_SELECTOR,
            vol.Optional(CONF_HIDDEN): _LIST_SELECTOR,
            vol.Optional(CONF_ORDER): _LIST_SELECTOR,
        }
    )


def _clean_path(value: Any) -> str:
    """URL-Pfad eines Panels bereinigen ("/dienste/" -> "dienste")."""
    return str(value).strip().strip("/")


def _clean(user_input: dict[str, Any]) -> dict[str, Any]:
    """Eingaben bereinigen und fehlende Werte mit Standardwerten füllen."""
    result: dict[str, Any] = dict(DEFAULT_OPTIONS)
    for key, value in user_input.items():
        if key in LIST_KEYS:
            seen: list[str] = []
            for item in value or []:
                path = _clean_path(item)
                if path and path not in seen:
                    seen.append(path)
            result[key] = seen
        elif key == CONF_GROUP_NAME:
            result[key] = str(value or "").strip() or DEFAULT_OPTIONS[CONF_GROUP_NAME]
        else:
            result[key] = value
    return result


class EnhancedSidebarConfigFlow(ConfigFlow, domain=DOMAIN):
    """Einrichtung: nur eine Instanz, Einstellungen danach über die Optionen."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(
                title="Enhanced Sidebar", data={}, options=dict(DEFAULT_OPTIONS)
            )
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: Any) -> OptionsFlow:
        return EnhancedSidebarOptionsFlow()


class EnhancedSidebarOptionsFlow(OptionsFlow):
    """Einstellungen ändern."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=_clean(user_input))

        current = {**DEFAULT_OPTIONS, **self.config_entry.options}
        return self.async_show_form(
            step_id="init",
            data_schema=self.add_suggested_values_to_schema(_schema(), current),
        )
