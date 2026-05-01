const { Schema, model } = require('mongoose');

const messageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    receiverId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    senderMode: {
      type: String,
      enum: ['student', 'teacher'],
      default: null,
      index: true,
    },
    text: {
      type: String,
      trim: true,
      default: '',
    },
    images: {
      type: [
        {
          url: { type: String, required: true },
          alt: { type: String, default: '' },
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    readAt: {
      type: Date,
      default: null,
    },
    readBy: {
      type: [
        {
          userId: { type: Schema.Types.ObjectId, ref: 'User' },
          readAt: { type: Date },
        },
      ],
      default: [],
    },
    isTyping: {
      type: Boolean,
      default: false,
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
      default: null,
    },
    replyTo: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    reactions: {
      type: [
        {
          userId: { type: Schema.Types.ObjectId, ref: 'User' },
          emoji: { type: String },
        },
      ],
      default: [],
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    index: { conversationId: 1, createdAt: -1 },
  },
);

// Compound index for efficient sorting
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, senderMode: 1, createdAt: -1 });

// Index for searching by text
messageSchema.index({ text: 'text' });

module.exports = model('Message', messageSchema);
