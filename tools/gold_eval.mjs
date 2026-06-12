// ===== 词对齐黄金标准评测 =====
// 人工标注的正确答案;评分 = 命中数 / 出现在译文里的金标词数。
// 用法: node tools/gold_eval.mjs [--model=gpt-4.1] [--runs=1]
import { readFileSync } from 'fs';
let APP_KEY = process.env.APP_SHARED_SECRET || "";
try { if (!APP_KEY) APP_KEY = readFileSync(new URL('../.app-secret', import.meta.url), 'utf-8').trim(); } catch {}

// 金标格式:keys=该词在译文里可能的拼写;spans=允许的正确对齐(""=必须不对齐)
const G = (keys, spans) => ({ keys: keys.map(k=>k.toLowerCase()), spans });
const GOLD = [
  // —— 中文 12 句 ——
  ["Simplified Chinese","你能不能让它保持这个速度?",[
    G(["keep"],["保持"]), G(["speed"],["速度"]), G(["this"],["这个","这"]),
    G(["can","could"],["能不能","能"]), G(["hey"],[""]) ]],
  ["Simplified Chinese","我昨天在图书馆借了三本书。",[
    G(["borrowed","borrow"],["借","借了"]), G(["books","book"],["书","本书"]),
    G(["library"],["图书馆"]), G(["yesterday"],["昨天"]), G(["three"],["三","三本"]) ]],
  ["Simplified Chinese","他比我高得多。",[
    G(["taller"],["高"]), G(["than"],["比"]), G(["much","way"],["得多","多"]) ]],
  ["Simplified Chinese","我们打算明年去日本旅行。",[
    G(["japan"],["日本"]), G(["travel","trip"],["旅行"]), G(["plan","planning"],["打算"]),
    G(["next"],["明年","明",""]), G(["year"],["明年","年"]) ]],
  ["Simplified Chinese","这个问题太难了,我答不上来。",[
    G(["difficult","hard"],["难","太难"]), G(["question"],["问题"]),
    G(["answer"],["答","回答","答不上来"]) ]],
  ["Simplified Chinese","别忘了带伞,外面在下雨。",[
    G(["umbrella"],["伞"]), G(["raining","rain"],["下雨","雨"]),
    G(["forget"],["忘","忘了"]), G(["bring","take"],["带"]) ]],
  ["Simplified Chinese","她唱歌唱得很好听。",[
    G(["sings","sing","singing"],["唱歌","唱"]), G(["well","beautifully"],["好听","很好听","好"]) ]],
  ["Simplified Chinese","我对这个结果非常满意。",[
    G(["satisfied","happy","pleased"],["满意"]), G(["result","results"],["结果"]), G(["very","really"],["非常"]) ]],
  ["Simplified Chinese","如果你累了就休息一会儿。",[
    G(["tired"],["累","累了"]), G(["rest","break"],["休息","休息一会儿"]), G(["if"],["如果"]) ]],
  ["Simplified Chinese","他的手机比我的新。",[
    G(["phone"],["手机"]), G(["newer"],["新"]), G(["than"],["比"]) ]],
  ["Simplified Chinese","我每天早上七点起床。",[
    G(["morning"],["早上"]), G(["seven"],["七","七点"]), G(["every"],["每天","每"]) ]],
  ["Simplified Chinese","请把窗户关上,有点冷。",[
    G(["window"],["窗户"]), G(["close","shut"],["关","关上"]), G(["cold","chilly"],["冷"]) ]],
  // —— 用户人工标注新增(2026-06-12)——
  ["Simplified Chinese","今天地铁挤死了,我差点没上去。",[
    G(["make it on","on"],["上去"]), G(["subway"],["地铁"]), G(["packed","crowded"],["挤死了","挤"]) ]],
  ["Simplified Chinese","我先睡了,明天还得早起赶飞机。",[
    G(["get up","up"],["起","早起"]), G(["flight","plane"],["飞机"]), G(["early"],["早","早起"]) ]],
  ["Simplified Chinese","只要你肯努力,就一定能成功。",[
    G(["work hard","hard"],["努力"]), G(["succeed"],["成功"]), G(["as long as"],["只要"]) ]],
    // —— 日语 12 句 ——
  ["Japanese","このことは思っていたよりずっと難しい。",[
    G(["than"],["より"]), G(["harder","difficult"],["難しい","難し"]),
    G(["way","much"],["ずっと"]), G(["this"],["このこと","これ"]), G(["thought","expected"],["思っていた","思った"]) ]],
  ["Japanese","犬のうんこは本当に臭い。",[
    G(["dog"],["犬"]), G(["really","seriously"],["本当に"]),
    G(["poop","feces"],["うんこ"]), G(["smelly","stinks","stinky","bad"],["臭い"]) ]],
  ["Japanese","彼は毎朝コーヒーを飲みます。",[
    G(["coffee"],["コーヒー"]), G(["drinks","drink"],["飲みます","飲み","飲む"]),
    G(["morning"],["毎朝","朝"]), G(["every"],["毎朝","毎"]) ]],
  ["Japanese","明日友達と映画を見に行きます。",[
    G(["tomorrow"],["明日"]), G(["movie","film"],["映画"]),
    G(["friend","friends"],["友達"]), G(["see","watch"],["見","見に"]) ]],
  ["Japanese","この本はとても面白かったです。",[
    G(["book"],["本"]), G(["interesting","fun"],["面白かった","面白"]), G(["very","really"],["とても"]) ]],
  ["Japanese","駅まで歩いて十分かかります。",[
    G(["station"],["駅"]), G(["walk","walking","foot"],["歩いて","歩い"]),
    G(["ten"],["十分","十"]), G(["minutes"],["十分","分"]) ]],
  ["Japanese","日本語を勉強するのは楽しいです。",[
    G(["japanese"],["日本語"]), G(["studying","study","learning"],["勉強","勉強する"]), G(["fun","enjoyable"],["楽しい","楽し"]) ]],
  ["Japanese","雨が降りそうだから傘を持って行こう。",[
    G(["rain"],["雨"]), G(["umbrella"],["傘"]), G(["looks","seems"],["そう","降りそう"]) ]],
  ["Japanese","彼女は歌がとても上手です。",[
    G(["singing","singer","sing"],["歌"]), G(["good","great"],["上手"]), G(["very","really"],["とても"]) ]],
  ["Japanese","もっとゆっくり話してください。",[
    G(["slowly"],["ゆっくり"]), G(["speak","talk"],["話して","話し"]), G(["more"],["もっと"]), G(["please"],["ください",""]) ]],
  ["Japanese","お腹が空いたので何か食べたい。",[
    G(["hungry"],["お腹が空いた","空いた"]), G(["eat"],["食べ","食べたい"]) ]],
  ["Japanese","この写真は去年京都で撮りました。",[
    G(["photo","picture"],["写真"]), G(["kyoto"],["京都"]),
    G(["last"],["去年","去",""]), G(["year"],["去年","年"]), G(["took","taken"],["撮り","撮りました"]) ]],
];

const model = process.argv.find(a=>a.startsWith("--model="))?.slice(8);
const runs = parseInt(process.argv.find(a=>a.startsWith("--runs="))?.slice(7) || "1");
const B = "https://howtosay-proxy-production.up.railway.app/translate";

let correct = 0, wrong = 0, skipped = 0;
const wrongList = [];
for (let run = 0; run < runs; run++) {
for (const [lang, srcText, golds] of GOLD) {
  let r;
  try {
    const resp = await fetch(B, { method:"POST",
      headers:{"Content-Type":"application/json", ...(APP_KEY?{"X-App-Key":APP_KEY}:{})},
      body: JSON.stringify({sourceText:srcText, style:"standard", sourceLanguage:lang, ...(model?{debugModel:model}:{})}),
      signal: AbortSignal.timeout(70000)});
    r = await resp.json();
  } catch(e) { console.log("✗ 请求失败:", srcText.slice(0,12), String(e).slice(0,60)); continue; }
  if (!r.words) { console.log("✗ 无words:", srcText.slice(0,12), JSON.stringify(r).slice(0,80)); continue; }
  for (const g of golds) {
    const w = r.words.find(x => g.keys.includes(String(x.english).trim().toLowerCase()));
    if (!w) { skipped++; continue; }   // 译文没用这个词,不计分
    const sp = String(w.sourceSpan || "");
    if (g.spans.includes(sp)) correct++;
    else { wrong++; wrongList.push(`[${srcText.slice(0,10)}…] ${w.english}=「${sp}」 期望:${JSON.stringify(g.spans)}`); }
  }
}
}
const total = correct + wrong;
console.log(`\n===== 对齐黄金标准评测 ${model || "(默认模型)"} =====`);
console.log(`正确 ${correct} / 计分 ${total}  →  正确率 ${(100*correct/total).toFixed(1)}%   (跳过${skipped}个未出现词)`);
console.log("\n错误明细:");
wrongList.forEach(x=>console.log(" ✗", x));
