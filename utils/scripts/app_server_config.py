"""Load the local server address for an application from server.json."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ServerConfig:
    host: str
    page_port: int
    service_port: int

    @property
    def page_url(self) -> str:
        return f"http://{self.host}:{self.page_port}"

    @property
    def service_url(self) -> str:
        return f"http://{self.host}:{self.service_port}"


def load_server_config(app: Path) -> ServerConfig:
    path = app / "server.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or set(data) != {"host", "pagePort", "servicePort"}:
        raise ValueError(f"{path}: 需要 host、pagePort、servicePort 三项")
    host = data["host"]
    # These applications expose local files and state. Keep them on loopback.
    if host not in ("127.0.0.1", "localhost"):
        raise ValueError(f"{path}: host 只能是 127.0.0.1 或 localhost")
    page_port, service_port = data["pagePort"], data["servicePort"]
    if any(type(port) is not int or not 1 <= port <= 65535 for port in (page_port, service_port)):
        raise ValueError(f"{path}: 端口必须是 1 到 65535 的整数")
    if page_port == service_port:
        raise ValueError(f"{path}: 页面和服务端口不能相同")
    return ServerConfig(host, page_port, service_port)
