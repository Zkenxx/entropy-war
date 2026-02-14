import { defineConfig } from 'vite'

export default defineConfig({
  base: './', // 确保相对路径正确
  build: {
    outDir: 'dist' // 输出目录
  }
})
