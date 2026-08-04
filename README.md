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
  ]
}
```

內容偏好：世界大事 ×2、科技（新技術/財金）×1、運動（羽球/籃球/棒球，台灣選手優先）×1。
