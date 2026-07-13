# 安卓独立版（不依赖电脑）

手机安装后，搜索 / 片源解析 / 播放都在手机本地完成，**不需要电脑开机**。

## 能力说明

| 功能 | 安卓独立版 |
|------|------------|
| 动漫搜索（Bangumi） | ✅ |
| 特摄（Tokuzilla） | ✅ |
| 内置片源（稀饭 / 咕咕 / Omofun） | ✅ |
| 继续观看进度 | ✅（存在手机本地） |
| Miru 扩展（视频类） | ✅ 手机本地安装与使用 |
| 蜜柑 BT | ❌ 暂不支持 |
| 局域网扫码 | 不需要 |

部分站点可能屏蔽手机 IP，个别片源会播不了，可换线路或原站嵌入。

## 生成 APK（推荐用 Android Studio）

### 1. 安装环境
- [Node.js 20+](https://nodejs.org/)
- [Android Studio](https://developer.android.com/studio)（安装时勾选 Android SDK）

### 2. 在项目目录执行

```powershell
cd E:\番
npm install
npm run android:open
```

会自动：
1. 打包网页资源到 `android-www`
2. 同步到 Capacitor Android 工程
3. 打开 Android Studio

### 3. 在 Android Studio 里
1. 等待 Gradle 同步完成
2. 菜单 **Build → Build Bundle(s) / APK(s) → Build APK(s)**
3. 生成的安装包一般在：

`android/app/build/outputs/apk/debug/app-debug.apk`

拷到手机安装即可（需允许「未知来源」）。

### 命令行构建（已配置 SDK 时）

```powershell
npm run android:build
```

## 常用命令

```powershell
npm run android:www     # 只刷新网页资源
npm run android:sync    # 刷新并同步到 android/
npm run android:open    # 同步并打开 Android Studio
```

改了前端代码后，重新执行 `npm run android:sync`，再到 Android Studio 重新 Run / Build。
