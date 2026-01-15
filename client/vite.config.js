import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite configuration for the Amazon Hub Brain frontend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  },
  build: {
    // Increase chunk size warning limit slightly (default is 500)
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching and smaller initial load
        manualChunks: {
          // Vendor chunks - split large dependencies
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-polaris': ['@shopify/polaris'],
        },
      },
    },
  },
});
