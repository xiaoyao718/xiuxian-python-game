// ============================================================
// 第三迭代 P1c：反派对决 · 战斗 UI（js/battle.js）
//  - 纯逻辑来自 js/battle-core.js；内容来自 GAME_DATA.battles/petQuests；
//  - 站位：主角林慕居左、敌方居右；像素小人取自 js/sprites.js（占位可替换）；
//  - 大招：Skulpt 运行→norm 比对；离线降级=在 PyCharm 运行后粘贴输出；
//    题干不展示 expected，答错 3 次后才给 hint；
//  - 胜利后标记 rival 并复用 finishLevel（破境/奖励/存档零改动）。
// ============================================================
(function () {
  "use strict";

  var D = window.GAME_DATA;
  var BAL = window.BALANCE;
  var SPR = window.SPRITES;
  var core = window.BattleCore;

  var root = null;
  var bt = null; // GAME_DATA.battles 当前项
  var levelIdx = 0;
  var st = null; // battle-core 状态
  var usedTrap = {};
  var petAssist = null;
  var animTick = 0;
  var fightStarted = false;
  var defeatedBefore = false;

  function $(sel, box) {
    return (box || document).querySelector(sel);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function norm(s) {
    if (window.App && typeof window.App.normOutput === "function") {
      try {
        return window.App.normOutput(s);
      } catch (e) {
        // 回退本地
      }
    }
    return String(s || "")
      .replace(/\r/g, "")
      .split("\n")
      .map(function (line) { return line.trim(); })
      .join("\n")
      .trim();
  }

  function log(text, kind) {
    var box = $("#bLog");
    if (!box) return;
    var div = document.createElement("div");
    div.className = "bl" + (kind ? " " + kind : "");
    div.textContent = text;
    box.insertBefore(div, box.firstChild);
    while (box.children.length > 9) box.removeChild(box.lastChild);
  }

  // ---------- 题目源 ----------
  function topicFor(petId) {
    return (D.pets || []).filter(function (p) { return p.id === petId; })[0];
  }

  function choicePoolOf(petId) {
    var pet = topicFor(petId);
    var out = [];
    var seen = {};
    var push = function (q) {
      if (!q || q.kind === "fill" || !q.options || seen[q.q]) return;
      seen[q.q] = true;
      out.push(q);
    };
    if (!pet) return out;
    var lv = (D.levels || []).filter(function (x) { return x.id === pet.get; })[0];
    if (lv) {
      (lv.questions || []).forEach(push);
      (lv.quizExtra || []).forEach(push);
    }
    var groups = (D.petQuests && D.petQuests[petId]) || [];
    groups.forEach(function (g) { (g || []).forEach(push); });
    return out;
  }

  function drawSkillQuestion(petId, used) {
    var pool = choicePoolOf(petId);
    var fresh = pool.filter(function (q) {
      return !used[petId + "|" + q.q];
    });
    var arr = fresh.length ? fresh : pool;
    if (!arr.length) return undefined;
    var q = arr[Math.floor(Math.random() * arr.length)];
    used[petId + "|" + q.q] = true;
    return q;
  }

  function resolveTrapRef(ref) {
    var key = ref.pet + "|" + ref.group + "|" + ref.q;
    if (usedTrap[key]) return null;
    var q = D.petQuests && D.petQuests[ref.pet] &&
      D.petQuests[ref.pet][ref.group] && D.petQuests[ref.pet][ref.group][ref.q];
    if (!q) return null;
    usedTrap[key] = true;
    return q;
  }

  function drawTrapQuestion() {
    var refs = (bt.enemy.trap || []).slice();
    for (var i = refs.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = refs[i]; refs[i] = refs[j]; refs[j] = t;
    }
    for (var k = 0; k < refs.length; k++) {
      var q = resolveTrapRef(refs[k]);
      if (q) return q;
    }
    // 全用尽后重置（本场找茬题至少 8 道，通常不会触达）
    usedTrap = {};
    return resolveTrapRef(refs[0]);
  }

  // ---------- 开局配置 ----------
  function heroStats() {
    var done = window.App.getBag ? window.App.getBag().done : [];
    return {
      hp: BAL.hero.baseHp + BAL.hero.hpPerLevel * done.length,
      atk: BAL.hero.baseAtk + BAL.hero.atkPerLevel * done.length
    };
  }

  function pickAssist() {
    if (!window.App.getBag) return null;
    var b = window.App.getBag();
    var best = null;
    (D.pets || []).forEach(function (p) {
      var got = b.pets[p.id];
      if (got && (!best || got.stage > best.stage)) {
        best = { def: p, stage: got.stage };
      }
    });
    return best ? best.def : null;
  }

  function availablePets() {
    var idx = levelIdx;
    return (D.pets || []).slice(0, Math.min(idx + 1, D.pets.length));
  }

  function buildCfg() {
    var h = heroStats();
    var bl = BAL.levels[bt.levelId] || { enemyHp: 90, enemyAtk: 10 };
    return {
      levelId: bt.levelId,
      heroHp: h.hp,
      heroAtk: h.atk,
      enemyHp: bl.enemyHp,
      enemyAtk: bl.enemyAtk,
      ultPct: BAL.ultHpPct,
      trapChance: BAL.trapChance,
      trapPenalty: BAL.trapPenalty,
      ultMissCounter: BAL.ultMissCounter,
      shield: !!petAssist,
      topics: availablePets().map(function (p) { return p.id; }),
      drawQuestion: drawSkillQuestion,
      drawTrapQuestion: drawTrapQuestion
    };
  }

  // ---------- 像素 ----------
  var sheetCache = {};
  function sheetSrc(id) {
    return "assets/sprites/" + id + ".png";
  }
  function getSheet(id) {
    if (Object.prototype.hasOwnProperty.call(sheetCache, id)) return sheetCache[id];
    var img = new Image();
    img.src = sheetSrc(id);
    sheetCache[id] = null;
    img.onload = function () {
      sheetCache[id] = img;
    };
    return null;
  }
  function frameCol(frameKey, frameIdx) {
    var idx = frameIdx || 0;
    if (frameKey === "idle") return idx % 2;
    if (frameKey === "attack") return 2 + (idx % 2);
    if (frameKey === "hit") return 4;
    if (frameKey === "defeat") return 5;
    return 0;
  }
  function drawPixelOld(canvas, sprite, frameKey, frameIdx, isEnemy) {
    if (!canvas || !sprite) return;
    var ctx = canvas.getContext("2d");
    var frames = sprite.frames[frameKey] || sprite.frames.idle;
    var m = frames[Math.min(frameIdx || 0, frames.length - 1)];
    if (!m) return;
    ctx.clearRect(0, 0, 16, 16);
    ctx.save();
    if (isEnemy) {
      ctx.translate(16, 0);
      ctx.scale(-1, 1);
    }
    var pal = sprite.pal || [];
    for (var y = 0; y < 16; y++) {
      for (var x = 0; x < 16; x++) {
        var idx = m[y] && m[y][x];
        if (!idx) continue;
        ctx.fillStyle = pal[idx] || "#000";
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.restore();
  }

  function paintPixels(kind, fxFrame) {
    var c = kind === "hero" ? $("#pxHero") : $("#pxEnemy");
    var id = kind === "hero" ? "linmu" : bt.enemy.sprite;
    var sprite = kind === "hero" ? SPR.linmu : SPR[bt.enemy.sprite];
    if (!c || !sprite) return;
    var key = "idle";
    var idx = animTick % 2;
    if (fxFrame) {
      key = fxFrame.key;
      idx = fxFrame.idx || 0;
    }
    var sheet = getSheet(id);
    if (sheet) {
      var ctx = c.getContext("2d");
      ctx.clearRect(0, 0, 16, 16);
      ctx.save();
      if (kind === "enemy") { ctx.translate(16, 0); ctx.scale(-1, 1); }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sheet, frameCol(key, idx) * 16, 0, 16, 16, 0, 0, 16, 16);
      ctx.restore();
    } else {
      drawPixelOld(c, sprite, key, idx, kind === "enemy");
    }
  }

  // ---------- 技能特效层 ----------
  function fx(type) {
    var panel = $(".battle-panel");
    if (!panel) return;
    var old = panel.querySelector(".battle-fx");
    if (old) old.parentNode.removeChild(old);
    var box = document.createElement("div");
    box.className = "battle-fx";
    var span = document.createElement("span");
    span.className = "fx-" + type;
    box.appendChild(span);
    panel.appendChild(box);
    window.setTimeout(function () {
      if (box.parentNode) box.parentNode.removeChild(box);
    }, 1100);
  }

  // ---------- 渲染 ----------
  function heroHpPct() { return Math.max(0, st.hp.hero / st.cfg.heroHp * 100); }
  function enemyHpPct() { return Math.max(0, st.hp.enemy / st.cfg.enemyHp * 100); }

  function renderIntro() {
    var e = bt.enemy;
    var line = defeatedBefore ? e.rivalWin : e.intro;
    root.innerHTML =
      '<div class="battle-panel">' +
      '<div class="battle-head"><div class="battle-title">反派对决 · ' + esc(e.name) + "</div>" +
      '<div class="battle-sub">' + esc(D.meta.volume) + " · 语法主题战</div></div>" +
      '<div class="battle-enter">' +
      '<div class="end-seal">' + esc(e.glyph) + "</div>" +
      '<div class="big">' + esc(e.name) + "</div>" +
      '<p class="end-text">' + esc(line) + "</p>" +
      '<button class="btn primary" id="bFight">开 战</button>' +
      '<button class="btn ghost" id="bBackIntro" style="margin-left:10px">撤退</button>' +
      "</div></div>";
    $("#bFight").addEventListener("click", startFight);
    $("#bBackIntro").addEventListener("click", retreat);
  }

  function renderArena() {
    var e = bt.enemy;
    var skills = "";
    var locked = st.ult.unlocked || st.phase === "ult";
    var skillLabels = { qin: "灵雀报信", shu: "藏灵玉鼠", hu: "谛听灵狐", gui: "阴阳玄龟", lang: "追风灵狼" };
    st.slots.forEach(function (slot, i) {
      var pid = slot.topic;
      var pet = topicFor(pid);
      var label = pet ? (skillLabels[pid.replace("pet_", "")] || pet.topic) : slot.topic;
      var topicShort = pet ? String(pet.topic).split(" ")[0] : slot.topic;
      skills +=
        '<button class="b-skill" data-i="' + i + '"' + (locked ? " disabled" : "") + ">" +
        esc(label) + "<small>" + esc(topicShort) + " · 选择题</small></button>";
    });
    var assistHtml = petAssist
      ? '<span class="b-pet" style="color:' + esc(petAssist.hue) + '">' +
        (st.shield ? "灵光护体（可用）" : "援护已用") + "</span>"
      : "";
    root.innerHTML =
      '<div class="battle-panel">' +
      '<div class="battle-head">' +
      '<div class="battle-title">' + esc(e.name) + " · 反派对决</div>" +
      '<div class="battle-sub">回合 ' + st.round + "</div>" +
      '<button class="btn ghost small battle-exit" id="bRetreat" type="button">撤退回章节入口</button>' +
      "</div>" +
      '<div class="battle-arena">' +
      '<div class="b-side hero">' +
      '<div class="b-medal">慕</div>' +
      '<div class="b-name">林慕</div><div class="b-sub">练气 · 已学 ' +
      esc(availablePets().map(function (p) { return p.id.replace("pet_", ""); }).join("、")) + "</div>" +
      '<div class="b-hp"><i style="width:' + heroHpPct() + '%"></i></div>' +
      '<div class="b-hpnum">' + st.hp.hero + " / " + st.cfg.heroHp + "</div>" +
      assistHtml +
      "</div>" +
      '<div class="b-log" id="bLog"></div>' +
      '<div class="b-side enemy">' +
      '<div class="b-medal">' + esc(e.glyph) + "</div>" +
      '<div class="b-name">' + esc(e.name) + "</div>" +
      '<div class="b-sub">' + esc(e.glyph + " · " + bt.levelId) + "</div>" +
      '<div class="b-hp"><i style="width:' + enemyHpPct() + '%"></i></div>' +
      '<div class="b-hpnum">' + st.hp.enemy + " / " + st.cfg.enemyHp + "</div>" +
      "</div>" +
      "</div>" +
      '<div class="b-skills">' + skills + "</div>" +
      '<button class="b-ult' + (st.ult.unlocked ? " ready" : "") + '" id="bUlt" type="button"' +
      (st.ult.unlocked ? "" : " disabled") + ">灵力见底 · 写代码终击</button>" +
      '<div id="bQ"></div>' +
      "</div>";

    root.querySelectorAll(".b-skill").forEach(function (b) {
      b.addEventListener("click", function () {
        onChooseSkill(Number(b.getAttribute("data-i")));
      });
    });
    $("#bRetreat").addEventListener("click", retreat);
    var ultBtn = $("#bUlt");
    if (st.ult.unlocked) {
      ultBtn.addEventListener("click", openUlt);
    }
  }

  function randomTaunt() {
    var arr = bt.enemy.taunt || [];
    return arr[Math.floor(Math.random() * arr.length)] || "……";
  }

  // ---------- 战斗流程 ----------
  function startFight() {
    fightStarted = true;
    usedTrap = {};
    st = core.createBattle(buildCfg());
    renderArena();
    log("（敌方）" + randomTaunt(), "hurt");
    log("你握紧残页：以题代剑，来吧。", "me");
  }

  function retreat() {
    if (window.App && typeof window.App.backStory === "function") {
      try { window.App.backStory(); } catch (e) { /* 忽略 */ }
    }
    hideRoot();
  }

  function onChooseSkill(i) {
    var r = core.chooseSkill(st, i);
    if (!r.ok) return;
    var slot = st.slots[i];
    renderQuestion(slot.q, { enemy: false, meta: "你出招 · " + esc(slot.flavor) });
  }

  function renderQuestion(q, ctx, chosen) {
    var qz = $("#bQ");
    if (!qz || !q) return;
    var meta = '<div class="bq-meta' + (ctx.enemy ? " enemy" : "") + '">' + ctx.meta + "</div>";
    var html = meta + '<div class="bq-text">' + esc(q.q) + "</div>";
    if (q.code) html += '<pre class="bq-code">' + esc(q.code) + "</pre>";
    if (q.kind === "fill") {
      html += fillHTML(q, chosen || []);
    } else {
      html += '<div class="bq-opts">' +
        q.options.map(function (opt, oi) {
          return '<button class="bq-opt" data-oi="' + oi + '" type="button">' +
            '<span class="tag">' + "甲乙丙丁".charAt(oi) + "</span><span>" +
            esc(String(opt).split("\n").join("<br>")) + "</span></button>";
        }).join("") + "</div>";
    }
    qz.innerHTML = html;
    qz._q = q;
    qz._ctx = ctx;
    qz._chosen = chosen || [];
    qz._answered = false;
    bindQuestionEvents();
    if (q.kind === "fill") decorateFill(q, qz._chosen);
  }

  // 渲染完成后按已选答案装饰补全题（避开模板内转义复杂化）
  function decorateFill(q, chosen) {
    var qz = $("#bQ");
    if (!qz) return;
    qz.querySelectorAll(".slot-chip").forEach(function (chip) {
      var s = Number(chip.getAttribute("data-slot"));
      var ci = chosen[s];
      chip.textContent = ci != null && q.slots[s] && q.slots[s][ci] != null ? q.slots[s][ci] : "__" + (s + 1) + "__";
      chip.classList.toggle("filled", ci != null);
    });
    qz.querySelectorAll(".fill-cand").forEach(function (b) {
      var s = Number(b.getAttribute("data-slot"));
      var idx = Number(b.getAttribute("data-idx"));
      var ci = chosen[s];
      b.disabled = ci != null && ci !== idx;
      b.classList.toggle("chosen", ci === idx);
    });
    var allFilled = (q.slots || []).every(function (cands, s) {
      return chosen[s] != null;
    });
    var chk = qz.querySelector("#bFillCheck");
    if (chk) chk.disabled = !allFilled;
  }

  function fillHTML(q) {
    var code = String(q.code || "");
    var view = code.replace(/__(\d+)__/g, function (m, n) {
      var s = Number(n) - 1;
      return '<span class="slot-chip" data-slot="' + s + '">__' + n + "__</span>";
    });
    var cands = (q.slots || []).map(function (cands, s) {
      return '<div class="fill-slot-group"><div class="fill-slot-label">第 ' + (s + 1) +
        " 处空缺</div><div class=\"fill-cands\">" +
        cands.map(function (c, ci) {
          return '<button type="button" class="fill-cand" data-slot="' + s +
            '" data-idx="' + ci + '">' + esc(c) + "</button>";
        }).join("") + "</div></div>";
    }).join("");
    return '<pre class="code-block fill-code">' + view + "</pre>" +
      '<div class="fill-cands-wrap">' + cands + "</div>" +
      '<div class="btn-row"><button class="btn primary" id="bFillCheck" type="button" disabled>校验</button></div>';
  }

  function bindQuestionEvents() {
    var qz = $("#bQ");
    if (!qz) return;
    qz.querySelectorAll(".bq-opt").forEach(function (b) {
      b.addEventListener("click", function () {
        answerChoice(Number(b.getAttribute("data-oi")));
      });
    });
    qz.querySelectorAll(".fill-cand").forEach(function (b) {
      b.addEventListener("click", function () {
        var s = Number(b.getAttribute("data-slot"));
        var idx = Number(b.getAttribute("data-idx"));
        var chosen = (qz._chosen || []).slice();
        chosen[s] = idx;
        renderQuestion(qz._q, qz._ctx, chosen);
      });
    });
    qz.querySelectorAll(".slot-chip").forEach(function (b) {
      b.addEventListener("click", function () {
        var s = Number(b.getAttribute("data-slot"));
        var chosen = (qz._chosen || []).slice();
        chosen[s] = null;
        renderQuestion(qz._q, qz._ctx, chosen);
      });
    });
    var chk = qz.querySelector("#bFillCheck");
    if (chk) {
      chk.addEventListener("click", function () {
        answerFill(qz._q, qz._ctx);
      });
    }
  }

  function currentQ() {
    var qz = $("#bQ");
    return qz && qz._q;
  }

  function resolveQ(correct, q, ctx) {
    var qz = $("#bQ");
    if (qz) {
      qz._answered = true;
      var fb = document.createElement("div");
      fb.className = "bq-fb " + (correct ? "good" : "bad");
      fb.textContent = correct ? (q.cheer || "答对了，法诀命中！") : (q.hint || "此路不通。");
      qz.appendChild(fb);
    }
    window.setTimeout(function () {
      var r;
      if (ctx.enemy) {
        if (!correct && window.App.recordBattleMistake) {
          window.App.recordBattleMistake(bt.levelId, q, "战斗找茬题答错");
        }
        r = core.resolveTrap(st, correct);
        afterTrap(r, correct);
      } else {
        r = core.resolveSkill(st, correct);
        afterSkill(r);
      }
    }, correct ? 450 : 750);
  }

  function answerChoice(oi) {
    var q = currentQ();
    if (!q || $("#bQ")._answered) return;
    var qz = $("#bQ");
    qz.querySelectorAll(".bq-opt").forEach(function (b, i) {
      b.disabled = true;
      if (i === q.answer) b.classList.add("correct");
      if (i === oi && oi !== q.answer) b.classList.add("wrong");
    });
    resolveQ(oi === q.answer, q, qz._ctx);
  }

  function answerFill(q, ctx) {
    if (!$("#bQ") || $("#bQ")._answered) return;
    var chosen = $("#bQ")._chosen || [];
    var ok = window.App.judgeQuestion(q, chosen);
    resolveQ(ok, q, ctx);
  }

  function afterSkill(r) {
    if (!r.ok) return;
    if (r.result === "win") { log("你以题代剑，命中 " + r.dmg + " 点——敌方倒下。", "good"); fx("line"); victory(); return; }
    if (r.result === "ult") { log("你以题代剑，命中 " + r.dmg + " 点——灵力见底！", "good"); fx("line"); openUlt(); return; }
    if (r.result === "lose") { defeat(); return; }
    if (r.result === "miss") {
      log("你答错了，被反击了一次。", "hurt");
      if (r.blocked) fx("shield"); else fx("miss");
      renderArena();
      return;
    }
    log("你以题代剑，命中 " + r.dmg + " 点。", "good");
    fx("line");
    renderArena();
    window.setTimeout(enemyRound, 600);
  }

  function enemyRound() {
    var r = core.enemyAct(st);
    if (!r.ok) return;
    if (r.result === "lose") { defeat(); return; }
    if (r.result === "trap") {
      log("敌方出招找茬——答对可免伤。", "hurt");
      fx("swoosh");
      renderArena();
      renderQuestion(st.current ? st.current.q : null, { enemy: true, meta: "敌方找茬 · 答对免伤" });
      return;
    }
    if (r.result === "attack") {
      if (st.hp.hero <= 0) { defeat(); return; }
      log("敌方攻击，你受 " + r.dmg + " 点伤。", "hurt");
      fx(r.blocked ? "shield" : "swoosh");
      renderArena();
    }
  }

  function afterTrap(r, correct) {
    if (!r.ok) return;
    if (r.result === "lose") { defeat(); return; }
    if (correct) {
      log("找茬破解，这一招免伤。", "good");
      fx("parry");
    }
    else log("找茬答错，反噬已生效。", "hurt");
    renderArena();
  }

  // ---------- 大招 ----------
  function openUlt() {
    renderArena();
    log("灵力见底——只能以代码完成最后一击。", "ult");
    var qz = $("#bQ");
    qz.innerHTML =
      '<div class="bq-meta ult">灵力见底 · 综合输入指令</div>' +
      '<div class="bq-text">' + esc(bt.ult.lead) + "</div>" +
      '<div class="battle-ult">' +
      '<textarea id="ultCode" spellcheck="false" placeholder="# 在这里写 Python 代码，然后点 ▶ 运行并终击"></textarea>' +
      '<div class="row">' +
      '<button class="btn primary" id="ultRun" type="button">▶ 运行并终击</button>' +
      '<button class="btn ghost" id="ultPasteBtn" type="button" hidden>离线？粘贴 PyCharm 运行结果</button>' +
      '<textarea id="ultPaste" class="out" hidden rows="2" placeholder="在此粘贴运行输出"></textarea>' +
      '<button class="btn ghost" id="ultPasteGo" type="button" hidden>提交粘贴结果</button>' +
      "</div>" +
      '<div class="bq-fb" id="ultFb" hidden></div>' +
      '<div class="bq-fb bad" id="ultHintBox" hidden></div>' +
      "</div>";
    $("#ultRun").addEventListener("click", runUlt);
    $("#ultPasteBtn").addEventListener("click", function () {
      $("#ultPaste").hidden = false;
      $("#ultPasteGo").hidden = false;
      $("#ultPasteBtn").hidden = true;
    });
    $("#ultPasteGo").addEventListener("click", function () {
      judgeUlt(norm($("#ultPaste").value));
    });
  }

  function runUlt() {
    var code = $("#ultCode").value;
    if (!code.trim()) return;
    var run = $("#ultRun");
    run.disabled = true;
    var old = run.textContent;
    run.textContent = "运行中…";
    window.App.runPython(code).then(function (res) {
      run.textContent = old;
      run.disabled = false;
      if (res.ok) {
        judgeUlt(norm(res.text));
      } else {
        $("#ultFb").hidden = false;
        $("#ultFb").className = "bq-fb bad";
        $("#ultFb").textContent = "浏览器运行库不可用（可能离线）——请在 PyCharm 里写好并运行后粘贴输出。";
        $("#ultPasteBtn").hidden = false;
      }
    });
  }

  function judgeUlt(outText) {
    var ok = norm(outText) === norm(bt.ult.expected);
    var fb = $("#ultFb");
    fb.hidden = false;
    if (ok) {
      fb.className = "bq-fb good";
      fb.textContent = "运行成功——最后一击落下！";
      taijiFX(function () { victory(); });
      return;
    } else {
      fb.className = "bq-fb bad";
      fb.textContent = "输出与预期不符，灵力反噬。再试一次。";
    }
    var r = core.resolveUlt(st, ok);
    if (r.ok && r.result === "win") {
      // 上面 ok 分支已走 taijiFX；此处兜底（一般不会触达）
      return;
    }
    if (r.ok && r.result === "lose") {
      window.setTimeout(defeat, 400);
      return;
    }
    // miss：保留大招界面，3 次后给 hint
    if (st.ult.misses >= 3) {
      var hint = $("#ultHintBox");
      hint.hidden = false;
      hint.textContent = "提示：" + bt.ult.hint;
    }
    renderHpOnly();
  }

  // 太极终击演出（Canvas 原生绘制，1.4s，reduced-motion 直接跳结局）
  function taijiFX(done) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      done();
      return;
    }
    var wrap = document.createElement("div");
    wrap.className = "taiji-wrap spin";
    wrap.innerHTML =
      '<canvas class="taiji-canvas" id="taijiFx" width="260" height="260"></canvas>' +
      '<div class="taiji-text">以柔克刚 · 终击</div>';
    var qz = $("#bQ");
    qz.innerHTML = "";
    qz.appendChild(wrap);
    var cv = qz.querySelector("#taijiFx");
    if (cv) drawTaiji(cv);
    window.setTimeout(function () {
      if (done) done();
    }, 1400);
  }

  function drawTaiji(cv) {
    var ctx = cv.getContext("2d");
    var s = 260;
    var cx = s / 2, cy = s / 2, r = s / 2 - 4;
    ctx.clearRect(0, 0, s, s);
    // 底圆：纸白
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#e9e1cc";
    ctx.fill();
    // 左半墨
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI / 2, Math.PI * 1.5);
    ctx.arc(cx, cy - r / 2, r / 2, Math.PI * 1.5, Math.PI / 2, true);
    ctx.arc(cx, cy + r / 2, r / 2, Math.PI / 2, Math.PI * 1.5, true);
    ctx.fillStyle = "#16130e";
    ctx.fill();
    // 两仪点
    ctx.beginPath();
    ctx.arc(cx, cy - r / 2, r * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = "#e9e1cc";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy + r / 2, r * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = "#16130e";
    ctx.fill();
    // 金圈
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#c8a44b";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function renderHpOnly() {
    var els = document.querySelectorAll("#battleRoot .b-hp i");
    if (els[0]) els[0].style.width = heroHpPct() + "%";
    if (els[1]) els[1].style.width = enemyHpPct() + "%";
    var nums = document.querySelectorAll("#battleRoot .b-hpnum");
    if (nums[0]) nums[0].textContent = st.hp.hero + " / " + st.cfg.heroHp;
    if (nums[1]) nums[1].textContent = st.hp.enemy + " / " + st.cfg.enemyHp;
  }

  // ---------- 结算 ----------
  function victory() {
    if (window.App.markRival) window.App.markRival(bt.enemy.id);
    var endText = bt.enemy.win + " 境界将破——";
    root.innerHTML =
      '<div class="battle-panel"><div class="battle-end">' +
      '<div class="end-seal">胜</div>' +
      '<div class="end-title">' + esc(bt.enemy.name + " · 败退") + "</div>" +
      '<p class="end-text">' + esc(endText) + "</p>" +
      '<button class="btn primary" id="bWinGo" type="button">迎接破境 ▸</button>' +
      "</div></div>";
    $("#bWinGo").addEventListener("click", function () {
      hideRoot();
      window.setTimeout(function () {
        if (window.App && typeof window.App.passLevel === "function") window.App.passLevel();
      }, 260);
    });
  }

  function defeat() {
    root.innerHTML =
      '<div class="battle-panel"><div class="battle-end">' +
      '<div class="end-seal" style="background:linear-gradient(150deg,#4a4034,#241d15)">败</div>' +
      '<div class="end-title">气血耗尽</div>' +
      '<p class="end-text">反派对决落败。重来一次，把刚才答错的题再打一遍。</p>' +
      '<button class="btn primary" id="bAgain" type="button">再战一场</button>' +
      '<button class="btn ghost" id="bRetreat2" type="button" style="margin-left:10px">撤退回章节入口</button>' +
      "</div></div>";
    $("#bAgain").addEventListener("click", function () {
      renderIntro();
      $("#bFight").addEventListener("click", startFight);
    });
    $("#bRetreat2").addEventListener("click", retreat);
  }

  function hideRoot() {
    if (root) root.hidden = true;
  }

  // ---------- 对外入口 ----------
  function ensureRoot() {
    if (root) return root;
    root = document.createElement("div");
    root.id = "battleRoot";
    root.hidden = true;
    document.body.appendChild(root);
    return root;
  }

  function openBattle(btl) {
    if (!btl || !core || !BAL || !SPR) return;
    bt = btl;
    levelIdx = Math.max(0, levelIndex(btl.levelId));
    petAssist = pickAssist();
    defeatedBefore = !!(window.App.isRival && window.App.isRival(btl.enemy.id));
    ensureRoot();
    root.hidden = false;
    usedTrap = {};
    st = null;
    renderIntro();
    // 敌我像素用第一帧静态展示
    window.setTimeout(function () {
      if (fightStarted) return;
      if ($("#pxHero")) paintPixels("hero");
      if ($("#pxEnemy")) paintPixels("enemy");
    }, 60);
  }

  function levelIndex(id) {
    for (var i = 0; i < D.levels.length; i++) {
      if (D.levels[i].id === id) return i;
    }
    return 0;
  }

  window.App = window.App || {};
  window.App.openBattle = openBattle;

  // idle 呼吸帧循环（仅渲染层；reduced-motion 不启用）
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.setInterval(function () {
      animTick++;
      if (!root || root.hidden || !st) return;
      if ($("#pxHero")) paintPixels("hero");
      if ($("#pxEnemy")) paintPixels("enemy");
    }, 420);
  }
})();
