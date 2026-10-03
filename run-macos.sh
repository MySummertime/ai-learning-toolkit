#!/bin/bash
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
    exec "$PYTHON" "$ROOT/applications/vocabulary-atlas/scripts/start.py" --no-browser
    ;;
  *)
    echo "Usage: ./run-macos.sh {recitation-studio|image-recall-studio|vocabulary-atlas}" >&2
    exit 2
    ;;
esac
