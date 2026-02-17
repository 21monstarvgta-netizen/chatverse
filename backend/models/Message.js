const mongoose = require('mongoose');

const shoppingItemSchema = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 100 },
  category: { type: String, default: '' },
  bought: { type: Boolean, default: false },
  boughtBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { _id: true });

const messageSchema = new mongoose.Schema({
  content: {
    type: String,
    default: '',
    maxlength: 5000
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    default: null
  },
  type: {
    type: String,
    enum: ['text', 'system', 'image', 'shopping', 'dice', 'forwarded'],
    default: 'text'
  },
  imageUrl: {
    type: String,
    default: ''
  },
  shoppingList: {
    title: { type: String, default: 'Список покупок' },
    items: [shoppingItemSchema]
  },
  diceResult: {
    diceType: { type: String, default: 'd6' },
    sides: { type: Number, default: 6 },
    result: { type: Number, default: 1 },
    rolledBy: { type: String, default: '' }
  },
  edited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date,
    default: null
  },
  forwarded: {
    originalSender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    originalRoom: { type: String, default: '' },
    originalDate: { type: Date, default: null }
  },
  pinned: {
    type: Boolean,
    default: false
  },
  pinnedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  pinnedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

messageSchema.index({ room: 1, createdAt: -1 });
messageSchema.index({ room: 1, pinned: 1 });

module.exports = mongoose.model('Message', messageSchema);