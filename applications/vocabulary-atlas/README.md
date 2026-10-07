# vocabulary-atlas

本机单用户词典、词汇地图和背诵计划应用。词条与收藏跨词表共用，地图提供查词聚焦与词表分组两种浏览流程。

词典页搜索所有项目词表和已建词条，按完整匹配、前缀匹配、其他包含匹配排序，同一匹配层级内当前项目优先；未归属任何项目的已建词条也可查询。单词页的直接来源词形与派生词审核状态来自 `outputs/vocabulary-atlas/family-reviews/`。规则推导词形保存在词条内，标注“规则推导 · 待核验”；没有直接来源候选且没有规则形式时显示“已复核现有证据 · 暂无可发布内容”。

项目页可预览词表，在设置对话框中编辑项目名及每行一个单词的词表。保存时去重并保持顺序；词集合变化且存在计划时，可选择重新生成排程并清空通过记录，或保留旧排程。有关联计划的项目须先处理计划才能删除；删除项目保留总词库中的单词笔记。图谱工具栏提供“初始化”，将当前项目的画布节点散布在中心附近并重新执行力学布局。`config.yaml` 的 `graph.initializeOnEnter` 默认开启，每次进入图谱时执行初始化。

## 启动

服务器地址在本目录的 `server.json` 中配置：`host` 是本机主机名，`pagePort` 是浏览器端口，`servicePort` 是本地 API 端口。修改后重启应用；`host` 只能是 `127.0.0.1` 或 `localhost`，两个端口不能相同。macOS 在仓库根目录执行 `./run-macos.sh vocabulary-atlas`。家庭局域网测试运行 `./run-macos.sh vocabulary-atlas --lan`，终端会打印其他设备可访问的地址；局域网设备与 Mac 必须在同一可信网络，且防火墙允许 Python 和 Node.js 接收入站连接。按 Ctrl+C 停止。局域网设备共用这台 Mac 上的词表、收藏与学习数据。

在本目录运行 `npm ci`，然后运行：

```powershell
.\run.ps1
```

`run.ps1` 同时启动本地 API 与 Vite 前端并打开浏览器；不要直接打开 `index.html`。访问地址由 `server.json` 配置，启动器会打印实际地址。再次运行时会停止占用这两个端口的旧vocabulary-atlas进程，等待端口释放后重新启动；若端口被其他程序占用则报错。Ctrl+C 停止。可用 `-NoBrowser` 只启动服务而不自动打开浏览器。

## 旧词库迁移

首次使用前运行 `runtime/.venv/Scripts/python.exe applications/vocabulary-atlas/scripts/service.py migrate`。该命令校验旧 `outputs/英文词典/entries/`，导入 `outputs/vocabulary-atlas/dicts/a.jsonl` 至 `z.jsonl`，并按修订号对账旧词条：较新修订进入唯一 JSONL 词库，同修订但内容不同则暂停。迁移验证及原文件指纹复核通过后清理旧 `entries/`，恢复检查点和归档快照保存在 `logs/dictionary-migration/runs/`。

## 数据与恢复

权威词条保存在 `outputs/vocabulary-atlas/dicts/a.jsonl` 至 `z.jsonl`，词条 Schema 支持 1.3 至 1.6。词表保存在 `projects/<projectId>/project.json`；背诵计划保存在 `plans/<planId>.json`。全局收藏、界面状态分别保存在 `favorites-state.json`、`ui-state.json`。状态更新检查修订号后原子写入。界面颜色和图谱参数统一读取 `config.yaml`。

词条构建采集 Cambridge、Oxford、Longman 和 Thesaurus.com。相同词性及英文释义的跨词典证据由脚本自动对齐；其余义项使用现有结构化复核流程确认，冲突时暂停。既有词条的来源引用不会因代码更新而改写。

状态文件与阶段文件的空模板可由 `runtime/.venv/Scripts/python.exe -m utils.scripts.dictionary_contract template --kind stage --stage-id <阶段ID> --label <名称> --output <目标路径>` 生成；`--kind` 也可取 `favorites`、`ui`、`project`；项目空模板需指定 `--project-id` 与 `--label`。项目词表经导入接口规范化和校验后填充。阶段词汇及义项引用需在提供正式词表后填写并校验，不从空模板推断词表。

待补齐的单词只展示已有候选关联，不展示猜测释义，也不要求普通用户建立词条、处理浏览器验证或填写 JSON。词库维护由后台流程负责。

图谱总览显示当前项目词表中的单词、可见节点间的关系，以及这些词已发布的来源证实词形、规则推导待核验词形和派生词节点；选中单词后展开其直接同族词和关联词。项目词表中的未建词条显示为待建节点，同族节点通过引力聚拢、间距约束和外围圆分组，绘制同族连线；其他待核验连接使用虚线。词表按组显示，画布节点数量由 `graph.browsing.maxNodes` 配置；搜索覆盖整张词表。每次进入图谱自动初始化后，以该视图为本次恢复基准；手动初始化会更新基准，取消节点选中时恢复基准平移和缩放，基准位置在必要时按当前可见成员及实际半径重新施加间距约束。在图谱画布内滚动鼠标滚轮或触控板可缩放，拖动空白处可平移；画布外保留页面的默认滚动。macOS 可按 ⌘ + \、Windows 可按 Ctrl + \ 展开或收起侧栏。英美发音使用有道接口的对应口音；只有接口返回可播放音频时才显示播放按钮。可播放音频缓存到 `outputs/vocabulary-atlas/cache/audio/`；音频是播放来源，不作为词条证据。


新建词条在 `build-word-entry` 发布阶段自动补入有词性依据的规则词形。历史词条可运行 `python .agents/skills/build-word-entry/scripts/rule_inflections.py start --project <projectId>`，随后用返回的运行 ID 执行 `verify --run-id <runId>`。状态机重复运行不会重复写入词形。新来源直接证实原规则词形时，原 `formId` 升级为来源支持状态。

背单词页可为同一项目建立多个艾宾浩斯或葫芦背书法计划。首页显示计划名、创建时间、轮数和当前轮进度，并可设置或确认删除计划。修改项目、记忆方法、开始日期或背诵数量会重新调用艾宾浩斯 skill 或葫芦应用排程状态机，清空该计划所有轮次的通过记录；删除计划时同时关闭其标签页。练习页在“今日 X 词”左侧显示当前分页和当天完整排程的通过比例。艾宾浩斯计划安排复习并在当日末尾重试未通过词，当天按到期复习批次与新学批次轮流呈现；葫芦计划只安排首次学习，当前页至少 80% 的单词通过后才可前进，未达标则回到学习模式。每遍完成后可手动开始下一轮。练习模式按空格逐词揭示词性和中文释义。计划覆盖的日期与当日词表可在日历页查看。

## 验证

macOS 在项目根目录使用 `ai-learning-toolkit` Conda 环境：前端在本应用目录运行 `conda run -n ai-learning-toolkit pnpm build`；API 和浏览器测试分别运行 `conda run -n ai-learning-toolkit python applications/vocabulary-atlas/scripts/smoke.py` 与 `conda run -n ai-learning-toolkit python applications/vocabulary-atlas/scripts/smoke_ui.py`。Windows 继续使用 `runtime/.venv/Scripts/python.exe` 运行 Python 测试。应用测试使用临时目录，不修改正式学习状态；浏览器测试将页面预览写入 `outputs/vocabulary-atlas/preview-word-page.png`。

图谱标题与节点统计之间可编辑当前项目名，Enter／失焦保存，Esc 撤销。未固定的单词／待建词标签会被下一个打开的词替换；固定按钮或双击保留标签。收藏夹独立保留。项目预览的标题、关闭按钮与词数固定，仅词表滚动。

唯一正式词条存储为 `dicts/a.jsonl` 至 `z.jsonl`，各项目只引用 `wordId`，建词及审核不再创建每词工作文件。拼写关系使用全局 `spelling-index.json`，LCS ≥ 0.75，排除别名、屈折词形和已确认同族词；未建词条也显示节点，齐备后双向发布。导入和编辑项目、建词完成后自动增量维护。手动维护入口：`runtime/.venv/Scripts/python.exe .agents/skills/build-word-entry/scripts/spelling_relations.py start --full`；支持 `status / resume / verify --run-id <runId>`，日志位于 `logs/dictionary-spelling/runs/`。

葫芦均匀分组由 `utils/scripts/hulu_schedule.py` 的可恢复应用状态机执行，Schema 位于 `utils/references/hulu-schedule-v1.schema.json`。新葫芦计划 `scheduleRunId` 为 `null`，旧计划兼容；独立 skill 已移至 `tmp/schedule-hulu-plan/` 并取消注册。

图谱多成员词族在布局完成和拖拽释放后保证每节点至少与另一个同族节点保持配置间距，圆形节点不重叠；缩放达到 100% 时，英文下方显示首个核心义项的词性缩写和中文释义；英文词面完整显示，允许超出圆形节点；较长词性及中文释义按节点宽度省略，悬停提示与可访问名称保留完整内容。总览展示可见节点间全部符合筛选的拼写相似边，保留同族排除、去重及 500 节点上限。日历页每次打开并完成数据加载后自动定位当天日期，后续手动浏览不被重置。

筛选改变可见词族成员、或选中状态初始化后取消选中导致节点半径缩小时，会重新施加间距约束；取消选中仍恢复基准平移与缩放。总览中同一词对的多种关系边并排展示。日历在计划读取失败时显示错误，仍定位今天。

同族节点间距由 `graph.physics.familyNodeGap` 配置，默认 8，范围 0–64，单位为 100% 缩放时的画布像素；0 恢复相切。任意两个可见同族节点的边界距离不小于此值，每节点至少与另一个同族节点达到此值（单成员豁免）。初始化、筛选、选中半径变化、历史位置恢复及拖拽释放均应用同一约束；旧配置缺少该字段时读取默认值，保存时补齐。维护者修改配置后重启服务生效。

总览展示项目当前可见节点间所有已开启的同义、近义、反义和拼写相似关系；候选关系同样展示，正式关系使用实线，待核验候选使用虚线，不因仅单向保存或目标仅有词面而遗漏。`synonym_or_near_synonym` 仅在展示时归入近义词，不改变原候选类型与核验状态；近义词块左侧竖向圆角色条统一引用 `graph.relations.near_synonym`（初值 `#0EA5E9`）。同族同时使用词族团与同族连线。单词笔记保留逐项 AI 置信度与核验标记，不显示多项内容置信度相同的汇总提示。

相关回归覆盖配置校验和同族间距，以及 AI 内容逐项标记。总览查找范围包含当前已显示的词形及派生节点，指向这些节点的词面语义关系继续展示；关闭同族显示后，未属于项目词表的同族节点及其连边随之隐藏。

词表导入会自动计算拼写相似关系；同族、同义、近义和反义关系来自已建立词条的证据。图谱关系筛选控制已有关系的显示，不会生成词义关系。左侧栏可用顶部按钮收起或展开，浏览器会记住该选择。

## 新手导航与维护配置

左侧底部“新手导航”可随时开启。主导航“词表”负责导入，“词汇地图”负责探索，“背单词”页面顶部下拉框选择每组单词数并自动保存。

全局设置已删除。维护者统一编辑 `config.yaml` 中的颜色、图谱参数、`study.wordsPerPage` 默认词数与 `study.pageSizeOptions` 下拉选项，修改后重启应用。用户选择的词数保存在界面状态中。

词库维护工具的详细错误与子进程输出保存到 `logs/vocabulary-atlas/runs/<运行目录>/events.jsonl`。日常界面不提供手动建词入口。

查看单词后，详情栏或图谱工具栏的“返回整体词谱”、左侧“词汇地图”、顶部图谱标签及 Esc 都会退出单词聚焦、清除搜索并恢复完整图谱；独立详情也提供返回按钮。关系筛选保持用户原来的选择。

每次打开图谱或切换词表默认只显示同族连线，其他关系由用户单选切换。纯单词列表没有语义关系证据，只能自动计算拼写相似，须完善词条后才有其余关系。

## 简化使用流程

没有词表时自动进入词表选择。内置词表可一键选用，不必找文件、导入或命名；重复选用复用同一份词表。“开始背单词”直接使用当前词表、今天的日期和每组词数创建每日练习，已有当日计划直接继续；高级参数保留在“自定义计划”。日常单词详情不再提供手动建词入口。内置词表源文件仅含词面；配置的雅思词典在首次启动、词典资源或词表更新时补齐释义与关系；词典已就绪时服务直接启动。页面按词表显示已有释义数量。

收藏夹独立显示收藏内容，不挂载图谱及其关系弹层。关系选择默认收起，查看单词或重新进入图谱时收起；展开后采用较大字号和明确的选中状态。

内置词表统一读取仓库根目录 `dictionaries/wordlists/<词表名>/`，每份词表各有一个子目录；共享的 ECDICT 和 WordNet 原始数据单独放在 `dictionaries/resources/`。原有词表文件未记录逐份发布来源，不能宣称为官方考试词表；词面文件也不是完整词典数据。页面分为“内置词表”和“我的词表”：来源目录中的词表归入内置词表，用户创建或导入的词表归入我的词表。来源类型保存在项目记录中，不按词表名称或内容推断。扫描目录及支持的格式在 `config.yaml` 的 `wordlists` 配置中指定。列表显示去重后的可用词数，重音词保留原拼写；缩写或混杂文本按行跳过并提示数量，原始行记录到服务日志，避免整份导入失败。

## 雅思词表的本地词典接入

`lexicon.json` 配置目标词表、ECDICT 与 Open English WordNet 资源、版本、下载地址和关系映射。启动时会检查资源、词表、已导入词条和拼写索引；只有缺失或更新时才准备词典、导入词条或同步拼写关系。词典已就绪时直接启动页面。可在仓库根目录单独运行 `python -m utils.scripts.dictionary_lexicon --download`。

原始词库统一位于 `dictionaries/resources/`，来源和许可证见其中 README。导入的正式词条使用 Schema 1.6，保留来源版本及原文件哈希，并允许来源缺失中文释义或例句。ECDICT 整词中文释义与 WordNet 英文义项分开展示，不生成不存在的逐义项译文。已有非本地导入词条保持原内容。覆盖报告位于 `outputs/vocabulary-atlas/lexicon/coverage.json`，过程日志位于 `logs/dictionary-lexicon/runs/`。

同义来自同一义项集，反义来自显式反义关系，同族由派生关系及词形数据组成。近义目前只涵盖 WordNet 形容词相似义项；没有依据的关系保持缺失。图谱维持单选关系和默认同族，节点限量时优先显示当前关系中有连线的词。

离线转换回归验证：`python applications/vocabulary-atlas/scripts/smoke_lexicon.py`。

## 图谱浏览流程

- 在“词典”查词，点击结果后直接显示中心词及其关联词；点击节点可查看单词笔记。
- 在“词表”选择词表后，图谱按词表顺序分组，默认每组 20 词，并显示这一组的直接关联词。上一组、下一组和分组下拉框切换组；搜索覆盖整张词表。
- 默认选择同族词，其余关系通过单选切换。“更多关联词”只在中心词视图显示，展开该词的直接关系。
- `applications/vocabulary-atlas/config.yaml` 的 `graph.browsing` 配置组大小、画布节点上限、默认及展开后的关联词数量。默认节点上限 80，关联词数量为 12 / 30；修改配置后重启服务。
- 节点颜色由 `graph.nodes` 配置。收藏与界面状态分别保存在 `favorites-state.json` 和 `ui-state.json`，词表保存在 `projects/<projectId>/project.json`。
