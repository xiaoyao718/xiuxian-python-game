// ============================================================
// 第三迭代 P1b：回合战斗纯逻辑测试（Code Testing · Node assert 零依赖）
// 运行：node scripts/test-battle.js
// ============================================================
"use strict";

var assert = require("assert");
var path = require("path");
var core = require(path.join(__dirname, "..", "js", "battle-core.js"));

var passed = 0;
var failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("[PASS] " + name);
  } catch (e) {
    failed++;
    console.log("[FAIL] " + name + "　" + (e && e.message));
  }
}

// ---------- 工具 ----------
function makeRand(seq) {
  var i = 0;
  return function () {
    var v = seq[i % seq.length];
    i++;
    return v;
  };
}

function mkCfg(over) {
  var n = 0;
  return Object.assign(
    {
      levelId: "lv1",
      heroHp: 100,
      heroAtk: 15,
      enemyHp: 80,
      enemyAtk: 9,
      ultPct: 0.3,
      trapChance: 0.5,
      shield: true,
      topics: ["print"],
      rand: makeRand([0.7, 0.1, 0.9, 0.2]),
      drawQuestion: function (topic, used) {
        n++;
        return { q: "q" + n, key: "q" + n, answer: 0 };
      },
      drawTrapQuestion: function () {
        return { q: "trap", key: "trap", answer: 0 };
      }
    },
    over || {}
  );
}

// 1) 初始状态：4 技能槽、同场不重复、phase=choose
test("初始战斗：4 技能槽且 key 不重复", function () {
  var st = core.createBattle(mkCfg());
  assert.strictEqual(st.slots.length, 4);
  assert.strictEqual(st.phase, "choose");
  var keys = st.slots.map(function (s) { return s.qKey; });
  assert.strictEqual(new Set(keys).size, keys.length);
  assert.strictEqual(st.hp.hero, 100);
  assert.strictEqual(st.hp.enemy, 80);
});

// 2) 选技能进入答题
test("chooseSkill：正常进入 skillQ", function () {
  var st = core.createBattle(mkCfg());
  var r = core.chooseSkill(st, 0);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(st.phase, "skillQ");
  assert.strictEqual(st.current.kind, "skill");
});

test("chooseSkill：phase 不对/灵力见底后拒绝", function () {
  var st = core.createBattle(mkCfg());
  core.chooseSkill(st, 0);
  assert.strictEqual(core.chooseSkill(st, 1).ok, false);
  st.phase = "choose";
  st.ult.unlocked = true;
  assert.strictEqual(core.chooseSkill(st, 0).ok, false);
});

// 3) 答对命中；未达阈值时进入敌方回合
test("答对技能：扣敌方血且转入 enemy", function () {
  var st = core.createBattle(mkCfg({ enemyHp: 500 }));
  core.chooseSkill(st, 0);
  var before = st.hp.enemy;
  var r = core.resolveSkill(st, true);
  assert.strictEqual(r.result, "enemy-turn");
  assert.ok(st.hp.enemy < before);
  assert.ok(st.hp.enemy >= before - (st.atk.hero + 5));
  assert.strictEqual(st.phase, "enemy");
});

// 4) 答错吃反击；灵宠护体挡第一次
test("答错：援护挡首次伤害，第二次正常扣血", function () {
  var st = core.createBattle(mkCfg({ rand: makeRand([0.7, 0.5, 0.7, 0.5]) }));
  core.chooseSkill(st, 0);
  var hp1 = st.hp.hero;
  var r1 = core.resolveSkill(st, false);
  assert.strictEqual(r1.blocked, true);
  assert.strictEqual(st.hp.hero, hp1, "灵宠应挡下首次答错");
  assert.strictEqual(st.phase, "choose");
  // 第二次答错：无盾，正常扣血
  core.chooseSkill(st, 1);
  var r2 = core.resolveSkill(st, false);
  assert.strictEqual(r2.blocked, false);
  assert.ok(st.hp.hero < hp1);
});

// 5) 敌方直接攻击
test("敌方回合：直接攻击扣我方血并回到 choose", function () {
  var st = core.createBattle(mkCfg({
    rand: makeRand([0.9, 0.9, 0.9]),
    trapChance: 0.5,
    shield: false
  }));
  st.phase = "enemy";
  var hp = st.hp.hero;
  var r = core.enemyAct(st);
  assert.strictEqual(r.result, "attack");
  assert.ok(st.hp.hero < hp);
  assert.strictEqual(st.phase, "choose");
});

// 6) 敌方找茬：答对免伤 / 答错反噬
test("敌方找茬：答对化解无伤", function () {
  var st = core.createBattle(mkCfg({ rand: makeRand([0.7, 0.7, 0.7, 0.7, 0.1, 0.9]) }));
  st.phase = "enemy";
  var r = core.enemyAct(st);
  assert.strictEqual(r.result, "trap");
  assert.strictEqual(st.phase, "trapQ");
  var hp = st.hp.hero;
  core.resolveTrap(st, true);
  assert.strictEqual(st.hp.hero, hp);
  assert.strictEqual(st.phase, "choose");
});

test("敌方找茬：答错反噬并回到 choose", function () {
  var st = core.createBattle(mkCfg({ rand: makeRand([0.7, 0.7, 0.7, 0.7, 0.1, 0.9]), shield: false }));
  st.phase = "enemy";
  core.enemyAct(st);
  var hp = st.hp.hero;
  var r = core.resolveTrap(st, false);
  assert.strictEqual(r.result, "ok");
  assert.ok(st.hp.hero < hp);
  assert.strictEqual(st.phase, "choose");
});

// 7) 大招阈值：敌方 HP≤30% 触发灵力见底并锁普通技能
test("大招阈值：命中使敌 HP≤30% 后 phase=ult", function () {
  var st = core.createBattle(mkCfg({ enemyHp: 100, heroAtk: 95, rand: makeRand([0.5]) }));
  core.chooseSkill(st, 0);
  var r = core.resolveSkill(st, true);
  assert.strictEqual(r.result, "ult");
  assert.strictEqual(st.phase, "ult");
  assert.strictEqual(st.ult.unlocked, true);
});

test("大招正确：一击制胜 phase=win", function () {
  var st = core.createBattle(mkCfg({ enemyHp: 20 }));
  st.phase = "ult";
  var r = core.resolveUlt(st, true);
  assert.strictEqual(r.result, "win");
  assert.strictEqual(st.hp.enemy, 0);
  assert.strictEqual(st.phase, "win");
});

test("大招写错：反噬扣血且可重试", function () {
  var st = core.createBattle(mkCfg({ enemyHp: 20, heroHp: 100, shield: false }));
  st.phase = "ult";
  var hp = st.hp.hero;
  var r = core.resolveUlt(st, false);
  assert.strictEqual(r.result, "miss");
  assert.ok(st.hp.hero < hp);
  assert.strictEqual(st.phase, "ult");
  assert.strictEqual(st.ult.misses, 1);
});

// 8) 技能槽用后补位（同主题、槽数不变）
test("技能槽用后自动补位", function () {
  var st = core.createBattle(mkCfg({ enemyHp: 500 }));
  var oldKey = st.slots[0].qKey;
  core.chooseSkill(st, 0);
  core.resolveSkill(st, true);
  assert.strictEqual(st.slots.length, 4);
  assert.notStrictEqual(st.slots[0].qKey, oldKey);
});

// 9) 失败重试：全量重置
test("失败重试：HP/phase 重置，新题不串旧档", function () {
  var cfg = mkCfg({ enemyHp: 500, heroHp: 10, shield: false });
  var st = core.createBattle(cfg);
  st.phase = "enemy";
  core.enemyAct(st); // 可能攻击致死；直接再强制到 hp=0 场景
  st.hp.hero = 0;
  st.phase = "lose";
  var again = core.retry(st);
  assert.strictEqual(again.hp.hero, cfg.heroHp);
  assert.strictEqual(again.hp.enemy, cfg.enemyHp);
  assert.strictEqual(again.phase, "choose");
  assert.notStrictEqual(again, st);
});

// 10) 边界：敌方 HP 归零立即胜利；我方 HP 归零失败
test("边界：命中使敌方 HP=0 → win", function () {
  var st = core.createBattle(mkCfg({ enemyHp: 10, heroAtk: 100 }));
  core.chooseSkill(st, 0);
  var r = core.resolveSkill(st, true);
  assert.strictEqual(r.result, "win");
  assert.strictEqual(st.phase, "win");
});

test("边界：我方 HP 归零 → lose", function () {
  var st = core.createBattle(mkCfg({ heroHp: 2, shield: false }));
  st.phase = "ult";
  var r = core.resolveUlt(st, false);
  assert.strictEqual(r.result, "lose");
  assert.strictEqual(st.phase, "lose");
});

console.log("[SUMMARY] PASS " + passed + " / FAIL " + failed);
process.exitCode = failed ? 1 : 0;
