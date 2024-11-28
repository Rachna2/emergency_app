// models/User.js
const mongoose = require('mongoose');

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

const User = mongoose.model('User', UserSchema);  // Register the model

module.exports = User;  // Export the model for use in server.js
