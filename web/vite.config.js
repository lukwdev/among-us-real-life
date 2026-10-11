import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react()],
	server: {
        allowedHosts: true,
		proxy: {
			// Proxy Socket.IO websocket and polling to the Node server
			'/socket.io': {
				target: 'http://localhost:4046',
				changeOrigin: true,
				ws: true
			},
			'/api': {
				target: 'http://localhost:4046',
				changeOrigin: true
			}
		}
	}
});
