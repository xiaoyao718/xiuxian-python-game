// ============================================================
// 游戏引擎 · 第一卷
// 剧情 → 讲解 → 试炼（3 题）→ 破境 → 下一章；终章为写代码渡劫。
// ============================================================

(function () {
  "use strict";

  const D = window.GAME_DATA;
  const LS_KEY = "xiuxian-python-game-v2";
  const LS_KEY_V1 = "xiuxian-python-game-v1";
  const LABEL = ["甲", "乙", "丙", "丁"];
  const reducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // 打字机速度：字/秒（约 40–60，可按需调高 TYPE_CPS）
  const TYPE_CPS = 52;
  const TYPE_INTERVAL_MS = Math.max(12, Math.round(1000 / TYPE_CPS));

  const stageBox = document.getElementById("stageBox");
  const fxBox = document.getElementById("fx");

  // 渲染层状态（不动游戏流程逻辑）
  let typeTimer = null;
  let typeTarget = null;
  let sceneFadeInTimer = null;
  let sceneFadeOutTimer = null;
  let scenePending = null;
  let bossTriesPainted = -1;
  let breakEndHandler = null;

  // 指针视差：插图随光标轻移，只启用鼠标设备
  if (!reducedMotion && window.matchMedia("(pointer: fine)").matches) {
    const appBox = document.getElementById("app");
    stageBox.addEventListener("pointermove", function (ev) {
      const r = stageBox.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / Math.max(r.width, 1) - 0.5) * 2;
      const py = ((ev.clientY - r.top) / Math.max(r.height, 1) - 0.5) * 2;
      appBox.style.setProperty("--px", px.toFixed(3));
      appBox.style.setProperty("--py", py.toFixed(3));
    });
    stageBox.addEventListener("pointerleave", function () {
      appBox.style.setProperty("--px", "0");
      appBox.style.setProperty("--py", "0");
    });
  }

  // ---------- 进度（v2 存档；含 v1 迁移，v1 原键保留防回滚） ----------
  function freshState() {
    return {
      done: [],
      mistakes: [],
      achievements: [],
      settings: { sound: true, fx: true },
      boss: false
    };
  }

  function normalizeState(p) {
    const s = freshState();
    if (!p || typeof p !== "object") return s;
    if (Array.isArray(p.done)) s.done = p.done.slice();
    if (Array.isArray(p.mistakes)) {
      s.mistakes = p.mistakes.filter(function (m) {
        return (
          m &&
          typeof m === "object" &&
          m.levelId &&
          typeof m.qText === "string" &&
          typeof m.qType === "string"
        );
      });
    }
    if (Array.isArray(p.achievements)) s.achievements = p.achievements.slice();
    if (p.settings && typeof p.settings === "object") {
      s.settings.sound = p.settings.sound !== false;
      s.settings.fx = p.settings.fx !== false;
    }
    s.boss = !!p.boss;
    return s;
  }

  function loadState() {
    // 优先读 v2
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p === "object") {
          return normalizeState(p);
        }
      }
    } catch (e) {
      // v2 损坏则回退到 v1 或全新档案
    }
    // 只有 v1：自动迁移到 v2，v1 原键保留不动（防回滚）
    try {
      const raw1 = localStorage.getItem(LS_KEY_V1);
      if (raw1) {
        const p1 = JSON.parse(raw1);
        if (p1 && Array.isArray(p1.done)) {
          const migrated = normalizeState({
            done: p1.done,
            boss: !!p1.boss,
            mistakes: [],
            achievements: [],
            settings: { sound: true, fx: true }
          });
          try {
            localStorage.setItem(LS_KEY, JSON.stringify(migrated));
          } catch (e2) {
            // 写入失败不阻断游玩
          }
          return migrated;
        }
      }
    } catch (e1) {
      // v1 损坏则重来
    }
    return freshState();
  }

  let state = loadState();

  // 当前关卡会话状态
  let cur = {
    li: 0,
    phase: "story", // story | lesson | quiz | quest | boss | outro | clear
    si: 0,
    qi: 0,
    questPos: 0,
    questDone: false,
    wrong: {},
    qDone: false,
    seenQuiz: false,
    seenQuest: false,
    wipeNext: false,
    coverShown: false,
    finaleShown: false,
    fillWrong: false,
    tries: 0,
    answer: "",
    // C 型补全题会话状态
    fill: [],
    fillSig: "",
    // 错题重做会话
    redoLevelId: "",
    redoPool: "",
    redoQi: -1,
    redoQ: null,
    redoWrong: [],
    savedCur: null
  };

  function saveState() {
    // 音效开关以 sound.js 的实时状态为准，防止整档覆盖把用户设置冲回默认
    if (window.App && typeof window.App.isSoundOn === "function" && state.settings) {
      try {
        state.settings.sound = window.App.isSoundOn();
      } catch (e) {
        // 忽略
      }
    }
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) {
      // 存储失败不阻断游玩
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[c];
    });
  }

  // 音效钩子：由 js/sound.js 提供（App.sfx）。加载失败/被移除时静默跳过，
  // 绝不因音效问题影响任何游戏流程。
  function sfx(name) {
    try {
      if (window.App && typeof window.App.sfx === "function") {
        window.App.sfx(name);
      }
    } catch (e) {
      // 音效异常一律忽略
    }
  }

  function isDone(id) {
    return state.done.indexOf(id) !== -1;
  }

  function firstUndone() {
    for (let i = 0; i < D.levels.length; i++) {
      if (!isDone(D.levels[i].id)) return i;
    }
    return -1;
  }

  function currentRealm() {
    const i = firstUndone();
    if (i === -1) return D.levels[D.levels.length - 1].stageLabel;
    if (i === 0) return D.realms[0] || "凡人";
    return D.levels[i - 1].stageLabel;
  }

  function progressText() {
    const doneCount = state.done.length;
    return doneCount + "/" + D.levels.length;
  }

  function levelIndexById(id) {
    for (let i = 0; i < D.levels.length; i++) {
      if (D.levels[i].id === id) return i;
    }
    return -1;
  }

  // 试炼题库：优先 quizExtra（巩固题）；无则回退 questions（兼容旧章节）
  function quizPoolFor(lv) {
    if (lv && lv.quizExtra && lv.quizExtra.length) return lv.quizExtra;
    return (lv && lv.questions) || [];
  }

  function qTypeOf(q) {
    return q && q.kind === "fill" ? "fill" : "choice";
  }

  function fillCodeOf(q, chosen) {
    let code = String(q.code || "");
    (q.slots || []).forEach(function (cands, s) {
      const ci = chosen && chosen[s];
      const repl =
        ci != null && cands && cands[ci] != null ? String(cands[ci]) : "__" + (s + 1) + "__";
      code = code.replace("__" + (s + 1) + "__", repl);
    });
    return code;
  }

  function correctAnswerOf(q) {
    if (q.kind === "fill") return fillCodeOf(q, q.answer);
    return String((q.options || [])[q.answer] || "");
  }

  // ---------- 错题本：记录 / 去重更新 / 答对移除 ----------
  function mistakeMatches(m, levelId, qType, qText) {
    return (
      m &&
      m.levelId === levelId &&
      m.qType === qType &&
      m.qText === qText
    );
  }

  function recordMistake(q, userAnswer) {
    const levelId = D.levels[cur.li].id;
    const qType = qTypeOf(q);
    const qText = q.q;
    const correctAnswer = correctAnswerOf(q);
    const oldIdx = state.mistakes.findIndex(function (m) {
      return mistakeMatches(m, levelId, qType, qText);
    });
    const rec = {
      levelId: levelId,
      qi: cur.qi,
      qType: qType,
      qText: qText,
      userAnswer: userAnswer,
      correctAnswer: correctAnswer,
      ts: Date.now()
    };
    if (oldIdx !== -1) {
      rec.qi = state.mistakes[oldIdx].qi;
      state.mistakes[oldIdx] = rec;
    } else {
      state.mistakes.push(rec);
    }
    saveState();
    refreshMistakeBadge();
  }

  function forgetMistake(q) {
    const levelId = D.levels[cur.li].id;
    const qType = qTypeOf(q);
    const idx = state.mistakes.findIndex(function (m) {
      return mistakeMatches(m, levelId, qType, q.q);
    });
    if (idx !== -1) {
      state.mistakes.splice(idx, 1);
      saveState();
      refreshMistakeBadge();
    }
  }

  function resolveMistakeQuestion(rec) {
    const li = levelIndexById(rec.levelId);
    if (li === -1) return null;
    const lv = D.levels[li];
    const pools = [];
    if (Array.isArray(lv.questions) && lv.questions.length) {
      pools.push({ pool: "quest", arr: lv.questions });
    }
    if (Array.isArray(lv.quizExtra) && lv.quizExtra.length) {
      pools.push({ pool: "quiz", arr: lv.quizExtra });
    }
    const match = function (q) {
      return q && q.q === rec.qText && qTypeOf(q) === rec.qType;
    };
    for (let p = 0; p < pools.length; p++) {
      const arr = pools[p].arr;
      if (rec.qi >= 0 && rec.qi < arr.length && match(arr[rec.qi])) {
        return { li: li, pool: pools[p].pool, qi: rec.qi, q: arr[rec.qi] };
      }
    }
    for (let p = 0; p < pools.length; p++) {
      const arr = pools[p].arr;
      for (let i = 0; i < arr.length; i++) {
        if (match(arr[i])) {
          return { li: li, pool: pools[p].pool, qi: i, q: arr[i] };
        }
      }
    }
    return null;
  }

  function refreshMistakeBadge() {
    const badge = document.getElementById("mistakeCount");
    if (!badge) return;
    const n = (state.mistakes || []).length;
    badge.textContent = n ? String(n) : "";
    badge.classList.toggle("has", n > 0);
    const btn = document.getElementById("btnMistakes");
    if (btn) {
      btn.title = n
        ? "小师妹的笔记本 · " + n + " 道错题"
        : "小师妹的笔记本（暂无错题）";
    }
  }

  // ---------- 场景氛围：每章一套天色（低开高走） ----------
  function setSceneNow(n) {
    const root = document.documentElement;
    if (root) root.setAttribute("data-scene", String(n));
    const main = document.getElementById("main");
    if (main) main.setAttribute("data-scene", String(n));
  }

  // 场景切换：用极淡墨幕做 600ms 左右过渡（reduced-motion 直接切换）
  function setScene(n) {
    const fade = document.getElementById("sceneFade");
    const firstPaint = !document.documentElement.hasAttribute("data-scene");
    const curScene = document.documentElement.getAttribute("data-scene");
    if (reducedMotion || !fade || firstPaint) {
      scenePending = null;
      setSceneNow(n);
      return;
    }
    // 目标场景没变（同一幕内重绘）：不重放墨幕，也不打断正在进行的同景过渡
    if (scenePending === n || String(n) === curScene) {
      return;
    }
    window.clearTimeout(sceneFadeInTimer);
    window.clearTimeout(sceneFadeOutTimer);
    fade.classList.remove("is-on");
    // 强制回流，让下一次 class 变化能触发过渡
    void fade.offsetWidth;
    fade.classList.add("is-on");
    scenePending = n;
    sceneFadeInTimer = window.setTimeout(function () {
      setSceneNow(n);
      scenePending = null;
    }, 300);
    sceneFadeOutTimer = window.setTimeout(function () {
      fade.classList.remove("is-on");
    }, 640);
  }

  function applyScene(override) {
    if (typeof override === "number") {
      setScene(override);
      return;
    }
    if (cur.phase && cur.li >= 0 && D.levels[cur.li]) {
      // lv1..lv5 → 1..5，boss（li=5）→ 6
      setScene(cur.li + 1);
    }
  }

  // ---------- 打字机显现（纯渲染层；整段文本始终在 DOM 中兜底） ----------
  function stopTypewriter() {
    if (typeTimer !== null) {
      window.clearInterval(typeTimer);
      typeTimer = null;
    }
    if (typeTarget) {
      typeTarget.classList.remove("typing");
      typeTarget.classList.add("typed");
      typeTarget = null;
    }
  }

  function startTypewriter(root) {
    stopTypewriter();
    if (reducedMotion) return;
    const box = root || stageBox;
    const el = box.querySelector(".type-text");
    if (!el) return;
    const raw = el.textContent || "";
    if (raw.length < 6) return;
    el.classList.add("typing");
    typeTarget = el;
    el.textContent = "";
    let pos = 0;
    const reveal = function () {
      if (typeTarget) {
        typeTarget.textContent = typeTarget.dataset.raw || raw;
        stopTypewriter();
      }
    };
    el.dataset.raw = raw;
    const item = el.closest(".dialog-item") || box;
    item.addEventListener("click", reveal);
    typeTimer = window.setInterval(function () {
      pos += 1;
      if (!typeTarget) return;
      typeTarget.textContent = raw.slice(0, pos);
      if (pos >= raw.length) stopTypewriter();
    }, TYPE_INTERVAL_MS);
  }

  // 渲染收尾：若本屏是新“幕”（章节/题目/结算切换），给卡片加幕布式入场
  function finishStage(override) {
    stopTypewriter();
    if (cur.wipeNext) {
      cur.wipeNext = false;
      const card = stageBox.querySelector(".card");
      if (card) card.classList.add("wipe-card");
    }
    applyScene(override);
  }

  // ---------- 全屏灵尘：缓缓上升的光点 ----------
  function buildMotes() {
    const box = document.getElementById("motes");
    if (!box || box.childElementCount) return;
    let html = "";
    for (let i = 0; i < 26; i++) {
      const left = (i * 47 + 11) % 100;
      const size = i % 7 === 0 ? 5 : i % 5 === 0 ? 4 : i % 2 === 0 ? 3 : 2;
      const dur = (7 + ((i * 29) % 80) / 10).toFixed(1);
      const delay = (-(((i * 47) % 100) / 100) * dur).toFixed(2);
      const sway = ((i * 37) % 90) - 45;
      const cls = i % 6 === 2 ? " mote-qi" : "";
      html +=
        '<i class="mote' + cls + '" style="left:' + left + "%;width:" + size + "px;height:" + size +
        "px;--sway:" + sway + "px;animation-duration:" + dur + "s;animation-delay:" + delay + 's"></i>';
    }
    box.innerHTML = html;
  }

  // ---------- 侧栏路线图 ----------
  function renderRoadmap() {
    const box = document.getElementById("roadmap");
    document.getElementById("volumeName").textContent = D.meta.volume;
    document.getElementById("heroTip").textContent =
      "主角：" + D.meta.hero + " · 境界：" + currentRealm() + " · 进度 " + progressText();

    const first = firstUndone();
    box.innerHTML = D.levels
      .map(function (lv, i) {
        const done = isDone(lv.id);
        const current = i === first;
        const cls = done ? "road-node done" : current ? "road-node current" : "road-node locked";
        const status = done ? "过" : "";
        const canClick = done || current;
        return (
          '<div class="' + cls + '" data-i="' + i + '"' +
          (canClick ? ' title="重游本章"' : "") + ">" +
          '<span class="node-status">' + status + "</span>" +
          "<span>" + esc(lv.chapter + " · " + lv.title) + "</span>" +
          "</div>"
        );
      })
      .join("");

    box.querySelectorAll(".road-node.done, .road-node.current").forEach(function (node) {
      node.addEventListener("click", function () {
        closeSideDrawer();
        goStory(Number(node.getAttribute("data-i")));
      });
    });
    refreshMistakeBadge();
  }

  // ---------- 通用：一段一段的对话 ----------
  function dialogRoleOf(who) {
    if (who === "旁白") return { role: "narrator", seal: "叙" };
    if (who === "林慕") return { role: "hero", seal: "慕" };
    if (who === "仙典") return { role: "xian", seal: "典" };
    if (who === "林韬" || who === "周显") return { role: "antagonist", seal: "嘲" };
    const first = who ? String(who).charAt(0) : "语";
    return { role: "npc", seal: first };
  }

  function dialogHTML(lines, i, isOutro) {
    const line = lines[i];
    const name = esc(line.who);
    const text = esc(line.text);
    const roleInfo = dialogRoleOf(line.who);
    let art = "";
    if (line.art) {
      art =
        '<div class="scene-art">' +
        '<img src="' +
        esc(line.art.src) +
        '" alt="' +
        esc(line.art.alt || "") +
        '" loading="lazy" onerror="this.style.display=\'none\'">' +
        (line.art.caption
          ? '<div class="scene-art-cap">' + esc(line.art.caption) + "</div>"
          : "") +
        "</div>";
    }
    return (
      art +
      '<div class="dialog-item" data-who="' + name + '" data-role="' + roleInfo.role + '">' +
      '<div class="who-name" data-seal="' + esc(roleInfo.seal) + '">' + name + "</div>" +
      '<div class="who-text type-text">' + text + "</div>" +
      "</div>"
    );
  }

  function navHTML(opts) {
    let right = "";
    if (opts.skip) {
      right +=
        '<button class="btn ghost small" data-skip="1" onclick="App.skip()" type="button">跳过剧情</button> ';
    }
    right +=
      '<button class="btn primary" onclick="App.next()" type="button">' +
      opts.nextLabel +
      "</button>";
    return '<div class="btn-row">' + right + "</div>";
  }

  function topMeta(li) {
    const lv = D.levels[li];
    return (
      '<div class="scene-head">' +
      '<span class="chapter-tag">' + esc(lv.chapter) + "</span>" +
      '<span class="stage-target">目标境界 · ' + esc(lv.stageLabel) + "</span>" +
      "</div>" +
      '<h2 class="scene-title">' + esc(lv.title) + "</h2>" +
      '<div class="scene-tagline">' + esc(lv.tagline) + "</div>"
    );
  }

  function miniHead(li) {
    const lv = D.levels[li];
    return (
      '<div class="scene-head mini">' +
      '<span class="chapter-tag">' + esc(lv.chapter) + "</span>" +
      '<span class="mini-title">' + esc(lv.title) + "</span>" +
      '<span class="stage-target">' + esc(lv.stageLabel) + "</span>" +
      "</div>"
    );
  }

  // ---------- 封面 ----------
  function showCover() {
    stopTypewriter();
    cur.coverShown = true;
    cur.finaleShown = false;
    renderRoadmap();
    applyScene(0);
    stageBox.innerHTML =
      '<div class="card cover-card wipe-card">' +
      '<div class="scroll-rod scroll-rod-top" aria-hidden="true"></div>' +
      '<div class="scroll-rod scroll-rod-bottom" aria-hidden="true"></div>' +
      '<div class="cover-eyebrow">' + esc(D.meta.world) + " · Python 仙典</div>" +
      '<div class="cover-title">' + esc(D.meta.title) + "</div>" +
      '<div class="cover-quote">「早岁已知世事艰，仍许飞鸿荡云间。」</div>' +
      '<div class="cover-sub">' + esc(D.meta.volume) + "</div>" +
      '<div class="cover-desc">' + esc(D.meta.volumeDesc) + "</div>" +
      '<div class="center"><button class="btn primary cover-start" onclick="App.start()" type="button">开始修行</button></div>' +
      "</div>";
  }

  // ---------- 剧情 ----------
  function goStory(i) {
    cur.li = i;
    cur.coverShown = false;
    cur.finaleShown = false;
    cur.phase = "story";
    cur.si = 0;
    cur.qi = 0;
    cur.questPos = 0;
    cur.questDone = false;
    cur.wrong = {};
    cur.qDone = false;
    cur.seenQuiz = false;
    cur.seenQuest = false;
    cur.tries = 0;
    cur.answer = "";
    cur.fill = [];
    cur.fillSig = "";
    cur.fillWrong = false;
    cur.redoLevelId = "";
    cur.redoPool = "";
    cur.redoQi = -1;
    cur.redoQ = null;
    cur.redoWrong = [];
    cur.savedCur = null;
    document.documentElement.removeAttribute("data-tries");
    bossTriesPainted = 0;
    cur.wipeNext = true;
    paintStory();
  }

  function paintStory() {
    const lv = D.levels[cur.li];
    const lines = lv.story;
    let body = (cur.si === 0 ? topMeta(cur.li) : miniHead(cur.li)) + '<div class="dialog-list">';

    if (cur.si < lines.length) {
      body += dialogHTML(lines, cur.si, false);
      body += "</div>";
      body += navHTML({
        skip: true,
        nextLabel: cur.si === lines.length - 1 ? "继续 ▸" : "继续 ▸"
      });
    } else {
      const label = lv.kind === "boss" ? "开始渡劫" : "开始听讲";
      body +=
        '<div class="dialog-end">夜色未尽，天光将亮——你已想清楚下一步。</div></div>';
      body += '<div class="btn-row"><button class="btn primary" onclick="App.enterLevel()" type="button">' + label + "</button></div>";
    }

    stageBox.innerHTML = '<div class="card">' + body + "</div>";
    finishStage();
    startTypewriter(stageBox);
  }

  function storyNext() {
    const total = D.levels[cur.li].story.length;
    if (cur.si < total) {
      cur.si += 1;
    }
    paintStory();
  }

  function enterLevel() {
    cur.wipeNext = true;
    if (D.levels[cur.li].kind === "boss") {
      cur.phase = "boss";
      paintBoss();
    } else {
      cur.phase = "lesson";
      paintLesson();
    }
  }

  // ---------- 讲解 ----------
  function paintLesson() {
    const lv = D.levels[cur.li];
    const les = lv.lesson;
    const pts = les.points
      .map(function (p) {
        return "<li>" + esc(p) + "</li>";
      })
      .join("");

    const hasQuest = !!(lv.quest && lv.quest.length);
    const hasQuizExtra = !!(lv.quizExtra && lv.quizExtra.length);
    const hasLegacyQuiz = !hasQuest && !!(lv.questions && lv.questions.length);
    const canQuiz = hasQuizExtra || hasLegacyQuiz;
    let continueLabel = "";
    let enterAction = "";
    if (hasQuest && !cur.questDone) {
      continueLabel = cur.seenQuest ? "继续历练" : "进入历练";
      enterAction = "App.enterQuest()";
    } else if (canQuiz) {
      continueLabel = cur.seenQuiz ? "继续试炼" : "开始试炼";
      enterAction = "App.startQuiz()";
    } else {
      continueLabel = "突破境界";
      enterAction = "App.passLevel()";
    }

    const hintLine =
      hasQuest && cur.questDone && canQuiz
        ? '<p class="lesson-note">历练已成。仙典邀你入静室试炼，把方才所学再夯实一遍，便可引动破境。</p>'
        : "";

    stageBox.innerHTML =
      '<div class="card">' +
      miniHead(cur.li) +
      '<h3 class="lesson-name">' + esc(les.name) + "</h3>" +
      '<p class="lesson-intro">' + esc(les.intro) + "</p>" +
      '<ol class="lesson-points">' + pts + "</ol>" +
      '<div class="code-wrap">' +
      '<div class="code-head"><span>示例法诀 · 可在 PyCharm 里亲手跑一遍</span>' +
      '<button class="btn ghost small" onclick="App.copyExample()" type="button">复制代码</button></div>' +
      '<pre class="code-block">' + esc(les.example.code) + "</pre>" +
      (les.example.note ? '<p class="code-note">' + esc(les.example.note) + "</p>" : "") +
      "</div>" +
      '<div class="out-wrap">' +
      '<div class="out-label">运行结果</div>' +
      '<pre class="out-block">' + esc(les.example.output) + "</pre>" +
      "</div>" +
      hintLine +
      '<div class="btn-row">' +
      '<button class="btn ghost small" onclick="App.backStory()" type="button">回看剧情</button>' +
      '<button class="btn primary" onclick="' + enterAction + '" type="button">' + continueLabel + "</button>" +
      "</div>" +
      "</div>";
    finishStage();
  }

  // ---------- 历练（剧情与题目交错） ----------
  function enterQuest() {
    if (!cur.seenQuest) {
      cur.seenQuest = true;
      cur.questPos = 0;
      cur.qi = 0;
      cur.wrong = {};
      cur.qDone = false;
      cur.questDone = false;
      cur.fill = [];
      cur.fillSig = "";
    }
    cur.phase = "quest";
    paintQuest();
  }

  function questItems() {
    return (D.levels[cur.li].quest || []).filter(function (it) {
      return typeof it === "object" && it !== null;
    });
  }

  function questQuestionCount() {
    return questItems().filter(function (it) {
      return it.q !== undefined;
    }).length;
  }

  function quizIntroEnabled(lv) {
    return !!(lv && lv.quizExtra && lv.quizExtra.length);
  }

  function questFinished() {
    cur.questDone = true;
    cur.qDone = false;
    const lv = D.levels[cur.li];
    if (quizIntroEnabled(lv)) {
      cur.phase = "quizintro";
      cur.wipeNext = true;
      paintQuestIntro();
    } else {
      finishLevel();
    }
  }

  function paintQuestIntro() {
    const lv = D.levels[cur.li];
    stageBox.innerHTML =
      '<div class="card">' +
      miniHead(cur.li) +
      '<div class="quiz-head">试炼 · 巩固</div>' +
      '<h3 class="lesson-name">静室试炼</h3>' +
      '<p class="lesson-intro">你已把这一关的历练走完。仙典说：法诀要过三遍才算自己的——现在把刚学的道理，换成没见过的问法，再走一遍。</p>' +
      '<div class="btn-row">' +
      '<button class="btn ghost small" onclick="App.backLesson()" type="button">回看讲解</button>' +
      '<button class="btn primary" onclick="App.startQuiz()" type="button">开始试炼</button>' +
      "</div>" +
      "</div>";
    finishStage();
  }

  function paintQuest() {
    const lv = D.levels[cur.li];
    const items = questItems();
    const item = items[cur.questPos];
    if (!item) {
      questFinished();
      return;
    }
    if (item.q !== undefined) {
      // 题目在历练中的序号（用于答错记录）
      let qi = 0;
      for (let k = 0; k < cur.questPos; k++) {
        if (items[k] && items[k].q !== undefined) qi++;
      }
      cur.qi = qi;
      paintQuestQuestion(lv.questions[item.q], qi);
      return;
    }

    const hasMore = cur.questPos + 1 < items.length;
    const lastLabel = !hasMore && quizIntroEnabled(lv) ? "继续 ▸" : "突破境界";
    stageBox.innerHTML =
      '<div class="card">' +
      miniHead(cur.li) +
      '<div class="dialog-list">' +
      dialogHTML(items, cur.questPos, false) +
      "</div>" +
      '<div class="btn-row">' +
      '<button class="btn ghost small" data-skip="1" onclick="App.questSkip()" type="button">跳过剧情</button>' +
      '<button class="btn primary" onclick="App.questContinue()" type="button">' +
      (hasMore ? "继续 ▸" : lastLabel) +
      "</button>" +
      "</div>" +
      "</div>";
    finishStage();
    startTypewriter(stageBox);
  }

  // ---------- 题目通用渲染（历练 / 试炼 / 错题重做共用） ----------
  function currentQ() {
    const lv = D.levels[cur.li];
    if (cur.phase === "quest") {
      const items = questItems();
      const it = items[cur.questPos];
      return it && it.q !== undefined ? (lv.questions || [])[it.q] : null;
    }
    if (cur.phase === "quiz") return quizPoolFor(lv)[cur.qi];
    if (cur.phase === "redo") return cur.redoQ;
    return null;
  }

  function currentQi() {
    if (cur.phase === "quest") {
      let n = 0;
      const items = questItems();
      for (let k = 0; k < cur.questPos; k++) {
        if (items[k] && items[k].q !== undefined) n++;
      }
      return n;
    }
    if (cur.phase === "redo") return cur.redoQi;
    return cur.qi;
  }

  function currentWrongSet() {
    if (cur.phase === "redo") return cur.redoWrong;
    const qi = currentQi();
    return cur.wrong[qi] || (cur.wrong[qi] = []);
  }

  function qFlowInfo() {
    const lv = D.levels[cur.li];
    if (cur.phase === "quest") {
      const totalQ = questQuestionCount();
      const qi = currentQi();
      const items = questItems();
      const isLastQ = qi === totalQ - 1;
      const hasMoreItems = cur.questPos + 1 < items.length;
      const willIntro = isLastQ && !hasMoreItems && quizIntroEnabled(lv);
      return {
        head: "灵纹浮现 · 第 " + (qi + 1) + " / " + totalQ + " 问",
        backLabel: "回看讲解",
        backAction: "App.backLesson()",
        doneLabel: hasMoreItems || willIntro ? "继续 ▸" : "突破境界",
        doneAction: "App.questContinue()"
      };
    }
    if (cur.phase === "quiz") {
      const qs = quizPoolFor(lv);
      return {
        head: "试炼 · 第 " + (cur.qi + 1) + " / " + qs.length + " 题",
        backLabel: "回看讲解",
        backAction: "App.backLesson()",
        doneLabel: cur.qi >= qs.length - 1 ? "突破境界" : "下一题",
        doneAction: "App.nextQuestion()"
      };
    }
    if (cur.phase === "redo") {
      return {
        head: "错题重做",
        backLabel: "返回笔记本",
        backAction: "App.redoBack()",
        doneLabel: "返回笔记本",
        doneAction: "App.redoNext()"
      };
    }
    return { head: "", backLabel: "", backAction: "", doneLabel: "", doneAction: "" };
  }

  function questionFB(q) {
    const wrongSet = currentWrongSet();
    if (cur.qDone) {
      return (
        '<div class="fb fb-ok">' +
        '<div class="fb-title">' + esc(q.cheer || "答对了") + "</div>" +
        '<div class="fb-body">' + esc(q.explain || "") + "</div>" +
        "</div>"
      );
    }
    if (wrongSet.length || cur.fillWrong) {
      return (
        '<div class="fb fb-bad">' +
        '<div class="fb-title">此路不通</div>' +
        '<div class="fb-body">' + esc(q.hint || "再想想。") + "</div>" +
        "</div>"
      );
    }
    return "";
  }

  function paintCurrentQuestion() {
    const q = currentQ();
    if (!q) {
      finishLevel();
      return;
    }
    if (q.kind === "fill") {
      const sig = D.levels[cur.li].id + "|" + cur.phase + "|" + currentQi() + "|" + q.q;
      if (sig !== cur.fillSig) {
        cur.fillSig = sig;
        cur.fill = [];
        cur.fillWrong = false;
      }
      paintFillQuestion(q);
      return;
    }
    paintChoiceQuestion(q);
  }

  function paintQuestQuestion(q, qi) {
    cur.qi = qi;
    cur.fillWrong = false;
    paintCurrentQuestion();
  }

  function paintChoiceQuestion(q) {
    cur.fillWrong = false;
    const wrongSet = currentWrongSet();
    const info = qFlowInfo();
    let optHtml = "";
    (q.options || []).forEach(function (opt, oi) {
      let cls = "opt";
      let onClick = "";
      const wrongHit = wrongSet.indexOf(oi) !== -1;
      if (cur.qDone && oi === q.answer) {
        cls += " correct";
      } else if (wrongHit) {
        cls += " wrong disabled";
      } else if (cur.qDone) {
        cls += " disabled";
      } else if (cur.phase === "redo") {
        onClick = ' onclick="App.redoAnswer(' + oi + ')"';
      } else if (cur.phase === "quest") {
        onClick = ' onclick="App.questPick(' + currentQi() + "," + oi + ')"';
      } else {
        onClick = ' onclick="App.pick(' + cur.qi + "," + oi + ')"';
      }
      optHtml +=
        '<button class="' + cls + '" data-key="' + (oi + 1) + '" type="button"' + onClick + ">" +
        '<span class="opt-label">' + LABEL[oi] + "</span>" +
        '<span class="opt-text">' + esc(opt) + "</span>" +
        "</button>";
    });

    stageBox.innerHTML =
      '<div class="card">' +
      miniHead(cur.li) +
      '<div class="quiz-head">' + esc(info.head) + "</div>" +
      '<div class="q-text">' + esc(q.q) + "</div>" +
      (q.code ? '<pre class="code-block q-code">' + esc(q.code) + "</pre>" : "") +
      '<div class="opt-list">' + optHtml + "</div>" +
      questionFB(q) +
      '<div class="btn-row">' +
      '<button class="btn ghost small" onclick="' + info.backAction + '" type="button">' +
      esc(info.backLabel) +
      "</button>" +
      (cur.qDone
        ? '<button class="btn primary" onclick="' + info.doneAction + '" type="button">' +
          esc(info.doneLabel) +
          "</button>"
        : "") +
      "</div>" +
      "</div>";
    finishStage();
  }

  // ---------- C 型：代码补全（fill） ----------
  function fillCodeView(q) {
    const code = String(q.code || "");
    return code
      .split("\n")
      .map(function (line) {
        return line
          .split(/(__\d+__)/g)
          .map(function (part) {
            const m = /^__(\d+)__$/.exec(part);
            if (!m) return esc(part);
            const s = Number(m[1]) - 1;
            const ci = cur.fill[s];
            const label =
              ci != null && q.slots[s] && q.slots[s][ci] != null
                ? q.slots[s][ci]
                : "__" + (s + 1) + "__";
            return (
              '<button type="button" class="slot-chip' +
              (ci != null ? " filled" : "") +
              '" data-slot="' +
              s +
              '"' +
              (cur.qDone ? " disabled" : "") +
              ' onclick="App.fillUndo(' +
              s +
              ')" title="点一下撤销这一处">' +
              esc(label) +
              "</button>"
            );
          })
          .join("");
      })
      .join("\n");
  }

  function fillCandidatesHTML(q) {
    return (q.slots || [])
      .map(function (cands, s) {
        const used = cur.fill[s];
        return (
          '<div class="fill-slot-group">' +
          '<div class="fill-slot-label">第 ' + (s + 1) + " 处空缺 · 点选一个片段</div>" +
          '<div class="fill-cands">' +
          cands
            .map(function (c, ci) {
              const chosen = used === ci;
              const disabled = cur.qDone || (used != null && !chosen);
              return (
                '<button type="button" class="fill-cand' +
                (chosen ? " chosen" : "") +
                '" data-slot="' +
                s +
                '" data-idx="' +
                ci +
                '"' +
                (disabled ? " disabled" : "") +
                ' onclick="App.fillSlot(' +
                s +
                "," +
                ci +
                ')">' +
                esc(c) +
                "</button>"
              );
            })
            .join("") +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function paintFillQuestion(q) {
    const info = qFlowInfo();
    const filledAll = (q.answer || []).every(function (a, i) {
      return cur.fill[i] != null;
    });
    stageBox.innerHTML =
      '<div class="card">' +
      miniHead(cur.li) +
      '<div class="quiz-head">' + esc(info.head) + " · 补全法诀</div>" +
      '<div class="q-text">' + esc(q.q) + "</div>" +
      '<div id="fillZone" class="fill-zone">' +
      '<pre class="code-block fill-code">' + fillCodeView(q) + "</pre>" +
      '<div class="fill-cands-wrap">' + fillCandidatesHTML(q) + "</div>" +
      "</div>" +
      questionFB(q) +
      '<div class="btn-row">' +
      '<button class="btn ghost small" onclick="' + info.backAction + '" type="button">' +
      esc(info.backLabel) +
      "</button>" +
      (cur.qDone
        ? '<button class="btn primary" onclick="' + info.doneAction + '" type="button">' +
          esc(info.doneLabel) +
          "</button>"
        : '<button class="btn primary" id="fillCheck" onclick="App.checkFill()" type="button"' +
          (filledAll ? "" : " disabled") +
          ">校验</button>") +
      "</div>" +
      "</div>";
    finishStage();
  }

  function syncFillUI(q) {
    const zone = document.getElementById("fillZone");
    if (!zone || !q || q.kind !== "fill") return;
    const chips = zone.querySelectorAll(".slot-chip");
    chips.forEach(function (el) {
      const s = Number(el.getAttribute("data-slot"));
      const ci = cur.fill[s];
      const label =
        ci != null && q.slots[s] && q.slots[s][ci] != null ? q.slots[s][ci] : "__" + (s + 1) + "__";
      el.textContent = label;
      el.classList.toggle("filled", ci != null);
      el.disabled = !!cur.qDone;
    });
    zone.querySelectorAll(".fill-cand").forEach(function (el) {
      const s = Number(el.getAttribute("data-slot"));
      const idx = Number(el.getAttribute("data-idx"));
      const ci = cur.fill[s];
      const chosen = ci === idx;
      el.disabled = !!cur.qDone || (ci != null && !chosen);
      el.classList.toggle("chosen", chosen);
    });
    const okBtn = document.getElementById("fillCheck");
    if (okBtn) {
      okBtn.disabled =
        !!cur.qDone ||
        (q.answer || []).some(function (a, i) {
          return cur.fill[i] == null;
        });
    }
  }

  function fillSlot(s, idx) {
    const q = currentQ();
    if (!q || q.kind !== "fill" || cur.qDone) return;
    if (!q.slots[s] || q.slots[s][idx] == null) return;
    cur.fill[s] = idx;
    syncFillUI(q);
  }

  function fillUndo(s) {
    const q = currentQ();
    if (!q || q.kind !== "fill" || cur.qDone) return;
    if (cur.fill[s] == null) return;
    cur.fill[s] = null;
    syncFillUI(q);
  }

  function checkFill() {
    const q = currentQ();
    if (!q || q.kind !== "fill" || cur.qDone) return;
    const ok = (q.answer || []).every(function (a, i) {
      return cur.fill[i] === a;
    });
    if (ok) {
      cur.qDone = true;
      cur.fillWrong = false;
      forgetMistake(q);
      sfx("right");
    } else {
      cur.fillWrong = true;
      recordMistake(q, fillCodeOf(q, cur.fill));
      sfx("wrong");
    }
    paintCurrentQuestion();
  }

  function answerChoice(q, oi) {
    const wrongSet = currentWrongSet();
    if (cur.qDone || wrongSet.indexOf(oi) !== -1) return;
    if (oi === q.answer) {
      cur.qDone = true;
      cur.fillWrong = false;
      forgetMistake(q);
      sfx("right");
    } else {
      wrongSet.push(oi);
      recordMistake(q, String((q.options || [])[oi] || ""));
      sfx("wrong");
    }
    paintCurrentQuestion();
  }

  // ---------- 历练答题 ----------
  function questPick(qi, oi) {
    if (cur.phase !== "quest" || cur.qDone || qi !== cur.qi) return;
    const q = currentQ();
    if (!q || q.kind === "fill") return;
    answerChoice(q, oi);
  }

  function questContinue() {
    const items = questItems();
    cur.qDone = false;
    cur.questPos += 1;
    if (cur.questPos >= items.length) {
      questFinished();
      return;
    }
    if (items[cur.questPos].q !== undefined) cur.wipeNext = true;
    paintQuest();
  }

  function questSkip() {
    const items = questItems();
    while (cur.questPos < items.length && items[cur.questPos].q === undefined) {
      cur.questPos += 1;
    }
    cur.qDone = false;
    if (cur.questPos >= items.length) {
      questFinished();
      return;
    }
    if (items[cur.questPos].q !== undefined) cur.wipeNext = true;
    paintQuest();
  }

  // ---------- 试炼（巩固题库 quizExtra；无则回退旧逻辑） ----------
  function startQuiz() {
    if (!cur.seenQuiz) {
      cur.seenQuiz = true;
      cur.qi = 0;
      cur.wrong = {};
      cur.qDone = false;
      cur.fill = [];
      cur.fillSig = "";
      cur.fillWrong = false;
    }
    cur.phase = "quiz";
    cur.wipeNext = true;
    const q = currentQ();
    if (!q) {
      finishLevel();
      return;
    }
    paintCurrentQuestion();
  }

  function paintQuiz() {
    cur.phase = "quiz";
    const q = currentQ();
    if (!q) {
      finishLevel();
      return;
    }
    paintCurrentQuestion();
  }

  function pick(qi, oi) {
    if (cur.phase !== "quiz" || cur.qDone || qi !== cur.qi) return;
    const q = currentQ();
    if (!q || q.kind === "fill") return;
    answerChoice(q, oi);
  }

  function nextQuestion() {
    const qs = quizPoolFor(D.levels[cur.li]);
    cur.qDone = false;
    cur.qi += 1;
    if (cur.qi >= qs.length) {
      finishLevel();
      return;
    }
    cur.wipeNext = true;
    paintQuiz();
  }

  function backLesson() {
    cur.phase = "lesson";
    cur.wipeNext = true;
    paintLesson();
  }

  function backStory() {
    cur.phase = "story";
    cur.si = D.levels[cur.li].story.length;
    paintStory();
  }

  // ---------- 错题本：小师妹的笔记本 ----------
  function fmtTs(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const p = function (n) {
      return n < 10 ? "0" + n : String(n);
    };
    return (
      d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes())
    );
  }

  function shortAnswer(v) {
    return String(v || "").split("\n").join(" ⏎ ");
  }

  function snapshotCur() {
    cur.savedCur = JSON.stringify(cur);
  }

  function restoreCur() {
    if (!cur.savedCur) return;
    const saved = JSON.parse(cur.savedCur);
    cur.savedCur = null;
    Object.assign(cur, saved);
  }

  function repaintSavedView() {
    if (cur.finaleShown) {
      finale();
      return;
    }
    if (cur.coverShown) {
      showCover();
      return;
    }
    const ph = cur.phase;
    if (ph === "lesson") paintLesson();
    else if (ph === "quest") paintQuest();
    else if (ph === "quizintro") paintQuestIntro();
    else if (ph === "quiz") paintQuiz();
    else if (ph === "boss") paintBoss();
    else if (ph === "outro") paintOutro();
    else if (ph === "clear") paintClear();
    else if (ph === "mistakes") paintMistakes();
    else if (ph === "redo") paintCurrentQuestion();
    else paintStory();
  }

  function openMistakes() {
    snapshotCur();
    closeSideDrawer();
    paintMistakes();
  }

  function closeMistakes() {
    restoreCur();
    repaintSavedView();
  }

  function paintMistakes() {
    cur.phase = "mistakes";
    const ms = state.mistakes || [];
    let listHtml = "";
    if (!ms.length) {
      listHtml =
        '<div class="mistakes-empty">' +
        '<div class="mistakes-empty-seal">净</div>' +
        "<p>笔记本一页未染。凡答错的题，都会自动记到这里，等你回头再战。</p>" +
        "</div>";
    } else {
      const items = [];
      D.levels.forEach(function (lv) {
        const sub = ms.filter(function (m) {
          return m.levelId === lv.id;
        });
        if (!sub.length) return;
        const rows = sub
          .map(function (rec, j) {
            const idx = state.mistakes.indexOf(rec);
            return (
              '<div class="mistake-item">' +
              '<div class="mistake-q">' + esc(rec.qText) + "</div>" +
              '<div class="mistake-meta">' +
              '<span class="mistake-type">' + (rec.qType === "fill" ? "补全题" : "选择题") + "</span>" +
              '<span class="mistake-time">' + esc(fmtTs(rec.ts)) + "</span>" +
              "</div>" +
              '<div class="mistake-answers">' +
              '<span class="mi-user">你答：' + esc(shortAnswer(rec.userAnswer)) + "</span>" +
              '<span class="mi-right">应为：' + esc(shortAnswer(rec.correctAnswer)) + "</span>" +
              "</div>" +
              '<div class="mistake-act">' +
              '<button class="btn primary small" onclick="App.redoMistake(' + idx + ')" type="button">重做</button>' +
              "</div>" +
              "</div>"
            );
          })
          .join("");
        items.push(
          '<div class="mistake-chapter">' +
          '<div class="mistake-chapter-name">' + esc(lv.chapter + " · " + lv.title) + "</div>" +
          rows +
          "</div>"
        );
      });
      listHtml = items.join("");
    }

    stageBox.innerHTML =
      '<div class="card mistakes-card">' +
      '<div class="mistakes-head">' +
      '<div class="mistakes-eyebrow">小师妹的笔记本</div>' +
      '<div class="mistakes-sub">答错的题会自动记进来 · 重做答对即化去</div>' +
      "</div>" +
      '<div class="mistakes-list">' + listHtml + "</div>" +
      '<div class="btn-row">' +
      '<button class="btn primary" onclick="App.closeMistakes()" type="button">合上笔记本</button>' +
      "</div>" +
      "</div>";
    refreshMistakeBadge();
    const curScene = Number(document.documentElement.getAttribute("data-scene") || 0);
    finishStage(curScene);
  }

  function redoMistake(idx) {
    const rec = (state.mistakes || [])[idx];
    if (!rec) {
      paintMistakes();
      return;
    }
    const res = resolveMistakeQuestion(rec);
    if (!res) {
      // 题库已不存在的失效错题：自动清理
      state.mistakes.splice(idx, 1);
      saveState();
      refreshMistakeBadge();
      paintMistakes();
      return;
    }
    cur.li = res.li;
    cur.phase = "redo";
    cur.redoLevelId = rec.levelId;
    cur.redoPool = res.pool;
    cur.redoQi = res.qi;
    cur.redoQ = res.q;
    cur.qi = res.qi;
    cur.redoWrong = [];
    cur.qDone = false;
    cur.fillWrong = false;
    cur.fill = [];
    cur.fillSig = "";
    cur.wipeNext = true;
    paintCurrentQuestion();
  }

  function redoAnswer(oi) {
    if (cur.phase !== "redo" || cur.qDone) return;
    const q = currentQ();
    if (!q || q.kind === "fill") return;
    answerChoice(q, oi);
  }

  function redoBack() {
    paintMistakes();
  }

  function redoNext() {
    paintMistakes();
  }

  // ---------- 破境 & 结尾剧情 ----------
  function finishLevel() {
    const lv = D.levels[cur.li];
    if (!isDone(lv.id)) {
      state.done.push(lv.id);
    }
    if (lv.kind === "boss") {
      state.boss = true;
    }
    saveState();
    renderRoadmap();
    breakthrough();
  }

  function breakthrough() {
    sfx("breakthrough");
    stopTypewriter();
    const lv = D.levels[cur.li];
    const from = cur.li === 0 ? D.realms[0] : D.levels[cur.li - 1].stageLabel;
    const to = lv.stageLabel;
    const isBoss = lv.kind === "boss";
    const eyebrow = isBoss ? "九重天雷 · 筑基在望" : "灵气盈体 · 破境在即";
    const say = isBoss ? "天劫已渡，大道初开" : "灵气入体，境界再进一步";
    const sealChar = isBoss ? "渡" : "破";

    let dust = "";
    for (let i = 0; i < 16; i++) {
      const left = (i * 37 + 13) % 100;
      const top = 12 + ((i * 53) % 72);
      const delay = (0.12 + ((i * 29) % 55) / 100).toFixed(2);
      const dur = (1.5 + ((i * 17) % 45) / 100).toFixed(2);
      const size = i % 4 === 0 ? 3 : 2;
      dust +=
        '<i style="left:' + left + "%;top:" + top + "%;width:" + size +
        "px;height:" + size + "px;animation-delay:" + delay + "s;animation-duration:" + dur + 's"></i>';
    }

    // 金色灵力：从四野向中心汇聚
    let qi = "";
    for (let i = 0; i < 34; i++) {
      const left = 4 + ((i * 43) % 88);
      const top = 8 + ((i * 37) % 78);
      const size = i % 5 === 0 ? 4 : i % 2 === 0 ? 3 : 2;
      const delay = (0.05 + ((i * 23) % 90) / 100).toFixed(2);
      const dur = (1.15 + ((i * 13) % 30) / 100).toFixed(2);
      qi +=
        '<i style="left:' + left + "%;top:" + top + "%;width:" + size +
        "px;height:" + size + "px;--dx:calc(50vw - " + left + "vw);" +
        "--dy:calc(45vh - " + top + "vh);animation-delay:" + delay +
        "s;animation-duration:" + dur + 's"></i>';
    }

    fxBox.classList.remove("fx-hidden");
    fxBox.innerHTML =
      '<div class="break-veil">' +
      '<div class="break-halo"></div>' +
      '<div class="break-rune"></div>' +
      '<div class="break-ring"></div>' +
      '<div class="break-pillar"></div>' +
      '<span class="break-dust">' + dust + "</span>" +
      '<span class="break-qi">' + qi + "</span>" +
      '<div class="break-shock s1"></div>' +
      '<div class="break-shock s2"></div>' +
      '<div class="break-inner">' +
      '<div class="break-eyebrow">' + esc(eyebrow) + "</div>" +
      '<div class="break-old">' + esc(from) + "</div>" +
      '<div class="break-arrow">⟶</div>' +
      '<div class="break-new">' + esc(to) + "</div>" +
      '<div class="break-say">' + esc(say) + "</div>" +
      '<div class="break-seal">' + sealChar + "</div>" +
      "</div>" +
      '<div class="break-skip">轻触画面 · 跳过法相</div>' +
      "</div>";

    let ended = false;
    function endBreakFx() {
      if (ended) return;
      ended = true;
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeySkip);
      cur.phase = "clear";
      fxBox.classList.add("fx-hidden");
      cur.wipeNext = true;
      paintClear();
      sfx("seal");
    }
    function onKeySkip(ev) {
      if (ev.key === "Escape" || ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        endBreakFx();
      }
    }
    var timer = window.setTimeout(endBreakFx, reducedMotion ? 160 : 2300);
    if (breakEndHandler) fxBox.removeEventListener("click", breakEndHandler);
    fxBox.addEventListener("click", (breakEndHandler = endBreakFx));
    document.addEventListener("keydown", onKeySkip);
  }

  // ---------- 破境结算：直接开启下一章，或先看本章尾声 ----------
  function paintClear() {
    const lv = D.levels[cur.li];
    const isBoss = lv.kind === "boss";
    const primary = isBoss ? "翻开下一卷" : "开启下一章剧情";
    const desc = isBoss
      ? "九重天雷已散，云海尽头透出新的天光——下一卷的大门，等你亲手推开。"
      : "境界已成。山门外风声渐起，下一段故事，正等着你落笔。";
    stageBox.innerHTML =
      '<div class="card finale-card clear-card">' +
      '<div class="finale-seal">' + (isBoss ? "渡" : "破") + "</div>" +
      '<div class="clear-eyebrow">境界已成</div>' +
      '<h2 class="finale-title clear-realm">' + esc(lv.stageLabel) + "</h2>" +
      '<p class="finale-desc">' + desc + "</p>" +
      '<div class="btn-row center-row">' +
      '<button class="btn ghost" onclick="App.readOutro()" type="button">查看本章尾声</button>' +
      '<button class="btn primary" onclick="App.afterOutro()" type="button">' + primary + "</button>" +
      "</div>" +
      "</div>";
    finishStage();
  }

  function readOutro() {
    cur.phase = "outro";
    cur.si = 0;
    cur.wipeNext = true;
    paintOutro();
  }

  function paintOutro() {
    const lv = D.levels[cur.li];
    const lines = lv.outro;
    let body = miniHead(cur.li) + '<div class="dialog-list">';

    if (cur.si < lines.length) {
      body += dialogHTML(lines, cur.si, true);
      body += "</div>";
      body += navHTML({ skip: false, nextLabel: cur.si === lines.length - 1 ? "继续 ▸" : "继续 ▸" });
    } else {
      body += "</div>";
      const isBoss = lv.kind === "boss";
      const label = isBoss ? "翻开下一卷" : "继续修行";
      body +=
        '<div class="btn-row">' +
        '<button class="btn primary" onclick="App.afterOutro()" type="button">' + label + "</button>" +
        "</div>";
    }
    stageBox.innerHTML = '<div class="card">' + body + "</div>";
    finishStage();
    startTypewriter(stageBox);
  }

  function outroNext() {
    const total = D.levels[cur.li].outro.length;
    if (cur.si < total) {
      cur.si += 1;
      paintOutro();
    }
  }

  function afterOutro() {
    if (D.levels[cur.li].kind === "boss") {
      finale();
      return;
    }
    const next = cur.li + 1;
    if (next < D.levels.length) {
      goStory(next);
    } else {
      finale();
    }
  }

  // ---------- 渡劫（A 类：写代码） ----------
  // 整页雷闪 + data-tries 挂点（只挂视觉，不碰 submitBoss 判定）
  function pageLightning() {
    const hit = document.getElementById("flashHit");
    if (!hit || reducedMotion) return;
    hit.classList.remove("on");
    void hit.offsetWidth;
    hit.classList.add("on");
    window.setTimeout(function () {
      hit.classList.remove("on");
    }, 850);
  }

  function syncBossStorm() {
    const tries = Math.max(0, Math.min(cur.tries, 3));
    document.documentElement.setAttribute("data-tries", String(tries));
    if (cur.tries > 0 && cur.tries > bossTriesPainted) {
      bossTriesPainted = cur.tries;
      pageLightning();
    }
    if (cur.tries === 0) bossTriesPainted = 0;
  }

  function paintBoss() {
    syncBossStorm();
    const lv = D.levels[cur.li];
    const t = lv.task;
    const steps = t.steps
      .map(function (s, i) {
        return "<li>" + esc(s) + "</li>";
      })
      .join("");

    let hintHtml = "";
    if (cur.tries > 0) {
      hintHtml +=
        '<div class="fb fb-bad boss-fail">' +
        '<div class="fb-title">天雷纹丝不动（已试 ' + cur.tries + " 次）</div>" +
        '<div class="fb-body">' + esc(t.hint) + "</div>" +
        "</div>";
      hintHtml += bossDiffHTML();
    }
    if (cur.tries >= 3) {
      hintHtml +=
        '<div class="expected-box">' +
        '<div class="out-label">完整预期输出（答错 3 次后出示）</div>' +
        '<pre class="out-block">' + esc(t.expected) + "</pre>" +
        "</div>";
    }

    stageBox.innerHTML =
      '<div class="card">' +
      miniHead(cur.li) +
      '<h3 class="lesson-name">渡劫任务 · 修正抗雷法诀</h3>' +
      '<p class="lesson-intro">' + esc(t.lead) + "</p>" +
      '<ol class="boss-steps">' + steps + "</ol>" +
      '<div class="code-wrap">' +
      '<div class="code-head"><span>石碑上的残缺法诀</span>' +
      '<button class="btn ghost small" onclick="App.copyBossCode()" type="button">复制代码</button></div>' +
      '<pre class="code-block">' + esc(t.code) + "</pre>" +
      "</div>" +
      '<div class="boss-answer">' +
      '<label class="field-label" for="bossAns">把运行输出原样粘贴到这里</label>' +
      '<textarea id="bossAns" rows="5" placeholder="第1道天雷，渡！&#10;第2道天雷，渡！&#10;第3道天雷，渡！"></textarea>' +
      "</div>" +
      hintHtml +
      '<div class="btn-row">' +
      '<button class="btn ghost small" onclick="App.backStory()" type="button">回看剧情</button>' +
      '<button class="btn primary" onclick="App.submitBoss()" type="button">渡劫</button>' +
      "</div>" +
      "</div>";

    if (cur.answer) {
      const ta = document.getElementById("bossAns");
      if (ta) ta.value = cur.answer;
    }
    finishStage();
  }

  function norm(s) {
    return String(s || "")
      .replace(/\r/g, "")
      .split("\n")
      .map(function (line) {
        return line.trim();
      })
      .join("\n")
      .trim();
  }

  function normLines(s) {
    const t = norm(s);
    return t === "" ? [] : t.split("\n");
  }

  // 渡劫差异反馈：你的输出 vs 预期输出，逐行对比
  // 判定仍走 norm()（trim 语义不变）；3 次答错前不揭晓完整预期行内容
  function bossDiffHTML() {
    const t = D.levels[cur.li].task;
    const reveal = cur.tries >= 3;
    const u = normLines(cur.answer);
    const e = normLines(t.expected);
    const rows = Math.max(u.length, e.length);
    const rawLs = String(cur.answer || "").replace(/\r/g, "").split("\n");
    const rawTrimmed = rawLs.map(function (ln) {
      return ln.trim();
    });
    let start = 0;
    let end = rawTrimmed.length - 1;
    while (start <= end && rawTrimmed[start] === "") start++;
    while (end >= start && rawTrimmed[end] === "") end--;
    const rawLines = rawTrimmed.slice(start, end + 1);
    const notes = [];
    let grid = "";

    for (let i = 0; i < rows; i++) {
      const rowNo = i + 1;
      const du = i < u.length ? u[i] : null;
      const de = i < e.length ? e[i] : null;
      const same = du === de;
      const rawLine = i < rawLines.length ? rawLines[i] : "";
      let userCell;
      if (du === null) userCell = '<span class="diff-miss">（无此行）</span>';
      else if (du === "") userCell = '<span class="diff-empty">（空行）</span>';
      else userCell = esc(du);
      let expCell;
      if (de === null) expCell = '<span class="diff-miss">（无此行）</span>';
      else if (de === "") expCell = '<span class="diff-empty">（空行）</span>';
      else if (reveal) expCell = esc(de);
      else expCell = same ? '<span class="diff-ok">✓</span>' : '<span class="diff-secret">…</span>';

      if (!same) {
        let noteForRow;
        if (du === null) noteForRow = "第 " + rowNo + " 行：你的输出少了这一行";
        else if (de === null) noteForRow = "第 " + rowNo + " 行：多出一行";
        else if (du === "") noteForRow = "第 " + rowNo + " 行：你的输出是空行";
        else {
          const clean = du.replace(/\u3000/g, " ");
          if (clean === de && clean !== du) {
            noteForRow = "第 " + rowNo + " 行疑似含全角空格（去掉后与预期一致）";
          } else {
            noteForRow =
              "第 " + rowNo + " 行与预期不一致" + (/\u3000/.test(du) ? "（该行还含全角空格）" : "");
          }
        }
        notes.push(noteForRow);
      } else if (du !== null && /\u3000/.test(rawLine) && rawLine.trim() === du) {
        // 行内容一致但原始输入里混有全角空格（位于行边缘时 trim 会忽略）
        notes.push("第 " + rowNo + " 行含全角空格（位于行首/行尾，已按宽容规则忽略）");
      }

      grid +=
        '<div class="diff-row' + (same ? "" : " is-diff") + '">' +
        '<span class="diff-no">' + rowNo + "</span>" +
        '<code class="diff-cell diff-user">' + userCell + "</code>" +
        '<code class="diff-cell diff-exp">' + expCell + "</code>" +
        "</div>";
    }

    if (u.length !== e.length) {
      notes.push("你的输出共 " + u.length + " 行，预期 " + e.length + " 行。");
    }
    if (rawLs.length && rawLines.length < rawLs.length) {
      notes.push(
        "输出首或尾存在多余空行——Python 运行不会打印空行；判定会按宽容规则忽略首尾空行。"
      );
    }
    const noteHtml = notes.length
      ? '<ul class="boss-diff-notes">' +
        notes
          .map(function (n) {
            return "<li>" + esc(n) + "</li>";
          })
          .join("") +
        "</ul>"
      : "";
    return (
      '<div class="boss-diff">' +
      '<div class="boss-diff-title">你的输出 vs 预期输出 · 逐行对比</div>' +
      '<div class="diff-grid">' + grid + "</div>" +
      noteHtml +
      (!reveal
        ? '<p class="boss-diff-tip">完整预期输出将在答错 3 次后出示——先对着行号差异改法诀。</p>'
        : "") +
      "</div>"
    );
  }

  function submitBoss() {
    const ta = document.getElementById("bossAns");
    if (!ta) return;
    cur.answer = ta.value;
    const t = D.levels[cur.li].task;
    if (norm(cur.answer) === norm(t.expected)) {
      finishLevel();
    } else {
      cur.tries += 1;
      sfx("thunder");
      paintBoss();
    }
  }

  // ---------- 第一卷完结 ----------
  function finale() {
    cur.wipeNext = true;
    cur.finaleShown = true;
    cur.coverShown = false;
    stageBox.innerHTML =
      '<div class="card finale-card">' +
      '<div class="finale-seal">完</div>' +
      '<h2 class="finale-title">第一卷 · 完</h2>' +
      '<p class="finale-sub">仓绝大陆 · 修仙学 Python 入门篇</p>' +
      '<p class="finale-desc">' +
      "你已陪林慕从人人嘲笑的抄纹少年，走到亲手写下渡劫法诀、筑基功成。<br>" +
      "下一卷预告：筑基之后，是字符串与列表的秘境——小师妹的笔记本里，藏着下一个副本。<br>" +
      "（等你学到列表与字符串时，我们再开新卷。）" +
      "</p>" +
      '<div class="btn-row center-row">' +
      '<button class="btn ghost" onclick="App.cover()" type="button">回到封面</button>' +
      '<button class="btn primary" onclick="App.reset()" type="button">重置进度，重头再修</button>' +
      "</div>" +
      "</div>";
    finishStage(7);
  }

  // ---------- 复制代码 ----------
  function copyText(text, btn) {
    function done() {
      if (!btn) return;
      const old = btn.textContent;
      btn.textContent = "已复制";
      window.setTimeout(function () {
        btn.textContent = old;
      }, 1200);
    }
    function fallback() {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        done();
      } catch (e) {
        // 复制失败：手动选择
      }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function copyExample(btn) {
    const lv = D.levels[cur.li];
    copyText(lv.lesson.example.code, btn);
  }

  function copyBossCode(btn) {
    const lv = D.levels[cur.li];
    copyText(lv.task.code, btn);
  }

  // ---------- 重置 ----------
  function resetProgress() {
    if (
      (state.done.length || state.mistakes.length) &&
      !window.confirm("确定清空全部进度与错题本、重头再修吗？")
    ) {
      return;
    }
    state = freshState();
    saveState();
    try {
      // 重置时把 v1 回滚基线一并清空，避免旧档被再次迁移回来
      localStorage.setItem(LS_KEY_V1, JSON.stringify({ done: [], boss: false }));
    } catch (e) {
      // 忽略
    }
    cur = {
      li: 0,
      phase: "story",
      si: 0,
      qi: 0,
      questPos: 0,
      questDone: false,
      wrong: {},
      qDone: false,
      seenQuiz: false,
      seenQuest: false,
      coverShown: false,
      finaleShown: false,
      fillWrong: false,
      tries: 0,
      answer: "",
      fill: [],
      fillSig: "",
      redoLevelId: "",
      redoPool: "",
      redoQi: -1,
      redoQ: null,
      redoWrong: [],
      savedCur: null
    };
    showCover();
    refreshMistakeBadge();
  }

  // ---------- 对外接口 ----------
  // ---------- 键盘操作（排除输入框误触；破境特效期间让位给特效） ----------
  function onGlobalKey(ev) {
    if (!fxBox.classList.contains("fx-hidden")) return;
    const t = ev.target;
    if (
      t &&
      (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)
    ) {
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const code = ev.code || "";
    const card = stageBox.querySelector(".card");
    if (!card) return;

    if (code === "Enter") {
      const primary = card.querySelector(".btn.primary:not([disabled])");
      if (primary) {
        ev.preventDefault();
        primary.click();
      }
      return;
    }
    if (code === "KeyS") {
      const skipBtn = card.querySelector("button[data-skip]");
      if (skipBtn) {
        ev.preventDefault();
        skipBtn.click();
      }
      return;
    }

    // 选择题 1/A、2/B、3/C、4/D 直接作答
    const q = currentQ();
    if (!q || q.kind === "fill" || cur.qDone) return;
    if (cur.phase !== "quest" && cur.phase !== "quiz" && cur.phase !== "redo") return;
    let key = "";
    if (/^Digit([1-4])$/.test(code) || /^Numpad([1-4])$/.test(code)) {
      key = code.slice(-1);
    } else if (/^Key[A-D]$/.test(code)) {
      key = String(code.charCodeAt(code.length - 1) - 64);
    }
    if (!key) return;
    const opt = card.querySelector('.opt[data-key="' + key + '"]:not(.disabled)');
    if (opt) {
      ev.preventDefault();
      opt.click();
    }
  }

  // ---------- 移动端侧栏抽屉 ----------
  function setSideDrawer(open) {
    const btn = document.getElementById("sideToggle");
    const mask = document.getElementById("sideMask");
    document.body.classList.toggle("is-side-open", open);
    if (btn) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-label", open ? "收起章节菜单" : "打开章节菜单");
    }
    if (mask) {
      mask.setAttribute("aria-hidden", open ? "false" : "true");
    }
  }

  function closeSideDrawer() {
    if (document.body.classList.contains("is-side-open")) setSideDrawer(false);
  }

  window.App = {
    start: function () {
      const i = firstUndone();
      if (i === -1) {
        finale();
      } else {
        goStory(i);
      }
    },
    cover: showCover,
    readOutro: readOutro,
    skip: function () {
      if (cur.phase === "outro") {
        cur.si = D.levels[cur.li].outro.length;
        paintOutro();
      } else {
        cur.si = D.levels[cur.li].story.length;
        paintStory();
      }
    },
    next: function () {
      if (cur.phase === "outro") {
        outroNext();
      } else {
        storyNext();
      }
    },
    enterLevel: enterLevel,
    backStory: backStory,
    enterQuest: enterQuest,
    questPick: questPick,
    questContinue: questContinue,
    questSkip: questSkip,
    startQuiz: startQuiz,
    backLesson: backLesson,
    pick: pick,
    nextQuestion: nextQuestion,
    passLevel: finishLevel,
    openMistakes: openMistakes,
    closeMistakes: closeMistakes,
    redoMistake: redoMistake,
    redoAnswer: redoAnswer,
    redoBack: redoBack,
    redoNext: redoNext,
    fillSlot: fillSlot,
    fillUndo: fillUndo,
    checkFill: checkFill,
    afterOutro: afterOutro,
    submitBoss: submitBoss,
    copyExample: copyExample,
    copyBossCode: copyBossCode,
    // 供 runner.js「一键填入」复用与提交判定完全一致的输出清洗规则
    normOutput: norm,
    reset: resetProgress
  };

  // ---------- 启动 ----------
  document.getElementById("btnReset").addEventListener("click", resetProgress);
  const sideToggle = document.getElementById("sideToggle");
  const sideMask = document.getElementById("sideMask");
  const btnMistakes = document.getElementById("btnMistakes");
  if (sideToggle) {
    sideToggle.addEventListener("click", function () {
      setSideDrawer(!document.body.classList.contains("is-side-open"));
    });
  }
  if (sideMask) sideMask.addEventListener("click", closeSideDrawer);
  if (btnMistakes) btnMistakes.addEventListener("click", openMistakes);
  document.addEventListener("keydown", onGlobalKey);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") closeSideDrawer();
  });
  buildMotes();
  renderRoadmap();
  refreshMistakeBadge();

  const first = firstUndone();
  if (first === -1) {
    finale();
  } else if (first === 0 && state.done.length === 0) {
    showCover();
  } else {
    goStory(first);
  }
})();
