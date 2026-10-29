"""WSGI entry point for Gunicorn or another process manager."""

from .app import app

__all__ = ["app"]
