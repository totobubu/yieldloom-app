"""Allow the canonical Pages frontend and explicitly configured app origins."""

import os

from flask import request


def configure_cors(app):
    @app.after_request
    def add_cors_headers(response):
        origin = request.headers.get("Origin")
        configured = {value.strip() for value in os.environ.get("PUBLIC_APP_ORIGINS", "").split(",") if value.strip()}
        if origin in configured or origin in {"https://totobubu.github.io", "http://localhost:5173", "http://localhost:3000"}:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers["Access-Control-Expose-Headers"] = "Retry-After"
            response.headers["Vary"] = "Origin"
        return response

    return app
