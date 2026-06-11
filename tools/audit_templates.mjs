// ===== 离线审计:全部模板名过一遍词组解析器,按风险分类 =====
import { readFileSync } from 'fs';
const T = JSON.parse(readFileSync('templates.json'));
const NAMES = T.templates;

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PLACEHOLDER = new Set(["sb","sth","adj","adv","one","ving","ved","verb","noun","wh","etc","do","doing","done","x","y"]);
const phraseRuns = (segment) => {
  const runs = []; let cur = [];
  const re = /[A-Za-z']+/g; let m, lastEnd = -1;
  while ((m = re.exec(segment)) !== null) {
    const tok = m[0];
    const adjacent = lastEnd >= 0 && /^\s*$/.test(segment.slice(lastEnd, m.index));
    if (PLACEHOLDER.has(tok.toLowerCase())) { if (cur.length) { runs.push(cur); cur = []; } }
    else if (adjacent && cur.length) cur.push(tok);
    else { if (cur.length) runs.push(cur); cur = [tok]; }
    lastEnd = m.index + tok.length;
  }
  if (cur.length) runs.push(cur);
  return runs;
};

// 不规则动词表:后缀容忍 (s|es|d|ed|ing) 救不了的变位
const IRREGULAR = {
  have:["has","had","having"], get:["gets","got","gotten","getting"],
  make:["makes","made","making"], take:["takes","took","taken","taking"],
  keep:["keeps","kept","keeping"], go:["goes","went","gone","going"],
  come:["comes","came","coming"], feel:["feels","felt","feeling"],
  think:["thinks","thought","thinking"], say:["says","said","saying"],
  see:["sees","saw","seen","seeing"], know:["knows","knew","known","knowing"],
  let:["lets","letting"], find:["finds","found","finding"],
  give:["gives","gave","given","giving"], tell:["tells","told","telling"],
  leave:["leaves","left","leaving"], pay:["pays","paid","paying"],
  spend:["spends","spent","spending"], lose:["loses","lost","losing"],
  catch:["catches","caught"], stop:["stops","stopped","stopping"],
  put:["puts","putting"], cut:["cuts","cutting"], run:["runs","ran","running"],
  begin:["begins","began","begun"], write:["writes","wrote","written"],
};
const COMMON_WEAK = new Set(["the","to","it","a","an","and","or","of","in","on","at","as","is","be","for","not","no","so","that","this","there","what","how","all","by","with"]);

let irregularRisk = [], weakOnly = [], noEnglish = [], slashCheck = [], apostrophe = [];
for (const name of NAMES) {
  const alts = name.split("/").map(phraseRuns);
  const allRuns = alts.flat();
  if (!allRuns.length) { noEnglish.push(name); continue; }
  // 含不规则动词的词组(变位时会被误杀)
  const irr = allRuns.flat().filter(t => IRREGULAR[t.toLowerCase()]);
  if (irr.length) irregularRisk.push(`${name}  ← 不规则动词: ${irr.join(",")}`);
  // 全部词组都是超常见弱词(几乎任何译文都会放行 → 校验失效但无害,记录)
  if (allRuns.every(run => run.every(t => COMMON_WEAK.has(t.toLowerCase())))) weakOnly.push(name);
  // 带 / 的名字,检查切分是否产生了空英文侧
  if (name.includes("/")) {
    const sides = name.split("/").map(s => phraseRuns(s));
    if (sides.some(s => !s.length)) slashCheck.push(`${name}  ← 某侧无英文词组`);
  }
  // 缩写词(can't 等):若译文用展开形式会被误杀
  if (allRuns.flat().some(t => t.includes("'"))) apostrophe.push(name);
}

console.log("=== ① 不规则动词风险(变位形式会被误杀,必须修)===");
irregularRisk.forEach(s=>console.log("  "+s));
console.log("\n=== ② 缩写词风险(can't vs cannot)===");
apostrophe.forEach(s=>console.log("  "+s));
console.log("\n=== ③ / 切分异常 ===");
slashCheck.forEach(s=>console.log("  "+s));
console.log("\n=== ④ 纯弱词模板(校验形同虚设,靠 triggerWords 把关,记录在案)===");
weakOnly.forEach(s=>console.log("  "+s));
console.log("\n=== ⑤ 无英文词组(纯中文名,校验跳过)===");
console.log("  共", noEnglish.length, "个:", noEnglish.slice(0,8).join(" | "), "...");
console.log("\n统计: 总模板", NAMES.length, "| 不规则风险", irregularRisk.length, "| 缩写", apostrophe.length, "| 弱词", weakOnly.length, "| 纯中文", noEnglish.length);
