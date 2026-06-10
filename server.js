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
    `    E. Source particles with no semantic load (Japanese は/が/を/に/で/と/も/から/まで/ね/よ, Chinese ` +
    `的/了/吗/呢/吧, Korean 은/는/이/가/을/를/에/에서) MUST NEVER appear as a sourceSpan. Leave them unaligned.\n` +
    `    F. Keep each sourceSpan to the MINIMAL substring carrying that meaning. Do not include neighboring ` +
    `words. For "すきじゃない" → "don't like": "like"="すき", "don't"="じゃない".\n` +
    `    G. Self-check before returning: every non-empty sourceSpan must satisfy ` +
    `(sourceText.includes(sourceSpan) === true). If not, set it to "".\n` +
    `The words array is in the order of the ENGLISH translation (left to right); sourceSpan values may ` +
    `therefore appear in any order across the source text.\n` +
    `  • definition: a short, learner-friendly explanation written IN ${lang}.\n` +
    `  • isGrammarStructure: true for a multi-word grammar pattern, false for an ordinary vocabulary word.\n` +
    `  • examples: exactly one example — en = an English sentence using the unit, cn = its ${lang} translation.\n` +
    `- grammarPoints: 1-3 key grammar structures actually used in this sentence (not more). For each:\n` +
    `\n` +
    `  STEP 1 — identify what the grammar point actually is for THIS sentence.\n` +
    `\n` +
    `  STEP 2 — try to match it to ONE entry in this list of 164 well-known grammar templates ` +
    `(internal IDs in Simplified Chinese, learner sees a localized version):\n` +
    `${TEMPLATE_NAMES.map(n => `    "${n}"`).join(",\n")}\n` +
    `\n` +
    `  CRITICAL — only pick a templateKey if there is a TRULY EXACT semantic match (95%+ overlap). ` +
    `If your grammar point is e.g. "prefer X to Y", "would rather", "had better", "so ... that", ` +
    `"too ... to", "the more ... the more", "way + comparative", "have something done", or any other ` +
    `fixed expression / collocation NOT in the list, set templateKey = "" and DO NOT pick a vaguely ` +
    `similar entry. Picking a wrong template is WORSE than picking none. ` +
    `Surface similarity (e.g. "比起意面我更喜欢寿司" looks comparative) is NOT enough — match by EXACT ` +
    `grammar structure, not by surface vibes.\n` +
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
    if (Array.isArray(parsed.words) && Array.isArray(parsed.grammarPoints)) {
      const triggerSet = new Set();
      for (const g of parsed.grammarPoints) {
        for (const t of (g.triggerWords || [])) {
          triggerSet.add(String(t).trim().toLowerCase());
        }
      }
      for (const w of parsed.words) {
        if (!w || typeof w.english !== "string") continue;
        const e = w.english.trim().toLowerCase();
        if (triggerSet.has(e)) {
          w.isGrammarStructure = true;
        }
      }
    }
    if (Array.isArray(parsed.words)) {
      const src = String(sourceText);
      const fold = s => s.toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "");  // 去重音
      const srcFolded = fold(src);
      let fixCount = 0;
      for (const w of parsed.words) {
        if (!w || typeof w.sourceSpan !== "string" || w.sourceSpan === "") continue;
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
