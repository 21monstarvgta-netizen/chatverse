const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 20
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  banReason: {
    type: String,
    default: ''
  },
  profile: {
    firstName: { type: String, default: '', maxlength: 50 },
    lastName: { type: String, default: '', maxlength: 50 },
    bio: { type: String, default: '', maxlength: 500 },
    birthDate: { type: Date, default: null },
    location: { type: String, default: '', maxlength: 100 },
    website: { type: String, default: '', maxlength: 200 },
    avatarColor: { type: String, default: '#6c5ce7' },
    avatarUrl: { type: String, default: '' },
    bannerColor1: { type: String, default: '#6c5ce7' },
    bannerColor2: { type: String, default: '#a29bfe' },
    statusEmoji: { type: String, default: '' },
    statusText: { type: String, default: '', maxlength: 100 },
    theme: { type: String, default: 'default' },
    nameGlow: { type: Boolean, default: false },
    nameColor: { type: String, default: '' }
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'away'],
    default: 'offline'
  },
  lastSeen: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  return user;
};

module.exports = mongoose.model('User', userSchema);