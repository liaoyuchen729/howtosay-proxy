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
  // —— 第二批标注收割 82-100(2026-06-13)——
  ["Japanese","彼は何も言わずに部屋を飛び出した。",[ G(["without"],["ずに"]), G(["saying"],["言わ"]) ]],
  ["Japanese","試験に落ちて、彼はすっかり落ち込んでいる。",[ G(["after"],["て"]), G(["failing"],["落ち"]) ]],
  ["Japanese","あの店、いつ行っても混んでるんだよね。",[ G(["always"],[""]), G(["whenever"],["いつ"]) ]],
  ["Japanese","今日は仕事が早く終わったから、飲みに行かない?",[ G(["grab"],[""]), G(["some"],[""]), G(["drinks"],["飲みに行かない?"]) ]],
  ["Japanese","彼女は歌手としてだけでなく、女優としても活躍している。",[ G(["active"],["活躍している"]), G(["not"],[""]), G(["only"],[""]), G(["but"],[""]), G(["also"],["も"]) ]],
  ["Japanese","出発の前に、忘れ物がないか確認してください。",[ G(["before"],["の前に"]) ]],
  ["Japanese","風邪気味なので、今日は早めに休みます。",[ G(["go"],["休みます"]), G(["to"],[""]), G(["bed"],[""]), G(["today"],["今日"]), G(["because"],["なので"]) ]],
  ["Japanese","彼は怒るどころか、笑って許してくれた。",[ G(["not"],[""]), G(["instead"],["どころか"]) ]],
  ["Japanese","携帯を家に忘れてきたことに今気づいた。",[ G(["just"],["今"]) ]],
  ["Japanese","新しい橋の建設が進められている。",[ G(["underway"],["進められている"]) ]],
  // —— 第二批标注收割 1-81(2026-06-13)——
  ["Simplified Chinese","他昨晚喝多了,今天起都起不来。",[ G(["can't"],["不来"]), G(["get up"],["起"]) ]],
  ["Simplified Chinese","我把刚买的杯子摔碎了。",[ G(["just"],["刚"]), G(["bought"],["买"]) ]],
  ["Simplified Chinese","这篇文章我看了三遍才看懂。",[ G(["before"],[""]) ]],
  ["Simplified Chinese","你先别生气,听我把话说完。",[ G(["out"],["说完"]) ]],
  ["Simplified Chinese","他从书包里拿出来一本旧字典。",[ G(["took"],["拿"]), G(["of"],[""]) ]],
  ["Simplified Chinese","天太热了,热得我一点胃口都没有。",[ G(["feel"],[""]), G(["like"],[""]), G(["at"],[""]), G(["all"],["一点"]) ]],
  ["Simplified Chinese","你难道不觉得这件事有点奇怪吗?",[ G(["this"],["这件"]), G(["matter"],["事"]) ]],
  ["Simplified Chinese","现在的年轻人都不想内卷,只想躺平。",[ G(["nowadays"],["现在的"]), G(["just"],["只"]), G(["chill"],[""]) ]],
  ["Simplified Chinese","昨天下了一场大雨,我们只好取消了比赛。",[ G(["so"],[""]), G(["had"],[""]), G(["to"],[""]) ]],
  ["Simplified Chinese","这件事是他亲口告诉我的。",[ G(["in"],[""]), G(["person"],["亲口"]) ]],
  ["Simplified Chinese","咱们边吃边聊吧,菜都要凉了。",[ G(["at"],[""]), G(["the"],[""]), G(["same"],["边"]), G(["time"],["边"]) ]],
  ["Simplified Chinese","我跟你说,这事儿你可千万别往心里去。",[ G(["telling"],["说"]), G(["take"],[""]), G(["to heart"],["往心里去"]) ]],
  ["Simplified Chinese","老师让每个学生都写一篇读后感。",[ G(["asked"],["让"]) ]],
  ["Simplified Chinese","你这不是明知故问嘛。",[ G(["even though"],[""]), G(["know"],["知"]) ]],
  ["Simplified Chinese","我洗了个澡就睡了,没看到你的消息。",[ G(["and"],[""]), G(["went"],[""]), G(["sleep"],["睡"]) ]],
  ["Simplified Chinese","他这个人说话总是绕来绕去,从来不直说。",[ G(["gets"],[""]) ]],
  ["Simplified Chinese","只有坚持到最后的人,才能尝到成功的滋味。",[ G(["can"],["能"]) ]],
  ["Simplified Chinese","这道题看起来简单,做起来却没那么容易。",[ G(["that"],["那么"]) ]],
  ["Simplified Chinese","他一进门就发现气氛不对劲。",[ G(["as soon as"],["一"]), G(["entered"],["进"]) ]],
  ["Simplified Chinese","别提了,我的手机刚修好又摔了。",[ G(["even"],[""]), G(["mention it"],["提"]), G(["just"],["刚"]), G(["already"],[""]), G(["again"],["又"]) ]],
  ["Simplified Chinese","与会者就这个方案展开了激烈的讨论。",[ G(["in"],[""]) ]],
  ["Simplified Chinese","再忙也要按时吃饭,身体要紧。",[ G(["no matter how busy"],["再忙"]), G(["because"],[""]), G(["important"],["要紧"]) ]],
  ["Simplified Chinese","这部电影口碑两极分化,有人吹爆有人踩。",[ G(["got"],["有"]), G(["people"],["人"]) ]],
  ["Simplified Chinese","他把责任全都推到了别人身上。",[ G(["shifted"],["推"]), G(["all"],["全"]) ]],
  ["Simplified Chinese","消息一传开,整个公司都炸了锅。",[ G(["in"],[""]), G(["an"],[""]), G(["uproar"],["炸了锅"]) ]],
  ["Simplified Chinese","大过年的,你就别给大家添堵了。",[ G(["new year"],["大过年"]) ]],
  ["Simplified Chinese","哪怕只有一线希望,我们也不能放弃。",[ G(["a"],[""]), G(["glimmer"],["一线"]), G(["of"],[""]) ]],
  ["Simplified Chinese","这家伙嘴上说不要,身体倒是很诚实。",[ G(["but"],["倒"]), G(["telling"],[""]) ]],
  ["Simplified Chinese","你最好把重要文件备份一份,以防万一。",[ G(["make a backup copy"],["备份"]), G(["just in case"],["以防万一"]) ]],
  ["Simplified Chinese","球队在落后两球的情况下逆转取胜。",[ G(["came"],["逆转"]), G(["from"],[""]), G(["behind"],[""]), G(["down"],["落后"]) ]],
  ["Simplified Chinese","你少来这套,我又不是第一天认识你。",[ G(["cut"],["你少来"]), G(["the"],[""]), G(["crap"],["这套"]) ]],
  ["Simplified Chinese","孩子们在操场上跑来跑去,玩得不亦乐乎。",[ G(["having"],[""]), G(["playing"],["玩"]) ]],
  ["Simplified Chinese","这项政策对小微企业来说无疑是雪中送炭。",[ G(["small"],["小"]), G(["micro enterprises"],["微企业"]) ]],
  ["Simplified Chinese","熬夜一时爽,第二天上班就遭罪了。",[ G(["feels great"],["爽"]), G(["a"],[""]), G(["bit"],[""]) ]],
  ["Japanese","母が弁当を作ってくれました。",[ G(["made"],["作って"]), G(["for"],["くれました"]) ]],
  ["Japanese","後輩に資料をコピーしてあげた。",[ G(["copied"],["コピーして"]), G(["for"],["あげた"]) ]],
  ["Japanese","子供の頃、母に野菜を食べさせられました。",[ G(["when"],[""]) ]],
  ["Japanese","今ちょうど夕飯を作っているところです。",[ G(["just"],["ちょうど"]), G(["right now"],["今"]) ]],
  ["Japanese","駅に着いたところで、電車が出てしまった。",[ G(["just"],[""]), G(["as"],["ところ"]), G(["arrived at"],["着いた"]) ]],
  ["Japanese","お腹ぺこぺこで、もう動けない。",[ G(["can't move"],["動けない"]), G(["anymore"],["もう"]) ]],
  ["Japanese","明日テストだから勉強しなきゃ。",[ G(["gotta"],["しなきゃ"]), G(["study"],["勉強"]), G(["'cause"],["だから"]) ]],
  ["Japanese","ごめん、何言ってるかわかんない。",[ G(["have no"],["わかんない"]), G(["idea"],[""]) ]],
  ["Japanese","彼は漫画を読んでばかりいて、全然勉強しない。",[ G(["does"],[""]), G(["not"],[""]), G(["study"],["勉強"]), G(["at"],[""]), G(["all"],[""]) ]],
  ["Japanese","昨日の試合、最後までハラハラしたね。",[ G(["yesterday"],["昨日"]), G(["till"],["まで"]), G(["end"],["最後"]) ]],
  ["Japanese","雷がごろごろ鳴っている。",[ G(["is rumbling"],["鳴っている"]) ]],
  ["Japanese","彼女は約束を破ったことを謝りもしなかった。",[ G(["did"],[""]), G(["not"],["しなかった"]), G(["even"],["も"]) ]],
  ["Japanese","人の悪口を言うものではありません。",[ G(["should"],[""]), G(["not"],["ません"]) ]],
  ["Japanese","彼が嘘をつくはずがない。",[ G(["no"],["ない"]), G(["way"],["はず"]), G(["lie"],["嘘をつく"]) ]],
  ["Japanese","財布には千円しか残っていなかった。",[ G(["left in"],["残って"]) ]],
  ["Japanese","最近、残業ばかりで全然家に帰れない。",[ G(["lately"],[""]), G(["can't"],["ない"]), G(["at"],[""]), G(["all"],["全然"]) ]],
  // —— 用户标注收割(74-100 题,2026-06-13)——
  ["Japanese","日本に行ったことがありますか?",[ G(["ever"],[""]), G(["been"],["行った"]), G(["to"],[""]) ]],
  ["Japanese","窓を開けたまま寝てしまいました。",[ G(["fell asleep"],["寝て","寝"]), G(["open"],["開けた"]) ]],
  ["Japanese","雨が降らないうちに帰りましょう。",[ G(["starts raining"],["雨が降らない","降らない"]) ]],
  ["Japanese","彼は来ないかもしれません。",[ G(["not"],["ない"]) ]],
  ["Japanese","この漢字の読み方を教えてください。",[ G(["please"],["ください"]) ]],
  ["Japanese","会議は三時に始まることになっています。",[ G(["o'clock"],["時"]) ]],
  ["Japanese","駅の近くに新しいカフェができました。",[ G(["new"],["新しい"]) ]],
  ["Japanese","昨日の夜、友達と電話で二時間も話しました。",[ G(["talked"],["話しました"]), G(["on the"],[""]), G(["phone"],["電話"]), G(["with"],["と"]) ]],
  ["Japanese","この薬は食後に飲んでください。",[ G(["after"],["後"]) ]],
  ["Japanese","旅行の写真をたくさん撮りました。",[ G(["a"],[""]), G(["lot"],["たくさん"]), G(["of"],[""]) ]],
  ["Japanese","日本の冬は寒いですが、雪景色がきれいです。",[ G(["beautiful"],["きれい"]) ]],
  ["Japanese","荷物が多すぎて一人で運べません。",[ G(["too"],["すぎ"]), G(["carry"],["運べ"]) ]],
  ["Japanese","今度の日曜、暇だったら遊びに来てよ。",[ G(["if"],["だったら"]), G(["hang out"],["遊び"]) ]],
  ["Japanese","あの映画、泣けるって聞いたけど本当?",[ G(["that"],["あの"]) ]],
  ["Japanese","ダイエット中なのにケーキ食べちゃった。",[ G(["diet"],["ダイエット"]) ]],
  ["Japanese","スマホの調子が悪くて困ってる。",[ G(["driving"],["困ってる"]), G(["me"],[""]), G(["nuts"],[""]) ]],
  ["Japanese","駅まで送ってくれてありがとう。",[ G(["dropping"],["送って"]), G(["me"],[""]), G(["off"],[""]) ]],
  ["Japanese","電気を消すのを忘れないでください。",[ G(["please"],["ください"]), G(["forget"],["忘れ"]) ]],
  ["Japanese","初めて寿司を作ってみたが、意外と難しかった。",[ G(["was"],["かった"]), G(["difficult"],["難し"]) ]],
  // —— 用户标注收割(1-73 题,2026-06-12)——
  ["Simplified Chinese","他这个人就是嘴硬心软。",[ G(["all"],[""]), G(["but"],[""]), G(["soft"],["软"]) ]],
  ["Simplified Chinese","我今天摸了一天鱼,啥也没干。",[ G(["get"],[""]), G(["done"],["干"]) ]],
  ["Simplified Chinese","这家店的奶茶绝了,你一定要试试。",[ G(["this"],[""]), G(["tea"],["茶"]) ]],
  ["Simplified Chinese","你别给我画大饼了,我不吃这套。",[ G(["big"],["大"]) ]],
  ["Simplified Chinese","这事儿八字还没一撇呢。",[ G(["this"],[""]), G(["even"],[""]), G(["yet"],["还"]) ]],
  ["Simplified Chinese","你可拉倒吧,他哪有那么好心。",[ G(["come"],[""]), G(["on"],[""]) ]],
  ["Simplified Chinese","妈妈让我去超市买点酱油。",[ G(["asked"],["让"]) ]],
  ["Simplified Chinese","这道菜做得比上次好吃多了。",[ G(["last"],["上"]), G(["time"],["次"]) ]],
  ["Simplified Chinese","你是不是把我的话当耳旁风了?",[ G(["what"],[""]) ]],
  ["Simplified Chinese","他跑得连呼吸都困难了。",[ G(["became"],["都"]), G(["difficult"],["困难"]) ]],
  ["Simplified Chinese","除非下雨,否则我们就去野餐。",[ G(["will"],["就"]) ]],
  ["Simplified Chinese","与其在家里闲着,不如出去走走。",[ G(["staying"],[""]), G(["out"],["出"]) ]],
  ["Simplified Chinese","天气预报说明天有大雨。",[ G(["says"],["说"]) ]],
  ["Simplified Chinese","我的护照下个月就要过期了。",[ G(["will"],["就要"]) ]],
  ["Simplified Chinese","我妈做的红烧肉比饭店的香多了。",[ G(["way"],["多"]), G(["better"],[""]) ]],
  ["Simplified Chinese","快递到了,帮我拿一下呗。",[ G(["can"],[""]), G(["for"],["一下"]), G(["me"],[""]) ]],
  ["Simplified Chinese","养成早睡早起的习惯对身体好。",[ G(["going"],[""]), G(["to"],[""]), G(["bed"],[""]), G(["early"],["早"]) ]],
  ["Simplified Chinese","如果我当时多复习一会儿,就不会考砸了。",[ G(["little"],["一会儿"]), G(["longer"],["多"]) ]],
  ["Simplified Chinese","行了行了,知道了,你别唠叨了。",[ G(["get"],["知道了"]), G(["it"],[""]) ]],
  ["Simplified Chinese","这个问题我们改天再讨论吧。",[ G(["another"],["改"]) ]],
  ["Simplified Chinese","我减肥失败了,又胖回去了。",[ G(["losing weight"],["减肥"]), G(["gained"],["胖"]), G(["all"],[""]), G(["back"],["回去"]), G(["again"],["又"]) ]],
  ["Simplified Chinese","按照说明书一步一步来就行。",[ G(["follow"],["按照"]) ]],
  ["Japanese","今日めっちゃ疲れたから、もう寝るわ。",[ G(["wiped"],["疲れた"]), G(["out"],[""]) ]],
  ["Japanese","電車に乗り遅れちゃった。",[ G(["missed"],["乗り遅れ"]) ]],
  ["Japanese","先生に褒められて嬉しかったです。",[ G(["was"],["かった"]), G(["happy"],["嬉し"]) ]],
  ["Japanese","弟にケーキを食べられてしまった。",[ G(["ate"],["食べられて","食べられてしまった"]) ]],
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
  if (!r.words) {
    // 限流等错误:等 3 秒重试一次,仍失败才跳过(不计入分母,避免污染)
    await new Promise(res => setTimeout(res, 3000));
    try {
      const resp2 = await fetch(B, { method:"POST",
        headers:{"Content-Type":"application/json", ...(APP_KEY?{"X-App-Key":APP_KEY}:{})},
        body: JSON.stringify({sourceText:srcText, style:"standard", sourceLanguage:lang, ...(model?{debugModel:model}:{})}),
        signal: AbortSignal.timeout(70000)});
      r = await resp2.json();
    } catch {}
    if (!r.words) { console.log("⊘ 跳过(限流):", srcText.slice(0,12)); continue; }
  }
  for (const g of golds) {
    const w = r.words.find(x => g.keys.includes(String(x.english).trim().toLowerCase()));
    if (!w) { skipped++; continue; }   // 译文没用这个词,不计分
    const sp = String(w.sourceSpan || "");
    if (g.spans.includes(sp)) correct++;
    else { wrong++; wrongList.push(`[${srcText.slice(0,10)}…] ${w.english}=「${sp}」 期望:${JSON.stringify(g.spans)}`); }
  }
  await new Promise(r => setTimeout(r, 1200));  // 节流:金标集变大后防限流污染
}
}
const total = correct + wrong;
console.log(`\n===== 对齐黄金标准评测 ${model || "(默认模型)"} =====`);
console.log(`正确 ${correct} / 计分 ${total}  →  正确率 ${(100*correct/total).toFixed(1)}%   (跳过${skipped}个未出现词)`);
console.log("\n错误明细:");
wrongList.forEach(x=>console.log(" ✗", x));
