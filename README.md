# NJU AutoLogin - 南大统一认证自动登录

Chrome 扩展，自动识别验证码并登录南京大学统一身份认证平台。

## 技术特点

- **完全离线运行** — 验证码识别在本地完成，无需调用任何外部 API，无网络延迟，无隐私泄露风险
- **WASM 本地推理** — 基于 [onnxruntime-web](https://onnxruntime.dev/) 的 WASM 后端，在浏览器内运行 ONNX 模型推理，首次加载约 3-5 秒，后续识别毫秒级
- **ddddocr 模型兼容** — OCR 模型与 Python [ddddocr](https://github.com/sml2h3/ddddocr) 使用同一模型文件。
- **CTC 解码** — 输出经 argmax + CTC 解码，映射 8210 字符集，支持中文验证码
- **Manifest V3** — 使用 Chrome 最新的 MV3 扩展架构，Service Worker + Offscreen Document 运行推理

## 安装

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择 `extension` 文件夹

## 使用教程

### 首次配置

1. 打开扩展 Popup（点击工具栏扩展图标）
2. 填入学号/用户名和密码（自动保存）
3. （推荐）勾选 **页面加载时自动登录**

### 一键登录（默认）

1. 访问任意南大认证页面（如 `authserver.nju.edu.cn/authserver/login`）
2. 点击扩展图标 → 点击 **一键登录**
3. 扩展会自动：切换到账号登录 → 填入用户名密码 → 识别验证码 → 填入验证码 → 点击登录

### 全自动登录

1. 在 Popup 中勾选 **页面加载时自动登录**
2. 之后每次访问认证页面，扩展会自动执行上述全部步骤，无需手动操作

### 测试识别

1. 点击 Popup 右上角 **设置** 进入设置页
2. 点击 **测试识别**，可单独测试验证码识别效果

## 注意事项

- 所有设置自动保存，无需手动点击保存
- 首次识别较慢（需加载 ONNX 模型，约 3-5 秒），后续识别很快
- 验证码识别基于 OCR 模型，准确率约 90%，偶有识别错误属正常
- 密码以明文存储在 `chrome.storage.local`，仅供本地使用，不会上传
- 如验证码识别错误，可刷新页面获取新验证码后重试

## 开发计划

- [ ] **多账号管理** — 支持保存多个账号，Popup 中快速切换当前登录账号
- [ ] **验证码失败自动重试** — 登录失败时自动刷新验证码并重试，可设置最大重试次数
- [ ] **密码加密存储** — 使用 Chrome 加密 API 替代明文存储，提升安全性

## 项目结构

```
extension/
├── manifest.json       # 扩展配置
├── background.js       # Service Worker，协调登录流程
├── content.js          # 内容脚本，操作页面 DOM
├── popup.html/js       # 弹窗界面（主页 + 设置页）
├── offscreen.html/js   # 离屏文档，运行 ONNX 推理
├── ocr.js              # OCR 引擎（预处理 + 推理 + CTC 解码）
├── models/
│   ├── common.onnx     # ONNX 识别模型
│   └── charset.json    # 字符集
└── lib/                # onnxruntime-web
```

## License

本项目基于 [GPL v3](LICENSE) 许可证开源。
