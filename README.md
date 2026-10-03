# AI 学习工具箱

[English](README.en.md)

这是 [MySummertime](https://github.com/MySummertime) 维护的学习工具仓库，包含三个本地 Web 应用和一组可供编码 Agent 使用的 Skills。项目主要服务于英语学习、主动回忆和学习资料整理。

本仓库从 [HytidelLegend/htd-ai-augmented-education](https://github.com/HytidelLegend/htd-ai-augmented-education) 发展而来。上游提供了部分 Skills 与基础结构；本仓库对应用、目录、运行环境和文档作了调整与扩展。保留的上游 Skill 名称用于兼容已有调用方式。

## 项目内容

| 路径 | 用途 |
| --- | --- |
| [`applications/`](applications/README.md) | `recitation-studio`、`image-recall-studio`、`vocabulary-atlas` 三个本地应用 |
| [`skills/`](docs/Skills_说明书.md) | 写作、词汇、记忆、语音、格式转换和项目维护等 Agent 工作流 |
| [`docs/`](docs/PRDs/AI辅助教育项目.md) | 需求、架构、贡献和安全文档 |
| [`utils/`](utils/) | 共享脚本与数据结构 |

具体功能与使用条件以各应用的 README 和 [Skills 说明书](docs/Skills_说明书.md) 为准。

## 在 macOS 上运行

需要 Conda。克隆仓库并创建 [`environment.yml`](environment.yml) 定义的环境：

```bash
git clone git@github.com:MySummertime/ai-learning-toolkit.git
cd ai-learning-toolkit
conda env create -f environment.yml
```

安装应用的前端依赖：

```bash
for app in recitation-studio image-recall-studio vocabulary-atlas; do
  (cd "applications/$app" && conda run -n ai-learning-toolkit pnpm install --frozen-lockfile)
done
```

在项目根目录启动所需应用，每个应用使用一个终端窗口：

```bash
./run-macos.sh recitation-studio
./run-macos.sh image-recall-studio
./run-macos.sh vocabulary-atlas
```

按 `Ctrl+C` 停止。更新 Conda 环境时运行 `conda env update -f environment.yml --prune`。其他平台可参考 [运行环境说明](runtime/README.md) 和应用各自的 README。

## 使用 Skills

让 Agent 读取 [AGENTS.md](AGENTS.md) 与 [Skills 说明书](docs/Skills_说明书.md)，再根据任务打开相应的 `skills/<名称>/SKILL.md`。例如，`htd-ai-augmented-education` 是保留的项目路由 Skill，可帮助选择完成学习任务所需的能力。

插件清单位于 `config/plugin/`；不同 Agent 的原生插件目录需要按各自的约定配置。运行产物和日志分别写入 `outputs/` 与 `logs/`，不纳入 Git。

## 维护者、来源与许可

本仓库由 **[MySummertime](https://github.com/MySummertime)** 维护；新增内容及本仓库的改动由 MySummertime 负责。上游原有内容归其原作者 **[HytidelLegend](https://github.com/HytidelLegend/htd-ai-augmented-education)**（Hytidel），其版权声明保留在 [LICENSE](LICENSE) 中。

本仓库沿用上游的 [CC BY-NC 4.0](LICENSE) 许可。分享或改编时，请标明上游来源、许可证及所作修改。该许可不包含商业使用授权；如需商业使用，应向相关权利人取得许可。
