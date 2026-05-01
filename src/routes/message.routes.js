const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const messageService = require('../services/messageService');

function getActiveMode(req) {
  return req.query.activeMode || req.body.activeMode || req.headers['x-active-mode'];
}

function parsePagination(rawLimit, rawSkip) {
  const parsedLimit = Number.parseInt(rawLimit, 10);
  const parsedSkip = Number.parseInt(rawSkip, 10);

  return {
    limit: Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50,
    skip: Number.isFinite(parsedSkip) ? Math.max(parsedSkip, 0) : 0,
  };
}

/**
 * Create or get a conversation with another user
 * GET/POST /api/messages/conversations/:userId
 */
router.post('/conversations/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user._id;
    const activeMode = getActiveMode(req);

    if (currentUserId.toString() === userId.toString()) {
      return res.status(400).json({
        message: 'Cannot create conversation with yourself',
        errorCode: 'INVALID_USER',
      });
    }

    const conversation = await messageService.createConversation(currentUserId, userId, activeMode);

    res.status(201).json({
      message: 'Conversation created or retrieved',
      conversation,
    });
  } catch (error) {
    console.error('[Route] Error creating conversation:', error);
    res.status(500).json({
      message: 'Failed to create conversation',
      error: error.message,
    });
  }
});

/**
 * Get all conversations for current user
 * GET /api/messages/conversations?limit=50&skip=0&archived=false
 */
router.get('/conversations', requireAuth, async (req, res) => {
  try {
    const { limit = 50, skip = 0, archived = 'false' } = req.query;
    const currentUserId = req.user._id;
    const activeMode = getActiveMode(req);
    const paging = parsePagination(limit, skip);

    const { conversations, total } = await messageService.getConversations(currentUserId, activeMode, {
      limit: paging.limit,
      skip: paging.skip,
      archived: archived === 'true',
    });

    res.status(200).json({
      message: 'Conversations retrieved',
      conversations,
      total,
      limit: paging.limit,
      skip: paging.skip,
    });
  } catch (error) {
    console.error('[Route] Error fetching conversations:', error);
    res.status(500).json({
      message: 'Failed to fetch conversations',
      error: error.message,
    });
  }
});

/**
 * Get unread message count for current user
 * GET /api/messages/unread/count
 */
router.get('/unread/count', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const activeMode = getActiveMode(req);
    const unreadCount = await messageService.getUnreadCount(userId, activeMode);

    res.status(200).json({
      message: 'Unread count retrieved',
      unreadCount,
    });
  } catch (error) {
    console.error('[Route] Error fetching unread count:', error);
    res.status(500).json({
      message: 'Failed to fetch unread count',
      error: error.message,
    });
  }
});

/**
 * Send a new message
 * POST /api/messages
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { conversationId, receiverId, text, images } = req.body;
    const senderId = req.user._id;
    const activeMode = getActiveMode(req);

    if (!conversationId || !receiverId) {
      return res.status(400).json({
        message: 'Missing required fields: conversationId, receiverId',
        errorCode: 'INVALID_REQUEST',
      });
    }

    if (!text && (!images || images.length === 0)) {
      return res.status(400).json({
        message: 'Message must contain text or images',
        errorCode: 'EMPTY_MESSAGE',
      });
    }

    const message = await messageService.sendMessage(
      conversationId,
      senderId,
      receiverId,
      text || '',
      images || [],
      activeMode,
    );

    res.status(201).json({
      message: 'Message sent',
      data: message,
    });
  } catch (error) {
    console.error('[Route] Error sending message:', error);
    res.status(500).json({
      message: 'Failed to send message',
      error: error.message,
    });
  }
});

/**
 * Mark messages as read
 * PUT /api/messages/read
 */
router.put('/read', requireAuth, async (req, res) => {
  try {
    const { conversationId, messageIds } = req.body;
    const userId = req.user._id;
    const activeMode = getActiveMode(req);

    if (!conversationId || !messageIds || messageIds.length === 0) {
      return res.status(400).json({
        message: 'Missing required fields: conversationId, messageIds',
        errorCode: 'INVALID_REQUEST',
      });
    }

    const result = await messageService.markMessagesAsRead(conversationId, messageIds, userId, activeMode);

    res.status(200).json({
      message: 'Messages marked as read',
      data: result,
    });
  } catch (error) {
    console.error('[Route] Error marking messages as read:', error);
    res.status(500).json({
      message: 'Failed to mark messages as read',
      error: error.message,
    });
  }
});

/**
 * Get messages in a conversation
 * GET /api/messages/conversations/:conversationId/messages?limit=50&skip=0
 */
router.get('/conversations/:conversationId/messages', requireAuth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit = 50, skip = 0 } = req.query;
    const activeMode = getActiveMode(req);
    const paging = parsePagination(limit, skip);

    const { messages, total } = await messageService.getMessages(conversationId, req.user._id, activeMode, {
      limit: paging.limit,
      skip: paging.skip,
    });

    res.status(200).json({
      message: 'Messages retrieved',
      messages,
      total,
      limit: paging.limit,
      skip: paging.skip,
    });
  } catch (error) {
    console.error('[Route] Error fetching messages:', error);
    res.status(500).json({
      message: 'Failed to fetch messages',
      error: error.message,
    });
  }
});

/**
 * Search messages in a conversation
 * GET /api/messages/search?conversationId=X&query=Y&startDate=Z&endDate=W
 */
router.get('/search/messages', requireAuth, async (req, res) => {
  try {
    const { conversationId, query, startDate, endDate } = req.query;
    const activeMode = getActiveMode(req);

    if (!conversationId || !query) {
      return res.status(400).json({
        message: 'Missing required parameters: conversationId, query',
        errorCode: 'INVALID_REQUEST',
      });
    }

    const messages = await messageService.searchMessages(conversationId, req.user._id, activeMode, query, {
      startDate,
      endDate,
    });

    res.status(200).json({
      message: 'Search results retrieved',
      messages,
      count: messages.length,
    });
  } catch (error) {
    console.error('[Route] Error searching messages:', error);
    res.status(500).json({
      message: 'Failed to search messages',
      error: error.message,
    });
  }
});

/**
 * Delete a message (soft delete)
 * DELETE /api/messages/:messageId
 */
router.delete('/:messageId', requireAuth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;
    const activeMode = getActiveMode(req);

    const message = await messageService.deleteMessage(messageId, userId, activeMode);

    res.status(200).json({
      message: 'Message deleted',
      data: message,
    });
  } catch (error) {
    console.error('[Route] Error deleting message:', error);
    res.status(500).json({
      message: 'Failed to delete message',
      error: error.message,
    });
  }
});

/**
 * Edit a message
 * PUT /api/messages/:messageId
 */
router.put('/:messageId', requireAuth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { text } = req.body;
    const activeMode = getActiveMode(req);

    if (!text) {
      return res.status(400).json({
        message: 'Message text is required',
        errorCode: 'INVALID_REQUEST',
      });
    }

    const message = await messageService.editMessage(messageId, req.user._id, activeMode, text);

    res.status(200).json({
      message: 'Message updated',
      data: message,
    });
  } catch (error) {
    console.error('[Route] Error editing message:', error);
    res.status(500).json({
      message: 'Failed to edit message',
      error: error.message,
    });
  }
});

module.exports = router;
