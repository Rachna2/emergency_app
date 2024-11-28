const express = require('express');
const https = require('https');  // Use HTTPS instead of HTTP
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
const NodeCache = require('node-cache');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const options = {
  key: fs.readFileSync(path.join(__dirname, 'ssl', 'server-key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'ssl', 'server-cert.pem')),
};

const server = https.createServer(options, app);  // Use HTTPS

const io = new Server(server);
const cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes

const PORT = process.env.PORT || 3000;

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Middleware
app.use(express.json());
app.use(cors({
  origin: [
    'https://a-t.onrender.com',  // Your Render app's URL
    'http://localhost:3000',     // Your local development URL
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// MongoDB Schemas and Models
const UserSchema = new mongoose.Schema({
  name: String,
  role: String,
  licensePlate: String,
  phone: String,
  location: {
    lat: Number,
    lon: Number,
  },
});
const User = mongoose.model('User', UserSchema);

// Routes
app.post('/register', async (req, res) => {
  try {
    const user = new User(req.body);
    await user.save();
    res.status(201).send({ message: 'Registration successful!' });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

app.post('/login', async (req, res) => {
  try {
    const user = await User.findOne({ name: req.body.name, phone: req.body.phone });
    if (!user) return res.status(404).send({ error: 'User not found!' });
    res.status(200).send(user);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Hospitals Endpoint
app.get('/hospitals', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    const cacheKey = `hospitals_${lat}_${lon}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData) return res.status(200).send(cachedData);

    const overpassUrl = `https://overpass-api.de/api/interpreter?data=[out:json];node(around:5000,${lat},${lon})[amenity=hospital];out;`;
    const response = await axios.get(overpassUrl, { timeout: 10000 });

    const hospitals = response.data.elements.map((el) => ({
      name: el.tags.name || 'Unknown',
      lat: el.lat,
      lon: el.lon,
    }));

    cache.set(cacheKey, hospitals);
    res.status(200).send(hospitals);
  } catch (err) {
    res.status(500).send({ error: 'Error fetching hospitals data' });
  }
});

// Route Endpoint
app.get('/route', async (req, res) => {
  try {
    const { startLat, startLon, endLat, endLon } = req.query;
    const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson`;

    const response = await axios.get(osrmUrl, { timeout: 10000 });
    if (response.data.routes.length > 0) {
      res.status(200).send(response.data.routes[0].geometry);
    } else {
      res.status(404).send({ error: 'No route found' });
    }
  } catch (err) {
    res.status(500).send({ error: 'Error fetching route data' });
  }
});

// Socket.IO Events
let connectedUsers = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('registerRole', (data) => {
    connectedUsers[socket.id] = { ...data, socket };
    console.log(`${data.role} registered: ${data.name}`);
  });

  socket.on('emergency', (data) => {
    const { licensePlate, location } = data;
    const nearestPolice = Object.values(connectedUsers).find(user => user.role === 'Traffic Police');
    if (nearestPolice) {
      nearestPolice.socket.emit('emergencyAlert', { licensePlate, location });
    } else {
      console.error('No Traffic Police available to handle the emergency.');
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    delete connectedUsers[socket.id];
  });
});

// Start Server (HTTPS)
server.listen(PORT, () => {
  console.log(`Server running on https://localhost:${PORT}`);
});
