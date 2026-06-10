// How to Say —— 翻译代理服务(部署在 Railway)
// App 只连这里;OpenAI key 放在 Railway 的环境变量里,不进代码、不进 App。
//
// 接口:POST /translate
//   body: { "sourceText": "...", "style": "standard|casual|formal|concise", "sourceLanguage": "Japanese" }
//   返回: 直接是 App 需要的结果 JSON(translation / words / grammarPoints)

import express from "express";
import { readFileSync } from "fs";
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
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";          // 可在 Railway 改型号
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

function systemPrompt(lang, style, text = "") {
  return `You are the translation + linguistic-annotation engine for an English-learning app called "How to Say". ` +
    `The user writes in ${lang}; translate it into natural English and annotate it for a ${lang}-speaking learner. ` +
    `Return ONLY JSON matching the schema.\n\n` +
    `Rules:\n` +
    `- translation: an English translation of the input, written in the following style: ${styleDesc(style)}\n` +
    `  Pick wording that is DISTINCTLY different from the other three styles; if the only difference would be ` +
    `a contraction, push further (different vocabulary, different sentence shape).\n` +
    `- words: split the English translation into meaningful units IN ORDER (single words, or multi-word chunks ` +
    `such as phrasal verbs or grammar structures like "wouldn't have done"). Together the units must cover the ` +
    `whole translation. For each unit:\n` +
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
    `    D. If the source DOES contain the word, you MUST map to it — Chinese "我"→"I", "不"→"don't"/"not", ` +
    `Spanish "yo"→"I" (or "" if the pronoun is dropped). Do not output "" when a real source word exists.\n` +
    `    E. Source particles / postpositions / discourse markers with no standalone semantic load MUST NEVER ` +
    `appear as a sourceSpan. Leave them unaligned (sourceSpan=""). Lists by language:\n` +
    `       - Japanese: は が を に へ で と も から まで の や ね よ か な ば ぞ ぜ さ わ\n` +
    `       - Chinese (Hans/Hant): 的 了 吗 嗎 呢 吧 啊 哦 哈 嘛 呐 哟 喔\n` +
    `       - Korean: 은 는 이 가 을 를 에 에서 의 와 과 도 만 로 으로 부터 까지 라고 라는\n` +
    `       - Hindi (postpositions): ने को से में पर का की के तक से लिए वाला वाली\n` +
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
    `    G. Self-check before returning: every non-empty sourceSpan must satisfy ` +
    `(sourceText.includes(sourceSpan) === true). If not, set it to "".\n` +
    `The words array is in the order of the ENGLISH translation (left to right); sourceSpan values may ` +
    `therefore appear in any order across the source text.\n` +
    `  • definition: the equivalent ${lang} word or expression. KEEP IT AS SHORT AS POSSIBLE — ideally just ` +
    `the word itself. This rule applies UNIFORMLY to ALL target languages (Simplified Chinese, Traditional ` +
    `Chinese, Japanese, Korean, Spanish, Portuguese-BR, Hindi, Vietnamese, Indonesian).\n` +
    `    Strictly FORBIDDEN — meta-phrasings that wrap the meaning instead of stating it:\n` +
    `      • Japanese:     "Xのこと" / "Xという意味" / "Xを意味する" / "Xという動物" / "Xに住むY"\n` +
    `      • Chinese (Hans/Hant):  "X的意思" / "X的事情" / "意为X" / "指的是X" / "意思是X"\n` +
    `      • Korean:       "X라는 뜻" / "X를 의미함" / "X이라는 것"\n` +
    `      • Spanish:      "que significa X" / "se refiere a X" / "es una X que ..."\n` +
    `      • Portuguese:   "que significa X" / "refere-se a X" / "é um X que ..."\n` +
    `      • Hindi:        "X का अर्थ है" / "X का मतलब" / "X होने का अर्थ"\n` +
    `      • Vietnamese:   "có nghĩa là X" / "nghĩa là X" / "ám chỉ X"\n` +
    `      • Indonesian:   "yang berarti X" / "artinya X" / "mengacu pada X"\n` +
    `    Also FORBIDDEN in every language: redundant descriptive padding (e.g. "sea urchin that lives in the ` +
    `sea", "an animal called dog", "el animal llamado perro").\n` +
    `    Just write the BARE equivalent. Examples across languages — all describe English "farts":\n` +
    `      ja: "おなら"   (NOT "おならのこと")\n` +
    `      zh: "屁"       (NOT "屁的意思" / "屁这个东西")\n` +
    `      ko: "방귀"     (NOT "방귀라는 뜻")\n` +
    `      es: "pedos"    (NOT "los pedos que uno suelta")\n` +
    `      pt: "peidos"   (NOT "os peidos que se soltam")\n` +
    `      hi: "पाद"      (NOT "पाद का अर्थ है")\n` +
    `      vi: "rắm"      (NOT "có nghĩa là rắm")\n` +
    `      id: "kentut"   (NOT "yang berarti kentut")\n` +
    `    Length cap: at most ONE short clause. CJK ≤ ~8 chars, Korean ≤ ~10 chars, Latin/Devanagari ≤ ~6 words, ` +
    `Vietnamese/Indonesian ≤ ~6 words. Going longer means you are over-explaining.\n` +
    `  • isGrammarStructure: true ONLY when this unit is itself a MULTI-WORD grammar pattern such as ` +
    `"had better", "wouldn't have done", "be supposed to", "prefer X to Y", "to go" (the infinitive marker). ` +
    `For ordinary single-word vocabulary — common nouns, verbs, adjectives, adverbs, including inflected forms ` +
    `like "stinks", "farts", "ran", "beautifully", "happier" — isGrammarStructure MUST be false. ` +
    `If in doubt, set false. Single content words are never grammar structures.\n` +
    `  • examples: exactly one example — en = an English sentence using the unit, ` +
    `cn = its ${lang} translation. The cn MUST contain a translation of THIS unit's meaning; ` +
    `do NOT paraphrase the sentence in a way that drops the word. This rule applies UNIFORMLY ACROSS ALL ` +
    `target languages. The key word must survive translation.\n` +
    `    Examples — for en = "He always blames his farts on the dog", correct cn in each language:\n` +
    `      ja: "彼はいつもおならを犬のせいにする"   (NOT "彼はいつも犬のせいにする" — おなら 不见了)\n` +
    `      zh: "他总是把自己的屁怪在狗身上"        (NOT "他总是怪狗" — 没了"屁")\n` +
    `      ko: "그는 항상 자기 방귀를 개 탓으로 돌린다"  (NOT "그는 항상 개 탓을 한다")\n` +
    `      es: "Siempre les echa la culpa de sus pedos al perro"  (NOT "Siempre culpa al perro")\n` +
    `      pt: "Ele sempre joga a culpa dos peidos no cachorro"   (NOT "Ele sempre culpa o cachorro")\n` +
    `      hi: "वह हमेशा अपने पाद का दोष कुत्ते पर डालता है"  (NOT "वह हमेशा कुत्ते पर दोष डालता है")\n` +
    `      vi: "Anh ấy luôn đổ lỗi rắm của mình cho con chó"  (NOT "Anh ấy luôn đổ lỗi cho con chó")\n` +
    `      id: "Dia selalu menyalahkan kentutnya pada anjing"  (NOT "Dia selalu menyalahkan anjing")\n` +
    `    If you cannot fit the word naturally, REWRITE en to a sentence where you can — never drop the key word ` +
    `from cn.\n` +
    `- grammarPoints: 1-3 key grammar structures actually used in this sentence (not more). For each:\n` +
    `\n` +
    `  STEP 1 — identify the grammar by inspecting YOUR ENGLISH TRANSLATION, not the user's source.\n` +
    `  Read your translation back. Which fixed structures actually appear in those English words?\n` +
    `  - If your translation contains "prefer X to Y" → match prefer X to Y.\n` +
    `  - If it contains "way more / way better / way too" → match "way + 比较级", NOT prefer.\n` +
    `  - If it contains "had better / 'd better" → match had better.\n` +
    `  - If it contains "end up + V-ing" → match end up doing.\n` +
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
    `\n` +
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
    `  • triggerWords: the English fragments in your translation that trigger this point ` +
    `(e.g. ["prefer", "to"] for "prefer X to Y"; ["way", "more"] for "way more than").\n` +
    `  • contextualExamples: ALWAYS REQUIRED. Provide exactly 2 fresh example sentences that use this ` +
    `grammar point in a context that fits THIS user's topic (here: "${text.slice(0,80)}"). ` +
    `Do NOT recycle generic examples about unrelated topics. en = the English example, cn = its ${lang} translation.\n` +
    `  • If templateKey != "": leave the fallback fields empty (name="", meaning="", structure="", examples=[]).\n` +
    `  • If templateKey == "": fill all four fallback fields IN ${lang}:\n` +
    `    – name: a short grammar-point name (e.g. "prefer X to Y 句型").\n` +
    `    – structure: one-line pattern with English keywords and ${lang} placeholders.\n` +
    `    – meaning: 1-2 sentence explanation.\n` +
    `    – examples: 2 additional generic example pairs.\n\n` +
    `All definitions and example translations (the cn field) MUST be written in ${lang}, never in any other language.`;
}

const exampleSchema = {
  type: "object",
  properties: { en: { type: "string" }, cn: { type: "string" } },
  required: ["en", "cn"], additionalProperties: false
};
const wordSchema = {
  type: "object",
  properties: {
    english: { type: "string" },
    partOfSpeech: { type: "string", enum: POS },
    sourceSpan: { type: "string" },
    definition: { type: "string" },
    isGrammarStructure: { type: "boolean" },
    examples: { type: "array", items: exampleSchema }
  },
  required: ["english","partOfSpeech","sourceSpan","definition","isGrammarStructure","examples"],
  additionalProperties: false
};
// 语法点:能精准匹配本地模板就用,否则模型自己写完整解释
const grammarSchema = {
  type: "object",
  properties: {
    // 模板 ID(来自 164 模板清单);不匹配填 ""
    templateKey: { type: "string", enum: TEMPLATE_ENUM },
    // 必填:本句英文里触发这个语法的片段
    triggerWords: { type: "array", items: { type: "string" } },
    // 必填:针对本句话题(不是模板的死例句)的 2 条新鲜例句
    contextualExamples: {
      type: "array",
      items: exampleSchema,
      minItems: 2, maxItems: 2
    },
    // 当 templateKey=="" 时必须填的完整解释字段
    name: { type: "string" },
    meaning: { type: "string" },
    structure: { type: "string" },
    examples: { type: "array", items: exampleSchema }
  },
  required: ["templateKey","triggerWords","contextualExamples","name","meaning","structure","examples"],
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
app.get("/", (_req, res) => res.send("How to Say proxy: OK"));

app.post("/translate", async (req, res) => {
  try {
    if (APP_SHARED_SECRET && req.get("X-App-Key") !== APP_SHARED_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY not set" });
    }
    const { sourceText, style = "standard", sourceLanguage = "Simplified Chinese" } = req.body || {};
    if (!sourceText || !String(sourceText).trim()) {
      return res.status(400).json({ error: "empty sourceText" });
    }

    const body = {
      model: MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt(sourceLanguage, style, String(sourceText)) },
        { role: "user", content: String(sourceText) }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "translation_result", strict: true, schema }
      }
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    });

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
    }

    // ① 整理 grammarPoints:
    //   匹配模板 → name = 规范模板名(走本地多语言解释)
    //   没匹配   → name = 模型自己的简短名;同时带 meaning/structure/examples
    //   两种情况都保留 contextualExamples(贴合当前译文)
    if (Array.isArray(parsed.grammarPoints)) {
      parsed.grammarPoints = parsed.grammarPoints.map(g => {
        const tk = (g.templateKey || "").trim();
        const ctx = Array.isArray(g.contextualExamples) ? g.contextualExamples : [];
        if (tk) {
          const canonical = ALIASES[tk] || tk;
          return {
            name: canonical,
            triggerWords: g.triggerWords || [],
            contextualExamples: ctx,
          };
        }
        return {
          name: g.name || "未命名",
          triggerWords: g.triggerWords || [],
          contextualExamples: ctx,
          meaning: g.meaning || "",
          structure: g.structure || "",
          examples: g.examples || []
        };
      });
    }

    // ② 服务端兜底:words 里凡是出现在某 grammarPoint.triggerWords 的英文片段,
    //    强制改 isGrammarStructure=true(避免下划线/收藏按钮判断错乱)
    //    —— 但只对「真·多词语法模式」生效:triggerWords.length >= 2(如 ["prefer","to"]、["had","better"])。
    //    单 trigger 的情况(如某模板只标出一个动词)不翻 flag,否则会把普通动词/形容词错标成语法。
    if (Array.isArray(parsed.words) && Array.isArray(parsed.grammarPoints)) {
      const triggerSet = new Set();
      for (const g of parsed.grammarPoints) {
        const tw = Array.isArray(g.triggerWords) ? g.triggerWords : [];
        if (tw.length < 2) continue;  // 单 trigger 不算多词语法
        for (const t of tw) {
          triggerSet.add(String(t).trim().toLowerCase());
        }
      }
      // 同时:对单词单位强制 false(不论模型给的什么)
      // 规则:english 不含空格 + 不是已知的多词缩写 → 视为单词,isGrammarStructure 必为 false
      // 但若它出现在 triggerSet 里(多词语法的一部分),允许翻 true
      for (const w of parsed.words) {
        if (!w || typeof w.english !== "string") continue;
        const e = w.english.trim().toLowerCase();
        if (triggerSet.has(e)) {
          w.isGrammarStructure = true;
          continue;
        }
        // 单 token(无空格)且词性是普通词 → 强制 false
        const isSingleToken = !/\s/.test(e);
        const contentPOS = new Set(["noun","verb","adjective","adverb"]);
        if (isSingleToken && contentPOS.has(w.partOfSpeech)) {
          w.isGrammarStructure = false;
        }
      }
    }
    if (Array.isArray(parsed.words)) {
      const src = String(sourceText);
      const fold = s => s.toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "");  // 去重音
      const srcFolded = fold(src);
      let fixCount = 0;
      // 只是助词 / 标点 / 空白 的 sourceSpan 全部置空,
      // 避免染色染到"看起来跟英文词无关"的字符上(例:It's 染到 「は」)。
      // 同时凡是 sourceSpan 跟 english 一模一样(看似抄回去)→ 多半是模型偷懒,也置空。
      // 跨语言纯标点(CJK 全角 + 拉丁 + 西语 ¿¡ + 印地语 dānḍa ।॥ + 越南语带音号常见标点)
      const PARTICLE_ONLY = /^[\s。、，,.\?\!？！¿¡…・·~〜「」『』""''()()\[\]【】《》\-—–:;:;।॥]*$/;
      // 覆盖 9 种语言:zh_Hans / zh_Hant / ja / ko / es / pt-BR / hi / vi / id
      const JP_PARTICLES = new Set(["は","が","を","に","で","と","も","から","まで","へ","の","や","ね","よ","か","な","ば","ぞ","ぜ","さ","わ"]);
      const ZH_PARTICLES = new Set(["的","了","吗","嗎","呢","吧","啊","哦","哈","嘛","呐","哟","喔","么","麼"]);
      const KO_PARTICLES = new Set(["은","는","이","가","을","를","에","에서","의","와","과","도","만","로","으로","부터","까지","라고","라는","에게","한테"]);
      // Hindi 后置词 —— 单独出现时不该当成对齐
      const HI_PARTICLES = new Set(["ने","को","से","में","पर","का","की","के","तक","लिए","वाला","वाली","वाले","ही","भी","तो","ना"]);
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
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`How to Say proxy listening on ${port}`));
