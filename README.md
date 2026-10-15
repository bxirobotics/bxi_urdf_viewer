# BXI URDF Viewer

面向 BXI ELF3 的浏览器机器人查看器：选择型号、拖动关节、旋转缩放视角，并显示碰撞几何、关节轴和测量信息。无需安装 ROS2 或启动后端服务。

本项目是 **[Robot Viewer](https://github.com/fan-ziqi/robot_viewer) 的 fork**，原作者为 **范子琦 / Ziqi Fan**。保留上游 [Apache-2.0 许可证](LICENSE)、版权和致谢；原始 README 完整保存在 [README.upstream.md](README.upstream.md)。BXI 的修改记录见 [NOTICE](NOTICE)。

## 使用

- 打开网页默认以正视角加载 ELF3 31 自由度模型；左侧型号菜单支持 29/31 自由度及 Hand 版本。切换型号后同样从正面显示。
- 拖动关节滑块或机器人关节查看姿态；默认遵守 URDF 关节限位。
- 顶部“视觉 / 碰撞”控制外观和碰撞几何显示；关节、结构、编辑面板可独立开关。
- “加载文件夹”可以打开本地 URDF 及其网格；也支持拖入文件夹或选择多个文件。本地文件在浏览器内处理。
- URL 的 `?model=elf3_dof31_hand` 参数可以直接分享指定型号。

**工程检查范围：**这里提供人工姿态和几何检查，不提供自动碰撞报警、最小表面间隙或 CAD 级干涉判定。当前 BXI 模型部分 collision 块被上游注释，不能将“显示碰撞几何”当作完整碰撞检测。

## 本地开发

需要 Node.js 22 及 pnpm 9（项目已固定 pnpm 9.0.0）。

```sh
git clone https://github.com/bxirobotics/bxi_urdf_viewer.git
cd bxi_urdf_viewer
corepack pnpm install --frozen-lockfile
corepack pnpm models:sync
corepack pnpm dev
```

```sh
corepack pnpm test
corepack pnpm build
corepack pnpm preview
```

`build` 会同步模型、构建网页、附带软件许可证和依赖许可文本、排除未核实商用授权的 USD 运行时，并检查 ESA Pages 的文件数量与大小限制。输出为 `dist/`，需通过 HTTP/HTTPS 提供，不能直接双击 HTML。

## 模型同步与加载优化

模型来自官方 [bxi_controller_ros2/resources](https://github.com/bxirobotics/bxi_controller_ros2/tree/main/resources)。每次同步先解析一个上游提交 SHA，所有 URDF 和 STL 均从同一提交下载，并核验 Git blob 哈希，避免混合版本或不完整文件。

- 网页只下载当前选中的型号，不在首屏下载全部模型。
- STL 使用 gzip **无损压缩**，不简化网格、不修改几何精度。浏览器通过 `DecompressionStream` 解压，需使用当前 Chrome、Edge、Firefox 或 Safari。
- 相同内容的文件按哈希去重；浏览器可复用跨型号资源缓存，文件改变后 URL 自动改变。
- 下载最多并行 6 个资源，提供进度、错误和重试状态。
- 模型目录和发布产物不提交到 `main`，生成记录位于 `robots/catalog.json`，其中包含上游提交、原始路径和资源体积。

上游两个 29 自由度版本缺少已引用的 `head_y_link.STL` 与 `head_z_link.STL`。同步脚本仅对这两个已知缺项，从同一提交的对应 31 自由度版本补齐，写入 catalog 的 `repairs` 字段；URDF 关节、尺寸和限位保持原样。其他缺失引用会导致构建失败。

需要复现某个模型快照时，将环境变量 `BXI_MODELS_REF` 设置为 catalog 中的提交 SHA；默认跟踪上游 `main`。本地未认证 GitHub API 有速率限制，可在构建环境提供 `GITHUB_TOKEN`，令牌只用于构建，不进入网页。

## CI 与 ESA Pages

[Build BXI viewer](https://github.com/bxirobotics/bxi_urdf_viewer/actions/workflows/build.yml) 在 `main` 更新、PR、手动触发及每日 **02:00 UTC / 北京时间 10:00** 运行：

1. 安装锁定依赖并运行测试。
2. 下载、校验并无损压缩 BXI 模型，构建完整静态网站。
3. 检查单文件不超过 25 MB、文件数不超过 2,000；同时以未压缩总大小不超过 1,024 MB 作保守包体检查。
4. 上传 `bxi-urdf-viewer` 构建 artifact，可下载为 ZIP。
5. 对 `main` 的成功构建，将网页提交到 **`site` 分支**；PR 不发布。没有变化时不创建新提交。

**推荐 ESA 直接部署 `site` 分支**，无需阿里云构建环境访问 GitHub 下载模型：

| 设置 | 值 |
|---|---|
| GitHub 仓库 | `bxirobotics/bxi_urdf_viewer` |
| 生产分支 | `site` |
| 根目录 | `/` |
| 安装命令 | 留空 |
| 构建命令 | 留空 |
| 静态资源目录 | `./dist` |
| 函数入口 | 留空 |

`site` 分支自带 `esa.jsonc`，已声明跳过安装和构建。首次需在 ESA 控制台授权该仓库并选定生产分支，之后 CI 生成的新提交会触发 ESA 自动部署。请关闭其他分支的预览构建，避免重复构建 `main`。如选择 `main`，根目录的 `esa.jsonc` 也支持完整源码构建，但需要构建环境能够访问 GitHub 和 npm。

官方文档：[GitHub 导入与生产分支](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/connect-pages-to-github)、[构建配置](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/build-pages)、[当前平台限制](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/what-is-functions-and-pages/)。ESA 的服务额度、费用和域名接入条件以账号所选服务条款为准；软件许可证不涵盖托管服务费用或授权。

## 版权与商业使用

- **查看器软件**：上游 Robot Viewer 为 Apache-2.0；保留原许可证、作者署名与相关声明，修改文件标记 BXI 变更。分发包包含 `LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.txt`。[官方许可条款](https://www.apache.org/licenses/LICENSE-2.0)
- **依赖**：当前锁定的生产 npm 依赖声明为 MIT、ISC、BSD-3-Clause、Apache-2.0、Unlicense。构建会附带安装包中可找到的许可证及 NOTICE 文本，不代表替上游担保所有来源和知识产权。
- **USD**：上游包含 needle-tools USD 相关资源；其当前官方项目采用 [PolyForm Noncommercial 1.0.0](https://github.com/needle-tools/usd-viewer/blob/main/LICENSE.txt)。本 fork 中已有二进制快照的具体商用授权未核实，因此部署包排除该运行时并禁用 USD 加载。此限制不影响本项目需要的 URDF。
- **BXI URDF/STL**：模型版权和许可独立于查看器。源仓库目前未声明统一模型许可证；对外分发、客户交付前由模型权利方明确授权，不能因为公开可下载就推定可以任意使用。

## 上游致谢

感谢原作者 **范子琦 / Ziqi Fan** 及 Robot Viewer 社区。保留上游对 [urdf-loader](https://github.com/gkjohnson/urdf-loaders)、[xacro-parser](https://github.com/gkjohnson/xacro-parser)、[mujoco_wasm](https://github.com/zalo/mujoco_wasm)、[usd-viewer](https://github.com/needle-tools/usd-viewer)、[mechaverse](https://github.com/jurmy24/mechaverse) 的致谢。原上游说明亦记载部分工作借助 Cursor 完成，详见归档 README。
