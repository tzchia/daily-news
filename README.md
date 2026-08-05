# daily-news

每日英文新聞摘要（英中對照），每天 08:00（台北時間）由排程自動更新。

網站：https://tzchia.github.io/daily-news/

## 結構

- `index.html` — 前端，讀取 `data/` 內的 JSON 渲染卡片
- `data/index.json` — `{"dates": ["YYYY-MM-DD", ...]}` 日期清單
- `data/YYYY-MM-DD.json` — 當日新聞：

```json
{
  "date": "2026-08-04",
  "items": [
    {
      "category": "世界 | 科技/財經 | 羽球 | 籃球 | 棒球",
      "title_en": "...",
      "summary_en": "...",
      "title_zh": "...",
      "summary_zh": "...",
      "url": "https://...",
      "source": "BBC News"
    }
  ],
  "quiz": [
    {
      "word": "答案單字",
      "sentence": "取自當日 summary_en、挖空處用 ____ 的句子",
      "hint_zh": "詞性＋繁中意思"
    }
  ]
}
```

內容偏好：世界大事 ×2、科技（新技術/財金）×1、運動（羽球/籃球/棒球，台灣選手優先）×1。

## 互動功能

- 點一下（單擊）英文單字 → 彈出繁中翻譯並自動發音（Web Speech API，en-US）；點 🔊 可重播；再點同一字或空白處關閉。翻譯：Google Translate 免費端點，MyMemory 備援，localStorage 快取
- 頁面底部「今日重點單字填空」10 題，取自當日新聞原句，可逐題對答案或一鍵全對
