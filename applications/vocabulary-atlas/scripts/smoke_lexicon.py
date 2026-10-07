"""Verify offline source conversion, sense links, idempotence and existing records."""
import csv
import gzip
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from utils.scripts.dictionary_lexicon import import_configured
from utils.scripts.dictionary_store import DictionaryStore, word_id
from utils.scripts.dictionary_records import entries, commit_records
from utils.scripts.dictionary_graph import project_graph
from utils.scripts.dictionary_store import normalize_lemma


def fixture(root: Path) -> None:
    for relative in ['applications/vocabulary-atlas/config.yaml', 'applications/vocabulary-atlas/lexicon.json',
                     '.agents/skills/build-word-entry/references/entry.schema.json', 'utils/references/dictionary-graph-v1.schema.json']:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, path)
    resources = root / 'dictionaries/resources'
    wordlist = root / 'dictionaries/wordlists/IELTS'
    resources.mkdir(parents=True)
    wordlist.mkdir(parents=True)
    (wordlist / 'IELTS_4321.json').write_text(json.dumps(['happy', 'glad', 'sad', 'happiness', 'pleased', 'missing']))
    with (resources / 'ecdict.csv').open('w', newline='') as output:
        writer = csv.DictWriter(output, fieldnames=['word','definition','translation','phonetic','exchange'])
        writer.writeheader()
        for word, zh in [('happy','高兴的'),('glad','高兴的'),('sad','悲伤的'),('happiness','幸福'),('pleased','满意的')]:
            writer.writerow({'word':word,'definition':word,'translation':zh,'phonetic':'','exchange':'r:happier/t:' if word=='happy' else ''})
    xml = '''<LexicalResource><Lexicon>
<LexicalEntry><Lemma writtenForm="happy" partOfSpeech="a"/><Sense id="happy-a" synset="joy-a"><SenseRelation relType="antonym" target="sad-a"/><SenseRelation relType="derivation" target="happiness-n"/></Sense></LexicalEntry>
<LexicalEntry><Lemma writtenForm="glad" partOfSpeech="a"/><Sense id="glad-a" synset="joy-a"/></LexicalEntry>
<LexicalEntry><Lemma writtenForm="sad" partOfSpeech="a"/><Sense id="sad-a" synset="sadness-a"><SenseRelation relType="antonym" target="happy-a"/></Sense></LexicalEntry>
<LexicalEntry><Lemma writtenForm="happiness" partOfSpeech="n"/><Sense id="happiness-n" synset="joy-n"><SenseRelation relType="derivation" target="happy-a"/></Sense></LexicalEntry>
<LexicalEntry><Lemma writtenForm="pleased" partOfSpeech="a"/><Sense id="pleased-a" synset="pleasure-a"/></LexicalEntry>
<Synset id="joy-a"><Definition>feeling pleasure</Definition><Example>she is happy</Example><SynsetRelation relType="similar" target="pleasure-a"/></Synset>
<Synset id="sadness-a"><Definition>feeling sorrow</Definition></Synset>
<Synset id="joy-n"><Definition>a state of well-being</Definition></Synset>
<Synset id="pleasure-a"><Definition>feeling satisfied</Definition></Synset>
</Lexicon></LexicalResource>'''
    with gzip.open(resources / 'english-wordnet-2025.xml.gz', 'wt') as output:
        output.write(xml)


def main() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        fixture(root)
        first = import_configured(root)
        assert first['missingWords'] == ['missing']
        assert len(first['invalidSourceForms']) == 1
        assert first['coverage']['chinese'] == 5
        store = DictionaryStore(root)
        assert word_id("mr.") == word_id("Mr.")
        assert [row["lemma"] for row in store.project_words("pop-mart\ntv\nv.s.")] == ["pop-mart", "tv", "v.s."]
        records = store.entries()
        happy = records[word_id('happy')]
        assert happy['dictionaryGlossZh']['text'] == '高兴的'
        assert 'definitionZh' not in happy['senses'][0]
        assert 'translationZh' not in happy['senses'][0]['examples'][0]
        assert {r['type'] for r in happy['relationships']} == {'synonym','antonym','near_synonym'}
        assert all(r['targetSenseId'] in {s['senseId'] for s in records[r['targetWordId']]['senses']} for r in happy['relationships'])
        for kind in ['family','synonym','antonym','near_synonym']:
            graph = project_graph(records, {wid:store.summary(value,None) for wid,value in records.items()},
                normalize=normalize_lemma, selected=None, visible={key:key==kind for key in ['family','synonym','antonym','near_synonym','spelling_similar']},
                show_others=False, search='', limit=500, show_outside=False, stage=None,
                project_words=[{'wordId':wid,'lemma':value['lemma']} for wid,value in records.items()])
            assert graph['edges'], kind
        store.config["graph"]["browsing"].update(wordlistGroupSize=2, focusNeighbors=1, expandedNeighbors=3)
        project = store.create_project("分组测试", "happy\nglad\nsad\nhappiness\npleased")
        assert project["origin"] == "user"
        source_file = "dictionaries/wordlists/IELTS/IELTS_4321.json"
        same_words_as_builtin = store.create_project("IELTS · 4321", "happy\nglad\nsad\nhappiness\npleased\nmissing")
        builtin_project = store.create_project("IELTS · 4321", "happy\nglad\nsad\nhappiness\npleased\nmissing",
                                               origin="builtin", source_file=source_file)
        classified = {item["projectId"]: item for item in store.projects()}
        assert classified[same_words_as_builtin["projectId"]]["origin"] == "user"
        assert classified[builtin_project["projectId"]]["origin"] == "builtin"
        assert classified[builtin_project["projectId"]]["sourceFile"] == source_file
        modes = {key: key == "synonym" for key in ["family", "synonym", "antonym", "near_synonym", "spelling_similar"]}
        first_group = store.graph(project_id=project["projectId"], visible=modes)
        second_group = store.graph(project_id=project["projectId"], visible=modes, offset=2)
        assert {word_id("happy"), word_id("glad")} <= {node["wordId"] for node in first_group["nodes"]}
        assert {word_id("sad"), word_id("happiness")} <= {node["wordId"] for node in second_group["nodes"]}
        searched = store.graph(project_id=project["projectId"], visible=modes, search="pleased")
        assert [node["lemma"] for node in searched["nodes"]] == ["pleased"]
        modes = {key: key != "family" for key in modes}
        focused = store.graph(project_id=project["projectId"], selected=word_id("happy"), visible=modes)
        expanded = store.graph(project_id=project["projectId"], selected=word_id("happy"), visible=modes, show_others=True)
        assert len(focused["nodes"]) == 2 and len(expanded["nodes"]) == 4
        before = {path.name:path.read_bytes() for path in store.dicts_dir.glob('*.jsonl')}
        second = import_configured(root)
        assert second['runId'] == first['runId']
        assert before == {path.name:path.read_bytes() for path in store.dicts_dir.glob('*.jsonl')}
        del happy['lexicalImport']
        happy['revision'] += 1
        happy['dictionaryGlossZh']['text'] = '保留手工内容'
        commit_records({entries(root)/(happy['wordId']+'.json'):json.dumps(happy,ensure_ascii=False)})
        config_path = root / 'applications/vocabulary-atlas/lexicon.json'
        config = json.loads(config_path.read_text())
        config['resources']['ecdict']['version'] = 'new-fixture'
        config_path.write_text(json.dumps(config))
        third = import_configured(root)
        assert third['preservedEntries'] == ['happy']
        assert DictionaryStore(root).entry(word_id('happy'))['dictionaryGlossZh']['text'] == '保留手工内容'
        print('PASS offline definitions, no invented translations, sense-level semantic links, four graph modes, source gaps, idempotence, existing entries preserved')


if __name__ == '__main__':
    main()
