require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const roomRoutes = require('./routes/rooms');
const messageRoutes = require('./routes/messages');
const uploadRoutes = require('./routes/upload');
const postRoutes = require('./routes/posts');
const gameRoutes = require('./routes/game');
const setupChatSocket = require('./socket/chatSocket');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/js', express.static(path.join(__dirname, '..', 'frontend', 'js'), {
  maxAge: 0, etag: true, lastModified: true,
  setHeaders: function(res) { res.setHeader('Cache-Control', 'no-cache, must-revalidate'); }
}));
app.use('/css', express.static(path.join(__dirname, '..', 'frontend', 'css'), {
  maxAge: 0, etag: true, lastModified: true,
  setHeaders: function(res) { res.setHeader('Cache-Control', 'no-cache, must-revalidate'); }
}));
app.use(express.static(path.join(__dirname, '..', 'frontend'), { maxAge: '1d', etag: true }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/game', gameRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found' });
  const htmlFiles = ['login', 'register', 'profile', 'room', 'posts', 'user', 'game'];
  const requestedPage = req.path.replace('/', '').replace('.html', '');
  if (htmlFiles.includes(requestedPage)) {
    return res.sendFile(path.join(__dirname, '..', 'frontend', requestedPage + '.html'));
  }
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.set('io', io);
setupChatSocket(io);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
      console.log('🚀 Server running on port ' + PORT);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });