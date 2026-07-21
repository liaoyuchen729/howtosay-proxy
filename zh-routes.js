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
              : srcLang === "Spanish" ? "Spanish drops subject pronouns (hablo = 我说): added 我/你/他 → \"\" unless yo/tú/él/mi/te/lo etc. is literally present — never align a pronoun to a conjugated verb. Strip articles el/la/los/las (but 一X←un/una X). 比←que (más+adj belongs to the adjective)."
              : srcLang === "Vietnamese" ? "Canonical pairs: 了←rồi/đã, 在←đang, 会←sẽ, 的←của, 被←bị/được, 比←hơn (cao belongs to 高), 太←quá, 吗←không/chưa, classifiers con/cái/quyển ← 只/个/本 merged with the number."
              : srcLang === "Thai" ? "No spaces — spans are exact substrings. Polite ครับ/ค่ะ/คะ → \"\" always. Canonical: 了←แล้ว, 在←กำลัง, 会/要←จะ, 不←ไม่, 吗←ไหม, 比←กว่า (เร็ว belongs to 快). Number+classifier merge: สามเล่ม←三本."
              : srcLang === "Indonesian" ? "Canonical: 了/已经←sudah, 在←sedang, 会/要←akan, 不←tidak/bukan, 也←juga, 很←sangat/sekali. Possessive -nya: 他的←nya, the root noun aligns separately (pesannya: 消息←pesan + 他的←nya). Question -kah ← 吗."
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
  for (const w of words) if (typeof w.sourceSpan === "string") w.sourceSpan = w.sourceSpan.trim();
  // ——— 通用:X的/X得/X地 复合块拆分(rubric:定语的/状语地/补语得 必拆,助词块 ∅)———
  // 黑名单:得字动词(觉得…)、地字名词(土地…)、的字固定词(真的…)、代词+的(我的←mine 保留)
  const DE_VERB = new Set(["觉得","记得","懂得","值得","显得","免得","省得","舍得","晓得","难得","懒得",
    "使得","害得","乐得","恨不得","巴不得","怪不得","来得及","来不及","由得","怨不得","认得","晓不得","见得","算得"]);
  const DI_NOUN = new Set(["土地","场地","基地","当地","本地","外地","各地","内地","产地","耕地","空地","草地",
    "墓地","高地","洼地","盆地","绿地","圣地","腹地","工地","园地","阵地","领地","目的地","所在地","发源地",
    "根据地","殖民地","ราชอาณาจักร","天地","阴天地","余地","境地","质地","心地","实地","当地"]);
  const DE_FIXED = new Set(["真的","好的","是的","有的","别的","似的","假的","对的","错的","目的","的确","打的",
    "挺好的","我的","你的","他的","她的","它的","我们的","你们的","他们的","她们的","咱们的","大家的","谁的","这的","那的"]);
  const PRON_STEM = /^(我|你|您|他|她|它|咱|大家|这|那|谁|人家|自己|彼此)们?$/;
  const splitDe = [];
  for (const w of words) {
    const m = w.chinese.match(/^(.+?)([的得地])$/);
    // span 为空的块不拆:拆了 stem 也找不到对应,只会造出孤立的 得←∅ 噪声块
    if (!m || w.chinese.length < 2 || !w.sourceSpan) { splitDe.push(w); continue; }
    const [ , stem, de ] = m;
    if (PRON_STEM.test(stem) || DE_FIXED.has(w.chinese) ||
        (de === "得" && DE_VERB.has(w.chinese)) ||
        (de === "地" && DI_NOUN.has(w.chinese))) { splitDe.push(w); continue; }
    // 冗余补语脚手架:拆出的 stem 会与已有块同span重复认领(说…说得←speaks)→ 不拆,
    // 整块留给认领去重变 ∅,避免造出孤立的 得←∅ 噪声
    if (words.some(x => x !== w && x.chinese === stem && x.sourceSpan === w.sourceSpan)) {
      splitDe.push(w); continue;
    }
    const pys = (w.pinyin || "").split(/\s+/);
    splitDe.push(
      { chinese: stem, partOfSpeech: w.partOfSpeech, sourceSpan: w.sourceSpan || "",
        pinyin: pys.slice(0, stem.length).join(" "), isGrammarStructure: false },
      { chinese: de, partOfSpeech: "particle", sourceSpan: "",
        pinyin: pys.slice(stem.length).join(" ") || (de === "的" ? "de" : de === "得" ? "de" : "de"),
        isGrammarStructure: true });
  }
  words = splitDe;
  if (!Array.isArray(words) || !words.length) return words;
  let ws = words.map(w => ({ ...w }));

  // ① 子串校验
  for (const w of ws) {
    if (w.sourceSpan && !sourceText.includes(w.sourceSpan)) w.sourceSpan = "";
  }
  // ② 日语专项
  if (srcLang === "Japanese") {
    // VO 离合词拆分:中文动宾复合块整块吞/整块空时,拆成 动词+名词,名词对齐日语名词本体
    const JA_VO = {
      "交朋友": { v: "交", nJa: ["友達", "友だち", "ともだち"], vJa: ["作り", "作っ", "作ろ", "作る", "でき"] },
      "吃饭":   { v: "吃", nJa: ["ご飯", "ごはん"], vJa: ["食べ"] },
      "唱歌":   { v: "唱", nJa: ["歌"], vJa: ["歌い", "歌っ", "歌う"] },
      "打电话": { v: "打", nJa: ["電話"], vJa: ["かけ", "し"] },
      "看书":   { v: "看", nJa: ["本"], vJa: ["読み", "読ん", "読む"] },
    };
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i], vo = JA_VO[w.chinese];
      if (!vo) continue;
      const nSpan = vo.nJa.find(x => sourceText.includes(x));
      if (!nSpan) continue;
      const noun = w.chinese.slice(vo.v.length);
      const pys = (w.pinyin || "").split(/\s+/);
      const vSpan = vo.vJa.find(x => sourceText.includes(x)) || "";
      ws.splice(i, 1,
        { chinese: vo.v, partOfSpeech: "verb", sourceSpan: vSpan,
          pinyin: pys.slice(0, vo.v.length).join(" "), isGrammarStructure: false },
        { chinese: noun, partOfSpeech: "noun", sourceSpan: nSpan,
          pinyin: pys.slice(vo.v.length).join(" "), isGrammarStructure: false });
      i++;
    }
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
      // ①b 固定映射:样态词带で(みたいで=像…的样子)收缩到词根;あと(で) 让给 后
      const JA_SHRINK = { "みたいで": "みたい", "ようで": "よう", "そうで": "そう" };
      if (JA_SHRINK[s]) s = JA_SHRINK[s];
      if ((s.endsWith("あとで") || s.endsWith("あと")) && s.length > 3 &&
          !["后", "之后", "以后"].includes(w.chinese)) {
        pendingTransfers.push(["前后", s.endsWith("あとで") ? "あとで" : "あと"]);
        s = s.replace(/あとで?$/, "");
      }
      // ② 剥尾助词(保护词跳过:この/やっと/ので/まで…)
      while (s.length > 1 && !JA_PROTECTED.has(s) && JA_TRAIL_PARTICLES.has(s[s.length - 1])
             && !(s[s.length - 1] === "と" && s[s.length - 2] === "こ")   // こと 的 と 是词内,不剥
             && !(s[s.length - 1] === "の" && s[s.length - 2] === "も")   // もの 同理
            ) s = s.slice(0, -1);
      // ③ 末尾 で
      if (s.length > 1 && s.endsWith("で") && !JA_PROTECTED.has(s)) {
        if (["在", "坐", "用"].includes(w.chinese)) s = "で";
        else if (!(s[s.length - 2] === "ん" || s[s.length - 2] === "い")) s = s.slice(0, -1);
      }
      // ④ 末尾 たら 条件形(让给 如果;动词保留到 た)
      if (s.length > 2 && s.endsWith("たら") && !["如果", "要是", "的话"].includes(w.chinese)) s = s.slice(0, -1);
      w.sourceSpan = (s && sourceText.includes(s)) ? s : "";
      // ④b 是:中文补出的系动词。日语只有 だ/です/である 是真系动词;
      //     抓到孤零零的 で(であれ/です 的片段)或其它非系动词 → ∅
      if (w.chinese === "是" && w.sourceSpan &&
          !["だ", "です", "である", "だった", "でした"].includes(w.sourceSpan)) {
        w.sourceSpan = "";
      }
      // ④c 代词 + のこと / のもの:あなたのこと=你,只保留代词本体
      if (ZH_PRONOUNS.has(w.chinese) && w.sourceSpan) {
        const pm = w.sourceSpan.match(/^(あなた|わたし|私|僕|俺|君|彼女|彼|我々|皆)/);
        if (pm && w.sourceSpan.length > pm[1].length) w.sourceSpan = pm[1];
      }
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
        if (kind === "前后" && ["以后", "之后", "后"].includes(w.chinese) && sourceText.includes(span)) {
          w.sourceSpan = span; break;
        }
        if (kind === "名词" && w.partOfSpeech === "noun" && sourceText.includes(span)) {
          w.sourceSpan = span; break;
        }
      }
    }
  }
  if (srcLang === "Korean") {
    // 教训(第1轮裁判):韩语词尾音节常与助词同形(사과/고양이/회의/제주도/같이),
    // 盲剥单字助词会剥断词。只做三件确定安全的事:
    // ① 代词+助词 → 只留代词(저는→저);② 双字助词剥离(에서/부터…);③ 系词后缀让给 是
    const KO_COPULA = ["입니다", "이에요", "예요", "이야", "이세요"];
    const pendingKo = [];
    for (const w of ws) {
      let s = w.sourceSpan || "";
      // ① 代词开头 + 助词尾 → 收缩到代词
      const pron = KO_PRONOUNS.find(p => s.startsWith(p) && s.length > p.length && s.length <= p.length + 2);
      if (pron && KO_TRAIL_1.has(s[s.length - 1])) s = pron;
      // ② 双字助词(词内出现概率低)
      for (const suf of KO_TRAIL_2) {
        if (s.length > suf.length && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
      }
      // ③ 系词后缀:학생이에요 → 학생,后缀转移给 是
      for (const cop of KO_COPULA) {
        if (w.chinese !== "是" && s.length > cop.length && s.endsWith(cop)) {
          pendingKo.push(cop); s = s.slice(0, -cop.length); break;
        }
      }
      w.sourceSpan = (s && sourceText.includes(s)) ? s : (w.sourceSpan && sourceText.includes(w.sourceSpan) ? w.sourceSpan : "");
      if (s && sourceText.includes(s)) w.sourceSpan = s;
      // 是:只许对齐系词
      if (w.chinese === "是" && w.sourceSpan &&
          !KO_COPULA.includes(w.sourceSpan) && w.sourceSpan !== "이다") w.sourceSpan = "";
      // 代词防幻觉
      if (ZH_PRONOUNS.has(w.chinese) && w.sourceSpan &&
          !KO_PRONOUNS.some(p => w.sourceSpan.includes(p))) w.sourceSpan = "";
    }
    const koTokens = sourceText.split(/\s+/).map(t => t.replace(/[.,!?]/g, ""));
    for (const w of ws) {
      // 单音节截断恢复:span 是 1 字且有以它开头的完整词 → 用完整词(剥尾助词)
      if (w.sourceSpan && w.sourceSpan.length === 1 && /[\uAC00-\uD7AF]/.test(w.sourceSpan)) {
        const full = koTokens.find(t => t.length > 1 && t.startsWith(w.sourceSpan));
        if (full && !ws.some(x => x !== w && x.sourceSpan && x.sourceSpan.length > 1 && full.includes(x.sourceSpan))) {
          let s = full;
          for (const suf of KO_TRAIL_2) if (s.length > suf.length && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
          if (s.length > 2 && KO_TRAIL_1.has(s[s.length - 1])) s = s.slice(0, -1);
          if (sourceText.includes(s)) w.sourceSpan = s;
        }
      }
      // 连词类块吞词 → 收缩到连词本体,其余词转移给对应的空块。
      // 两种形态:句首连接词(그리고 우리는 → 保留词头 그리고);
      //          从属词尾(시간이 없어서 → 保留词尾 없어서)
      const KO_CONNECTIVES = new Set(["그리고", "하지만", "그래서", "그런데", "그러나", "또는", "또"]);
      const isConjChip = w.partOfSpeech === "conjunction" || /^(因为|如果|虽然|但是|所以|然后|而且|不过|那么|正在|在)$/.test(w.chinese) || /^(因为|如果|虽然|但是|所以|然后|而且|不过|那么)/.test(w.chinese);
      if (isConjChip && (w.sourceSpan || "").includes(" ")) {
        const parts = w.sourceSpan.split(/\s+/);
        const keepFirst = KO_CONNECTIVES.has(parts[0]);
        const extra = keepFirst ? parts.slice(1) : parts.slice(0, -1);
        w.sourceSpan = keepFirst ? parts[0] : parts[parts.length - 1];
        for (const word of extra) {
          let s = word.replace(/[.,!?]/g, "");
          const pron = KO_PRONOUNS.find(p => s.startsWith(p) && s.length <= p.length + 2);
          if (pron && KO_TRAIL_1.has(s[s.length - 1])) s = pron;
          else if (s.length > 2 && KO_TRAIL_1.has(s[s.length - 1])) s = s.slice(0, -1);
          const t = pron
            ? ws.find(x => ZH_PRONOUNS.has(x.chinese) && !x.sourceSpan)
            : ws.find(x => ["noun", "adjective", "verb"].includes(x.partOfSpeech) && !x.sourceSpan);
          if (t && sourceText.includes(s)) t.sourceSpan = s;
        }
      }
      // 功能词吞实词 → 只留语法词尾,词干转移给空实词块(如果←있으면 → 如果←으면 + 有…←있)
      const KO_ENDINGS = [
        [/^(如果|.*的话$)/, ["으면", "면"]],
        [/^因为/, ["아서", "어서", "라서", "니까"]],
        [/^(但是?|不过)$/, ["지만"]],
        [/^在$/, ["에서", "에"]],
      ];
      if (w.sourceSpan && !w.sourceSpan.includes(" ")) {
        for (const [re, ends] of KO_ENDINGS) {
          if (!re.test(w.chinese)) continue;
          const end = ends.find(e => w.sourceSpan.endsWith(e) && w.sourceSpan.length > e.length);
          if (end) {
            const stem = w.sourceSpan.slice(0, -end.length);
            w.sourceSpan = end;
            const t = ws.find(x => ["noun", "adjective", "verb"].includes(x.partOfSpeech) && !x.sourceSpan);
            if (t && sourceText.includes(stem)) t.sourceSpan = stem;
          }
          break;
        }
      }
      // 情态词(会/能/可以)不许吞整个动词:span 无「수」→ 让给空动词块,自己 ∅
      if (["会", "能", "可以"].includes(w.chinese) && w.sourceSpan &&
          !w.sourceSpan.includes("수") && /[\uAC00-\uD7AF]/.test(w.sourceSpan)) {
        const t = ws.find(x => x.partOfSpeech === "verb" && !x.sourceSpan);
        if (t) { t.sourceSpan = w.sourceSpan; w.sourceSpan = ""; }
        else w.sourceSpan = "";
      }
      // 数量块守卫:span 必须含数字/韩语数词/量词,否则是强凑(一个←새)
      if (/^[一两三四五六七八九十百千0-9]/.test(w.chinese) && w.chinese.length <= 3 &&
          !/[起样定直些下边共儿点分会]/.test(w.chinese) && w.sourceSpan &&
          !/[0-9하한두세네다섯여섯일곱여덟아홉열스무서른마흔쉰백천만개명권마리잔병장분시]/.test(w.sourceSpan)) {
        const dropped = w.sourceSpan;
        w.sourceSpan = "";
        // 새(新)被数量块抢走 → 还给 新X 块(新项目←새 프로젝트)
        if (dropped === "새") {
          const t = ws.find(x => /^新/.test(x.chinese) && x.sourceSpan && sourceText.includes("새 " + x.sourceSpan));
          if (t) t.sourceSpan = "새 " + t.sourceSpan;
        }
      }
      // 量词 span 只认了 분/시간 等 → 往前找相邻的韩语数词并入(사십 분)
      const KO_COUNTERS = new Set(["분", "시간", "개", "명", "권", "잔", "병", "마리", "장", "시", "번", "살"]);
      if (w.sourceSpan && KO_COUNTERS.has(w.sourceSpan) && /^[一两三四五六七八九十百千0-9]/.test(w.chinese)) {
        const pos = sourceText.indexOf(w.sourceSpan);
        const before = sourceText.slice(0, pos).match(/([가-힣0-9]+)\s+$/);
        if (before) {
          const cand = before[1] + " " + w.sourceSpan;
          if (sourceText.includes(cand)) w.sourceSpan = cand;
        }
      }
      // 显式主语:我←∅ 但原文有独立的 저는/저/나는/제가 → 补上
      if (w.chinese === "我" && !w.sourceSpan) {
        const hit = ["저는", "제가", "나는", "저", "나"].find(p => koTokens.includes(p));
        if (hit) w.sourceSpan = hit.length > 1 && KO_TRAIL_1.has(hit[hit.length - 1]) && hit.length > 1 ? hit.slice(0, hit.length - (["저는","나는","제가"].includes(hit) ? 1 : 0)) : hit;
        if (w.sourceSpan && !sourceText.includes(w.sourceSpan)) w.sourceSpan = "";
      }
    }
    for (const cop of pendingKo) {
      const t = ws.find(x => x.chinese === "是" && !x.sourceSpan);
      if (t && sourceText.includes(cop)) t.sourceSpan = cop;
    }
  }
  // ——— 通用:疑问词/高频功能词 ∅ 转移 ———
  // 该类中文块该对齐却空着(裁判高频 missing 类):原文里有标准对应词就补上;
  // 位置冲突由最后的认领去重兜底(冲突则回到 ∅,不会错标)
  const QMAPS = {
    English: { "什么": ["what"], "谁": ["who"], "哪里": ["where"], "哪儿": ["where"],
      "什么时候": ["when"], "为什么": ["why"], "怎么": ["how"], "多少": ["how much", "how many"] },
    Japanese: { "什么": ["何"], "谁": ["誰", "だれ"], "哪里": ["どこ"], "什么时候": ["いつ"],
      "为什么": ["なぜ", "どうして"], "怎么": ["どう"], "多少": ["いくら"], "几": ["何"],
      "散步": ["散歩"], "加班": ["残業"], "开会": ["会議"] },
    Korean: { "什么": ["뭐", "무엇"], "谁": ["누구"], "哪里": ["어디"], "什么时候": ["언제"],
      "为什么": ["왜"], "怎么": ["어떻게"], "多少": ["얼마"], "几": ["몇"],
      "是": ["입니다", "이에요", "예요", "이세요"], "下雨": ["비가 오", "비가 와"], "很重": ["무거워", "무거우"],
      "会": ["거예요", "수 있"], "在": ["계세"], "茶": ["차"] },
    Vietnamese: { "什么": ["gì"], "谁": ["ai"], "哪里": ["đâu"], "什么时候": ["khi nào", "bao giờ"],
      "为什么": ["sao", "tại sao"], "怎么": ["thế nào"], "多少": ["bao nhiêu"], "几": ["mấy"],
      "了": ["rồi", "đã"], "吗": ["chưa", "hả", "nhé", "à"],
      "妹妹": ["Em gái", "em gái"], "父亲": ["Bố", "bố"], "新鲜": ["tươi"],
      "太": ["quá", "lắm"], "极了": ["quá"] },
    Thai: { "什么": ["อะไร"], "谁": ["ใคร"], "哪里": ["ที่ไหน"], "什么时候": ["เมื่อไหร่", "เมื่อไร"],
      "为什么": ["ทำไม"], "怎么": ["ยังไง", "อย่างไร"], "多少": ["เท่าไหร่", "เท่าไร"], "几": ["กี่"],
      "了": ["แล้ว"], "很": ["มาก"], "六点": ["หกโมง"], "下雨": ["ฝนตก"], "吗": ["ไหม", "หรือยัง"],
      "早上": ["เช้า"], "晚上": ["เย็น", "กลางคืน"] },
    Indonesian: { "什么": ["apa"], "谁": ["siapa"], "哪里": ["mana"], "什么时候": ["kapan"],
      "为什么": ["kenapa", "mengapa"], "怎么": ["bagaimana"], "多少": ["berapa"], "几": ["berapa"],
      "已经": ["sudah", "telah"], "了": ["sudah"], "这": ["ini"], "那": ["itu"],
      "我的": ["saya"], "里": ["di"] },
    Spanish: { "什么": ["qué", "Qué"], "谁": ["quién"], "哪里": ["dónde", "Dónde"],
      "什么时候": ["cuándo", "Cuándo"], "为什么": ["por qué"], "怎么": ["cómo", "Cómo"],
      "多少": ["cuánto", "Cuánto", "cuánta"], "有": ["hay", "Hay", "había", "Había"],
      "比": ["que"], "很": ["muy", "mucho"], "一点": ["nada"], "他": ["él", "lo"],
      "在": ["en", "a"], "洗澡": ["me ducho", "ducho"] }
  };
  const qmap = QMAPS[srcLang];
  function qmapFill() {
    if (!qmap) return;
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const w of ws) {
      if (w.sourceSpan || !qmap[w.chinese]) continue;
      for (const cand of qmap[w.chinese]) {
        // 拉丁词按整词、大小写不敏感匹配(Berapa 命中 berapa);span 用原文实际写法
        const latin = /^[\u0000-\u024F\u1E00-\u1EFF]+$/.test(cand) && /\p{L}/u.test(cand);
        const re = latin ? new RegExp("(?<!\\p{L})" + esc(cand) + "(?!\\p{L})", "iu") : new RegExp(esc(cand), "u");
        const m = sourceText.match(re);
        if (m) { w.sourceSpan = m[0]; break; }
      }
    }
  }
  qmapFill();
  // ——— 通用工具:功能词「标准对照」收缩/清空 ———
  // 该词块只该对齐这些标准对应词:span 含其一 → 收缩到它;都不含 → 强凑,清空
  function canonicalize(w, canon, spaceSep) {
    if (!w.sourceSpan) return;
    for (const c of canon) {
      if (spaceSep) {
        const words = w.sourceSpan.split(/\s+/);
        const hit = words.find(x => x.replace(/[.,!?¿¡]/g, "") .toLowerCase() === c.toLowerCase());
        if (hit) { w.sourceSpan = hit.replace(/[.,!?¿¡]/g, ""); return; }
      } else if (w.sourceSpan.includes(c)) { w.sourceSpan = c; return; }
    }
    // 截断恢复:span 里有标准词的前 2 字(模型截断,如 เร็วกว่ 含 กว)且原文里有完整词 → 用完整词
    for (const c of canon) {
      if (!spaceSep && c.length >= 2 && w.sourceSpan.includes(c.slice(0, 2)) && sourceText.includes(c)) {
        w.sourceSpan = c; return;
      }
    }
    w.sourceSpan = "";
  }
  if (srcLang === "Vietnamese") {
    const CANON = {
      "比": ["hơn"], "太": ["quá"], "吗": ["không", "chưa", "à", "hả", "nhé"],
      "了": ["rồi", "đã", "xong"], "在": ["đang", "ở", "tại"], "正在": ["đang"],
      "会": ["sẽ", "biết"], "要": ["sẽ", "muốn", "cần"], "的": ["của"],
      "被": ["bị", "được"], "很": ["rất", "lắm"], "也": ["cũng"], "都": ["đều"],
      "是": ["là"], "给": ["cho", "Cho"], "和": ["và"], "跟": ["với"],
      "能": ["được", "có thể"], "不太": ["không"], "不": ["không", "chưa", "đừng"]
    };
    const VI_FUNC = ["đang", "đã", "sẽ", "rồi", "quá", "hơn", "của", "là", "không"];
    for (const w of ws) {
      if (CANON[w.chinese]) canonicalize(w, CANON[w.chinese], true);
      // 代词块吞词组 → 收缩到代词本词
      if (ZH_PRONOUNS.has(w.chinese) && w.sourceSpan && w.sourceSpan.includes(" ")) {
        const VP = ["tôi", "bạn", "anh", "chị", "em", "cô", "ông", "bà", "chúng", "họ", "nó", "mình"];
        const hit = w.sourceSpan.split(/\s+/).find(x => VP.includes(x.toLowerCase()));
        w.sourceSpan = hit || "";
      }
      // 多词代词补全:Anh ấy / Chúng tôi 是完整代词,不能只认一半
      if (ZH_PRONOUNS.has(w.chinese) && w.sourceSpan && !w.sourceSpan.includes(" ")) {
        for (const suf of [" ấy", " tôi", " ta", " mình"]) {
          if (sourceText.includes(w.sourceSpan + suf)) { w.sourceSpan = w.sourceSpan + suf; break; }
        }
      }
      // 实词块(名/动/形)吞了功能词 → 从边缘剥掉(Mẹ đang→Mẹ),功能词留给对应块
      if (["noun", "verb", "adjective"].includes(w.partOfSpeech) && w.sourceSpan && w.sourceSpan.includes(" ")) {
        let parts = w.sourceSpan.split(/\s+/);
        while (parts.length > 1 && VI_FUNC.includes(parts[parts.length - 1].toLowerCase())) parts.pop();
        while (parts.length > 1 && VI_FUNC.includes(parts[0].toLowerCase())) parts.shift();
        const joined = parts.join(" ");
        if (joined !== w.sourceSpan && sourceText.includes(joined)) w.sourceSpan = joined;
      }
      // 指示词吞名词:这个←Bài toán này → 这个←này,名词还给空块
      if (/^[这那][个些]?$/.test(w.chinese) && w.sourceSpan) {
        const mDem = w.sourceSpan.match(/^(.+)\s+(này|đó|kia|ấy)$/i);
        if (mDem) {
          w.sourceSpan = mDem[2];
          const t = ws.find(x => x.partOfSpeech === "noun" && !x.sourceSpan);
          if (t && sourceText.includes(mDem[1])) t.sourceSpan = mDem[1];
        }
      }
      // 这个/那个 ← 单独的 này/đó:若原文是「Cái/Con này」分类词短语 → 并入分类词
      if (/^[这那]个$/.test(w.chinese) && /^(này|đó|kia|ấy)$/i.test(w.sourceSpan || "")) {
        const m = sourceText.match(new RegExp("\\b(Cái|Con|Chiếc|cái|con|chiếc)\\s+" + w.sourceSpan, "i"));
        if (m) w.sourceSpan = m[0];
      }
      // 亲属词只认了性别词(妹妹←gái)→ 往前并入 em/anh/chị(Em gái)
      if (["gái", "trai"].includes((w.sourceSpan || "").toLowerCase())) {
        const pos = sourceText.indexOf(w.sourceSpan);
        const before = sourceText.slice(0, pos).match(/(\S+)\s+$/);
        if (before && ["em", "anh", "chị"].includes(before[1].toLowerCase())) {
          const cand = before[1] + " " + w.sourceSpan;
          if (sourceText.includes(cand)) w.sourceSpan = cand;
        }
      }
      // 时间块吞点钟(明天早上←Tám giờ sáng mai)→ X giờ 让给空的 N点 块
      if (!/点/.test(w.chinese) && w.sourceSpan) {
        const m = w.sourceSpan.match(/^(\S+\s+giờ)\s+(.+)$/);
        if (m) {
          const t = ws.find(x => /点$/.test(x.chinese) &&
            (!x.sourceSpan || m[1].includes(x.sourceSpan) || x.sourceSpan.includes("giờ")));
          if (t && sourceText.includes(m[1]) && sourceText.includes(m[2])) {
            t.sourceSpan = m[1]; w.sourceSpan = m[2];
          }
        }
      }
      // 没V/不V 复合块:span 缺否定词但原文有 không+span 相邻 → 补上
      if (/^[没不]./.test(w.chinese) && w.sourceSpan && !/không/i.test(w.sourceSpan) &&
          sourceText.includes("không " + w.sourceSpan)) {
        w.sourceSpan = "không " + w.sourceSpan;
      }
    }
  }
  if (srcLang === "Thai") {
    const POLITE = ["นะครับ", "นะคะ", "ครับผม", "ครับ", "ค่ะ", "คะ", "จ้า", "จ๊ะ"];
    const CANON = {
      "比": ["กว่า"], "吗": ["ไหม", "มั้ย", "หรือเปล่า", "หรือยัง"], "了": ["แล้ว"],
      "多少": ["เท่าไหร่", "เท่าไร"],
      "在": ["กำลัง", "ที่", "อยู่"], "正在": ["กำลัง"], "会": ["จะ", "ได้"], "要": ["จะ", "อยาก"],
      "不": ["ไม่"], "很": ["มาก"], "的": ["ของ"], "是": ["คือ", "เป็น"], "都": ["ทุก"]
    };
    const pendingTh = [];
    const CLASSIFIERS = ["เล่ม","ตัว","คน","อัน","แก้ว","ขวด","คัน","ใบ","ลูก","เครื่อง","ชิ้น","จาน","ห้อง",
      "บาท","เซนติเมตร","กิโลกรัม","กิโล","นาที","ชั่วโมง","วัน","ปี","ครั้ง","ที่"];
    for (const w of ws) {
      let s = w.sourceSpan || "";
      // 礼貌词从 span 尾剥掉;纯礼貌词的认领清空
      let changed = true;
      while (changed) { changed = false;
        for (const p of POLITE) if (s.length > p.length && s.endsWith(p)) { s = s.slice(0, -p.length); changed = true; }
      }
      if (POLITE.includes(s)) s = "";
      w.sourceSpan = (s && sourceText.includes(s)) ? s : "";
      if (CANON[w.chinese]) canonicalize(w, CANON[w.chinese], false);
      // 数词/量词块:后接分类词 → 并入(สาม→สามเล่ม)
      const isNumChip = /^[一两三四五六七八九十百千0-9]/.test(w.chinese) || w.partOfSpeech === "measureWord";
      if (isNumChip && w.sourceSpan) {
        const pos = sourceText.indexOf(w.sourceSpan);
        if (pos >= 0) {
          const rest = sourceText.slice(pos + w.sourceSpan.length);
          const cls = CLASSIFIERS.find(c => rest.startsWith(c));
          if (cls) w.sourceSpan = w.sourceSpan + cls;
        }
      }
      // V+了 块:原文紧随 แล้ว → 并入
      if (/了$/.test(w.chinese) && w.chinese.length >= 2 && w.sourceSpan) {
        const pos = sourceText.indexOf(w.sourceSpan);
        if (pos >= 0 && sourceText.slice(pos + w.sourceSpan.length).startsWith("แล้ว")) {
          w.sourceSpan = w.sourceSpan + "แล้ว";
        }
      }
      // 定语的 强凑关系词 ที่ → ∅(硬性规则3)
      if (w.chinese === "的" && w.sourceSpan === "ที่") w.sourceSpan = "";
      // 疑问尾 ไหม 被别的块吞了(可以←ได้ไหม)→ 剥出来转移给空的 吗
      if (w.chinese !== "吗" && /ไหม$/.test(w.sourceSpan || "") && w.sourceSpan.length > 3) {
        pendingTh.push("ไหม");
        w.sourceSpan = w.sourceSpan.slice(0, -3);
      }
    }
    for (const p of pendingTh) {
      const t = ws.find(x => x.chinese === "吗" && !x.sourceSpan);
      if (t) t.sourceSpan = p;
    }
  }
  if (srcLang === "Indonesian") {
    const CANON = {
      "了": ["sudah", "telah"], "已经": ["sudah", "telah"], "在": ["sedang", "lagi", "di"],
      "正在": ["sedang", "lagi"], "会": ["akan", "bisa"], "要": ["akan", "mau"],
      "不": ["tidak", "bukan", "nggak"], "很": ["sangat", "sekali", "banget"],
      "也": ["juga"], "都": ["semua"], "和": ["dan"], "跟": ["dengan"], "吗": ["kah", "apakah"],
      "是": ["adalah", "ialah"]
    };
    const ID_PRON = ["saya", "aku", "kamu", "anda", "dia", "ia", "mereka", "kami", "kita", "beliau"];
    const pendingId = [];
    for (const w of ws) {
      if (CANON[w.chinese]) canonicalize(w, CANON[w.chinese], true);
      // 代词/指示词吞词组 → 收缩
      if (ZH_PRONOUNS.has(w.chinese) && w.sourceSpan && w.sourceSpan.includes(" ")) {
        const hit = w.sourceSpan.split(/\s+/).find(x => ID_PRON.includes(x.toLowerCase()));
        w.sourceSpan = hit || "";
      }
      // 名词块尾部吞 itu/ini → 剥掉(pesta itu→pesta),留给指示词块;那家店 这类自带指示词的块保留
      if (["noun"].includes(w.partOfSpeech) && !/[这那這]/.test(w.chinese) && / (itu|ini)$/i.test(w.sourceSpan || "")) {
        const stripped = w.sourceSpan.replace(/ (itu|ini)$/i, "");
        if (sourceText.includes(stripped)) w.sourceSpan = stripped;
      }
      if (/^[这那這][个些家]?$/.test(w.chinese) && w.sourceSpan) {
        const mDem = w.sourceSpan.match(/\b(itu|ini)\b/i);
        w.sourceSpan = mDem ? mDem[0] : "";
      }
      // 领属 -nya:代词+的 块只认 nya,词根转移给后面的名词
      if (/^[他她它我你]们?的$/.test(w.chinese) && w.sourceSpan) {
        if (/nya$/.test(w.sourceSpan) && w.sourceSpan.length > 3) {
          pendingId.push(w.sourceSpan.slice(0, -3));   // 词根
          w.sourceSpan = "nya";
        } else if (!w.sourceSpan.includes("nya") && !ID_PRON.includes(w.sourceSpan.toLowerCase())) w.sourceSpan = "";
      }
      // 名词带 -nya 后缀 → 剥掉(Rumahnya→Rumah)
      if (w.partOfSpeech === "noun" && /nya$/.test(w.sourceSpan || "") && w.sourceSpan.length > 4) {
        w.sourceSpan = w.sourceSpan.slice(0, -3);
      }
      // -kah 疑问后缀:只在词根是已知疑问式词根时剥(Bisakah/Benarkah),menikah 这类实词不动
      if (w.chinese !== "吗" && /kah$/i.test(w.sourceSpan || "") && w.sourceSpan.length > 4 &&
          ["benar", "bisa", "boleh", "ada", "sudah", "mau", "perlu", "apa"].includes(w.sourceSpan.slice(0, -3).toLowerCase())) {
        pendingId.push("kah");
        w.sourceSpan = w.sourceSpan.slice(0, -3);
      }
      // 里/在 只该对齐 di:吞了词组 → 收缩,余词留给下面的未认领扫描
      if (["里", "在", "上"].includes(w.chinese) && /^di\s+\S/i.test(w.sourceSpan || "")) {
        w.sourceSpan = w.sourceSpan.split(/\s+/)[0];
      }
      // apa kabar(你好吗)习语:你 是补出主语,不许认 apa
      if (/^你$/.test(w.chinese) && /^apa$/i.test(w.sourceSpan || "") && /apa\s+kabar/i.test(sourceText)) w.sourceSpan = "";
      // 公斤/斤 块认了 ini/itu 这类指示词 → 让给 se量词(sekilo)
      if (/公斤|斤$/.test(w.chinese) && /^(ini|itu)$/i.test(w.sourceSpan || "")) {
        const m = sourceText.match(/\bse(kilo|ons)\w*/i);
        if (m) w.sourceSpan = m[0];
      }
      // 就 是中文添加的连接词,必须 ∅;吞掉的 tidak 还给空的 不
      if (w.chinese === "就" && w.sourceSpan) {
        const mTidak = w.sourceSpan.match(/\btidak\b/i);
        w.sourceSpan = "";
        if (mTidak) {
          const t = ws.find(x => x.chinese === "不" && !x.sourceSpan);
          if (t) t.sourceSpan = mTidak[0];
        }
      }
      // 不←bukan 后跟 是←∅ → 是 也认 bukan,相邻同span合并成 不是←bukan
      if (w.chinese === "是" && !w.sourceSpan) {
        const i0 = ws.indexOf(w);
        if (i0 > 0 && ws[i0 - 1].chinese === "不" && /^bukan$/i.test(ws[i0 - 1].sourceSpan || "")) {
          w.sourceSpan = ws[i0 - 1].sourceSpan;
        }
      }
      // 今年←tahun 漏了 ini → 补全 tahun ini(hari ini/malam ini 同理)
      if (/^今|^现在$/.test(w.chinese) && w.sourceSpan && !/ ini$/i.test(w.sourceSpan) &&
          sourceText.includes(w.sourceSpan + " ini")) {
        w.sourceSpan = w.sourceSpan + " ini";
      }
    }
    for (const root of pendingId) {
      const t = root === "kah"
        ? ws.find(x => x.chinese === "吗" && !x.sourceSpan)
        : ws.find(x => x.partOfSpeech === "noun" && !x.sourceSpan);
      if (t && sourceText.includes(root)) t.sourceSpan = root;
    }
    // 里/在/上 空着但原文有独立 di 未被认领 → 补上
    {
      const diUsed = ws.some(x => /\bdi\b/i.test(x.sourceSpan || ""));
      if (!diUsed && /(^|\s)di\s/i.test(sourceText)) {
        const t = ws.find(x => ["里", "在", "上"].includes(x.chinese) && !x.sourceSpan);
        if (t) t.sourceSpan = "di";
      }
    }
    // se+量词 = 一X:sekilo/sebuah 未被认领 → 给空的 一X/X公斤 块
    for (const tok of sourceText.split(/\s+/).map(t => t.replace(/[.,!?]/g, ""))) {
      if (!/^se(kilo|buah|ekor|gelas|botol|potong|orang|lembar|porsi)/i.test(tok)) continue;
      if (ws.some(x => x.sourceSpan && (x.sourceSpan.includes(tok) || tok.includes(x.sourceSpan)))) continue;
      const t = ws.find(x => /^[一这]|公斤|斤$/.test(x.chinese) && !x.sourceSpan &&
                        ["numeral", "number", "measureWord", "noun"].includes(x.partOfSpeech));
      if (t) t.sourceSpan = tok;
    }
    // 未认领整词扫描:Rumahnya/Benarkah 这类完全没被认领的词 → 拆开分给空块
    const ID_KAH_ROOTS = { "benar": "真", "bisa": "能", "boleh": "可", "ada": "有", "sudah": "已", "mau": "要", "perlu": "需" };
    const idTokens = sourceText.split(/\s+/).map(t => t.replace(/[.,!?]/g, ""));
    for (const tok of idTokens) {
      const claimedTok = ws.some(x => x.sourceSpan && (x.sourceSpan.includes(tok) || tok.includes(x.sourceSpan)));
      if (claimedTok) continue;
      if (/nya$/i.test(tok) && tok.length >= 5) {
        const root = tok.slice(0, -3);
        const nChip = ws.find(x => x.partOfSpeech === "noun" && !x.sourceSpan);
        if (nChip && sourceText.includes(root)) nChip.sourceSpan = root;
        const pChip = ws.find(x => /^[他她它]们?的$/.test(x.chinese) && !x.sourceSpan);
        if (pChip) pChip.sourceSpan = "nya";
      } else if (/kah$/i.test(tok) && tok.length >= 5) {
        const root = tok.slice(0, -3);
        const zh = ID_KAH_ROOTS[root.toLowerCase()];
        if (zh) {
          const t = ws.find(x => x.chinese.startsWith(zh) && !x.sourceSpan);
          if (t && sourceText.includes(root)) t.sourceSpan = root;
        }
        const q = ws.find(x => x.chinese === "吗" && !x.sourceSpan);
        if (q) q.sourceSpan = "kah";
      }
    }
  }
  if (srcLang === "Spanish") {
    const ES_ART = ["el", "la", "los", "las", "El", "La", "Los", "Las"];
    const ES_POSS = { "mi": "我", "Mi": "我", "mis": "我", "tu": "你", "Tu": "你", "tus": "你",
                      "su": "他", "Su": "他", "sus": "他", "nuestra": "我们", "nuestro": "我们" };
    const CANON = { "比": ["que"], "更": ["más"], "太": ["demasiado"], "很": ["muy", "mucho"],
                    "是": ["es", "son", "soy", "eres", "somos", "era", "fue", "está", "están", "estoy"],
                    "了": ["ya"], "有": ["hay", "Hay", "había", "Había", "tiene", "tengo", "tienen"],
                    "在": ["en", "a", "está", "están", "estoy", "estás"],
                    "去": ["ir", "voy", "vas", "va", "vamos", "van", "fui", "fue", "iré"] };
    const pendingEs = [];
    for (const w of ws) {
      let s = w.sourceSpan || "";
      // 冠词剥离(除非 一X 块:un/una 可携带)
      const words = s.split(/\s+/);
      if (words.length > 1 && ES_ART.includes(words[0]) && !/^[一]/.test(w.chinese)) {
        s = words.slice(1).join(" ");
      }
      // 前置物主代词剥离并转移(Mi hermana → hermana,Mi→我)
      const w2 = s.split(/\s+/);
      if (w2.length > 1 && ES_POSS[w2[0]] && !ZH_PRONOUNS.has(w.chinese)) {
        pendingEs.push([ES_POSS[w2[0]], w2[0]]);
        s = w2.slice(1).join(" ");
      }
      w.sourceSpan = (s && sourceText.includes(s)) ? s : (w.sourceSpan && sourceText.includes(w.sourceSpan) ? w.sourceSpan : "");
      if (s && sourceText.includes(s)) w.sourceSpan = s;
      if (CANON[w.chinese]) canonicalize(w, CANON[w.chinese], true);
      // 一X 已吞多词(una película):有空名词块 → 收缩到冠词,名词还给空块
      const mUn = (w.sourceSpan || "").match(/^(un|una|Un|Una)\s+(\S+)$/);
      if (/^一/.test(w.chinese) && mUn) {
        const i0 = ws.indexOf(w);
        const nn = ws.slice(i0 + 1, i0 + 3).find(x => x.partOfSpeech === "noun" && !x.sourceSpan);
        if (nn) { nn.sourceSpan = mUn[2].replace(/[.,!?]/g, ""); w.sourceSpan = mUn[1]; }
      }
      // 指示词吞系词(这←Este es)→ 只留指示词,es 让给空的 是
      if (/^[这那]/.test(w.chinese) && / /.test(w.sourceSpan || "")) {
        const parts = w.sourceSpan.split(/\s+/);
        if (/^(Este|Esta|Ese|Esa|Esto|Eso|Aquel|este|esta|ese|esa)$/.test(parts[0])) {
          const dropped = parts.slice(1);
          w.sourceSpan = parts[0];
          const cop = dropped.find(d => ["es", "son", "está", "están", "era", "fue"].includes(d.replace(/[.,!?]/g, "")));
          if (cop) {
            const t = ws.find(x => x.chinese === "是" && !x.sourceSpan);
            if (t) t.sourceSpan = cop.replace(/[.,!?]/g, "");
          }
        }
      }
      // 一X ← un/una:后面名词给谁?有独立空名词块就给它;没有才并入 一X
      if (/^一/.test(w.chinese) && ["un", "una", "Un", "Una"].includes(w.sourceSpan)) {
        const pos = sourceText.indexOf(w.sourceSpan);
        const rest = sourceText.slice(pos + w.sourceSpan.length).match(/^\s+([A-Za-zÁÉÍÓÚáéíóúñü]+)/);
        if (rest) {
          const i = ws.indexOf(w);
          const nextNoun = ws.slice(i + 1, i + 3).find(x => x.partOfSpeech === "noun" && !x.sourceSpan);
          const takenElsewhere = ws.some(x => x !== w && x.sourceSpan && x.sourceSpan.split(/\s+/).includes(rest[1]));
          if (nextNoun) nextNoun.sourceSpan = rest[1];
          else if (!takenElsewhere) w.sourceSpan = w.sourceSpan + " " + rest[1];
        }
      }
      // 物主合并块(我家/你妈妈):span 缺 mi/tu/su 前缀 → 补上(mi casa)
      if (/^[我你他她]/.test(w.chinese) && w.chinese.length >= 2 && w.sourceSpan &&
          !/^(mi|tu|su|Mi|Tu|Su)\b/.test(w.sourceSpan)) {
        for (const p of ["mi", "tu", "su", "Mi", "Tu", "Su"]) {
          if (sourceText.includes(p + " " + w.sourceSpan)) { w.sourceSpan = p + " " + w.sourceSpan; break; }
        }
      }
      // X岁 ← número + años
      if (/岁$/.test(w.chinese) && w.sourceSpan && !/años?/.test(w.sourceSpan)) {
        const pos = sourceText.indexOf(w.sourceSpan);
        if (pos >= 0 && /^\s+años?/.test(sourceText.slice(pos + w.sourceSpan.length))) {
          w.sourceSpan = w.sourceSpan + " años";
        }
      }
      // 拿/带/穿/戴 与介词无对应:span 是孤立介词 → ∅(强凑)
      if (["拿", "带", "穿", "戴"].includes(w.chinese) && /^(con|de|en|a|por|para)$/i.test(w.sourceSpan || "")) {
        w.sourceSpan = "";
      }
      // 物主+亲属/家 融合块(我家/我妈妈)空着 → 找 mi casa 这类短语补全
      if (!w.sourceSpan) {
        const KIN = { "家": "casa", "妈妈": "mamá", "母亲": "madre", "爸爸": "papá", "父亲": "padre",
                      "哥哥": "hermano", "弟弟": "hermano", "姐姐": "hermana", "妹妹": "hermana" };
        const mk = w.chinese.match(/^(我|你|他|她|我们)(家|妈妈|母亲|爸爸|父亲|哥哥|弟弟|姐姐|妹妹)$/);
        if (mk && KIN[mk[2]]) {
          const re = new RegExp("\\b(mi|tu|su|Mi|Tu|Su|nuestra|nuestro)\\s+" + KIN[mk[2]] + "\\b");
          const m = sourceText.match(re);
          if (m) w.sourceSpan = m[0];
        }
      }
      // 省主语守卫(已有):中文代词只许认领真代词/物主/宾格
      if (ZH_PRONOUNS.has(w.chinese) && w.sourceSpan) {
        const lower = w.sourceSpan.toLowerCase().replace(/[.,!?¿¡]/g, "");
        const OK = ["yo","tú","tu","usted","él","ella","nosotros","nosotras","ustedes","ellos","ellas","vos",
                    "mi","su","te","me","lo","la","nos","les","le"];
        if (!OK.includes(lower)) w.sourceSpan = "";
      }
    }
    for (const [zh, span] of pendingEs) {
      const t = ws.find(x => (x.chinese === zh || x.chinese === zh + "的") && !x.sourceSpan);
      if (t && sourceText.includes(span)) t.sourceSpan = span;
    }
  }
  // 语言块清完强凑 span 后,第二次 QMAP 补空(很←Hace 被清 → 补 mucho)
  qmapFill();
  // ⑤a 标点块
  for (const w of ws) {
    if (PUNCT_RE.test(w.chinese) && w.sourceSpan && !PUNCT_RE.test(w.sourceSpan)) w.sourceSpan = "";
    // 非标点块不许带走首尾标点(Maaf, → Maaf),标点留给标点块认领;纯标点 span 清空(吗←¿)
    if (!PUNCT_RE.test(w.chinese) && w.sourceSpan) {
      const t = w.sourceSpan.replace(/[.,!?;:。、!?]+$/, "").replace(/^[¿¡«"']+/, "");
      w.sourceSpan = /\p{L}|\p{N}/u.test(t) ? (t || w.sourceSpan) : "";
    }
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
      m2.push(mergeUnits(w, n, w.partOfSpeech, sourceText)); i++; continue;
    }
    if (n && w.partOfSpeech === "verb" && (n.chinese === "了" || n.chinese === "过") &&
        (!n.sourceSpan || n.sourceSpan === w.sourceSpan)) {  // 买+了 → 买了;了 有独立 span(rồi/แล้ว)则保持拆开
      m2.push(mergeUnits(w, n, "verb", sourceText)); i++; continue;
    }
    if (n && w.partOfSpeech === "pronoun" && n.chinese === "的") {     // 我+的 → 我的
      m2.push(mergeUnits(w, n, "pronoun", sourceText)); i++; continue;
    }
    // 日语愿望形:想←たい + 交←作り 且原文有连续的 作りたい → 想交←作りたい
    if (srcLang === "Japanese" && n && ["想", "要"].includes(w.chinese) &&
        /た[いく]$/.test(w.sourceSpan || "") && n.sourceSpan &&
        sourceText.includes(n.sourceSpan + w.sourceSpan)) {
      m2.push({ chinese: w.chinese + n.chinese, pinyin: [w.pinyin, n.pinyin].filter(Boolean).join(" "),
                partOfSpeech: "verb", sourceSpan: n.sourceSpan + w.sourceSpan, isGrammarStructure: false });
      i++; continue;
    }
    m2.push(w);
  }
  // ⑥ 介词/标记转移(用户标注得出的确定性规则)
  //   把←put 这类:把 是语法标记,span 让给后面的动词;被←was → 被←by(若原文有 by);
  //   在←on/in + 后面有空着的方位词 上/里 → span 让给方位词;坐←goes + 原文有 by → 坐←by
  if (srcLang === "English") {
    for (const w of ws) {
      const mArt = (w.sourceSpan || "").match(/^(the|a|an|The|A|An)\s+(.+)$/);
      if (mArt && !/^[一这那這]/.test(w.chinese) && sourceText.includes(mArt[2])) w.sourceSpan = mArt[2];
      if (/^(the|The)$/.test(w.sourceSpan || "")) w.sourceSpan = "";
      if (/^(a|an|A|An)$/.test(w.sourceSpan || "") && !/^一/.test(w.chinese)) w.sourceSpan = "";
      // 一杯/一双/一瓶… ← a:原文 "a <容器/量词> of" → 并入容器词(一杯←a cup)
      if (/^一.{1,2}$/.test(w.chinese) && /^(a|an|A|An)$/.test(w.sourceSpan || "")) {
        const pos = sourceText.indexOf(w.sourceSpan);
        const rest = sourceText.slice(pos + w.sourceSpan.length).match(/^\s+([A-Za-z]+)\s+of\b/);
        if (rest) w.sourceSpan = w.sourceSpan + " " + rest[1];
      }
      // 吗/呢/吧:英语无句末疑问助词(靠倒装),强凑 aux → ∅
      if (["吗", "呢", "吧"].includes(w.chinese) && w.sourceSpan) w.sourceSpan = "";
      // 已经=added already,不许认 be 动词(been/be/is/am/are)
      if (w.chinese === "已经" && /^(been|be|is|am|are|Been|Be|Is|Am|Are)$/.test(w.sourceSpan || "")) w.sourceSpan = "";
      // V不C 潜能式(不了/不下/不动…)不许认 to/the 类功能词
      if (/^不[了下动完起来去到]/.test(w.chinese) && /^(to|the|a|an|of|for|To|The)$/.test(w.sourceSpan || "")) w.sourceSpan = "";
    }
  }
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
      if (["拿", "把"].includes(w.chinese) && w.sourceSpan) {
        const i0 = m2.indexOf(w);
        for (let j = i0 + 1; j < m2.length && m2[j].chinese !== "。"; j++) {
          if (/(比较|比較|对比|相比)/.test(m2[j].chinese)) {
            if (!m2[j].sourceSpan) m2[j].sourceSpan = w.sourceSpan;
            w.sourceSpan = "";
            break;
          }
        }
      }
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
      // got + 过去分词整体:结婚了←got married(不是只对齐 married)
      if (w.partOfSpeech === "verb" && w.sourceSpan &&
          sourceText.includes("got " + w.sourceSpan)) {
        w.sourceSpan = "got " + w.sourceSpan;
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
  // 拉丁字母语言按「词边界」找位置:防止 he 匹配进 w[he]re
  const LATIN_BOUNDARY = ["English", "Spanish", "Vietnamese", "Indonesian"].includes(srcLang);
  const isLetter = ch => ch !== undefined && /\p{L}/u.test(ch);
  const ID_SUFFIX = /^(nya|kah|lah|ku|mu)$/i;
  function findSpan(s, fromIdx) {
    let idx = fromIdx;
    const wordLike = LATIN_BOUNDARY && /\p{L}/u.test(s[0]) && /\p{L}/u.test(s[s.length - 1]);
    while (true) {
      const p = sourceText.indexOf(s, idx);
      if (p === -1) return -1;
      if (!wordLike) return p;
      const before = sourceText[p - 1], after = sourceText[p + s.length];
      // 印尼语黏着词缀:nya/kah 作 span 时允许词内后缀位;词根后紧跟词缀时允许右界是字母
      let beforeOK = !isLetter(before);
      let afterOK = !isLetter(after);
      if (srcLang === "Indonesian") {
        const rest = sourceText.slice(p + s.length);
        if (!beforeOK && ID_SUFFIX.test(s) && afterOK) beforeOK = true;
        if (!afterOK && /^(nya|kah|lah)(?!\p{L})/iu.test(rest)) afterOK = true;
      }
      if (beforeOK && afterOK) return p;
      idx = p + 1;
    }
  }
  const claimed = [];
  for (const w of m2) {
    const s = w.sourceSpan;
    if (!s) continue;
    let idx = 0, placed = false;
    while (true) {
      const p = findSpan(s, idx);
      if (p === -1) break;
      const overlaps = claimed.some(([a, b]) => p < b && p + s.length > a);
      if (!overlaps) { claimed.push([p, p + s.length]); placed = true; break; }
      idx = p + 1;
    }
    // 多词 span 冲突收缩:「đã đọc」的 đã 已被 已经 认领 → 收缩为 đọc,而不是整个清空
    if (!placed && /\s/.test(s)) {
      const parts = s.split(/\s+/).filter(x => x && !PUNCT_RE.test(x)).sort((a, b) => b.length - a.length);
      for (const cand of parts) {
        let idx2 = 0;
        while (true) {
          const p = findSpan(cand, idx2);
          if (p === -1) break;
          const overlaps = claimed.some(([a, b]) => p < b && p + cand.length > a);
          if (!overlaps) { claimed.push([p, p + cand.length]); w.sourceSpan = cand; placed = true; break; }
          idx2 = p + 1;
        }
        if (placed) break;
      }
    }
    if (!placed) w.sourceSpan = "";
  }
  return m2;
}
function mergeUnits(a, b, pos, sourceText) {
  // 双方都有独立 span 且原文相邻(ba quyển / 空格或直连)→ 合并 span 一起带上
  let span = a.sourceSpan || b.sourceSpan || "";
  if (a.sourceSpan && b.sourceSpan && a.sourceSpan !== b.sourceSpan && sourceText) {
    for (const joined of [a.sourceSpan + " " + b.sourceSpan, a.sourceSpan + b.sourceSpan]) {
      if (sourceText.includes(joined)) { span = joined; break; }
    }
  }
  return {
    chinese: a.chinese + b.chinese,
    pinyin: [a.pinyin, b.pinyin].filter(Boolean).join(" "),
    partOfSpeech: pos,
    sourceSpan: span,
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
  const { openAIJSON, MODEL: MODEL_BASE, DICT_MODEL, APP_SHARED_SECRET,
          monthKey, cacheSweep, cachePut, sendToAxiom, CACHE_MAX = 30000 } = deps;
  // 中文版可独立换模型:在 Railway 设 OPENAI_MODEL_ZH(如 gpt-4o)即可,
  // 不影响英文版;不设则跟随英文版的 OPENAI_MODEL。词对齐细粒度拆分强模型明显更稳。
  const MODEL = process.env.OPENAI_MODEL_ZH || MODEL_BASE;

  // 版本探针:确认部署是否落地
  app.get("/zh/version", (_req, res) => res.json({ zh: "v3.6.3", fixup: true, model: process.env.OPENAI_MODEL_ZH || "inherit" }));

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
      // 只读调试:抓修正前原始词块(用于确定性回归,不改变正常响应结构)
      const rawWords = req.body.__raw ? JSON.parse(JSON.stringify(parsed.words || [])) : null;
      // 词对齐确定性修正(去幻觉/剥助词/合并/去重)—— 见 fixupZhAlignment
      const words = fixupZhAlignment(sourceText, parsed.words || [], sourceLanguage);
      // grammarPoints: templateKey 命中就用它当 name(App 据 name 查本地模板)
      const grammarPoints = (parsed.grammarPoints || []).map(g => ({
        name: g.templateKey && g.templateKey.length ? g.templateKey : (g.name || ""),
        triggerWords: g.triggerWords || []
      })).filter(g => g.name);
      res.json({ translation: parsed.translation, words, grammarPoints, ...(rawWords ? { rawWords } : {}) });
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
