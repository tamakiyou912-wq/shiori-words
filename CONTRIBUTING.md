# Contributing

感谢你改进詞織。

1. Fork 仓库并从 `main` 创建短分支。
2. 保持功能范围轻量；新增复杂依赖前请先开 Issue 说明收益。
3. UI 修改必须遵守 `design.md`，不要引入渐变、玻璃拟态、营销首屏或卡片堆叠。
4. 不要提交 `.env`、API Key、数据库、用户数据或日志。
5. 提交前运行：

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Pull Request 请简要说明用户影响、测试方式和必要的截图。涉及词典数据时，必须写清来源、许可证和署名方式。
