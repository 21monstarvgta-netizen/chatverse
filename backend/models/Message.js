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
    enum: ['text', 'system', 'image', 'shopping', 'dice'],
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
  }
}, { timestamps: true });

messageSchema.index({ room: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);