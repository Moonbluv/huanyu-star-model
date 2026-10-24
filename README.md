# 环域星体模型

《黑色巨塔》的三维星体模型：日月绕塔、塔影与过影、玄阙、各地的天象和第一人称视角。

## 打开

页面是一个文件：`环域星体模型.html`，双击就能在浏览器里打开。

- 要联网：三维引擎 three.js 从 cdnjs 和 jsdelivr 加载，断网时页面会是空白。
- 浏览器要开着硬件加速（WebGL）。

在 Mac 上：

```bash
git clone https://github.com/Moonbluv/huanyu-star-model.git
cd huanyu-star-model
open 环域星体模型.html
```

## 重新构建

源码、规格和测试在 `_构建工具/环域星体模型/`（Windows 上原本放在小说库的 `🗺️ 互动地图/` 下面，目录结构照搬）。改完源码后：

```bash
cd _构建工具/环域星体模型
python3 build.py        # Windows 上用 py build.py
```

构建结果写回仓库根目录的 `环域星体模型.html`。测试截图（原库里约 1.3GB）没有放进这个仓库。
