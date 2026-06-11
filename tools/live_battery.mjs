// ===== 实测层:20 句覆盖各类语法,自动核查 4 项指标 =====
import { readFileSync } from 'fs';
const T = JSON.parse(readFileSync('templates.json'));
const TEMPLATE_NAMES = new Set(T.templates);

// —— 与服务端一致的匹配器(用于"泄漏"检查)——
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PLACEHOLDER = new Set(["sb","sth","adj","adv","one","ving","ved","verb","noun","wh","etc","do","doing","done","x","y","n","v"]);
const IRR = {have:["have","has","had","having"],get:["get","gets","got","gotten","getting"],make:["make","makes","made","making"],take:["take","takes","took","taken","taking"],keep:["keep","keeps","kept","keeping"],go:["go","goes","went","gone","going"],come:["come","comes","came","coming"],feel:["feel","feels","felt","feeling"],think:["think","thinks","thought","thinking"],say:["say","says","said","saying"],see:["see","sees","saw","seen","seeing"],know:["know","knows","knew","known","knowing"],let:["let","lets","letting"],find:["find","finds","found","finding"],give:["give","gives","gave","given","giving"],tell:["tell","tells","told","telling"],leave:["leave","leaves","left","leaving"],pay:["pay","pays","paid","paying"],spend:["spend","spends","spent","spending"],lose:["lose","loses","lost","losing"],catch:["catch","catches","caught","catching"],put:["put","puts","putting"],run:["run","runs","ran","running"],cut:["cut","cuts","cutting"],begin:["begin","begins","began","begun"],write:["write","writes","wrote","written"],bring:["bring","brings","brought","bringing"],buy:["buy","buys","bought","buying"],hold:["hold","holds","held","holding"],stand:["stand","stands","stood","standing"]};
const ALT = {"can't":["can't","cannot","can not"],"won't":["won't","will not"],"i'd":["i'd","i would","i had"],"you'd":["you'd","you would","you had"],"it's":["it's","it is","it has"],"i'm":["i'm","i am"],"would've":["would've","would have"],"one's":["one's","his","her","my","your","our","their","its"]};
function matcher(translation) {
  const runs = (seg) => { const rs=[]; let cur=[]; const re=/[A-Za-z']+/g; let m,le=-1;
    while((m=re.exec(seg))!==null){const tok=m[0];const adj=le>=0&&/^\s*$/.test(seg.slice(le,m.index));
      if(PLACEHOLDER.has(tok.toLowerCase())){if(cur.length){rs.push(cur);cur=[];}}
      else if(adj&&cur.length)cur.push(tok);else{if(cur.length)rs.push(cur);cur=[tok];}le=m.index+tok.length;}
    if(cur.length)rs.push(cur);return rs;};
  const tp=(t)=>{const tl=t.toLowerCase();
    if(tl==="be")return "(?:be|is|am|are|was|were|been|being)";
    if(IRR[tl])return `(?:${IRR[tl].join("|")})`;
    if(ALT[tl])return `(?:${ALT[tl].map(a=>escapeRe(a).replace(/ /g,"\\s+")).join("|")})`;
    if(tl.endsWith("n't")){const s=tl.slice(0,-3);return `(?:${escapeRe(tl)}|${escapeRe(s)}\\s+not)`;}
    return escapeRe(t)+"(?:s|es|d|ed|ing)?";};
  const pin=(run)=>new RegExp(`(^|[^A-Za-z])${run.map(tp).join("\\s+")}([^A-Za-z]|$)`,"i").test(translation);
  return (name)=>{const alts=String(name).split(/\/|(?:^|\s)vs(?:\s|$)/i).map(runs);
    if(!alts.some(a=>a.length>0))return true;
    return alts.some(a=>a.length>0&&a.every(pin));};
}

// —— 20 句测试集:每句标注「期望识别的语法概念」(软指标,按名称关键字匹配)——
const CASES = [
  ["这本书是他写的。", ["被动","passive","written"]],
  ["我过去常常每天跑步。", ["used to"]],
  ["这个箱子太重了我搬不动。", ["too"]],
  ["他跑得太快了,我们都追不上他。", ["so","that","too"]],
  ["比起咖啡我更喜欢茶。", ["prefer","比"]],
  ["我宁愿走路也不愿坐公交。", ["rather"]],
  ["你最好早点睡觉。", ["had better","你最好"]],
  ["他不仅会唱歌还会跳舞。", ["not only"]],
  ["我一到家就给你打电话。", ["as soon as","一...就"]],
  ["如果我是你,我就不会去。", ["if","虚拟","条件"]],
  ["她昨天照顾了她生病的妹妹。", ["take care","照顾"]],
  ["他终于下定决心出国留学了。", ["make up","decide","决心","decide to"]],
  ["我忍不住笑了出来。", ["can't help","couldn't help","忍不住"]],
  ["这部电影值得一看。", ["worth"]],
  ["他去年戒烟了。", ["give up","quit","戒"]],
  ["要是我有更多时间就好了!", ["if only","wish","但愿"]],
  ["天气越来越冷了。", ["越来越","比较级","getting"]],
  ["他看起来好像生病了。", ["as if","seem","look"]],
  ["我习惯了早起。", ["used to","习惯","be used to"]],
  ["多漂亮的花啊!", ["感叹","What","How"]],
];


// 检测器注入白名单:服务端有意做宽匹配的结构(couldn't help → can't help 模板等),
// 泄漏检查时跳过 —— 与 server.js 的 STRUCTURE_DETECTORS 保持同步
const DETECTOR_OK = [
  { re: /\bnot only\b[\s\S]{0,80}?\bbut(\s+also)?\b/i, tpl: "关联连词(either...or / neither...nor / not only...but also)" },
  { re: /\b(am|is|are|was|were|been|being|get|gets|got|getting)\s+used\s+to\b/i, tpl: "used to do vs be used to doing" },
  { re: /\b(can't|cannot|can not|couldn't|could not)\s+help\b/i, tpl: "can't help doing(忍不住)" },
  { re: /\bso\s+[A-Za-z]+\s+that\b/i, tpl: "so + 形容词 + that 从句" },
  { re: /\btoo\s+[A-Za-z]+\s+(for\s+[A-Za-z]+\s+)?to\s+[A-Za-z]+/i, tpl: "too + 形容词 + to do" },
  { re: /\b(am|is|are|was|were)\s+worth\s+[A-Za-z]+ing\b/i, tpl: "it's worth + doing(值得做)" },
];
const fails = { leak: [], trigger: [], chunk: [] };
let conceptHits = 0, total = 0;
for (const [src, concepts] of CASES) {
  total++;
  let r;
  try {
    const resp = await fetch("https://howtosay-proxy-production.up.railway.app/translate", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({sourceText: src, style: "standard", sourceLanguage: "Simplified Chinese"}),
      signal: AbortSignal.timeout(70000)
    });
    r = await resp.json();
  } catch(e) { console.log("✗ 请求失败:", src, String(e).slice(0,80)); continue; }
  if (!r.translation) { console.log("✗ 无译文:", src, JSON.stringify(r).slice(0,100)); continue; }
  const tl = r.translation;
  const check = matcher(tl);
  const gp = r.grammarPoints || [];
  // A. 泄漏:模板点的名字必须匹配译文
  for (const g of gp) {
    const detectorOK = DETECTOR_OK.some(d => d.tpl === g.name && d.re.test(tl));
    if (g.isTemplate && TEMPLATE_NAMES.has(g.name) && !check(g.name) && !detectorOK) {
      fails.leak.push(`[${src}] ${g.name} ⊄ "${tl}"`);
    }
    // B. 触发词必须在译文里
    for (const t of (g.triggerWords||[])) {
      if (!new RegExp(`(^|[^A-Za-z])${escapeRe(t.trim())}([^A-Za-z]|$)`,"i").test(tl)) {
        fails.trigger.push(`[${src}] trigger "${t}" ∉ 译文`);
      }
    }
  }
  // C. 语法块覆盖
  const norm = s => s.trim().toLowerCase();
  for (const w of (r.words||[])) {
    if (!w.isGrammarStructure) continue;
    const ct = norm(w.english).split(/\s+/);
    const covered = gp.some(g => { const tr=(g.triggerWords||[]).map(norm);
      return tr.includes(norm(w.english)) || ct.every(x=>tr.includes(x)); });
    if (!covered) fails.chunk.push(`[${src}] 块 "${w.english}" 无详解条目`);
  }
  // D. 软指标:期望概念命中
  const names = gp.map(g=>g.name).join(" | ");
  const hit = concepts.some(c => names.toLowerCase().includes(c.toLowerCase()) || (c.length<=12 && tl.toLowerCase().includes(c.toLowerCase()) && false));
  if (hit) conceptHits++;
  console.log((hit?"○":"·"), src.slice(0,18), "→", tl.slice(0,50), "|| GP:", names || "(无)");
}
console.log("\n========== 汇总 ==========");
console.log("硬指标 A 校验泄漏:", fails.leak.length, fails.leak.slice(0,5));
console.log("硬指标 B 触发词缺失:", fails.trigger.length, fails.trigger.slice(0,5));
console.log("硬指标 C 语法块未覆盖:", fails.chunk.length, fails.chunk.slice(0,5));
console.log(`软指标 D 目标语法识别率: ${conceptHits}/${total}`);
