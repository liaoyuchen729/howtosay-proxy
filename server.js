// How to Say —— 翻译代理服务(部署在 Railway)
// App 只连这里;OpenAI key 放在 Railway 的环境变量里,不进代码、不进 App。
//
// 接口:POST /translate
//   body: { "sourceText": "...", "style": "standard|casual|formal|concise", "sourceLanguage": "Japanese" }
//   返回: 直接是 App 需要的结果 JSON(translation / words / grammarPoints)

import express from "express";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ============= Axiom 日志推送(可选,未配置时静默跳过) =============
// 配置方式:在 Railway 环境变量加 AXIOM_TOKEN 和 AXIOM_DATASET 即生效。
const AXIOM_TOKEN   = process.env.AXIOM_TOKEN   || "";
const AXIOM_DATASET = process.env.AXIOM_DATASET || "";
const AXIOM_INGEST  = AXIOM_DATASET
  ? `https://api.axiom.co/v1/datasets/${AXIOM_DATASET}/ingest`
  : "";
function sendToAxiom(evt) {
  if (!AXIOM_TOKEN || !AXIOM_INGEST) return; // 没配就跳过
  // fire-and-forget,失败不影响主流程
  fetch(AXIOM_INGEST, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AXIOM_TOKEN}`
    },
    body: JSON.stringify([evt])
  }).catch(() => {});  // 静默吞掉网络错误,不影响翻译
}

// 加载本地 157 + 别名,作为语法模板可选项
const __dirname = dirname(fileURLToPath(import.meta.url));
const T = JSON.parse(readFileSync(join(__dirname, "templates.json"), "utf-8"));
const TEMPLATE_NAMES = T.templates;              // 规范名
const ALIASES = T.aliases || {};                 // 旧名 → 规范名
// 给模型看的清单 = 规范名(别名映射在服务端处理,不让模型看到二份)
const TEMPLATE_ENUM = ["", ...TEMPLATE_NAMES];   // 空 = 「都对不上」

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;                 // ← 在 Railway 里设置
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";        // 可在 Railway 改型号
// gpt-4.1-mini:吞吐约为 4o-mini 的 1.5-2 倍、指令遵循更好、价格相近 —— 翻译主链路提速的关键一环
// 词典释义专用:量小(按月缓存、全用户共享)但准确性要求高 —— 小模型会对
// 生僻词×小语种瞎编(如印地语的 sea urchin),用强一档的型号
const DICT_MODEL = process.env.OPENAI_MODEL_DICT || "gpt-4o";
const APP_SHARED_SECRET = process.env.APP_SHARED_SECRET || "";    // 可选:防止别人乱用你的接口

const POS = ["noun","verb","adjective","adverb","pronoun","preposition","conjunction",
  "article","auxiliary","interjection","contraction","infinitive","particle","number","unknown"];

function styleDesc(style) {
  switch (style) {
    case "casual":
      return "very casual, the way a young native speaker would actually say it to a friend in chat or speech. " +
        "Use contractions (I'm, you're, don't, won't, gonna, wanna, kinda), informal vocabulary, sentence " +
        "fragments where natural, and conversational markers (like, you know, hey, yeah). " +
        "Examples: 'I'm super tired today.' / 'Wanna grab a movie?' / 'Nah, not into sea urchin.' / 'She's such a sweetheart.' " +
        "AVOID textbook phrasings.";
    case "formal":
      return "formal, polished, and polite — the way you would write a professional email or speak in a business " +
        "setting. NO contractions (use I am, do not, will not). Prefer full vocabulary (would like to, " +
        "I am afraid that, regarding, indeed). Use complete, well-structured sentences. " +
        "Examples: 'I am extremely tired today.' / 'Would you care to join me for a film, should you have the time?' / " +
        "'I am not fond of sea urchin.' / 'She is a remarkably gentle person.'";
    case "concise":
      return "as short and punchy as possible while keeping the core meaning. Drop optional words, articles, " +
        "and subjects when natural. Use the fewest words possible — under 6 words when feasible. " +
        "Examples: 'So tired today.' / 'Movie later?' / 'Not a fan of sea urchin.' / 'She's super kind.'";
    default:
      return "standard, neutral, textbook-natural English — what a typical learner would expect. Balanced, " +
        "no contractions in writing but not stiff. Examples: 'I am very tired today.' / 'Would you like to " +
        "watch a movie together?' / 'I do not like sea urchin.' / 'She is a very kind person.'";
  }
}

// 注意:system prompt 是「按语言静态」的 —— 风格和原文放在 user message 里。
// 这样长长的规则 + 模板清单成为稳定前缀,自动命中 OpenAI prompt cache(缓存半价),
// 同一语言的所有请求(含切风格重译)都吃到折扣。
function systemPrompt(lang) {
  return `You are the translation + linguistic-annotation engine for an English-learning app called "How to Say". ` +
    `The user writes in ${lang}; translate it into natural English and annotate it for a ${lang}-speaking learner. ` +
    `Return ONLY JSON matching the schema.\n\n` +
    `Rules:\n` +
    `- translation: an English translation of the input, written in the STYLE specified at the top of the ` +
    `user message.\n` +
    `  Pick wording that is DISTINCTLY different from the other three styles; if the only difference would be ` +
    `a contraction, push further (different vocabulary, different sentence shape).\n` +
    `- words: split the English translation into meaningful units IN ORDER. Together the units must cover the ` +
    `whole translation.\n` +
    `  SPLITTING RULES (learners bookmark individual words into their vocabulary book — a merged chunk ` +
    `cannot be bookmarked):\n` +
    `  • A noun is ALWAYS its own unit. NEVER merge a possessive / article / adjective into the noun's unit: ` +
    `"your farts" → "your" + "farts"; "my nose" → "my" + "nose"; "dog feces" → "dog" + "feces"; ` +
    `"the red car" → "the" + "red" + "car".\n` +
    `  • Multi-word units are ONLY allowed for (a) fixed lexical items whose meaning is non-compositional: ` +
    `phrasal verbs ("give up"), idioms ("piece of cake"), established compounds ("ice cream", "sea urchin"); ` +
    `(b) grammar chunks ("wouldn't have done", "might break", "worse than").\n` +
    `  • Grammar chunks must be MINIMAL — do not absorb subject pronouns or neighboring content words. ` +
    `"They smell worse than" is WRONG: split as "They" + "smell" + "worse than".\n` +
    `  For each unit:\n` +
    `  • english: its English text.\n` +
    `  • partOfSpeech: exactly one of [${POS.join(", ")}].\n` +
    `  • sourceSpan — STRICT RULES (failure to follow these breaks the app):\n` +
    `    A. sourceSpan MUST be COPIED CHARACTER-FOR-CHARACTER from the user's input. Same case ("Tienes" not ` +
    `"tienes"), same diacritics ("Você" not "voce"), same inflection / conjugation / particle ("किया" not "करना"). ` +
    `If your chosen span is not literally found inside the input string, the whole answer is wrong.\n` +
    `    B. Map by MEANING, not by position. E.g. "うにはすきじゃない" → "sea urchin" sourceSpan = "うに".\n` +
    `    C. NEVER invent or substitute a word that is not in the input. If the source has no word for this ` +
    `English unit, sourceSpan MUST be the empty string "". Common cases of "":\n` +
    `       - The source language omits the subject and you added an English pronoun ` +
    `(Japanese / Korean / Chinese / Spanish / Portuguese / Vietnamese / Indonesian / Hindi all drop subjects).\n` +
    `       - English articles a/an/the with no source counterpart.\n` +
    `       - Auxiliary verbs do/does/did/have/has/will/can inserted only for English grammar when the source ` +
    `expresses the same idea inside another word (Spanish "Tienes hambre?" → "Are/you" both have sourceSpan="", ` +
    `"hungry"→"hambre"; Korean "지금 뭐 해?" → "What"→"뭐", "are/you"→"", "doing"→"해", "now"→"지금").\n` +
    `       - English copula is/am/are/'m/'s when the source uses a particle (は/が) or nothing.\n` +
    `       - The English "to" in "want to do".\n` +
    `    D. If the source DOES contain a CONTENT word, you MUST map to it — Chinese "不"→"don't"/"not", ` +
    `Japanese "おなら"→"farts". Do not output "" when a real source content word exists.\n` +
    `       EXCEPTION — these English FUNCTION words always get sourceSpan="" even when the source has a ` +
    `corresponding word, because the mapping is obvious and colors are reserved for content words: ` +
    `personal pronouns (I/you/he/she/it/we/they, me/him/her/us/them), possessive determiners ` +
    `(my/your/his/her/its/our/their), the verb be (am/is/are/was/were, 'm/'s/'re), articles (a/an/the). ` +
    `E.g. Japanese "私は元気" → "I"="", "fine"="元気"; "お前のおなら" → "your"="", "farts"="おなら"; ` +
    `Chinese "我喜欢你" → "I"="", "like"="喜欢", "you"=""; Spanish "yo te quiero" → "I"="", "love"="quiero", ` +
    `"you"="". This applies to every source language.\n` +
    `    E. PURE grammatical markers (case / topic / mood particles with no English counterpart) MUST NEVER ` +
    `appear as a sourceSpan. Leave them unaligned (sourceSpan=""). Lists by language:\n` +
    `       - Japanese: は が を の や ね よ か な ば ぞ ぜ さ わ\n` +
    `       - Chinese (Hans/Hant): 的 了 吗 嗎 呢 吧 啊 哦 哈 嘛 呐 哟 喔\n` +
    `       - Korean: 은 는 이 가 을 를 의 도 만 로 으로 라고 라는\n` +
    `       - Hindi: ने ही भी तो ना वाला वाली वाले\n` +
    `       BUT particles that DO translate into an English word MUST be aligned — learners want to see these:\n` +
    `       より→"than", から→"from"/"because", まで→"until", へ/に→"to", と→"with"/"and", も→"too"/"also", ` +
    `ずっと→"way"/"much"; Korean 보다→"than", 부터→"from", 까지→"until", 와/과→"with"/"and", 도→"too"; ` +
    `Hindi में→"in", पर→"on", से→"from"/"than", तक→"until", के लिए→"for".\n` +
    `       Example: "このことは思っていたよりずっと難しい" → "This"="このこと" (full word — こと is part of ` +
    `the noun, NOT the particle と), "is"="", "way"="ずっと", "harder"="難しい", "than"="より", ` +
    `"I"="", "thought"="思っていた".\n` +
    `       - Vietnamese (classifiers / final particles): cái con chiếc bài cuốn — these classifiers should NOT ` +
    `be a sourceSpan unless the English unit literally is "a/the [classifier-thing]"; final particles à, ạ, nhé, ` +
    `nhỉ, đi, thôi, mà never get a sourceSpan\n` +
    `       - Indonesian (clitic particles): -lah, -kah, -tah, sih, dong, kok, deh, nih, tuh — never a sourceSpan; ` +
    `the prepositions di / ke / dari / pada DO carry meaning, those are OK to align to English in/at/to/from\n` +
    `       - Spanish: standalone "que" used as relative pronoun or "se" reflexive marker — usually leave ""; ` +
    `articles el/la/los/las/un/una align ONLY when English has the/a/an as a real unit\n` +
    `       - Portuguese: same as Spanish (que / se / o / a / os / as / um / uma)\n` +
    `       The rule: if the source word is a grammatical marker the target English doesn't need a separate ` +
    `word for, set sourceSpan="". Don't grab it just to "have something there".\n` +
    `    F. Keep each sourceSpan to the MINIMAL substring carrying that meaning. Do not include neighboring ` +
    `words. For "すきじゃない" → "don't like": "like"="すき", "don't"="じゃない".\n` +
    `    E2. Causative 让/使/令 (Chinese), させる/させ (Japanese), 하게 (Korean): when the translation ` +
    `uses a plain verb instead of let/make ("让它保持这个速度" → "keep it at this speed"), the English verb ` +
    `maps to the verb AFTER the causative (keep=保持), and 让/使 itself gets sourceSpan="". ` +
    `Only map 让→let/make when "let"/"make" literally appears in your translation.\n` +
    `    E3. Chinese V得 complement (唱得好听 / 跑得快): the verb maps to the VERB ONLY (sings=唱 or 唱歌), ` +
    `the adverb maps to the complement (well=好听). Never include 得 or the complement in the verb's span.\n` +
    `    F2. ONE span, ONE unit: two different units MUST NOT claim the same source span occurrence. ` +
    `Split it: Japanese "おいしそう" → "delicious"="おいし" + "looks"="そう" (そう = looks/seems suffix); ` +
    `Korean "맛있어 보여" → "delicious"="맛있어", "looks"="보여". Giving both words the same full span is wrong.\n` +
    `    F3. English intensity adverbs YOU added (really / actually / truly / just / simply) map ONLY to an ` +
    `explicit source adverb (本当に / 真的 / 정말 / realmente / 本當). NEVER map them to a source adjective ` +
    `or verb — if the source has no such adverb, sourceSpan="".\n` +
    `    G. Self-check before returning: every non-empty sourceSpan must satisfy ` +
    `(sourceText.includes(sourceSpan) === true). If not, set it to "".\n` +
    `    H. Politeness / hedging scaffolding that you ADDED in English (e.g. "I am afraid that", "I think", ` +
    `"I would say", "please note", "you see") has NO source counterpart → its sourceSpan MUST be "". ` +
    `NEVER let such a phrase absorb source words that belong to the content units. ` +
    `Example (formal Japanese): 鼻が壊れちゃいそう — WRONG: "I am afraid that"="鼻が壊れちゃいそう" with ` +
    `"my nose"="" and "might break"=""; RIGHT: "I am afraid that"="", "my nose"="鼻", "might break"="壊れちゃいそう". ` +
    `This applies to EVERY source language: each source content word must be claimed by the unit that actually ` +
    `translates it, and added English filler claims nothing. ` +
    `(Exception: when the source itself contains the hedge — Chinese "恐怕"→"I'm afraid", Japanese "と思う"→"I think" — ` +
    `then mapping it IS correct.)\n` +
    `The words array is in the order of the ENGLISH translation (left to right); sourceSpan values may ` +
    `therefore appear in any order across the source text.\n` +
    `  • isGrammarStructure: true ONLY when this unit is itself a MULTI-WORD grammar pattern such as ` +
    `"had better", "wouldn't have done", "be supposed to", "prefer X to Y", "to go" (the infinitive marker). ` +
    `For ordinary single-word vocabulary — common nouns, verbs, adjectives, adverbs, including inflected forms ` +
    `like "stinks", "farts", "ran", "beautifully", "happier" — isGrammarStructure MUST be false. ` +
    `If in doubt, set false. Single content words are never grammar structures.\n` +
    `- grammarPoints: 1-3 key grammar structures actually used in this sentence (not more). ` +
    `An EMPTY grammarPoints array is acceptable ONLY for trivially simple sentences (plain ` +
    `subject-verb-object with no notable pattern). If the translation contains anything a learner would ` +
    `ask about — comparatives, "X-er and X-er", idioms, modal nuance — you MUST report it (with templateKey ` +
    `when matched, otherwise with a short ${lang} name). For each:\n` +
    `\n` +
    `  STEP 1 — identify the grammar by inspecting YOUR ENGLISH TRANSLATION, not the user's source.\n` +
    `  Read your translation back. Which fixed structures actually appear in those English words?\n` +
    `  - If your translation contains "prefer X to Y" → match prefer X to Y.\n` +
    `  - If it contains "way more / way better / way too" → match "way + 比较级", NOT prefer.\n` +
    `  - If it contains "had better / 'd better" → match had better.\n` +
    `  - If it contains "end up + V-ing" → match end up doing.\n` +
    `  - If it contains "X-er and X-er" / "more and more" → match 比较级 and 比较级(越来越).\n` +
    `  - If it contains a comparative ("worse than", "better than", "more X than", "-er than") → ALWAYS ` +
    `include it as a grammar point (matched template or fallback). Comparatives must never be skipped.\n` +
    `  - Modal + verb ("might break", "could happen") is a valid grammar point when it carries the ` +
    `sentence's meaning (可能性/推量); include its full triggerWords (["might","break"], not just ["might"]).\n` +
    `  - If it contains a plain "should + base verb" → just past tense / simple modal — do NOT force a fit.\n` +
    `  - If your translation does NOT contain the source's idiomatic structure (e.g. user wrote "最终爱上" but you ` +
    `translated as "eventually fell in love"), pick a templateKey based on the actual English you produced (e.g. ` +
    `simple past), or leave templateKey="" if no clear pattern.\n` +
    `  The grammar must be IN your translation. Picking a structure that only exists in the source language is wrong.\n` +
    `\n` +
    `  STEP 2 — try to match it to ONE entry in this list of ${TEMPLATE_NAMES.length} well-known grammar templates ` +
    `(internal IDs in Simplified Chinese, learner sees a localized version):\n` +
    `${TEMPLATE_NAMES.map(n => `    "${n}"`).join(",\n")}\n` +
    `\n` +
    `  CRITICAL — only pick a templateKey if there is a TRULY EXACT semantic match (95%+ overlap). ` +
    `A WRONG templateKey is much WORSE than templateKey="" (we have a good fallback for "").\n` +
    `  CRITICAL — if the template name embeds a specific English word (e.g. "really 句型", "prefer X to Y", ` +
    `"had better"), THAT EXACT WORD must literally appear in YOUR translation of THIS request. ` +
    `Synonyms do NOT count: if your translation says "seriously", the "really" template is WRONG — ` +
    `seriously ≠ really, very ≠ really, truly ≠ really. Re-check this for every style: the casual / formal / ` +
    `concise rewrites often swap the keyword out, and then the template no longer applies.\n` +
    `\n` +
    `  SENSE CHECK — a template matches only in its OWN sense:\n` +
    `    • "feel like doing(想做)" = желание/desire ("I feel like eating pizza"). "feel like + CLAUSE" ` +
    `("I feel like my nose might break" = it seems) is a DIFFERENT structure — do NOT match the 想做 template; ` +
    `use templateKey="" with an appropriate fallback name instead.\n` +
    `  COMMON MISTAKES TO AVOID — for these structures the list has NO match, set templateKey="":\n` +
    `    • "prefer X to Y" → NOT "不定式作宾语(want/decide 类)". The "to" here is a PREPOSITION (= "rather than"), ` +
    `not the infinitive "to". leave templateKey="".\n` +
    `    • "way more / way better / way too" → NOT "the more ... the more". "way" is an intensifier (= much), ` +
    `not the "the more X the more Y" correlative. leave templateKey="".\n` +
    `    • "would rather X than Y" → NOT in the list (the "would rather(宁愿)" entry covers a different sense). ` +
    `If in doubt, leave templateKey="".\n` +
    `    • "had better", "be supposed to", "be about to", "end up doing", "be used to doing", "get used to", ` +
    `"can't help doing", "look forward to", "it's no use", "feel like doing" → NOT in the list. ` +
    `Leave templateKey="".\n` +
    `    • "so + adj + that ...", "such + n + that ...", "too + adj + to ...", "adj enough to ..." → NOT in the list.\n` +
    `    • Any fixed phrasal / idiom that is not literally one of the 164 names → leave templateKey="".\n` +
    `\n` +
    `  Match by EXACT grammar structure, not by surface similarity. ` +
    `"比起意面我更喜欢寿司" SOUNDS comparative but its grammar is "prefer X to Y" — set templateKey="".\n` +
    `\n` +
    `  STEP 3 — fill the fields:\n` +
    `  • templateKey: the chosen list entry, or "" if no perfect match.\n` +
    `  • triggerWords: the English fragments in your translation that trigger this point. ` +
    `List EVERY word that forms the pattern — including small connector words like than/to/of/as — ` +
    `exactly as they appear in your translation: ` +
    `["prefer", "to"] for "prefer X to Y"; ["way", "worse", "than"] for "way worse than" (do NOT omit "than"); ` +
    `["as", "soon", "as"] for "as soon as"; ["had", "better"] for "had better". ` +
    `Every triggerWord must be literally present in your translation.\n` +
    `  • name: if templateKey != "" → "". If templateKey == "" → a short grammar-point name IN ${lang} ` +
    `(e.g. "prefer X to Y 句型"). Do NOT write any explanation here — details are fetched separately.\n\n` +
    `Any ${lang} text (e.g. fallback grammar-point names) MUST be written in ${lang}, never in any other language.`;
}

const exampleSchema = {
  type: "object",
  properties: { en: { type: "string" }, cn: { type: "string" } },
  required: ["en", "cn"], additionalProperties: false
};
// 注意:words 里不再带 examples 和 definition ——
// · 例句:点开词详情按需生成(/word-example,按月缓存)
// · 释义:点开词详情按需查询(/word-definition,词典口径、永久缓存)
// /translate 只回"立刻要显示"的最小数据:译文 + 词块 + 对齐 + 语法引用,
// 输出小 = 生成快 = 不超时;详情的 token 只为真正点开的词花。
const wordSchema = {
  type: "object",
  properties: {
    english: { type: "string" },
    partOfSpeech: { type: "string", enum: POS },
    sourceSpan: { type: "string" },
    isGrammarStructure: { type: "boolean" }
  },
  required: ["english","partOfSpeech","sourceSpan","isGrammarStructure"],
  additionalProperties: false
};
// 语法点:/translate 只回最小引用(模板 ID 或 fallback 名 + 触发词)。
// 详解(含义/结构/例句)在用户点开「语法详解」时按需走 /grammar-detail,
// 模板命中时 App 用本地内容,零 API 成本。
const grammarSchema = {
  type: "object",
  properties: {
    // 模板 ID(来自模板清单);不匹配填 ""
    templateKey: { type: "string", enum: TEMPLATE_ENUM },
    // 必填:本句英文里触发这个语法的片段
    triggerWords: { type: "array", items: { type: "string" } },
    // templateKey=="" 时的简短语法名;命中模板时填 ""
    name: { type: "string" }
  },
  required: ["templateKey","triggerWords","name"],
  additionalProperties: false
};
const schema = {
  type: "object",
  properties: {
    translation: { type: "string" },
    words: { type: "array", items: wordSchema },
    grammarPoints: { type: "array", items: grammarSchema }
  },
  required: ["translation","words","grammarPoints"], additionalProperties: false
};

// 健康检查
const SERVER_BUILD = "v12";
app.get("/", (_req, res) => res.send(`How to Say proxy: OK ${SERVER_BUILD}`));


// ============= 词组级模板匹配器(模块级,⓪校验 和 ②.5兜底 共用) =============
const ESC_RE = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 模板名里的占位符 / 泛指词,断开词组、不参与匹配
const TPL_PLACEHOLDER = new Set(["sb","sth","adj","adv","one","ving","ved","verb","noun","wh","etc","do","doing","done","x","y","n","v"]);
// 不规则动词:后缀容忍 (s|es|d|ed|ing) 救不了的变位形式
const IRREGULAR_FORMS = {
  have:["have","has","had","having"], get:["get","gets","got","gotten","getting"],
  make:["make","makes","made","making"], take:["take","takes","took","taken","taking"],
  keep:["keep","keeps","kept","keeping"], go:["go","goes","went","gone","going"],
  come:["come","comes","came","coming"], feel:["feel","feels","felt","feeling"],
  think:["think","thinks","thought","thinking"], say:["say","says","said","saying"],
  see:["see","sees","saw","seen","seeing"], know:["know","knows","knew","known","knowing"],
  let:["let","lets","letting"], find:["find","finds","found","finding"],
  give:["give","gives","gave","given","giving"], tell:["tell","tells","told","telling"],
  leave:["leave","leaves","left","leaving"], pay:["pay","pays","paid","paying"],
  spend:["spend","spends","spent","spending"], lose:["lose","loses","lost","losing"],
  catch:["catch","catches","caught","catching"], put:["put","puts","putting"],
  run:["run","runs","ran","running"], cut:["cut","cuts","cutting"],
  begin:["begin","begins","began","begun"], write:["write","writes","wrote","written"],
  bring:["bring","brings","brought","bringing"], buy:["buy","buys","bought","buying"],
  hold:["hold","holds","held","holding"], stand:["stand","stands","stood","standing"],
};
// 缩写词 / 所有格占位:展开形式与缩写互通
const TOKEN_ALT = {
  "can't":["can't","cannot","can not"], "won't":["won't","will not"],
  "i'd":["i'd","i would","i had"], "you'd":["you'd","you would","you had"],
  "it's":["it's","it is","it has"], "i'm":["i'm","i am"],
  "would've":["would've","would have"],
  "one's":["one's","his","her","my","your","our","their","its"],
};
function tplPhraseRuns(segment) {
  const runs = []; let cur = [];
  const re = /[A-Za-z']+/g; let m, lastEnd = -1;
  while ((m = re.exec(segment)) !== null) {
    const tok = m[0];
    const adjacent = lastEnd >= 0 && /^\s*$/.test(segment.slice(lastEnd, m.index));
    if (TPL_PLACEHOLDER.has(tok.toLowerCase())) { if (cur.length) { runs.push(cur); cur = []; } }
    else if (adjacent && cur.length) cur.push(tok);
    else { if (cur.length) runs.push(cur); cur = [tok]; }
    lastEnd = m.index + tok.length;
  }
  if (cur.length) runs.push(cur);
  return runs;
}
function tplTokenPattern(t) {
  const tl = t.toLowerCase();
  if (tl === "be") return "(?:be|is|am|are|was|were|been|being)";
  if (IRREGULAR_FORMS[tl]) return `(?:${IRREGULAR_FORMS[tl].join("|")})`;
  if (TOKEN_ALT[tl]) return `(?:${TOKEN_ALT[tl].map(a => ESC_RE(a).replace(/ /g, "\\s+")).join("|")})`;
  if (tl.endsWith("n't")) {
    const stem = tl.slice(0, -3);
    return `(?:${ESC_RE(tl)}|${ESC_RE(stem)}\\s+not)`;
  }
  return ESC_RE(t) + "(?:s|es|d|ed|ing)?";
}
// 返回 (模板名) => 是否与该译文匹配 的校验函数
function makeTemplateMatcher(translation) {
  const phraseIn = (run) =>
    new RegExp(`(^|[^A-Za-z])${run.map(tplTokenPattern).join("\\s+")}([^A-Za-z]|$)`, "i").test(translation);
  return (name) => {
    const alts = String(name).split(/\/|(?:^|\s)vs(?:\s|$)/i).map(tplPhraseRuns);
    if (!alts.some(a => a.length > 0)) return true;  // 纯中文名,无英文词组可查
    return alts.some(a => a.length > 0 && a.every(phraseIn));
  };
}

// ============= 高置信结构检测表 =============
// 译文里出现这些「不会认错」的结构而模型漏报时,确定性注入对应模板点。
// 只注入【模板存在】的结构(App 显示本地 9 语言详解,且名字不会有语言问题)。
const STRUCTURE_DETECTORS = [
  { re: /\bnot only\b[\s\S]{0,80}?\bbut(\s+also)?\b/i,
    tpl: "关联连词(either...or / neither...nor / not only...but also)",
    trig: ["not only", "but also", "not", "only", "but", "also"] },
  { re: /\b(am|is|are|was|were|been|being|get|gets|got|getting)\s+used\s+to\b/i,
    tpl: "used to do vs be used to doing",
    trig: ["used", "to"] },
  { re: /\b(can't|cannot|can not|couldn't|could not)\s+help\b/i,
    tpl: "can't help doing(忍不住)",
    trig: ["help"] },
  { re: /\bso\s+[A-Za-z]+\s+that\b/i,
    tpl: "so + 形容词 + that 从句",
    trig: ["so", "that"] },
  { re: /\btoo\s+[A-Za-z]+\s+(for\s+[A-Za-z]+\s+)?to\s+[A-Za-z]+/i,
    tpl: "too + 形容词 + to do",
    trig: ["too", "to"] },
  { re: /\b(am|is|are|was|were)\s+worth\s+[A-Za-z]+ing\b/i,
    tpl: "it's worth + doing(值得做)",
    trig: ["worth"] },
  { re: /\b([A-Za-z]+er)\s+and\s+\1\b|\bmore\s+and\s+more\b/i,
    tpl: "比较级 and 比较级(越来越)",
    trig: ["and", "more"] },   // 实际命中的比较级词由注入逻辑从匹配结果补充
  { re: /\b(wonder|wondering|wondered|know|knows|ask|asks|asked|sure)\s+(if|whether)\b/i,
    tpl: "whether / if 引导的名词性从句",
    trig: ["if", "whether"] },
].filter(d => TEMPLATE_NAMES.includes(d.tpl));  // 模板不存在的条目静默剔除

// 弱词模板的结构正则:这些模板名里的英文全是超常见词(the/as/so/that),
// 词组校验拦不住误配 —— 必须呈现完整结构形态才放行
const WEAK_TEMPLATE_PATTERNS = {
  "There be 句型": /\bthere\s+(is|are|was|were|will\s+be|has\s+been|have\s+been)\b/i,
  "as ... as(同级比较)": /\bas\s+[A-Za-z]+\s+as\b/i,
  "not as / so ... as(不及)": /\bnot\s+(as|so)\s+[A-Za-z]+\s+as\b/i,
  "so + 形容词 + that 从句": /\bso\s+[A-Za-z]+\s+that\b/i,
  "so as to do(以便)": /\bso\s+as\s+to\b/i,
  "so that + 从句(以便)": /\bso\s+that\b/i,
  "the 比较级 the 比较级": /\bthe\s+(more|less|[A-Za-z]+er)\b[\s\S]*\bthe\s+(more|less|[A-Za-z]+er)\b/i,
  "强调句 It is ... that ...": /\bit\s+(is|was)\b[\s\S]{1,40}?\b(that|who)\b/i,
  "形式主语 It is + adj + to do": /\bit\s+(is|was)\s+[A-Za-z]+\s+to\s+[A-Za-z]+/i,
  "感叹句(What / How)": /(^|[.!?]\s+)(what|how)\b/i,
  "不定式被动 to be done": /\bto\s+be\s+[A-Za-z]+(ed|en|wn|ne|lt|nt|pt|ld)\b/i,
  "选择疑问句(or)": /\bor\b[\s\S]*\?/,
  "最高级 + in / of": /\b(the\s+[A-Za-z]+est|the\s+most\s+[A-Za-z]+)\b[\s\S]*\b(in|of)\b/i,
};

// 快速译文:两段式翻译的第一段 —— 只出译文(无模板清单/无词对齐),
// prompt 极小,1-2 秒返回。App 先显示/朗读它,再等 /translate 的标注。
const fastSchema = {
  type: "object",
  properties: { translation: { type: "string" } },
  required: ["translation"], additionalProperties: false
};
app.post("/translate-fast", async (req, res) => {
  try {
    if (APP_SHARED_SECRET && req.get("X-App-Key") !== APP_SHARED_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY not set" });
    const { sourceText, style = "standard", sourceLanguage = "Simplified Chinese" } = req.body || {};
    if (!sourceText || !String(sourceText).trim()) {
      return res.status(400).json({ error: "empty sourceText" });
    }
    const prompt =
      `Translate this ${sourceLanguage} text into natural English.\n` +
      `STYLE: ${styleDesc(style)}\n\nText:\n${String(sourceText)}`;
    const content = await openAIJSON({
      model: MODEL,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: { name: "fast_translation", strict: true, schema: fastSchema } }
    });
    let parsed;
    try { parsed = JSON.parse(content); } catch { return res.status(502).json({ error: "bad_json" }); }
    res.json(parsed);
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.error, detail: e.detail });
    res.status(500).json({ error: String(e) });
  }
});

// 调 OpenAI 的统一封装:
//   · 55 秒硬超时(App 端 60 秒,留 5 秒余量)—— OpenAI 偶发挂起时快速失败,而不是无限转圈
//   · 网络层错误(连接重置等)立刻重试一次;HTTP 错误码不重试
async function callOpenAI(body) {
  const doFetch = () => fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55_000)
  });
  try {
    return await doFetch();
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") throw e; // 超时不重试,直接报错
    return await doFetch(); // 瞬时网络错误重试一次
  }
}

app.post("/translate", async (req, res) => {
  try {
    if (APP_SHARED_SECRET && req.get("X-App-Key") !== APP_SHARED_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY not set" });
    }
    const { sourceText, style = "standard", sourceLanguage = "Simplified Chinese", givenTranslation = "" } = req.body || {};
    const fixedTranslation = String(givenTranslation || "").trim();
    if (!sourceText || !String(sourceText).trim()) {
      return res.status(400).json({ error: "empty sourceText" });
    }

    const body = {
      model: (req.body && typeof req.body.debugModel === "string" && req.body.debugModel) || MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt(sourceLanguage) },
        { role: "user", content: fixedTranslation
            ? `STYLE: ${styleDesc(style)}\n\nThe English translation is ALREADY FIXED — copy it into the translation field EXACTLY and annotate IT (do not re-translate):\n"${fixedTranslation}"\n\nSource ${sourceLanguage} text:\n${String(sourceText)}`
            : `STYLE: ${styleDesc(style)}\n\nTranslate this ${sourceLanguage} text:\n${String(sourceText)}` }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "translation_result", strict: true, schema }
      }
    };

    let r;
    try {
      r = await callOpenAI(body);
    } catch (e) {
      if (e.name === "TimeoutError" || e.name === "AbortError") {
        return res.status(504).json({ error: "openai_timeout" });
      }
      throw e;
    }

    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: "openai_error", detail: t.slice(0, 300) });
    }
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: "no_content" });

    // 服务端校验:确保每个 sourceSpan 都是原文的真子串。
    // 模型偶尔会:① 大小写/重音不一致 ② 给词根而非源文实际形式 ③ 凭空发明源文里没有的词。
    // 这里逐一修正,保证结果 JSON 永远是合法对齐。
    let parsed;
    try { parsed = JSON.parse(content); } catch { return res.type("application/json").send(content); }
    // 两段式:第一段译文已展示给用户,这里硬覆盖,杜绝两段不一致
    if (fixedTranslation) parsed.translation = fixedTranslation;
    // 日志埋点:fallback 高频统计 → ① console(Railway 原生面板)② Axiom(可聚合 SQL)
    if (Array.isArray(parsed.grammarPoints)) {
      for (const g of parsed.grammarPoints) {
        const tk = (g.templateKey || "").trim();
        if (!tk) {
          const evt = {
            evt: "grammar_fallback",
            fb: g.name || "(unnamed)",
            lang: sourceLanguage,
            srcSample: String(sourceText).slice(0, 60),
            ts: new Date().toISOString()
          };
          console.log(JSON.stringify(evt));
          sendToAxiom(evt);   // 没配 token 时静默跳过
        }
      }
      // 盲区观测:模型一个语法点都没报(连 fallback 名都没有)→ 也要留痕,
      // 否则"越来越冷"这类零识别的结构永远进不了月度扩模板管道
      if (parsed.grammarPoints.length === 0) {
        const evt = {
          evt: "grammar_none",
          lang: sourceLanguage,
          srcSample: String(sourceText).slice(0, 60),
          tlSample: String(parsed.translation || "").slice(0, 80),
          ts: new Date().toISOString()
        };
        console.log(JSON.stringify(evt));
        sendToAxiom(evt);
      }
    }

    // ⓪ 校验:语法点必须真的存在于「本次译文」里(跨语言通用 —— 校验对象是英文译文)。
    //   场景:源文「本当に」让模型配了 "really 句型",但这次(casual)译文用的是 seriously,
    //   结果语法解说里出现句子里根本没有的 really。两条规则:
    //   a) triggerWords 必须逐个出现在译文里(整词匹配),不在的剔除;
    //   b) templateKey 名字里嵌的英文关键词(≥3 个字母,排除占位符)至少要有一个出现在译文里,
    //      否则整条丢弃 —— 宁可少一条语法,也不能展示译文里不存在的语法。
    if (Array.isArray(parsed.grammarPoints) && typeof parsed.translation === "string") {
      const translation = parsed.translation;
      const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const inTranslation = (frag) => {
        const f = String(frag).trim();
        if (!f) return false;
        return new RegExp(`(^|[^A-Za-z])${escapeRe(f)}([^A-Za-z]|$)`, "i").test(translation);
      };
      const templateMatchesTranslation = makeTemplateMatcher(translation);
      parsed.grammarPoints = parsed.grammarPoints.filter(g => {
        if (Array.isArray(g.triggerWords)) {
          g.triggerWords = g.triggerWords.filter(inTranslation);
        }
        const tk = (g.templateKey || "").trim();
        if (!tk) return true;  // 模型自答的 fallback 不在此校验范围
        // 模板名的英文词组必须在译文里连续出现,否则配错丢弃
        if (!templateMatchesTranslation(tk)) return false;
        // 弱词模板(名字全是 the/as/so 等高频词,词组校验形同虚设)→ 结构正则把关
        if (WEAK_TEMPLATE_PATTERNS[tk] && !WEAK_TEMPLATE_PATTERNS[tk].test(translation)) return false;
        // 触发词全军覆没(译文里一个都找不到)→ 同样视为配错
        if (!Array.isArray(g.triggerWords) || g.triggerWords.length === 0) return false;
        return true;
      });
    }

    // ① 整理 grammarPoints(最小引用):
    //   匹配模板 → name = 规范模板名(App 用本地多语言详解,零成本)
    //   没匹配   → name = 模型的简短名(App 点开详解时走 /grammar-detail 按需获取)
    if (Array.isArray(parsed.grammarPoints)) {
      parsed.grammarPoints = parsed.grammarPoints.map(g => {
        const tk = (g.templateKey || "").trim();
        if (tk) {
          const canonical = ALIASES[tk] || tk;
          return { name: canonical, triggerWords: g.triggerWords || [], isTemplate: true };
        }
        return { name: g.name || "未命名", triggerWords: g.triggerWords || [], isTemplate: false };
      });
    }

    // ①.2 比较级兜底(确定性,跨语言 —— 只看英文译文):
    //    比较级是最高频语法之一,模型时常漏报。译文里出现 "X-er/worse/better/more … than"
    //    而语法点里没有任何含 than 的触发词 → 注入「比较级 + than」模板点。
    //    rather/other 等以 er 结尾的非比较词排除。
    if (Array.isArray(parsed.grammarPoints) && typeof parsed.translation === "string") {
      const NOT_COMPARATIVE = new Set(["rather", "other", "either", "neither", "whether", "never", "ever", "over", "under", "after"]);
      const m = parsed.translation.match(/\b([A-Za-z]+er|worse|better|more|less)\s+([A-Za-z]+\s+)?than\b/i);
      const hasThanPoint = parsed.grammarPoints.some(g =>
        (g.triggerWords || []).some(t => String(t).trim().toLowerCase() === "than"));
      if (m && !hasThanPoint && !NOT_COMPARATIVE.has(m[1].toLowerCase())) {
        const trig = [m[1].toLowerCase()];
        if (m[2]) trig.push(m[2].trim().toLowerCase());
        trig.push("than");
        parsed.grammarPoints.push({ name: "比较级 + than", triggerWords: trig, isTemplate: true });
      }
    }

    // ①.3 高置信结构检测(确定性,跨语言 —— 只扫英文译文):
    //    not only.../be used to/can't help/so...that/too...to 这些结构出现在译文里
    //    却没有任何语法点覆盖时,注入对应模板点 —— 不依赖模型这次是否报全。
    if (Array.isArray(parsed.grammarPoints) && typeof parsed.translation === "string") {
      const tl = parsed.translation;
      for (const d of STRUCTURE_DETECTORS) {
        if (!d.re.test(tl)) continue;
        const dup = parsed.grammarPoints.some(g =>
          g.name === d.tpl ||
          (g.triggerWords || []).map(t => String(t).toLowerCase()).some(t => d.trig.includes(t)));
        if (dup) continue;
        // 触发词:静态表 + 正则捕获到的具体词(如 colder and colder 里的 colder)
        const m = d.re.exec(tl);
        const dynamic = m ? m.slice(1).filter(x => typeof x === "string" && /^[A-Za-z]+$/.test(x)) : [];
        const trig = [...new Set([...d.trig, ...dynamic.map(x => x.toLowerCase())])].filter(t =>
          new RegExp(`(^|[^A-Za-z])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z]|$)`, "i").test(tl));
        if (!trig.length) continue;
        parsed.grammarPoints.push({ name: d.tpl, triggerWords: trig, isTemplate: true });
      }
    }

    // ①.4 系动词 + 形容词 检测(用词性判断,正则做不到):
    //    looks delicious / seems tired / sounds great → 「系动词 look + 形容词」模板
    if (Array.isArray(parsed.words) && Array.isArray(parsed.grammarPoints)) {
      const LINKING = new Set(["look","looks","looked","seem","seems","seemed","sound","sounds","sounded",
                               "smell","smells","smelled","taste","tastes","tasted","feel","feels","felt"]);
      const TPL_LINKING = "系动词 look + 形容词";
      if (TEMPLATE_NAMES.includes(TPL_LINKING) &&
          !parsed.grammarPoints.some(g => g.name === TPL_LINKING)) {
        for (let i = 0; i + 1 < parsed.words.length; i++) {
          const a = parsed.words[i], b = parsed.words[i + 1];
          if (a && b && typeof a.english === "string" &&
              LINKING.has(a.english.trim().toLowerCase()) &&
              b.partOfSpeech === "adjective") {
            parsed.grammarPoints.push({
              name: TPL_LINKING,
              triggerWords: [a.english.trim(), b.english.trim()],
              isTemplate: true
            });
            break;
          }
        }
      }
    }

    // ①.5 词块整形(处理英文侧 → 对 9 种源语言一律生效):
    //   a) 「所有格/冠词 + 单个名词」若被合成一个词块,拆开 —— 名词必须可单独收藏
    //      (模型按 prompt 应该已经拆好,这里是兜底;拆出的限定词不染色、无释义)
    //   b) 代词 / be 动词 / 冠词及其缩写,永远 sourceSpan=""(不染色)——
    //      I=我 这种映射用户不需要,颜色留给实词
    if (Array.isArray(parsed.words)) {
      const DET = new Set(["my","your","his","her","its","our","their","a","an","the"]);
      const reshaped = [];
      for (const w of parsed.words) {
        const eng = (w && typeof w.english === "string") ? w.english.trim() : "";
        const m = eng.match(/^(\S+)\s+(\S+)$/);
        if (m && DET.has(m[1].toLowerCase()) && !w.isGrammarStructure) {
          reshaped.push({
            english: m[1],
            partOfSpeech: ["a","an","the"].includes(m[1].toLowerCase()) ? "article" : "pronoun",
            sourceSpan: "",
            definition: "",
            isGrammarStructure: false,
            examples: []
          });
          reshaped.push({ ...w, english: m[2] });
        } else {
          reshaped.push(w);
        }
      }
      parsed.words = reshaped;
      const FUNCTION_WORDS = new Set([
        "i","you","he","she","it","we","they","me","him","her","us","them",
        "my","your","his","its","our","their","mine","yours","hers","ours","theirs",
        "am","is","are","was","were","be","been","being",
        "a","an","the",
        "i'm","you're","he's","she's","it's","we're","they're",
        "'m","'s","'re","isn't","aren't","wasn't","weren't"
      ]);
      for (const w of parsed.words) {
        if (!w || typeof w.english !== "string") continue;
        if (FUNCTION_WORDS.has(w.english.trim().toLowerCase())) {
          w.sourceSpan = "";
        }
      }
    }

    // ② 单一职责(整体重构,删掉旧的 triggerWords≥2 翻 flag 补丁):
    //    · isGrammarStructure 只表示「多词语法块」(might break / worse than 这种合体块),
    //      作用只有一个 —— 不可收藏进单词本。单 token 一律 false:单词永远可收藏。
    //    · 「划不划下划线」由 App 端根据 grammarPoints.triggerWords 推导:
    //      凡出现在语法解说里的触发词(哪怕只有一个,如 might),词块一律划线,
    //      和语法解说严格一致。服务端不再为下划线翻任何 flag。
    if (Array.isArray(parsed.words)) {
      const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (const w of parsed.words) {
        if (!w || typeof w.english !== "string") continue;
        const eng = w.english.trim();
        if (!/\s/.test(eng)) {
          w.isGrammarStructure = false;
        } else if (!w.isGrammarStructure) {
          // 多词单元出现在某个模板名里("as if" ⊂ "as if / as though + 从句")
          // → 它是已知语法块,强制标记;模型这次没标也不影响(②.5 会补详解条目)。
          // "ice cream" 这类词组不在模板名里,保持可收藏。
          const re = new RegExp(`(^|[^A-Za-z])${escRe(eng)}([^A-Za-z]|$)`, "i");
          if (TEMPLATE_NAMES.some(n => re.test(n))) {
            w.isGrammarStructure = true;
          }
        }
      }
    }

    // ②.5 一致性兜底(不变式:词对齐里有下划线的语法块 ⇔ 语法详解里有对应条目):
    //    多词语法块(isGrammarStructure=true)若没有任何语法点覆盖它
    //    (模型漏报 / 校验误杀),服务端补一条:
    //    · 模板名包含该块(如 "as if" ⊂ "as if / as though + 从句")→ 补模板点,App 走本地详解零成本
    //    · 否则 → 补 fallback 点,名字就是块本身,App 点开详解时走 /grammar-detail
    if (Array.isArray(parsed.words) && Array.isArray(parsed.grammarPoints)) {
      const norm = s => String(s).trim().toLowerCase();
      for (const w of parsed.words) {
        if (!w || !w.isGrammarStructure || typeof w.english !== "string") continue;
        const chunk = norm(w.english);
        if (!chunk) continue;
        const chunkTokens = chunk.split(/\s+/);
        const covered = parsed.grammarPoints.some(g => {
          const trigs = (g.triggerWords || []).map(norm);
          if (trigs.includes(chunk)) return true;                       // 整块就是触发词
          return chunkTokens.every(tok => trigs.includes(tok));         // 块内每个词都被触发词覆盖
        });
        if (covered) continue;
        // 用匹配器对【块文本】反查模板:模板的完整词组要能在块文本里找到
        // ("took care of" 经不规则动词表命中 "take care of(照顾)" → 本地详解;
        //  "to be" 不会命中 "to be honest" —— 块里没有 honest)。
        // 同时要求模板词组也匹配整句译文,双保险。
        const chunkCheck = makeTemplateMatcher(w.english.trim());
        const tplCheck = makeTemplateMatcher(String(parsed.translation || ""));
        const tpl = TEMPLATE_NAMES.find(n => {
          const alts = String(n).split(/\/|(?:^|\s)vs(?:\s|$)/i).map(tplPhraseRuns);
          if (!alts.some(a => a.length > 0)) return false;   // 纯中文名不参与反查
          return chunkCheck(n) && tplCheck(n);
        });
        if (tpl) {
          parsed.grammarPoints.push({ name: tpl, triggerWords: [w.english.trim()], isTemplate: true });
        } else {
          parsed.grammarPoints.push({ name: w.english.trim(), triggerWords: [w.english.trim()], isTemplate: false });
        }
      }
    }

    if (Array.isArray(parsed.words)) {
      const src = String(sourceText);
      const fold = s => s.toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "");  // 去重音
      const srcFolded = fold(src);
      let fixCount = 0;
      // F4 兜底:添加的感叹词/招呼语(Hey/Oh/Wow,口语风格常加)不许抢实词的对齐。
      // 源文真有感叹词(嘿/喂/ねえ/야...)才允许对齐。(实测事故:Hey=你)
      const INTERJECTIONS = new Set(["hey","hi","hello","oh","wow","yeah","yep","nah","nope","ah","aha","hmm","huh","gosh","geez","man","dude"]);
      const SRC_INTERJ = ["嘿","喂","哎","唉","哇","呀","喔","哦","欸","诶","ね","ねえ","ねぇ","おい","あの","やあ","おお","わあ","야","어","와","오","이봐","oye","eh","ey","olá","oi","ei","अरे","ओह","này","ơi","ồ","hei","wah","eh"];
      for (const w of parsed.words) {
        if (!w || typeof w.english !== "string" || !w.sourceSpan) continue;
        const eng = w.english.trim().toLowerCase();
        if (!INTERJECTIONS.has(eng)) continue;
        const sp = w.sourceSpan;
        if (!SRC_INTERJ.some(a => sp === a || sp.includes(a))) {
          w.sourceSpan = "";
          fixCount++;
        }
      }

      // F5 兜底:纯标点词块(, . ? !)永远不对齐、不算语法块
      for (const w of parsed.words) {
        if (!w || typeof w.english !== "string") continue;
        if (/^[^A-Za-z0-9]+$/.test(w.english.trim())) {
          if (w.sourceSpan) { w.sourceSpan = ""; fixCount++; }
          w.isGrammarStructure = false;
        }
      }

      // F6 兜底:中文 A不A 疑问式(能不能/会不会/是不是...)→ 对应英文情态/助动词。
      // 模型常把它们漏成灰色;源文有 A不A、译文的对应词没对齐时,确定性补上。
      {
        const ANOTA = [
          [/能不能|可不可以|能否/, ["can", "could"]],
          [/会不会|會不會/, ["will", "would", "might"]],
          [/是不是/, ["is", "are", "right"]],
          [/要不要/, ["want", "do", "shall"]],
          [/行不行|好不好/, ["okay", "ok", "alright"]],
        ];
        for (const [re, engs] of ANOTA) {
          const m = src.match(re);
          if (!m) continue;
          const w = parsed.words.find(x => x && !x.sourceSpan && engs.includes(String(x.english).trim().toLowerCase()));
          if (w) { w.sourceSpan = m[0]; fixCount++; }
        }
      }

      // F6.5 使役助词守卫:让/使/令 只许对齐 let/make/have/get,
      // 冒充实义动词的(keep=让)置空,交给 F7 词典锚定重新补齐
      {
        const CAUSATIVE = new Set(["让", "讓", "使", "令", "叫"]);
        const CAUS_EN = new Set(["let", "make", "made", "have", "get", "makes", "lets"]);
        for (const w of parsed.words) {
          if (!w || typeof w.english !== "string" || !w.sourceSpan) continue;
          if (CAUSATIVE.has(w.sourceSpan.trim()) &&
              !CAUS_EN.has(w.english.trim().toLowerCase())) {
            w.sourceSpan = "";
            fixCount++;
          }
        }
      }

      // F7 词典锚定校正(日/中,零成本):用本地真词典修正模型的对齐
      //   收窄:span 比词典译词宽 → 修剪(rain=雨が降りそう → 雨)
      //   补齐:实词没对齐但其词典译词在源文里独一无二地存在 → 赋值(keep → 保持)
      {
        const isJaSrc = /japanese/i.test(String(sourceLanguage));
        const isZhSrc = /chinese/i.test(String(sourceLanguage));
        const dict = isJaSrc ? DICT_JA : (isZhSrc ? DICT_ZH : null);
        if (dict) {
          const CONTENT = new Set(["noun", "verb", "adjective", "adverb"]);
          // 已认领区域打码,防止把别人 span 内部的子串(图书馆里的 书)再分出去
          let masked = src;
          for (const x of parsed.words) {
            if (x && x.sourceSpan) masked = masked.split(x.sourceSpan).join("▯".repeat(x.sourceSpan.length));
          }
          for (const w of parsed.words) {
            if (!w || typeof w.english !== "string" || !CONTENT.has(w.partOfSpeech)) continue;
            // 词典候选:fullCands = 词典完整词;prefixCands = 日语去尾活用形(仅用于补齐!)
            const fullCands = [];
            const prefixCands = [];
            for (const lemma of lemmaCandidates(w.english)) {
              const hit = dict[lemma];
              if (!hit || !hit.length) continue;
              for (const h of hit) {
                for (const c of (isJaSrc ? [h] : [h[0], h[1]])) {
                  if (!c) continue;
                  fullCands.push(c);
                  if (isJaSrc && c.length > 2) prefixCands.push(c.slice(0, -1));
                }
              }
              break;
            }
            if (!fullCands.length) continue;
            if (w.sourceSpan) {
              // 收窄 —— 三道闸门(v11 事故教训:结果→果、うんこ→うん 全是这里干的):
              //   ① span 本身已是词典完整词 → 一个字都不许动
              //   ② 只许用词典完整词修剪,人造去尾前缀不参与
              //   ③ 修剪后至少比原 span 短 2 字(只砍真正的"过宽",不做同义词替换)
              if (fullCands.includes(w.sourceSpan)) continue;
              const inSpan = fullCands.filter(c =>
                w.sourceSpan.length - c.length >= 2 && w.sourceSpan.includes(c));
              if (inSpan.length) {
                inSpan.sort((a, b) => b.length - a.length);
                w.sourceSpan = inSpan[0];
                fixCount++;
              }
            } else {
              // 补齐(≥2 字防巧合;必须出现在未认领区域;唯一候选才动手;
              //  先试完整词,再试活用前缀)
              for (const pool of [fullCands, prefixCands]) {
                const found = [...new Set(pool.filter(c => c.length >= 2 && masked.includes(c)))];
                if (found.length === 1) {
                  w.sourceSpan = found[0];
                  masked = masked.split(found[0]).join("▯".repeat(found[0].length));
                  fixCount++;
                  break;
                }
                if (found.length > 1) break;  // 有歧义,放弃,不赌
              }
            }
          }
        }
      }

      // F3 兜底:添加的英文强调副词(really/actually...)只许对齐源文「真副词」。
      // span 不在白名单(9 语言)→ 置空,杜绝 really=美味し 这类形容词错配。
      const INTENSIFIERS = new Set(["really","actually","truly","just","simply","definitely","certainly"]);
      const ADV_OK = ["本当に","ほんとうに","ほんとに","本当","実際","実は","マジ",
        "真的","真","确实","確實","其实","其實","的确","的確","實在","实在",
        "정말","정말로","진짜","사실","실제로",
        "realmente","de verdad","en realidad","de hecho","mesmo","de fato",
        "सच में","सचमुच","वाक़ई","असल में",
        "thật","thực sự","thật sự","quả thật",
        "benar-benar","sungguh","memang","sebenarnya"];
      for (const w of parsed.words) {
        if (!w || typeof w.english !== "string" || !w.sourceSpan) continue;
        const eng = w.english.trim().toLowerCase();
        if (!INTENSIFIERS.has(eng)) continue;
        const sp = w.sourceSpan;
        if (!ADV_OK.some(a => sp.includes(a) || a.includes(sp))) {
          w.sourceSpan = "";
          fixCount++;
        }
      }

      // F2 兜底:同一个 span 被多个词块认领、而原文出现次数不够分时 ——
      //   ① 日语 〜そう(看起来):系动词拿「そう」,形容词拿词干(おいしそう → looks=そう + delicious=おいし)
      //   ② 拆不了的:按词性优先级(名词>形容词>动词>副词)保留,其余置空
      {
        const LINKING_EN = new Set(["look","looks","looked","seem","seems","seemed","sound","sounds","appear","appears","feel","feels"]);
        const PRI = { noun: 0, adjective: 1, verb: 2, adverb: 3 };
        const claimMap = new Map();
        parsed.words.forEach((w, i) => {
          if (!w || !w.sourceSpan) return;
          if (!claimMap.has(w.sourceSpan)) claimMap.set(w.sourceSpan, []);
          claimMap.get(w.sourceSpan).push(i);
        });
        for (const [span, idxs] of claimMap) {
          if (idxs.length < 2) continue;
          // 原文出现次数
          let occ = 0, p = 0;
          while ((p = src.indexOf(span, p)) !== -1) { occ++; p += span.length; }
          if (idxs.length <= occ) continue;   // 出现次数够分,客户端各认领一处,无冲突
          // ① そう 拆分
          if (span.endsWith("そう") && span.length > 2) {
            const stem = span.slice(0, -2);
            const li = idxs.find(i => LINKING_EN.has(parsed.words[i].english.trim().toLowerCase()));
            const ai = idxs.find(i => parsed.words[i].partOfSpeech === "adjective");
            if (li != null && ai != null && li !== ai) {
              parsed.words[li].sourceSpan = "そう";
              parsed.words[ai].sourceSpan = stem;
              for (const i of idxs) if (i !== li && i !== ai) parsed.words[i].sourceSpan = "";
              fixCount++;
              continue;
            }
          }
          // ② 词性优先级保留 occ 个
          const sorted = [...idxs].sort((a, b) =>
            (PRI[parsed.words[a].partOfSpeech] ?? 4) - (PRI[parsed.words[b].partOfSpeech] ?? 4));
          sorted.slice(occ).forEach(i => { parsed.words[i].sourceSpan = ""; fixCount++; });
        }
      }

      // 比较结构兜底:模型习惯把比较助词留空(より/보다/比),但 than 的对应是学习者
      // 明确想看的。译文有 than 而模型没对齐时,从源文里把比较标记补上(9 种语言)。
      if (/(^|[^A-Za-z])than([^A-Za-z]|$)/i.test(String(parsed.translation || ""))) {
        const THAN_MARKERS = ["より", "보다", "hơn", "daripada", "से"];
        // 中文的 比 单独处理:排除 比如/比方 这类非比较用法
        const zhCompare = src.includes("比") && !/比如|比方|比萨|比赛/.test(src);
        for (const w of parsed.words) {
          if (!w || typeof w.english !== "string") continue;
          if (w.english.trim().toLowerCase() !== "than" || w.sourceSpan) continue;
          const m = THAN_MARKERS.find(t => src.includes(t));
          if (m) { w.sourceSpan = m; fixCount++; }
          else if (zhCompare) { w.sourceSpan = "比"; fixCount++; }
          break;
        }
      }
      // 只是助词 / 标点 / 空白 的 sourceSpan 全部置空,
      // 避免染色染到"看起来跟英文词无关"的字符上(例:It's 染到 「は」)。
      // 同时凡是 sourceSpan 跟 english 一模一样(看似抄回去)→ 多半是模型偷懒,也置空。
      // 跨语言纯标点(CJK 全角 + 拉丁 + 西语 ¿¡ + 印地语 dānḍa ।॥ + 越南语带音号常见标点)
      const PARTICLE_ONLY = /^[\s。、，,.\?\!？！¿¡…・·~〜「」『』""''()()\[\]【】《》\-—–:;:;।॥]*$/;
      // 覆盖 9 种语言:zh_Hans / zh_Hant / ja / ko / es / pt-BR / hi / vi / id
      // 原则:只清「纯语法标记」(主格/宾格/语气);有英文对应词、学习者想看的助词
      // (より=than、から=from、まで=until、へ/に=to、と=with/and、부터=from、में=in、पर=on)
      // 【不在】黑名单里,模型对齐了就保留。
      const JP_PARTICLES = new Set(["は","が","を","の","や","ね","よ","か","な","ば","ぞ","ぜ","さ","わ"]);
      const ZH_PARTICLES = new Set(["的","了","吗","嗎","呢","吧","啊","哦","哈","嘛","呐","哟","喔","么","麼"]);
      const KO_PARTICLES = new Set(["은","는","이","가","을","를","의","도","만","로","으로","라고","라는"]);
      // Hindi:只清纯语法标记(作格 ने、强调 ही/भी/तो);में(in)/पर(on)/से(from)/तक(until)/को(to) 可对齐
      const HI_PARTICLES = new Set(["ने","ही","भी","तो","ना","वाला","वाली","वाले"]);
      // 越南语句末小品词 / 部分单独出现的分类词
      const VI_PARTICLES = new Set(["à","ạ","nhé","nhỉ","đi","thôi","mà","ấy","này","đó","ơi","ư","hả","hử"]);
      // 印尼语黏附小品词
      const ID_PARTICLES = new Set(["lah","kah","tah","sih","dong","kok","deh","nih","tuh","-lah","-kah","-tah"]);
      // 西/葡 短功能小词,只在很短(≤3 字)且明显是填充时剔除,避免误伤真冠词
      const ES_PT_FILLER = new Set(["que","se","lo","la","los","las","o","a","os","as"]);
      const isParticleOnly = (sp) => {
        const t = sp.trim();
        if (t === "") return true;
        if (PARTICLE_ONLY.test(t)) return true;
        if (JP_PARTICLES.has(t)) return true;
        if (ZH_PARTICLES.has(t)) return true;
        if (KO_PARTICLES.has(t)) return true;
        if (HI_PARTICLES.has(t)) return true;
        if (VI_PARTICLES.has(t)) return true;
        if (ID_PARTICLES.has(t)) return true;
        if (ES_PT_FILLER.has(t.toLowerCase()) && t.length <= 3) return true;
        return false;
      };
      // 注意:这里【不做】头尾助词修剪。曾按字符剪头尾助词("のうんこ"→"うんこ"),
      // 但 CJK 里助词同形字常常是词的一部分(このこと、本当に、こんにちは、いつも、のみもの),
      // 按字符剪必然误伤真词(このこと 被剪成 このこ)。宁可色块偶尔多盖一个助词,
      // 也不能把词剪坏 —— 最小 span 交给 prompt 规则 F 约束模型。
      for (const w of parsed.words) {
        if (!w || typeof w.sourceSpan !== "string" || w.sourceSpan === "") continue;
        if (isParticleOnly(w.sourceSpan)) {
          w.sourceSpan = "";
          fixCount++;
          continue;
        }
        const span = w.sourceSpan;
        if (src.includes(span)) continue;   // ✓ 已经是真子串
        // 尝试同形不同 case / 去重音匹配,取回源文里实际出现的形式
        const sf = fold(span);
        const idx = srcFolded.indexOf(sf);
        if (idx >= 0 && sf.length > 0) {
          // 取出源文里对应位置的真实子串
          // 由于 fold 可能改长度(去重音不改长度,小写也不改),通常可直接 slice
          if (srcFolded.length === src.length) {
            w.sourceSpan = src.slice(idx, idx + span.length);
            fixCount++;
            continue;
          }
        }
        // 实在不行 → 置空
        w.sourceSpan = "";
        fixCount++;
      }
      if (fixCount > 0 && process.env.LOG_FIXUPS) console.log(`fixed ${fixCount} spans`);
    }
    // 兼容字段:words[].examples / definition 不再由模型生成(按需走 /word-example、/word-definition),
    // 但已安装的旧版 App 解码时要求字段存在 → 统一补空
    if (Array.isArray(parsed.words)) {
      for (const w of parsed.words) {
        if (!w) continue;
        if (!Array.isArray(w.examples)) w.examples = [];
        if (typeof w.definition !== "string") w.definition = "";
      }
    }
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ============= 月度缓存(例句 / 语法详解) =============
// 同一个词/语法名,所有用户共享同一份内容 —— 只在第一次被点开时生成一次。
// 每月 1 号(UTC 月份切换时)整体清空,下次点开重新生成 → 既省 token 又不会永远一成不变。
// 注:内存缓存,Railway 重启/重新部署也会清空,效果等同提前刷新,无碍。
const monthKey = () => { const d = new Date(); return `${d.getUTCFullYear()}-${d.getUTCMonth()}`; };
let cacheMonth = monthKey();
const exampleCache = new Map();  // "lang|english|sense" → {en, cn}
const grammarCache = new Map();  // "lang|grammarName" → {meaning, structure, examples}
const defCache     = new Map();  // "lang|english|pos" → {definition}(词典式对译)
const sentCache    = new Map();  // "lang|sentence" → {translation}(练习题整句翻译,句意不变 → 永久缓存)
const CACHE_MAX = 30000;
// ===== 缓存持久化(P1):重启不再清零 =====
// 默认写 /tmp(容器内重启可恢复);在 Railway 挂 Volume 后设 CACHE_DIR=/data 可跨部署持久。
const CACHE_DIR = process.env.CACHE_DIR || "/tmp";
const CACHE_FILE = join(CACHE_DIR, "howtosay-cache.json");
function loadCaches() {
  try {
    const d = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
    for (const [k, v] of d.def  || []) defCache.set(k, v);     // 词典:永久,无条件回载
    for (const [k, v] of d.sent || []) sentCache.set(k, v);    // 整句翻译:永久
    if (d.month === monthKey()) {                              // 例句/语法详解:同月才回载
      for (const [k, v] of d.example || []) exampleCache.set(k, v);
      for (const [k, v] of d.grammar || []) grammarCache.set(k, v);
    }
    console.log(`cache loaded: def=${defCache.size} sent=${sentCache.size} ex=${exampleCache.size} gr=${grammarCache.size}`);
  } catch { /* 首次启动无文件,正常 */ }
}
function saveCaches() {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify({
      month: monthKey(),
      def: [...defCache], sent: [...sentCache],
      example: [...exampleCache], grammar: [...grammarCache],
    }));
  } catch { /* 磁盘异常不影响主流程 */ }
}
setInterval(saveCaches, 5 * 60 * 1000).unref();   // 每 5 分钟落盘
process.on("SIGTERM", () => { saveCaches(); process.exit(0); });
function cacheSweep() {
  if (cacheMonth !== monthKey()) {
    // 例句/语法详解按月换新(保持新鲜感);
    // 词典释义【不清】—— 词典是固定的,一个词就那一两个意思,没有"过期"一说。
    // (进程重启时内存缓存自然清空,首个查询会用 DICT_MODEL 重新生成一次,代价极小)
    exampleCache.clear();
    grammarCache.clear();
    cacheMonth = monthKey();
  }
}
// ===== 本地真词典(P2:日/中混合模式) =====
// 数据:JMdict(EDRDG)+ CC-CEDICT(MDBG),均为 CC BY-SA 授权,需在 App 致谢页注明。
// 查得到 → 零 token、零延迟、零编造;查不到(俚语/新词/未收录)→ 走 DICT_MODEL 兜底。
import { gunzipSync } from "zlib";
let DICT_JA = null, DICT_ZH = null;
function loadDicts() {
  try {
    DICT_JA = JSON.parse(gunzipSync(readFileSync(join(__dirname, "data/dict_en_ja.json.gz"))));
    DICT_ZH = JSON.parse(gunzipSync(readFileSync(join(__dirname, "data/dict_en_zh.json.gz"))));
    console.log(`dicts loaded: ja=${Object.keys(DICT_JA).length} zh=${Object.keys(DICT_ZH).length}`);
  } catch (e) { console.log("dict load skipped:", String(e).slice(0, 80)); }
}
// 不规则动词 形→原形 反查表(由 IRREGULAR_FORMS 反转)
const FORM_TO_BASE = {};
for (const [base, forms] of Object.entries(IRREGULAR_FORMS)) {
  for (const f of forms) FORM_TO_BASE[f] = base;
}
// 英文词形还原:生成候选原形(exact → 不规则 → 规则后缀)
function lemmaCandidates(raw) {
  const w = raw.toLowerCase().trim();
  const out = [w];
  const push = (x) => { if (x && !out.includes(x)) out.push(x); };
  if (FORM_TO_BASE[w]) push(FORM_TO_BASE[w]);
  if (w.endsWith("ies") && w.length > 4) push(w.slice(0, -3) + "y");
  if (w.endsWith("es") && w.length > 3) push(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 2) push(w.slice(0, -1));
  if (w.endsWith("ing") && w.length > 5) {
    const st = w.slice(0, -3);
    push(st); push(st + "e");
    if (st.length > 2 && st[st.length - 1] === st[st.length - 2]) push(st.slice(0, -1));
  }
  if (w.endsWith("ed") && w.length > 4) {
    const st = w.slice(0, -2);
    push(st); push(w.slice(0, -1));
    if (st.length > 2 && st[st.length - 1] === st[st.length - 2]) push(st.slice(0, -1));
  }
  // 词组:还原首词(gave up→give up)和尾词(sea urchins→sea urchin)
  const parts = w.split(/\s+/);
  if (parts.length > 1) {
    for (const first of lemmaCandidates(parts[0])) push([first, ...parts.slice(1)].join(" "));
    for (const last of lemmaCandidates(parts[parts.length - 1])) push([...parts.slice(0, -1), last].join(" "));
  }
  return out;
}
// 词典查询:命中返回释义字符串,未命中返回 null
function dictLookup(english, sourceLanguage) {
  const isJa = /japanese/i.test(sourceLanguage);
  const isZhHans = /simplified/i.test(sourceLanguage);
  const isZhHant = /traditional/i.test(sourceLanguage);
  if (!isJa && !isZhHans && !isZhHant) return null;
  const dict = isJa ? DICT_JA : DICT_ZH;
  if (!dict) return null;
  for (const cand of lemmaCandidates(english)) {
    const hit = dict[cand];
    if (!hit || !hit.length) continue;
    if (isJa) return hit.slice(0, 2).join("、");
    return hit.slice(0, 2).map(pair => isZhHant ? pair[1] : pair[0]).join("、");
  }
  return null;
}

function cachePut(map, key, val) {
  if (map.size >= CACHE_MAX) map.clear();  // 简单上限保护,防内存膨胀
  map.set(key, val);
}

// 调 OpenAI 并取回 content(JSON 字符串),错误时抛带 status 的对象
async function openAIJSON(body) {
  let r;
  try {
    r = await callOpenAI(body);
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      throw { status: 504, error: "openai_timeout" };
    }
    throw e;
  }
  if (!r.ok) {
    const t = await r.text();
    throw { status: 502, error: "openai_error", detail: t.slice(0, 300) };
  }
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw { status: 502, error: "no_content" };
  return content;
}

// 按需例句:用户点开词详情时才生成;同词同语言全用户共享缓存,按月刷新。
// body: { english, definition?, sourceLanguage }   返回: { en, cn }
// (不再按 context 定制 —— 缓存的例句对所有人通用)
const wordExampleSchema = {
  type: "object",
  properties: { en: { type: "string" }, cn: { type: "string" } },
  required: ["en", "cn"], additionalProperties: false
};
app.post("/word-example", async (req, res) => {
  try {
    if (APP_SHARED_SECRET && req.get("X-App-Key") !== APP_SHARED_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY not set" });
    }
    const { english, definition = "", sourceLanguage = "Simplified Chinese" } = req.body || {};
    if (!english || !String(english).trim()) {
      return res.status(400).json({ error: "empty english" });
    }
    const lang = String(sourceLanguage);
    cacheSweep();
    // 缓存键带上释义(义项):同一个英文词在不同句子里意思可能不同
    // (break=壊れる vs break=休憩),按 (语言, 词, 义项) 分开缓存,
    // 避免第一个用户的义项例句被另一个义项的用户看到。
    const sense = String(definition).trim().toLowerCase();
    const key = `${lang}|${String(english).trim().toLowerCase()}|${sense}`;
    const hit = exampleCache.get(key);
    if (hit) return res.json(hit);

    const prompt =
      `You write ONE example sentence for an English-learning app. The learner speaks ${lang}.\n` +
      `Target word/phrase: "${String(english)}"` +
      (definition ? ` — in the SPECIFIC sense of ${lang} "${String(definition)}"` : "") + `\n` +
      (definition ? `The example MUST use the word in exactly this sense; many English words have multiple ` +
        `senses (e.g. "break" = shatter vs. take a rest) and using a different sense than the one given ` +
        `is a hard failure.\n` : "") +
      `Return:\n` +
      `- en: one natural English sentence (8-14 words) that uses "${String(english)}" exactly as given.\n` +
      `- cn: its ${lang} translation. The translation MUST contain the ${lang} rendering of "${String(english)}" ` +
      `in that same sense — never paraphrase the key word away. Write cn ONLY in ${lang}.`;
    const content = await openAIJSON({
      model: MODEL,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "word_example", strict: true, schema: wordExampleSchema }
      }
    });
    let parsed;
    try { parsed = JSON.parse(content); } catch { return res.status(502).json({ error: "bad_json" }); }
    cachePut(exampleCache, key, parsed);
    res.json(parsed);
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.error, detail: e.detail });
    res.status(500).json({ error: String(e) });
  }
});

// 按需语法详解:只有 fallback 语法点(本地无模板)才会调到这里。
// 模板命中的语法点 App 直接用本地多语言内容,完全不发请求。
// body: { name, sourceLanguage }   返回: { meaning, structure, examples: [{en,cn}×2] }
// 同名同语言全用户共享缓存,按月刷新。
const grammarDetailSchema = {
  type: "object",
  properties: {
    meaning:   { type: "string" },
    structure: { type: "string" },
    examples:  { type: "array", items: wordExampleSchema, minItems: 2, maxItems: 2 }
  },
  required: ["meaning", "structure", "examples"],
  additionalProperties: false
};
// 词典式释义:像标准 英-X 词典一样给对译词,不是模型自由发挥的描述。
// body: { english, partOfSpeech?, sourceLanguage }   返回: { definition }
// 同词同语言全用户共享缓存,按月刷新。
const wordDefinitionSchema = {
  type: "object",
  properties: { definition: { type: "string" } },
  required: ["definition"],
  additionalProperties: false
};
app.post("/word-definition", async (req, res) => {
  try {
    if (APP_SHARED_SECRET && req.get("X-App-Key") !== APP_SHARED_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY not set" });
    }
    const { english, partOfSpeech = "", sourceLanguage = "Simplified Chinese" } = req.body || {};
    if (!english || !String(english).trim()) {
      return res.status(400).json({ error: "empty english" });
    }
    const lang = String(sourceLanguage);
    cacheSweep();
    const key = `${lang}|${String(english).trim().toLowerCase()}|${String(partOfSpeech)}`;
    const hit = defCache.get(key);
    if (hit) return res.json(hit);

    // 先查本地真词典(日/中):零编造、零 token、零延迟
    const dictDef = dictLookup(String(english), lang);
    if (dictDef) {
      const out = { definition: dictDef };
      cachePut(defCache, key, out);
      return res.json(out);
    }

    const prompt =
      `You are a standard English–${lang} dictionary. Give the dictionary gloss of the English ` +
      (partOfSpeech ? `${partOfSpeech} ` : "") + `"${String(english)}" in ${lang}.\n` +
      `Rules:\n` +
      `- definition: ONLY the ${lang} equivalent word(s), exactly as a printed EN–${lang} dictionary entry ` +
      `would gloss it. A TRANSLATION, not an explanation or description.\n` +
      `- NO sentences, NO "a creature that...", NO "Xのこと/Xという生物/X的意思/que significa X", ` +
      `NO trailing punctuation.\n` +
      `- If the word has several common senses, give the 1-3 most common glosses separated by "、" ` +
      `(for CJK) or ", " (for other scripts).\n` +
      `Examples: "sea urchin" → "ウニ" (Japanese); "farts" → "おなら"; "break" → "壊す、休憩"; ` +
      `"travel" → "旅行する、移動する".`;
    const content = await openAIJSON({
      model: DICT_MODEL,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "word_definition", strict: true, schema: wordDefinitionSchema }
      }
    });
    let parsed;
    try { parsed = JSON.parse(content); } catch { return res.status(502).json({ error: "bad_json" }); }
    cachePut(defCache, key, parsed);
    res.json(parsed);
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.error, detail: e.detail });
    res.status(500).json({ error: String(e) });
  }
});

// 练习题整句翻译:语法练习答题后,把完整正确句翻成用户母语。
// body: { sentence, sourceLanguage }   返回: { translation }
// 句子的意思是固定的 → 永久缓存(同 defCache,不按月清),同句全用户共享。
const sentenceTranslationSchema = {
  type: "object",
  properties: { translation: { type: "string" } },
  required: ["translation"],
  additionalProperties: false
};
app.post("/sentence-translation", async (req, res) => {
  try {
    if (APP_SHARED_SECRET && req.get("X-App-Key") !== APP_SHARED_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY not set" });
    }
    const { sentence, sourceLanguage = "Simplified Chinese" } = req.body || {};
    if (!sentence || !String(sentence).trim()) {
      return res.status(400).json({ error: "empty sentence" });
    }
    const lang = String(sourceLanguage);
    cacheSweep();
    const key = `${lang}|${String(sentence).trim()}`;
    const hit = sentCache.get(key);
    if (hit) return res.json(hit);

    const prompt =
      `Translate this simple English sentence into natural ${lang} for a language learner.\n` +
      `Sentence: "${String(sentence).trim()}"\n` +
      `Return only the ${lang} translation — natural, plain, no notes, no romanization.`;
    const content = await openAIJSON({
      model: MODEL,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "sentence_translation", strict: true, schema: sentenceTranslationSchema }
      }
    });
    let parsed;
    try { parsed = JSON.parse(content); } catch { return res.status(502).json({ error: "bad_json" }); }
    cachePut(sentCache, key, parsed);
    res.json(parsed);
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.error, detail: e.detail });
    res.status(500).json({ error: String(e) });
  }
});

app.post("/grammar-detail", async (req, res) => {
  try {
    if (APP_SHARED_SECRET && req.get("X-App-Key") !== APP_SHARED_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY not set" });
    }
    const { name, sourceLanguage = "Simplified Chinese" } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "empty name" });
    }
    const lang = String(sourceLanguage);
    cacheSweep();
    const key = `${lang}|${String(name).trim()}`;
    const hit = grammarCache.get(key);
    if (hit) return res.json(hit);

    const prompt =
      `You explain ONE English grammar point for a learner who speaks ${lang}.\n` +
      `Grammar point: "${String(name)}"\n` +
      `Return (everything except the en examples written IN ${lang}):\n` +
      `- meaning: 1-2 sentence explanation of what this structure expresses and when to use it.\n` +
      `- structure: a one-line pattern with English keywords and ${lang} placeholders ` +
      `(e.g. "prefer + A + to + B").\n` +
      `- examples: exactly 2 pairs — en = a natural English sentence using the structure, ` +
      `cn = its ${lang} translation. The structure's keywords must literally appear in each en sentence.`;
    const content = await openAIJSON({
      model: MODEL,
      temperature: 0.5,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "grammar_detail", strict: true, schema: grammarDetailSchema }
      }
    });
    let parsed;
    try { parsed = JSON.parse(content); } catch { return res.status(502).json({ error: "bad_json" }); }
    cachePut(grammarCache, key, parsed);
    res.json(parsed);
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.error, detail: e.detail });
    res.status(500).json({ error: String(e) });
  }
});

loadCaches();
loadDicts();
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`How to Say proxy listening on ${port}`));
