// ============================================================
// 第三迭代 P1b：回合制答题战斗 · 纯逻辑核心
//  - 零 DOM、零 GAME_DATA 依赖：题目源/随机源由外部注入，便于 Node 单测；
//  - 覆盖：回合状态机、伤害结算、四技能槽换题、大招（≤30% 灵力见底）、
//    灵宠援护（首次答错免伤）、失败重试、HP=0 边界；
//  - 站位语义不在此层（UI 负责主角居左）。
// 导出：window.BattleCore（浏览器）+ module.exports（Node 测试共用）。
// ============================================================
(function () {
  "use strict";

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function defaultRand() {
    return Math.random();
  }

  // 四个技能槽：每个槽 = { flavor, topic, qKey }；qKey 用于同场去重
  function buildSlots(topics, drawQuestion, used, rand) {
    var slots = [];
    var tries = 0;
    while (slots.length < 4 && tries < 200) {
      tries++;
      var topic = topics[Math.floor(rand() * topics.length)];
      var picked = drawQuestion(topic, used);
      if (!picked) continue;
      var key = topic + "|" + (picked.q || picked.key || String(Math.random()));
      // 注入的 drawQuestion 可能已自行去重标记；这里统一登记一次即可，勿提前跳过
      used[key] = true;
      slots.push({ flavor: topic, topic: topic, qKey: key, q: picked });
    }
    return slots;
  }

  /**
   * 创建一场战斗。
   * @param {Object} cfg
   *   levelId, heroHp, heroAtk, enemyHp, enemyAtk, ultPct, trapChance,
   *   topics(技能主题数组), drawQuestion(topic, used)->q|undefined,
   *   drawTrapQuestion()->q|undefined, rand=Math.random,
   *   shield=true(本场灵宠援护), maxTrapTries=3(可调, 默认不限制)
   */
  function createBattle(cfg) {
    var c = cfg || {};
    var rand = c.rand || defaultRand;
    var used = {};
    var st = {
      cfg: c,
      rand: rand,
      used: used,
      round: 0,
      phase: "choose", // choose | skillQ | trapQ | ult | win | lose
      hp: {
        hero: Math.max(1, c.heroHp || 100),
        enemy: Math.max(1, c.enemyHp || 80)
      },
      atk: {
        hero: c.heroAtk || 15,
        enemy: c.enemyAtk || 9
      },
      ultPct: clamp(typeof c.ultPct === "number" ? c.ultPct : 0.3, 0, 1),
      trapChance: clamp(typeof c.trapChance === "number" ? c.trapChance : 0.5, 0, 1),
      shield: c.shield !== false,
      slots: [],
      current: null, // 当前作答目标 { kind:'skill'|'trap', slot:0..3 }
      ult: {
        unlocked: false,
        misses: 0
      },
      log: []
    };
    st.slots = buildSlots(c.topics || [], c.drawQuestion || function () {}, used, rand);
    return st;
  }

  function pushLog(st, text, kind) {
    st.log.push({ text: text, kind: kind || "info" });
    if (st.log.length > 30) st.log.shift();
  }

  // 我方选技能 → 进入答题
  function chooseSkill(st, slotIndex) {
    if (!st || st.phase !== "choose") return { ok: false, reason: "phase" };
    if (st.ult.unlocked) return { ok: false, reason: "ult-lock" };
    var slot = st.slots[slotIndex];
    if (!slot) return { ok: false, reason: "slot" };
    st.phase = "skillQ";
    st.current = { kind: "skill", slot: slotIndex, q: slot.q };
    return { ok: true };
  }

  // 我方答技能题：answer 为外部判定后的“是否答对”
  function resolveSkill(st, correct) {
    if (!st || st.phase !== "skillQ") return { ok: false, reason: "phase" };
    var slot = st.slots[st.current.slot];
    var dmg = st.atk.hero + Math.floor(st.rand() * 6);
    if (correct) {
      st.hp.enemy = Math.max(0, st.hp.enemy - dmg);
      pushLog(st, "答对，命中 " + dmg + " 点", "hit");
      // 用后同主题换题补位（保留槽位，题目去重交给外部 drawQuestion + used）
      var next = null;
      if (st.cfg.drawQuestion) {
        next = st.cfg.drawQuestion(slot.topic, st.used);
      }
      slot.q = next || slot.q;
      if (next && slot.q) {
        slot.qKey = slot.topic + "|" + (next.q || next.key || "");
        st.used[slot.qKey] = true;
      }
      st.current = null;
      if (st.hp.enemy <= 0) {
        st.phase = "win";
        pushLog(st, "敌方倒下，战斗胜利", "win");
        return { ok: true, result: "win", dmg: dmg };
      }
      if (st.hp.enemy / maxEnemyHp(st) <= st.ultPct) {
        st.ult.unlocked = true;
        st.phase = "ult";
        pushLog(st, "灵力见底——只能写代码终击", "ult");
        return { ok: true, result: "ult", dmg: dmg };
      }
      st.phase = "enemy";
      return { ok: true, result: "enemy-turn", dmg: dmg };
    }
    // 答错：落空 + 吃反击（灵宠护体可挡首次）
    var counter = Math.max(1, st.atk.enemy + Math.floor(st.rand() * 3));
    var blocked = applyHeroDamage(st, counter, "反击");
    st.current = null;
    if (st.hp.hero <= 0) {
      st.phase = "lose";
      return { ok: true, result: "lose", blocked: blocked };
    }
    // 我方答错后敌方本回合不追加行动（一次反击即止）
    st.phase = "choose";
    st.round += 1;
    return { ok: true, result: "miss", blocked: blocked };
  }

  // 敌方回合：随机 直接攻击 / 找茬
  function enemyAct(st) {
    if (!st || st.phase !== "enemy") return { ok: false, reason: "phase" };
    if (st.rand() < st.trapChance && st.cfg.drawTrapQuestion) {
      var q = st.cfg.drawTrapQuestion();
      st.phase = "trapQ";
      st.current = { kind: "trap", q: q };
      pushLog(st, "敌方出招：找茬题", "trap");
      return { ok: true, result: "trap" };
    }
    var dmg = Math.max(1, st.atk.enemy + Math.floor(st.rand() * 5));
    var blocked = applyHeroDamage(st, dmg, "敌方攻击");
    if (st.hp.hero <= 0) {
      st.phase = "lose";
      return { ok: true, result: "lose", blocked: blocked };
    }
    st.phase = "choose";
    st.round += 1;
    return { ok: true, result: "attack", dmg: dmg, blocked: blocked };
  }

  // 敌方找茬题作答：correct=化解免伤；wrong=反噬
  function resolveTrap(st, correct) {
    if (!st || st.phase !== "trapQ") return { ok: false, reason: "phase" };
    st.current = null;
    if (correct) {
      pushLog(st, "找茬题化解，敌方招式落空", "good");
    } else {
      var dmg = Math.max(1, Math.round(st.atk.enemy * (st.cfg.trapPenalty || 1.5)));
      applyHeroDamage(st, dmg, "找茬反噬");
      pushLog(st, "找茬答错，反噬 " + dmg + " 点", "hurt");
    }
    if (st.hp.hero <= 0) {
      st.phase = "lose";
      return { ok: true, result: "lose" };
    }
    st.phase = "choose";
    st.round += 1;
    return { ok: true, result: "ok" };
  }

  // 大招：判定结果 correct=true 时一击制胜（灵力已见底）
  function resolveUlt(st, correct) {
    if (!st || st.phase !== "ult") return { ok: false, reason: "phase" };
    if (correct) {
      st.hp.enemy = 0;
      st.phase = "win";
      pushLog(st, "大招代码运行成功——最后一击落下", "win");
      return { ok: true, result: "win" };
    }
    st.ult.misses += 1;
    var dmg = Math.max(1, Math.round(st.atk.enemy * (st.cfg.ultMissCounter || 1.4)));
    applyHeroDamage(st, dmg, "大招反噬");
    pushLog(st, "大招未达预期，反噬 " + dmg + " 点", "hurt");
    if (st.hp.hero <= 0) {
      st.phase = "lose";
      return { ok: true, result: "lose" };
    }
    return { ok: true, result: "miss", dmg: dmg };
  }

  function applyHeroDamage(st, dmg, label) {
    if (st.shield && dmg > 0) {
      st.shield = false;
      pushLog(st, "灵宠援护：替你挡下这一次 (" + label + ")", "shield");
      return true;
    }
    st.hp.hero = Math.max(0, st.hp.hero - dmg);
    return false;
  }

  function maxEnemyHp(st) {
    return st.cfg.enemyHp || 80;
  }

  // 失败重试：用原配置新建一场（进度/题序全重置，不触碰存档）
  function retry(st) {
    return createBattle(st.cfg);
  }

  var API = {
    createBattle: createBattle,
    chooseSkill: chooseSkill,
    resolveSkill: resolveSkill,
    enemyAct: enemyAct,
    resolveTrap: resolveTrap,
    resolveUlt: resolveUlt,
    retry: retry
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  if (typeof window !== "undefined") window.BattleCore = API;
})();
