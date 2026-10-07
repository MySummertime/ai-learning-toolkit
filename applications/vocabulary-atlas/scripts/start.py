"""Start the dictionary API and Vite frontend in one terminal."""
from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from utils.scripts.app_server_config import load_server_config
from utils.scripts.dictionary_lexicon import configured_dictionary, import_configured
from utils.scripts.file_transaction import project_lock
from utils.scripts.dictionary_spelling import is_current as spelling_is_current, sync
APP = Path(__file__).resolve().parents[1]


def wait_for(url: str, process: subprocess.Popen, seconds: int = 25) -> None:
    for _ in range(seconds * 5):
        if process.poll() is not None:
            raise RuntimeError(f"服务提前退出：{process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except (OSError, TimeoutError):
            time.sleep(.2)
    raise TimeoutError(f"启动超时：{url}")


def lan_address() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.connect(("8.8.8.8", 80))
        return probe.getsockname()[0]


def main() -> int:
    config = load_server_config(APP)
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--lan", action="store_true", help="允许家庭局域网设备访问本机服务")
    args = parser.parse_args()
    bind_host = "0.0.0.0" if args.lan else config.host
    public_host = lan_address() if args.lan else config.host
    page_url = f"http://{public_host}:{config.page_port}"
    service_url = f"http://{public_host}:{config.service_port}"
    python = Path(sys.executable)
    node = shutil.which("node.exe") or shutil.which("node")
    vite = APP / "node_modules" / "vite" / "bin" / "vite.js"
    if not python.is_file() or not node:
        raise RuntimeError("需要项目隔离 Python 环境及 Node.js/npm")
    if not vite.is_file():
        raise RuntimeError("请先在 applications/vocabulary-atlas/ 运行 npm ci")
    for port in (config.page_port, config.service_port):
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                raise RuntimeError(f"端口 {port} 已被占用，请先停止旧的vocabulary-atlas服务")
    with project_lock(ROOT / "logs/dictionary-lexicon/import.lock", "dictionary-lexicon"):
        _, dictionary_ready = configured_dictionary(ROOT)
        if not dictionary_ready:
            print("正在准备本地词典…", flush=True)
            import_configured(ROOT, download=True)
        if not spelling_is_current(ROOT):
            print("正在同步拼写关系…", flush=True)
            sync(ROOT)
    allowed_hosts = {config.host, "127.0.0.1", "localhost"}
    if args.lan:
        allowed_hosts.add(public_host)
    api_env = {**os.environ, "VOCABULARY_ALLOWED_ORIGIN": page_url,
               "VOCABULARY_ALLOWED_HOSTS": ",".join(sorted(allowed_hosts))}
    api = subprocess.Popen([str(python), str(APP / "scripts" / "service.py"), "serve", "--root", str(ROOT), "--host", bind_host, "--port", str(config.service_port)], cwd=ROOT,
                           env=api_env)
    frontend = None
    try:
        wait_for(f"http://127.0.0.1:{config.service_port}/health", api)
        frontend = subprocess.Popen([node, str(vite), "--host", bind_host, "--port", str(config.page_port), "--strictPort"], cwd=APP,
                                    env={**os.environ, "VITE_API_URL": service_url})
        wait_for(f"http://127.0.0.1:{config.page_port}/", frontend)
        print(f"vocabulary-atlas：{page_url}/", flush=True)
        if not args.no_browser and not args.lan:
            webbrowser.open(page_url + "/")
        while api.poll() is None and frontend.poll() is None:
            time.sleep(.5)
        raise RuntimeError("本地服务已退出")
    except KeyboardInterrupt:
        return 0
    finally:
        for process in (frontend, api):
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()


if __name__ == "__main__":
    raise SystemExit(main())
