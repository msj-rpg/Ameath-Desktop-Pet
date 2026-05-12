<p align="center">
  <img src="src/gifs/ameath.gif" width="200" />
</p>

<h1 align="center">Ameath Desktop Pet</h1>

<p align="center">
  "爱弥斯"
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-blue?logo=tauri" />
  <img src="https://img.shields.io/badge/Rust-2021-orange?logo=rust" />
  <img src="https://img.shields.io/badge/Platform-macOS%20|%20Windows-green" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" />
</p>

---

## 致谢

本项目是 [**lzy-buaa-jdi/ameath**](https://gitee.com/lzy-buaa-jdi/ameath) 的 **Tauri v2 跨平台移植版**。

原版由 **lzy-buaa-jdi** 使用 Python (Pillow + pystray) 开发，仅支持 Windows。本项目参考了原版的运动逻辑、动画资源和交互设计，使用 Tauri v2 + Rust + JavaScript 完全重写，实现 macOS & Windows 跨平台支持。

> GIF 素材来源：B站UP [@\_BLZ\_](https://b23.tv/LOWldqI)
>
> 原版介绍视频：[【我制作了飞行雪绒可爱桌宠！】](https://www.bilibili.com/video/BV12rcMznEcG)

## 预览

<p align="center">
  <img src="src/gifs/ameath_content.png" width="520" />
</p>

## 功能

- 🐾 **自由游荡** — 宠物在桌面自主移动，带有惯性、随机目标和边缘反弹/重生
- 🪟 **窗口贴靠** — 检测前台窗口并主动寻找，趴在窗口顶部（可配置开关和寻找周期）
- 🖱️ **鼠标交互** — 跟随鼠标模式 / 好奇模式（注视光标）/ 拖拽（关闭穿透后）
- 🎭 **丰富动画** — GIF 逐帧渲染，包含移动、待机 (×4)、屏幕互动 (×7)、拖拽等多套动画
- 🔊 **语音 & 音乐** — 拖拽/游荡时随机触发语音，内置待机小曲，支持自定义音频文件
- 😴 **待机模式** — 检测系统空闲时间，自动切换到待机动画和音乐
- 🖥️ **跨屏游荡** — 支持多显示器间自由移动
- ⚙️ **完整设置面板** — 缩放、透明度、速度、显示优先级、开机自启等全部可配置
- 📌 **系统托盘** — 右键托盘可快捷切换暂停/跟随/穿透/隐藏/设置/退出

## 技术架构

```
src/                    # 前端
├── index.html          # 主窗口（Canvas 渲染）
├── settings.html       # 设置面板
├── ameath.js           # 核心引擎（移动、动画、交互、窗口贴靠）
├── gif-parser.js       # 纯 JS GIF 二进制解码器（LZW、逐帧延迟、交错扫描）
├── music-player.js     # 音乐播放器
├── gifs/               # GIF 动画资源
└── sound/              # 语音 & 音乐资源

src-tauri/              # Rust 后端
├── src/main.rs         # Tauri 命令、托盘、窗口管理
├── src/config.rs       # 配置持久化（JSON）
├── src/macos.rs        # macOS 原生 API（CGEvent、CGWindowList）
└── src/windows.rs      # Windows 原生 API（GetCursorPos、EnumWindows）
```

### 核心设计

| 模块 | 实现 |
|------|------|
| 渲染 | Canvas 逐帧绘制，自带 GIF 解码器（非 `<img>` 标签），支持翻转和缩放 |
| 移动 | 惯性物理 + 随机目标 + 抖动，模拟自然的游荡行为 |
| 窗口贴靠 | 轮询前台窗口位置，以可配置间隔概率性寻找窗口并趴上去 |
| 鼠标位置 | macOS: CGEvent / Windows: GetCursorPos（Tauri 窗口坐标无法获取全局位置） |
| 音频 | Web Audio API 解码 + 播放，支持 WAV / MP3 / OGG / FLAC |
| 配置 | Rust 端 JSON 文件持久化，前端通过 Tauri invoke 读写 |

## 安装 & 运行

### 前置依赖

- [Node.js](https://nodejs.org/) ≥ 18
- [Rust](https://www.rust-lang.org/tools/install) ≥ 1.70
- [Tauri v2 CLI](https://v2.tauri.app/start/prerequisites/)

macOS 额外需要 Xcode Command Line Tools：
```bash
xcode-select --install
```

Windows 额外需要 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 和 [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)。

### 开发模式

```bash
npm install
npm run dev
```

### 构建发布包

```bash
npm run build
```

构建产物在 `src-tauri/target/release/bundle/` 下：
- macOS → `.dmg` / `.app`
- Windows → `.msi` / `.exe`

## 配置文件

配置自动保存在系统配置目录：
- macOS: `~/Library/Application Support/ameath_config.json`
- Windows: `%APPDATA%/ameath_config.json`

自定义音频文件放置在：
- macOS: `~/Library/Application Support/ameath/voice/` 和 `ameath/music/`
- Windows: `%APPDATA%/ameath/voice/` 和 `ameath/music/`

## 自定义语音 & 音乐

1. 打开设置面板 → 语音管理 / 音乐管理
2. 点击 **添加** 选择音频文件（WAV / MP3 / OGG / FLAC）
3. 为语音文件绑定触发场景（拖拽、游荡等）
4. 音乐文件可在待机模式下播放

## 跨平台支持

| 功能 | macOS | Windows |
|------|:-----:|:-------:|
| 桌面游荡 & 动画 | ✅ | ✅ |
| 鼠标跟随 / 好奇模式 | ✅ | ✅ |
| 窗口贴靠 | ✅ | ✅ |
| 系统空闲检测 | ✅ | ✅ |
| 透明度调节 | ✅ | ✅ |
| 系统托盘 | ✅ | ✅ |
| 多桌面显示 | ✅ | — |
| 开机自启 | ✅ | ✅ |

## License

MIT License — 详见 [LICENSE](LICENSE) 文件。

原版项目同样采用 MIT 协议。
