// How to Say —— 翻译代理服务(部署在 Railway)
// App 只连这里;OpenAI key 放在 Railway 的环境变量里,不进代码、不进 App。
//
// 接口:POST /translate
//   body: { "sourceText": "...", "style": "standard|casual|formal|concise", "sourceLanguage": "Japanese" }
//   返回: 直接是 App 需要的结果 JSON(translation / words / grammarPoints)

import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;                 // ← 在 Railway 里设置
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";          // 可在 Railway 改型号
const APP_SHARED_SECRET = process.env.APP_SHARED_SECRET || "";    // 可选:防止别人乱用你的接口

const POS = ["noun","verb","adjective","adverb","pronoun","preposition","conjunction",
  "article","auxiliary","interjection","contraction","infinitive","particle","number","unknown"];

function styleDesc(style) {
  switch (style) {
    case "casual":  return "casual / colloquial spoken";
    case "formal":  return "formal and polite";
    case "concise": return "concise and brief";
    default:        return "standard, natural";
  }
}

function systemPrompt(lang, style) {
  return `You are the translation + linguistic-annotation engine for an English-learning app called "How to Say". ` +
    `The user writes in ${lang}; translate it into natural English and annotate it for a ${lang}-speaking learner. ` +
    `Return ONLY JSON matching the schema.\n\n` +
    `Rules:\n` +
    `- translation: a natural English translation of the input, in a ${styleDesc(style)} style.\n` +
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
    `- grammarPoints: the key grammar structures in the sentence; name = a short grammar-point name, ` +
    `triggerWords = the English fragments that trigger it.\n\n` +
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
const grammarSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    triggerWords: { type: "array", items: { type: "string" } }
  },
  required: ["name","triggerWords"], additionalProperties: false
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
        { role: "system", content: systemPrompt(sourceLanguage, style) },
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

    // content 已经是 App 需要的结果 JSON,直接原样返回
    res.type("application/json").send(content);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`How to Say proxy listening on ${port}`));
