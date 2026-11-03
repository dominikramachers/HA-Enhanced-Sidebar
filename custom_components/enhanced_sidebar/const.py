"""Konstanten für Enhanced Sidebar."""

from __future__ import annotations

from pathlib import Path

DOMAIN = "enhanced_sidebar"

CONF_GROUP_NAME = "group_name"
CONF_GROUP_ICON = "group_icon"
CONF_AUTO_DETECT_ADMIN = "auto_detect_admin"
CONF_INCLUDE = "include"
CONF_EXCLUDE = "exclude"
CONF_HIDDEN = "hidden"
CONF_ORDER = "order"
CONF_AUTO_COLLAPSE = "auto_collapse"

# Standardwerte. Das Frontend-Script kennt dieselben Werte und fällt darauf
# zurück, falls die Konfiguration nicht geladen werden kann.
DEFAULT_OPTIONS: dict[str, object] = {
    CONF_GROUP_NAME: "Admin",
    CONF_GROUP_ICON: "mdi:shield-account-outline",
    CONF_AUTO_DETECT_ADMIN: True,
    CONF_INCLUDE: [],
    CONF_EXCLUDE: ["config", "developer-tools", "profile"],
    CONF_HIDDEN: [],
    CONF_ORDER: [],
    CONF_AUTO_COLLAPSE: True,
}

LIST_KEYS = (CONF_INCLUDE, CONF_EXCLUDE, CONF_HIDDEN, CONF_ORDER)

FRONTEND_URL = "/enhanced_sidebar/enhanced-sidebar.js"
FRONTEND_FILE = Path(__file__).parent / "frontend" / "enhanced-sidebar.js"

WS_GET_CONFIG = "enhanced_sidebar/config"
