// ============================================================
// WebAudio 合成音效模块（零外部音频资源，全部实时合成）
// 依赖：window.App（game.js 提供），加载顺序须在 game.js 之后。
// 设计约束：
//  - AudioContext 只在“音效开启 + 首次用户交互”时才创建，遵守自动播放策略；
//  - 每个音效时长 < 1.2s；
//  - 设置写入 v2 存档的 settings.sound；
//  - 任何 WebAudio 异常都不允许抛到游戏主流程（外层统一吞掉）。
// ============================================================
(function () {
  "use strict";

  var LS_KEY = "xiuxian-python-game-v2";
  var ctx = null;
  var master = null;
  var noiseBuf = null;
  var enabled = true;
  var supported = !!(window.AudioContext || window.webkitAudioContext);

  // ---------- 设置读写（v2 存档 settings.sound） ----------
  function readSave() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function readSetting() {
    var p = readSave();
    if (p && p.settings && typeof p.settings === "object") {
      enabled = p.settings.sound !== false;
    } else {
      enabled = true;
    }
  }

  function persistSetting() {
    try {
      var p = readSave() || {};
      if (!p.settings || typeof p.settings !== "object") p.settings = {};
      p.settings.sound = enabled;
      localStorage.setItem(LS_KEY, JSON.stringify(p));
    } catch (e) {
      // localStorage 不可用时静默跳过
    }
  }

  // ---------- AudioContext（懒创建 + 自动播放策略） ----------
  function ensureCtx() {
    if (!enabled || !supported) return null;
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 1;
        master.connect(ctx.destination);
      } catch (e) {
        ctx = null;
        master = null;
        return null;
      }
    }
    if (ctx.state === "suspended") {
      try {
        ctx.resume();
      } catch (e) {
        // 个别浏览器拒绝恢复时静默
      }
    }
    startAmbientIfPossible();
    return ctx;
  }

  // ---------- 合成工具 ----------
  function envelope(ac, t0, peak, attack, decay) {
    var g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    return g;
  }

  // 磬/钟式泛音：基频 + 少量非整数泛音，明亮而悠长
  function bell(ac, freq, t0, amp, dur) {
    var partials = [[1, 1], [2.74, 0.4], [5.38, 0.12]];
    partials.forEach(function (p) {
      var o = ac.createOscillator();
      o.type = "sine";
      o.frequency.value = freq * p[0];
      var g = ac.createGain();
      var peak = amp * p[1];
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    });
  }

  function noiseBuffer(ac) {
    if (noiseBuf) return noiseBuf;
    var len = Math.floor(ac.sampleRate * 1.4);
    var buf = ac.createBuffer(1, len, ac.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    noiseBuf = buf;
    return noiseBuf;
  }

  // ---------- 各音效（全部 < 1.2s） ----------

  // 点击/翻页：短促木鱼/拨弦（高频三角波快速下滑 + 低通，木质“笃”感）
  function playClick(ac) {
    var t0 = ac.currentTime;
    var lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1500;
    var g = envelope(ac, t0, 0.16, 0.003, 0.14);
    var o = ac.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(780, t0);
    o.frequency.exponentialRampToValueAtTime(460, t0 + 0.07);
    o.connect(lp);
    lp.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + 0.17);
  }

  // 答对：清亮磬音，上行两音（C6 → E6）
  function playRight(ac) {
    var t0 = ac.currentTime;
    bell(ac, 1046.5, t0, 0.1, 0.72);
    bell(ac, 1318.5, t0 + 0.12, 0.11, 0.72);
  }

  // 答错：低闷鼓 + 下坠余音
  function playWrong(ac) {
    var t0 = ac.currentTime;
    var g = envelope(ac, t0, 0.42, 0.003, 0.2);
    var o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150, t0);
    o.frequency.exponentialRampToValueAtTime(65, t0 + 0.1);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + 0.24);

    var t1 = t0 + 0.04;
    var lp2 = ac.createBiquadFilter();
    lp2.type = "lowpass";
    lp2.frequency.value = 620;
    var g2 = envelope(ac, t1, 0.08, 0.012, 0.52);
    var o2 = ac.createOscillator();
    o2.type = "triangle";
    o2.frequency.setValueAtTime(330, t1);
    o2.frequency.exponentialRampToValueAtTime(120, t1 + 0.48);
    o2.connect(lp2);
    lp2.connect(g2);
    g2.connect(master);
    o2.start(t1);
    o2.stop(t1 + 0.56);
  }

  // 破境：由低到高的钟磬齐鸣（G4 C5 E5 G5 C6 依次上行）
  function playBreakthrough(ac) {
    var t0 = ac.currentTime;
    var notes = [392, 523.25, 659.25, 783.99, 1046.5];
    notes.forEach(function (f, i) {
      bell(ac, f, t0 + i * 0.07, 0.085, 0.8);
    });
  }

  // 渡劫雷声：低频噪声包络（滤波白噪声 + 指数衰减）
  function playThunder(ac) {
    var t0 = ac.currentTime;
    var src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac);
    src.loop = true;
    var lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(420, t0);
    lp.frequency.exponentialRampToValueAtTime(90, t0 + 0.9);
    lp.Q.value = 0.6;
    var g = envelope(ac, t0, 0.55, 0.015, 1.02);
    src.connect(lp);
    lp.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + 1.1);
  }

  // 印章解锁：短促“嗒”（高频点击，双振荡器，极短）
  function playSeal(ac) {
    var t0 = ac.currentTime;
    var g1 = envelope(ac, t0, 0.18, 0.001, 0.07);
    var o1 = ac.createOscillator();
    o1.type = "sine";
    o1.frequency.setValueAtTime(1450, t0);
    o1.frequency.exponentialRampToValueAtTime(1050, t0 + 0.05);
    o1.connect(g1);
    g1.connect(master);
    o1.start(t0);
    o1.stop(t0 + 0.09);

    var g2 = envelope(ac, t0 + 0.002, 0.055, 0.001, 0.05);
    var o2 = ac.createOscillator();
    o2.type = "sine";
    o2.frequency.value = 2450;
    o2.connect(g2);
    g2.connect(master);
    o2.start(t0 + 0.002);
    o2.stop(t0 + 0.07);
  }

  // 灵宠升阶：短促上行琶音（C5 E5 G5 C6），明亮雀跃
  function playLevelup(ac) {
    var t0 = ac.currentTime;
    var notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach(function (f, i) {
      var g = envelope(ac, t0 + i * 0.055, 0.12, 0.004, 0.34);
      var o = ac.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      o.connect(g);
      g.connect(master);
      o.start(t0 + i * 0.055);
      o.stop(t0 + i * 0.055 + 0.4);
      // 加一道极轻的磬音泛音，灵性更足
      bell(ac, f * 2, t0 + i * 0.055, 0.03, 0.32);
    });
  }

  var SOUNDS = {
    click: playClick,
    right: playRight,
    wrong: playWrong,
    breakthrough: playBreakthrough,
    thunder: playThunder,
    seal: playSeal,
    levelup: playLevelup
  };

  function play(name) {
    if (!enabled) return;
    var ac = ensureCtx();
    if (!ac) return;
    try {
      var fn = SOUNDS[name] || playClick;
      fn(ac);
    } catch (e) {
      // 单次合成失败不影响后续
    }
  }

  // ---------- 场景环境音（i2-1：极轻滤噪底噪，宁缺毋滥只留两档） ----------
  // scene5 夜枭谷：夜风；scene6 渡劫：风雨。其余场景保持静默，
  // 避免廉价底噪反而破坏氛围。音量一律 -28dB 上下，可随主音效开关静默。
  var ambient = null; // { scene, layers:[{gain,stops}], timer }
  var ambScene = -1;

  function ambientCurrentScene() {
    var n = Number(document.documentElement.getAttribute("data-scene"));
    return isFinite(n) ? n : -1;
  }

  function ambientRecipe(scene) {
    if (scene === 5) {
      // 夜风：低通噪声 + 0.08Hz 缓慢起伏（风声“呼吸”感）
      return [
        {
          type: "lowpass",
          freq: 330,
          q: 0.7,
          gain: 0.045,
          lfoHz: 0.08,
          lfoDepth: 150,
          lfoGain: 0.013
        }
      ];
    }
    if (scene === 6) {
      // 风雨：低闷风声 + 一点中高频雨噪（雨丝视觉仍由 CSS 负责）
      return [
        {
          type: "lowpass",
          freq: 190,
          q: 0.55,
          gain: 0.038,
          lfoHz: 0.11,
          lfoDepth: 110,
          lfoGain: 0.011
        },
        {
          type: "bandpass",
          freq: 1750,
          q: 0.85,
          gain: 0.014,
          lfoHz: 0.27,
          lfoDepth: 260,
          lfoGain: 0.004
        }
      ];
    }
    return null;
  }

  function buildAmbLayer(ac, cfg) {
    var src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac);
    src.loop = true;
    var filt = ac.createBiquadFilter();
    filt.type = cfg.type || "lowpass";
    filt.frequency.value = cfg.freq;
    filt.Q.value = cfg.q || 0.8;
    var gain = ac.createGain();
    gain.gain.value = 0.0001;
    src.connect(filt);
    filt.connect(gain);
    gain.connect(master);
    src.start();
    var stops = [src];
    if (cfg.lfoHz && cfg.lfoDepth > 0) {
      var lfo = ac.createOscillator();
      lfo.frequency.value = cfg.lfoHz;
      var depth = ac.createGain();
      depth.gain.value = cfg.lfoDepth;
      lfo.connect(depth);
      depth.connect(filt.frequency);
      lfo.start();
      stops.push(lfo);
    }
    if (cfg.lfoGain) {
      var glfo = ac.createOscillator();
      glfo.frequency.value = cfg.lfoHz ? cfg.lfoHz * 0.7 : 0.05;
      var gDepth = ac.createGain();
      gDepth.gain.value = cfg.lfoGain;
      glfo.connect(gDepth);
      gDepth.connect(gain.gain);
      glfo.start();
      stops.push(glfo);
    }
    return { gain: gain, stops: stops };
  }

  function stopAmbientGroup(group, delayMs) {
    if (!group) return;
    if (group.timer) window.clearTimeout(group.timer);
    group.timer = window.setTimeout(function () {
      try {
        group.layers.forEach(function (l) {
          l.stops.forEach(function (s) {
            try {
              s.stop();
            } catch (e) {
              // 已停止则忽略
            }
          });
        });
      } catch (e) {
        // 忽略
      }
    }, delayMs);
  }

  // 交叉淡入淡出（约 1.5s）：旧组淡出并自毁，新组从静音淡入
  function startAmbient(scene) {
    if (ambient && ambient.scene === scene) return;
    var recipe = ambientRecipe(scene);
    var old = ambient;
    ambient = null;
    if (old && ctx) {
      try {
        var t0 = ctx.currentTime;
        old.layers.forEach(function (l) {
          l.gain.gain.cancelScheduledValues(t0);
          l.gain.gain.setValueAtTime(Math.max(l.gain.gain.value, 0.0001), t0);
          l.gain.gain.linearRampToValueAtTime(0.0001, t0 + 1.5);
        });
        stopAmbientGroup(old, 1700);
      } catch (e) {
        // 忽略
      }
    }
    if (!recipe || !ctx || !enabled) return;
    try {
      var ac = ctx;
      var t1 = ac.currentTime;
      var layers = recipe.map(function (cfg) {
        var l = buildAmbLayer(ac, cfg);
        l.gain.gain.cancelScheduledValues(t1);
        l.gain.gain.setValueAtTime(0.0001, t1);
        l.gain.gain.linearRampToValueAtTime(cfg.gain, t1 + 1.5);
        return l;
      });
      ambient = { scene: scene, layers: layers, timer: null };
    } catch (e) {
      // 环境音合成失败时静默降级，绝不影响主流程
    }
  }

  function startAmbientIfPossible() {
    if (!ctx || !enabled || !master) return;
    if (!ambient) startAmbient(ambScene);
  }

  // 主音效关闭：环境音快速收掉（0.35s），不保留后台发声
  function muteAmbient() {
    if (!ambient || !ctx) return;
    try {
      var t0 = ctx.currentTime;
      ambient.layers.forEach(function (l) {
        l.gain.gain.cancelScheduledValues(t0);
        l.gain.gain.setValueAtTime(Math.max(l.gain.gain.value, 0.0001), t0);
        l.gain.gain.linearRampToValueAtTime(0.0001, t0 + 0.35);
      });
      stopAmbientGroup(ambient, 600);
    } catch (e) {
      // 忽略
    }
    ambient = null;
  }

  // ---------- 喇叭按钮 UI ----------
  function syncUI() {
    var btn = document.getElementById("btnSound");
    if (!btn) return;
    btn.classList.toggle("is-off", !enabled);
    btn.setAttribute("aria-pressed", enabled ? "true" : "false");
    btn.title = enabled ? "音效：开（点击关闭）" : "音效：关（点击开启）";
    var label = btn.querySelector(".snd-label");
    if (label) label.textContent = enabled ? "音效" : "音效（关）";
  }

  // 通用点击音：非“作答/校验”按钮的点击都发短促木鱼声。
  // 作答类按钮（.opt、校验、渡劫提交）由 game.js 在成功/失败回调里播专属音效，
  // 这里不再叠加。
  function onDocClick(ev) {
    if (!enabled) return;
    var t = ev.target;
    if (!t || !t.closest) return;
    var ctrl = t.closest("button, .road-node");
    if (!ctrl || ctrl.disabled) return;
    if (ctrl.id === "btnSound") return;
    if (ctrl.classList.contains("road-node")) {
      if (!ctrl.classList.contains("done") && !ctrl.classList.contains("current")) return;
    }
    if (ctrl.classList.contains("opt")) return;
    var inline = (ctrl.getAttribute && ctrl.getAttribute("onclick")) || "";
    if (inline.indexOf("checkFill") !== -1 || inline.indexOf("submitBoss") !== -1) return;
    play("click");
  }

  // ---------- 对外接口（纯新增，不影响 App.* 既有 API） ----------
  window.App = window.App || {};

  window.App.setSound = function (on) {
    enabled = !!on;
    persistSetting();
    syncUI();
    if (!enabled) {
      muteAmbient();
    }
    if (master && ctx) {
      try {
        master.gain.cancelScheduledValues(ctx.currentTime);
        if (!enabled) {
          // 正在播放的余音快速收掉
          master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), ctx.currentTime);
          master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.06);
        } else {
          master.gain.setValueAtTime(0.0001, ctx.currentTime);
          master.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.05);
        }
      } catch (e) {
        // 忽略
      }
    }
    if (enabled) startAmbientIfPossible();
  };

  window.App.sfx = play;
  // 场景环境音入口：game/fx 层或 data-scene 监听均可调用（重复调用同一场景为 no-op）
  window.App.setSceneAudio = function (sceneN) {
    const n = Number(sceneN);
    ambScene = isFinite(n) ? n : -1;
    if (ctx && enabled && master) startAmbient(n);
  };
  window.App.isSoundOn = function () {
    return enabled;
  };

  // ---------- 启动 ----------
  readSetting();
  var btn = document.getElementById("btnSound");
  if (btn) {
    btn.addEventListener("click", function () {
      window.App.setSound(!enabled);
    });
  }
  document.addEventListener("click", onDocClick);
  syncUI();

  // 初始场景 + 场景切换（约 1.5s 交叉淡入淡出环境音）
  ambScene = ambientCurrentScene();
  if (window.MutationObserver && document.documentElement) {
    new MutationObserver(function () {
      const v = ambientCurrentScene();
      if (v >= 0) window.App.setSceneAudio(v);
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-scene"]
    });
  }
})();
