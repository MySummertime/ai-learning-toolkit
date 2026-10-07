# 本地词典资源

内置词表源文件位于 `dictionaries/wordlists/<词表名>/`；完整词典数据保存在本目录，应用不会把本目录的资源当成可选词表。

- **ECDICT**：skywind3000/ECDICT，英汉词典数据库，项目发布许可证为 MIT。来源：https://github.com/skywind3000/ECDICT 。保留原发布者的版权与许可证声明：https://github.com/skywind3000/ECDICT/blob/master/LICENSE 。使用 `translation`、`definition`、`phonetic` 和 `exchange` 字段。
- **Open English WordNet 2025**：Open English WordNet Community，源自 Princeton WordNet。来源：https://en-word.net/downloads ，CC BY 4.0：https://creativecommons.org/licenses/by/4.0/ 。程序将原 WN-LMF 数据转换为 Atlas JSONL，保留词义和关系 ID；转换、筛选及中文整词释义合并属于本项目的修改。

下载地址、资源文件名、版本、目标词表和关系映射在 `applications/vocabulary-atlas/lexicon.json` 中指定。每次导入记录原始文件 SHA256、来源版本及许可证；原始资源不纳入 Git。

## 准备与更新

在仓库根目录执行：

```bash
conda activate ai-learning-toolkit
python -m utils.scripts.dictionary_lexicon --download
```

正常启动 Atlas 会自动准备配置中的资源，已有文件直接使用。需要更新资源时，用新发布文件替换相应资源并修改配置版本，再重启应用。目标词表的导入由文件和配置指纹决定，相同输入复用已有结果。

正式词条写入 `outputs/vocabulary-atlas/dicts/`；覆盖报告在 `outputs/vocabulary-atlas/lexicon/coverage.json`；步骤和错误记录在 `logs/dictionary-lexicon/runs/`。已有非本地导入词条保持原内容。

## 语义范围

同义关系来自同一个 WordNet 义项集；反义关系来自显式 antonym；派生关系来自显式 derivation。近义关系目前仅映射形容词的 similar 义项关系，不表示任意词性的通用近义词。ECDICT 中文释义作为整词释义展示，不充当 WordNet 义项的逐条翻译；没有译文的英文义项和例句明确显示译文缺失。
