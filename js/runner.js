// ============================================================
// 浏览器内运行 Python（渐进增强，js/runner.js）
//  - 讲解页示例代码块、选择题带 code 的题目、Boss 残缺法诀，
//    凡不含 input() 的代码块自动追加「▶ 运行」；
//  - Skulpt 采用懒加载（首次点击运行时才注入 CDN 脚本）；
//  - CDN 加载失败或离线：隐藏运行按钮并提示“请在 PyCharm 中运行”，
//    静默降级，绝不干扰主流程；
//  - Boss 关提供「把运行结果填入下方答案框」：填入前按游戏判定同款
//    norm 规则清洗（优先复用 App.normOutput）。
//  - 所有动态文本一律用 textContent 写入，杜绝注入。
// ============================================================
(function () {
  "use strict";

  // Skulpt 1.2.0（Python3，浏览器产物）；主备两条 jsDelivr 路径
  var SK_SOURCES = [
    {
      lib: "https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js",
      std: "https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js"
    },
    {
      lib: "https://cdn.jsdelivr.net/gh/skulpt/skulpt-dist@1.2.0/skulpt.min.js",
      std: "https://cdn.jsdelivr.net/gh/skulpt/skulpt-dist@1.2.0/skulpt-stdlib.js"
    }
  ];

  var OFFLINE_HINT =
    "当前离线，浏览器内运行不可用——请在 PyCharm 中运行。";
  var LOADFAIL_HINT =
    "代码运行库加载失败（可能离线）——请在 PyCharm 中运行。";

  var stageBox = document.getElementById("stageBox");
  var offlineKnown = typeof navigator !== "undefined" && navigator.onLine === false;
  var loadFailed = false;
  var loadState = "idle"; // idle | loading | ready | fail
  var loadPromise = null;
  var scanQueued = false;
  var lastRunText = ""; // Boss 关最近一次成功运行的 stdout

  // ---------- 输出清洗：与 game.js 的 norm() 语义一致 ----------
  function normClean(s) {
    if (window.App && typeof window.App.normOutput === "function") {
      try {
        return window.App.normOutput(s);
      } catch (e) {
        // 回退到本地实现
      }
    }
    return String(s || "")
      .replace(/\r/g, "")
      .split("\n")
      .map(function (line) {
        return line.trim();
      })
      .join("\n")
      .trim();
  }

  // ---------- Skulpt 懒加载 ----------
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.crossOrigin = "anonymous";
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        if (s.parentNode) s.parentNode.removeChild(s);
        reject(new Error("skulpt load failed: " + src));
      };
      document.head.appendChild(s);
    });
  }

  function trySource(i) {
    if (i >= SK_SOURCES.length) {
      return Promise.reject(new Error("all skulpt sources failed"));
    }
    var src = SK_SOURCES[i];
    return loadScript(src.lib)
      .then(function () {
        if (!window.Sk) {
          return Promise.reject(new Error("Sk undefined after lib load"));
        }
        return loadScript(src.std);
      })
      .catch(function () {
        return trySource(i + 1);
      });
  }

  function ensureSkulpt() {
    if (loadState === "ready") return Promise.resolve();
    if (loadState === "fail") return Promise.reject(new Error("skulpt unavailable"));
    if (loadPromise) return loadPromise;
    loadState = "loading";
    loadPromise = trySource(0)
      .then(function () {
        loadState = "ready";
        return true;
      })
      .catch(function () {
        loadState = "fail";
        loadFailed = true;
        degradeAll();
        return Promise.reject(new Error("skulpt unavailable"));
      });
    return loadPromise;
  }

  // ---------- 降级 ----------
  function hintEl(msg) {
    var p = document.createElement("p");
    p.className = "code-run-note";
    p.textContent = msg;
    return p;
  }

  function degradeAll() {
    if (!stageBox) return;
    stageBox.querySelectorAll(".code-run-zone").forEach(function (zone) {
      degradeZone(zone, LOADFAIL_HINT);
    });
  }

  function degradeZone(zone, msg) {
    var row = zone.querySelector(".code-run-row");
    if (row) row.style.display = "none";
    if (!zone.querySelector(".code-run-note")) {
      zone.appendChild(hintEl(msg));
    }
  }

  // ---------- 扫描舞台：为代码块追加运行区 ----------
  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(doScan);
    } else {
      window.setTimeout(doScan, 0);
    }
  }

  function doScan() {
    scanQueued = false;
    if (!stageBox) return;
    stageBox.querySelectorAll("pre.code-block").forEach(setupBlock);
  }

  function setupBlock(pre) {
    if (pre.dataset.runnerHandled) return;
    pre.dataset.runnerHandled = "1";
    if (pre.classList.contains("fill-code")) return; // 补全题占位符不可原样运行
    var code = pre.textContent || "";
    if (/\binput\s*\(/.test(code)) return; // 含 input() 的示例不提供运行按钮

    var zone = document.createElement("div");
    zone.className = "code-run-zone";

    // 离线（navigator 报告离线或此前已加载失败）：只提示，不出现按钮
    if (offlineKnown || loadFailed) {
      zone.appendChild(hintEl(offlineKnown ? OFFLINE_HINT : LOADFAIL_HINT));
      pre.insertAdjacentElement("afterend", zone);
      return;
    }

    var isBoss = !!stageBox.querySelector("#bossAns");
    var row = document.createElement("div");
    row.className = "code-run-row";

    var runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.className = "btn ghost small code-run-btn";
    runBtn.textContent = "▶ 运行";
    runBtn.setAttribute("aria-label", "在浏览器中运行这段 Python 代码");
    row.appendChild(runBtn);

    var fillBtn = null;
    if (isBoss) {
      fillBtn = document.createElement("button");
      fillBtn.type = "button";
      fillBtn.className = "btn ghost small";
      fillBtn.textContent = "把运行结果填入下方答案框";
      fillBtn.disabled = true;
      fillBtn.title = "先点「▶ 运行」，运行成功后此按钮可用";
      row.appendChild(fillBtn);
    }

    var outWrap = document.createElement("div");
    outWrap.className = "out-wrap code-run-out";
    outWrap.hidden = true;
    var outLabel = document.createElement("div");
    outLabel.className = "out-label";
    outLabel.textContent = "运行结果";
    var outPre = document.createElement("pre");
    outPre.className = "out-block";
    outWrap.appendChild(outLabel);
    outWrap.appendChild(outPre);

    zone.appendChild(row);
    zone.appendChild(outWrap);
    pre.insertAdjacentElement("afterend", zone);

    // 讲解页原本下方有静态“运行结果（预期输出）”：改名防止与本次实际输出混淆
    var wrap = pre.closest(".code-wrap");
    if (wrap) {
      var next = wrap.nextElementSibling;
      if (next && next.classList.contains("out-wrap")) {
        var staticLabel = next.querySelector(".out-label");
        if (staticLabel) staticLabel.textContent = "预期输出（参考答案）";
      }
    }

    runBtn.addEventListener("click", function () {
      runBlock(pre, outWrap, outPre, runBtn, fillBtn);
    });
    if (fillBtn) {
      fillBtn.addEventListener("click", function () {
        fillBossAnswer(fillBtn);
      });
    }
  }

  // ---------- 执行 ----------
  function builtinRead(x) {
    if (
      window.Sk &&
      Sk.builtinFiles !== undefined &&
      Sk.builtinFiles.files !== undefined &&
      Sk.builtinFiles.files[x] !== undefined
    ) {
      return Sk.builtinFiles.files[x];
    }
    throw new Error("File not found: " + x);
  }

  function runBlock(pre, outWrap, outPre, runBtn, fillBtn) {
    if (!outPre) return;
    runBtn.disabled = true;
    runBtn.classList.add("is-running");
    var oldLabel = runBtn.textContent;
    runBtn.textContent = "加载运行库…";

    ensureSkulpt()
      .then(function () {
        runBtn.textContent = "运行中…";
        return executeCode(pre.textContent || "");
      })
      .then(function (res) {
        outWrap.hidden = false;
        outPre.textContent = res.text === "" ? "（无输出）" : res.text;
        lastRunText = res.ok ? res.text : "";
        if (fillBtn) {
          fillBtn.disabled = !res.ok || res.text === "";
          fillBtn.title = fillBtn.disabled
            ? "运行成功后此按钮才会启用"
            : "按游戏判定规则清洗后填入答案框";
        }
      })
      .catch(function () {
        if (loadFailed) {
          // 静默降级：按钮隐藏 + 提示，不抛错
          degradeZone(outWrap.parentNode, LOADFAIL_HINT);
          return;
        }
        outWrap.hidden = false;
        outPre.textContent = "运行出错：请确认代码可运行后重试，或在 PyCharm 中运行。";
      })
      .then(function () {
        runBtn.textContent = oldLabel;
        runBtn.disabled = false;
        runBtn.classList.remove("is-running");
      });
  }

  function executeCode(code) {
    var chunks = [];
    function outf(text) {
      chunks.push(String(text));
    }
    try {
      Sk.configure({
        output: outf,
        read: builtinRead
      });
    } catch (e) {
      return Promise.resolve({
        ok: false,
        text: "Skulpt 初始化失败：" + e.message
      });
    }
    var job;
    try {
      job = Sk.misceval.asyncToPromise(function () {
        return Sk.importMainWithBody("<stdin>", false, code, true);
      });
    } catch (e) {
      return Promise.resolve({
        ok: false,
        text: chunks.join("") || String(e)
      });
    }
    return job.then(
      function () {
        return { ok: true, text: chunks.join("") };
      },
      function (err) {
        var msg = "";
        try {
          msg = String((err && err.traceback) || err);
        } catch (e2) {
          msg = "Python 运行出错";
        }
        if (chunks.join("").indexOf(msg) === -1) {
          chunks.push("\n" + msg);
        }
        return { ok: false, text: chunks.join("") || msg };
      }
    );
  }

  // ---------- Boss：一键填入（先 norm 清洗） ----------
  function fillBossAnswer(btn) {
    var ta = document.getElementById("bossAns");
    if (!ta || !lastRunText) return;
    ta.value = normClean(lastRunText);
    var old = btn.textContent;
    btn.textContent = "已填入（可再运行重填）";
    window.setTimeout(function () {
      btn.textContent = old;
    }, 1600);
  }

  // ---------- 启动：监听舞台重绘，每次渲染后扫描 ----------
  if (stageBox && window.MutationObserver) {
    new MutationObserver(scheduleScan).observe(stageBox, {
      childList: true,
      subtree: true
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleScan);
  } else {
    scheduleScan();
  }
})();
