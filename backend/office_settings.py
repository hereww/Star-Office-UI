"""Server-only settings; does not create files or secrets when imported."""
from __future__ import annotations

import os
from pathlib import Path


def office_data_dir():
    explicit = os.environ.get("OFFICE_DATA_DIR")
    if explicit:
        return Path(explicit).expanduser().resolve()
    root = os.environ.get("STAR_OFFICE_DATA_DIR") or str(Path(__file__).resolve().parent.parent)
    return Path(root).expanduser().resolve() / "office-prod"


def office_enabled(app=None):
    value = app.config.get("OFFICE_ENABLED") if app is not None else None
    if value is None:
        value = os.environ.get("OFFICE_ENABLED", "0")
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def office_user_ids(app=None):
    """Server-owned collection profile; unset defaults to 1/4/7/8.

    Explicit narrower profiles are never widened. Empty, duplicate, malformed
    or numeric IDs fail closed; this profile cannot grant Sub2API permission.
    Only configured initial mappings are seeded; all other IDs stay unbound.
    """
    try:
        from .office_contract import DEFAULT_USER_IDS, ContractError, canonical_id
    except ImportError:
        from office_contract import DEFAULT_USER_IDS, ContractError, canonical_id
    value = app.config.get("OFFICE_USER_IDS") if app is not None else None
    if value is None:
        value = os.environ.get("OFFICE_USER_IDS")
    if value is None:
        return DEFAULT_USER_IDS
    if not isinstance(value, str):
        raise ContractError("invalid_user_scope")
    ids = value.split(",")
    if not 1 <= len(ids) <= 500:
        raise ContractError("invalid_user_scope")
    ids = tuple(canonical_id(uid) for uid in ids)
    if len(set(ids)) != len(ids):
        raise ContractError("invalid_user_scope")
    return tuple(sorted(ids, key=int))
