// ============================================================
// 第三迭代：像素小人数据（js/sprites.js · i3 P1a/P1c 人物建模）
//  - 按《AI提示词包 v0.2》0.7 分镜规格，16×16、pal 索引矩阵；
//  - 角色辨识特征：林慕灰袍旧笔 / 林韬扬颏锦冠玉坠 / 周显玄青抱臂 /
//    章管事官帽山羊胡持名册 / 妖狼王四足赤目 / 夜巡二人组（胖瘦+灯笼）；
//  - 帧：idle×2 / attack×2 / hit / defeat；attack 帧统一朝右；
//  - 正式精修稿可后续用 LibreSprite 打开 assets/sprites/<id>.png 替换。
// 导出：window.SPRITES + module.exports（Node 校验）。
// ============================================================
(function () {
  "use strict";

  function blank() {
    var rows = [];
    for (var y = 0; y < 16; y++) {
      var row = [];
      for (var x = 0; x < 16; x++) row.push(0);
      rows.push(row);
    }
    return rows;
  }
  function rect(m, x, y, w, h, v) {
    for (var yy = y; yy < y + h && yy < 16; yy++) {
      for (var xx = x; xx < x + w && xx < 16; xx++) {
        if (yy >= 0 && xx >= 0) m[yy][xx] = v;
      }
    }
  }
  function copy(m) {
    return m.map(function (row) { return row.slice(); });
  }

  var INK = 1, PAPER = 2, GOLD = 3, RED = 4, HUE = 5;

  // 通用人形：头/发/躯干/四肢 + 角色特征（opts）
  function human(opts, pose) {
    var m = blank();
    var lean = pose === "atk" ? 1 : pose === "hit" ? 1 : 0;
    // 头
    rect(m, 6 + lean, 2, 4, 3, INK);
    rect(m, 7 + lean, 3, 1, 1, opts.hair === "paper" ? PAPER : INK);
    // 发型 / 冠 / 帽
    if (opts.bun) { rect(m, 8 + lean, 0, 2, 2, PAPER); rect(m, 9 + lean, 0, 1, 1, GOLD); }
    if (opts.crown) { rect(m, 6 + lean, 0, 4, 2, PAPER); rect(m, 8 + lean, 0, 1, 1, GOLD); }
    if (opts.hat) {
      rect(m, 6 + lean, 0, 4, 1, INK);
      rect(m, 4 + lean, 1, 3, 1, INK); rect(m, 9 + lean, 1, 3, 1, INK);
      rect(m, 6 + lean, 1, 4, 1, PAPER);
    }
    // 躯干（锦袍高领 or 灰袍）
    rect(m, 5 + lean, 5, 6, 5, INK);
    if (opts.collar) rect(m, 5 + lean, 5, 6, 1, HUE);
    rect(m, 6 + lean, 6, 2, 3, HUE);
    if (opts.belt) rect(m, 5 + lean, 8, 6, 1, GOLD);
    if (opts.jade) rect(m, 11 + lean, 9, 1, 2, GOLD);
    // 腿脚
    rect(m, 6 + lean, 10, 2, 4, INK);
    rect(m, 9 + lean, 10, 2, 4, INK);
    rect(m, 5 + lean, 14, 3, 1, INK);
    rect(m, 9 + lean, 14, 3, 1, INK);
    // 特征：旧笔 / 名册 / 抱臂 / 山羊胡
    if (opts.pen) rect(m, 12 + lean, 3, 1, 5, GOLD);
    if (opts.ledger) { rect(m, 12 + lean, 6, 3, 3, PAPER); rect(m, 13 + lean, 7, 1, 1, GOLD); }
    if (opts.crossed) rect(m, 4 + lean, 6, 8, 2, HUE);
    if (opts.beard) rect(m, 7 + lean, 6, 2, 3, PAPER);
    // attack：前臂前伸；hit：后仰；defeat：塌坐
    if (pose === "atk") rect(m, 11 + lean, 6, 3, 2, HUE);
    if (pose === "sit") {
      m = blank();
      rect(m, 5, 8, 6, 3, INK);
      rect(m, 7, 9, 2, 1, HUE);
      rect(m, 4, 11, 9, 2, INK);
      if (opts.pen) rect(m, 12, 7, 1, 5, GOLD);
      if (opts.ledger) rect(m, 3, 9, 3, 2, PAPER);
    }
    return m;
  }

  // 妖狼王：四足立姿，黑毛赤目
  function wolf(pose) {
    var m = blank();
    var l = pose === "atk" ? 1 : pose === "hit" ? -1 : 0;
    var x = 3 + l;
    // 身
    rect(m, x, 8, 9, 4, INK);
    rect(m, x + 2, 7, 6, 2, INK);
    // 颈毛
    rect(m, x + 6, 6, 4, 2, INK);
    rect(m, x + 7, 5, 2, 2, HUE);
    // 头与耳
    rect(m, x + 9, 4, 3, 2, INK);
    rect(m, x + 9, 3, 1, 2, INK); rect(m, x + 11, 3, 1, 2, INK);
    // 赤目
    rect(m, x + 10, 5, 1, 1, RED);
    // 腿
    rect(m, x, 12, 2, 3, INK); rect(m, x + 2, 12, 2, 3, INK);
    rect(m, x + 7, 12, 2, 3, INK); rect(m, x + 9, 12, 2, 3, INK);
    // 尾
    rect(m, x - 1, 9, 2, 2, INK);
    if (pose === "atk") { rect(m, x + 12, 6, 2, 1, RED); rect(m, x + 12, 5, 2, 1, INK); }
    if (pose === "sit") {
      m = blank();
      rect(m, 4, 9, 9, 3, INK);
      rect(m, 11, 6, 3, 3, INK);
      rect(m, 12, 5, 1, 2, INK);
      rect(m, 12, 7, 1, 1, RED);
      rect(m, 5, 12, 8, 2, INK);
    }
    return m;
  }

  // 夜巡二人组：胖瘦并立 + 灯笼
  function patrol(pose) {
    var m = blank();
    var l = pose === "atk" ? 1 : pose === "hit" ? 1 : 0;
    // 胖（左，矮圆）
    rect(m, 2 + l, 5, 5, 6, INK);
    rect(m, 3 + l, 4, 3, 2, INK);
    rect(m, 3 + l, 7, 1, 2, HUE);
    rect(m, 3 + l, 11, 4, 2, INK);
    // 瘦（右，高瘦）
    rect(m, 8 + l, 3, 3, 8, INK);
    rect(m, 8 + l, 4, 1, 2, HUE);
    rect(m, 8 + l, 11, 3, 3, INK);
    rect(m, 7 + l, 14, 4, 1, INK);
    // 灯笼（右侧提灯）
    rect(m, 12 + l, 4, 3, 4, HUE);
    rect(m, 13 + l, 3, 1, 2, GOLD);
    rect(m, 13 + l, 5, 1, 1, GOLD);
    if (pose === "atk") rect(m, 15, 6, 1, 3, HUE);
    if (pose === "sit") {
      m = blank();
      rect(m, 3, 9, 5, 3, INK);
      rect(m, 9, 8, 3, 4, INK);
      rect(m, 4, 12, 8, 2, INK);
      rect(m, 12, 6, 3, 4, HUE);
      rect(m, 13, 5, 1, 2, GOLD);
    }
    return m;
  }

  function framesOf(build, opts) {
    var idle1 = build(opts, "");
    var idle2 = build(opts, "");
    rect(idle2, 7, 2, 1, 1, PAPER); // 1px 呼吸差
    var atk1 = build(opts, "atk");
    var atk2 = build(opts, "atk");
    rect(atk2, 13, 6, 2, 1, HUE); // 前伸一步
    var hit = build(opts, "hit");
    var defeat = build(opts, "sit");
    return { idle: [idle1, idle2], attack: [atk1, atk2], hit: [hit], defeat: [defeat] };
  }

  var SPRITES = {
    linmu: {
      name: "林慕", glyph: "慕", hueIdx: 5, size: 16,
      pal: ["#00000000", "#1a1712", "#e9e1cc", "#c8a44b", "#a93a2d", "#8fa8b8"],
      frames: framesOf(function (o, p) { return human({ bun: true, pen: true, belt: true }, p); })
    },
    lintao: {
      name: "林韬", glyph: "韬", hueIdx: 5, size: 16,
      pal: ["#00000000", "#1a1712", "#e9e1cc", "#c8a44b", "#a93a2d", "#c8a44b"],
      frames: framesOf(function (o, p) { return human({ crown: true, collar: true, jade: true }, p); })
    },
    zhouxian: {
      name: "周显", glyph: "显", hueIdx: 5, size: 16,
      pal: ["#00000000", "#1a1712", "#e9e1cc", "#c8a44b", "#a93a2d", "#4a5a6a"],
      frames: framesOf(function (o, p) { return human({ crossed: true }, p); })
    },
    zhang: {
      name: "章管事", glyph: "章", hueIdx: 5, size: 16,
      pal: ["#00000000", "#1a1712", "#e9e1cc", "#c8a44b", "#a93a2d", "#8a6f52"],
      frames: framesOf(function (o, p) { return human({ hat: true, beard: true, ledger: true }, p); })
    },
    wolf_king: {
      name: "妖狼王", glyph: "狼", hueIdx: 5, size: 16,
      pal: ["#00000000", "#1a1712", "#e9e1cc", "#c8a44b", "#a93a2d", "#8a3a30"],
      frames: framesOf(function (o, p) { return wolf(p); })
    },
    night_patrol: {
      name: "夜巡二人组", glyph: "巡", hueIdx: 5, size: 16,
      pal: ["#00000000", "#1a1712", "#e9e1cc", "#c8a44b", "#a93a2d", "#b98a5a"],
      frames: framesOf(function (o, p) { return patrol(p); })
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { SPRITES: SPRITES };
  }
  if (typeof window !== "undefined") window.SPRITES = SPRITES;
})();
