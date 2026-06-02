/// <reference types="vitest" />
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  base: '/polar-to-strava-fit/',
  plugins: [svelte(), tailwindcss()],
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@validate': path.resolve(__dirname, 'src/validate'),
      $lib: path.resolve(__dirname, 'src/webapp/lib'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
