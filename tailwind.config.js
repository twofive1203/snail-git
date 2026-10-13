/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        jb: {
          bg: '#1E1F22',           // 基础背景
          panel: '#2B2D30',        // 面板工具栏背景
          card: '#26282B',         // 卡片容器背景
          border: '#393B40',       // 标准边框
          borderHover: '#4E5157',  // 悬浮边框
          selected: '#2E436E',     // 选中项背景蓝
          selectedText: '#DFE1E5', // 选中项高亮文字
          hover: '#35373C',        // 悬浮背景
          active: '#3E4147',       // 激活背景
          blue: '#3574F0',         // JetBrains 核心主色
          blueHover: '#4682F7',    // 核心主色悬浮
          green: '#59A869',        // Added / Staged 绿色
          red: '#E35967',          // Deleted / Conflict 红色
          orange: '#EDA200',       // Warning / Modified 次级黄橙
          purple: '#B388FF',       // Feature 分支轨专用紫
          cyan: '#29B6F6',         // Release 分支专用青
          text: {
            primary: '#DFE1E5',    // 一级主文本
            secondary: '#9DA0A8',  // 二级淡文本
            muted: '#6F737A',      // 三级辅助弱文本
            code: '#BCBEC4',       // 代码/正文字体
          }
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'Fira Code', 'monospace'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
