# jo's log 設定指南

## 你會得到什麼

一個手機和電腦都能開的網址（可以加到手機主畫面），你每天記一筆工作，資料存在你自己的 Google Sheet。網頁放在 GitHub Pages，Google Apps Script 當 API，兩者都免費。

注意：工作內容會存在個人 Google 帳號。Impact、Stakeholders、Feedback 請避免寫機密數字或客戶名稱（App 的 Settings 頁也會提醒）。

以下指令都在終端機執行，且都在 `jos-log` 資料夾裡（先 `cd` 進去）。Google 與 GitHub 的選單名稱可能略有不同，找意思相近的即可。

## 步驟 1 建立 Google Sheet

1. 用你的個人 Google 帳號開啟 https://sheets.new ，建立空白試算表。
2. 左上角檔名改成 `jo's log`。
3. 不用自己建分頁或標題列。第一次連線時，程式會自動建立名為 `Log` 的分頁，並寫入十個欄位標題。之後請不要改 `Log` 分頁名稱，也不要改第一列標題。

做完會看到：一張空白試算表，名字是 `jo's log`。

## 步驟 2 貼上 Apps Script

1. 在試算表選單點 Extensions（擴充功能）→ Apps Script。會開一個新分頁，裡面有一個 `Code.gs`，內容是預設的 `function myFunction() {}`。
2. 在終端機執行下面這行，把程式碼複製到剪貼簿：

```bash
pbcopy < apps-script/Code.gs
```

   （不想用指令：用編輯器打開 `apps-script/Code.gs`，全選、複製。）
3. 回到 Apps Script 編輯器，點進 `Code.gs` 的內容區，全選（Cmd+A）後貼上，整個取代原本內容。
4. 按存檔（Cmd+S，或上方磁碟片圖示）。

做完會看到：`Code.gs` 開頭是 `// jo's log API.`，沒有紅色錯誤。

## 步驟 3 設定 token

token 是這個 API 的密碼，每個請求都要帶。

1. 在終端機產生一組很長的隨機字串：

```bash
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
```

   沒有安裝 Node 的 Mac 用這行：

```bash
echo "$(uuidgen)$(uuidgen)"
```

2. 複製輸出的那一串。
3. 在 Apps Script 左側點齒輪 Project Settings（專案設定），捲到最下面的 Script Properties（指令碼屬性）→ Add script property（新增指令碼屬性）。
4. Property 填 `TOKEN`（全大寫），Value 貼上剛才那串，按 Save script properties（儲存）。

做完會看到：Script Properties 列表有一列 `TOKEN`。

把 token 當密碼保管：不要寫進 repo、不要 commit、不要貼進任何會公開的地方。每台裝置要用時，再從你的密碼管理員或這一步的 Script Properties 取得。

## 步驟 4 部署成 Web app

1. Apps Script 右上角 Deploy（部署）→ New deployment（新增部署作業）。
2. 點齒輪（Select type）選 Web app（網頁應用程式）。
3. Execute as（執行身分）選 Me（我）；Who has access（誰可以存取）選 Anyone（所有人）。
4. 按 Deploy。第一次會要求授權：Authorize access → 選你的帳號。出現「Google hasn't verified this app」是正常的，因為這是你自己寫的指令碼：點 Advanced（進階）→ Go to ...（unsafe）→ Allow。
5. 部署完成頁會顯示 Web app URL，結尾是 `/exec`。複製它，貼到你的備忘錄。

做完會看到：一個 `https://script.google.com/macros/s/…/exec` 的網址。在瀏覽器開它，應該只看到：

```
{"ok":true,"status":"jos-log"}
```

為什麼要選 Anyone：網頁要從任何裝置呼叫它，所以必須對外開放；但每個請求都要帶正確的 token。沒有 token 的人什麼都做不到（指令碼只回 `auth`，不會讀也不會改 Sheet）；但任何同時拿到網址和 token 的人，都能讀寫整份 `Log`，包含刪除。網址加 token 就是完整的憑證，安全程度等於你保管 token 的程度。token 外洩就要換（見常見問題最後一條）。

之後如果改了 `Code.gs`，要重新部署新版本，否則舊程式碼會繼續跑：Deploy → Manage deployments（管理部署作業）→ 點鉛筆圖示編輯 → Version 選 New version → Deploy。網址不會變。

## 步驟 5 發佈網頁到 GitHub Pages

1. 產生只含程式碼與使用說明的發佈分支（在 `jos-log` 資料夾執行）：

```bash
bash tools/publish-branch.sh
```

   這會建立（或更新）本機的 `publish` 分支：不含設計文件與開發紀錄，作者名稱是中性的，不會帶出你的個人 email。腳本在發現疑似個人資料（email、本機路徑）時會中止並告訴你在哪個檔案。

2. 到 https://github.com/new 建立新 repo：名稱例如 `jos-log`，選 Public，不要勾 README、.gitignore、license（要空的 repo）。
3. 把本機接上 GitHub（把 `<你的帳號>` 換成你的 GitHub 帳號）：

```bash
git remote add origin https://github.com/<你的帳號>/jos-log.git
```

4. 推上去（需要已安裝 git，並有 GitHub 帳號）：

```bash
git push -u origin publish:main
```

   只推這一條。不要執行 `git push --all`，也不要把 `build` 或 `main` 分支推上去：它們含有設計文件與你的個人 email。

   如果跳出要輸入密碼：GitHub 不再接受帳號密碼，請改貼 Personal Access Token（GitHub 網站 Settings → Developer settings → Personal access tokens，勾選 repo 權限），或先執行 `gh auth login` 登入後再推一次。

5. 到 repo 的 Settings → Pages → Build and deployment → Source，選 GitHub Actions。
6. 到 repo 的 Actions 分頁，等 Deploy to GitHub Pages 出現綠色勾勾（約一兩分鐘；它會先跑 `npm test` 再部署）。
7. 網站網址是 `https://<你的帳號>.github.io/jos-log/`。

如果第一次推送時 Pages 還沒設成 GitHub Actions，部署可能會失敗：設好 Source 之後，到 Actions 分頁點那次執行 → Re-run all jobs。

repo 是公開的，這是刻意的：裡面只有程式碼和這份使用說明，沒有 token，沒有 Sheet 或 Apps Script 網址，也沒有設計文件與你的個人 email（那些留在本機的 `build` 分支）。repo 名稱與 App 標題裡的 `jos-log` / `jo's log` 會公開；不想公開的話，建 repo 時可以改名。API URL 與 token 是你在每台裝置的 Settings 畫面輸入，只存在那台裝置的瀏覽器裡。

## 步驟 6 在每台裝置第一次使用

1. 開啟網站網址（iPhone 請先看下面「加到主畫面」，建議先加到主畫面，再從主畫面的圖示打開來設定）。第一次會直接進 Settings，只有兩個輸入框。
2. API URL 貼上步驟 4 的 `/exec` 網址，Token 貼上步驟 3 的那串。
3. 按 `測試連線`。看到 `連線成功，N 筆`（新 Sheet 是 0 筆）就代表通了。這一步也會讓程式在 Sheet 建立 `Log` 分頁。
4. 按 `儲存`。畫面會跳到 Log 頁。

加到主畫面（讓它像 App 一樣開）：

- iPhone：用 Safari 開網址 → 分享按鈕 → 加入主畫面。iOS 主畫面的 App 和 Safari 的儲存空間可能是分開的，所以建議加到主畫面之後，再從主畫面圖示打開，在那裡輸入 API URL 與 Token。如果從主畫面打開又回到 Settings，在那裡再輸入一次 API URL 與 Token。
- Android：用 Chrome 開網址 → 選單 → 安裝應用程式 / 加到主畫面。
- 電腦的 Chrome 或 Edge：網址列右側的安裝圖示（選用）。

公司電腦：直接在瀏覽器開同一個網址，輸入同樣的 API URL 與 Token 即可。網頁本身不需要登入任何 Google 帳號。

之後想回到 Settings：點頂部右側的同步狀態文字（例如 `已同步`），或在 All 頁最下方點 Settings。

## 日常使用速覽

- Log：記一筆。只有 What I did 是必填，其他可以晚點補。按 `log it` 儲存。
- Week：每週補 Impact（Missing impact 清單），旁邊有 15 分鐘的 Weekly sweep 提醒清單。
- All：搜尋、篩選、`Copy as text`，把結果貼進績效自評。
- Google Sheet 是資料的最終來源，可以直接在 `Log` 分頁手動修改。
- 沒網路時照常記錄，頂部會顯示 `離線`、`N 筆待同步`，恢復連線後自動同步，也可以在 Settings 按 `立即同步`。

## 更新網頁後

- 改完程式後，先更新發佈分支，再推送（在 `jos-log` 資料夾執行；兩條指令分開跑）：

```bash
bash tools/publish-branch.sh
```

```bash
git push origin publish:main
```

- 推送新版本後，已安裝的 App 可能要重新整理一兩次才會換成新版（Service Worker 先給舊檔、再背景更新），加上 GitHub Pages 本身有快取，最多可能延遲約十分鐘。
- 如果改動了 JavaScript 模組的 export（匯出的名稱），請同時把 `web/sw.js` 的快取名稱加一（目前是 `jos-log-v2`，下一次改成 `jos-log-v3`，依此類推），避免新舊檔案混在一起。

## 常見問題

- `token 錯誤`：Settings 的 Token 必須和 Script Properties 的 `TOKEN` 完全一樣（包含沒有多餘空白）。重新貼上其中一邊再儲存。待同步的紀錄會保留，token 修好後會自動送出。
- `無法連線`：檢查 API URL 有沒有貼錯、手機或電腦是否離線、公司網路是否擋了 `script.google.com`。也到 Apps Script 的 Deploy → Manage deployments 確認 Who has access 是 Anyone。
- `回應格式錯誤`：貼的不是 `/exec` 結尾的 Web app 網址，或是改了 `Code.gs` 卻沒有部署新版本（見步驟 4 最後一段）。也到 Deploy → Manage deployments 確認 Who has access 是 Anyone。
- `伺服器錯誤`：`Code.gs` 執行時發生例外，或 Google 服務暫時出問題。到 Apps Script 編輯器左側的 Executions（執行項目）看最近一次失敗的錯誤訊息。待同步的紀錄會保留，問題排除後會自動重送。（單一欄位超過 45000 字不是這一類：伺服器會直接拒絕，那一筆會出現在 Settings 的「被拒絕的紀錄」，可以複製內容再縮短重記。）
- 已存好但 Sheet 沒看到：打開 `Log` 分頁（不是預設的 Sheet1），Sheet 畫面不一定即時更新，重新整理試算表。
- 網頁看起來是舊的：重新整理兩次。
- 要換 token（例如 token 外洩，或不確定有沒有外流）：產生一組新的（步驟 3 的指令），把 Script Properties 的 `TOKEN` 改成新值並儲存，再到每台裝置的 Settings 輸入新 Token 後按 `儲存`。舊 token 立刻失效，沒換的裝置會顯示 `token 錯誤`。

## 開發者備註

- `npm test` 跑全部測試。
- 本機試跑：

```bash
node tools/fake-api.mjs
```

  另開一個終端機視窗：

```bash
python3 -m http.server 8080 --directory web
```

  然後開 http://localhost:8080 ，Settings 輸入 API URL `http://127.0.0.1:8787`、Token `dev`。假 API 的資料只存在記憶體，關掉就清空。

## Acceptance

狀態：尚未驗收（由 jo 執行）

在真正部署好的環境逐項檢查，通過後自己打勾。

- [ ] (a) 手機記一筆，電腦看得到。怎麼做：手機上記一筆（What I did 填 `手機測試`），電腦重新整理網頁。預期：電腦的 Log 或 All 出現這一筆。
- [ ] (b) 離線記錄會同步。怎麼做：手機開飛航模式，記一筆，頂部顯示 `離線 · 1 筆待同步`；關掉飛航模式，重新開啟 App。預期：自動同步成功，頂部變 `已同步`，Sheet 的 `Log` 分頁出現這一筆。
- [ ] (c) 開頭是 `=`、`+` 或 `'` 的內容按字面保存。怎麼做：記三筆，What I did 分別填 `=1+1`、`+1 call` 和 `'cause`。預期：Sheet 的 `Log` 分頁與 App 裡都顯示原文 `=1+1`、`+1 call`、`'cause`，不是算出來的 `2`，也不是錯誤；點開 Sheet 中 `'cause` 那一格，確認開頭的 `'` 沒有被吃掉（App 重新整理後也要看到 `'cause`）。
- [ ] (d) 手動改 Sheet 會反映到 App。怎麼做：(1) 在 Sheet 的 `Log` 分頁直接改某一格的文字，重新整理 App，預期：App 顯示新文字。(2) 在最下面手動新增一列，只填 `date`（格式 `2026-11-17`）和 `what_i_did`，不填 `id` 與各時間欄，再重新整理 App。預期：App 出現這一筆，回到 Sheet 看，該列已被補上 `id`、`created_at`、`updated_at`。
- [ ] (e) token 錯誤不會弄丟紀錄。怎麼做：在 Settings 把 Token 故意改錯並儲存，記一筆。預期：頂部顯示 `token 錯誤`，這一筆留在待同步；把 Token 改回正確值再儲存，這一筆會同步上去。
- [ ] (f) 錯的 token 不會改動 Sheet。怎麼做：先確認 `Log` 分頁已存在（做過上面任一項即可），記下目前列數與最後一列內容；用 (e) 的錯誤 token 試著連線或同步；再看 `Log` 分頁。預期：內容完全沒變，沒有新分頁、沒有被改格式。另外在瀏覽器直接開 `/exec` 網址，預期只看到 `{"ok":true,"status":"jos-log"}`，沒有其他內容。
- [ ] (g) 公司電腦可用（設計文件的待驗證風險：事先沒有測過公司網路能否連到 `github.io` 與 `script.google.com`）。怎麼做：在公司電腦瀏覽器開網站網址，輸入 API URL 與 Token，`測試連線` 後 `儲存`，記一筆。預期：連線成功、紀錄存好、Sheet 看得到。若被擋，停止並回報，再討論替代方案。
- [ ] (h) 加到主畫面的 App 可離線打開。怎麼做：在手機主畫面的圖示打開 App，確認 API URL 與 Token 是在這個主畫面 App 裡輸入並儲存的（若一開始是回到 Settings 就在這裡輸入），讓它載入資料；再開飛航模式，關掉 App 重新開啟。預期：App 能開，不會回到首次設定畫面，並顯示最後一次的資料。
