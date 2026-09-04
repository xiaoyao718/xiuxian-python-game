// ============================================================
// 灵宠 / 灵器 / 行囊系统（i2-3 S5/S6）
//  - 以练促养：成长只靠“对应语法练习”，题组随阶段进阶（入门→进阶→登峰）；
//  - 通关首次孵化灵卵并得灵器；历练/试炼/重做首答正确得灵石；
//  - 试炼零失误该章宠 +2、错题温习答对主宠 +1；
//  - 面板 = 右侧滑出行囊 overlay；操练 = 居中主舞台式卡片，与主线状态隔离；
//  - 存档读写一律经 App.getBag / App.setBag（v2 单源），校验与迁移在 game.js。
// ============================================================
(function () {
  "use strict";

  var D = window.GAME_DATA;
  var GROUPS = ["入门", "进阶", "登峰"];
  // 进化门槛：stage0→1 需 growth>=5 且入门通关；stage1→2 需 growth>=12 且进阶通关
  var EVO_NEED = [0, 5, 12];
  var PRACTICE_LEN = 3;
  var reducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- 小工具 ----------
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

  function bag() {
    return window.App.getBag();
  }

  function persist(next) {
    window.App.setBag(next);
    refreshStoneBadge(next);
  }

  function sfx(name) {
    try {
      if (window.App && typeof window.App.sfx === "function") window.App.sfx(name);
    } catch (e) {
      // 忽略
    }
  }

  function petOfLevel(levelId) {
    return (D.pets || []).filter(function (p) {
      return p.get === levelId;
    })[0];
  }

  function petById(petId) {
    return (D.pets || []).filter(function (p) {
      return p.id === petId;
    })[0];
  }

  function artifactOfLevel(levelId) {
    return (D.artifacts || []).filter(function (a) {
      return a.from === levelId;
    })[0];
  }

  function levelChapter(levelId) {
    for (var i = 0; i < D.levels.length; i++) {
      if (D.levels[i].id === levelId) {
        return D.levels[i].chapter + " · " + D.levels[i].title;
      }
    }
    return levelId;
  }

  function levelIndexOfId(levelId) {
    for (var i = 0; i < D.levels.length; i++) {
      if (D.levels[i].id === levelId) return i;
    }
    return -1;
  }

  // ---------- 徽章 / 面板状态 ----------
  var page = "pets"; // pets | artifacts
  var bagOpen = false;
  var practice = null; // { petId, groupIdx, qs, qi, ... }
  var sessionAwarded = {}; // 每章内“同题只奖励一次”的记录
  var evoHideTimer = null;

  function refreshStoneBadge(b) {
    var n = b ? b.stones : bag().stones;
    var badge = document.getElementById("bagStones");
    if (badge) {
      badge.textContent = n ? String(n) : "";
      badge.title = n ? "已获灵石：" + n + "（后续版本开放兑换）" : "灵石（暂不消费）";
    }
    var cnt = document.getElementById("bagStoneCount");
    if (cnt) cnt.textContent = String(n);
  }

  function setBagOpen(open) {
    bagOpen = open;
    document.body.classList.toggle("is-bag-open", open);
    var mask = document.getElementById("bagMask");
    var panel = document.getElementById("bagPanel");
    if (mask) mask.setAttribute("aria-hidden", open ? "false" : "true");
    if (panel) panel.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      document.body.classList.remove("is-side-open");
      refreshStoneBadge();
      renderPage();
    }
  }

  function openBag() {
    if (window.App && typeof window.App.closeDrawer === "function") {
      try {
        window.App.closeDrawer();
      } catch (e) {
        // 忽略
      }
    }
    setBagOpen(true);
  }

  function closeBag() {
    setBagOpen(false);
  }

  // ---------- 行囊面板渲染 ----------
  function renderPage() {
    if (!bagOpen) return;
    var body = document.getElementById("bagBody");
    if (!body) return;
    body.innerHTML = page === "artifacts" ? artifactPageHTML() : petPageHTML();
    var tabs = document.querySelectorAll("#bagPanel .bag-tab");
    tabs.forEach(function (t) {
      t.setAttribute("aria-selected", t.getAttribute("data-page") === page ? "true" : "false");
    });
  }

  function petPageHTML() {
    var b = bag();
    var rows = (D.pets || [])
      .map(function (def) {
        var got = b.pets[def.id];
        if (got) {
          return petObtainedRow(def, got);
        }
        return petLockedRow(def);
      })
      .join("");
    return '<div class="pet-list">' + rows + "</div>";
  }

  function petIconHTML(def, cls) {
    return (
      '<span class="pet-icon' + (cls ? " " + cls : "") + '" style="color:' +
      esc(def.hue) +
      '">' +
      def.icon +
      "</span>"
    );
  }

  function groupChips(def, got) {
    return GROUPS.map(function (g, gi) {
      var cls = "grp-chip";
      var label = g;
      if (got.cleared && got.cleared[gi]) {
        cls += " passed";
        label += " · 已通";
      } else if (got.stage >= gi) {
        cls += " open";
        label += " · 可练";
      } else {
        label += " · 未开放";
      }
      return '<span class="' + cls + '">' + label + "</span>";
    }).join("");
  }

  function petObtainedRow(def, got) {
    var nextNeed = got.stage < 2 ? EVO_NEED[got.stage + 1] : null;
    var pct = nextNeed
      ? Math.min(100, Math.round((got.growth / nextNeed) * 100))
      : 100;
    var growTxt = nextNeed
      ? "成长 " + got.growth + " / " + nextNeed
      : "成长 " + got.growth + "（已登峰）";
    var stageName = def.stages[Math.min(got.stage, def.stages.length - 1)] || def.name;
    return (
      '<div class="pet-item obtained" data-pet="' + def.id + '">' +
      petIconHTML(def) +
      '<div class="pet-main">' +
      '<div class="pet-name-row">' +
      '<span class="pet-name">' + esc(def.name) + "</span>" +
      '<span class="pet-stage">' + esc(stageName) + "</span>" +
      "</div>" +
      '<div class="pet-topic">' + esc(def.topic) + "</div>" +
      '<div class="pet-grow"><i style="transform:scaleX(' + pct / 100 + ')"></i></div>' +
      '<div class="pet-grow-num">' + growTxt + "</div>" +
      "</div>" +
      '<div class="pet-acts">' +
      '<button class="btn primary small" data-practice="' + def.id + '" type="button">操练</button>' +
      "</div>" +
      '<div class="pet-groups">' + groupChips(def, got) + "</div>" +
      "</div>"
    );
  }

  function petLockedRow(def) {
    return (
      '<div class="pet-item locked" data-pet="' + def.id + '">' +
      petIconHTML(def) +
      '<div class="pet-main">' +
      '<div class="pet-name-row"><span class="pet-name">' + esc(def.name) + "</span></div>" +
      '<div class="pet-topic">' + esc(def.topic) + "</div>" +
      "</div>" +
      '<div class="pet-acts"><span class="pet-tip">' + esc(def.glyph) + " · 未遇</span></div>" +
      '<div class="pet-tip">通关「' + esc(levelChapter(def.get)) + '」后相遇</div>' +
      "</div>"
    );
  }

  function artifactPageHTML() {
    var b = bag();
    var arts = (D.artifacts || [])
      .map(function (a) {
        var got = b.artifacts.indexOf(a.id) !== -1;
        return (
          '<div class="artifact-item' + (got ? "" : " locked") + '" data-art="' + a.id + '">' +
          '<div class="art-icon" style="color:' + (got ? esc("#c8a44b") : esc("#5d615a")) + '">' +
          a.icon +
          "</div>" +
          '<div class="art-name">' + esc(a.name) + "</div>" +
          '<div class="art-kind">' + esc(a.kind) + "</div>" +
          '<div class="art-desc">' + esc(got ? a.desc : "待机缘") + "</div>" +
          "</div>"
        );
      })
      .join("");
    return '<div class="artifact-grid">' + arts + "</div>";
  }

  // ---------- 解锁 / 成长 / 进化（引擎回调入口） ----------
  function grantLevelReward(levelId) {
    var b = bag();
    var petDef = petOfLevel(levelId);
    var artDef = artifactOfLevel(levelId);
    if (petDef && !b.pets[petDef.id]) {
      b.pets[petDef.id] = { stage: 0, growth: 1, cleared: [false, false, false] };
      showEvo(petDef, petDef.stages[0], "灵卵微光 · 已入囊中", 1500);
      sfx("seal");
    }
    if (artDef && b.artifacts.indexOf(artDef.id) === -1) {
      b.artifacts.push(artDef.id);
    }
    persist(b);
  }

  function addGrowth(id, n) {
    var b = bag();
    if (!b.pets[id]) return;
    b.pets[id].growth = Math.max(0, b.pets[id].growth + n);
    persist(b);
  }

  function awardStone(key) {
    if (sessionAwarded[key]) return;
    sessionAwarded[key] = true;
    var b = bag();
    b.stones += 1;
    persist(b);
  }

  function mainPetId() {
    var b = bag();
    var done = b.done || [];
    for (var i = done.length - 1; i >= 0; i--) {
      var def = petOfLevel(done[i]);
      if (def) return def.id;
    }
    return "";
  }

  // 面板/操练之后的统一进化判定（数值在 EVO_NEED，可集中调整）
  function tryEvolve(petId, callback) {
    var b = bag();
    var got = b.pets[petId];
    if (!got) {
      if (callback) callback();
      return;
    }
    var def = petById(petId);
    var evolved = false;
    var nextStage = got.stage;
    if (got.stage === 0 && got.growth >= EVO_NEED[1] && got.cleared[0]) {
      nextStage = 1;
      evolved = true;
    } else if (got.stage === 1 && got.growth >= EVO_NEED[2] && got.cleared[1]) {
      nextStage = 2;
      evolved = true;
    }
    if (evolved) {
      got.stage = nextStage;
      persist(b);
      sfx("levelup");
      showEvo(def, def.stages[nextStage], "境界再进一步 · 可练更难题目", 1700, callback);
    } else if (callback) {
      callback();
    }
  }

  function showEvo(def, stageName, sub, ms, doneCb) {
    var box = document.getElementById("petEvo");
    if (!box) {
      if (doneCb) doneCb();
      return;
    }
    box.hidden = false;
    box.innerHTML =
      '<div class="pet-evo-inner">' +
      petIconHTML(def, "evo") +
      '<div class="pet-evo-title">' + esc(stageName) + "</div>" +
      '<div class="pet-evo-sub">' + esc(def.name + " · " + sub) + "</div>" +
      "</div>";
    if (evoHideTimer) window.clearTimeout(evoHideTimer);
    evoHideTimer = window.setTimeout(function () {
      box.hidden = true;
      box.innerHTML = "";
      if (doneCb) doneCb();
    }, reducedMotion ? 300 : ms);
  }

  // ---------- 灵宠操练会话（独立状态，与主线隔离） ----------
  function startPractice(petId) {
    var b = bag();
    var got = b.pets[petId];
    if (!got) return;
    var groupIdx = Math.min(got.stage, 2);
    var pool = (D.petQuests && D.petQuests[petId] && D.petQuests[petId][groupIdx]) || [];
    // 若该组题目不足 3 道（异常兜底），向低一档回退
    while (pool.length < PRACTICE_LEN && groupIdx > 0) {
      groupIdx -= 1;
      pool = D.petQuests[petId][groupIdx];
    }
    if (!pool || pool.length < PRACTICE_LEN) return;
    var picked = pickDistinct(pool, PRACTICE_LEN);
    practice = {
      petId: petId,
      groupIdx: groupIdx,
      qs: picked.map(function (q) {
        return {
          q: q,
          wrong: [],
          fillArr: [],
          fillWrong: false,
          solved: false,
          awarded: false
        };
      }),
      qi: 0,
      gained: 0
    };
    setBagOpen(false);
    document.getElementById("practiceBox").hidden = false;
    renderPractice();
  }

  function pickDistinct(pool, n) {
    var idx = [];
    for (var i = 0; i < pool.length; i++) idx.push(i);
    // Fisher-Yates 洗牌后取前 n
    for (var j = idx.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var t = idx[j];
      idx[j] = idx[k];
      idx[k] = t;
    }
    return idx.slice(0, n).map(function (x) {
      return pool[x];
    });
  }

  function closePractice(backToBag) {
    practice = null;
    var box = document.getElementById("practiceBox");
    if (box) {
      box.hidden = true;
      box.innerHTML = "";
    }
    if (backToBag) {
      setBagOpen(true);
    }
  }

  function practiceDef() {
    return petById(practice.petId);
  }

  function renderPractice() {
    var box = document.getElementById("practiceBox");
    if (!box || !practice) return;
    var it = practice.qs[practice.qi];
    if (!it) {
      finishPractice();
      return;
    }
    var def = practiceDef();
    var groupName = GROUPS[practice.groupIdx];
    var head =
      '<div class="practice-head">' +
      petIconHTML(def) +
      '<div><div class="mini-title practice-name">' + esc(def.name) + "</div>" +
      '<div class="practice-group">' + esc(def.topic + " · " + groupName + "操练") + "</div></div>" +
      '<div class="practice-progress">第 <b>' + (practice.qi + 1) + "</b> / " + PRACTICE_LEN + " 题</div>" +
      '<button class="btn ghost small" id="practiceExit" type="button">退出</button>' +
      "</div>";

    var q = it.q;
    var body = "";
    var fb = "";
    if (q.kind === "fill") {
      var filledAll = (q.answer || []).every(function (a, s) {
        return it.fillArr[s] != null;
      });
      body =
        '<div class="q-text">' + esc(q.q) + "</div>" +
        '<div class="fill-zone">' +
        '<pre class="code-block fill-code">' + fillView(q, it.fillArr) + "</pre>" +
        '<div class="fill-cands-wrap">' + fillCands(q, it.fillArr) + "</div>" +
        "</div>";
      if (it.solved) {
        fb = fbOK(q);
      } else if (it.fillWrong) {
        fb = fbBad(q);
      }
      body += fb;
      body +=
        '<div class="btn-row">' +
        (it.solved
          ? '<button class="btn primary" id="pqContinue" type="button">继续 ▸</button>'
          : '<button class="btn primary" id="pqCheck" type="button"' +
            (filledAll ? "" : " disabled") +
            ">校验</button>") +
        "</div>";
    } else {
      var opts = "";
      q.options.forEach(function (opt, oi) {
        var cls = "opt";
        if (it.solved && oi === q.answer) cls += " correct";
        else if (it.wrong.indexOf(oi) !== -1) cls += " wrong disabled";
        else if (it.solved) cls += " disabled";
        opts +=
          '<button class="' + cls + '" data-oi="' + oi + '" type="button">' +
          '<span class="opt-label">' + "甲乙丙丁".charAt(oi) + "</span>" +
          '<span class="opt-text">' + esc(opt) + "</span>" +
          "</button>";
      });
      body =
        '<div class="q-text">' + esc(q.q) + "</div>" +
        (q.code ? '<pre class="code-block q-code">' + esc(q.code) + "</pre>" : "") +
        '<div class="opt-list">' + opts + "</div>";
      if (it.solved) {
        body += fbOK(q);
      } else if (it.wrong.length) {
        body += fbBad(q);
      }
      body +=
        '<div class="btn-row">' +
        (it.solved ? '<button class="btn primary" id="pqContinue" type="button">继续 ▸</button>' : "") +
        "</div>";
    }

    box.innerHTML =
      '<div class="card practice-card">' +
      head +
      body +
      "</div>";
    bindPracticeEvents();
  }

  function fillView(q, chosen) {
    return String(q.code || "")
      .split("\n")
      .map(function (line) {
        return line
          .split(/(__\d+__)/g)
          .map(function (part) {
            var m = /^__(\d+)__$/.exec(part);
            if (!m) return esc(part);
            var s = Number(m[1]) - 1;
            var ci = chosen[s];
            var label = ci != null && q.slots[s] && q.slots[s][ci] != null ? q.slots[s][ci] : part;
            return (
              '<button type="button" class="slot-chip' +
              (ci != null ? " filled" : "") +
              '" data-slot="' + s + '"' +
              (practice.qs[practice.qi].solved ? " disabled" : "") +
              ' title="点一下撤销这一处">' + esc(label) + "</button>"
            );
          })
          .join("");
      })
      .join("\n");
  }

  function fillCands(q, chosen) {
    return (q.slots || [])
      .map(function (cands, s) {
        var used = chosen[s];
        return (
          '<div class="fill-slot-group">' +
          '<div class="fill-slot-label">第 ' + (s + 1) + " 处空缺 · 点选一个片段</div>" +
          '<div class="fill-cands">' +
          cands
            .map(function (c, ci) {
              var disabled =
                practice.qs[practice.qi].solved || (used != null && used !== ci);
              return (
                '<button type="button" class="fill-cand' +
                (used === ci ? " chosen" : "") +
                '" data-slot="' + s + '" data-idx="' + ci + '"' +
                (disabled ? " disabled" : "") +
                ">" + esc(c) + "</button>"
              );
            })
            .join("") +
          "</div></div>"
        );
      })
      .join("");
  }

  function fbOK(q) {
    return (
      '<div class="fb fb-ok"><div class="fb-title">' + esc(q.cheer || "答对了") +
      "</div><div class='fb-body'>" + esc(q.explain || "") + "</div></div>"
    );
  }

  function fbBad(q) {
    return (
      '<div class="fb fb-bad"><div class="fb-title">此路不通</div>' +
      '<div class="fb-body">' + esc(q.hint || "再想想。") + "</div></div>"
    );
  }

  function bindPracticeEvents() {
    var box = document.getElementById("practiceBox");
    if (!box) return;
    var exitBtn = box.querySelector("#practiceExit");
    if (exitBtn) {
      exitBtn.addEventListener("click", function () {
        sfx("click");
        closePractice(true);
      });
    }
    box.querySelectorAll(".opt").forEach(function (btn) {
      btn.addEventListener("click", function () {
        practicePick(Number(btn.getAttribute("data-oi")));
      });
    });
    box.querySelectorAll(".slot-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var s = Number(chip.getAttribute("data-slot"));
        var it = practice.qs[practice.qi];
        if (it.solved) return;
        it.fillArr[s] = null;
        renderPractice();
      });
    });
    box.querySelectorAll(".fill-cand").forEach(function (cand) {
      cand.addEventListener("click", function () {
        var s = Number(cand.getAttribute("data-slot"));
        var idx = Number(cand.getAttribute("data-idx"));
        var it = practice.qs[practice.qi];
        if (it.solved) return;
        it.fillArr[s] = idx;
        renderPractice();
      });
    });
    var checkBtn = box.querySelector("#pqCheck");
    if (checkBtn) {
      checkBtn.addEventListener("click", function () {
        practiceCheckFill();
      });
    }
    var contBtn = box.querySelector("#pqContinue");
    if (contBtn) {
      contBtn.addEventListener("click", function () {
        practiceNext();
      });
    }
  }

  function practicePick(oi) {
    if (!practice) return;
    var it = practice.qs[practice.qi];
    if (it.solved || it.wrong.indexOf(oi) !== -1) return;
    var q = it.q;
    if (oi === q.answer) {
      it.solved = true;
      it.wrong = [];
      awardPracticeCorrect(q);
    } else {
      it.wrong.push(oi);
      sfx("wrong");
    }
    renderPractice();
  }

  function practiceCheckFill() {
    if (!practice) return;
    var it = practice.qs[practice.qi];
    var q = it.q;
    if (it.solved || q.kind !== "fill") return;
    if (window.App.judgeQuestion(q, it.fillArr)) {
      it.solved = true;
      it.fillWrong = false;
      awardPracticeCorrect(q);
    } else {
      it.fillWrong = true;
      sfx("wrong");
    }
    renderPractice();
  }

  function awardPracticeCorrect(q) {
    var it = practice.qs[practice.qi];
    if (it.awarded) {
      sfx("right");
      return;
    }
    it.awarded = true;
    practice.gained += 1;
    var b = bag();
    if (b.pets[practice.petId]) {
      b.pets[practice.petId].growth += 1;
    }
    b.stones += 1;
    persist(b);
    sfx("right");
  }

  function practiceNext() {
    if (!practice) return;
    practice.qi += 1;
    if (practice.qi >= practice.qs.length) {
      finishPractice();
      return;
    }
    renderPractice();
  }

  function finishPractice() {
    if (!practice) return;
    var petId = practice.petId;
    var groupIdx = practice.groupIdx;
    var gained = practice.gained;
    // 完成一次完整操练（3 题全对）+1，并标记题组已通
    var b = bag();
    if (b.pets[petId]) {
      b.pets[petId].growth += 1;
      b.pets[petId].cleared[groupIdx] = true;
    }
    gained += 1;
    persist(b);

    var summary = function () {
      var box = document.getElementById("practiceBox");
      var def = petById(petId);
      box.innerHTML =
        '<div class="card practice-card practice-summary">' +
        '<div class="finale-seal">圆</div>' +
        '<div class="practice-name">灵光圆满</div>' +
        '<div class="practice-group">「' + esc(def.name + " · " + GROUPS[groupIdx]) +
        '」操练通关</div>' +
        '<p class="finale-desc">本次成长 +' + gained + "，可继续重复操练巩固，或返回行囊看看新进度。</p>" +
        '<div class="btn-row center-row">' +
        '<button class="btn ghost small" id="againBtn" type="button">再练一次</button>' +
        '<button class="btn primary" id="backBagBtn" type="button">返回行囊</button>' +
        "</div></div>";
      var again = box.querySelector("#againBtn");
      if (again) {
        again.addEventListener("click", function () {
          practice = null;
          startPractice(petId);
        });
      }
      var back = box.querySelector("#backBagBtn");
      if (back) {
        back.addEventListener("click", function () {
          closePractice(true);
        });
      }
    };
    practice = null;
    tryEvolve(petId, summary);
  }

  // ---------- 绑定：按钮 / 遮罩 / 键盘 ----------
  function switchPage(p) {
    page = p;
    renderPage();
  }

  function boot() {
    var btnBag = document.getElementById("btnBag");
    var mask = document.getElementById("bagMask");
    var close = document.getElementById("bagClose");
    var tabs = document.querySelectorAll("#bagPanel .bag-tab");
    if (btnBag) {
      btnBag.addEventListener("click", function () {
        sfx("click");
        openBag();
      });
    }
    if (mask) {
      mask.addEventListener("click", function () {
        closeBag();
      });
    }
    if (close) {
      close.addEventListener("click", function () {
        closeBag();
      });
    }
    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        switchPage(t.getAttribute("data-page"));
      });
    });
    document.addEventListener("click", function (ev) {
      var practiceBtn = ev.target && ev.target.closest
        ? ev.target.closest("[data-practice]")
        : null;
      if (practiceBtn) {
        sfx("click");
        startPractice(practiceBtn.getAttribute("data-practice"));
      }
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      if (practice) {
        closePractice(true);
      } else if (bagOpen) {
        closeBag();
      }
    });
    refreshStoneBadge();
  }

  // ---------- 引擎回调注册（game.js 只在关键节点调用一次） ----------
  window.App.onEnterLevel = function (li) {
    // 进入新章（含重玩）：重置“同题一次”奖励记录，防刷
    sessionAwarded = {};
  };

  window.App.onQuestionCorrect = function (levelId, q) {
    if (!q) return;
    awardStone(levelId + "|" + q.q);
  };

  window.App.onRedoCorrect = function (levelId) {
    // 温习答对：主宠（最新通关章对应宠）成长 +1
    var main = mainPetId();
    if (main) addGrowth(main, 1);
  };

  window.App.onQuizPerfect = function (levelId) {
    var petDef = petOfLevel(levelId);
    if (petDef) addGrowth(petDef.id, 2);
  };

  window.App.afterLevelDone = function (levelId, firstTime) {
    if (!firstTime) return;
    grantLevelReward(levelId);
  };

  // 操练可练性查询（供面板/未来成就系统使用）
  window.App.practiceInfo = function (petId) {
    var b = bag();
    var got = b.pets[petId];
    if (!got) return null;
    return {
      petId: petId,
      stage: got.stage,
      growth: got.growth,
      cleared: got.cleared.slice()
    };
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
