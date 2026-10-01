import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 的项目站点地址形如 https://<用户名>.github.io/<仓库名>/，
// 也就是网页并不在域名根目录下。这里把资源基路径设成相对路径（'./'），
// 产物引用 JS/CSS 时不依赖仓库名，本地预览、用户主页站点、项目站点都能直接用。
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
});
