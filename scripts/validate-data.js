// ============================================================
// 数据校验脚本（第一卷 · 仓绝大陆）
// 运行方式一（Node，完整校验，含图片文件存在性）：
//     node scripts/validate-data.js
// 运行方式二（浏览器）：页面加载后把本文件整体粘贴到 DevTools Console。
//     浏览器无法同步访问文件系统，art.src 存在性检查会输出 SKIP，
//     其余检查结果一致；完整校验请用 Node 运行。
// 检查项：
//   levels id 唯一；quest 内 {q:n} 不越界；每题 options>=2 且 answer 在界内
//   （补全题校验 slots 候选数与 answer 索引）；code 字段无 </pre> 注入；
//   art.src 文件存在；quizExtra / fillQuestions 同规则；achievements cond 引用合法。
// ============================================================
(function () {
  "use strict";

  var isNode =
    typeof module !== "undefined" &&
    typeof module.exports !== "undefined" &&
    typeof require === "function";

  var D = null;
  var ROOT = null;
  var canCheckFile = false;

  var PASS = [];
  var FAIL = [];
  var SKIP = [];

  function ok(loc, msg) {
    PASS.push("[PASS] " + loc + "　" + msg);
  }
  function bad(loc, msg) {
    FAIL.push("[FAIL] " + loc + "　" + msg);
  }
  function skip(loc, msg) {
    SKIP.push("[SKIP] " + loc + "　" + msg);
  }

  function isInt(n) {
    return typeof n === "number" && isFinite(n) && Math.floor(n) === n;
  }

  // ---------- 载入数据 ----------
  function loadData() {
    if (isNode) {
      try {
        var fs = require("fs");
        var vm = require("vm");
        var path = require("path");
        ROOT = path.resolve(__dirname, "..");
        var src = fs.readFileSync(path.join(ROOT, "js", "data.js"), "utf8");
        var sandbox = { window: {} };
        vm.createContext(sandbox);
        vm.runInContext(src, sandbox, { filename: "js/data.js" });
        D = sandbox.window.GAME_DATA;
        canCheckFile = true;
        return true;
      } catch (e) {
        bad("data.js", "Node 载入失败：" + e.message);
        return false;
      }
    }
    if (typeof window !== "undefined" && window.GAME_DATA) {
      D = window.GAME_DATA;
      canCheckFile = false;
      return true;
    }
    bad("GAME_DATA", "未找到 window.GAME_DATA。请先在页面加载后运行本脚本。");
    return false;
  }

  // ---------- 通用规则 ----------
  function validateCodeField(code, loc) {
    if (code === undefined || code === null || code === "") {
      ok(loc, "无 code 字段，跳过注入检查");
      return;
    }
    if (typeof code !== "string") {
      bad(loc, "code 字段应为字符串");
      return;
    }
    if (/<\/pre/i.test(code)) {
      bad(loc, "code 含 </pre>，存在 HTML 注入风险");
    } else {
      ok(loc, "code 无 </pre> 注入风险");
    }
  }

  function validateQuestion(q, loc) {
    if (!q || typeof q !== "object") {
      bad(loc, "题目项不是对象");
      return;
    }
    validateCodeField(q.code, loc + ".code");
    if (q.kind === "fill") {
      var slots = q.slots;
      var ans = q.answer;
      if (!Array.isArray(slots) || !slots.length) {
        bad(loc, "补全题缺少 slots（候选片段列表）");
        return;
      }
      slots.forEach(function (cands, si) {
        if (!Array.isArray(cands) || cands.length < 2) {
          bad(loc + ".slots[" + si + "]", "候选片段应 >=2，当前 " + (cands && cands.length));
        } else {
          ok(loc + ".slots[" + si + "]", "候选片段 " + cands.length + " 项（>=2）");
        }
      });
      if (!Array.isArray(ans)) {
        bad(loc + ".answer", "补全题 answer 应为索引数组");
        return;
      }
      if (ans.length !== slots.length) {
        bad(
          loc + ".answer",
          "answer 长度 " + ans.length + "，slots 数量 " + slots.length + "，不一致"
        );
        return;
      }
      ans.forEach(function (a, ai) {
        var len = slots[ai] && slots[ai].length;
        if (isInt(a) && a >= 0 && a < len) {
          ok(loc + ".answer[" + ai + "]", "=" + a + " 在候选范围内（0.." + (len - 1) + "）");
        } else {
          bad(loc + ".answer[" + ai + "]", "=" + a + " 越界（候选 " + len + " 项）");
        }
      });
      return;
    }
    var options = q.options;
    if (!Array.isArray(options) || options.length < 2) {
      bad(loc + ".options", "应 >=2，当前 " + (options && options.length));
    } else {
      ok(loc + ".options", options.length + " 项（>=2）");
    }
    var answer = q.answer;
    if (isInt(answer) && Array.isArray(options) && answer >= 0 && answer < options.length) {
      ok(loc + ".answer", "=" + answer + " 在界内（0.." + (options.length - 1) + "）");
    } else {
      bad(loc + ".answer", "=" + answer + " 越界或非整数（options " + (options && options.length) + " 项）");
    }
  }

  function validateQuestionPool(lv, fieldName, levelId) {
    var pool = lv[fieldName];
    if (!pool) {
      ok(levelId + "." + fieldName, "未定义该字段，跳过");
      return;
    }
    if (!Array.isArray(pool)) {
      bad(levelId + "." + fieldName, "应为数组");
      return;
    }
    pool.forEach(function (q, qi) {
      validateQuestion(q, levelId + "." + fieldName + "[" + qi + "]");
    });
  }

  function validateArt(src, loc) {
    if (!src) {
      skip(loc, "art.src 为空");
      return;
    }
    if (typeof src !== "string") {
      bad(loc, "art.src 应为字符串");
      return;
    }
    if (!canCheckFile) {
      skip(loc, "浏览器无法同步查文件，Node 下复核：" + src);
      return;
    }
    try {
      var path = require("path");
      var fs = require("fs");
      var full = path.resolve(ROOT, src);
      if (fs.existsSync(full)) {
        ok(loc, "文件存在：" + src);
      } else {
        bad(loc, "文件不存在：" + full);
      }
    } catch (e) {
      bad(loc, "文件检查异常：" + e.message);
    }
  }

  function validateAchievements(levelIds) {
    if (D.achievements === undefined) {
      ok("achievements", "GAME_DATA 中未定义（MVP 暂缓），引用检查通过");
      return;
    }
    if (!Array.isArray(D.achievements)) {
      bad("achievements", "应为数组");
      return;
    }
    D.achievements.forEach(function (a, i) {
      var loc = "achievements[" + i + "]";
      if (!a || typeof a !== "object" || !a.cond || typeof a.cond !== "object") {
        bad(loc + ".cond", "缺少 cond 对象");
        return;
      }
      var cond = a.cond;
      var refs = [];
      if (cond.levelId !== undefined) refs.push({ v: cond.levelId, k: "levelId" });
      if (cond.type === "level" || cond.type === "levels") {
        if (cond.id !== undefined) refs.push({ v: cond.id, k: "id" });
      }
      if (!refs.length) {
        ok(loc + ".cond", "无关卡引用（如 boss/成就计数类条件）");
        return;
      }
      refs.forEach(function (r) {
        if (levelIds.indexOf(r.v) !== -1) {
          ok(loc + ".cond." + r.k, "引用关卡 " + r.v + " 存在");
        } else {
          bad(loc + ".cond." + r.k, "引用关卡 " + r.v + " 不存在");
        }
      });
    });
  }

  // ---------- i2-3：灵宠 / 分阶题库 / 灵器 校验 ----------
  function validateBagData(levelIds) {
    var pets = D.pets;
    if (!pets || !Array.isArray(pets) || !pets.length) {
      bad("pets", "GAME_DATA.pets 缺失或为空");
    } else {
      ok("pets", pets.length + " 只灵宠");
      var seenPet = {};
      var petIds = [];
      pets.forEach(function (p, i) {
        var loc = "pets[" + i + "]";
        if (!p || typeof p !== "object" || typeof p.id !== "string" || !p.id) {
          bad(loc, "缺少字符串 id");
          return;
        }
        if (seenPet[p.id]) {
          bad(loc + ".id", "id 重复：" + p.id);
        } else {
          seenPet[p.id] = true;
          petIds.push(p.id);
        }
        ok(loc + ".id", p.id);
        if (!p.name || typeof p.name !== "string") bad(loc + ".name", "缺少名称");
        if (!p.topic || typeof p.topic !== "string") bad(loc + ".topic", "缺少语法主题");
        if (typeof p.glyph !== "string" || p.glyph.length !== 1) {
          bad(loc + ".glyph", "glyph 应为单字（当前 " + p.glyph + "）");
        } else {
          ok(loc + ".glyph", "单字印章：" + p.glyph);
        }
        if (typeof p.hue !== "string" || !/^#[0-9a-fA-F]{6}$/.test(p.hue)) {
          bad(loc + ".hue", "hue 应为 #rrggbb 颜色");
        }
        if (!Array.isArray(p.stages) || p.stages.length !== 3) {
          bad(loc + ".stages", "stages 长度应为 3");
        } else {
          ok(loc + ".stages", p.stages.join(" → "));
        }
        if (typeof p.icon !== "string" || p.icon.indexOf("<svg") === -1 || p.icon.indexOf("</svg>") === -1) {
          bad(loc + ".icon", "icon 应为内联 SVG 字符串");
        } else {
          ok(loc + ".icon", "内联 SVG 合法");
        }
        if (levelIds.indexOf(p.get) === -1) {
          bad(loc + ".get", "get 引用的关卡 " + p.get + " 不存在");
        } else {
          ok(loc + ".get", "绑定关卡 " + p.get);
        }
      });

      // petQuests：覆盖全部宠物、三组每组 >=4、schema 合法、不与主线/彼此重复
      var pq = D.petQuests;
      if (!pq || typeof pq !== "object") {
        bad("petQuests", "GAME_DATA.petQuests 缺失");
      } else {
        var usedText = {};
        function qSig(q) {
          if (!q || typeof q.q !== "string") return "";
          var extra = q.code || "";
          if (q.kind === "fill") {
            extra += (q.slots || []).map(function (c) {
              return (c || []).join(";");
            }).join("|");
          } else {
            extra += (q.options || []).join(";");
          }
          return q.q + "｜" + extra;
        }
        function collectTexts(lv, poolName) {
          (lv[poolName] || []).forEach(function (q) {
            var sig = qSig(q);
            if (sig) usedText[sig] = (usedText[sig] || 0) + 1;
          });
        }
        D.levels.forEach(function (lv) {
          collectTexts(lv, "questions");
          collectTexts(lv, "quizExtra");
          collectTexts(lv, "fillQuestions");
        });
        petIds.forEach(function (pid) {
          if (!pq[pid]) {
            bad("petQuests." + pid, "缺少该宠题库");
            return;
          }
          if (!Array.isArray(pq[pid]) || pq[pid].length !== 3) {
            bad("petQuests." + pid, "应包含 [入门, 进阶, 登峰] 三组");
            return;
          }
          var groupNames = ["入门", "进阶", "登峰"];
          pq[pid].forEach(function (group, gi) {
            var gLoc = "petQuests." + pid + "[" + gi + "]" + "(" + groupNames[gi] + ")";
            if (!Array.isArray(group) || group.length < 4) {
              bad(gLoc, "每组应 >=4 题，当前 " + (group && group.length));
            } else {
              ok(gLoc, group.length + " 题（>=4）");
            }
            (group || []).forEach(function (q, qi) {
              var qLoc = gLoc + "[" + qi + "]";
              validateQuestion(q, qLoc);
              var sig = qSig(q);
              if (sig) usedText[sig] = (usedText[sig] || 0) + 1;
            });
          });
        });
        var dupTexts = Object.keys(usedText).filter(function (t) {
          return usedText[t] > 1;
        });
        if (dupTexts.length) {
          bad(
            "petQuests",
            "题目与主线题重复：" + dupTexts.slice(0, 5).join(" ｜ ")
          );
        } else {
          ok("petQuests", "题目与主线题无重复");
        }
        var totalQ = 0;
        Object.keys(pq).forEach(function (pid) {
          (pq[pid] || []).forEach(function (g) {
            totalQ += (g || []).length;
          });
        });
        ok("petQuests", "题库总量 " + totalQ + " 题");
      }
    }
  }

  // ---------- i2-3：灵器校验（独立于宠题库，避免一处缺漏连带跳过） ----------
  function validateArtifacts(levelIds) {
    var arts = D.artifacts;
    if (!arts || !Array.isArray(arts) || !arts.length) {
      bad("artifacts", "GAME_DATA.artifacts 缺失或为空");
      return;
    }
    ok("artifacts", arts.length + " 件灵器");
    var seenArt = {};
    arts.forEach(function (a, i) {
      var loc = "artifacts[" + i + "]";
      if (!a || typeof a !== "object" || typeof a.id !== "string" || !a.id) {
        bad(loc, "缺少字符串 id");
        return;
      }
      if (seenArt[a.id]) {
        bad(loc + ".id", "id 重复：" + a.id);
      } else {
        seenArt[a.id] = true;
        ok(loc + ".id", a.id);
      }
      if (!a.name || typeof a.name !== "string") bad(loc + ".name", "缺少名称");
      if (typeof a.glyph !== "string" || a.glyph.length !== 1) {
        bad(loc + ".glyph", "glyph 应为单字");
      }
      if (typeof a.icon !== "string" || a.icon.indexOf("<svg") === -1 || a.icon.indexOf("</svg>") === -1) {
        bad(loc + ".icon", "icon 应为内联 SVG 字符串");
      } else {
        ok(loc + ".icon", "内联 SVG 合法");
      }
      if (levelIds.indexOf(a.from) === -1) {
        bad(loc + ".from", "from 引用的关卡 " + a.from + " 不存在");
      } else {
        ok(loc + ".from", "来源关卡 " + a.from);
      }
    });
  }

  // ---------- 主流程 ----------
  if (!loadData()) {
    printSummary();
    return;
  }

  if (!D || !Array.isArray(D.levels) || !D.levels.length) {
    bad("levels", "缺失或为空数组");
    printSummary();
    return;
  }

  var levelIds = D.levels.map(function (lv) {
    return lv.id;
  });
  var seen = {};
  var dupIds = [];
  D.levels.forEach(function (lv, i) {
    var id = lv && lv.id;
    if (!id || typeof id !== "string") {
      bad("levels[" + i + "]", "缺少字符串 id");
    } else if (seen[id]) {
      dupIds.push(id);
    } else {
      seen[id] = true;
    }
  });
  if (dupIds.length) {
    bad("levels", "id 重复：" + dupIds.join("、"));
  } else {
    ok("levels", D.levels.length + " 关，id 唯一");
  }

  D.levels.forEach(function (lv, i) {
    var id = lv && lv.id ? lv.id : "levels[" + i + "]";
    var questions = lv.questions;

    // quest 内 {q:n} 索引
    if (Array.isArray(lv.quest)) {
      lv.quest.forEach(function (it, k) {
        if (!it || typeof it !== "object" || it.q === undefined) {
          ok(id + ".quest[" + k + "]", "剧情项（无题目索引）");
          return;
        }
        var qi = it.q;
        var len = Array.isArray(questions) ? questions.length : 0;
        if (isInt(qi) && qi >= 0 && qi < len) {
          ok(id + ".quest[" + k + "].q", "=" + qi + " 指向 questions[" + qi + "]，合法");
        } else {
          bad(id + ".quest[" + k + "].q", "=" + qi + " 越界（questions " + len + " 道）");
        }
      });
    } else if (lv.kind !== "boss") {
      ok(id + ".quest", "无 quest 字段");
    }

    if (Array.isArray(questions)) {
      questions.forEach(function (q, qi) {
        validateQuestion(q, id + ".questions[" + qi + "]");
      });
    }
    validateQuestionPool(lv, "quizExtra", id);
    validateQuestionPool(lv, "fillQuestions", id);

    // 讲解示例 / Boss 法诀代码
    if (lv.lesson && lv.lesson.example) {
      validateCodeField(lv.lesson.example.code, id + ".lesson.example.code");
    }
    if (lv.task && lv.task.code !== undefined) {
      validateCodeField(lv.task.code, id + ".task.code");
    }

    // 剧情插图文件
    if (Array.isArray(lv.story)) {
      lv.story.forEach(function (s, si) {
        if (s && s.art && s.art.src) {
          validateArt(s.art.src, id + ".story[" + si + "].art.src");
        }
      });
    }
  });

  validateAchievements(levelIds);
  validateBagData(levelIds);
  validateArtifacts(levelIds);

  printSummary();

  function printSummary() {
    PASS.forEach(function (line) {
      console.log(line);
    });
    FAIL.forEach(function (line) {
      console.log(line);
    });
    SKIP.forEach(function (line) {
      console.log(line);
    });
    var summary =
      "[SUMMARY] PASS " +
      PASS.length +
      " / FAIL " +
      FAIL.length +
      " / SKIP " +
      SKIP.length;
    console.log(summary);
    if (isNode && FAIL.length) {
      try {
        process.exitCode = 1;
      } catch (e) {
        // 非 Node 环境忽略
      }
    }
  }
})();
