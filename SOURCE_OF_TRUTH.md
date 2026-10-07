# 权威来源

- 项目行为边界：`CODE_OF_CONDUCT.md`
- Agent 执行规则：`AGENTS.md`
- 即开即用学习应用：`applications/` 及各应用子目录中的 `README.md`
- skill 公开契约：各 `.agents/skills/<skill-name>/SKILL.md`
- 共享实现和 Schema：`utils/`
- 正式运行产物：`outputs/<skill-name>/runs/<run-id>/`
- 运行日志与状态：`logs/<skill-name>/runs/<run-id>/`，仅供本地审计且不提交 Git
- 项目目标和验收标准：`docs/PRDs/`
- 时间戳格式与生成实现：`utils/scripts/timestamp.py`；项目统一使用本地时间、不带时区的 `YYYY-MM-DDTHH:MM:SS`，文件名使用 `YYYYMMDDTHHMMSS` 及必要的 `_1`、`_2` 冲突后缀

## 内置词表

仓库根目录 `dictionaries/wordlists/<词表名>/` 每个子目录保存一份内置词表，扫描目录及格式由 `applications/vocabulary-atlas/config.yaml` 的 `wordlists` 指定。共享完整词典资源保存在 `dictionaries/resources/`。应用不保存另一份内置词表。用户选择后的项目记录及学习进度保存于 `outputs/vocabulary-atlas/`；正式词条的释义与关系仍以其中的分桶 JSONL 为权威来源。

本地词典原始资源位于 `dictionaries/resources/`，接入配置为 `applications/vocabulary-atlas/lexicon.json`。派生词条写入同一正式 JSONL 词库，不增加第二个可编辑词条存储；覆盖报告只作为接入审计结果。
