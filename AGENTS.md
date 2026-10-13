# 发布约定

用户要求：今后提交并推送变更时，同时发布 GitHub Release，不只上传 Actions Artifact。发布时同步 package.json、package-lock.json 根版本、Android versionName/versionCode 和 update.json，推送新的 v* 标签，确认构建成功且 Release 含 APK。不得覆盖已有版本标签。

界面保持简洁，参考用户提供的 Kazumi 风格。不要重新添加项目根 README.md。
