# 内置词表

本目录按用途分开存放内置词表和完整词典资源。每份内置词表独占 `wordlists/<词表名>/` 子目录；词表页扫描 `applications/vocabulary-atlas/config.yaml` 的 `wordlists.directory` 下一级子目录，格式由 `wordlists.formats` 配置。

## 文件来源

- 多份考试词表从 `applications/vocabulary-atlas/dicts/` 集中迁入；另有 IELTS JSON 和 TOEFL TXT 来自原根目录。逐份原始发布来源未记录，文件名不能证明官方发布。
- `IELTS/IELTS_4321.json`、`TOEFL/TOEFL_4510.txt`：原先位于仓库根目录 `dictionaries/`，现已分别归入对应子目录。

这些文件提供单词名称；完整释义、同族、同义及反义等关系需要另行接入词典数据。文件名中的考试名称不表示官方发布或官方认证。

## 增加词表

增加词表时，先在 `wordlists/` 下为它创建独立子目录，再把 UTF-8 源文件放入其中，重载词表页面即可。TXT 每行一个单词；JSON 使用字符串数组或含 `words` 数组的对象；JSONL 每行一个含 `word` 或 `lemma` 的对象。JSON 数组也支持这类对象。空行忽略，重复词去重。词表源文件只保留单词；历史文件中的词性缩写和释义行已清除。后续扫描发现无法识别的词面时，导入程序会跳过并将具体行号记入服务日志。服务用相对路径标识词表，例如 `IELTS/IELTS_4321.json`，因此不同子目录可以有同名文件。

“内置词表”列出 `wordlists/` 下的词表；“我的词表”显示用户创建或导入的词表。项目记录保存来源类型，所以即使用户词表与内置词表同名、内容相同，也仍属于“我的词表”。重复选用同一个内置词表会复用该词表的项目记录及学习记录。

完整词典资源位于 [`resources/`](resources/README.md)，由应用 `lexicon.json` 配置。雅思词表自动接入 ECDICT 释义和 Open English WordNet 义项关系；源词表与完整词典用途不同。
