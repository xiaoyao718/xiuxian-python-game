# 修仙学 Python · 仓绝大陆（第一卷）

> **当前版本：MVP v1.0（最小可行版本）** — 功能闭环已就绪，**后续将持续更新迭代**（见文末「迭代计划」）。
> 在线试玩：https://xiaoyao718.github.io/xiuxian-python-game/（GitHub Pages）

一个面向 0 基础学习者的 Python 剧情闯关网页游戏：随主角林慕在仓绝大陆上，
从 `print` 一路修到 `for`，最后亲手修正法诀渡过筑基天劫。

纯静态、零构建：双击 `index.html` 即可运行（浏览器内运行 Python 功能需要联网加载
Skulpt；音效为 WebAudio 实时合成，不需要任何音频文件）。

## 当前功能清单

**剧情与闯关**

- 5 个教学章 + 1 个写代码 Boss 关（渡劫），剧情 / 讲解 / 题目全通闭环
- 每章「历练」剧情与题目交错；历练通关后可进入「试炼」巩固（`quizExtra` 新题）
- 题型：选择题（B 类）与代码补全题（C 类 `kind: "fill"`，点击候选片段拼代码）
- Boss 渡劫支持「你的输出 vs 预期输出」逐行差异反馈，答错 3 次后出示完整预期
- 第二卷内容：暂缓，本 MVP 不做（数据层可随时追加 `levels`）

**学习反馈**

- 错题本（小师妹的笔记本）：历练/试炼答错自动收录，按章节列出，重做答对即移除
- 浏览器内运行 Python（渐进增强）：讲解页示例代码块与所有带 `code` 的选择题、
  Boss 残缺法诀都会出现「▶ 运行」，运行结果实时显示在代码块下方「运行结果」区
  - Skulpt 1.2.0 懒加载（jsDelivr CDN），首次点击运行才注入脚本
  - 含 `input()` 的示例不显示运行按钮
  - 断网 / CDN 加载失败时静默降级：隐藏运行按钮并提示「请在 PyCharm 中运行」，
    不影响主流程
  - Boss 关运行后可一键「把运行结果填入下方答案框」，填入前按提交判定的同款
    norm 规则清洗（复用 `App.normOutput`）
- WebAudio 合成音效（零外部音频资源，js/sound.js）：
  - 点击/翻页：短促木鱼/拨弦音；答对：清亮磬音上行两音；答错：低闷鼓 + 下坠余音；
    破境：由低到高的钟磬齐鸣；渡劫雷声：低频噪声包络；印章解锁：短促「嗒」
  - 侧栏「喇叭」按钮可随时开关，图标随状态切换；设置写入 v2 存档的
    `settings.sound`；AudioContext 只在音效开启且用户首次点击后才创建，遵守自动播放策略
- 成就印章系统：暂缓（见「成就系统说明」）；印章音效钩子已预留为 `App.sfx("seal")`

**工程化**

- `scripts/validate-data.js`：内容数据校验（Node 可运行，也可粘贴进浏览器 Console）
- 进度存档 `xiuxian-python-game-v2`；读取到旧版 v1 存档时自动迁移并保留原键
- 键盘：选择题按 1/A、2/B、3/C、4/D 作答，Enter 触发主按钮，S 跳过剧情（输入框内不误触）
- 移动端 <900px：侧栏收起为汉堡按钮 + 滑出式抽屉；触屏点击区不小于 40px
- 可访问性：图标按钮带 `aria-label`，键盘焦点 `:focus-visible` 金色描边

## 文件结构

```text
xiuxian-python-game/
├── index.html              # 页面骨架（侧栏 / 主舞台 / 氛围层 / 音效按钮）
├── css/style.css           # 重水墨视觉 + 全部组件样式
├── js/
│   ├── data.js             # 剧情 / 讲解 / 题库 / quizExtra（纯内容）
│   ├── game.js             # 游戏引擎（进度、题型、错题本、Boss、键盘）
│   ├── sound.js            # WebAudio 合成音效（点击/答对/答错/破境/雷声/印章）
│   └── runner.js           # 浏览器内运行 Python（Skulpt 懒加载 + 降级）
├── scripts/
│   └── validate-data.js    # 数据校验脚本（Node / 浏览器 Console 双模式）
├── assets/scenes/          # 章节场景 SVG
└── README.md
```

## 本地运行

方式一：直接双击 `index.html`。

方式二：项目目录起静态服务：

```bash
python -m http.server 8000
```

然后访问 http://localhost:8000。

说明：

- 离线也能完整游玩剧情与答题；只有「▶ 运行」需要联网加载 Skulpt（会自动降级）。
- 浏览器内运行 Python 是渐进增强：未加载 `runner.js` 或加载失败时，游戏功能不受影响。

## 如何加关卡 / 新题型

只改 `js/data.js`，向 `levels` 数组追加新对象，`game.js` 不需要动：

```js
{
  id: "lv6",              // 必须全局唯一（校验脚本会查）
  kind: "lesson",         // 或 "boss"
  chapter: "第六章",
  title: "章节名",
  stageLabel: "境界名",    // 与 D.realms 对应
  story: [...],           // { who, text }，可带 art: { src, alt, caption }
  lesson: { name, intro, points: [...], example: { code, output } },
  quest: [ { who, text }, { q: 0 }, ... ],   // {q:n} 指向 questions 下标
  questions: [ { q, options, answer, hint, explain, cheer } ],
  quizExtra: [ ... ],     // 试炼巩固题；可选，规则同 questions
  outro: [...]
}
```

新题型（补全题）示例：

```js
{
  kind: "fill",
  q: "题干",
  code: "print(__1__, __2__)",   // __n__ 占位
  slots: [ ["\"林慕\"", "林慕"], ["18", "\"18\""] ],
  answer: [0, 0]
}
```

加完跑一遍校验：

```bash
node scripts/validate-data.js
```

若在纯静态页面直接测试，也可把 `scripts/validate-data.js` 粘贴到 DevTools Console
执行；浏览器模式无法同步检查 `art.src` 文件存在性，会输出 SKIP，请用 Node 复核。

## 存档说明

- v1 键：`xiuxian-python-game-v1`（旧档，迁移后保留不删，可作回滚基线）
- v2 键：`xiuxian-python-game-v2`，结构为
  `{ done, mistakes, achievements, settings: { sound, fx }, boss }`
- 「重置进度」会清空 v1/v2 两处进度（含错题本），随后重新从封面开始

## 音效与自动播放策略

- 首次点击页面任意可交互元素时才创建 `AudioContext`，因此不存在浏览器拦截自动播放的问题。
- 侧栏喇叭按钮的状态写入 `settings.sound`；关闭后再开启时立即恢复音量。
- 音效全部为实时合成，单个音效时长 < 1.2s，无任何外部音频资源。
- `App.setSound(bool)` 已暴露给外部；游戏内成败反馈经 `App.sfx(name)` 触发，
  可选名：`click / right / wrong / breakthrough / thunder / seal`。

## 成就系统说明（暂缓）

本 MVP 不实现成就印章 UI 与第二卷内容，理由：

- 第一卷体量小，现有剧情/错题本已覆盖学习闭环；成就需要跨卷长期语义，过早设计会返工。
- 数据层已留好扩展位：未来可在 `GAME_DATA.achievements` 追加条目，例如
  `{ id: "lv2_first", cond: { type: "level", id: "lv2" } }`；
  `validate-data.js` 会校验 `cond` 引用的关卡存在。
- 引擎侧已保留 `App.sfx("seal")` 印章音效钩子，成就解锁回调里直接调用即可。

## 数据校验输出样例

```text
[PASS] levels 6 关，id 唯一
[PASS] lv1.quest[2].q = 0 指向 questions[0]，合法
[PASS] lv1.questions[0].options 3 项（>=2）
[PASS] lv1.questions[0].answer = 0 在界内（0..2）
[PASS] lv1.quizExtra[1].answer[0] = 0 在候选范围内（0..2）
[PASS] lv1.story[6].art.src 文件存在：assets/scenes/lv1-book.svg
[PASS] achievements GAME_DATA 中未定义（MVP 暂缓），引用检查通过
[SUMMARY] PASS N / FAIL 0 / SKIP 0
```

任一项 FAIL 时脚本会以退出码 1 结束，便于接入 CI。

## 迭代计划（Roadmap）

当前为 **MVP v1.0（最小可行版本）**，以下能力按优先级排队，持续更新中：

- [ ] 成就印章系统（数据扩展位与 `App.sfx("seal")` 音效钩子已预留）
- [ ] 第二卷「笔记本秘境」：字符串 / 列表 / 字典 / 函数 / while / 异常（数据层可随时追加 `levels`）
- [ ] 角色立绘与更多章节插画（视觉资产逐步补充）
- [ ] 灵石经济：首答正确得灵石，可兑换官方提示
- [ ] PWA 离线安装
- [ ] 破境结算页：本章用时 / 失误数统计

欢迎 Star / Issue 反馈，一起把这条路修到仓绝大陆最高处。
