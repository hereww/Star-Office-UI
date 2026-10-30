"""WSGI entry point for Gunicorn or another process manager."""

from .app import create_app

app = create_app()

__all__ = ["app"]
