"""Import configured offline dictionaries into Atlas's authoritative JSONL records."""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

from utils.scripts.dictionary_records import entries, commit_records
from utils.scripts.dictionary_store import DictionaryStore, normalize_lemma, word_id
from utils.scripts.dictionary_wordlists import prepare_wordlist
from utils.scripts.file_transaction import project_lock
from utils.scripts.structured_io import write_text_atomic
from utils.scripts.timestamp import iso_timestamp, unique_filename_timestamp

IMPORTER_VERSION = 1
POS = {'n': 'noun', 'v': 'verb', 'a': 'adjective', 's': 'adjective', 'r': 'adverb'}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable(prefix: str, *parts: str) -> str:
    return prefix + digest(json.dumps(parts, ensure_ascii=False).encode())[:20]


def load_config(root: Path) -> dict:
    config = json.loads((root / 'applications/vocabulary-atlas/lexicon.json').read_text(encoding='utf-8'))
    if config['schemaVersion'] != '1.0':
        raise ValueError('本地词典配置版本不支持')
    for resource in config['resources'].values():
        path = (root / resource['file']).resolve()
        if not path.is_relative_to((root / 'dictionaries').resolve()):
            raise ValueError('本地词典资源须位于 dictionaries 中')
    return config


def _configured_sources(root: Path, config: dict) -> dict[str, Path]:
    paths = {resource['file']: root / resource['file'] for resource in config['resources'].values()}
    paths.update({name: root / name for name in config['wordlists']})
    if any(not path.resolve().is_relative_to((root / 'dictionaries').resolve()) for path in paths.values()):
        raise ValueError('本地词典来源须位于 dictionaries 中')
    return paths


def _file_signatures(paths: dict[str, Path]) -> dict[str, dict[str, int]]:
    return {name: {'size': path.stat().st_size, 'modifiedNs': path.stat().st_mtime_ns}
            for name, path in paths.items()}


def _store_signatures(root: Path) -> dict[str, dict[str, int]]:
    paths = {path.name: path for path in sorted((root / 'outputs/vocabulary-atlas/dicts').glob('?.jsonl'))}
    return _file_signatures(paths)


def _imported_ids_exist(root: Path, wanted: set[str]) -> bool:
    if not wanted:
        return True
    found = set()
    for path in (root / 'outputs/vocabulary-atlas/dicts').glob('?.jsonl'):
        with path.open(encoding='utf-8') as source:
            for line in source:
                value = json.loads(line)
                if value.get('wordId') in wanted:
                    found.add(value['wordId'])
                    if found == wanted:
                        return True
    return False


def configured_dictionary(root: Path) -> tuple[dict | None, bool]:
    """Return the coverage report and whether its configured inputs are ready."""
    root = root.resolve()
    report_path = root / 'outputs/vocabulary-atlas/lexicon/coverage.json'
    if not report_path.is_file():
        return None, False
    config = load_config(root)
    try:
        report = json.loads(report_path.read_text(encoding='utf-8'))
    except json.JSONDecodeError:
        return None, False
    sources = _configured_sources(root, config)
    if any(not path.is_file() for path in sources.values()):
        return report, False
    signatures = _file_signatures(sources)
    config_fingerprint = digest(json.dumps({'config': config, 'importerVersion': IMPORTER_VERSION}, sort_keys=True).encode())

    if report.get('configurationFingerprint') == config_fingerprint:
        if report.get('sourceFiles') != signatures:
            return report, False
    else:
        hashes = {site: digest((root / resource['file']).read_bytes()) for site, resource in config['resources'].items()}
        fingerprint = digest(json.dumps({'config': config, 'resources': hashes,
            'wordlists': {name: digest((root / name).read_bytes())
                          for name in config['wordlists']}, 'importerVersion': IMPORTER_VERSION}, sort_keys=True).encode())
        if report.get('fingerprint') != fingerprint:
            return report, False

    store_signatures = _store_signatures(root)
    if report.get('storeFiles') != store_signatures:
        imported = set(report.get('importedWordIds', []))
        if not _imported_ids_exist(root, imported):
            return report, False
        report.update(configurationFingerprint=config_fingerprint, sourceFiles=signatures, storeFiles=store_signatures)
        write_text_atomic(report_path, json.dumps(report, ensure_ascii=False, indent=2))
    elif not report.get('configurationFingerprint'):
        report.update(configurationFingerprint=config_fingerprint, sourceFiles=signatures)
        write_text_atomic(report_path, json.dumps(report, ensure_ascii=False, indent=2))
    return report, True


def download_resources(root: Path, config: dict) -> None:
    for resource in config['resources'].values():
        path = root / resource['file']
        if path.is_file():
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + '.download')
        print(f"正在下载本地词典：{path.name}", flush=True)
        with urllib.request.urlopen(resource['downloadUrl'], timeout=120) as response, temporary.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        temporary.replace(path)


def read_wordnet(path: Path) -> tuple[dict, dict, dict]:
    by_word, senses, synsets = defaultdict(list), {}, {}
    with gzip.open(path, 'rb') as source:
        for _, node in ET.iterparse(source, events=('end',)):
            if node.tag == 'LexicalEntry':
                lemma_node = node.find('Lemma')
                lemma = normalize_lemma(lemma_node.attrib['writtenForm'])
                for sense in node.findall('Sense'):
                    value = {'id': sense.attrib['id'], 'lemma': lemma,
                             'pos': POS[lemma_node.attrib['partOfSpeech']],
                             'synset': sense.attrib['synset'],
                             'relations': [(rel.attrib['relType'], rel.attrib['target']) for rel in sense.findall('SenseRelation')]}
                    by_word[lemma].append(value)
                    senses[value['id']] = value
                node.clear()
            elif node.tag == 'Synset':
                synsets[node.attrib['id']] = {
                    'definition': node.findtext('Definition'),
                    'examples': [example.text for example in node.findall('Example') if example.text],
                    'relations': [(rel.attrib['relType'], rel.attrib['target']) for rel in node.findall('SynsetRelation')]}
                node.clear()
    members = defaultdict(list)
    for sense in senses.values():
        members[sense['synset']].append(sense)
    return by_word, senses, {sid: {**value, 'members': members[sid]} for sid, value in synsets.items()}


def import_configured(root: Path, *, download: bool = False) -> dict:
    root = root.resolve()
    config = load_config(root)
    if download:
        download_resources(root, config)
    hashes = {site: digest((root / resource['file']).read_bytes()) for site, resource in config['resources'].items()}
    wordlists = [root / name for name in config['wordlists']]
    if any(not path.resolve().is_relative_to((root / 'dictionaries').resolve()) for path in wordlists):
        raise ValueError('接入词表须位于 dictionaries 中')
    fingerprint = digest(json.dumps({'config': config, 'resources': hashes,
                                    'wordlists': {name: digest(path.read_bytes()) for name, path in zip(config['wordlists'], wordlists)},
                                    'importerVersion': IMPORTER_VERSION}, sort_keys=True).encode())
    report_path = root / 'outputs/vocabulary-atlas/lexicon/coverage.json'
    store = DictionaryStore(root)
    old = store.entries()
    if report_path.is_file():
        try:
            report = json.loads(report_path.read_text(encoding='utf-8'))
        except json.JSONDecodeError:
            report = None
        if report and report.get('fingerprint') == fingerprint and all(wid in old for wid in report.get('importedWordIds', [])):
            return report
    logs = root / 'logs/dictionary-lexicon/runs'
    run_id = unique_filename_timestamp(path.name for path in logs.iterdir()) if logs.is_dir() else unique_filename_timestamp([])
    run = logs / run_id
    run.mkdir(parents=True)
    stamp = iso_timestamp()

    def status(phase: str) -> None:
        write_text_atomic(run / 'state.json', json.dumps({'status': phase, 'updatedAt': iso_timestamp(), 'fingerprint': fingerprint}, ensure_ascii=False))

    try:
        status('reading_sources')
        words = list(dict.fromkeys(word for path in wordlists for word in prepare_wordlist(path)[0]))
        wanted = set(words)
        ecdict = {}
        with (root / config['resources']['ecdict']['file']).open(encoding='utf-8-sig', newline='') as source:
            for row in csv.DictReader(source):
                lemma = normalize_lemma(row['word'])
                if lemma in wanted:
                    ecdict[lemma] = row
        by_word, all_senses, synsets = read_wordnet(root / config['resources']['wordnet']['file'])
    
        def source(site: str, locator: str, summary: str) -> list[dict]:
            resource = config['resources'][site]
            return [{'site': site, 'url': resource['sourceUrl'], 'locator': locator,
                     'collectedAt': stamp, 'summary': summary[:160], 'version': resource['version'],
                     'license': resource['license'], 'resourceSha256': hashes[site]}]
    
        def item(text: str, refs: list[dict], key: str) -> dict:
            return {'itemId': stable('i_', key), 'text': text, 'generationMethod': 'source_supported',
                    'verificationStatus': 'automatic_passed', 'sourceRefs': refs}
    
        status('converting_entries')
        generated, missing, preserved, invalid_forms = {}, [], [], []
        for lemma in words:
            wid = word_id(lemma)
            if wid in old and 'lexicalImport' not in old[wid]:
                preserved.append(lemma)
                continue
            row = ecdict.get(lemma)
            word_senses = by_word.get(lemma, [])
            if not word_senses and (not row or not (row['translation'].strip() or row['definition'].strip())):
                missing.append(lemma)
                continue
            refs = source('ecdict', f"word={lemma}", '整词释义；未与 WordNet 义项逐条对齐')
            entry = {'schemaVersion': '1.6', 'wordId': wid, 'lemma': lemma, 'aliases': [], 'familyId': wid,
                     'pronunciations': [], 'inflections': [], 'derivatives': [], 'senses': [],
                     'relationships': [], 'pendingRelations': [], 'revision': old[wid]['revision'] + 1 if wid in old else 1,
                     'createdAt': old[wid]['createdAt'] if wid in old else stamp, 'updatedAt': stamp,
                     'lexicalImport': {'fingerprint': fingerprint, 'importerVersion': IMPORTER_VERSION}}
            if row and row['translation'].strip():
                entry['dictionaryGlossZh'] = item(row['translation'].replace('\\n', '\n').strip(), refs, lemma + ':gloss')
            if row and row['phonetic'].strip():
                entry['pronunciations'] = [{'pronunciationId': stable('p_', lemma), 'variety': 'other',
                                            'ipa': item(row['phonetic'].strip(), refs, lemma + ':ipa'), 'sourceRefs': refs}]
            if row:
                for exchange in row['exchange'].split('/'):
                    if not exchange:
                        continue
                    code, form = exchange.split(':', 1)
                    if code not in config['exchangeKinds'] or normalize_lemma(form) == lemma:
                        continue
                    try:
                        word_id(form)
                    except ValueError:
                        invalid_forms.append({'word': lemma, 'exchange': exchange})
                        continue
                    entry['inflections'].append({'formId': stable('f_', lemma, code, form), 'kind': config['exchangeKinds'][code],
                                                  'form': item(form, refs, lemma + ':form:' + code), 'sourceRefs': refs})
            for ordinal, sense in enumerate(word_senses):
                synset = synsets[sense['synset']]
                sense_refs = source('wordnet', sense['id'] + ';synset=' + sense['synset'], synset['definition'])
                entry['senses'].append({'senseId': stable('s_', sense['id']), 'partOfSpeech': sense['pos'],
                    'sourceOrders': [{'site': 'wordnet', 'ordinal': ordinal}],
                    'definitionEn': item(synset['definition'], sense_refs, sense['id'] + ':definition'),
                    'grammarTags': [], 'registerTags': [],
                    'examples': [item(text, sense_refs, sense['id'] + ':example:' + str(index)) for index, text in enumerate(synset['examples'])],
                    'collocations': [], 'phrases': []})
            if not entry['senses']:
                sense = {'senseId': stable('s_', 'ecdict', lemma), 'partOfSpeech': '综合', 'sourceOrders': [{'site': 'ecdict', 'ordinal': 0}],
                         'grammarTags': [], 'registerTags': [], 'examples': [], 'collocations': [], 'phrases': []}
                for field, column in [('definitionZh', 'translation'), ('definitionEn', 'definition')]:
                    if row[column].strip():
                        sense[field] = item(row[column].replace('\\n', '\n').strip(), refs, lemma + ':' + column)
                entry['senses'].append(sense)
            generated[wid] = entry
        status('converting_relations')
        for entry in generated.values():
            lemma = entry['lemma']
            relations, derivatives = {}, {}
            for sense in by_word.get(lemma, []):
                synset = synsets[sense['synset']]
                targets = [('synonym', target, 'same_synset') for target in synset['members']]
                for raw_type, target in sense['relations']:
                    if raw_type in config['relations']:
                        targets.append((config['relations'][raw_type], all_senses[target], raw_type))
                for raw_type, target_synset in synset['relations']:
                    if raw_type == 'similar' and sense['pos'] == 'adjective':
                        targets.extend((config['relations'][raw_type], target, 'similar_adjective') for target in synsets[target_synset]['members'])
                for kind, target, evidence in targets:
                    target_lemma = target['lemma']
                    if target_lemma == lemma:
                        continue
                    try:
                        target_id = word_id(target_lemma)
                    except ValueError:
                        continue
                    refs = source('wordnet', sense['id'] + '->' + target['id'] + ':' + evidence,
                                  '形容词义项相似，非通用近义词' if evidence == 'similar_adjective' else evidence)
                    if kind == 'family':
                        value = {'derivativeId': stable('d_', lemma, target_lemma), 'word': target_lemma,
                                 'status': 'linked' if target_id in generated else 'candidate',
                                 'verificationStatus': 'automatic_passed', 'sourceRefs': refs}
                        if target_id in generated:
                            value['targetWordId'] = target_id
                        derivatives[target_lemma] = value
                        continue
                    target_sid = stable('s_', target['id'])
                    linked = target_id in generated and any(s['senseId'] == target_sid for s in generated[target_id]['senses'])
                    value = {'relationshipId': stable('r_', kind, sense['id'], target['id']), 'type': kind,
                             'sourceSenseId': stable('s_', sense['id']), 'targetLemma': target_lemma,
                             'targetSenseHint': synsets[target['synset']]['definition'],
                             'linkStatus': 'linked' if linked else 'lemma_only',
                             'verificationStatus': 'automatic_passed', 'sourceRefs': refs}
                    if linked:
                        value.update(targetWordId=target_id, targetSenseId=target_sid)
                    relations[value['relationshipId']] = value
            entry['derivatives'] = list(derivatives.values())
            entry['relationships'] = list(relations.values())
        status('validating_entries')
        for value in generated.values():
            store.entry_validator.validate(value)
        status('publishing_entries')
        collection = entries(root)
        if generated:
            commit_records({collection / (wid + '.json'): json.dumps(value, ensure_ascii=False) for wid, value in generated.items()})
        final = store.entries()
        counts = Counter()
        covered = Counter()
        internal = Counter()
        wanted_ids = {word_id(word) for word in words}
        for word in words:
            value = final.get(word_id(word))
            if value is None:
                continue
            covered['entries'] += 1
            if value.get('dictionaryGlossZh') or any(s.get('definitionZh') for s in value['senses']):
                covered['chinese'] += 1
            if any(s.get('definitionEn') for s in value['senses']):
                covered['english'] += 1
            kinds = set()
            for relation in value['relationships']:
                counts[relation['type']] += 1
                kinds.add(relation['type'])
                if word_id(relation['targetLemma']) in wanted_ids:
                    internal[relation['type']] += 1
            counts['family'] += len(value['inflections']) + len(value['derivatives'])
            for derivative in value['derivatives']:
                if word_id(derivative['word']) in wanted_ids:
                    internal['family'] += 1
            if value['inflections'] or value['derivatives']:
                kinds.add('family')
            for kind in kinds:
                covered[kind] += 1
        report = {'generatedAt': iso_timestamp(), 'fingerprint': fingerprint, 'runId': run_id,
                  'configurationFingerprint': digest(json.dumps({'config': config, 'importerVersion': IMPORTER_VERSION}, sort_keys=True).encode()),
                  'sourceFiles': _file_signatures(_configured_sources(root, config)), 'storeFiles': _store_signatures(root),
                  'wordlists': config['wordlists'], 'totalWords': len(words), 'coverage': dict(covered),
                  'relations': dict(counts), 'withinWordlistRelations': dict(internal), 'missingWords': missing,
                  'preservedEntries': preserved, 'invalidSourceForms': invalid_forms, 'importedWordIds': sorted(generated),
                  'resources': {site: {**resource, 'sha256': hashes[site]} for site, resource in config['resources'].items()},
                  'nearSynonymScope': 'WordNet 形容词义项 similar 关系；未推断其他词性的近义关系'}
        write_text_atomic(report_path, json.dumps(report, ensure_ascii=False, indent=2))
        status('completed')
        return report
    except Exception as exc:
        write_text_atomic(run / 'state.json', json.dumps({'status': 'failed', 'updatedAt': iso_timestamp(), 'fingerprint': fingerprint, 'error': str(exc)}, ensure_ascii=False))
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description='自动接入配置中的本地词典和词表')
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    with project_lock(args.root / 'logs/dictionary-lexicon/import.lock', 'dictionary-lexicon'):
        report = import_configured(args.root, download=args.download)
    print(json.dumps({key: value for key, value in report.items() if key not in ('importedWordIds', 'resources')}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
