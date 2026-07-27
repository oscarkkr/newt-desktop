# 新T树洞桌面端

轻量的 macOS 新T树洞客户端。界面使用原生 HTML/CSS/JavaScript，网络、安全
存储和离线缓存由 Rust/Tauri 负责，不需要 Node.js。

## 功能

- 时间线、热门排序、分区筛选和分页
- 全文搜索及高级语法透传，一次自动抓取全部分页后统一排序
- 帖子详情和完整评论
- 正文图片预览、点击放大
- 正文与评论 Markdown 显示，支持标题、强调、链接、列表、引用、代码和表格
- 内容预警帖子默认隐藏，点击后才加载正文、图片、投票和引用
- 正文中任意位置的 `#帖子号` 都会显示缩进引用预览，并可点击跳转原帖
- 投票选项、提交投票和结果比例展示
- 发帖、评论、指定昵称回复、线上关注
- 线上关注、本地收藏和离线查看独立入口；关注后自动收藏，取消关注保留本地收藏
- App 内 GitHub 登录，树洞 Token 存入 macOS 钥匙串
- 启动时自动检查 GitHub Release，设置页也可手动检查；更新包经数字签名验证
- 登录失效时自动提示重新授权
- SQLite 离线缓存与断网回退
- 浏览器 User-Agent、异常 JSON、403/422 和 HTML 错误页容错
- 北京时间显示

## 首次使用

1. 启动应用，打开“设置”。
2. 点击“使用 GitHub 登录”，在独立窗口中完成授权。
3. 授权成功后窗口会自动关闭，应用随即载入时间线。

GitHub 账户需要先添加清华邮箱或校友邮箱。App 不会接触 GitHub 密码；
树洞 Token 等同于登录态，请勿分享。应用不会把它写进配置文件或日志。

## 目录

```text
src-tauri/  Rust/Tauri 核心
web/        桌面界面
scripts/    构建与打包脚本
docs/       技术资料
release/    按版本和平台整理的发布产物
```

## 构建

```bash
cargo test --workspace
./scripts/package_macos.sh
open "release/v0.7.0/macos-arm64/新T树洞.app"
```

当前发布包为 Apple Silicon (`arm64`) macOS 版本。首次打开未经公证的本地
构建时，可能需要在“系统设置 → 隐私与安全性”确认。

## 自动更新与发布

从 `v0.7.0` 开始，App 会读取本仓库最新 GitHub Release 的 `latest.json`。
发现新版本时由用户确认下载，安装前必须通过 Tauri 更新签名校验。

推送与 `src-tauri/tauri.conf.json` 版本一致的 `v*` 标签后，GitHub Actions
会自动构建 Apple Silicon 安装包、签名更新包并发布 Release。仓库需要配置：

- `TAURI_SIGNING_PRIVATE_KEY`：受密码保护的加密私钥
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：私钥密码

私钥绝不能提交到仓库。当前维护机器的加密备份位于
`~/.tauri/newt-desktop.key`，密码保存在 macOS 钥匙串服务
`app.newt.desktop.updater` 中。丢失任一项都会导致已安装版本无法升级。
