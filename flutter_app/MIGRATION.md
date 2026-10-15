# Flutter 正式版迁移记录

当前版本：1.6.4（Android versionCode 37）。Android 使用原包名 `com.anime.standalone` 与原上传证书；Windows 程序为 `anime.exe`。正式构建不再使用预览包名、预览标题或调试证书。

## 1.6.4 调整

每日更新按星期筛选，默认今天；规则仓库区分未安装、已安装、可更新并提供批量安装 / 更新。片源检测为手动搜索检测，最多两个并行请求，离开页面即取消。竖屏全屏按钮保持可用，竖屏控制层停留 8 秒；全屏默认手动隐藏，可选 15 秒自动收起，拖动期间不隐藏、松手后才提交定位；全屏渐变界面和深色选集面板。设置不再显示开源许可入口，依赖许可文件继续随包分发。

## 验证体验修复

图片验证码恢复为当前页面上的原生输入弹窗，复用同一 WebView Cookie 环境；需操作原站的验证也在弹窗内完成。验证后重试原搜索、剧集或播放请求，关闭返回原页面。验证码错误、刷新、取消、页面加载失败均不会计为验证成功。

## 功能

- 每日更新与星期切换、目录搜索、详情；Android 底部导航、Windows 自适应侧栏。发现页不显示特摄入口，旧观看记录的来源解析兼容保留。
- 未收藏 / 想看 / 在看 / 看过；Bangumi Token 登录、收藏与已看集数同步，保留未上传的本地修改、较新的本地状态和本机删除标记，不重复上传同一集。
- SQLite 本地收藏、观看记录和设置；新旧备份导入导出、合并及恢复前快照。
- WebDAV 连接测试、独立时间戳备份、读取预览与确认恢复；凭据使用设备安全存储，不进入备份。
- XPath / JSON API 片源、旧内置来源兼容、规则仓库安装更新、文件 / 链接 / JSON 导入、新建编辑、停用、移除与分享。
- 原生 libmpv 播放、请求头与网站 Cookie、必要时短时 WebView 解析及人工网站验证；退出、后台和切集取消解析，不常驻解析页面。
- 全屏旋转保留同一视频组件；全屏选集与线路、左侧锁定、圆形 +85 秒、顶部 48 dp 系统手势避让、倍速、外部字幕、音轨、画面比例、音量 / 亮度手势、长按 2 倍速、Windows 键盘操作。
- 观看记录续播、旧版集数和位置兼容、云端已看集数定位、自动下一集；每 15 秒保存，暂停和离开时补存。隐藏控制层不持续刷新进度界面；通知栏短暂失焦保持播放，真正后台暂停；来电或拔出耳机时暂停。
- 六套独立浅 / 深色配色，浅色默认蓝色、深色默认粉色；可关闭开屏或选择自定义启动图；Android 系统启动过渡使用透明图标。
- Windows 局域网手机观看：每次开启生成新连接码，仅接受本机 / 私有 IPv4；同源校验、无密钥拒绝访问。支持搜索、收藏、选集、HLS / 文件代理与进度保存，关闭立即失效。播放器脚本随应用打包，不依赖第三方 CDN 加载。
- 正式更新检查及发布页入口。下载通过系统浏览器，安装由系统确认；没有新增应用内安装权限。

## 升级与数据

Android 同包同签名覆盖安装，原 WebView 数据保留。首次启动会从原 `https://localhost` 存储读取收藏、观看记录、规则与外观，账户凭据迁入安全存储；失败会提示，可在设置重试或导入旧版备份。迁移过程不删除原存储。覆盖安装前可先导出旧版备份留作恢复副本。

Windows 原版使用 Electron 存储，新版使用 SQLite；请从旧版导出 anime 备份后在新版设置中导入。原目录不自动删除。预览版使用独立应用身份，其数据也可通过导出 / 导入转移。

## 构建与检查

Flutter 3.47.7 / Dart 3.13.5；依赖固定在 pubspec.lock。Android API 36、NDK 28.2.13676358，正式 APK 包含 ARM64 与 ARMv7。Windows 需要 Visual Studio C++ 桌面组件、NuGet 6.14.0 与 WebView2 Runtime。WebView 固定 6.2.0-beta.3，以兼容 AGP 9；仅对该 Windows 插件启用旧 coroutine 兼容定义。

仓库根执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-flutter.ps1
powershell -ExecutionPolicy Bypass -File scripts/build-flutter-windows.ps1 -Target android
powershell -ExecutionPolicy Bypass -File scripts/build-flutter-windows.ps1 -Target windows
```

本机构建脚本在 NTFS 暂存，临时盘符避开 Unicode 路径和 F 盘符号链接限制，结束时恢复环境。签名值优先从 ANIME_* 构建环境读取；兼容使用现有签名配置，不新增硬编码签名密码或把证书放进 APK 资源。Linux CI 使用 `python scripts/build-flutter-android.py --no-pub`。

输出在 `release/1.6.4/`：`app-release.apk`、`anime-1.6.4-windows-x64.zip` 与完整 Windows 目录。Windows 包含 app-local Visual C++ 运行库；解压后运行 anime.exe，必须保留 DLL 与 data 文件夹。`npm start` / `npm run app` 启动此正式原生程序；旧服务保留为 legacy 脚本，不打入原生安装包。

## 发布

`.github/workflows/app-release.yml` 检查版本、运行测试并分别构建 Android / Windows。新 v* 标签只有在两端成功后才创建 GitHub Release，附带 APK、Windows ZIP 与 SHA-256 校验文件；遇到已有 Release 拒绝覆盖。

按 AGENTS.md，提交推送时必须同步 package / lock 根版本、Android、Flutter pubspec、update.json 与新版本标签。不得复用标签。v1.6.4 发布流程构建 Android 和 Windows，并在两端成功后上传安装包至 GitHub Release。

## 验证边界

本地回归覆盖备份事务、同步冲突与请求头、云端进度、WebDAV、局域网访问校验与 HLS 代理、旧规则与原生媒体解析，以及 320 / 393 / 1280 宽度下的界面。可选 libmpv FFI 测试验证本地与 HTTP 媒体打开、定位、请求头和释放。

本次正式构建通过 63 项 Flutter 回归测试、36 项旧功能测试与单独启用的 1 项原生播放器 FFI 测试；静态分析无问题。Windows 可执行文件版本已核对为 1.6.4+37，安装包目录包含播放器、SQLite、界面资源及 C++ 运行库。APK 签名与原上传证书一致，包名为 com.anime.standalone。

尚未连接 Android 真机，不能声称已经测量实际帧率、温升、耗电，或验证每个网站 / 验证码的实时可用性。WebView 依赖仍为预发布组件，需要在实际设备验证。

全局允许明文 HTTP 的设置未启用，自动审批拒绝了这一范围过大的设置。仅 HTTP 的来源在 Android 上可能不可用；未关闭 TLS 证书校验。
