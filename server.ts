// Custom server: Next.js pages/API + Socket.IO (online PvP rooms) on one port.
import { createServer } from 'node:http';
import next from 'next';
import { Server } from 'socket.io';
import { getBundle } from './src/server/content';
import { allowSocketRequest, attachRooms, MAX_PACKET_BYTES, type RoomServer } from './src/server/rooms';

const port = Number(process.env.PORT || 3000);
const dev = process.env.NODE_ENV !== 'production';

const httpServer = createServer((req, res) => {
  void handle(req, res);
});
const app = next({ dev, port, httpServer });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Starts loading CMS content from Firestore (needs the .env Next.js has just loaded).
  void getBundle();
  // destroyUpgrade:false leaves Next's own websocket upgrades (dev HMR) alone.
  const io: RoomServer = new Server(httpServer, { path: '/socket.io', destroyUpgrade: false, maxHttpBufferSize: MAX_PACKET_BYTES, allowRequest: allowSocketRequest });
  attachRooms(io);
  httpServer.listen(port, () => {
    console.log(`> Đại Chiến Lô Nhô: http://localhost:${port} (${dev ? 'development' : 'production'})`);
  });
});
