// 生成人工标注审阅包:100 句过一遍现有系统,输出 Markdown 清单
// 用户只需:错的行 [ ] 改成 [x] 并在行尾写 → 正确答案("" 表示应该灰色)
import { readFileSync, writeFileSync } from 'fs';
let APP_KEY = process.env.APP_SHARED_SECRET || "";
try { if (!APP_KEY) APP_KEY = readFileSync(new URL('../.app-secret', import.meta.url), 'utf-8').trim(); } catch {}

// [语言, 风格, 句子] —— 刻意偏难:口语/结构/惯用语/日常混合
const S = [
// —— 中文·口语(casual 风格,验证添加词)——
["Simplified Chinese","casual","你能不能让它保持这个速度?"],
["Simplified Chinese","casual","这也太离谱了吧,我真是服了。"],
["Simplified Chinese","casual","别磨蹭了,咱们快迟到了!"],
["Simplified Chinese","casual","他这个人就是嘴硬心软。"],
["Simplified Chinese","casual","我今天摸了一天鱼,啥也没干。"],
["Simplified Chinese","casual","这家店的奶茶绝了,你一定要试试。"],
["Simplified Chinese","casual","你别给我画大饼了,我不吃这套。"],
["Simplified Chinese","casual","他考试又挂科了,这次是高数。"],
["Simplified Chinese","casual","周末要不要一起去爬山?"],
["Simplified Chinese","casual","我手机快没电了,长话短说。"],
["Simplified Chinese","casual","这事儿八字还没一撇呢。"],
["Simplified Chinese","casual","你可拉倒吧,他哪有那么好心。"],
["Simplified Chinese","casual","今天地铁挤死了,我差点没上去。"],
["Simplified Chinese","casual","这个价格也太坑人了。"],
["Simplified Chinese","casual","我先睡了,明天还得早起赶飞机。"],
// —— 中文·结构(standard,验证硬语法)——
["Simplified Chinese","standard","我把钥匙忘在出租车上了。"],
["Simplified Chinese","standard","他被老板批评了一顿。"],
["Simplified Chinese","standard","妈妈让我去超市买点酱油。"],
["Simplified Chinese","standard","这道菜做得比上次好吃多了。"],
["Simplified Chinese","standard","你是不是把我的话当耳旁风了?"],
["Simplified Chinese","standard","他跑得连呼吸都困难了。"],
["Simplified Chinese","standard","我们应该把问题想得更全面一些。"],
["Simplified Chinese","standard","只要你肯努力,就一定能成功。"],
["Simplified Chinese","standard","除非下雨,否则我们就去野餐。"],
["Simplified Chinese","standard","他一边开车一边打电话,太危险了。"],
["Simplified Chinese","standard","与其在家里闲着,不如出去走走。"],
["Simplified Chinese","standard","这本书值得反复阅读。"],
["Simplified Chinese","standard","我宁可走路也不想挤公交。"],
["Simplified Chinese","standard","害得我白跑了一趟。"],
["Simplified Chinese","standard","他连最基本的礼貌都不懂。"],
// —— 中文·日常混合 ——
["Simplified Chinese","standard","我对海鲜过敏,不能吃虾。"],
["Simplified Chinese","standard","会议推迟到下周三下午三点。"],
["Simplified Chinese","standard","请问最近的地铁站怎么走?"],
["Simplified Chinese","standard","我女儿明年九月上小学。"],
["Simplified Chinese","standard","这件衣服有没有大一号的?"],
["Simplified Chinese","standard","他每个月工资的一半都用来还房贷。"],
["Simplified Chinese","standard","天气预报说明天有大雨。"],
["Simplified Chinese","standard","我的护照下个月就要过期了。"],
["Simplified Chinese","standard","你最好提前半小时到机场。"],
["Simplified Chinese","standard","这个软件可以免费试用三十天。"],
["Simplified Chinese","casual","我妈做的红烧肉比饭店的香多了。"],
["Simplified Chinese","casual","你猜我今天在街上碰见谁了?"],
["Simplified Chinese","casual","这部剧太上头了,我一口气看了八集。"],
["Simplified Chinese","casual","快递到了,帮我拿一下呗。"],
["Simplified Chinese","casual","他说话总是拐弯抹角的。"],
["Simplified Chinese","standard","养成早睡早起的习惯对身体好。"],
["Simplified Chinese","standard","他假装没看见我,从我身边走过去了。"],
["Simplified Chinese","standard","如果我当时多复习一会儿,就不会考砸了。"],
["Simplified Chinese","standard","越是着急,越容易出错。"],
["Simplified Chinese","standard","他好不容易才找到一份满意的工作。"],
["Simplified Chinese","casual","行了行了,知道了,你别唠叨了。"],
["Simplified Chinese","casual","这事你得抓紧,不然黄了。"],
["Simplified Chinese","standard","公司决定派他去上海出差。"],
["Simplified Chinese","standard","我忘了带伞,结果淋成了落汤鸡。"],
["Simplified Chinese","standard","她对每个客户都很有耐心。"],
["Simplified Chinese","standard","这个问题我们改天再讨论吧。"],
["Simplified Chinese","casual","我减肥失败了,又胖回去了。"],
["Simplified Chinese","standard","按照说明书一步一步来就行。"],
["Simplified Chinese","standard","他的发言赢得了全场的掌声。"],
["Simplified Chinese","standard","无论结果如何,我都不会后悔。"],
// —— 日语·口语 ——
["Japanese","casual","これおいしそうだけど、美味しいのかな?"],
["Japanese","casual","まじでやばい、財布忘れた。"],
["Japanese","casual","今日めっちゃ疲れたから、もう寝るわ。"],
["Japanese","casual","それな、ほんとにそう思う。"],
["Japanese","casual","電車に乗り遅れちゃった。"],
["Japanese","casual","この店、コスパ最高だよ。"],
["Japanese","casual","やっぱり夏は花火だよね。"],
["Japanese","casual","彼、彼女にフラれたらしいよ。"],
["Japanese","casual","お腹ペコペコなんだけど。"],
["Japanese","casual","ちょっと待って、今行くから。"],
// —— 日语·结构 ——
["Japanese","standard","宿題をやらなきゃいけないのに、やる気が出ない。"],
["Japanese","standard","先生に褒められて嬉しかったです。"],
["Japanese","standard","弟にケーキを食べられてしまった。"],
["Japanese","standard","日本に行ったことがありますか?"],
["Japanese","standard","窓を開けたまま寝てしまいました。"],
["Japanese","standard","頑張れば頑張るほど上手になります。"],
["Japanese","standard","雨が降らないうちに帰りましょう。"],
["Japanese","standard","彼は来ないかもしれません。"],
["Japanese","standard","この漢字の読み方を教えてください。"],
["Japanese","standard","会議は三時に始まることになっています。"],
// —— 日语·日常 ——
["Japanese","standard","駅の近くに新しいカフェができました。"],
["Japanese","standard","昨日の夜、友達と電話で二時間も話しました。"],
["Japanese","standard","この薬は食後に飲んでください。"],
["Japanese","standard","来月から家賃が上がるそうです。"],
["Japanese","standard","旅行の写真をたくさん撮りました。"],
["Japanese","standard","日本の冬は寒いですが、雪景色がきれいです。"],
["Japanese","standard","彼女は英語も中国語も話せます。"],
["Japanese","standard","荷物が多すぎて一人で運べません。"],
["Japanese","standard","もう少し安くなりませんか?"],
["Japanese","standard","風邪を引かないように気をつけてください。"],
["Japanese","casual","今度の日曜、暇だったら遊びに来てよ。"],
["Japanese","casual","あの映画、泣けるって聞いたけど本当?"],
["Japanese","casual","ダイエット中なのにケーキ食べちゃった。"],
["Japanese","casual","スマホの調子が悪くて困ってる。"],
["Japanese","casual","駅まで送ってくれてありがとう。"],
["Japanese","standard","電気を消すのを忘れないでください。"],
["Japanese","standard","彼の話は信じられないほど面白かった。"],
["Japanese","standard","初めて寿司を作ってみたが、意外と難しかった。"],
["Japanese","standard","近所の人がりんごをくれました。"],
["Japanese","standard","明日は早いので、そろそろ失礼します。"],
];

const B = "https://howtosay-proxy-production.up.railway.app/translate";
let out = `# 词对齐人工标注审阅包(${S.length} 句)\n\n`;
out += `## 标注方法(只动错的行)\n`;
out += `- 每行格式:\`- [ ] 英文词 = 对齐结果\`(\`(灰)\`表示系统判定不上色)\n`;
out += `- **对的行:不用动**\n`;
out += `- **错的行:把 [ ] 改成 [x],行尾加 → 正确答案**(应该灰色就写 → 灰)\n`;
out += `- 例:\`- [x] keep = 让 → 保持\`\n\n---\n\n`;
let n = 0, fail = 0;
for (const [lang, style, sent] of S) {
  n++;
  let r;
  try {
    const resp = await fetch(B, { method: "POST",
      headers: {"Content-Type":"application/json", ...(APP_KEY?{"X-App-Key":APP_KEY}:{})},
      body: JSON.stringify({sourceText: sent, style, sourceLanguage: lang}),
      signal: AbortSignal.timeout(70000)});
    r = await resp.json();
  } catch(e) { fail++; out += `## ${n}. ${sent}\n(请求失败,跳过)\n\n`; continue; }
  if (!r.words) { fail++; out += `## ${n}. ${sent}\n(无结果,跳过)\n\n`; continue; }
  out += `## ${n}. ${sent}\n`;
  out += `> ${r.translation}\n\n`;
  for (const w of r.words) {
    if (/^[^A-Za-z0-9]+$/.test(w.english.trim())) continue;  // 纯标点不用标
    out += `- [ ] ${w.english} = ${w.sourceSpan || "(灰)"}\n`;
  }
  out += `\n`;
  process.stderr.write(`\r${n}/${S.length}`);
  await new Promise(res => setTimeout(res, 800));  // 限流保护
}
writeFileSync("tools/gold_review.md", out);
console.log(`\n完成:tools/gold_review.md(${S.length - fail} 句有效,${fail} 句失败)`);
