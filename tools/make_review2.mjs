// 第二批人工标注包:50 中 + 50 日,难度加码(对着已知弱点出题)
import { readFileSync, writeFileSync } from 'fs';
let APP_KEY = process.env.APP_SHARED_SECRET || "";
try { if (!APP_KEY) APP_KEY = readFileSync('.app-secret', 'utf-8').trim(); } catch {}

const S = [
// ===== 中文 50:离合词/补语/把被兼语/双重否定/口语/量词/强调 =====
["Simplified Chinese","casual","帮个忙呗,我一个人搬不动这张桌子。"],
["Simplified Chinese","casual","他昨晚喝多了,今天起都起不来。"],
["Simplified Chinese","standard","我把刚买的杯子摔碎了。"],
["Simplified Chinese","standard","这篇文章我看了三遍才看懂。"],
["Simplified Chinese","casual","你先别生气,听我把话说完。"],
["Simplified Chinese","standard","他从书包里拿出来一本旧字典。"],
["Simplified Chinese","casual","天太热了,热得我一点胃口都没有。"],
["Simplified Chinese","standard","你难道不觉得这件事有点奇怪吗?"],
["Simplified Chinese","standard","为了赶上末班车,他不得不提前离开聚会。"],
["Simplified Chinese","casual","现在的年轻人都不想内卷,只想躺平。"],
["Simplified Chinese","standard","昨天下了一场大雨,我们只好取消了比赛。"],
["Simplified Chinese","standard","这件事是他亲口告诉我的。"],
["Simplified Chinese","casual","咱们边吃边聊吧,菜都要凉了。"],
["Simplified Chinese","standard","他越解释,大家越糊涂。"],
["Simplified Chinese","casual","这孩子又聪明又懂事,谁见了都喜欢。"],
["Simplified Chinese","standard","请你把窗帘拉上,阳光太刺眼了。"],
["Simplified Chinese","casual","我跟你说,这事儿你可千万别往心里去。"],
["Simplified Chinese","standard","他被同事们推选为新一任的部门主管。"],
["Simplified Chinese","standard","老师让每个学生都写一篇读后感。"],
["Simplified Chinese","casual","你这不是明知故问嘛。"],
["Simplified Chinese","standard","我洗了个澡就睡了,没看到你的消息。"],
["Simplified Chinese","casual","他这个人说话总是绕来绕去,从来不直说。"],
["Simplified Chinese","standard","只有坚持到最后的人,才能尝到成功的滋味。"],
["Simplified Chinese","standard","这道题看起来简单,做起来却没那么容易。"],
["Simplified Chinese","casual","行李箱塞得满满的,差点关不上。"],
["Simplified Chinese","standard","他一进门就发现气氛不对劲。"],
["Simplified Chinese","casual","别提了,我的手机刚修好又摔了。"],
["Simplified Chinese","standard","与会者就这个方案展开了激烈的讨论。"],
["Simplified Chinese","standard","再忙也要按时吃饭,身体要紧。"],
["Simplified Chinese","casual","这部电影口碑两极分化,有人吹爆有人踩。"],
["Simplified Chinese","standard","他把责任全都推到了别人身上。"],
["Simplified Chinese","standard","消息一传开,整个公司都炸了锅。"],
["Simplified Chinese","casual","大过年的,你就别给大家添堵了。"],
["Simplified Chinese","standard","哪怕只有一线希望,我们也不能放弃。"],
["Simplified Chinese","standard","他装作什么都不知道的样子继续工作。"],
["Simplified Chinese","casual","这家伙嘴上说不要,身体倒是很诚实。"],
["Simplified Chinese","standard","经过三个月的康复训练,他终于能下地走路了。"],
["Simplified Chinese","standard","你最好把重要文件备份一份,以防万一。"],
["Simplified Chinese","casual","我点的外卖到现在还没送到,都两个小时了。"],
["Simplified Chinese","standard","面对质疑,她始终保持着冷静。"],
["Simplified Chinese","casual","这价格贵是贵了点,但东西确实好。"],
["Simplified Chinese","standard","他连一句道歉的话都没有说就走了。"],
["Simplified Chinese","standard","球队在落后两球的情况下逆转取胜。"],
["Simplified Chinese","casual","你少来这套,我又不是第一天认识你。"],
["Simplified Chinese","standard","孩子们在操场上跑来跑去,玩得不亦乐乎。"],
["Simplified Chinese","standard","这项政策对小微企业来说无疑是雪中送炭。"],
["Simplified Chinese","casual","熬夜一时爽,第二天上班就遭罪了。"],
["Simplified Chinese","standard","不管别人怎么说,我都会坚持自己的选择。"],
["Simplified Chinese","standard","他一口气爬上了山顶,连大气都不喘。"],
["Simplified Chinese","casual","这事儿八成是黄了,咱们另想办法吧。"],
// ===== 日语 50:敬语/授受/使役受身/ところ/オノマトペ/缩约/てばかり =====
["Japanese","standard","先生がおっしゃったことをもう一度教えていただけますか。"],
["Japanese","standard","部長は会議室にいらっしゃいます。"],
["Japanese","standard","明日伺ってもよろしいでしょうか。"],
["Japanese","standard","友達に宿題を手伝ってもらいました。"],
["Japanese","standard","母が弁当を作ってくれました。"],
["Japanese","standard","後輩に資料をコピーしてあげた。"],
["Japanese","standard","子供の頃、母に野菜を食べさせられました。"],
["Japanese","standard","急に雨に降られて、びしょ濡れになった。"],
["Japanese","standard","今ちょうど夕飯を作っているところです。"],
["Japanese","standard","駅に着いたところで、電車が出てしまった。"],
["Japanese","casual","お腹ぺこぺこで、もう動けない。"],
["Japanese","casual","明日テストだから勉強しなきゃ。"],
["Japanese","casual","この資料、先に読んどくね。"],
["Japanese","casual","ごめん、何言ってるかわかんない。"],
["Japanese","standard","彼は漫画を読んでばかりいて、全然勉強しない。"],
["Japanese","standard","日本の物価は年々上がりつつある。"],
["Japanese","standard","この問題は難しすぎて、私には解けそうにない。"],
["Japanese","standard","彼の提案は受け入れがたいものだった。"],
["Japanese","standard","お金さえあれば、世界中を旅行できるのに。"],
["Japanese","standard","東京に行くなら、新幹線が便利ですよ。"],
["Japanese","casual","昨日の試合、最後までハラハラしたね。"],
["Japanese","standard","雷がごろごろ鳴っている。"],
["Japanese","casual","明日の遠足、今からわくわくする。"],
["Japanese","standard","彼女は約束を破ったことを謝りもしなかった。"],
["Japanese","standard","この街も昔に比べてずいぶん変わったものだ。"],
["Japanese","standard","人の悪口を言うものではありません。"],
["Japanese","standard","会議は来週に延期されることになりました。"],
["Japanese","standard","毎朝三十分走るようにしています。"],
["Japanese","standard","彼が嘘をつくはずがない。"],
["Japanese","standard","財布には千円しか残っていなかった。"],
["Japanese","casual","最近、残業ばかりで全然家に帰れない。"],
["Japanese","standard","彼は何も言わずに部屋を飛び出した。"],
["Japanese","standard","試験に落ちて、彼はすっかり落ち込んでいる。"],
["Japanese","standard","大事なサインを見逃してしまった。"],
["Japanese","casual","あの店、いつ行っても混んでるんだよね。"],
["Japanese","standard","ご迷惑をおかけして申し訳ございません。"],
["Japanese","standard","お世話になった先生にお礼の手紙を書いた。"],
["Japanese","casual","今日は仕事が早く終わったから、飲みに行かない?"],
["Japanese","standard","彼女は歌手としてだけでなく、女優としても活躍している。"],
["Japanese","standard","窓ガラスが割れているのに気がついた。"],
["Japanese","casual","この服、ちょっと派手すぎるかなあ。"],
["Japanese","standard","出発の前に、忘れ物がないか確認してください。"],
["Japanese","standard","彼の話を聞いているうちに、眠くなってきた。"],
["Japanese","standard","風邪気味なので、今日は早めに休みます。"],
["Japanese","casual","え、マジで?それはやばいって。"],
["Japanese","standard","赤ちゃんがすやすや眠っている。"],
["Japanese","standard","彼は怒るどころか、笑って許してくれた。"],
["Japanese","standard","携帯を家に忘れてきたことに今気づいた。"],
["Japanese","casual","そんなに焦らなくても、まだ時間あるじゃん。"],
["Japanese","standard","新しい橋の建設が進められている。"],
];

const B = "https://howtosay-proxy-production.up.railway.app/translate";
let out = `# 词对齐人工标注审阅包 · 第二批(${S.length} 句,加难版)\n\n`;
out += `标注方法同第一批:对的不动;错的 [ ]→[x],行尾 → 正确答案(应灰写 → 灰)。\n多词块自带〔短语〕/〔语法〕标记,标记错了也请指出。\n\n---\n\n`;
let n = 0, fail = 0;
for (const [lang, style, sent] of S) {
  n++;
  let block = null;
  for (let attempt = 0; attempt < 3 && !block; attempt++) {
    try {
      const resp = await fetch(B, { method: "POST",
        headers: {"Content-Type":"application/json", ...(APP_KEY?{"X-App-Key":APP_KEY}:{})},
        body: JSON.stringify({sourceText: sent, style, sourceLanguage: lang}),
        signal: AbortSignal.timeout(70000)});
      const r = await resp.json();
      if (r.words) {
        let b = `## ${n}. ${sent}\n> ${r.translation}\n\n`;
        for (const w of r.words) {
          if (/^[^A-Za-z0-9]+$/.test(w.english.trim())) continue;
          const tag = /\s/.test(w.english.trim()) ? (w.isGrammarStructure ? "〔语法〕" : "〔短语〕") : "";
          b += `- [ ] ${w.english}${tag} = ${w.sourceSpan || "(灰)"}\n`;
        }
        block = b + "\n";
      }
    } catch {}
    if (!block) await new Promise(r => setTimeout(r, 8000));
  }
  if (block) { out += block; } else { out += `## ${n}. ${sent}\n(失败,跳过)\n\n`; fail++; }
  process.stderr.write(`\r${n}/${S.length}`);
  await new Promise(r => setTimeout(r, 3500));
}
writeFileSync("tools/gold_review2.md", out);
console.log(`\n完成:tools/gold_review2.md(失败 ${fail})`);
