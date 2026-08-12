import { readFileSync } from "node:fs";
const src = readFileSync("./zh-routes.js","utf-8");
// 抠出 G_RULES 表和 matchesRule,在沙箱里跑
const body = src.slice(src.indexOf("const G_RULES = ["), src.indexOf("const G_FAMILY"));
const G = new Function(body + "; return {G_RULES, matchesRule};")();
const hit = (t) => G.G_RULES.filter(r => G.matchesRule(r, t)).map(r => r.tpl);

const CASES = [
  // [句子, 必须出现, 必须不出现]
  ["对不起,我来晚了。", [], ["Potential complement V不C"]],
  ["我今天不开心。",     [], ["Potential complement V不C"]],
  ["他很不高兴。",       [], ["Potential complement V不C"]],
  ["这个箱子我搬不动。", ["Potential complement V不C"], []],
  ["门打不开了。",       ["Potential complement V不C"], []],
  // 繁體:見/會/錯/一樣 不该被单字命中
  ["我們明天見面吧。",   [], ["Result complement 见"]],
  ["這是我的意見。",     [], ["Result complement 见"]],
  ["我看見他了。",       ["Result complement 见"], []],
  ["他會說中文。",       [], ["Result complement 会"]],
  ["我學會了。",         ["Result complement 会"], []],
  ["這個答案錯了。",     [], ["Result complement 错"]],
  ["我寫錯了。",         ["Result complement 错"], []],
  ["這兩件一樣貴。",     [], ["Equality 跟…一样"]],
  ["他跟我一樣高。",     ["Equality 跟…一样"], []],
  // 繁體:过/着/离/还是/没有 以前完全命不中
  ["我去過北京。",       ["Experience 过"], []],
  ["門開著。",           ["Continuing state 着"], []],
  ["我家離公司很近。",   ["Distance 离"], []],
  ["你喝茶還是咖啡?",    ["Alternative question 还是"], []],
  ["我沒有他那麼高。",   ["Negative comparison 没有"], []],
  // 简体对照组不能退化
  ["我去过北京。",       ["Experience 过"], []],
  ["门开着。",           ["Continuing state 着"], []],
  ["我家离公司很近。",   ["Distance 离"], []],
  ["你喝茶还是咖啡?",    ["Alternative question 还是"], []],
  ["我没有他那么高。",   ["Negative comparison 没有"], []],

  // —— 验证时点出的反例 ——
  ["对不起,我听不懂你说的话。", ["Potential complement V不C"], []],   // deny 不能误杀同句合法的 听不懂
  ["对不起。",                 [], ["Potential complement V不C"]],
  ["他不耐烦地走了。",          [], ["Potential complement V不C"]],
  ["我看说话了。",             [], ["Verb reduplication VV/V一V"]],   // {2} 曾让「看说」命中
  ["我们看看吧。",             ["Verb reduplication VV/V一V"], []],
  ["你說一說。",               ["Verb reduplication VV/V一V"], []],   // 繁體 V一V
  ["你來不來?",                ["A-not-A question"], []],            // 繁體 來不來
  ["你来不来?",                ["A-not-A question"], []],
  ["我沒有他那麼高。",          ["Negative comparison 没有"], []],
  ["這個房間很髒。",           ["Adjective predicate 很"], []],       // 繁體「髒」
  ["讓爺爺休息一下。",          ["Pivotal 兼语句"], []],
  ["我沒看見他。",             ["Negation 没 + V + complement"], []],

  // —— 终检查出的误判(必须不出现)——
  ["我觉得这个很难。",      [], ["Degree complement 得"]],
  ["我记得他的名字。",      [], ["Degree complement 得"]],
  ["这本书值得一读。",      [], ["Degree complement 得"]],
  ["我得走了。",           [], ["Degree complement 得"]],
  ["我去地铁站接你。",      [], ["Adverbial 地"]],
  ["我在地上找到了钥匙。",   [], ["Adverbial 地"]],
  ["当地的菜很好吃。",      [], ["Adverbial 地"]],
  ["我今天很累,但还是想去跑步。", [], ["Alternative question 还是"]],
  ["他还是没来。",         [], ["Alternative question 还是"]],
  ["你还是早点休息吧。",     [], ["Alternative question 还是"]],
  ["爸爸妈妈都来了。",      [], ["Adjective reduplication AABB"]],
  ["哥哥姐姐在家。",       [], ["Adjective reduplication AABB"]],
  ["我明天不上班。",       [], ["Potential complement V不C"]],
  ["他今天不来。",         [], ["Potential complement V不C"]],
  // —— 必须仍然命中(不能误杀)——
  ["他跑得很快。",         ["Degree complement 得"], []],
  ["她说得很流利。",        ["Degree complement 得"], []],
  ["他高兴地跳起来。",      ["Adverbial 地"], []],
  ["他认真地看书。",        ["Adverbial 地"], []],
  ["你喝茶还是喝咖啡?",     ["Alternative question 还是"], []],
  ["他是老师还是学生?",     ["Alternative question 还是"], []],
  ["把房间打扫得干干净净。",  ["Adjective reduplication AABB"], []],
  ["这个箱子我搬不动。",     ["Potential complement V不C"], []],
  ["我听不懂中文。",        ["Potential complement V不C"], []],
  ["我在吃饭。",           ["Progressive 在/正在"], []],
  ["他在看书。",           ["Progressive 在/正在"], []],
  ["我正在工作。",         ["Progressive 在/正在"], []],
];
let bad=0;
for (const [t, must, mustNot] of CASES) {
  const h = hit(t);
  const miss = must.filter(m=>!h.includes(m));
  const extra = mustNot.filter(m=>h.includes(m));
  const ok = !miss.length && !extra.length;
  if (!ok) bad++;
  console.log(`${ok?"✅":"❌"} ${t.padEnd(18)} ${miss.length?"缺:"+miss:""} ${extra.length?"误报:"+extra:""}`);
}
console.log(bad ? `\n❌ ${bad} 条不通过` : `\n✅ ${CASES.length} 条全部通过`);
process.exit(bad?1:0);
