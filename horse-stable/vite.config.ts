import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const musicDir = path.join(rootDir, 'music');

const AUDIO_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

function musicStaticPlugin(): Plugin {
  return {
    name: 'horse-stable-music',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith('/music/')) {
          next();
          return;
        }
        const rel = decodeURIComponent(url.slice('/music/'.length));
        const file = path.join(musicDir, rel);
        if (!file.startsWith(musicDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          next();
          return;
        }
        const ext = path.extname(file).toLowerCase();
        res.setHeader('Content-Type', AUDIO_TYPES[ext] ?? 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (!fs.existsSync(musicDir)) return;
      const out = path.join(rootDir, 'dist', 'music');
      fs.mkdirSync(out, { recursive: true });
      for (const name of fs.readdirSync(musicDir)) {
        if (/\.(mp3|ogg|wav|m4a)$/i.test(name)) {
          fs.copyFileSync(path.join(musicDir, name), path.join(out, name));
        }
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [musicStaticPlugin()],
  server: {
    host: '0.0.0.0',
  },
  preview: {
    host: '0.0.0.0',
  },
});
