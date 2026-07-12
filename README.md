# anime

一个简洁的番剧搜索网页，可以按中文、英文、日文标题搜索并自动匹配别名。

## 功能

- 番剧搜索：使用 Bangumi API 查询公开番剧资料。
- 自动匹配：按标题、中文名、原名和别名计算相似度。
- 详情面板：展示海报、简介、类型、集数、Bangumi 评分和别名。
- 在线观看：优先使用在线直链片源（稀饭动漫、西瓜卡通、咕咕番），自动探测可播线路；播放失败时自动换线路/换源。
- 主题切换：支持浅色、深色和跟随系统，并会记住上次选择。
- 授权内嵌播放：在 `app.js` 的 `authorizedPlayers` 中配置官方允许嵌入的播放器地址后，可以在详情页内直接播放。
- 离线示例：接口不可用时仍能显示热门示例。

## 已接入站点

- [稀饭动漫](https://dm1.xfdm.pro/)
- [咕咕番](https://www.gugu3.com/)
- [西瓜卡通](https://www.xgcartoon.com/)
- [蜜柑计划](https://mikanani.me/)（BT，首次播放需等待找种）

选择一部番剧后，详情页会通过本地代理查询站点搜索接口、解析真实视频地址，并在本站原生播放器中播放。可切换站点、线路和集数。部分加密线路（例如咕咕番部分线路）若无法解析直链，会提示换线路或片源。

## 播放配置

只添加你有权使用、且平台允许嵌入的播放器地址。当前允许的内嵌域名包括：

- `www.youtube.com`
- `www.youtube-nocookie.com`
- `player.bilibili.com`
- `player.vimeo.com`

示例：

```js
const authorizedPlayers = [
  {
    bangumiId: 400602,
    label: "第 1 集",
    provider: "YouTube",
    embedUrl: "https://www.youtube-nocookie.com/embed/官方视频ID",
  },
];
```

## 使用

### Windows 安装包（推荐）

打包：

```bash
npm install
npm run dist
```

生成文件在 `release/`：

- `anime Setup 1.0.0.exe`：安装版（可装到开始菜单/桌面）
- `anime 1.0.0.exe`：绿色便携版（免安装，双击即用）

### 开发模式运行桌面 App

```bash
npm run app
```

或双击 `启动anime.bat`。

### 网页 / 手机 PWA

```bash
npm start
```

电脑浏览器打开 `http://127.0.0.1:5173/`。

手机（同一 WiFi）打开 `http://电脑局域网IP:5173/`，用 Chrome 菜单「添加到主屏幕」可安装成 PWA。  
手机完整播放依赖电脑上的服务在运行；纯手机离线独立 App 尚未提供。
