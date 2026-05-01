const { Schema, model } = require('mongoose');

const conversationSchema = new Schema(
  {
    participants: {
      type: [
        {
          userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          role: {
            type: String,
            enum: ['student', 'teacher'],
            required: true,
          },
          joinedAt: { type: Date, default: Date.now },
        },
      ],
      validate: {
        validator: function (v) {
          return v.length === 2;
        },
        message: 'Conversation must have exactly 2 participants',
      },
      required: true,
    },
    lastMessage: {
      type: {
        messageId: { type: Schema.Types.ObjectId, ref: 'Message' },
        text: { type: String },
        senderId: { type: Schema.Types.ObjectId, ref: 'User' },
        sentAt: { type: Date },
      },
      default: null,
    },
    unreadCounts: {
      type: [
        {
          userId: { type: Schema.Types.ObjectId, ref: 'User' },
          count: { type: Number, default: 0, min: 0 },
        },
      ],
      default: [],
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    archivedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isPinned: {
      type: Boolean,
      default: false,
    },
    pinnedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    settings: {
      muteNotifications: { type: Boolean, default: false },
      blockUser: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
    index: { 'participants.userId': 1, updatedAt: -1 },
  },
);

// Compound index for efficient queries
conversationSchema.index({ 'participants.userId': 1, updatedAt: -1 });

module.exports = model('Conversation', conversationSchema);
