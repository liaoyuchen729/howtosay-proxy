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
    `  • sourceSpan: the EXACT contiguous substring of the user's input that this English unit corresponds to ` +
    `by MEANING (not by position). For example, if the user wrote "うにはすきじゃない" and the English unit is ` +
    `"sea urchin", sourceSpan MUST be "うに" — never another word at the same position. ` +
    `For Japanese particles like は/が/を/に, Chinese 的/了/吗, etc. that have NO English counterpart, the unit ` +
    `should NOT appear in the words list at all (just skip them in alignment). ` +
    `If the source DOES contain a word for this English unit, you MUST map to it — e.g. Chinese "我"→"I", ` +
    `"不"→"don't"/"not", Spanish "yo"→"I". Only use sourceSpan="" when the source TRULY omits the meaning — ` +
    `e.g. Japanese drops subjects, so a "うにはすきじゃない" → "I" gets sourceSpan="". ` +
    `Also "" for English-only insertions: articles a/an/the without a source word, dummy do/does/did inserted ` +
    `purely for grammar, or "to" in "want to". NEVER reuse an unrelated source word just to fill the field. ` +
    `Source particles with no meaning of their own (Japanese は/が/を/に/で, Chinese 的/了/吗) should NOT be ` +
    `targeted by any English unit — leave them unaligned. ` +
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
