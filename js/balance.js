// ============================================================
// 第三迭代：回合制战斗数值表（i3 P1a）
//  - 数值集中在此文件，试玩后调参只改这里；
//  - 我方 HP/攻由“已通关章节数”推导（不写入存档，旧档零迁移）；
//  - 敌方按 levelId 取配置；大招阈值/找茬概率可整体调整。
// 导出：window.BALANCE（浏览器）+ module.exports（Node 校验/测试共用）。
// ============================================================
(function () {
  "use strict";

  var BALANCE = {
    version: 1,
    // 我方基础值 + 每通关一章的成长
    hero: {
      baseHp: 100,
      hpPerLevel: 22,
      baseAtk: 15,
      atkPerLevel: 2
    },
    // 大招/敌方通用
    ultHpPct: 0.3, // 敌方 HP≤30% 触发“灵力见底”
    trapChance: 0.5, // 敌方回合出找茬题的概率
    trapPenalty: 1.5, // 找茬答错的反噬系数
    ultMissCounter: 1.4, // 大招写错时敌方反击系数
    levels: {
      lv1: { enemyHp: 80, enemyAtk: 9 },
      lv2: { enemyHp: 100, enemyAtk: 11 },
      lv3: { enemyHp: 120, enemyAtk: 13 },
      lv4: { enemyHp: 140, enemyAtk: 15 },
      lv5: { enemyHp: 160, enemyAtk: 17 }
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { BALANCE: BALANCE };
  }
  if (typeof window !== "undefined") window.BALANCE = BALANCE;
})();
