// ===== 构建 EN→JA / EN→ZH 反向词典索引 =====
// 数据源:JMdict(EDRDG, CC BY-SA)+ CC-CEDICT(MDBG, CC BY-SA)
// 输出:data/dict_en_ja.json.gz / data/dict_en_zh.json.gz
//   { "sea urchin": ["ウニ", ...], "fart": ["おなら", ...] }
// 排序:JMdict 用 priority 标签(news1/ichi1/spec1/nfXX);CEDICT 用首义优先。
import { readFileSync, writeFileSync } from 'fs';
import { gunzipSync, gzipSync } from 'zlib';

// —— 英文 gloss 规范化:小写、去括号注释、去 to/a/the 前缀 ——
function normGloss(g) {
  const hadQualifier = /[({]/.test(g);   // 带括号限定语的释义(口语/贬义/方言)排序降权
  let raw = g.toLowerCase().trim();
  raw = raw.replace(/\([^)]*\)/g, " ").replace(/\{[^}]*\}/g, " ");
  raw = raw.replace(/[^a-z'\- ]/g, " ").replace(/\s+/g, " ").trim();
  // 剥前缀键(to do 类不定式释义用):to the point → point
  let s = raw.replace(/^to\s+/, "").replace(/^(a|an|the)\s+/, "");
  if (!s || s.length < 2) return null;
  if (s.split(" ").length > 4) return null;
  // 习语保护:剥了前缀的多词释义,原始完整形态也要入索引
  // ("to the point"/"a piece of cake" 这类以 to/a/the 开头的习语,剥掉就毁了)
  const extraKey = (raw !== s && raw.includes(" ") && raw.split(" ").length <= 4) ? raw : null;
  return { key: s, hadQualifier, extraKey };
}

// ========== JMdict ==========
console.log("解析 JMdict ...");
const xml = gunzipSync(readFileSync("/tmp/JMdict_e.gz")).toString("utf-8");
const jaIndex = new Map();   // gloss → [{word, score}]
const entries = xml.split("<entry>").slice(1);
console.log("条目:", entries.length);
for (const e of entries) {
  // 词形:优先第一个 keb(汉字),否则第一个 reb(假名)
  const keb = e.match(/<keb>([^<]+)<\/keb>/);
  const reb = e.match(/<reb>([^<]+)<\/reb>/);
  const word = keb ? `${keb[1]}` : (reb ? reb[1] : null);
  if (!word) continue;
  // priority 分数:news1/ichi1/spec1=3, news2/ichi2/spec2/gai1=2, nfXX=1, 无=0
  let score = 0;
  for (const m of e.matchAll(/<(?:ke|re)_pri>([^<]+)<\/(?:ke|re)_pri>/g)) {
    const p = m[1];
    if (/^(news1|ichi1|spec1)$/.test(p)) score = Math.max(score, 3);
    else if (/^(news2|ichi2|spec2|gai1)$/.test(p)) score = Math.max(score, 2);
    else if (/^nf\d+$/.test(p)) score = Math.max(score, 1);
  }
  // 每个 sense 的 gloss;只取前 2 个 sense(后面往往是引申义)
  const senses = e.split("<sense>").slice(1, 3);
  senses.forEach((s, si) => {
    for (const g of s.matchAll(/<gloss>([^<]+)<\/gloss>/g)) {
      const ng = normGloss(g[1]);
      if (!ng) continue;
      for (const key of [ng.key, ng.extraKey].filter(Boolean)) {
        if (!jaIndex.has(key)) jaIndex.set(key, []);
        jaIndex.get(key).push({ word, score: score * 10 - si - (ng.hadQualifier ? 50 : 0) });
      }
    }
  });
}
// 每个键取分数最高的前 3 个不重复词
const jaOut = {};
for (const [k, arr] of jaIndex) {
  arr.sort((a, b) => b.score - a.score);
  const seen = new Set(); const top = [];
  for (const { word } of arr) { if (!seen.has(word)) { seen.add(word); top.push(word); if (top.length === 3) break; } }
  jaOut[k] = top;
}
console.log("EN→JA 键数:", Object.keys(jaOut).length);
writeFileSync("data/dict_en_ja.json.gz", gzipSync(JSON.stringify(jaOut)));

// ========== CC-CEDICT ==========
console.log("解析 CC-CEDICT ...");
const ced = gunzipSync(readFileSync("/tmp/cedict.txt.gz")).toString("utf-8");
const zhIndex = new Map();   // gloss → [{trad, simp, score}]
let lines = 0;
for (let line of ced.split("\n")) {
  line = line.replace(/\r$/, "");
  if (!line || line.startsWith("#")) continue;
  const m = line.match(/^(\S+) (\S+) \[[^\]]*\] \/(.+)\/$/);
  if (!m) continue;
  lines++;
  const [, trad, simp, glossPart] = m;
  if (/[A-Za-z0-9]/.test(simp)) continue;          // 跳过含字母数字的词条
  const glosses = glossPart.split("/");
  glosses.slice(0, 3).forEach((g, gi) => {
    if (/^(variant of|old variant|see [A-Za-z一-鿿]|abbr\.|CL:)/.test(g)) return;
    const ng = normGloss(g);
    if (!ng) return;
    for (const key of [ng.key, ng.extraKey].filter(Boolean)) {
      if (!zhIndex.has(key)) zhIndex.set(key, []);
      zhIndex.get(key).push({ trad, simp, score: -gi * 10 - simp.length - (ng.hadQualifier ? 100 : 0) });
    }
  });
}
console.log("CEDICT 行数:", lines);
const zhOut = {};
for (const [k, arr] of zhIndex) {
  arr.sort((a, b) => b.score - a.score);
  const seen = new Set(); const top = [];
  for (const { trad, simp } of arr) {
    if (seen.has(simp)) continue; seen.add(simp);
    top.push([simp, trad]); if (top.length === 3) break;
  }
  zhOut[k] = top;   // [[简, 繁], ...]
}
console.log("EN→ZH 键数:", Object.keys(zhOut).length);
writeFileSync("data/dict_en_zh.json.gz", gzipSync(JSON.stringify(zhOut)));
console.log("完成");
