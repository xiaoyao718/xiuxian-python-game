// ============================================================
// 场景动态化 · 程序化粒子层（i2-1 / S1）
//  - 全屏 Canvas 2D（fixed、pointer-events:none），按 data-scene 切换粒子配方；
//  - 桌面 / 移动端粒子数量分级；DPR 适配；document.hidden 自动暂停；
//  - prefers-reduced-motion 与 v2 存档 settings.fx=false 时完全不创建循环；
//  - 点击墨色涟漪（#ripples，节流 300ms，仅桌面鼠标）；
//  - 分层视差数据源：把指针 --px/--py 与滚动 --scy 写到 <html>，
//    CSS 层按 远山 0.6 / 云海 0.8 / 近景 1.2 / 滚动 0.3 系数取用。
// 依赖：index.html 已含 <canvas id="fxParticles"> 与 #ripples 容器，
//       脚本按 data→game→sound→runner→fx 顺序加载。
// ============================================================
(function () {
  "use strict";

  var canvas = document.getElementById("fxParticles");
  var reducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer =
    !reducedMotion && window.matchMedia && window.matchMedia("(pointer: fine)").matches;
  var coarse =
    window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  var smallScreen = window.innerWidth < 768;
  var mobileMode = coarse || smallScreen;
  var fxEnabled = true;

  // v2 存档 settings.fx 全局开关（缺省开启；无 UI 时仅作降级用）
  try {
    var raw = localStorage.getItem("xiuxian-python-game-v2");
    if (raw) {
      var p = JSON.parse(raw);
      if (p && p.settings && p.settings.fx === false) fxEnabled = false;
    }
  } catch (e) {
    // 存档不可读时按默认开启
  }

  // ---------- 基础工具 ----------
  function currentScene() {
    var v = document.documentElement.getAttribute("data-scene");
    var n = Number(v);
    return isFinite(n) && n >= 0 ? n : -1;
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ---------- Canvas 尺寸与上下文 ----------
  var ctx = null;
  var W = 0;
  var H = 0;
  var DPR = 1;

  function resize() {
    if (!canvas) return;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    if (ctx) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
  }

  if (canvas) {
    ctx = canvas.getContext("2d");
  }

  // ---------- 粒子配方 ----------
  // 每种场景返回“粒子生成器”，每一帧按需补足粒子数并让粒子自更新。
  // 视觉原则：低饱和、克制、淡入淡出，宁缺毋滥。
  var recipes = {
    // 封面：灵尘增强（金屑缓缓上浮，数量最多）
    0: function (i) {
      return makeMote(i, true);
    },
    // scene1 纹谱阁深夜：油灯尘埃——金色微粒极缓慢漂移
    1: function (i) {
      return makeMote(i, false);
    },
    // scene2 灵兽苑清晨：晨雾光尘 + 上浮灵气泡
    2: function (i) {
      if (i % 3 === 0) return makeBubble(i);
      return makeMote(i, true);
    },
    // scene3 测纹处日暮：3-5 只流萤（明灭 + 曲线游动）
    3: function (i) {
      return makeFirefly(i);
    },
    // scene4 分纹台正午：烈日浮尘（更亮更慢）
    4: function (i) {
      return makeMote(i, true, 0.035, "#ffe6b0");
    },
    // scene5 夜枭谷月夜：枯叶缓落
    5: function (i) {
      return makeLeaf(i);
    },
    // scene6 渡劫：风卷残尘（雨丝仍由 CSS 负责）
    6: function (i) {
      return makeEmber(i);
    }
  };

  var caps = {
    0: mobileMode ? 50 : 140,
    1: mobileMode ? 16 : 40,
    2: mobileMode ? 30 : 80,
    3: mobileMode ? 3 : 5,
    4: mobileMode ? 20 : 60,
    5: mobileMode ? 8 : 20,
    6: mobileMode ? 15 : 40
  };

  var particles = [];
  var sceneNow = -1;
  var lastT = 0;
  var raf = 0;
  var hiddenPaused = false;

  // ---- 各类粒子构造 ----
  function makeMote(i, brighter, speed, color) {
    var base = color || (brighter ? "#ffe1a0" : "#d8b46a");
    return {
      kind: "mote",
      x: rand(0, W),
      y: rand(0, H),
      r: rand(0.7, brighter ? 2.0 : 1.4),
      vx: rand(-0.06, 0.06),
      vy: rand(-0.22, -0.05) * (speed || 1),
      swayA: rand(6, 26),
      swayHz: rand(0.02, 0.08),
      ph: rand(0, Math.PI * 2),
      a: 0,
      target: rand(0.16, brighter ? 0.5 : 0.34),
      color: base,
      fade: rand(0.008, 0.03)
    };
  }

  function makeBubble(i) {
    return {
      kind: "bubble",
      x: rand(0, W),
      y: rand(0, H),
      r: rand(1.2, 2.6),
      vy: rand(-0.55, -0.2),
      vx: rand(-0.08, 0.08),
      a: 0,
      target: rand(0.12, 0.3),
      color: "#9fd8cb",
      fade: 0.01
    };
  }

  function makeFirefly(i) {
    var side = i % 2 === 0 ? 1 : -1;
    return {
      kind: "firefly",
      x: rand(W * 0.15, W * 0.85),
      y: rand(H * 0.2, H * 0.75),
      baseX: 0,
      baseY: 0,
      side: side,
      t: rand(0, 60),
      speed: rand(0.012, 0.03),
      ampX: rand(30, 80),
      ampY: rand(16, 40),
      r: rand(1.1, 1.6),
      a: 0,
      color: "#ffe6a8",
      fade: 0.012
    };
  }

  function makeLeaf(i) {
    return {
      kind: "leaf",
      x: rand(0, W),
      y: rand(-40, H),
      w: rand(4, 7),
      h: rand(7, 11),
      vy: rand(0.22, 0.45),
      swayA: rand(10, 30),
      swayHz: rand(0.5, 1.1),
      rot: rand(0, Math.PI * 2),
      vr: rand(-0.015, 0.015),
      ph: rand(0, Math.PI * 2),
      a: 0,
      target: rand(0.22, 0.4),
      color: pick(["#c89a64", "#a9794a", "#d3b082", "#8a6a45"]),
      fade: 0.008
    };
  }

  function makeEmber(i) {
    return {
      kind: "ember",
      x: rand(0, W),
      y: rand(H * 0.3, H),
      r: rand(0.8, 1.8),
      vx: rand(-0.7, -0.1),
      vy: rand(-1.4, -0.35),
      swayA: rand(8, 30),
      swayHz: rand(0.1, 0.3),
      ph: rand(0, Math.PI * 2),
      life: rand(160, 380),
      a: 0,
      target: rand(0.2, 0.45),
      color: "#e6b98a",
      fade: 0.02
    };
  }

  function rebuild(nowScene) {
    sceneNow = nowScene;
    particles = [];
    if (sceneNow < 0) return;
    var gen = recipes[sceneNow];
    var cap = caps[sceneNow] || 0;
    if (!gen || !cap) return;
    // 流萤数量固定在 3-5（按场景上限，不随窗口重排暴涨）
    var count = sceneNow === 3 ? Math.min(5, cap) : cap;
    for (var i = 0; i < count; i++) {
      particles.push(gen(i));
    }
    if (sceneNow === 3) {
      // 流萤从各自中心附近出发，曲线游动
      particles.forEach(function (p) {
        p.baseX = p.x;
        p.baseY = p.y;
      });
    }
  }

  // ---------- 更新与绘制 ----------
  function alphaStep(p, dt) {
    if (p.a < p.target) p.a = Math.min(p.target, p.a + p.fade * dt * 60);
  }

  function updateMote(p, dt) {
    p.ph += p.swayHz * dt;
    p.x += (p.vx + Math.cos(p.ph) * 0.02) * dt;
    p.y += p.vy * dt;
    alphaStep(p, dt);
    if (p.y < -20 || p.x < -30 || p.x > W + 30) {
      p.x = rand(0, W);
      p.y = H + rand(4, 30);
      p.a = 0;
    }
  }

  function updateBubble(p, dt) {
    p.x += (p.vx + Math.sin(p.ph || 0) * 0.06) * dt;
    p.y += p.vy * dt;
    alphaStep(p, dt);
    if (p.y < -20) {
      p.x = rand(0, W);
      p.y = H + rand(2, 20);
      p.a = 0;
    }
  }

  function updateFirefly(p, dt) {
    p.t += p.speed * dt;
    var tx = p.baseX + Math.sin(p.t * 0.7) * p.ampX * 0.5;
    var ty = p.baseY + Math.sin(p.t * 0.35 + 1.7) * p.ampY;
    p.x += (tx - p.x) * 0.02 * dt;
    p.y += (ty - p.y) * 0.02 * dt;
    // 明灭呼吸：亮度按时间波浪
    p.pulse = 0.55 + 0.45 * Math.sin(p.t * 0.9 + p.ph);
    alphaStep(p, dt);
    if (p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) {
      p.baseX = rand(W * 0.1, W * 0.9);
      p.baseY = rand(H * 0.15, H * 0.8);
    }
  }

  function updateLeaf(p, dt) {
    p.ph += p.swayHz * dt;
    p.x += Math.sin(p.ph) * p.swayA * 0.01 * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    alphaStep(p, dt);
    if (p.y > H + 20) {
      p.x = rand(0, W);
      p.y = -30;
      p.a = 0;
    }
  }

  function updateEmber(p, dt) {
    p.ph += p.swayHz * dt;
    p.x += (p.vx + Math.sin(p.ph) * 0.12) * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    alphaStep(p, dt);
    if (p.y < -20 || p.life <= 0) {
      p.x = rand(0, W);
      p.y = rand(H * 0.4, H + 20);
      p.life = rand(160, 380);
      p.a = 0;
    }
  }

  function drawParticle(p) {
    if (!ctx || p.a <= 0.01) return;
    ctx.globalAlpha = Math.min(1, p.a);
    if (p.kind === "firefly") {
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 8;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.7 + 0.5 * (p.pulse || 1)), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      return;
    }
    if (p.kind === "leaf") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.a * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.w / 2, p.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    if (p.kind === "bubble") {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = p.a * 0.7;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    // mote / ember：柔光圆点
    ctx.fillStyle = p.color;
    ctx.shadowBlur = p.r > 1.6 ? 6 : 3;
    ctx.shadowColor = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function frame(ts) {
    raf = 0;
    if (hiddenPaused || !ctx || !fxEnabled) return;
    var dt = Math.min(50, ts - lastT || 16) / 16.667;
    lastT = ts;
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      if (p.kind === "bubble") updateBubble(p, dt);
      else if (p.kind === "firefly") updateFirefly(p, dt);
      else if (p.kind === "leaf") updateLeaf(p, dt);
      else if (p.kind === "ember") updateEmber(p, dt);
      else updateMote(p, dt);
      drawParticle(p);
    }
    raf = window.requestAnimationFrame(frame);
  }

  function start() {
    if (raf || !canvas || !ctx || !fxEnabled || reducedMotion) return;
    lastT = performance.now();
    raf = window.requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) {
      window.cancelAnimationFrame(raf);
      raf = 0;
    }
    if (ctx) ctx.clearRect(0, 0, W, H);
  }

  // ---------- 场景切换监听 ----------
  function applySceneChange() {
    var n = currentScene();
    if (n === sceneNow) return;
    rebuild(n);
    if (!ctx || !fxEnabled || reducedMotion) return;
    // 重建后立刻重启循环（若因场景为 -1 停止）
    if (n >= 0) start();
    else stop();
  }

  function boot() {
    if (!canvas || !ctx || reducedMotion || !fxEnabled) {
      if (canvas) canvas.style.display = "none";
      return;
    }
    resize();
    sceneNow = -2; // 强制首帧重建
    applySceneChange();
    window.addEventListener("resize", function () {
      resize();
      rebuild(currentScene());
    });
    // 页面隐藏时暂停，避免后台空转
    document.addEventListener("visibilitychange", function () {
      hiddenPaused = document.hidden;
      if (hiddenPaused) {
        stop();
      } else {
        lastT = performance.now();
        start();
      }
    });
    if (window.MutationObserver) {
      new MutationObserver(applySceneChange).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-scene"]
      });
    }
    start();
  }

  // ---------- 点击墨色涟漪（节流 300ms；reduced-motion / 触屏不启用） ----------
  var rippleLast = 0;
  function spawnRipple(x, y) {
    var box = document.getElementById("ripples");
    if (!box) return;
    var s = document.createElement("span");
    s.className = "ink-ripple";
    s.style.left = x + "px";
    s.style.top = y + "px";
    box.appendChild(s);
    window.setTimeout(function () {
      if (s.parentNode) s.parentNode.removeChild(s);
    }, 650);
  }

  if (finePointer && document.getElementById("main")) {
    document.getElementById("main").addEventListener("pointerdown", function (ev) {
      var now = Date.now();
      if (now - rippleLast < 300) return;
      rippleLast = now;
      spawnRipple(ev.clientX, ev.clientY);
    });
  }

  // ---------- 分层视差数据源（指针系数在 CSS 侧区分；滚动系数 0.3） ----------
  if (finePointer) {
    var root = document.documentElement;
    document.addEventListener("pointermove", function (ev) {
      var px = (ev.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
      var py = (ev.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
      root.style.setProperty("--px", px.toFixed(3));
      root.style.setProperty("--py", py.toFixed(3));
    });
    document.addEventListener("pointerleave", function () {
      root.style.setProperty("--px", "0");
      root.style.setProperty("--py", "0");
    });
  }

  function syncScroll() {
    if (reducedMotion) return;
    var y = Math.min(140, Math.max(0, window.pageYOffset || 0) * 0.3);
    document.documentElement.style.setProperty("--scy", y.toFixed(1) + "px");
  }
  window.addEventListener("scroll", syncScroll, { passive: true });
  syncScroll();

  // ---------- 对外接口（供调试/未来设置项使用） ----------
  window.FX = {
    setEnabled: function (on) {
      fxEnabled = !!on;
      if (fxEnabled) {
        canvas.style.display = "";
        resize();
        rebuild(currentScene());
        start();
      } else {
        stop();
        if (canvas) canvas.style.display = "none";
      }
    },
    refresh: applySceneChange
  };

  boot();
})();
