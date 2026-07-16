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
    `       · ${srcLang === "Japanese" ? "Japanese usually OMITS the subject: added 我/你/我们 → \"\" unless 私/あなた/彼 etc. is literally present. NEVER align 我 to an unrelated word." : "Added pronouns/particles with no counterpart → \"\"."}\n` +
    `       · Chinese-added words → "": structural 的/地/得 (relative-clause 的, adverbial 地), added 都/也/就/还, ` +
    `added coverb 在 when the localizer 上/里 already claims the source preposition, added nouns like 钱 in 多少钱←how much.\n` +
    `    D. Each source substring may be claimed by AT MOST ONE unit — never let two units share a span. ` +
    `If two Chinese words jointly translate one source word, make them ONE unit (see SPLITTING) instead of duplicating.\n` +
    `    E. Align function words to their true counterparts when present:\n` +
    `       · copula 是 ← is/am/are${srcLang === "Japanese" ? "/です/だ" : ""} (only "" when the source truly has no copula; never align 是 to a non-copula で).\n` +
    `       · 吗 ← ${srcLang === "Japanese" ? "か;  吧 ← ましょう/ませんか;  既…又 ← …し…し;  如果 ← たら/れば (just the conditional ending, e.g. 如果←たら NOT いらっしゃったら);  即使 ← ても/であれ" : "the question auxiliary do/did only if nothing else fits, else \"\";  吧 ← let's"}.\n` +
    `       · locative/instrumental: 在 ← ${srcLang === "Japanese" ? "で (locative particle)" : "in/at"}, 上 ← on, 里 ← in;  坐 ← ${srcLang === "Japanese" ? "instrumental で or \"\"" : "by"};  被 ← by (passive agent);  把 ← "".\n` +
    `       · ${srcLang === "Japanese" ? "compound verbs SPLIT: 持って行って → 带←持って + 去←行って;  たい→想;  strip particles は/が/を/に/も/の from spans (彼→他 NOT 彼は)" : "verb inflections: align the inflected form (去←goes is fine), but each form only once"}.\n` +
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
const JA_PRONOUNS = ["私","僕","俺","あなた","君","彼女","彼","我々","皆"];
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
    for (const w of ws) {
      let s = w.sourceSpan || "";
      while (s.length > 1 && JA_TRAIL_PARTICLES.has(s[s.length - 1])) s = s.slice(0, -1);
      // 末尾 で:
      // · 在/坐/用(介引作用)→ 收缩到只认 で 本身(ここで→で,由 这里 认领 ここ)
      // · 动词块(て形:飲んで/泳いで)→ 保留,で 是动词的一部分
      // · 其他(名词+locative で)→ 剥掉
      if (s.length > 1 && s.endsWith("で")) {
        if (["在", "坐", "用"].includes(w.chinese)) s = "で";
        else if (w.partOfSpeech !== "verb") s = s.slice(0, -1);
      }
      if (s !== w.sourceSpan) w.sourceSpan = (s && sourceText.includes(s)) ? s : "";
      // 代词防幻觉:日语原文没这个代词就不许认领任何东西
      if (ZH_PRONOUNS.has(w.chinese) && w.sourceSpan &&
          !JA_PRONOUNS.some(p => w.sourceSpan.includes(p))) {
        w.sourceSpan = "";
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
    if (prev && w.sourceSpan && prev.sourceSpan === w.sourceSpan && !PUNCT_RE.test(w.chinese)) {
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
  // ⑤b 全局去重:同一非空 span 只能出现一次(保留先出现的)
  const seen = new Set();
  for (const w of m2) {
    if (!w.sourceSpan) continue;
    if (seen.has(w.sourceSpan)) w.sourceSpan = "";
    else seen.add(w.sourceSpan);
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
