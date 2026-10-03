# AI Learning Toolkit

[中文](README.md)

[MySummertime](https://github.com/MySummertime) maintains this repository of local learning applications and Agent Skills. Its current focus is English study, active recall, and organizing learning materials.

This repository builds on [HytidelLegend/htd-ai-augmented-education](https://github.com/HytidelLegend/htd-ai-augmented-education). The upstream project supplied some of the Skills and foundational structure. This version changes and extends the applications, layout, runtime setup, and documentation. Upstream Skill names remain where existing workflows depend on them.

## What's included

| Path | Purpose |
| --- | --- |
| [`applications/`](applications/README.md) | Three local apps: `recitation-studio`, `image-recall-studio`, and `vocabulary-atlas` |
| [`skills/`](docs/Skills_说明书.md) | Agent workflows for writing, vocabulary, memory, speech, file conversion, and project maintenance |
| [`docs/`](docs/PRDs/AI辅助教育项目.md) | Requirements, architecture, contribution, and security documents |
| [`utils/`](utils/) | Shared scripts and data structures |

Each application's README and the [Skills guide](docs/Skills_说明书.md) describe its exact capabilities and requirements.

## Run on macOS

Install Conda, then clone the repository and create the environment defined in [`environment.yml`](environment.yml):

```bash
git clone git@github.com:MySummertime/ai-learning-toolkit.git
cd ai-learning-toolkit
conda env create -f environment.yml
```

Install the frontend dependencies:

```bash
for app in recitation-studio image-recall-studio vocabulary-atlas; do
  (cd "applications/$app" && conda run -n ai-learning-toolkit pnpm install --frozen-lockfile)
done
```

From the repository root, start each app you need in a separate terminal:

```bash
./run-macos.sh recitation-studio
./run-macos.sh image-recall-studio
./run-macos.sh vocabulary-atlas
```

Press `Ctrl+C` to stop an app. To update the Conda environment, run `conda env update -f environment.yml --prune`. For other platforms, consult the [runtime guide](runtime/README.md) and the README for each app.

## Use the Skills

Give your Agent access to [AGENTS.md](AGENTS.md) and the [Skills guide](docs/Skills_说明书.md), then load the relevant `skills/<name>/SKILL.md` for the task. The retained `htd-ai-augmented-education` routing Skill can help identify which capabilities a learning request needs.

Plugin manifests live in `config/plugin/`; native plugin installation paths depend on the Agent. Generated results go to `outputs/` and logs to `logs/`. Neither directory is tracked by Git.

## Maintainer, upstream, and license

**[MySummertime](https://github.com/MySummertime)** maintains this repository and is responsible for its new material and modifications. Existing upstream material remains attributed to its original author, **[HytidelLegend](https://github.com/HytidelLegend/htd-ai-augmented-education)** (Hytidel). The upstream copyright notice remains in [LICENSE](LICENSE).

This repository follows the upstream [CC BY-NC 4.0](LICENSE) license. When sharing or adapting it, credit the upstream source, link the license, and identify your changes. Commercial use is outside that license and requires permission from the relevant rights holders.
