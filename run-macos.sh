#!/bin/bash
# macOS 本地启动入口。先在项目根目录完成 README.md 中的 Conda 和 pnpm 依赖安装。
# 在项目根目录执行以下任意一条命令；每个应用占用一个终端窗口，按 Ctrl+C 停止：
#   ./run-macos.sh image-recall-studio
#   ./run-macos.sh recitation-studio
#   ./run-macos.sh vocabulary-atlas
#   ./run-macos.sh vocabulary-atlas --lan
# 每个应用的地址在 applications/<应用名称>/server.json 中配置：
#   host        本机访问时使用的主机名，只允许 127.0.0.1 或 localhost；--lan 用于家庭局域网测试
#   pagePort    浏览器访问端口
#   servicePort 本地 API 服务端口
# 修改 server.json 后，先 Ctrl+C 停止对应应用，再用上面的命令重启。
# 启动器会打印实际的浏览器访问地址。本脚本只接收应用名称；
# 若要临时覆盖前两个应用的端口，可在项目根目录执行：
#   conda activate ai-learning-toolkit
#   python utils/scripts/beitu_runtime.py --preview --port 9901 --service-port 9902
#   python applications/recitation-studio/scripts/start.py --preview --port 9903 --service-port 9904
# 临时覆盖不会改写 server.json；永久更改请编辑相应应用的配置文件。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v conda >/dev/null 2>&1; then
  echo "Conda is required. Install Miniforge or Anaconda first." >&2
  exit 1
fi
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate ai-learning-toolkit
PYTHON="$(command -v python)"
NODE="$(command -v node || true)"

if [[ ! -x "$PYTHON" || -z "$NODE" ]]; then
  echo "Python or Node.js is missing from the ai-learning-toolkit Conda environment." >&2
  exit 1
fi

case "${1:-}" in
  recitation-studio)
    exec "$PYTHON" "$ROOT/applications/recitation-studio/scripts/start.py" --preview
    ;;
  image-recall-studio)
    exec "$PYTHON" "$ROOT/utils/scripts/beitu_runtime.py" --preview
    ;;
  vocabulary-atlas)
    shift
    exec "$PYTHON" "$ROOT/applications/vocabulary-atlas/scripts/start.py" --no-browser "$@"
    ;;
  *)
    echo "Usage: ./run-macos.sh {recitation-studio|image-recall-studio|vocabulary-atlas}" >&2
    exit 2
    ;;
esac
