const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { hasRole } = require('../utils/roles');

const VALID_MODES = ['student', 'teacher'];

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeActiveMode(mode, fallback = null) {
  if (typeof mode !== 'string') {
    return fallback;
  }

  const normalized = mode.trim().toLowerCase();
  return VALID_MODES.includes(normalized) ? normalized : fallback;
}

function canUserAccessMode(user, activeMode) {
  const mode = normalizeActiveMode(activeMode);

  if (!mode || !user) {
    return false;
  }

  return hasRole(user, mode);
}

function getParticipantByUserId(conversation, userId) {
  return conversation.participants.find((participant) => participant.userId.toString() === userId.toString());
}

async function assertConversationAccess(conversationId, userId, activeMode) {
  const conversation = await Conversation.findById(conversationId);

  if (!conversation) {
    throw createHttpError(404, 'Conversation not found.');
  }

  const participant = getParticipantByUserId(conversation, userId);

  if (!participant) {
    throw createHttpError(403, 'You are not a participant in this conversation.');
  }

  if (participant.role !== activeMode) {
    throw createHttpError(403, `Conversation is not accessible in ${activeMode} mode.`);
  }

  const counterparty = conversation.participants.find((item) => item.userId.toString() !== userId.toString()) || null;

  return {
    conversation,
    participant,
    counterparty,
  };
}

/**
 * Create a new conversation between two users
 */
async function createConversation(userId1, userId2, activeMode) {
  try {
    const senderMode = normalizeActiveMode(activeMode);

    if (!senderMode) {
      throw createHttpError(400, 'A valid activeMode is required.');
    }

    const receiverMode = senderMode === 'student' ? 'teacher' : 'student';
    const id1 = userId1.toString();
    const id2 = userId2.toString();

    // Check if conversation already exists
    let conversation = await Conversation.findOne({
      participants: {
        $all: [
          { $elemMatch: { userId: userId1, role: senderMode } },
          { $elemMatch: { userId: userId2, role: receiverMode } },
        ],
      },
    });

    if (conversation) {
      return conversation;
    }

    // Get users and validate mode access
    const users = await User.find({ _id: { $in: [userId1, userId2] } });
    const usersById = {};
    users.forEach((u) => {
      usersById[u._id.toString()] = u;
    });

    if (!usersById[id1] || !usersById[id2]) {
      throw new Error('Both users must exist before creating a conversation');
    }

    if (!canUserAccessMode(usersById[id1], senderMode)) {
      throw createHttpError(403, `Sender cannot start conversations in ${senderMode} mode.`);
    }

    if (!canUserAccessMode(usersById[id2], receiverMode)) {
      throw createHttpError(403, `Receiver cannot participate as ${receiverMode}.`);
    }

    // Create new conversation
    conversation = await Conversation.create({
      participants: [
        { userId: userId1, role: senderMode },
        { userId: userId2, role: receiverMode },
      ],
      unreadCounts: [
        { userId: userId1, count: 0 },
        { userId: userId2, count: 0 },
      ],
    });

    return conversation;
  } catch (error) {
    console.error('Error creating conversation:', error);
    throw error;
  }
}

/**
 * Get all conversations for a user
 */
async function getConversations(userId, activeMode, options = {}) {
  try {
    const mode = normalizeActiveMode(activeMode);

    if (!mode) {
      throw createHttpError(400, 'A valid activeMode is required.');
    }

    const { limit = 50, skip = 0, archived = false } = options;

    const conversations = await Conversation.find({
      participants: {
        $elemMatch: {
          userId,
          role: mode,
        },
      },
      isArchived: archived,
    })
      .populate({
        path: 'participants.userId',
        select: 'name email avatarUrl profession onlineStatus lastSeen',
      })
      .populate({
        path: 'lastMessage.senderId',
        select: 'name avatarUrl',
      })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Conversation.countDocuments({
      participants: {
        $elemMatch: {
          userId,
          role: mode,
        },
      },
      isArchived: archived,
    });

    return { conversations, total };
  } catch (error) {
    console.error('Error fetching conversations:', error);
    throw error;
  }
}

/**
 * Get messages in a conversation with pagination
 */
async function getMessages(conversationId, userId, activeMode, options = {}) {
  try {
    const mode = normalizeActiveMode(activeMode);

    if (!mode) {
      throw createHttpError(400, 'A valid activeMode is required.');
    }

    const { counterparty } = await assertConversationAccess(conversationId, userId, mode);
    const counterpartyRole = counterparty?.role;
    const { limit = 50, skip = 0 } = options;

    const senderModeFilters = [{ senderMode: mode }, { senderMode: null }, { senderMode: { $exists: false } }];
    if (counterpartyRole && VALID_MODES.includes(counterpartyRole)) {
      senderModeFilters.push({ senderMode: counterpartyRole });
    }

    const messages = await Message.find({
      conversationId,
      deletedAt: null,
      $or: senderModeFilters,
    })
      .populate('senderId', 'name email avatarUrl')
      .populate('receiverId', 'name email avatarUrl')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Message.countDocuments({
      conversationId,
      deletedAt: null,
    });

    return { messages: messages.reverse(), total };
  } catch (error) {
    console.error('Error fetching messages:', error);
    throw error;
  }
}

/**
 * Send a new message
 */
async function sendMessage(conversationId, senderId, receiverId, text, images = [], activeMode) {
  try {
    const mode = normalizeActiveMode(activeMode);

    if (!mode) {
      throw createHttpError(400, 'A valid activeMode is required.');
    }

    const { counterparty } = await assertConversationAccess(conversationId, senderId, mode);

    if (!counterparty) {
      throw createHttpError(400, 'Conversation counterparty not found.');
    }

    const counterpartyUserId = counterparty.userId.toString();
    if (counterpartyUserId !== receiverId.toString()) {
      throw createHttpError(400, 'Receiver does not match this conversation.');
    }

    const message = await Message.create({
      conversationId,
      senderId,
      receiverId,
      senderMode: mode,
      text,
      images,
    });

    // Update conversation last message
    await Conversation.updateOne(
      { _id: conversationId },
      {
        lastMessage: {
          messageId: message._id,
          text: message.text,
          senderId,
          sentAt: message.createdAt,
        },
        updatedAt: new Date(),
      },
    );

    // Increment unread count for receiver
    await Conversation.updateOne(
      { _id: conversationId, 'unreadCounts.userId': counterparty.userId },
      { $inc: { 'unreadCounts.$.count': 1 } },
    );

    await message.populate('senderId', 'name email avatarUrl');

    return message;
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
}

/**
 * Mark messages as read
 */
async function markMessagesAsRead(conversationId, messageIds, userId, activeMode) {
  try {
    const mode = normalizeActiveMode(activeMode);

    if (!mode) {
      throw createHttpError(400, 'A valid activeMode is required.');
    }

    await assertConversationAccess(conversationId, userId, mode);

    const readAt = new Date();

    await Message.updateMany(
      {
        _id: { $in: messageIds },
        conversationId,
        receiverId: userId,
        readAt: null,
      },
      {
        readAt,
        $addToSet: { readBy: { userId, readAt } },
      },
    );

    // Get updated unread count
    const unreadCount = await Message.countDocuments({
      conversationId,
      receiverId: userId,
      readAt: null,
    });

    // Update conversation unread count
    await Conversation.updateOne(
      { _id: conversationId, 'unreadCounts.userId': userId },
      { $set: { 'unreadCounts.$.count': unreadCount } },
    );

    return { unreadCount };
  } catch (error) {
    console.error('Error marking messages as read:', error);
    throw error;
  }
}

/**
 * Get unread message count for a user
 */
async function getUnreadCount(userId, activeMode) {
  try {
    const mode = normalizeActiveMode(activeMode);

    if (!mode) {
      throw createHttpError(400, 'A valid activeMode is required.');
    }

    const conversations = await Conversation.find({
      participants: {
        $elemMatch: {
          userId,
          role: mode,
        },
      },
      'unreadCounts.userId': userId,
    });

    let totalUnread = 0;
    conversations.forEach((conv) => {
      const unread = conv.unreadCounts.find((uc) => uc.userId.toString() === userId.toString());
      if (unread) {
        totalUnread += unread.count;
      }
    });

    return totalUnread;
  } catch (error) {
    console.error('Error getting unread count:', error);
    throw error;
  }
}

/**
 * Search messages in a conversation
 */
async function searchMessages(conversationId, userId, activeMode, query, options = {}) {
  try {
    const mode = normalizeActiveMode(activeMode);

    if (!mode) {
      throw createHttpError(400, 'A valid activeMode is required.');
    }

    const { counterparty } = await assertConversationAccess(conversationId, userId, mode);
    const counterpartyRole = counterparty?.role;
    const { startDate, endDate } = options;

    const senderModeFilters = [{ senderMode: mode }, { senderMode: null }, { senderMode: { $exists: false } }];
    if (counterpartyRole && VALID_MODES.includes(counterpartyRole)) {
      senderModeFilters.push({ senderMode: counterpartyRole });
    }

    const filters = {
      conversationId,
      deletedAt: null,
      $text: { $search: query },
      $or: senderModeFilters,
    };

    if (startDate || endDate) {
      filters.createdAt = {};
      if (startDate) filters.createdAt.$gte = new Date(startDate);
      if (endDate) filters.createdAt.$lte = new Date(endDate);
    }

    const messages = await Message.find(filters)
      .populate('senderId', 'name email avatarUrl')
      .sort({ createdAt: -1 })
      .lean();

    return messages;
  } catch (error) {
    console.error('Error searching messages:', error);
    throw error;
  }
}

/**
 * Get message by ID
 */
async function getMessage(messageId) {
  try {
    const message = await Message.findById(messageId)
      .populate('senderId', 'name email avatarUrl')
      .populate('receiverId', 'name email avatarUrl')
      .populate('replyTo');

    return message;
  } catch (error) {
    console.error('Error fetching message:', error);
    throw error;
  }
}

/**
 * Delete message (soft delete)
 */
async function deleteMessage(messageId, userId, activeMode) {
  try {
    const mode = normalizeActiveMode(activeMode);

    if (!mode) {
      throw createHttpError(400, 'A valid activeMode is required.');
    }

    const existingMessage = await Message.findById(messageId);

    if (!existingMessage || existingMessage.deletedAt) {
      throw createHttpError(404, 'Message not found.');
    }

    await assertConversationAccess(existingMessage.conversationId, userId, mode);

    if (existingMessage.senderId.toString() !== userId.toString()) {
      throw createHttpError(403, 'You can only delete your own messages.');
    }

    const message = await Message.findByIdAndUpdate(
      messageId,
      {
        deletedAt: new Date(),
        deletedBy: userId,
        text: '[Message deleted]',
      },
      { new: true },
    );

    return message;
  } catch (error) {
    console.error('Error deleting message:', error);
    throw error;
  }
}

/**
 * Edit message
 */
async function editMessage(messageId, userId, activeMode, text) {
  try {
    const mode = normalizeActiveMode(activeMode);

    if (!mode) {
      throw createHttpError(400, 'A valid activeMode is required.');
    }

    const existingMessage = await Message.findById(messageId);

    if (!existingMessage || existingMessage.deletedAt) {
      throw createHttpError(404, 'Message not found.');
    }

    await assertConversationAccess(existingMessage.conversationId, userId, mode);

    if (existingMessage.senderId.toString() !== userId.toString()) {
      throw createHttpError(403, 'You can only edit your own messages.');
    }

    const message = await Message.findByIdAndUpdate(
      messageId,
      {
        text,
        isEdited: true,
        editedAt: new Date(),
      },
      { new: true },
    );

    return message;
  } catch (error) {
    console.error('Error editing message:', error);
    throw error;
  }
}

module.exports = {
  VALID_MODES,
  normalizeActiveMode,
  canUserAccessMode,
  assertConversationAccess,
  createConversation,
  getConversations,
  getMessages,
  sendMessage,
  markMessagesAsRead,
  getUnreadCount,
  searchMessages,
  getMessage,
  deleteMessage,
  editMessage,
};
