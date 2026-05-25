const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Guardar los cuartos activos: { roomCode -> { pc: socketId, phone: socketId } }
const rooms = {};

// Obtener IP local del servidor
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
  res.json({ 
    status: 'ok', 
    rooms: Object.keys(rooms).length,
    ip: getLocalIP()
  });
});

io.on('connection', (socket) => {
  console.log(`[+] Cliente conectado: ${socket.id}`);

  // PC crea un cuarto con un código único
  socket.on('create-room', ({ code, role }) => {
    rooms[code] = rooms[code] || {};
    rooms[code][role] = socket.id;
    socket.join(code);
    console.log(`[ROOM] ${role} unido al cuarto ${code}`);
    
    // Avisar si ya hay dos participantes
    if (rooms[code].pc && rooms[code].phone) {
      io.to(code).emit('room-ready', { 
        code,
        message: 'Ambos dispositivos conectados. Iniciando WebRTC...'
      });
    }
  });

  // Telefono se une al cuarto con el codigo que escaneó del QR
  socket.on('join-room', ({ code, role }) => {
    if (!rooms[code]) {
      socket.emit('error', { message: 'Código inválido o expirado.' });
      return;
    }
    rooms[code][role] = socket.id;
    socket.join(code);
    console.log(`[ROOM] ${role} unido al cuarto ${code}`);

    // Avisar a todos en el cuarto que ya están listos
    io.to(code).emit('room-ready', {
      code,
      message: 'Ambos dispositivos conectados. Iniciando WebRTC...'
    });
    
    // Obtener info del dispositivo si la envía
    const room = rooms[code];
    io.to(code).emit('peer-info', { role, socketId: socket.id });
  });

  // ============================================
  // SEÑALIZACIÓN WEBRTC (Offer, Answer, ICE)
  // ============================================

  // PC envía su "oferta" de video al teléfono
  socket.on('webrtc-offer', ({ code, sdp }) => {
    console.log(`[WebRTC] Offer enviado en cuarto ${code}`);
    socket.to(code).emit('webrtc-offer', { sdp });
  });

  // Teléfono responde la "oferta" de la PC
  socket.on('webrtc-answer', ({ code, sdp }) => {
    console.log(`[WebRTC] Answer enviado en cuarto ${code}`);
    socket.to(code).emit('webrtc-answer', { sdp });
  });

  // Intercambio de rutas ICE (necesario para encontrarse en la red)
  socket.on('ice-candidate', ({ code, candidate }) => {
    socket.to(code).emit('ice-candidate', { candidate });
  });

  // Un dispositivo se desconectó
  socket.on('disconnect', () => {
    // Buscar en qué cuarto estaba y notificar al otro
    for (const code in rooms) {
      const room = rooms[code];
      if (room.pc === socket.id || room.phone === socket.id) {
        console.log(`[-] Dispositivo desconectado del cuarto ${code}`);
        io.to(code).emit('peer-disconnected', { 
          message: 'El otro dispositivo se desconectó.' 
        });
        delete rooms[code];
        break;
      }
    }
    console.log(`[-] Cliente desconectado: ${socket.id}`);
  });
});

const PORT = 3001;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n======================================');
  console.log('  ScreenCast Pro - Servidor WebRTC');
  console.log('======================================');
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  En tu red: http://${ip}:${PORT}`);
  console.log('======================================');
  console.log('  Usa la IP de red en la app del');
  console.log('  telefono para conectarse.');
  console.log('======================================\n');
});
