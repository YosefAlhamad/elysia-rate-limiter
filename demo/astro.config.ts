import react from '@astrojs/react'
import { defineConfig } from 'astro/config'

export default defineConfig({
  integrations: [react()],
  vite: { server: { fs: { allow: ['..'] } } },
})
