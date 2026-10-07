"""Loopback API for the local English dictionary application."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import tempfile
import uuid
import traceback
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from utils.scripts.dictionary_store import ConflictError, DictionaryStore, normalize_lemma, word_id
from utils.scripts.dictionary_plans import PlanStore, plan_progress, round_complete, visible_order
from utils.scripts.structured_io import write_text_atomic
from utils.scripts.timestamp import iso_timestamp, unique_filename_timestamp
from utils.scripts.app_server_config import load_server_config
from utils.scripts.dictionary_wordlists import wordlist_files, prepare_wordlist, wordlist_name

RUN_ID = re.compile(r"^\d{8}T\d{6}(?:_\d+)?$")


class RunManager:
    def __init__(self, root: Path):
        self.root = root
        self.jobs: dict[str, dict] = {}
        self.lock = threading.RLock()
        self.skill = root / ".agents" / "skills" / "build-word-entry" / "scripts" / "cli.py"
        self.python = Path(sys.executable)
        self.diagnostic_path: Path | None = None

    def diagnostic(self, event: str, **details) -> None:
        """内部输出只写日志，不送给浏览器。"""
        with self.lock:
            if self.diagnostic_path is None:
                base = self.root / "logs" / "vocabulary-atlas" / "runs"
                base.mkdir(parents=True, exist_ok=True)
                directory = base / unique_filename_timestamp([p.name for p in base.iterdir()])
                directory.mkdir()
                self.diagnostic_path = directory / "events.jsonl"
            with self.diagnostic_path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps({"at": iso_timestamp(), "event": event, **details}, ensure_ascii=False) + "\n")

    @staticmethod
    def public_status(raw: dict) -> dict:
        status = raw.get("status", "")
        detail = json.dumps(raw, ensure_ascii=False).lower()
        if status == "completed":
            return {"status": "completed", "message": "词条已完善，可以查看释义和关联。", "canResume": False}
        if "agent_decision" in detail or "small_ai_decision" in detail:
            return {"status": "needs_review", "message": "资料已收集，但词义和关联还需要核对，查询已暂停。你可以继续浏览其他单词，待核对完成后再查看。", "canResume": False}
        if any(key in detail for key in ("captcha", "login", "browser_action", "browser_intervention")):
            return {"status": "needs_browser", "message": "词典需要登录或验证。请在打开的浏览器完成操作，再点击“继续查找”。", "canResume": True}
        if status in ("paused_quality_review", "paused_relation_review", "paused_word"):
            return {"status": "needs_review", "message": "词典资料还需要核对，查询已暂停。你可以先浏览其他单词，待核对完成后再查看。", "canResume": False}
        if status.startswith("paused") or status in ("error", "failed"):
            return {"status": "paused", "message": "词典查询暂时未完成。你可以稍后重试，详细原因已记录在服务日志中。", "canResume": True}
        return {"status": "processing", "message": "正在查找词义和关联，请保持服务开启。", "canResume": False}

    def existing(self, lemma: str) -> str | None:
        run_root = self.root / "logs" / "build-word-entry" / "runs"
        for directory in sorted(run_root.glob("*"), reverse=True):
            request, state = directory / "request.json", directory / "state.json"
            if not request.is_file() or not state.is_file():
                continue
            try:
                req = json.loads(request.read_text(encoding="utf-8"))
                status = json.loads(state.read_text(encoding="utf-8"))["status"]
                if req.get("kind") == "word" and normalize_lemma(req.get("word", "")) == lemma and status != "completed":
                    return directory.name
            except (ValueError, KeyError) as exc:
                raise ValueError(f"词条运行记录损坏：{directory.name}") from exc
        return None

    def _invoke(self, job_id: str, args: list[str]) -> None:
        try:
            process = subprocess.run([str(self.python), str(self.skill), *args, "--root", str(self.root)],
                                     cwd=self.root, capture_output=True, text=True, timeout=900)
            self.diagnostic("word_query", jobId=job_id, returncode=process.returncode, stdout=process.stdout, stderr=process.stderr)
            lines = [line for line in process.stdout.splitlines() if line.strip().startswith("{")]
            payload = json.loads(lines[-1]) if lines else {}
            run_id = payload.get("run_id") or self.jobs[job_id].get("runId")
            error = payload.get("error") or process.stderr[-500:] or None
            valid = process.returncode in (0, 3) and bool(run_id)
            if not run_id:
                error = error or "状态机未返回运行 ID"
            if process.returncode == 0 and run_id:
                verified = subprocess.run([str(self.python), str(self.skill), "verify", "--root", str(self.root),
                                           "--run-id", run_id], cwd=self.root, capture_output=True, text=True, timeout=90)
                self.diagnostic("word_verify", runId=run_id, returncode=verified.returncode, stdout=verified.stdout, stderr=verified.stderr)
                if verified.returncode:
                    valid = False
                    error = verified.stderr[-500:] or "词条校验失败"
            with self.lock:
                self.jobs[job_id].update(status=("completed" if process.returncode == 0 and valid else
                                                 "paused" if process.returncode == 3 and valid else "error"),
                                         runId=run_id, skillStatus=payload.get("status"), error=error)
        except (OSError, subprocess.TimeoutExpired, ValueError) as exc:
            self.diagnostic("word_error", jobId=job_id, traceback=traceback.format_exc())
            with self.lock:
                self.jobs[job_id].update(status="error", error=str(exc))

    def start(self, lemma: str) -> dict:
        key = normalize_lemma(lemma)
        if not key or len(key) > 100:
            raise ValueError("单词无效")
        with self.lock:
            for job in self.jobs.values():
                if job["lemma"] == key and job["status"] == "running":
                    return dict(job)
            existing = self.existing(key)
            if existing:
                return {"jobId": None, "runId": existing, "status": "existing", "lemma": key}
            job_id = uuid.uuid4().hex
            job = {"jobId": job_id, "runId": None, "status": "running", "lemma": key}
            self.jobs[job_id] = job
            threading.Thread(target=self._invoke, args=(job_id, ["start-word", "--word", key]), daemon=True).start()
            return dict(job)

    def job(self, job_id: str) -> dict:
        with self.lock:
            if job_id not in self.jobs:
                raise FileNotFoundError(job_id)
            job = dict(self.jobs[job_id])
            job.pop("error", None)
            job.pop("skillStatus", None)
            if job["status"] == "error":
                job["message"] = "词条暂时无法建立，请稍后重试。详细原因已记录在服务日志中。"
            return job

    def status(self, run_id: str) -> dict:
        if not RUN_ID.fullmatch(run_id):
            raise ValueError("runId 无效")
        process = subprocess.run([str(self.python), str(self.skill), "status", "--root", str(self.root),
                                  "--run-id", run_id], cwd=self.root, capture_output=True, text=True, timeout=20)
        if process.returncode:
            raise ValueError(process.stderr[-500:] or "无法读取运行状态")
        raw = json.loads(process.stdout)
        self.diagnostic("word_status", runId=run_id, state=raw)
        return self.public_status(raw)

    def resume(self, run_id: str) -> dict:
        if not RUN_ID.fullmatch(run_id):
            raise ValueError("runId 无效")
        with self.lock:
            for job in self.jobs.values():
                if job.get("runId") == run_id and job["status"] == "running":
                    return dict(job)
        args = ["resume", "--run-id", run_id]
        with self.lock:
            for job in self.jobs.values():
                if job.get("runId") == run_id and job["status"] == "running":
                    return dict(job)
            job_id = uuid.uuid4().hex
            job = {"jobId": job_id, "runId": run_id, "status": "running", "lemma": ""}
            self.jobs[job_id] = job
        threading.Thread(target=self._invoke, args=(job_id, args), daemon=True).start()
        return dict(job)


def playable_audio(data: bytes, content_type: str) -> bool:
    kind = content_type.lower().split(";")[0].strip()
    if kind not in ("audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "application/octet-stream"):
        return False
    return data.startswith((b"ID3", b"RIFF", b"OggS")) or (len(data) > 2 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0)


def fetch_audio(lemma: str, variety: str) -> tuple[bytes, str]:
    if variety not in ("uk", "us"):
        raise ValueError("无效口音")
    url = f"https://dict.youdao.com/dictvoice?audio={quote(lemma, safe='')}&type={'1' if variety == 'uk' else '2'}"
    with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=8) as response:
        data = response.read(2_000_001)
        kind = response.headers.get("Content-Type", "")
    if len(data) > 2_000_000 or not playable_audio(data, kind):
        raise FileNotFoundError("当前口音暂无可播放音频")
    return data, kind


def cached_audio(store: DictionaryStore, lemma: str, variety: str) -> tuple[bytes, str]:
    if variety not in ("uk", "us"):
        raise ValueError("无效口音")
    directory = store.data / "cache" / "audio"
    key = hashlib.sha256(f"{normalize_lemma(lemma)}:{variety}".encode("utf-8")).hexdigest()
    formats = {"mp3": "audio/mpeg", "wav": "audio/wav", "ogg": "audio/ogg"}
    for extension, content_type in formats.items():
        path = directory / f"{key}.{extension}"
        if path.is_file():
            data = path.read_bytes()
            if playable_audio(data, content_type):
                return data, content_type
    data, content_type = fetch_audio(lemma, variety)
    extension = "wav" if data.startswith(b"RIFF") else "ogg" if data.startswith(b"OggS") else "mp3"
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=directory, delete=False) as temporary:
        temporary.write(data)
        temporary_path = Path(temporary.name)
    try:
        os.replace(temporary_path, directory / f"{key}.{extension}")
    finally:
        temporary_path.unlink(missing_ok=True)
    return data, formats[extension]


def make_handler(store: DictionaryStore, runs: RunManager):
    plans = PlanStore(store.root, store)
    write_lock = threading.RLock()
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, value: dict | list, content_type: str = "application/json; charset=utf-8") -> None:
            payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self._cors_headers()
            self.end_headers()
            self.wfile.write(payload)

        def _cors_headers(self) -> None:
            origin = self.headers.get("Origin", "")
            if origin and origin == os.environ.get("VOCABULARY_ALLOWED_ORIGIN", ""):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Vary", "Origin")

        def _body(self) -> dict:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 2_000_000:
                raise ValueError("请求大小无效")
            value = json.loads(self.rfile.read(size))
            if not isinstance(value, dict):
                raise ValueError("请求必须为 JSON 对象")
            return value

        def _dispatch(self) -> None:
            origin = self.headers.get("Origin", "")
            host = urlparse("http://" + self.headers.get("Host", "")).hostname
            config = load_server_config(ROOT / "applications" / "vocabulary-atlas")
            allowed_hosts = set(os.environ.get("VOCABULARY_ALLOWED_HOSTS", config.host).split(","))
            allowed_origin = os.environ.get("VOCABULARY_ALLOWED_ORIGIN", config.page_url)
            if host not in allowed_hosts or (origin and origin != allowed_origin):
                self._send(403, {"error": "不允许的请求来源"})
                return
            if self.command == "OPTIONS":
                self._send(200, {})
                return
            parsed = urlparse(self.path)
            path = parsed.path
            query = parse_qs(parsed.query)
            body = self._body() if self.command in ("PUT", "POST", "PATCH", "DELETE") else None
            if self.command == "GET" and path == "/health":
                result = {"status": "ok", "entryCount": store.entry_count()}
            elif self.command == "GET" and path == "/api/bootstrap":
                result = store.bootstrap()
            elif self.command == "GET" and path == "/api/wordlists":
                result = []
                known = store.entries()
                directory = store.root / store.config["wordlists"]["directory"]
                for file in wordlist_files(store.root, store.config):
                    if not file.is_file():
                        continue
                    words, skipped = prepare_wordlist(file)
                    result.append({"file": file.relative_to(directory).as_posix(), "name": wordlist_name(file),
                                   "count": len(words),
                                   "definitionCount": sum(word_id(word) in known for word in words),
                                   "source": "仓库原有词表，原始发布来源未记录"})
            elif self.command == "POST" and path == "/api/wordlists/use":
                directory = store.root / store.config["wordlists"]["directory"]
                available = {file.relative_to(directory).as_posix(): file
                             for file in wordlist_files(store.root, store.config)}
                file = available.get(body.get("file"))
                if file is None:
                    raise ValueError("词表不存在")
                words, skipped = prepare_wordlist(file)
                if not words:
                    raise ValueError("词表没有可导入的单词")
                if skipped:
                    runs.diagnostic("wordlist_import_skipped", file=file.name, rows=skipped)
                content = "\n".join(words)
                source_file = file.relative_to(store.root).as_posix()
                name = wordlist_name(file)
                result = next((project for project in store.projects() if project.get("origin") == "builtin" and
                               project.get("sourceFile") == source_file and
                               {row["lemma"] for row in project["words"]} == set(words)), None)
                if result is None:
                    result = store.create_project(name, content, "text", origin="builtin", source_file=source_file)
            elif self.command == "GET" and path == "/api/projects":
                result = store.projects()
            elif self.command == "GET" and path == "/api/plans":
                result = [{**plan, "progress": plan_progress(plan),
                           "roundComplete": round_complete(plan, plan["rounds"][-1], page_size=store.study_page_size())}
                          for plan in plans.list()]
            elif self.command == "GET" and path == "/api/today":
                result = {"day": iso_timestamp()[:10]}
            elif self.command == "POST" and path == "/api/plans":
                plan = plans.create(body)
                result = {**plan, "progress": plan_progress(plan),
                          "roundComplete": round_complete(plan, plan["rounds"][-1], page_size=store.study_page_size())}
            elif self.command == "GET" and path.startswith("/api/plans/date/"):
                selected_day = path.split("/")[-1]
                result = []
                for plan in plans.list():
                    for current_round in plan["rounds"]:
                        index = (date.fromisoformat(selected_day) - date.fromisoformat(current_round["startDate"])).days
                        if 0 <= index < len(plan["schedule"]["days"]) and selected_day <= current_round["reviewEndDate"]:
                            schedule_day = plan["schedule"]["days"][index]
                            result.append({"planId": plan["planId"], "name": plan["name"], "method": plan["method"],
                                           "projectId": plan["projectId"], "round": current_round["number"],
                                           "wordIds": [plan["wordIds"][number - 1] for number in schedule_day["item_ids"]],
                                           "newWordIds": [plan["wordIds"][number - 1] for number in schedule_day["new_item_ids"]],
                                           "reviewWordIds": [plan["wordIds"][number - 1] for number in schedule_day["review_item_ids"]]})
            elif self.command == "GET" and re.fullmatch(r"/api/plans/plan_[0-9a-f]{32}/day/\d{4}-\d{2}-\d{2}", path):
                parts = path.split("/")
                plan = plans.get(parts[3])
                page_size = int(query.get("pageSize", [store.study_page_size()])[0])
                if not 1 <= page_size <= 100:
                    raise ValueError("每组单词数无效")
                day = parts[5]
                current_round = plan["rounds"][-1]
                if not current_round["startDate"] <= day <= current_round["reviewEndDate"]:
                    raise ValueError("日期不属于当前轮")
                result = {"day": day, "wordIds": visible_order(plan, current_round, day, page_size),
                          "passedWordIds": current_round["passed"].get(day, []),
                          "newWordIds": [plan["wordIds"][number - 1] for number in plan["schedule"]["days"][(date.fromisoformat(day) - date.fromisoformat(current_round["startDate"])).days]["new_item_ids"]],
                          "reviewWordIds": [plan["wordIds"][number - 1] for number in plan["schedule"]["days"][(date.fromisoformat(day) - date.fromisoformat(current_round["startDate"])).days]["review_item_ids"]]}
            elif self.command == "GET" and path.startswith("/api/plans/"):
                plan = plans.get(path.split("/")[-1])
                result = {**plan, "progress": plan_progress(plan),
                          "roundComplete": round_complete(plan, plan["rounds"][-1], page_size=store.study_page_size())}
            elif self.command == "PATCH" and path.startswith("/api/plans/"):
                plan = plans.update(path.split("/")[-1], body["expectedRevision"], body["action"], body)
                result = {**plan, "progress": plan_progress(plan),
                          "roundComplete": round_complete(plan, plan["rounds"][-1], page_size=store.study_page_size())}
            elif self.command == "DELETE" and re.fullmatch(r"/api/plans/plan_[0-9a-f]{32}", path):
                plans.delete(path.split("/")[-1], body["expectedRevision"])
                result = {"deleted": True}
            elif self.command == "POST" and path == "/api/projects":
                result = store.create_project(body["name"], body.get("content", ""), body.get("format", "text"))
            elif self.command == "PUT" and re.fullmatch(r"/api/projects/[a-z0-9_-]+", path):
                project_id = path.split("/")[-1]
                if "content" not in body:
                    result = store.rename_project(project_id, body["name"], body["expectedRevision"])
                else:
                    old = store.project(project_id)
                    rows = store.project_words(body["content"])
                    affected = [plan for plan in plans.list() if plan["projectId"] == project_id]
                    changed = {row["wordId"] for row in old["words"]} != {row["wordId"] for row in rows}
                    if old["revision"] != body["expectedRevision"]:
                        raise ConflictError("项目版本冲突")
                    if changed and affected and type(body.get("replan")) is not bool:
                        raise ConflictError("词表变化须选择是否重新生成现有背诵计划")
                    prepared = ([plans.prepare_for_project_words(plan, [row["wordId"] for row in rows])
                                 for plan in affected] if changed and body.get("replan") else [])
                    result = store.update_project(project_id, body["name"], body["content"], body["expectedRevision"])
                    try:
                        for plan in prepared:
                            plans._save(plan)
                    except Exception:
                        write_text_atomic(store._project_path(project_id), json.dumps(old, ensure_ascii=False, indent=2) + "\n")
                        for plan in affected:
                            if body.get("replan"):
                                plans._save(plan)
                        raise
            elif self.command == "DELETE" and re.fullmatch(r"/api/projects/[a-z0-9_-]+", path):
                project_id = path.split("/")[-1]
                if store.project(project_id)["revision"] != body["expectedRevision"]:
                    raise ConflictError("项目版本冲突")
                if any(plan["projectId"] == project_id for plan in plans.list()):
                    raise ConflictError("请先处理此项目关联的背诵计划")
                current = store.state("ui")
                if current["activeProjectId"] == project_id:
                    replacement = next((project["projectId"] for project in store.projects() if project["projectId"] != project_id), None)
                    if replacement is None:
                        raise ValueError("至少保留一个项目")
                    store.save_state("ui", {**current, "activeProjectId": replacement, "activeTabId": "graph"}, current["revision"])
                store.delete_project(project_id, body["expectedRevision"])
                result = {"deleted": True}
            elif self.command == "GET" and path == "/api/dictionary/search":
                result = store.search(query.get("q", [""])[0], query.get("project", [None])[0])
            elif self.command == "GET" and path == "/api/words":
                result = store.word_summaries(query.get("stage", ["all"])[0], query.get("project", [None])[0])
            elif self.command == "GET" and path.startswith("/api/words/"):
                result = store.word_page(path.split("/")[-1], query.get("stage", ["all"])[0])
            elif self.command == "GET" and path == "/api/candidates":
                lemma = query.get("lemma", [""])[0]
                result = store.candidate(lemma)
                result["existingRunId"] = runs.existing(normalize_lemma(lemma))
            elif self.command == "GET" and path == "/api/graph":
                visible = {key: query.get(key, ["1"])[0] == "1" for key in
                           ("family", "synonym", "near_synonym", "antonym", "spelling_similar")}
                result = store.graph(stage_id=query.get("stage", ["all"])[0],
                                     selected=query.get("selected", [None])[0], visible=visible,
                                     show_others=query.get("others", ["0"])[0] == "1",
                                     search=query.get("search", [""])[0],
                                     show_outside=query.get("outside", ["0"])[0] == "1",
                                     project_id=query.get("project", [None])[0],
                                     offset=int(query.get("offset", ["0"])[0]))
            elif self.command == "POST" and path.startswith("/api/stages/") and path.endswith("/words"):
                stage_id = path.split("/")[3]
                result = store.add_to_stage(stage_id, body["wordId"], body["expectedRevision"])
            elif self.command == "PUT" and path == "/api/state/ui":
                result = store.save_state("ui", body["state"], body["expectedRevision"])
            elif self.command == "POST" and path.startswith("/api/favorites/"):
                parts = path.split("/")
                favorite_word_id = parts[3]
                result = (store.opened(favorite_word_id, body["expectedRevision"]) if len(parts) == 5 and parts[4] == "opened" else
                          store.patch_favorite(favorite_word_id, body["favorited"], body["expectedRevision"]))
            elif self.command == "POST" and path == "/api/runs":
                result = runs.start(body["lemma"])
            elif self.command == "GET" and path.startswith("/api/jobs/"):
                result = runs.job(path.split("/")[-1])
            elif path.startswith("/api/runs/"):
                parts = path.split("/")
                result = runs.status(parts[3]) if self.command == "GET" and len(parts) == 4 else \
                    runs.resume(parts[3]) if self.command == "POST" and len(parts) == 5 and parts[4] == "resume" else None
                if result is None:
                    raise FileNotFoundError(path)
            elif self.command == "GET" and path.startswith("/api/audio/"):
                parts = path.split("/")
                entry = store.entry(parts[3])
                data, content_type = cached_audio(store, entry["lemma"], parts[4])
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                check = query.get("check", ["0"])[0] == "1"
                self.send_header("Content-Length", str(0 if check else len(data)))
                self.send_header("Cache-Control", "private, max-age=600")
                self._cors_headers()
                self.end_headers()
                if not check:
                    self.wfile.write(data)
                return
            else:
                raise FileNotFoundError(path)
            self._send(200, result)

        def do_GET(self) -> None:
            self._safe_dispatch()

        def do_POST(self) -> None:
            self._safe_dispatch()

        def do_PATCH(self) -> None:
            self._safe_dispatch()

        def do_PUT(self) -> None:
            self._safe_dispatch()

        def do_DELETE(self) -> None:
            self._safe_dispatch()

        def do_OPTIONS(self) -> None:
            self._safe_dispatch()

        def _safe_dispatch(self) -> None:
            try:
                if self.command in ("PUT", "POST", "PATCH", "DELETE"):
                    with write_lock:
                        self._dispatch()
                else:
                    self._dispatch()
            except ConflictError as exc:
                self._send(409, {"error": str(exc)})
            except FileNotFoundError as exc:
                runs.diagnostic("request_error", path=self.path, traceback=traceback.format_exc())
                self._send(404, {"error": "请求的内容不存在，请刷新后重试。"})
            except ValueError as exc:
                runs.diagnostic("request_error", path=self.path, traceback=traceback.format_exc())
                message = "词条查询暂时未完成，请稍后重试。" if "/api/runs" in self.path or "/api/jobs" in self.path else str(exc)
                self._send(400, {"error": message})
            except (KeyError, IndexError, TypeError) as exc:
                runs.diagnostic("request_error", path=self.path, traceback=traceback.format_exc())
                self._send(400, {"error": "操作未完成，请检查输入后重试。"})
            except Exception as exc:
                runs.diagnostic("request_error", path=self.path, traceback=traceback.format_exc())
                self._send(500, {"error": "服务暂时无法完成操作，请稍后重试。详细原因已记录在服务日志中。"})

    return Handler


def create_server(root: Path, port: int | None = None, host: str | None = None) -> ThreadingHTTPServer:
    store = DictionaryStore(root)
    from utils.scripts.dictionary_migration import needs_migration
    if needs_migration(root):
        store.migrate_entries()
    from utils.scripts.dictionary_spelling import sync
    sync(root)
    store.entries()
    config = load_server_config(root / "applications" / "vocabulary-atlas")
    return ThreadingHTTPServer((host or config.host, port or config.service_port), make_handler(store, RunManager(root)))


if __name__ == "__main__":
    config = load_server_config(ROOT / "applications" / "vocabulary-atlas")
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["serve", "migrate"])
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--host", default=config.host)
    parser.add_argument("--port", type=int, default=config.service_port)
    args = parser.parse_args()
    store = DictionaryStore(args.root)
    if args.command == "migrate":
        print(json.dumps(store.migrate_entries(), ensure_ascii=False))
    else:
        server = create_server(args.root, args.port, args.host)
        print(f"vocabulary-atlas服务 http://{args.host}:{args.port}", flush=True)
        server.serve_forever()
