# popular-radar 改进方案详解

> 本文档详细梳理 popular-radar 项目针对「娱乐/舞蹈/游戏自媒体创作者」这一目标受众的改进方案，
> 涵盖每个改进模块的实现细节、核心逻辑与模块联动关系。
> 每个改进项先以一句话总结，再分点展开具体功能、实现方式和模块联动。
>
> **改进背景**：当前项目的数据源（抖音综合热搜 + B站综合热门 + B站音乐区）偏向社会实时新闻和泛内容混合，
> 报告分类（知识科技/娱乐/音乐表演/生活）是内容属性分类而非创作者视角分类，
> 对需要"可跟拍 BGM、热门舞蹈、流行梗、游戏热点、饭圈动态"的娱乐自媒体创作者意义不大。
> 改进目标是让推送内容从"社会新闻为主"转向"娱乐创作为主"，并支持按创作者类型精准分流。
>
> **改进优先级**：P0(零代码改配置) -> P1/P2(改 Prompt) -> P3(分类层) -> P4(报告拆分) -> P5(推送分流) -> P7/P8(附属项) -> P6(远期)
>
> **✅ 实施记录（2026-07-12）**：P0+P1+P2+P3+P4+P5（含 P7/P8 附属项）已全部实施完毕，源报告已按 5.6 建议裁撤至 2 份综合（抖音+B站）。
> P6 按计划保留为远期项。**端点未实测**（公共实例当时不可达）——上线后第一跑请在 GitHub Actions 日志中核对各源 `fetchSuccess` 与条目数，
> 失败的源在 config.yml 中暂时移除或修正 type 参数即可（容错设计保证单源失败不影响整体）。P5 需在 GitHub Secrets 配置
> `FEISHU_WEBHOOK_DANCE` / `FEISHU_WEBHOOK_GAME` / `FEISHU_WEBHOOK_ENT` 并在三个 workflow 的 env 中透传后生效，未配置时静默跳过。
>
> **修订说明（2026-07-12 审查）**：本文档经对照 DailyHotApi 官方路由清单与项目实际代码审查后修订——
> ① P0 数据源表已修正：原表中 `douyin-music`/`douyin-dance`/`netease-music` 三个端点**不存在**，`bili-dance` 分区号有误（舞蹈区是 129 而非 1），已替换为真实可用的路由并补充遗漏的高价值源（B站鬼畜区/娱乐区、米哈游系游戏动态等）；
> ② 明确 **BGM 数据源硬缺口**：DailyHotApi 无任何音乐平台榜单，BGM 内容只能来自 B站音乐区 + LLM 从标题识别；
> ③ P6 元数据增强经核实**当前不可行**（DailyHotApi 归一化 schema 不透传平台特有字段），降级为远期项；
> ④ 原"八/九"两节重编号为 P7/P8；
> ⑤ 补充 LLM 成本估算、周报月报 prompt 同步、输出契约兼容、验证与回滚策略。

---

## 目录

- [一、数据源扩充（P0 - 零代码改动）](#一数据源扩充p0---零代码改动)
- [二、报告 Prompt 重构（P1 - 创作者视角分类）](#二报告-prompt-重构p1---创作者视角分类)
- [三、抖音热搜分流指令（P2 - 娱乐向过滤）](#三抖音热搜分流指令p2---娱乐向过滤)
- [四、分类过滤层（P3 - 新增 classify.ts）](#四分类过滤层p3---新增-classifyts)
- [五、报告按分类拆分（P4 - 多份定向报告）](#五报告按分类拆分p4---多份定向报告)
- [六、创作者画像与推送分流（P5 - 精准推送）](#六创作者画像与推送分流p5---精准推送)
- [七、HotItem 元数据增强（P6 - 远期）](#七hotitem-元数据增强p6---远期依赖上游二开)
- [八、饭圈内容风险标注（P7 - P4 附属项）](#八饭圈内容风险标注p7---p4-附属项)
- [九、抽象内容 LLM 辅助识别（P8 - P3 附属项）](#九抽象内容-llm-辅助识别p8---p3-附属项)
- [十、改进路线图与里程碑](#十改进路线图与里程碑)

---

## 一、数据源扩充（P0 - 零代码改动）

**通过在 `config.yml` 中新增娱乐垂类数据源（抖音热歌榜、B站舞蹈/游戏分区、微博热搜等），无需修改任何代码即可让报告内容从"社会新闻为主"转向"娱乐创作为主"，充分利用项目现有的配置驱动设计。**

### 具体功能与实现

#### 1.1 现状分析

- **当前 3 个数据源**：抖音热搜（综合，keywords）、B站热门视频（综合，videos）、B站热门音乐（type "3"，videos）
- **问题**：抖音综合热搜词中社会新闻占比高（如"某地暴雨""某政策出台"），B站综合热门也是泛内容混合，对娱乐自媒体创作者缺乏可操作性
- **创作者实际需求**：可跟拍的 BGM、舞蹈挑战、流行梗、游戏热点、饭圈/明星动态

#### 1.2 新增数据源方案（已对照 DailyHotApi 官方路由清单修正）

在 `config.yml` 的 `hot_sources` 列表中追加以下条目。**第一梯队**（与目标受众强相关，建议全部接入）：

| id | platform | name | type | limit | contentType | 服务对象 |
|----|----------|------|------|-------|-------------|---------|
| `weibo` | weibo | 微博热搜 | - | 50 | keywords | 娱乐博主（饭圈/明星/梗，需 P2/P3 过滤社会新闻） |
| `bili-dance` | bilibili | B站舞蹈区 | "129" | 30 | videos | 舞蹈博主（手势舞/舞蹈跟拍精准来源） |
| `bili-game` | bilibili | B站游戏区 | "4" | 30 | videos | 游戏博主（游戏热点） |
| `bili-guichu` | bilibili | B站鬼畜区 | "119" | 30 | videos | 娱乐博主（**抽象/无厘头/梗内容的天然聚集地**） |
| `bili-ent` | bilibili | B站娱乐区 | "5" | 30 | videos | 娱乐博主（综艺/明星向） |
| `kuaishou` | kuaishou | 快手热榜 | - | 50 | 待实测 | 短视频生态补充（contentType 取决于返回字段是否含 cover/author） |

**第二梯队**（游戏官方动态，无热度值、偏公告性质，适合"新游/版本热点"选题，limit 宜小）：

| id | platform | name | limit | contentType | 服务对象 |
|----|----------|------|-------|-------------|---------|
| `genshin` | genshin | 原神动态 | 15 | keywords | 游戏博主（版本/活动选题） |
| `starrail` | starrail | 星穹铁道动态 | 15 | keywords | 游戏博主 |
| `miyoushe` | miyoushe | 米游社热点 | 20 | keywords | 游戏博主（米哈游系社区风向） |
| `lol` | lol | 英雄联盟公告 | 10 | keywords | 游戏直播博主 |

**可选**：`douban-movie`（影视新片）、`tieba`（贴吧热议，梗文化）、`acfun`（二次元补充）、`hupu`（体育娱乐向讨论）。

> **⚠️ 原方案勘误**：`douyin-music`（抖音热歌榜）、`douyin-dance`（抖音舞蹈榜）、`netease-music`（网易云飙升榜）在 DailyHotApi 中**不存在**——抖音只有一个综合热点榜（`douyin`，已接入），网易系只有 `netease-news`（新闻）。原表 `bili-dance` 的 type "1" 是**动画区**，舞蹈区正确分区号为 **129**（B站排行榜分区：0全站/1动画/3音乐/4游戏/5娱乐/119鬼畜/129舞蹈/155时尚/160生活/188科技，现有配置 `bili-music` 用 type "3" 即此体系）。
>
> **⚠️ BGM 数据源硬缺口**：DailyHotApi 没有任何音乐平台榜单（无网易云/QQ音乐/抖音热歌）。「可跟拍 BGM」内容现实来源只有两个：① 已接入的 B站音乐区（type "3"）；② LLM 从各源视频标题中识别热歌（如"XXX 翻唱破百万"）。P4 的 BGM 专项报告输入受此限制；若要真正的热歌榜，需自部署 DailyHotApi 并二开新增音乐源，或接入其他开源音乐榜 API（远期，见 P6 定位）。

#### 1.3 实现方式

- **零代码改动**：当前 `config.ts` 的 `loadConfig()` 已支持动态读取 `config.yml`，`toHotSource(raw)` 会对每个条目做字段级 fallback，新增条目会被自动纳入采集
- **新增条目自动生效路径**：
  1. `loadConfig()` 读取新 `hot_sources` -> 返回扩展后的 `HOT_SOURCES`
  2. `index.ts` Phase 1 的 `fetchAllHotData(HOT_SOURCES)` 会自动并行采集新增的源
  3. `index.ts` Phase 2 的 `allHotData.map(saveHotReport)` 会自动为每个新源生成报告
  4. `rollup.ts` 的 `ROLLUP_SOURCES = HOT_SOURCES.map(s => "ai-" + s.id)` 会自动纳入周报月报汇总
  5. `i18n.ts` 的 `getReportMeta(source)` 未命中内置映射时走 `fallbackMeta(source)` 自动生成 `📊 {name}日报` 标题
- **前置验证**：在改 `config.yml` 之前，需用 curl 验证 DailyHotApi 各端点是否支持对应分区 `type` 参数和平台覆盖，避免加了配置但端点不支持导致 `fetchSuccess: false`

#### 1.4 验证步骤

对每个候选端点执行（**建议在自部署实例上验证**，公共演示实例 `api-hot.imsyy.top` 存在限流与不可用风险——本次审查时即无法访问）：

```bash
curl "<base>/weibo?cache=false&limit=5"               # 微博热搜结构
curl "<base>/bilibili?type=129&cache=false&limit=5"   # B站舞蹈区
curl "<base>/bilibili?type=119&cache=false&limit=5"   # B站鬼畜区
curl "<base>/bilibili?type=4&cache=false&limit=5"     # B站游戏区
curl "<base>/kuaishou?cache=false&limit=5"            # 快手（看是否有 cover/author 决定 contentType）
curl "<base>/genshin?cache=false&limit=5"             # 原神动态
```

- 检查返回 JSON 的 `code === 200` 且 `data` 为非空数组
- 确认 `data[0]` 的字段结构（是否有 `hot`/`cover`/`author` 等）——决定 `contentType` 填 `keywords` 还是 `videos`
- 记录实测结果回填到 1.2 表格（尤其 kuaishou 的 contentType）
- **实测通过一个源，就在 config.yml 加一个源**，不要未验证批量加入（失败源虽有容错不会崩溃，但会白白产生日志噪音和空报告判断）

#### 1.5 模块联动

- **`config.yml`**：新增 `hot_sources` 条目（唯一改动点）
- **`config.ts`**：`loadConfig()` / `toHotSource()` / `DEFAULT_HOT_SOURCES` 自动处理新条目，无需改动
- **`hot.ts`**：`fetchHotData(source)` 通用客户端按 `source.platform` + `source.type` 构建请求，自动适配
- **`index.ts`**：Phase 1/2/3 自动扩展采集和报告生成范围
- **`rollup.ts`**：`ROLLUP_SOURCES` 动态派生，新源自动纳入周报月报
- **`i18n.ts`**：`getReportMeta()` 的 `fallbackMeta()` 为非内置源生成默认标题
- **`report-savers.ts`**：`ISSUE_LABELS[id] ?? id` 自动 fallback，GitHub Issue 标签用源 id

#### 1.6 预期效果

- 报告内容娱乐占比显著提升（估算从约 30% 到 70%+，以实际运行为准）
- 新增舞蹈跟拍来源（B站舞蹈区 129）
- 新增抽象/梗内容来源（B站鬼畜区 119 —— 与"杨明熙水果派"类无厘头内容最匹配的分区）
- 新增饭圈/明星话题来源（微博热搜 + B站娱乐区）
- 新增游戏热点来源（B站游戏区 + 米哈游系/LOL 官方动态）
- **不增加任何代码复杂度，完全利用现有配置驱动架构**

#### 1.7 成本与体验影响（新增）

- **LLM 调用量**：每加一个源 = 每天 +1 次报告调用。第一梯队 6 源全接后：日报从 3 份变 9 份，callLlm 从 4 次/天升至约 10 次/天（含 highlights）。并发限流 5 可正常消化，但 token 消耗约 2.5 倍
- **highlights 预算**：报告数增多后，`buildHighlightsPrompt` 输入（每报告截断 2000 字符 × 9 份）与 2048 输出预算需要上调（建议输出 3072，属一行改动，随 P0 一并做——严格说这是唯一的"非零代码"点，也可以接受截断暂不改）
- **零代码的代价**：新源在通知里显示原始 id（`NOTIFY_LABELS[r] ?? r` 回退，如 "ai-weibo"），Web UI 侧边栏同理。功能可用但不美观；若要中文短标签需在 `i18n.ts`/`index.html` 各加一行映射（可选的微量代码，建议与 P1 一起做）
- **公共实例风险**：源数量增至 9+ 后对 DailyHotApi 的请求量翻三倍，**强烈建议先自部署**（`DAILYHOT_BASE_URL` 已支持），避免公共实例限流导致大面积 `fetchSuccess: false`

---

## 二、报告 Prompt 重构（P1 - 创作者视角分类）

**将 `prompts-data.ts` 中 `buildVideosPrompt` 的输出分类从内容属性（知识科技/娱乐/音乐表演/生活）重构为创作者视角（可跟拍BGM/热门舞蹈/热梗抽象/游戏热点/饭圈动态），让报告直接服务于娱乐/舞蹈/游戏自媒体创作者的创作决策。**

### 具体功能与实现

#### 2.1 现状分析

- **当前 `buildVideosPrompt` 的 4 节输出**：今日速览 / 热门内容（📚知识科技🎬娱乐🎵音乐表演🏠生活）/ 流量信号分析 / 值得一看
- **问题**：这是"内容属性"分类，对创作者无用。创作者不需要知道"这条视频属于知识科技类"，而需要知道"这首歌能用作 BGM 吗""这个舞蹈能跟拍吗""这个梗怎么玩"
- **`buildKeywordsPrompt` 的 4 节输出**：今日速览 / 热门搜索词 / 趋势信号分析 / 值得关注
- **问题**：抖音热搜词中社会新闻和娱乐混杂，报告不分流，娱乐创作者需要从大量社会新闻中自行筛选

#### 2.2 新的视频类 Prompt 结构

`buildVideosPrompt` 建议改为以下 7 节结构：

| 节标题 | 内容 | 创作者用途 |
|--------|------|-----------|
| `## 今日速览` | 3-5 句概括今日流量风向 | 快速了解全局 |
| `## 🎵 可跟拍 BGM` | 热门背景音乐，每条含歌名/使用量/适配场景/搜索关键词 | 舞蹈/剪辑博主选 BGM |
| `## 💃 热门舞蹈跟拍` | 热门舞蹈/手势舞，每条含舞蹈名/难度评估/参考视频链接/为什么火 | 舞蹈博主选跟拍内容 |
| `## 😂 热梗与抽象` | 正在传播的梗，每条含梗的来源/玩梗方式/适配内容类型 | 娱乐博主蹭梗 |
| `## 🎮 游戏热点` | 值得蹭的游戏流量，每条含游戏名/热点类型/创作切入点 | 游戏博主选题 |
| `## ⭐ 饭圈动态` | 明星相关流量，每条含明星名/话题性质（正/争议）/蹭流量注意点 | 娱乐博主追星话题 |
| `## 创作建议` | 针对当前热点的 2-3 条具体创作建议 | 综合建议 |

#### 2.3 实现方式

- **修改文件**：`src/prompts-data.ts` 的 `buildVideosPrompt` 函数（第 61-104 行）
- **改动内容**：
  1. 修改系统角色描述：从"短视频内容分析师"改为"短视频娱乐创作顾问，专注为舞蹈/游戏/娱乐博主提供可跟拍、可借鉴的流量热点"
  2. 修改输出节结构：从 4 节（今日速览/热门内容4分类/流量信号/值得一看）改为 7 节创作者视角分类
  3. 每条内容要求附加创作者决策字段（BGM 的搜索关键词、舞蹈的难度评估、梗的玩梗方式、游戏的创作切入点、饭圈的风险提示）
  4. 保持输出契约不变：首行仍为 `## 今日速览`，各节用 `## ` 二级标题（与 `extractFromFirstH2` 兼容）
  5. **空节处理指令**（新增）：并非每个源每天都有全部 7 类内容（如 B站游戏区报告里"饭圈动态"多半为空）。Prompt 须明确"某节无对应内容时输出该节标题 + 一句『今日暂无』即可，禁止硬凑或编造"——否则模型会为凑节数产生幻觉内容
- **输出契约兼容**：`extractFromFirstH2` 的首个 `## ` 锚点仍是"今日速览"，无需改动

#### 2.4 模块联动

- **`prompts-data.ts`**：`buildVideosPrompt` 函数重写（改动点）
- **`report-savers.ts`**：`saveHotReport` 调用 `buildVideosPrompt` 时无需改动（签名不变）
- **`report.ts`**：`extractFromFirstH2` 仍以 `## 今日速览` 为锚点，无需改动
- **`i18n.ts`**：若新增 `bili-dance`/`bili-game` 等源，可在 `REPORT_META_BY_ID` 补充内置映射（可选，不补则走 fallback）
- **`rollup.ts` / `prompts-data.ts` 周月报同步（原方案遗漏，必须做）**：`buildWeeklyPrompt` 的六节（本周要闻/抖音搜索趋势/B站内容亮点/跨平台信号/创作者聚焦/下周信号）与 `buildMonthlyPrompt` 对应节，引用的还是旧的"内容属性"视角。日报重构后，周报月报的节结构须同步改为创作者视角（如"本周热门 BGM 与舞蹈"/"本周热梗盘点"/"游戏流量周况"），且首行锚点相应更新（周报 `## 本周要闻` 保持即可，内部小节调整）——否则周报读取的是新式日报、输出的却是旧式框架，内容会错位

#### 2.5 预期效果

- 报告从"内容展示"变为"创作决策参考"
- 创作者能直接从报告中获得：用什么 BGM、跟拍什么舞蹈、玩什么梗、蹭什么游戏流量、关注哪个明星话题
- 每条内容附带"怎么用"的指导信息，而非仅"这是什么"的描述

---

## 三、抖音热搜分流指令（P2 - 娱乐向过滤）

**在 `buildKeywordsPrompt` 中增加娱乐向/非娱乐向分流指令，让 LLM 先对热搜词分类，报告只展开娱乐向内容，社会新闻类一句话带过，避免娱乐创作者被无关内容干扰。**

### 具体功能与实现

#### 3.1 现状分析

- **当前 `buildKeywordsPrompt`**：将所有热搜词统一格式化为列表，要求 LLM 生成 4 节报告（今日速览/热门搜索词/趋势信号分析/值得关注）
- **问题**：抖音综合热搜词中社会新闻（如"某地暴雨""某政策出台"）和娱乐内容（如"原神牛逼""赵露思"）混杂，报告不区分，娱乐创作者需自行筛选
- **数据特点**：抖音热搜是 keywords 类型，只有 title + hot + url，没有封面/作者，LLM 需根据标题语义判断类别

#### 3.2 改进方案

`buildKeywordsPrompt` 建议改为以下结构：

| 节标题 | 内容 | 处理逻辑 |
|--------|------|---------|
| `## 今日速览` | 3-5 句概括，突出娱乐向热点 | 全局概括 |
| `## 🎬 娱乐向热搜` | 精选 10-15 个娱乐相关热搜词，每个含词+链接+热度+创作切入点 | 展开详述 |
| `## 📰 非娱乐热搜（速览）` | 社会新闻/政策类热搜，3-5 个一句话带过 | 简略提及 |
| `## 趋势信号分析` | 100-200 字，分析娱乐流量趋势 | 趋势洞察 |
| `## 创作建议` | 2-3 条基于娱乐热搜的创作建议 | 可操作建议 |

#### 3.3 实现方式

- **修改文件**：`src/prompts-data.ts` 的 `buildKeywordsPrompt` 函数（第 19-55 行）
- **改动内容**：
  1. 在 Prompt 中增加分类指令：要求 LLM 先将每个热搜词判断为"娱乐向"或"非娱乐向"
  2. 娱乐向判定标准：影视/综艺/明星/游戏/动漫/音乐/舞蹈/梗/网红/饭圈相关
  3. 非娱乐向判定标准：社会新闻/政策/灾害/经济/国际/体育赛事（非娱乐视角）
  4. 娱乐向内容展开详述（每个含创作切入点），非娱乐向一句话速览
  5. 每个娱乐热搜词附加"创作切入点"字段（如"可做反应视频""可跟拍挑战""可做盘点"）
  6. 保持输出契约：首行 `## 今日速览`
- **输出契约兼容**：首行锚点不变，`extractFromFirstH2` 无需改动

#### 3.4 模块联动

- **`prompts-data.ts`**：`buildKeywordsPrompt` 函数重写（改动点）
- **`report-savers.ts`**：`saveHotReport` 调用时 `contentType === "keywords"` 分流不变
- **`report.ts`**：`extractFromFirstH2` / `callLlm` 无需改动
- **适用范围提示**：此 prompt 同时服务 weibo（P0 新增）等所有 keywords 源——微博热搜的社会新闻占比比抖音更高，P2 分流对它同样关键
- **与 P3 的关系**：P3 分类层上线后，社会新闻已在数据层被过滤，P2 的 LLM 端分流退化为兜底（保留无妨，双保险；"非娱乐速览"节届时自然变短）

#### 3.5 预期效果

- 抖音热搜报告中社会新闻从占据主要篇幅降为一句话速览
- 娱乐向热搜词获得展开详述和创作切入点标注
- 创作者无需自行从热搜中筛选娱乐内容

---

## 四、分类过滤层（P3 - 新增 classify.ts）

**新增 `src/classify.ts` 模块作为数据采集层与报告生成层之间的中间层，对每条 `HotItem` 打娱乐标签并过滤掉与娱乐创作无关的内容，从源头减少 LLM 噪音输入。**

### 具体功能与实现

#### 4.1 设计背景

当前数据流：
```
hot.ts (fetchAllHotData) -> report-savers.ts (saveHotReport) -> report.ts (callLlm)
```
没有任何中间分类，所有原始数据直接喂给 LLM，导致：
1. 社会新闻占据 LLM token 但对娱乐创作者无用
2. LLM 需要在 Prompt 里自行判断娱乐性，消耗推理能力
3. 无法按创作者类型精准分流

改进后数据流：
```
hot.ts (fetchAllHotData) -> classify.ts (classifyItems) -> report-savers.ts -> report.ts
```

#### 4.2 标签体系

基于目标创作者需求，设计以下标签体系：

| 标签 | 含义 | 示例 | 服务对象 |
|------|------|------|---------|
| `bgm` | 可用作视频 BGM 的热歌 | 抖音热歌榜曲目 | 舞蹈/剪辑博主 |
| `dance` | 可跟拍舞蹈/手势舞 | 热门手势舞、热门舞蹈 | 舞蹈博主 |
| `meme` | 流行梗/抽象内容 | "原神牛逼"、杨明熙水果派 | 娱乐博主 |
| `fandom` | 饭圈/明星动态 | 赵露思、张元英、柳智敏 | 娱乐博主 |
| `game` | 游戏热点 | 节奏天国、YAPYAP | 游戏博主 |
| `social-news` | 社会新闻（过滤掉） | 某地暴雨、某政策 | 无（过滤） |
| `other` | 未分类（保留待 LLM 二次判断） | - | 待定 |

#### 4.3 分类方式（双引擎）

**引擎 1：关键词规则（低成本、确定性强）**

- 维护一个 `KEYWORD_TAGS` 映射表：关键词 -> 标签数组
  ```
  "原神" -> ["meme", "game"]
  "手势舞" / "舞蹈挑战" / "变装" -> ["dance"]
  "赵露思" / "张元英" / "柳智敏" -> ["fandom"]
  "节奏天国" / "YAPYAP" -> ["game"]
  ```
- 对每条 `HotItem`，检查 `title` 是否包含映射表中的关键词
- 命中则打对应标签，未命中则标记为 `other`
- **标签优先级规则（新增，防误杀）**：娱乐类关键词命中优先于 `social-news` 关键词——例如"原神版本发布"同时命中"原神"（game）和"发布"（social-news 候选词），必须判为 game。实现上：先匹配娱乐标签，命中任意娱乐标签的条目不再进入 social-news 判定
- **来源先验（新增）**：来自天然娱乐分区的源（bili-dance/bili-guichu/bili-game/bili-music）可按 source id 直接预置标签（如 bili-dance 全部预置 `dance`），只有综合源（douyin/weibo/kuaishou/bili）才需要逐条分类——大幅减少引擎 2 的工作量
- **优点**：零 LLM 成本、确定性强、可枚举的类目覆盖率高
- **缺点**：无法覆盖不断演化的新梗（如新出的抽象内容）
- **维护性建议（新增）**：`KEYWORD_TAGS` 放入 `config.yml` 新增 `keyword_tags` 段（而非硬编码在 classify.ts），追新梗、新明星名只改配置零代码——与项目"配置驱动"约定一致

**引擎 2：LLM 批量分类（高准确率、有成本）**

- 对引擎 1 标记为 `other` 的 items，用批量 LLM 调用判断类别
- Prompt 格式：传入 N 条 title，要求 LLM 返回 `[{id, tags: [...]}]` JSON
- 用 `callLlm` + `parseLlmJson` 复用现有基础设施
- **优点**：能判断模糊内容（如"抽象"梗）、适应新梗演化
- **批量与预算（修正）**：每批 ≤50 条、输出预算 4096（原方案 2048 对 50 条 JSON 偏紧）；9 个源的 `other` 量估计 100-150 条，即每天 **2-3 次**分类调用（原方案"每天 1 次"低估）
- **失败兜底（新增）**：分类调用失败或 JSON 解析失败时，该批全部保留为 `other` 并**不过滤**（宁多勿漏——漏推热点比多推新闻代价高），仅记日志
- **成本控制**：来源先验 + 只对 `other` 类分类，双重缩量

#### 4.4 实现方式

- **新增文件**：`src/classify.ts`
- **导出类型**：
  ```typescript
  type EntTag = "bgm" | "dance" | "meme" | "fandom" | "game" | "social-news" | "other";
  interface ClassifiedItem extends HotItem {
    tags: EntTag[];
    relevanceScore?: number; // 娱乐相关度 0-1（LLM 引擎产出）
  }
  interface ClassifiedData {
    source: HotSource;
    items: ClassifiedItem[];
    fetchSuccess: boolean;
  }
  ```
- **字段归属澄清（新增）**：`tags` 只存在于 `ClassifiedItem`（本层产出），`hot.ts` 的 `HotItem` **不加** tags 字段（原 P6 表格中的 tags 行与此重复，已删除）——采集层保持纯净，分类是分类层的职责
- **导出函数**：
  - `classifyItem(item: HotItem): ClassifiedItem` - 单条分类（引擎 1 关键词规则）
  - `classifyBatch(items: HotItem[]): Promise<ClassifiedItem[]>` - 批量分类（引擎 2 LLM 兜底 `other` 类）
  - `filterByTags(data: ClassifiedData, includeTags: EntTag[], excludeTags: EntTag[]): ClassifiedData` - 按标签过滤
- **`classify.ts` 内部常量**：
  - `KEYWORD_TAGS: Record<string, EntTag[]>` - 关键词->标签映射表
  - `SOCIAL_NEWS_KEYWORDS: string[]` - 社会新闻关键词（"暴雨"/"地震"/"政策"/"发布"等）
- **`classifyBatch` 的 LLM Prompt**：传入 N 条 title，要求返回 JSON `[{id: "xxx", tags: ["meme"], reason: "xxx"}]`

#### 4.5 串联方式

`index.ts` 的 Phase 1 之后、Phase 2 之前插入分类步骤：

```typescript
// Phase 1: 数据采集
const allHotData = await fetchAllHotData(HOT_SOURCES);
// 新增: 分类过滤
const classifiedData = await Promise.all(
  allHotData.map(d => classifyBatch(d.items).then(items => ({ ...d, items })))
);
// Phase 2: 报告生成（使用分类后的数据）
```

- `classifyBatch` 内部先跑引擎 1（关键词），再对 `other` 类跑引擎 2（LLM）
- 分类后可选过滤：默认过滤 `social-news`，保留其余

#### 4.6 模块联动

- **`hot.ts`**：`HotItem` / `HotData` 类型被 `classify.ts` 引用扩展
- **`classify.ts`**（新增）：依赖 `hot.ts` 类型 + `report.ts`（`callLlm`/`parseLlmJson`，用于引擎 2）
- **`index.ts`**：Phase 1 与 Phase 2 之间插入分类步骤
- **`prompts-data.ts`**：`buildVideosPrompt` / `buildKeywordsPrompt` 可接收 `ClassifiedItem[]`，在 Prompt 中展示标签（让 LLM 知道已分类，减少重复判断）
- **`report-savers.ts`**：`saveHotReport` 接收 `ClassifiedData`（兼容 `HotData`，因为 `ClassifiedItem extends HotItem`）

#### 4.7 预期效果

- 社会新闻类内容在送入 LLM 生成报告前被过滤，减少 LLM token 消耗
- 每条内容携带娱乐标签，报告生成时可按标签组织
- 为 P4（报告拆分）和 P5（推送分流）提供数据基础
- 来源先验 + 关键词规则零成本，LLM 兜底每天约 2-3 次批量调用（按 other 量分批，每批 ≤50 条）

---

## 五、报告按分类拆分（P4 - 多份定向报告）

**将当前一份通用日报拆分为按娱乐分类的多份定向报告（如 ai-bgm.md / ai-dance.md / ai-meme.md / ai-game.md / ai-fandom.md），让不同类型的创作者各取所需。**

### 具体功能与实现

#### 5.1 现状分析

- **当前报告结构**：每个数据源生成一份报告（`ai-douyin.md` / `ai-bili.md` / `ai-bili-music.md`），报告内是所有内容的混合摘要
- **问题**：舞蹈博主收到包含游戏内容的报告，游戏博主收到包含饭圈内容的报告，信息过载
- **改进方向**：按娱乐分类生成多份报告，每份专注一个垂类

#### 5.2 报告拆分方案

```
digests/<date>/
├── ai-douyin.md          # 抖音热搜娱乐向报告（保留，P2 改进后已是娱乐向）
├── ai-bili.md            # B站综合热门报告（保留）
├── ai-bili-music.md      # B站音乐区报告（保留）
├── ai-bgm.md             # 🎵 热门BGM/热歌专项（跨源聚合，新增）
├── ai-dance.md           # 💃 热门舞蹈跟拍专项（跨源聚合，新增）
├── ai-meme.md            # 😂 热梗与抽象专项（跨源聚合，新增）
├── ai-game.md            # 🎮 游戏热点专项（跨源聚合，新增）
├── ai-fandom.md          # ⭐ 饭圈动态专项（跨源聚合，新增）
└── highlights.json
```

#### 5.3 跨源聚合逻辑

- **新增数据结构**：`classify.ts` 产出的 `ClassifiedItem[]` 跨所有数据源聚合，按标签分组
  ```typescript
  const byTag: Record<EntTag, ClassifiedItem[]> = {
    bgm: [], dance: [], meme: [], fandom: [], game: [], ...
  };
  classifiedData.forEach(d => d.items.forEach(item => {
    item.tags.forEach(tag => byTag[tag].push(item));
  }));
  ```
- **新增报告生成函数**：`report-savers.ts` 新增 `saveTagReport(tag, items, ...)` 函数
  - 输入：标签 + 该标签下的所有 `ClassifiedItem`（跨源聚合）
  - 输出：一份专项报告（如 `ai-dance.md`）
  - 复用 `callLlm` + `saveFile` + `createGitHubIssue`
  - **输出契约必须沿用（新增，重要）**：`buildTagReportPrompt` 同样要求首行为固定 H2 锚点（各专项统一用 `## 今日速览`），`saveTagReport` 保存前同样过 `extractFromFirstH2`——否则专项报告绕过现有的思考泄漏四层防线，doubao 思考模型的推理文本可能重新出现在页面上
  - **空标签 guard（新增）**：某标签当天聚合结果为空（如无 bgm 条目）时跳过该专项报告，沿用 `saveHotReport` 的 guard→返回 null 模式；每条目在专项报告中标注来源平台（跨源聚合后读者需要知道内容来自抖音还是B站）
- **新增 Prompt builder**：`prompts-data.ts` 新增 `buildTagReportPrompt(tag, items, dateStr)` 函数
  - 每个标签的 Prompt 侧重点不同（BGM 报告侧重搜索关键词和适配场景，舞蹈报告侧重难度和参考链接）

#### 5.4 实现方式

- **修改文件**：
  - `src/report-savers.ts`：新增 `saveTagReport` 函数
  - `src/prompts-data.ts`：新增 `buildTagReportPrompt` 函数
  - `src/i18n.ts`：新增 `TAG_REPORT_META` 映射（每个标签的报告标题/emoji/Issue标签）
  - `src/index.ts`：Phase 2 之后新增 Phase 2.5（按标签聚合生成专项报告）
- **`i18n.ts` 新增**：
  ```typescript
  const TAG_REPORT_META: Record<EntTag, { title: string; emoji: string; label: string }> = {
    bgm: { title: "热门BGM日报", emoji: "🎵", label: "bgm" },
    dance: { title: "热门舞蹈跟拍日报", emoji: "💃", label: "dance" },
    meme: { title: "热梗与抽象日报", emoji: "😂", label: "meme" },
    game: { title: "游戏热点日报", emoji: "🎮", label: "game" },
    fandom: { title: "饭圈动态日报", emoji: "⭐", label: "fandom" },
  };
  ```
- **`generate-manifest.ts`**：`REPORT_FILES` 数组新增专项报告 ID
- **`rollup.ts`**：`ROLLUP_SOURCES` 可选纳入专项报告（或保持只汇总数据源报告）

#### 5.5 模块联动

- **`classify.ts`**（P3）：提供 `ClassifiedItem[]` 及标签，是拆分的数据基础
- **`report-savers.ts`**：新增 `saveTagReport`，复用 `callLlm` / `saveFile` / `createGitHubIssue`
- **`prompts-data.ts`**：新增 `buildTagReportPrompt`，每个标签的 Prompt 侧重点不同
- **`i18n.ts`**：新增 `TAG_REPORT_META`，提供报告标题/emoji/Issue标签
- **`index.ts`**：新增 Phase 2.5 聚合生成专项报告
- **`generate-manifest.ts`**：`REPORT_FILES` 扩展，Web UI 侧边栏显示专项报告
- **`rollup.ts`**：可选将专项报告纳入周报月报汇总
- **`github.ts`**：`LABEL_COLORS` 新增专项报告标签颜色
- **`notify.ts` / `feishu.ts`**：`NOTIFY_LABELS` 新增专项报告短标签

#### 5.6 成本与精简选项（新增）

- **LLM 调用量**：5 份专项 + 9 份源报告 + highlights ≈ 15 次/天，是当前（4 次）的近 4 倍
- **建议的精简路径**：专项报告稳定运行后，**裁撤或降频源报告**——创作者真正消费的是专项报告，源报告（ai-weibo/ai-bili-ent 等）价值下降。可保留 1-2 份综合源报告（如 ai-douyin）+ 5 份专项，控制在 8 次/天左右
- **highlights 联动**：专项报告 ID（ai-bgm/ai-dance/...）需加入 `NOTIFY_LABELS`，`buildHighlightsPrompt` 的输入报告数增多，输出预算需同步上调

#### 5.7 预期效果

- 舞蹈博主只看 `ai-dance.md`，游戏博主只看 `ai-game.md`
- 每份报告专注一个垂类，内容密度高、噪声低
- Web UI 侧边栏按报告类型展示，创作者可快速定位
- GitHub Issue 按标签分类，便于筛选

---

## 六、创作者画像与推送分流（P5 - 精准推送）

**在 `config.yml` 中新增创作者画像配置，让 `feishu.ts` / `notify.ts` 按创作者类型过滤 highlights 并分别推送到不同 webhook，实现精准推送。**

### 具体功能与实现

#### 6.1 现状分析

- **当前推送方式**：`feishu.ts` 读取 `FEISHU_WEBHOOK_URLS`（逗号分隔多 webhook），向所有 webhook 推送**同一条消息**（包含当天所有报告的 highlights）
- **问题**：舞蹈博主收到游戏内容、游戏博主收到饭圈内容，信息过载
- **当前 `buildFeishuMessage`**：列出所有报告链接 + 所有 highlights，无过滤

#### 6.2 创作者画像配置

`config.yml` 新增 `creator_profiles` 配置：

```yaml
creator_profiles:
  - id: dance_creator
    name: 舞蹈博主
    cares: [bgm, dance]
    feishu_webhook_env: FEISHU_WEBHOOK_DANCE
  - id: game_streamer
    name: 游戏博主
    cares: [game, meme]
    feishu_webhook_env: FEISHU_WEBHOOK_GAME
  - id: entertainment_blogger
    name: 娱乐博主
    cares: [meme, fandom, bgm]
    feishu_webhook_env: FEISHU_WEBHOOK_ENT
```

- `id`：画像唯一标识
- `name`：显示名
- `cares`：该创作者关心的标签数组（对应 P3 的 `EntTag`）
- `feishu_webhook_env`：该画像对应的飞书 webhook 环境变量名（在 GitHub Secrets 中配置实际 URL）

#### 6.3 推送分流逻辑

`feishu.ts` 改进后流程：

1. **加载创作者画像**：从 `config.yml` 读取 `creator_profiles`
2. **按画像过滤 highlights**：对每个 profile，只保留 `cares` 标签对应的报告 highlights
3. **按画像构建消息**：每个 profile 构建一条只含其关心内容的消息
4. **按画像推送**：每个 profile 推送到其对应的 webhook
5. **容错**：某个 profile 的 webhook 未配置时静默跳过（沿用当前 secret 未设置静默跳过的设计）
6. **向后兼容（新增）**：保留现有 `FEISHU_WEBHOOK_URLS` 的全量推送逻辑——未配置任何 profile webhook 时行为与现在完全一致；profile 推送是增量能力而非替换。分群消息标题附画像名（如 "📡 popular-radar·舞蹈博主 · 2026-07-12"）便于辨识

#### 6.4 实现方式

- **修改文件**：
  - `config.yml`：新增 `creator_profiles` 配置
  - `config.ts`：新增 `CreatorProfile` 类型 + `RawCreatorProfile` 类型 + `loadConfig` 解析 `creator_profiles`
  - `feishu.ts`：`main()` 改为遍历 profiles 分别构建和推送；`buildFeishuMessage` 增加 `includeTags` 参数过滤 highlights
  - `notify.ts`：同理增加 Telegram 推送分流（可选）
- **`config.ts` 新增类型**：
  ```typescript
  interface CreatorProfile {
    id: string;
    name: string;
    cares: EntTag[];
    feishuWebhookEnv: string;
  }
  ```
- **`feishu.ts` 改进 `buildFeishuMessage` 签名**：
  ```typescript
  function buildFeishuMessage(
    date: string,
    reports: string[],
    pagesUrl?: string,
    highlights?: ReportHighlights,
    includeTags?: string[]  // 新增：只包含这些标签的报告
  ): string
  ```
- **`feishu.ts` 改进 `main()`**：
  ```typescript
  const profiles = loadConfig().creatorProfiles ?? [];
  for (const profile of profiles) {
    const webhook = process.env[profile.feishuWebhookEnv];
    if (!webhook) continue; // 静默跳过
    const msg = buildFeishuMessage(date, reports, pagesUrl, highlights, profile.cares);
    await sendToOneWebhook(webhook, title, msg);
  }
  ```

#### 6.5 模块联动

- **`config.yml`**：新增 `creator_profiles`（改动点）
- **`config.ts`**：新增 `CreatorProfile` 类型 + `loadConfig` 解析逻辑
- **`feishu.ts`**：`main()` 遍历 profiles 分别推送；`buildFeishuMessage` 增加 `includeTags` 过滤
- **`notify.ts`**：同理增加 Telegram 推送分流（可选，Telegram 可能不需要分群）
- **`prompts-data.ts`**：`ReportHighlights` 的 key 需与专项报告 ID 对应（如 `ai-dance`），`includeTags` 过滤时映射标签到报告 ID
- **GitHub Actions**：`daily-digest.yml` / `weekly-digest.yml` / `monthly-digest.yml` 的 `env` 新增各 profile 的 webhook Secret

#### 6.6 预期效果

- 舞蹈博主群只收到 BGM + 舞蹈相关内容
- 游戏博主群只收到游戏 + 热梗相关内容
- 娱乐博主群收到热梗 + 饭圈 + BGM 相关内容
- 每个群的信息密度高、噪声低
- 沿用当前多 webhook 扇出 + 部分失败容忍的设计

---

## 七、HotItem 元数据增强（P6 - 远期，依赖上游二开）

**扩展 `hot.ts` 的 `HotItem` 结构，增加使用量、BGM 信息、原始视频链接等创作者决策字段。**

> **⚠️ 现实性核查（重要，本次审查新增）**：DailyHotApi 把所有平台数据**归一化为固定 schema**（`{id, title, desc, cover, author, timestamp, hot, url, mobileUrl}`），平台特有字段（BGM 使用量、挑战发起视频、音乐信息）在其内部适配层就被丢弃，**不会透传**。因此本项在"直接消费 DailyHotApi"的前提下不可实现，必须先做下面二者之一：
> ① **自部署 DailyHotApi 并二开**：fork 后在目标路由的 transform 里保留额外字段（工作量在上游仓库，不在本项目）；
> ② **绕过 DailyHotApi 直连平台接口**：为个别源写专用 fetcher（打破"一个通用客户端"的现有架构优势，慎选）。
>
> 故 P6 定位调整为**远期项**，前置条件是自部署实例已稳定运行（P0 的建议）。在此之前，"怎么用"类信息由 LLM 在报告层推断补充（P1 的创作切入点、P4 专项 prompt 的适配场景字段）——不精确但零成本。

### 具体功能与实现

#### 7.1 现状分析

- **当前 `HotItem` 结构**：`{ id, title, cover?, author?, desc?, hot?, timestamp?, url, mobileUrl }`
- **问题**：只有展示型字段，缺乏创作者决策字段
- **创作者需要的信息**：
  - 这个 BGM 有多少人在用？（判断是否值得跟）
  - 这个舞蹈难度多大？（判断能否跟拍）
  - 原始视频/挑战发起视频在哪？（找参考）
  - 这是什么标签/分类？（快速定位）

#### 7.2 增强字段方案

| 新增字段 | 类型 | 用途 | 数据来源 |
|----------|------|------|---------|
| `useCount` | `number?` | 使用人数/跟拍数 | 需上游二开透传（见上方核查） |
| `bgmTitle` | `string?` | 背景音乐名 | 需上游二开透传 |
| `bgmArtist` | `string?` | 背景音乐作者 | 需上游二开透传 |
| `originVideoUrl` | `string?` | 原始/挑战发起视频链接 | 需上游二开透传 |

> **原表勘误**：`difficulty`（舞蹈难度）是 LLM 推断结果，属报告输出层字段（P4 舞蹈专项 prompt 的输出要求），不应放进采集层 `HotItem`；`tags` 归属 P3 的 `ClassifiedItem`（见 4.4 字段归属澄清），两行均已从本表移除。

#### 7.3 实现方式

- **修改文件**：`src/hot.ts`
- **改动内容**：
  1. `HotItem` 接口新增上述可选字段
  2. `ApiListItem` 接口新增对应上游字段（DailyHotApi 返回的字段名需验证）
  3. `toItem(raw)` 映射逻辑增加新字段的提取（`if (raw.useCount) item.useCount = raw.useCount` 等）
  4. `parseHot` 可复用于 `useCount`（同为数值解析）
- **前置验证**：需验证 DailyHotApi 各端点返回的 JSON 是否包含这些字段
  - 抖音挑战榜端点可能返回 `useCount` / `originVideoUrl`
  - B站视频端点可能返回 BGM 信息
  - 不同端点字段差异大，所有新字段设为可选

#### 7.4 模块联动

- **`hot.ts`**：`HotItem` / `ApiListItem` / `toItem` 扩展（改动点）
- **`classify.ts`**（P3）：`ClassifiedItem extends HotItem` 自动继承新字段
- **`prompts-data.ts`**：`buildVideosPrompt` / `buildTagReportPrompt` 可在数据格式化时展示新字段（如 BGM 报告展示 `bgmTitle` + `useCount`）
- **`report-savers.ts`**：`saveHotReport` 传入的 `HotData` 自动携带新字段
- **`generate-manifest.ts`**：RSS feed 的 `description` 可包含新字段摘要

#### 7.5 预期效果

- 报告中每条内容附带创作者决策信息
- BGM 报告显示歌名 + 使用量 + 搜索关键词
- 舞蹈报告显示难度评估 + 参考视频链接
- 创作者能快速判断"这个热点值不值得跟"

---

## 八、饭圈内容风险标注（P7 - P4 附属项）

**在饭圈相关内容的报告生成中，要求 LLM 标注话题性质（正面/争议/负面）并附风险提示，帮助创作者规避舆论风险。属 P4 的附属项（fandom 专项报告 prompt 的组成部分），建议与 fandom 专项一起上线而非事后补——饭圈内容"不带风险标注就推送"本身就是风险。**

### 具体功能与实现

#### 8.1 设计背景

- **饭圈内容特点**：如"赵露思""张元英""柳智敏"等明星话题，"热门又有很多人黑"，蹭流量收益高但风险也高
- **创作者痛点**：不知道某个话题是正面还是争议，盲目跟风可能卷入舆论风波
- **改进目标**：报告中对每个饭圈话题标注性质，争议类加风险提示

#### 8.2 标注维度

| 标注项 | 取值 | 含义 |
|--------|------|------|
| `topicNature` | `positive` / `controversial` / `negative` | 话题性质 |
| `riskLevel` | `low` / `medium` / `high` | 风险等级 |
| `riskNote` | 字符串 | 风险提示语（如"该话题存在较大争议，蹭流量需谨慎，避免站队"） |

#### 8.3 实现方式

- **修改文件**：`src/prompts-data.ts`
- **改动内容**：在 `buildTagReportPrompt`（P4 新增）的 `fandom` 标签 Prompt 中增加风险标注指令
  - 要求 LLM 对每个饭圈话题判断 `topicNature` 和 `riskLevel`
  - 争议/负面话题必须附 `riskNote` 风险提示
  - 正面话题可选附 `riskNote`
- **Prompt 指令示例**：
  ```
  对于每个饭圈/明星话题，请标注：
  - 话题性质：positive（正面）/ controversial（争议）/ negative（负面）
  - 风险等级：low / medium / high
  - 风险提示：（争议/负面必填）如"该话题存在较大争议，蹭流量需谨慎，避免站队"
  ```

#### 8.4 模块联动

- **`prompts-data.ts`**：`fandom` 标签的 Prompt 增加风险标注指令
- **`classify.ts`**（P3）：`fandom` 标签的内容会被送入 fandom 专项报告
- **`report-savers.ts`**：`saveTagReport` 生成 fandom 报告时使用含风险标注的 Prompt
- **`feishu.ts` / `notify.ts`**：推送时 highlights 可附风险标记（如 `[争议] 赵露思话题`）

#### 8.5 预期效果

- 创作者能一眼看出某个饭圈话题是正面还是争议
- 争议/负面话题有明确风险提示，避免盲目跟风
- 正面话题可放心蹭流量

---

## 九、抽象内容 LLM 辅助识别（P8 - P3 附属项）

**对关键词规则无法覆盖的"抽象"内容（无厘头梗），用 LLM 批量分类辅助识别，适应不断演化的抽象梗生态。属 P3 的附属项（classify.ts 引擎 2 的实施细节），随 P3 一起实现。另注：P0 接入的 B站鬼畜区（type 119）本身就是抽象内容的天然聚集地，可按来源先验直接预置 `meme` 标签，进一步降低对 LLM 识别的依赖。**

### 具体功能与实现

#### 9.1 设计背景

- **"抽象"内容定义**：无厘头、反逻辑、玩梗性质的短视频内容，如"杨明熙（水果派）"这类难以用关键词穷举的梗
- **关键词规则的局限**：抽象梗不断演化，新梗层出不穷，关键词表无法穷举
- **LLM 的优势**：能理解语义，判断"这条内容是否属于娱乐/抽象范畴"，适应新梗

#### 9.2 实现方式

- **归属模块**：`src/classify.ts`（P3）的引擎 2（LLM 批量分类）
- **触发条件**：引擎 1（关键词规则）标记为 `other` 的 items
- **批量分类 Prompt**：
  ```
  以下是不确定类别的短视频热点标题，请判断每条是否属于以下类别之一：
  - meme（流行梗/抽象/无厘头内容）
  - fandom（饭圈/明星动态）
  - game（游戏相关）
  - social-news（社会新闻，需过滤）
  - other（确实无法分类）

  返回 JSON：[{id: "xxx", tags: ["meme"], reason: "判断理由"}]

  标题列表：
  1. [id:xxx] 杨明熙水果派
  2. [id:yyy] 某地发生地震
  ...
  ```
- **成本控制**：
  - 只对 `other` 类调用 LLM（来源先验 + 关键词已消化大部分）
  - 批量传入（一次调用处理 ≤50 条），而非逐条
  - 每天约 2-3 次批量调用，成本可控
  - 用 `callLlm(prompt, 4096)` 保证批量 JSON 输出不被截断

#### 9.3 模块联动

- **`classify.ts`**（P3）：引擎 2 的 LLM 批量分类逻辑
- **`report.ts`**：`callLlm` / `parseLlmJson`（复用现有 LLM 调用基础设施）
- **`prompts-data.ts`**：可新增 `buildClassifyPrompt(items)` 构建分类 Prompt
- **`index.ts`**：Phase 1 后的分类步骤调用 `classifyBatch`

#### 9.4 预期效果

- 抽象梗、新梗能被准确识别为 `meme` 标签
- 社会新闻被准确识别为 `social-news` 并过滤
- 来源先验覆盖天然娱乐分区 + 关键词规则覆盖明确类目 + LLM 兜底模糊判断，三级互补
- 每天约 2-3 次额外批量 LLM 调用，成本可控

---

## 十、改进路线图与里程碑

### 10.1 分阶段推进

| 阶段 | 改进项 | 改动范围 | 预期效果 | 成本 | 里程碑 |
|------|--------|---------|---------|------|--------|
| **P0** | 数据源扩充（config.yml 新增娱乐垂类源） | 仅配置文件（建议先自部署 DailyHotApi） | 报告娱乐占比显著提升（估算 70%+） | 低（需先实测端点） | 逐源验证后生效 |
| **P1** | 视频 Prompt 重构为创作者视角分类 | prompts-data.ts（含周月报 prompt 同步） | 报告直接可用 | 低 | 报告从"展示"变"决策参考" |
| **P2** | 热搜 Prompt 增加娱乐向/非娱乐向分流 | prompts-data.ts 1 个函数（douyin+weibo 共用） | 过滤社会新闻 | 低 | 热搜报告娱乐向聚焦 |
| **P3** | 新增 classify.ts 分类过滤层（含 P8 抽象识别） | 新增 1 文件 + index.ts 串联 + config.yml keyword_tags | 精准过滤，减少 LLM 噪音 | 中 | 数据预处理层建立 |
| **P4** | 报告按分类拆分多份定向报告（含 P7 饭圈风险标注） | report-savers.ts + prompts-data.ts + i18n.ts + index.ts | 创作者各取所需 | 中 | 专项报告上线 |
| **P5** | 创作者画像 + 推送分流 | config + feishu.ts + notify.ts | 精准推送 | 中 | 按创作者类型分群推送 |
| **P6** | HotItem 元数据增强 | 上游 DailyHotApi 二开 + hot.ts | 提供精确创作决策数据 | 高（远期） | 报告含使用量/BGM 信息 |

### 10.2 依赖关系

```
P0 (数据源) ──────── 独立，可立即做（前置：端点实测，建议自部署）
P1 (视频Prompt) ──── 独立，可立即做（含周报/月报 prompt 同步）
P2 (热搜Prompt) ──── 独立，可立即做
P3 (分类层) ──────── 依赖 P0（更多数据源分类才有意义）
P4 (报告拆分) ────── 依赖 P3（分类标签是拆分基础）
P5 (推送分流) ────── 依赖 P4（专项报告才能按标签过滤推送）
P7 (饭圈风险标注) ── P4 附属项，与 fandom 专项同步上线
P8 (抽象LLM识别) ─── P3 附属项，即 classify.ts 引擎 2
P6 (元数据增强) ──── 远期；依赖自部署 DailyHotApi 二开（见第七章核查）
```

### 10.3 快速见效路径

**最小改动、最大收益的路径**：P0 + P1 + P2（仅改 1 个配置文件 + 1 个 Prompt 文件）

- P0 让数据源从"社会新闻为主"转为"娱乐垂类为主"
- P1 让视频报告从"内容属性分类"转为"创作者视角分类"
- P2 让抖音/微博热搜报告自动过滤社会新闻
- 三者独立可并行，**无需新增文件、无需改架构**，端点验证通过后半天内可完成上线

### 10.3.1 LLM 成本估算（新增）

| 阶段 | 每日 callLlm 次数（日报流水线） | 相对当前 |
|------|------|------|
| 当前 | 3 报告 + 1 highlights = **4** | 1× |
| P0 后（第一梯队 6 源全接） | 9 报告 + 1 highlights = **10** | 2.5× |
| P3 后 | +2~3 次批量分类 = **12~13** | 3× |
| P4 后（不裁撤源报告） | +5 专项 = **17~18** | 4.5× |
| P4 后（按 5.6 建议裁撤源报告至 2 份） | 2 源 + 5 专项 + 分类 + highlights ≈ **10~11** | 2.5× |

> 火山方舟按 token 计费，报告类调用输入约 3-6K token/次。P4 阶段务必执行 5.6 的裁撤建议，否则成本与信息重复都翻倍。

### 10.3.2 验证与回滚策略（新增）

- **每阶段上线动作**：commit + push → GitHub Actions 手动 `workflow_dispatch` 跑 Daily → 查看 Actions 日志（关注 `fetchSuccess`、LLM 报错、契约裁剪日志）→ 检查 GitHub Pages 页面产物
- **回滚**：所有阶段的改动都应独立成 commit，`git revert <commit>` 单点回滚；P0 属纯配置回滚成本最低
- **观察窗口**：每阶段上线后观察 2-3 天自然运行（含一个周报周期更佳）再进入下一阶段，避免多阶段问题叠加难定位

### 10.3.3 全局风险清单（新增）

| 风险 | 影响 | 缓解 |
|------|------|------|
| 公共 DailyHotApi 实例限流/宕机 | 多源大面积 `fetchSuccess: false`，当天报告缺失 | **自部署**（P0 前置）；容错已保证不崩溃 |
| 微博热搜社会新闻占比高 | weibo 源报告噪音大 | P2 分流 + P3 过滤是 weibo 源的前置依赖 |
| 饭圈内容舆论风险 | 推送争议内容给创作者引发跟风翻车 | P7 风险标注与 fandom 专项**同步**上线 |
| highlights 输出截断 | 报告数增多后通知摘要不完整 | 上调 highlights token 预算（2048→3072+） |
| 思考模型输出失控 | 专项报告绕过防线泄漏思考 | P4 严格沿用 H2 锚点契约（5.3 已标注） |
| 分类误杀热点 | 娱乐内容被标为 social-news 被过滤 | 优先级规则（4.3）+ 失败兜底"宁多勿漏" |

### 10.4 终极形态

完成全部改进后，系统将演化为：

- **数据层**：9+ 娱乐垂类数据源（B站舞蹈/鬼畜/游戏/娱乐区、微博热搜、快手、米哈游系/LOL 动态等，自部署实例支撑）
- **分类层**：来源先验 + 关键词规则 + LLM 兜底三级引擎，每条内容携带娱乐标签
- **报告层**：少量综合源报告 + 按标签的专项报告（BGM/舞蹈/梗/游戏/饭圈，饭圈含风险标注）
- **推送层**：按创作者画像分群推送，舞蹈博主收舞蹈内容、游戏博主收游戏内容，未配置画像时回退全量推送
- **元数据层**（远期）：自部署二开后，内容含使用量/BGM/参考链接等精确决策数据

---

## 附录：与 ARCHITECTURE.md 的对应关系

| 改进项 | 对应 ARCHITECTURE.md 章节 | 改动性质 |
|--------|--------------------------|---------|
| P0 数据源扩充 | 三、配置系统 | 仅改 config.yml（highlights 预算微调除外） |
| P1 视频 Prompt 重构 | 七、Prompt 构建层 + 十、周报月报汇总 | 改 prompts-data.ts（含周月报 prompt） |
| P2 热搜分流指令 | 七、Prompt 构建层 | 改 prompts-data.ts |
| P3 分类过滤层（含 P8） | 新增（采集层与报告层之间） | 新增 classify.ts + config.yml keyword_tags |
| P4 报告拆分（含 P7） | 八、报告生成层 + 六、LLM 基础设施（输出契约） | 改 report-savers.ts + prompts-data.ts + i18n.ts + index.ts |
| P5 推送分流 | 十一、通知推送系统 + 三、配置系统 | 改 feishu.ts + notify.ts + config |
| P6 元数据增强（远期） | 四、数据采集层 + 上游 DailyHotApi | 上游二开 + 改 hot.ts |
| P7 饭圈风险标注 | 七、Prompt 构建层 | 归入 P4 的 buildTagReportPrompt |
| P8 抽象 LLM 识别 | 新增（分类层引擎2） | 归入 classify.ts |
