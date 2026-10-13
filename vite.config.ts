import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 60606,
    strictPort: true,
    host: true,
    watch: {
      // 忽略 src-tauri 及其编译产物 target 目录，防止 Windows 独占锁 EBUSY 报错
      ignored: ['**/src-tauri/**']
    }
  }
});
