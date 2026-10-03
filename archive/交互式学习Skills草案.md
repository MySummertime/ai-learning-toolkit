# 交互式学习 Skills 草案（未发布）

以下设计保留作历史参考。两个 beta Skill 当前未包含在仓库，也未注册；其命令与配置不能直接运行。

### beta-build-curriculum-navigation

所有导师调用前必须先调用本 Skill：有效导航用 `verify`，新资料或目标变化用构建/增量流程。背景不足在对话中讨论，不生成询问背景的课程。导航图是知识点图。脚本采用目标优先自适应探测，默认最多 5 道诊断选择题（四个实质选项＋末尾不确定选项），未测区域保持未知；配置位于 Skill 的 `config.yaml`。

脚本生成最多 10 条候选序列，保留全部实际生成候选及历史，按权重计算分项和总分并非升序排列。默认权重为目标 40%、背景 30%、难度 15%、主题 10%、解锁 5%。参数冻结在日志运行目录，每次继续比较、更新并提示变化。

```yaml
scenario_examples:
  - id: build-course-order
    user_request: "根据这些资料建立学习导航"
    when_to_call: "规划、增量维护，或每次导师调用前校验导航"
    invocation: "prepare → resolve-source/resolve → diagnostic-start/question/answer → resolve-ordering → commit → verify"
    expected_output: "知识点依赖图、诊断、全部评分候选和确定性 Markdown"
```

状态为 `prepared → source_navigation_fragment_required → all_source_navigation_fragments_ready → ordering_decision_required → awaiting_approval → completed`；诊断子状态为 `question_required → awaiting_answer → question_required/completed`，环或错误进入相应暂停。Agent 只填写小补丁、出题及必要语义判断，Python 扩充 JSON 和 Markdown。正式导航位于 `outputs/beta-build-curriculum-navigation/runs/<run-id>/`，日志位于对应 `logs/`。完整契约见 `.agents/skills/beta-build-curriculum-navigation/SKILL.md`。

### beta-interactive-tutor

未指定导航或已有导师项目时，执行 `start --root .` 或 `list-projects --root .`，共享 `utils/scripts/learning_project_selection.py` 只读发现本地导航 run，仅展示已完成且有效的导航；单候选也等待用户选择。Python 按 `learning-project-catalog-v1.schema.json` 生成“序号｜项目名称｜run ID｜更新时间｜状态｜已有导师项目数”，Agent 仅转交序号或候选 ID。有关联导师项目时再列出已有项目与“新建”选项，保留现有材料备份、作答及答疑门禁。

入口状态机为 `discovering_projects → awaiting_project_selection → validating_selection → awaiting_tutor_selection（可选）→ validating_selection → project_resolved`；无候选为 `navigation_required`。等待返回退出码 3；清单变化则刷新重选。新增 `select-project`、`select-tutor` 与 `resume-selection`，清单和选择状态保存在导师 `logs/` run，支持默认发布目录及日志登记的自定义导航路径。完整字段、命令参数及恢复规则见导师 Skill。

导航 run 检查点须通过 Schema 校验，同路径按最新 run 状态筛选，未完成或损坏状态不能经默认输出目录绕过筛选；同秒 run 后缀按数值排序。选择状态与清单同事务保存并支持失败回滚；恢复时清单未变则保留当前阶段与已选导航，避免重新询问第一阶段。

两个学习 skill 共用 `utils/scripts/learning_material_backup.py` 和 `learning-material-backup-v1.schema.json`：导师项目在 `学习材料/` 逐字节备份 Markdown 及引用的本地资源，清单在 `artifacts/学习材料备份.json`，原文件只读。备份子状态机为 `planning_backup → awaiting_backup_approval → copying_materials → verifying_backup → backup_ready`；错误暂停并保留检查点。初次创建或旧项目补建需一次性批准路径清单，以 `resume --backup-plan-sha256 <hash>` 恢复；教学状态从 `backup_required` 转为 `ready`。已有副本的每次导航校验使用 `verify --material-project <学习项目目录>`；教学和图片指引使用副本，原文件变化通过导航增量及 `supply-navigation` 显式引入，保留材料历史版本。新资料同步同样确认计划哈希，副本损坏或目标冲突暂停处理，不自动回退源文件。

必须使用已完成新版导航，删除导师独立入学诊断及直接资料入口。每次调用先执行导航校验；课程与知识点是多对多关系，两张依赖图分别维护。未显式跳过知识点必须有有效课程覆盖，课程内外顺序都满足前置约束，主线基础不能留作可选支线。

备份子状态迁移由脚本校验，冲突停在 `paused_backup_conflict`；复制忽略代码示例和未使用引用定义，批准路径包括正式及历史清单。新清单与项目 JSON/Markdown 同事务发布，失败回滚；初始化失败保留待备份检查点。原始输入与写入路径重合时拒绝执行，材料产物不得进入 `runtime/` 或 `logs/`。

```yaml
scenario_examples:
  - id: learn-one-material
    user_request: "继续课程并批改我的答案"
    when_to_call: "基于导航开始或继续教学、作答、答疑、记笔记或调整路线"
    invocation: "导航 verify → start/resume → prepare-lesson → publish-lesson → check-answers/submit-chat-answer → review-answers → questions → 用户明确无疑问 → prepare-lesson"
    expected_output: "中文课程、双图学习路线、逐课总结与报告、确认后的笔记和规律型错题本"
```

默认每课最多 3 个知识点、3 道正式选择题、2 道问答题，每个本课知识点均需正式习题检验。引导和追问不计入。良好 ≥80%、中等 ≥60%、其余一般，无评分证据单列。配置与播客占位开关位于 Skill 的 `config.yaml`，冻结、更新及通知规则同导航。

状态为 `ready → lesson_decision_required → awaiting_answer → review_decision_required → awaiting_questions → ready/completed`。批改后先反馈掌握优缺点并更新文档，询问疑问；用户明确没有疑问前，不准备下一课。笔记先展示整理稿，确认后写入；错题自动归并薄弱点、规律、纠正与例题。

项目根目录只留 `项目.json`、`学习路线.md`、`总结.md`、`学习报告.md`、`笔记本.md`、`错题本.md`；课程在 `课程/课程_X-Y.md`，其余 JSON 在 `artifacts/` 和 `artifacts/lessons/`。先落盘 JSON（含参考答案）再渲染 Markdown，题目视图不显示答案。运行状态与中间模板继续位于日志目录。支持 `plan`、`skip/restore`、`supply-navigation` 维护计划、消费网页指令和同步双图。完整 CLI 及模板契约见 `.agents/skills/beta-interactive-tutor/SKILL.md`。 未发布课程可退回规划拆分，恢复后重新发布保留旧版本；显式跳过当前未批改课程允许选择后续课程，已经作答仍先批改并答疑。笔记确认同时校验草稿与来源哈希，每个薄弱知识点都有错题归纳。

导师 `学习路线.md` 新增知识点、课程双 Mermaid `flowchart LR` 思维导图，不调用生图工具。Python 从现有双图按 `utils/references/dependency-flowchart-v1.schema.json` 和 `utils/templates/dependency-flowchart.template.md` 自动构造节点与边；知识点显示名称和状态，课程显示编号、标题、主支线和状态，完整保留多前置、孤立及已跳过节点，退出课程不展示。导航、计划或状态变化时，双图随 JSON 和依赖表同事务发布；`verify` 检查图示一致性，旧项目用 `resume` 补齐。

文档生成子状态机为 `prepared → validating_graphs → rendering_documents → verifying_documents → publishing → completed`；失败进入 `paused_error`，检查点在导师日志的 `document-render/state.json`。恢复读取并校验未完成检查点，保留失败和中断历史后重新校验权威 JSON；损坏检查点拒绝覆盖，不绕过教学及答疑门禁。教学状态检查点和计划模板随项目文档同事务保存，失败不推进内存模型版本。共享实现位于 `utils/scripts/mermaid_flowchart.py`，恢复能力复用 `utils/scripts/workflow_checkpoint.py`。
