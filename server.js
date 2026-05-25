const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const rooms = {};

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: Object.keys(rooms).length });
});

io.on('connection', (socket) => {
  console.log(`[+] Cliente conectado: ${socket.id}`);

  socket.on('create-room', ({ code, role }) => {
    rooms[code] = rooms[code] || {};
    rooms[code][role] = socket.id;
    socket.join(code);
    console.log(`[ROOM] ${role} unido al cuarto ${code}`);
    if (rooms[code].pc && rooms[code].phone) {
      io.to(code).emit('room-ready', { code, message: 'Ambos dispositivos conectados.' });
    }
  });

  socket.on('join-room', ({ code, role }) => {
    if (!rooms[code]) { socket.emit('error', { message: 'Código inválido o expirado.' }); return; }
    rooms[code][role] = socket.id;
    socket.join(code);
    console.log(`[ROOM] ${role} unido al cuarto ${code}`);
    io.to(code).emit('room-ready', { code, message: 'Ambos dispositivos conectados.' });
    io.to(code).emit('peer-info', { role, socketId: socket.id });
  });

  socket.on('webrtc-offer', ({ code, sdp }) => { socket.to(code).emit('webrtc-offer', { sdp }); });
  socket.on('webrtc-answer', ({ code, sdp }) => { socket.to(code).emit('webrtc-answer', { sdp }); });
  socket.on('ice-candidate', ({ code, candidate }) => { socket.to(code).emit('ice-candidate', { candidate }); });
  socket.on('stop-room', ({ code }) => { io.to(code).emit('peer-disconnected', {}); delete rooms[code]; });

  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      if (room.pc === socket.id || room.phone === socket.id) {
        socket.to(code).emit('peer-disconnected', { message: 'El otro dispositivo se desconectó.' });
        delete rooms[code];
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`ScreenCast Server corriendo en puerto ${PORT}`);
});

setInterval(() => {
  const https = require('https');
  https.get('https://screencast-server.onrender.com/health', () => {}).on('error', () => {});
}, 14 * 60 * 1000);
