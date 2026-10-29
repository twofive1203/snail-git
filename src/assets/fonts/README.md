# 内置字体

两个可变字体都是 latin 子集，随应用打包，运行时不请求 Google Fonts CDN。

| 文件 | 字体 | 来源 | 许可 |
| --- | --- | --- | --- |
| `inter-var.woff2` | Inter 400–700 | <https://github.com/rsms/inter> | OFL-1.1，见 `OFL-Inter.txt` |
| `jetbrains-mono-var.woff2` | JetBrains Mono 400–700 | <https://github.com/JetBrains/JetBrainsMono> | OFL-1.1，见 `OFL-JetBrainsMono.txt` |

`@font-face` 声明在 `src/index.css`。中文不在这两个字体里，仍按 `tailwind.config.js` 的
`fontFamily` 回退到系统字体。

换字体时保留 `OFL-*.txt`，OFL 要求随字体一起分发许可文本。
