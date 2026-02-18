require('dotenv').config();
var express = require('express');
var http = require('http');
var { Server } = require('socket.io');
var mongoose = require('mongoose');
var cors = require('cors');
var path = require('path');

var authRoutes = require('./routes/auth');
var userRoutes = require('./routes/users');
var roomRoutes = require('./routes/rooms');
var messageRoutes = require('./routes/messages');
var uploadRoutes = require('./routes/upload');
var postRoutes = require('./routes/posts');
var gameRoutes = require('./routes/game');
var setupChatSocket = require('./socket/chatSocket');

var app = express();
var server = http.createServer(app);

var io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/js', express.static(path.join(__dirname, '..', 'frontend', 'js'), {
  maxAge: 0,
  etag: true,
  lastModified: true,
  setHeaders: function(res) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
}));
app.use('/css', express.static(path.join(__dirname, '..', 'frontend', 'css'), {
  maxAge: 0,
  etag: true,
  lastModified: true,
  setHeaders: function(res) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
}));

app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  maxAge: '1d',
  etag: true
}));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/game', gameRoutes);

app.get('/api/health', function(req, res) {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.get('*', function(req, res) {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found' });
  var htmlFiles = ['login', 'register', 'profile', 'room', 'posts', 'user', 'game'];
  var requestedPage = req.path.replace('/', '').replace('.html', '');
  if (htmlFiles.indexOf(requestedPage) !== -1) {
    return res.sendFile(path.join(__dirname, '..', 'frontend', requestedPage + '.html'));
  }
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.set('io', io);
setupChatSocket(io);

mongoose.connect(process.env.MONGODB_URI)
  .then(function() {
    console.log('✅ Connected to MongoDB');
    var PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', function() {
      console.log('🚀 Server running on port ' + PORT);
    });
  })
  .catch(function(err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });