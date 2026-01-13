import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite configuration for the Amazon Hub Brain frontend.  The
// development server runs on port 3000 and the React plugin is
// enabled.  No special proxy is configured; API requests should
// include the appropriate host and port (e.g. http://localhost:3001).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  }
});