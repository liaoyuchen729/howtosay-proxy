# How to Say —— 翻译代理(Railway)

App 只连这个服务;OpenAI key 放在 Railway 环境变量里,不进 App、不进 git。

## 部署到 Railway

1. 把这个文件夹推到一个 **GitHub 仓库**(只放这 3 个文件:`server.js`、`package.json`、`README.md`)。
2. Railway → **New Project → Deploy from GitHub repo** → 选这个仓库。
   (Railway 会自动识别 Node,执行 `npm install` 然后 `npm start`。)
3. 进项目 → **Variables**,加环境变量:
   - `OPENAI_API_KEY` = 你的**新** OpenAI key
   - (可选)`OPENAI_MODEL` = `gpt-4o-mini`(默认就是它,想换更强的型号在这改)
   - (可选)`APP_SHARED_SECRET` = 一串你自己定的密码(防别人乱用你的接口;设了之后 App 要在请求头带 `X-App-Key`)
4. Railway → **Settings → Networking → Generate Domain**,拿到一个公开网址,例如
   `https://howtosay-proxy-production.up.railway.app`

## 接口

- `GET /` → 返回 `How to Say proxy: OK`(健康检查)
- `POST /translate`
  - 请求体:`{ "sourceText": "我今天很累", "style": "casual", "sourceLanguage": "Simplified Chinese" }`
  - 返回体:App 需要的结果 JSON(`translation` / `words` / `grammarPoints`)

## 接回 App

拿到网址后,在 App 的 `HowToSay/Services/TranslationAPI.swift` 里:
- `proxyURL` = 上面的网址 + `/translate`,例如
  `https://howtosay-proxy-production.up.railway.app/translate`
- 然后把 `Secrets.swift` 里的 key 清空(上线就不需要它了)。

设了 `proxyURL` 后,App 会自动走代理,不再直连 OpenAI。
