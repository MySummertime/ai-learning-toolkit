"""Read the application's configured builtin wordlists."""
from pathlib import Path
import json


def wordlist_files(root: Path, config: dict) -> list[Path]:
    directory = root / config["wordlists"]["directory"]
    if not directory.is_dir():
        raise FileNotFoundError("内置词表目录不存在")
    formats = config["wordlists"]["formats"]
    return sorted(file for folder in directory.iterdir() if folder.is_dir()
                  for file in folder.iterdir() if file.is_file() and file.suffix.lstrip(".") in formats)


def prepare_wordlist(file: Path) -> tuple[list[str], list[dict]]:
    from utils.scripts.dictionary_store import normalize_lemma, word_id
    text = file.read_text(encoding="utf-8-sig")
    if file.suffix == ".txt":
        records = text.splitlines()
    elif file.suffix == ".json":
        value = json.loads(text)
        records = value["words"] if isinstance(value, dict) else value
    elif file.suffix == ".jsonl":
        records = [json.loads(line) for line in text.splitlines() if line.strip()]
    else:
        raise ValueError("不支持的内置词表格式")
    if not isinstance(records, list):
        raise ValueError("词表内容须为数组")
    words, skipped = [], []
    for number, record in enumerate(records, 1):
        if isinstance(record, str):
            value = record
        elif isinstance(record, dict):
            value = record["word"] if "word" in record else record["lemma"]
        else:
            raise ValueError(f"词表第 {number} 项须为单词或词条对象")
        lemma = normalize_lemma(value)
        if not lemma:
            continue
        try:
            word_id(lemma)
            words.append(lemma)
        except ValueError:
            skipped.append({"line": number, "text": value, "reason": "不是受支持的英文词面"})
    return list(dict.fromkeys(words)), skipped


def wordlist_name(file: Path) -> str:
    return file.stem.replace("_", " · ")
