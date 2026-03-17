# hello-realtime-gpt

以 OpenAI Realtime API 為基礎的語音 QA 機器人，能夠根據爬取的文章內容，即時以語音回答使用者的問題。

## 功能

- 語音即時對話（OpenAI Realtime API）
- 根據文章資料庫回答問題，不憑空推測
- 文章資料來源：理財咩角專欄（可自行更換）

## 環境設定

複製 `.env.example` 為 `.env`，填入你的 OpenAI API Key：

```
OPENAI_API_KEY=sk-...
```

## 安裝依賴

```bash
npm install
```

## 操作流程

### Step 1：爬取文章資料

從理財咩角抓取瀏覽量最高的文章，存為 JSON 檔案供 QA Bot 使用：

```bash
# 預設抓取 Top 5
node scripts/scrape-top-articles.js

# 指定數量
node scripts/scrape-top-articles.js 10
node scripts/scrape-top-articles.js --top 3
```

> 初次使用需先安裝 Playwright 瀏覽器：
> ```bash
> npx playwright install chromium
> ```

爬取結果會存放在 `output/top-articles-{timestamp}.json`。

### Step 2：產生 Ephemeral API Key

Realtime API 需要使用短效 token，請執行：

```bash
npm run token
```

複製輸出的 key，待連線時使用。

### Step 3：啟動開發伺服器

```bash
npm run dev
```

開啟瀏覽器後，點擊 **Connect** 按鈕，貼入剛才產生的 ephemeral key 即可開始語音對話。

### 連線後的操作

| 按鈕 | 功能 |
|------|------|
| Connect | 連線並開始對話 |
| Mute / Unmute | 靜音 / 取消靜音 |
| Disconnect | 結束連線 |

## 開發指令

```bash
npm run dev      # 啟動開發伺服器
npm run build    # 建置正式版本
npm run preview  # 預覽建置結果
npm test         # 執行單元測試
```
