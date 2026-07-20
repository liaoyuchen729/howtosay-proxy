// zh-routes.js — How to Say 中文版路由(挂在同一个 Railway 服务上)
//
// 目标语言 = 中文(简体/繁体由 body.script 决定),源语言 = 用户母语(英/日/韩/越/泰/印尼/西)。
// 复用 server.js 传入的 openAIJSON / MODEL / DICT_MODEL / 缓存 / 鉴权 —— 只做增量,不动英文版路由。
//
// 挂载:在 server.js 末尾加一行
//   import { mountZhRoutes } from "./zh-routes.js";
//   mountZhRoutes(app, { openAIJSON, MODEL, DICT_MODEL, APP_SHARED_SECRET,
//                        monthKey, cacheSweep, cachePut, sendToAxiom, CACHE_MAX });
//
// App 端点约定(见 HowToSayZh/Services/TranslationAPI.swift):
//   POST /zh/translate-fast       { sourceText, style, sourceLanguage, script } -> { translation }
//   POST /zh/translate            { sourceText, style, sourceLanguage, sourceLanguageCode, givenTranslation?, script }
//                                 -> { translation, words[], grammarPoints[] }
//   POST /zh/word-definition      { chinese, partOfSpeech, context, sourceLanguage } -> { definition, pinyin }   (永久缓存)
//   POST /zh/word-example         { chinese, definition, sourceLanguage, script, context? } -> { zh, gloss, pinyin }  (月度缓存)
//   POST /zh/sentence-translation { sentence, sourceLanguage } -> { translation }   (永久缓存)
//   POST /zh/grammar-detail       { name, sourceLanguage, script } -> { name, meaning, structure, examples[] }  (月度缓存)
//   POST /zh/feedback             fire-and-forget

// —— 词性枚举(与 App 的 PartOfSpeech.rawValue 完全一致)——
const POS_ZH = ["noun","verb","adjective","adverb","pronoun","preposition","conjunction",
  "measureWord","particle","auxiliary","interjection","number","idiom","unknown"];

// —— 本地语法模板名清单(与 App GrammarDB 的 name 一一对应;模型据此挑 templateKey)——
const TEMPLATE_NAMES_ZH = ["把 sentence: basic","把 + 在/到 + place","把 + 给","把 + 成/作","Negation before 把","Passive 被","Passive 被 without doer","Passive 让/叫","Negation before 被","是…的: time","是…的: place","是…的: means","Result complement 完","Result complement 到","Result complement 见","Result complement 懂","Result complement 好","Result complement 错","Result complement 会","Negation 没 + V + complement","Direction complement 来/去","Compound direction complement","Direction complement with place","Extended 起来","Extended 下去","Potential complement V得C","Potential complement V不C","Capacity 得下/不下","Degree complement 得很/极了","Duration complement","Frequency complement 次/遍","太…了","V + 一下","Modal 会 (skill)","Modal 会 (likelihood)","Modal 能","Modal 可以","Modal 要 (want/going to)","Modal 想","Modal 应该","Modal 得 děi","不用 (no need)","Modal 敢","Comparison 比","比 + degree","Equality 跟…一样","Negative comparison 没有","不比 (not more than)","越来越","越…越…","Superlative 最","Existential 有","Existential 是","Existential V着","Serial verbs 连动句","Pivotal 兼语句","Double objects","Time before verb","Location 在 + place + V","Measure word structure","Verbal measure 次/遍","Verb reduplication VV/V一V","Verb reduplication V了V","Adjective reduplication AABB","有点儿 vs 一点儿","Distance 离","因为…所以…","虽然…但是…","如果…就…","一…就…","先…再…","又…又…","一边…一边…","不但…而且…","只要…就…","除了…以外","连…都/也…","对…来说","跟/和…一起","为了…","不是…而是…","Completion 了","Change-of-state 了","Negation 没(有)","Experience 过","Negation 没…过","Continuing state 着","V1着 V2","Progressive 在/正在","Modification 的","Adverbial 地","Degree complement 得","Question particle 吗","Follow-up particle 呢","Suggestion particle 吧","Exclamation particle 啊","About to happen 快…了/要…了","Just now 刚/刚才","就 (earlier than expected)","才 (later than expected)","再 vs 又","Yes/no question 吗","A-not-A question","Question word 什么","Question word 谁","Question words 哪儿/哪里","Question word 怎么","Question words 几/多少","How + adjective 多","V过没有 question"];
const TEMPLATE_ENUM_ZH = ["", ...TEMPLATE_NAMES_ZH];

// —— 风格描述(中文语体)——
function styleDescZh(style) {
  switch (style) {
    case "casual":
      return "casual, conversational Mandarin — how you'd text or chat with a friend. " +
        "Use everyday words and tone particles where natural (呢/啊/吧/嘛). Relaxed and natural. " +
        "It MUST read clearly different from the standard/formal version. Translate only what the source says; " +
        "do NOT add greetings or fillers unless the source has them.";
    case "formal":
      return "formal, polite, written-register Mandarin — the way you'd write a professional message. " +
        "Use full, polished vocabulary and complete sentences. No slang, no tone particles. " +
        "Clearly more elevated than the standard version (您 instead of 你 when addressing someone, 请/敬请 etc. where natural).";
    case "concise":
      return "as short and punchy as possible while keeping the core meaning, and clearly shorter than the standard " +
        "version. Drop optional words. Fewest characters possible.";
    default:
      return "standard, natural, neutral Mandarin — what a learner would expect from a good textbook or dictionary. " +
        "Balanced and idiomatic, neither stiff nor slangy.";
  }
}

// —— 简繁 ——
function scriptName(script) {
  return (script === "Hant" || script === "zh-Hant") ? "Traditional Chinese characters" : "Simplified Chinese characters";
}

// —— /zh/translate 的 system prompt（按 源语言+简繁 静态，吃 prompt 缓存）——
function systemPromptZh(srcLang, script) {
  const target = `natural Mandarin Chinese, written in ${scriptName(script)}`;
  return `You are the translation + linguistic-annotation engine for a Chinese-learning app called "How to Say".\n` +
    `The user writes in ${srcLang}; translate it into ${target}, and annotate it for a ${srcLang}-speaking learner of Chinese.\n` +
    `Return ONLY JSON matching the schema.\n\n` +
    `Rules:\n` +
    `- translation: a Chinese translation of the input, in the STYLE given at the top of the user message. ` +
    `Pick wording clearly distinct from the other three styles.\n` +
    `- words: split the Chinese translation into meaningful units IN ORDER, together covering the whole translation.\n` +
    `  SPLITTING — units that BELONG TOGETHER stay ONE unit (they express one source concept jointly):\n` +
    `  • number/demonstrative + measure word: 三本 / 两只 / 一个 / 这部 / 那条 = ONE unit (never 三 + 本). The noun stays separate: 三本 + 书.\n` +
    `  • verb + aspect 了/过: 买了 / 去过 = ONE unit (bought / been to are single source words).\n` +
    `  • modal + verb when the source is ONE potential/negative form: 会弹←弾けます, 不会说←話せません, 不懂←分かりません, 没睡着←眠れなかった = ONE unit each.\n` +
    `  • pronoun + 的 possessive: 我的←mine/my, 她的←her = ONE unit.\n` +
    `  • multi-word time expressions: 今天早上←this morning, 每天早上←毎朝 = ONE unit.\n` +
    `  • idioms / set phrases / chengyu = ONE unit (partOfSpeech "idiom").\n` +
    `  Otherwise a content word is its own unit ("很累" → "很" + "累").\n` +
    `  Grammar structures (把…、被…、是…的、V得C、越来越…) are marked isGrammarStructure=true; keep them minimal.\n` +
    `  For each unit:\n` +
    `  • chinese: its Chinese text (in ${scriptName(script)}).\n` +
    `  • pinyin: Hanyu Pinyin WITH TONE MARKS for this unit (e.g. "hěn", "pǎo bù"). For a non-Chinese unit use "".\n` +
    `  • partOfSpeech: exactly one of [${POS_ZH.join(", ")}].\n` +
    `  • sourceSpan — STRICT ALIGNMENT RULES (getting these wrong breaks the app; follow exactly):\n` +
    `    A. sourceSpan is a CONTIGUOUS substring COPIED CHARACTER-FOR-CHARACTER from the user's ORIGINAL input. ` +
    `Never paraphrase, translate, normalize, or invent text that is not literally in the input.\n` +
    `    B. Align by MEANING, not position. Map each Chinese unit to the SHORTEST source substring carrying that meaning.\n` +
    `    C. "" (no counterpart) is NORMAL and CORRECT — never force a match. In particular:\n` +
    `       · ${srcLang === "Japanese" ? "Japanese usually OMITS the subject: added 我/你/我们 → \"\" unless 私/あなた/彼 etc. is literally present. NEVER align 我 to an unrelated word."
              : srcLang === "Korean" ? "Korean often omits the subject: added 我/你 → \"\" unless 저/나/당신 etc. is present. Strip particles 은/는/이/가/을/를/에서 from spans (저는→저)."
              : srcLang === "Spanish" ? "Spanish drops subject pronouns (hablo = 我说): added 我/你/他 → \"\" unless yo/tú/él etc. is literally present — never align a pronoun to a conjugated verb."
              : "Added pronouns/particles with no counterpart → \"\"."}\n` +
    `       · Chinese-added words → "": structural 的/地/得 (relative-clause 的, adverbial 地), added 都/也/就/还, ` +
    `added coverb 在 when the localizer 上/里 already claims the source preposition, added nouns like 钱 in 多少钱←how much.\n` +
    `    D. Each source substring may be claimed by AT MOST ONE unit — never let two units share a span. ` +
    `If two Chinese words jointly translate one source word, make them ONE unit (see SPLITTING) instead of duplicating.\n` +
    `    E. Align function words to their true counterparts when present:\n` +
    `       · copula 是 ← is/am/are${srcLang === "Japanese" ? "/です/だ" : ""} (only "" when the source truly has no copula; never align 是 to a non-copula で).\n` +
    `       · 吗 ← ${srcLang === "Japanese" ? "か;  吧 ← ましょう/ませんか;  既…又 ← …し…し;  如果 ← たら/れば (just the conditional ending, e.g. 如果←たら NOT いらっしゃったら);  即使 ← ても/であれ" : "the question auxiliary do/did only if nothing else fits, else \"\";  吧 ← let's"}.\n` +
    `       · locative/instrumental: 在 ← ${srcLang === "Japanese" ? "で (locative particle)" : "in/at"}, 上 ← on, 里 ← in;  坐 ← ${srcLang === "Japanese" ? "instrumental で or \"\"" : "by"};  被 ← by (passive agent);  把 ← "".\n` +
    `       · ${srcLang === "Japanese" ? "compound verbs SPLIT: 持って行って → 带←持って + 去←行って;  たい→想;  strip particles は/が/を/に/も/の from spans (彼→他 NOT 彼は)" : "verb inflections: align the inflected form (去←goes is fine), but each form only once"}.\n` +
    `    F. Splitting & collocation rules (from human annotation):\n` +
    `       · X的Y ALWAYS splits: X + 的("") + Y — never glue 的 into either side (except pronoun possessive 我的). 一只狗 + 的 + 形状, 桌子 + 上 + 的 + 书 (上←on, 的←"").\n` +
    `${srcLang === "English"
        ? "       · verb+preposition collocations align WHOLE: 等←waiting for, 找←look for, 听←listen to;  fixed phrases whole: 结婚了←got married, 休息一下←take a rest, 看一看←have a look.\n" +
          "       · phrasal verb splits from its complement when Chinese splits: 拖←put off + 到←until;  拿←took + 出去←out;  放←bring + 回去←back;  还←pay + 我←me (back→\"\").\n" +
          "       · 一X ← \"a X\": the article a carries 一 (一周←a week, 一杯←a cup);  每个←Each + 学生←student (never swallow the noun).\n" +
          "       · time PPs align to the time word alone: 早上←in the morning (added 再/就 → \"\");  前←before, 后←after (在 → \"\").\n" +
          "       · quantifier chains distribute: 有些人←Some + 中←of + 他们←them;  百分之五十←50 percent + 学生←the students.\n" +
          "       · 请←please (not the whole Could you please);  黑←dark (天 → \"\");  哪里←where even inside embedded clauses.\n"
        : srcLang === "Japanese"
        ? "       · この/その/あの/どの ← the WHOLE demonstrative (这个←この, never こ);  やっと/ちょっと/ずっと/たまに/ので/のに/まで/までに are single words — never split them.\n" +
          "       · て-form chains split: 作って←做(了) + くれた←给;  持って←带 + 行って←去;  買って←买了 + みた←试试(看);  てみない?: 试试←み + 要不要←ない?.\n" +
          "       · conditional endings: 如果←ば/れば/たら/なら (adjective stem stays with the adjective: 便宜←安);  一…就/就←と or が;  ばいいのに ← 应该(吧) as ONE unit.\n" +
          "       · causative/passive morphology splits: 让←させ + 被←られ (させられた);  书かせた: 让←せ, 写←書か.\n" +
          "       · comparatives: 没有←ない + 那么←ほど + 热←暑く (昨日ほど暑くない);  一番←最.\n" +
          "       · aspect/attitude endings: てしまった → translate as V完了/V掉了 (not bare V了) and align V完了←V てしまった;  てから/たあとで ← 以后/之后;  そう(evidential) ← 看起来/好像, stem stays with the adjective (おいし←好吃).\n" +
          "       · adjectives must align: 冰←冷たい, 甜食←甘いもの, 新开←新しい;  onomatopoeia aligns to its Chinese adverb: 悠闲地←だらだら, 渐渐←だんだん, 流利←ぺらぺら.\n" +
          "       · たり lists: each verb aligns to its stem+たり (读书←読んだり, 听音乐←聴いたり).\n"
        : ""}` +
    `    Worked examples (${srcLang} → Chinese):\n` +
    `${srcLang === "Japanese"
        ? "      彼は日本語が話せます → 他(彼) + 会说(話せます,ONE unit) + 日语(日本語)\n" +
          "      コーヒーを二杯飲みました → 我(\"\") + 喝了(飲みました) + 两杯(二杯) + 咖啡(コーヒー)\n" +
          "      家でゆっくり休みたい → 想(たい) + 在(で) + 家(家) + 好好(ゆっくり) + 休息(休み)"
        : "      I bought three books → 我(I) + 买了(bought) + 三本(three) + 书(books)\n" +
          "      The book is mine → 书(book) + 是(is) + 我的(mine);  the → \"\"\n" +
          "      There are two cats in the garden → 花园(the garden) + 里(in) + 有(There are) + 两只(two) + 猫(cats)"}\n` +
    `- grammarPoints: list the Chinese grammar points this sentence uses. For each:\n` +
    `  • templateKey: if it matches one of these exactly, copy it verbatim; else "". List:\n${TEMPLATE_NAMES_ZH.join(" | ")}\n` +
    `  • triggerWords: the Chinese fragment(s) in the translation that trigger it (e.g. ["把"], ["越来越"]).\n` +
    `  • name: if templateKey=="" a short Chinese name for the point; else "".`;
}

// ============ 词对齐确定性修正(不靠模型自觉,代码强制)============
// 依据 2026-07 用户 100 题人工标注得出的系统性错误修正:
// ① span 必须是原文的连续子串(模型幻觉→清空)
// ② 日语:span 末尾的助词剥掉(彼は→彼);中文代词在日语没主语时不许乱认领
// ③ 相邻两块认领同一 span → 合并成一块(会+说←話せます → 会说←話せます)
// ④ 数词/指示词+量词 合并(三+本→三本);动词+了/过 合并(买+了→买了);代词+的 合并(我+的→我的)
// ⑤ 标点块不许认领文字;全局去重(同一 span 只能被认领一次,后者清空)
const JA_TRAIL_PARTICLES = new Set(["は","が","を","に","へ","と","も","の","や","ね","よ"]);
// 词汇词/固定搭配:结尾字符碰巧像助词,但绝不能剥(この≠こ+の,やっと≠やっ+と)
const JA_PROTECTED = new Set(["この","その","あの","どの","ここ","そこ","あそこ","どこ","どんな",
  "まで","までに","ので","のに","こと","もの","やっと","ちょっと","もっと","ずっと","きっと",
  "たまに","すでに","つい","ほど","ながら","かな","そう","みたい","らしい","ばいいのに"]);
const JA_PRONOUNS = ["私","僕","俺","あなた","君","彼女","彼","我々","皆"];
// 韩语:结构与日语同款(用户日语标注结论迁移)
const KO_TRAIL_1 = new Set(["은","는","이","가","을","를","에","의","도","와","과","로"]);
const KO_TRAIL_2 = ["에서","으로","부터","까지","에게","한테","하고","이랑","보다"];
const KO_PRONOUNS = ["저","나","너","당신","그녀","그","우리","저희","제","내"];
// 西班牙语:省主语(hablo=我说)→ 中文补出的代词不许认领动词变位
const ES_PRONOUNS = ["yo","tú","tu","usted","él","ella","nosotros","nosotras","ustedes","ellos","ellas","vos"];
const ZH_PRONOUNS = new Set(["我","你","您","我们","你们","他","她","它","他们","她们","咱们"]);
const NUM_DEM_CHARS = new Set("一二三四五六七八九十百千万两几半这那哪每");
const PUNCT_RE = /^[，。？！、,.?!:;:;…\s]+$/;

function fixupZhAlignment(sourceText, words, srcLang) {
  if (!Array.isArray(words) || !words.length) return words;
  let ws = words.map(w => ({ ...w }));

  // ① 子串校验
  for (const w of ws) {
    if (w.sourceSpan && !sourceText.includes(w.sourceSpan)) w.sourceSpan = "";
  }
  // ② 日语专项
  if (srcLang === "Japanese") {
    const DEMS = ["この", "その", "あの", "どの"];
    // 指示词+量词(这个/那家/那朵…),不含 这里/那里/这样/那么 等地点·方式词
    const DEM_CHIP = /^[这那這][个家本条只件张辆位杯瓶部台块朵份间棵颗支首场次页篇封双对]?$/u;
    const pendingTransfers = [];   // [chipIndex, span] 被守卫清掉、待转移给后面空名词块的 span
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      let s = w.sourceSpan || "";
      const orig = s;
      // ① 连词收缩(要在剥助词之前判断,不然 ですが 先被剥成 です)
      if (["因为"].includes(w.chinese) && orig.length > 2 && orig.endsWith("ので")) { w.sourceSpan = "ので"; continue; }
      if (["但", "但是", "可是", "不过"].includes(w.chinese) && orig.length > 1 && orig.endsWith("が")) { w.sourceSpan = "が"; continue; }
      if (["虽然", "尽管"].includes(w.chinese) && orig.length > 2 && orig.endsWith("のに")) { w.sourceSpan = "のに"; continue; }
      // ② 剥尾助词(保护词跳过:この/やっと/ので/まで…)
      while (s.length > 1 && !JA_PROTECTED.has(s) && JA_TRAIL_PARTICLES.has(s[s.length - 1])) s = s.slice(0, -1);
      // ③ 末尾 で
      if (s.length > 1 && s.endsWith("で") && !JA_PROTECTED.has(s)) {
        if (["在", "坐", "用"].includes(w.chinese)) s = "で";
        else if (!(s[s.length - 2] === "ん" || s[s.length - 2] === "い")) s = s.slice(0, -1);
      }
      // ④ 末尾 たら 条件形(让给 如果;动词保留到 た)
      if (s.length > 2 && s.endsWith("たら") && !["如果", "要是", "的话"].includes(w.chinese)) s = s.slice(0, -1);
      w.sourceSpan = (s && sourceText.includes(s)) ? s : "";
      // ⑤ 在:日语里只许对齐 で;认领了 の前 这类 → 把 前/後 转移给对应块后清空
      if (w.chinese === "在" && w.sourceSpan && w.sourceSpan !== "で") {
        if (w.sourceSpan.includes("前")) pendingTransfers.push(["前后", "前"]);
        else if (w.sourceSpan.includes("後")) pendingTransfers.push(["前后", "後"]);
        w.sourceSpan = "";
      }
      // ⑥ 代词防幻觉
      if (ZH_PRONOUNS.has(w.chinese) && w.sourceSpan &&
          !JA_PRONOUNS.some(p => w.sourceSpan.includes(p))) {
        w.sourceSpan = "";
      }
      // ⑦ 指示词守卫(那家←新しいラーメン屋 → ∅;这个←この漢字 → この)
      if (DEM_CHIP.test(w.chinese) && w.sourceSpan) {
        const dem = DEMS.find(d => w.sourceSpan.startsWith(d));
        if (dem) w.sourceSpan = dem;
        else if (!DEMS.includes(w.sourceSpan)) w.sourceSpan = "";
      }
      // ⑧ 单字能愿/虚词不许认领纯汉字实词(会←会議);清掉的 span 转移给后面空名词块
      if (w.chinese.length === 1 && ["auxiliary", "particle", "adverb"].includes(w.partOfSpeech) &&
          /^[\u4E00-\u9FFF]{2,}$/.test(w.sourceSpan || "")) {
        pendingTransfers.push(["名词", w.sourceSpan]);
        w.sourceSpan = "";
      }
      // ⑨ 的/地/得:日语里只许对齐 の(或空)
      if (["的", "地", "得"].includes(w.chinese) && w.sourceSpan && w.sourceSpan !== "の") {
        w.sourceSpan = "";
      }
      // ⑩ AのB 认领整串的名词块:挨着 的 块 → 只取自己那半(一只狗←犬の形 → 犬)
      if (w.partOfSpeech === "noun" && /^[^の]+の[^の]+$/.test(w.sourceSpan || "")) {
        const [a, b] = w.sourceSpan.split("の");
        const next = ws[i + 1], prev = ws[i - 1];
        if (next && next.chinese === "的") w.sourceSpan = a;
        else if (prev && prev.chinese === "的") w.sourceSpan = b;
      }
    }
    // 执行转移:清掉的 span 给最近的空名词块(会議→会议;前→前)
    for (const [kind, span] of pendingTransfers) {
      for (const w of ws) {
        if (w.sourceSpan) continue;
        if (kind === "前后" && ["前", "之前", "以前", "后", "之后", "以后"].includes(w.chinese) &&
            sourceText.includes(span)) { w.sourceSpan = span; break; }
        if (kind === "名词" && w.partOfSpeech === "noun" && sourceText.includes(span)) {
          w.sourceSpan = span; break;
        }
      }
    }
  }
  if (srcLang === "Korean") {
    for (const w of ws) {
      let s = w.sourceSpan || "";
      let changed = true;
      while (changed && s.length > 1) {
        changed = false;
        for (const suf of KO_TRAIL_2) {
          if (s.length > suf.length && s.endsWith(suf)) { s = s.slice(0, -suf.length); changed = true; }
        }
        if (s.length > 1 && KO_TRAIL_1.has(s[s.length - 1])) { s = s.slice(0, -1); changed = true; }
      }
      if (s !== w.sourceSpan) w.sourceSpan = (s && sourceText.includes(s)) ? s : "";
      if (ZH_PRONOUNS.has(w.chinese) && w.sourceSpan &&
          !KO_PRONOUNS.some(p => w.sourceSpan.includes(p))) {
        w.sourceSpan = "";
      }
    }
  }
  if (srcLang === "Spanish") {
    // 省主语:中文代词只许认领真实的西语代词,不许认领动词变位
    for (const w of ws) {
      if (ZH_PRONOUNS.has(w.chinese) && w.sourceSpan) {
        const lower = w.sourceSpan.toLowerCase();
        if (!ES_PRONOUNS.some(p => lower === p || lower.startsWith(p + " "))) w.sourceSpan = "";
      }
    }
  }
  // ⑤a 标点块
  for (const w of ws) {
    if (PUNCT_RE.test(w.chinese) && w.sourceSpan && !PUNCT_RE.test(w.sourceSpan)) w.sourceSpan = "";
  }
  // ③ 相邻同 span 合并(链式:不+会+说 都←話せません → 不会说)
  const m1 = [];
  for (const w of ws) {
    const prev = m1[m1.length - 1];
    if (prev && w.sourceSpan && prev.sourceSpan === w.sourceSpan && !PUNCT_RE.test(w.chinese) &&
        !(["的", "地", "得"].includes(w.chinese) && prev.partOfSpeech !== "pronoun")) {
      prev.chinese += w.chinese;
      prev.pinyin = [prev.pinyin, w.pinyin].filter(Boolean).join(" ");
      prev.isGrammarStructure = prev.isGrammarStructure && w.isGrammarStructure;
      continue;
    }
    m1.push(w);
  }
  // ④ 结构性合并
  const m2 = [];
  for (let i = 0; i < m1.length; i++) {
    const w = m1[i], n = m1[i + 1];
    const isNumDem = [...w.chinese].every(c => NUM_DEM_CHARS.has(c));
    if (n && isNumDem && n.partOfSpeech === "measureWord") {           // 三+本 → 三本
      m2.push(mergeUnits(w, n, w.partOfSpeech)); i++; continue;
    }
    if (n && w.partOfSpeech === "verb" && (n.chinese === "了" || n.chinese === "过")) {  // 买+了 → 买了
      m2.push(mergeUnits(w, n, "verb")); i++; continue;
    }
    if (n && w.partOfSpeech === "pronoun" && n.chinese === "的") {     // 我+的 → 我的
      m2.push(mergeUnits(w, n, "pronoun")); i++; continue;
    }
    m2.push(w);
  }
  // ⑥ 介词/标记转移(用户标注得出的确定性规则)
  //   把←put 这类:把 是语法标记,span 让给后面的动词;被←was → 被←by(若原文有 by);
  //   在←on/in + 后面有空着的方位词 上/里 → span 让给方位词;坐←goes + 原文有 by → 坐←by
  const BE_FORMS = new Set(["was", "were", "is", "are", "be", "been", "Was", "Were", "Is", "Are"]);
  const GO_FORMS = /^(go(es)?|went|take[sn]?|took|get[s]?|got)$/i;
  for (let i = 0; i < m2.length; i++) {
    const w = m2[i];
    if (w.chinese === "把" && w.sourceSpan) {                      // 把 → 让给后面的动词
      for (let j = i + 1; j < Math.min(i + 4, m2.length); j++) {
        if (m2[j].partOfSpeech === "verb" && !m2[j].sourceSpan) {
          m2[j].sourceSpan = w.sourceSpan; break;
        }
      }
      w.sourceSpan = "";
    }
    if (srcLang === "English") {
      if (w.chinese === "被" && BE_FORMS.has(w.sourceSpan) && /\bby\b/.test(sourceText)) {
        w.sourceSpan = "by";
      }
      if (w.chinese === "在" && ["on", "in", "at", "On", "In", "At"].includes(w.sourceSpan)) {
        for (let j = i + 1; j < Math.min(i + 4, m2.length); j++) {
          // 方位词空着、或与 在 抢同一个 span(模型俩都标 on)→ 都转移给方位词
          if (["上", "里", "中", "下"].includes(m2[j].chinese) &&
              (!m2[j].sourceSpan || m2[j].sourceSpan === w.sourceSpan)) {
            m2[j].sourceSpan = w.sourceSpan; w.sourceSpan = ""; break;
          }
        }
      }
      if (["坐", "骑", "开", "乘"].includes(w.chinese) && GO_FORMS.test(w.sourceSpan) && /\bby\b/.test(sourceText)) {
        w.sourceSpan = "by";
      }
      // before/after 对齐到 前/后,不是 在/趁:在←before → 转移给后面的 前/之前/后/之后
      if (["在", "趁"].includes(w.chinese) && ["before", "Before", "after", "After"].includes(w.sourceSpan)) {
        for (let j = 0; j < m2.length; j++) {
          if (["前", "之前", "以前", "后", "之后", "以后"].includes(m2[j].chinese) && !m2[j].sourceSpan) {
            m2[j].sourceSpan = w.sourceSpan; break;
          }
        }
        w.sourceSpan = "";
      }
      // 被动经历者:有人/人们/大家 不许认领 I/me/we(I was told → 有人←∅,我←I)
      if (["有人", "人们", "大家"].includes(w.chinese) && ["I", "me", "we", "We"].includes(w.sourceSpan)) {
        w.sourceSpan = "";
      }
    }
  }
  // ⑤b 位置感知的认领去重(与 App 端 AlignedTextView 同逻辑):
  //    按顺序为每块在原文里找「未被占用」的出现位置;同一段原文只能被认领一次,
  //    位置全被占(重复认领 / 包含型重叠,如 问题←質問 ⊂ 問←質問して)→ span 清空。
  const claimed = [];
  for (const w of m2) {
    const s = w.sourceSpan;
    if (!s) continue;
    let idx = 0, placed = false;
    while (true) {
      const p = sourceText.indexOf(s, idx);
      if (p === -1) break;
      const overlaps = claimed.some(([a, b]) => p < b && p + s.length > a);
      if (!overlaps) { claimed.push([p, p + s.length]); placed = true; break; }
      idx = p + 1;
    }
    if (!placed) w.sourceSpan = "";
  }
  return m2;
}
function mergeUnits(a, b, pos) {
  return {
    chinese: a.chinese + b.chinese,
    pinyin: [a.pinyin, b.pinyin].filter(Boolean).join(" "),
    partOfSpeech: pos,
    sourceSpan: a.sourceSpan || b.sourceSpan || "",
    isGrammarStructure: false
  };
}

const wordSchemaZh = {
  type: "object",
  properties: {
    chinese: { type: "string" },
    pinyin: { type: "string" },
    partOfSpeech: { type: "string", enum: POS_ZH },
    sourceSpan: { type: "string" },
    isGrammarStructure: { type: "boolean" }
  },
  required: ["chinese","pinyin","partOfSpeech","sourceSpan","isGrammarStructure"],
  additionalProperties: false
};
const grammarSchemaZh = {
  type: "object",
  properties: {
    templateKey: { type: "string", enum: TEMPLATE_ENUM_ZH },
    triggerWords: { type: "array", items: { type: "string" } },
    name: { type: "string" }
  },
  required: ["templateKey","triggerWords","name"],
  additionalProperties: false
};
const translateSchemaZh = {
  type: "object",
  properties: {
    translation: { type: "string" },
    words: { type: "array", items: wordSchemaZh },
    grammarPoints: { type: "array", items: grammarSchemaZh }
  },
  required: ["translation","words","grammarPoints"],
  additionalProperties: false
};

export function mountZhRoutes(app, deps) {
  const { openAIJSON, MODEL, DICT_MODEL, APP_SHARED_SECRET,
          monthKey, cacheSweep, cachePut, sendToAxiom, CACHE_MAX = 30000 } = deps;

  // 版本探针:确认部署是否落地
  app.get("/zh/version", (_req, res) => res.json({ zh: "v2.6", fixup: true }));

  const auth = (req, res) => {
    if (APP_SHARED_SECRET && req.get("X-App-Key") !== APP_SHARED_SECRET) {
      res.status(401).json({ error: "unauthorized" });
      return false;
    }
    return true;
  };
  const oaiJSON = (body) => openAIJSON(body);
  const sys = (s) => ({ role: "system", content: s });
  const usr = (s) => ({ role: "user", content: s });
  const jsonSchema = (name, schema) => ({ type: "json_schema", json_schema: { name, strict: true, schema } });

  // —— 缓存(中文版独立命名空间,不与英文版串味)——
  const defCacheZh = new Map();     // 永久:释义+拼音
  const sentCacheZh = new Map();    // 永久:整句翻译
  const exampleCacheZh = new Map(); // 月度:例句
  const grammarCacheZh = new Map(); // 月度:语法详解

  // ===== /zh/translate-fast =====
  app.post("/zh/translate-fast", async (req, res) => {
    try {
      if (!auth(req, res)) return;
      const { sourceText = "", style = "standard", sourceLanguage = "English", script = "Hans" } = req.body || {};
      const content = await oaiJSON({
        model: MODEL, temperature: 0.4,
        response_format: jsonSchema("fast_zh", {
          type: "object", properties: { translation: { type: "string" } },
          required: ["translation"], additionalProperties: false
        }),
        messages: [
          sys(`Translate the user's ${sourceLanguage} into ${styleDescZh(style)}, written in ${scriptName(script)}. Return ONLY {"translation": "..."}. Translate only what is written; add nothing.`),
          usr(sourceText)
        ]
      });
      res.json(JSON.parse(content));
    } catch (e) { res.status(e.status || 500).json({ error: e.error || "server_error", detail: e.detail }); }
  });

  // ===== /zh/translate =====
  app.post("/zh/translate", async (req, res) => {
    try {
      if (!auth(req, res)) return;
      const { sourceText = "", style = "standard", sourceLanguage = "English",
              givenTranslation = "", script = "Hans" } = req.body || {};
      const userMsg =
        `STYLE: ${styleDescZh(style)}\n` +
        (givenTranslation ? `ALREADY-DECIDED TRANSLATION (use this exact Chinese, just annotate it): ${givenTranslation}\n` : "") +
        `INPUT (${sourceLanguage}): ${sourceText}`;
      const content = await oaiJSON({
        model: MODEL, temperature: 0.3,
        response_format: jsonSchema("translate_zh", translateSchemaZh),
        messages: [ sys(systemPromptZh(sourceLanguage, script)), usr(userMsg) ]
      });
      const parsed = JSON.parse(content);
      // 词对齐确定性修正(去幻觉/剥助词/合并/去重)—— 见 fixupZhAlignment
      const words = fixupZhAlignment(sourceText, parsed.words || [], sourceLanguage);
      // grammarPoints: templateKey 命中就用它当 name(App 据 name 查本地模板)
      const grammarPoints = (parsed.grammarPoints || []).map(g => ({
        name: g.templateKey && g.templateKey.length ? g.templateKey : (g.name || ""),
        triggerWords: g.triggerWords || []
      })).filter(g => g.name);
      res.json({ translation: parsed.translation, words, grammarPoints });
    } catch (e) { res.status(e.status || 500).json({ error: e.error || "server_error", detail: e.detail }); }
  });

  // ===== /zh/word-definition (永久缓存;释义 + 拼音) =====
  app.post("/zh/word-definition", async (req, res) => {
    try {
      if (!auth(req, res)) return;
      const { chinese = "", partOfSpeech = "", context = "", sourceLanguage = "English" } = req.body || {};
      const key = `${sourceLanguage}|${chinese}|${partOfSpeech}`;
      if (defCacheZh.has(key)) return res.json(defCacheZh.get(key));
      const content = await oaiJSON({
        model: DICT_MODEL, temperature: 0.2,
        response_format: jsonSchema("worddef_zh", {
          type: "object",
          properties: { definition: { type: "string" }, pinyin: { type: "string" } },
          required: ["definition","pinyin"], additionalProperties: false
        }),
        messages: [
          sys(`You are a Chinese-${sourceLanguage} dictionary. Give the concise ${sourceLanguage} meaning of the Chinese word, ` +
              `as a learner's dictionary would — just the gloss, no example, no extra words. ` +
              `Also give its Hanyu Pinyin WITH TONE MARKS; if it is a duōyīnzì, pick the reading that fits the context.`),
          usr(`Word: ${chinese}\nPart of speech hint: ${partOfSpeech}\nContext sentence: ${context}`)
        ]
      });
      const out = JSON.parse(content);
      cachePut(defCacheZh, key, out);
      res.json(out);
    } catch (e) { res.status(e.status || 500).json({ error: e.error || "server_error", detail: e.detail }); }
  });

  // ===== /zh/word-example (月度缓存) =====
  app.post("/zh/word-example", async (req, res) => {
    try {
      if (!auth(req, res)) return;
      cacheSweep && cacheSweep();
      const { chinese = "", definition = "", sourceLanguage = "English", script = "Hans" } = req.body || {};
      const key = `${monthKey()}|${sourceLanguage}|${script}|${chinese}|${definition}`;
      if (exampleCacheZh.has(key)) return res.json(exampleCacheZh.get(key));
      const content = await oaiJSON({
        model: MODEL, temperature: 0.7,
        response_format: jsonSchema("wordex_zh", {
          type: "object",
          properties: { zh: { type: "string" }, gloss: { type: "string" }, pinyin: { type: "string" } },
          required: ["zh","gloss","pinyin"], additionalProperties: false
        }),
        messages: [
          sys(`Write ONE short, natural Chinese example sentence (HSK1-4 vocabulary) using the given word, in ${scriptName(script)}. ` +
              `Provide: zh (the sentence), pinyin (WITH TONE MARKS for the whole sentence), gloss (a natural ${sourceLanguage} translation).`),
          usr(`Word: ${chinese}\nMeaning: ${definition}`)
        ]
      });
      const out = JSON.parse(content);
      cachePut(exampleCacheZh, key, out);
      res.json(out);
    } catch (e) { res.status(e.status || 500).json({ error: e.error || "server_error", detail: e.detail }); }
  });

  // ===== /zh/sentence-translation (永久缓存;把中文例句译成源语言) =====
  app.post("/zh/sentence-translation", async (req, res) => {
    try {
      if (!auth(req, res)) return;
      const { sentence = "", sourceLanguage = "English" } = req.body || {};
      const key = `${sourceLanguage}|${sentence}`;
      if (sentCacheZh.has(key)) return res.json(sentCacheZh.get(key));
      const content = await oaiJSON({
        model: MODEL, temperature: 0.2,
        response_format: jsonSchema("senttr_zh", {
          type: "object", properties: { translation: { type: "string" } },
          required: ["translation"], additionalProperties: false
        }),
        messages: [
          sys(`Translate the Chinese sentence into natural ${sourceLanguage}. Return ONLY {"translation": "..."}.`),
          usr(sentence)
        ]
      });
      const out = JSON.parse(content);
      cachePut(sentCacheZh, key, out);
      res.json(out);
    } catch (e) { res.status(e.status || 500).json({ error: e.error || "server_error", detail: e.detail }); }
  });

  // ===== /zh/grammar-detail (月度缓存;本地无模板时的兜底) =====
  app.post("/zh/grammar-detail", async (req, res) => {
    try {
      if (!auth(req, res)) return;
      cacheSweep && cacheSweep();
      const { name = "", sourceLanguage = "English", script = "Hans" } = req.body || {};
      const key = `${monthKey()}|${sourceLanguage}|${script}|${name}`;
      if (grammarCacheZh.has(key)) return res.json(grammarCacheZh.get(key));
      const content = await oaiJSON({
        model: MODEL, temperature: 0.5,
        response_format: jsonSchema("grammardetail_zh", {
          type: "object",
          properties: {
            name: { type: "string" }, meaning: { type: "string" }, structure: { type: "string" },
            examples: { type: "array", items: {
              type: "object",
              properties: { zh: { type: "string" }, gloss: { type: "string" }, pinyin: { type: "string" } },
              required: ["zh","gloss","pinyin"], additionalProperties: false
            } }
          },
          required: ["name","meaning","structure","examples"], additionalProperties: false
        }),
        messages: [
          sys(`Explain the Chinese grammar point for a ${sourceLanguage}-speaking learner. ` +
              `meaning + structure in ${sourceLanguage}; provide 2 example sentences in ${scriptName(script)} with pinyin (tone marks) and ${sourceLanguage} gloss.`),
          usr(`Grammar point: ${name}`)
        ]
      });
      const out = JSON.parse(content);
      cachePut(grammarCacheZh, key, out);
      res.json(out);
    } catch (e) { res.status(e.status || 500).json({ error: e.error || "server_error", detail: e.detail }); }
  });

  // ===== /zh/feedback (fire-and-forget) =====
  app.post("/zh/feedback", (req, res) => {
    if (!auth(req, res)) return;
    try {
      sendToAxiom && sendToAxiom({ _time: new Date().toISOString(), kind: "zh_feedback", ...req.body });
    } catch (_) {}
    res.json({ ok: true });
  });

  console.log("[zh-routes] mounted /zh/* (Chinese-target routes)");
}
