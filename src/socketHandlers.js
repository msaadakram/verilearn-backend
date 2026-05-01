const User = require('./models/User');
const Conversation = require('./models/Conversation');
const Message = require('./models/Message');
const { normalizeActiveMode, assertConversationAccess } = require('./services/messageService');
const { hasRole } = require('./utils/roles');
const { calculateSessionCredits } = require('./utils/sessionCredits');

// Track online users and their socket IDs
const onlineUsers = new Map(); // userId -> { socketId, status, lastSeen }
const typingUsers = new Map(); // conversationId -> Set of userIds

/**
 * Create a room name for a user in a specific mode.
 * Allows broadcasting updates to all sessions of a user in a particular role.
 */
function getUserRoom(userId, activeMode) {
  return `user:${userId}:${activeMode}`;
}

/**
 * Create a room name for a conversation in a specific mode.
 * Allows broadcasting messages to all participants in a conversation in a particular role.
 */
function getModeRoom(conversationId, activeMode) {
  return `conversation:${conversationId}:${activeMode}`;
}

/**
 * Determine whether the connected socket can act as a teacher for incoming
 * call actions. Dual-role users should be able to handle teacher requests
 * even if their current active mode is student.
 */
function canActAsTeacher(socket) {
  return socket?.activeMode === 'teacher'
    || hasRole(socket?.user, 'teacher');
}

/**
 * Setup all socket.io event handlers
 */
function setupSocketHandlers(io) {
  io.on('connection', async (socket) => {
    console.log(`[Socket] User ${socket.userId} connected: ${socket.id}`);

    const userId = socket.userId;
    const activeMode = normalizeActiveMode(socket.activeMode, socket.profession);

    // Track online user
    onlineUsers.set(userId, {
      socketId: socket.id,
      status: 'online',
      lastSeen: new Date(),
    });

    // Update user status in database
    await User.updateOne(
      { _id: userId },
      {
        onlineStatus: 'online',
        lastSeen: new Date(),
      },
    ).catch(console.error);

    // Broadcast user online status to all connected clients
    io.emit('user-online', { userId, status: 'online', timestamp: new Date() });

    socket.join(getUserRoom(userId, activeMode));

    // Join conversation rooms for all user's conversations
    try {
      const conversations = await Conversation.find({
        'participants.userId': userId,
      });

      conversations.forEach((conv) => {
        const participant = conv.participants.find((item) => item.userId.toString() === userId.toString());
        if (participant?.role) {
          socket.join(getModeRoom(conv._id, participant.role));
        }
      });

      console.log(`[Socket] User ${userId} joined ${conversations.length} conversation rooms`);
    } catch (error) {
      console.error(`[Socket] Failed to join conversation rooms:`, error);
    }

    /* ────────────────────────────────────────────────────────────── */
    /* MESSAGE EVENTS */
    /* ────────────────────────────────────────────────────────────── */

    /**
     * Send a new message
     * Event: send-message
     * Data: { conversationId, receiverId, text, images[] }
     */
    socket.on('send-message', async (payload, callback) => {
      try {
        const { conversationId, receiverId, text, images } = payload;

        if (!conversationId || !receiverId || (!text && !images?.length)) {
          return callback({ error: 'Invalid message data' });
        }

        const { conversation, counterparty } = await assertConversationAccess(conversationId, userId, activeMode);

        if (counterparty?.userId.toString() !== receiverId.toString()) {
          return callback({ error: 'Receiver does not match this conversation.' });
        }

        // Create message in database
        const message = await Message.create({
          conversationId,
          senderId: userId,
          receiverId,
          senderMode: activeMode,
          text: text || '',
          images: images || [],
        });

        // Populate sender details
        await message.populate('senderId', 'name email avatarUrl profession');

        // Update conversation's last message
        await Conversation.updateOne(
          { _id: conversationId },
          {
            lastMessage: {
              messageId: message._id,
              text: message.text,
              senderId: userId,
              sentAt: message.createdAt,
            },
            updatedAt: new Date(),
          },
        );

        // Broadcast message to conversation room
        io.to(getModeRoom(conversationId, activeMode)).emit('message-received', {
          message,
          conversationId,
        });

        // Broadcast unread count update to receiver
        const updatedConv = await Conversation.findById(conversationId);
        io.to(getUserRoom(receiverId, counterparty.role)).emit('conversation-updated', updatedConv);

        callback({ success: true, message });
      } catch (error) {
        console.error('[Socket] Error sending message:', error);
        callback({ error: error.message });
      }
    });

    /**
     * Mark message(s) as read
     * Event: mark-read
     * Data: { conversationId, messageIds[] }
     */
    socket.on('mark-read', async (payload, callback) => {
      try {
        const { conversationId, messageIds } = payload;

        if (!conversationId || !messageIds?.length) {
          return callback({ error: 'Invalid data' });
        }

        await assertConversationAccess(conversationId, userId, activeMode);

        // Update messages as read
        const result = await Message.updateMany(
          { _id: { $in: messageIds } },
          {
            readAt: new Date(),
            $push: { readBy: { userId, readAt: new Date() } },
          },
        );

        // Update conversation unread count
        const unreadCount = await Message.countDocuments({
          conversationId,
          receiverId: userId,
          readAt: null,
        });

        await Conversation.updateOne(
          { _id: conversationId, 'unreadCounts.userId': userId },
          { $set: { 'unreadCounts.$.count': unreadCount } },
        );

        // Broadcast read receipts to conversation room
        io.to(getModeRoom(conversationId, activeMode)).emit('messages-read', {
          conversationId,
          messageIds,
          readBy: userId,
          readAt: new Date(),
        });

        callback({ success: true, updatedCount: result.modifiedCount });
      } catch (error) {
        console.error('[Socket] Error marking messages as read:', error);
        callback({ error: error.message });
      }
    });

    /* ────────────────────────────────────────────────────────────── */
    /* TYPING INDICATOR EVENTS */
    /* ────────────────────────────────────────────────────────────── */

    /**
     * User started typing
     * Event: typing-start
     * Data: { conversationId }
     */
    socket.on('typing-start', (payload) => {
      const { conversationId } = payload;

      if (!conversationId) return;

      if (!typingUsers.has(conversationId)) {
        typingUsers.set(conversationId, new Set());
      }
      typingUsers.get(conversationId).add(userId);

      io.to(getModeRoom(conversationId, activeMode)).emit('user-typing', {
        conversationId,
        userId,
        timestamp: new Date(),
      });
    });

    /**
     * User stopped typing
     * Event: typing-stop
     * Data: { conversationId }
     */
    socket.on('typing-stop', (payload) => {
      const { conversationId } = payload;

      if (!conversationId) return;

      if (typingUsers.has(conversationId)) {
        typingUsers.get(conversationId).delete(userId);

        if (typingUsers.get(conversationId).size === 0) {
          typingUsers.delete(conversationId);
        }
      }

      io.to(getModeRoom(conversationId, activeMode)).emit('user-stop-typing', {
        conversationId,
        userId,
      });
    });

    /* ────────────────────────────────────────────────────────────── */
    /* PRESENCE EVENTS */
    /* ────────────────────────────────────────────────────────────── */

    /**
     * Heartbeat to keep user online
     * Event: heartbeat
     */
    socket.on('heartbeat', () => {
      if (onlineUsers.has(userId)) {
        const user = onlineUsers.get(userId);
        user.lastSeen = new Date();

        User.updateOne(
          { _id: userId },
          { lastSeen: new Date(), onlineStatus: 'online' },
        ).catch(console.error);
      }
    });

    /**
     * Set user idle status
     * Event: set-idle
     */
    socket.on('set-idle', () => {
      if (onlineUsers.has(userId)) {
        onlineUsers.get(userId).status = 'idle';
      }

      User.updateOne({ _id: userId }, { onlineStatus: 'idle' }).catch(console.error);
      io.emit('user-idle', { userId, timestamp: new Date(), activeMode });
    });

    /* ────────────────────────────────────────────────────────────── */
    /* CALL SIGNALING EVENTS                                          */
    /* ────────────────────────────────────────────────────────────── */

    /**
     * Student initiates a call to a teacher.
     * Event: "call-user"
     * Data: { teacherId, studentId, callerName, callerAvatar }
     *
     * Security: only users with profession "student" may emit this event.
     * The channel name is derived server-side from studentId + teacherId.
     */
    socket.on('call-user', (payload) => {
      const { teacherId, studentId, callerName, callerAvatar } = payload || {};

      // Role check — only student-mode sessions can initiate calls
      if (socket.activeMode !== 'student') {
        console.warn(`[Call] Non-student-mode session ${userId} tried to initiate a call.`);
        socket.emit('call-error', { message: 'Only students can initiate calls.' });
        return;
      }

      if (!teacherId || !studentId) {
        socket.emit('call-error', { message: 'teacherId and studentId are required.' });
        return;
      }

      // Derive the canonical channel name from the two participant IDs
      const channel = `call_${studentId}_${teacherId}`;

      // Find teacher socket
      const teacherSocketData = onlineUsers.get(teacherId);
      if (!teacherSocketData) {
        // Teacher is offline — notify student immediately
        socket.emit('call-rejected', {
          reason: 'Teacher is currently offline.',
          channel,
        });
        return;
      }

      console.log(`[Call] Student ${userId} calling teacher ${teacherId} on channel ${channel}`);

      // Relay the incoming-call event to the teacher's socket
      io.to(teacherSocketData.socketId).emit('incoming-call', {
        channel,
        studentId,
        teacherId,
        callerName: callerName || 'Student',
        callerAvatar: callerAvatar || '',
        callerSocketId: socket.id,
      });
    });

    /**
     * Teacher accepts a call.
     * Event: "call-accepted"
     * Data: { channel, studentId, teacherId }
     *
     * Security: validates that the accepting user is actually the intended teacher.
     */
    socket.on('call-accepted', (payload) => {
      const { channel, studentId, teacherId } = payload || {};

      if (!canActAsTeacher(socket)) {
        socket.emit('call-error', { message: 'Only teachers can accept calls.' });
        return;
      }

      if (!channel || !studentId) {
        socket.emit('call-error', { message: 'channel and studentId are required.' });
        return;
      }

      console.log(`[Call] Teacher ${userId} accepted call from student ${studentId} on ${channel}`);

      // Notify the student that the call was accepted
      const studentSocketData = onlineUsers.get(studentId);
      if (studentSocketData) {
        io.to(studentSocketData.socketId).emit('call-accepted', {
          channel,
          teacherId: teacherId || userId,
          acceptedAt: new Date().toISOString(),
        });
      }
    });

    /**
     * Teacher rejects a call.
     * Event: "call-rejected"
     * Data: { channel, studentId, reason? }
     */
    socket.on('call-rejected', (payload) => {
      const { channel, studentId, reason } = payload || {};

      if (!canActAsTeacher(socket)) {
        socket.emit('call-error', { message: 'Only teachers can reject calls.' });
        return;
      }

      console.log(`[Call] Teacher ${userId} rejected call from student ${studentId}`);

      const studentSocketData = onlineUsers.get(studentId);
      if (studentSocketData) {
        io.to(studentSocketData.socketId).emit('call-rejected', {
          channel,
          reason: reason || 'The teacher declined your call.',
          rejectedAt: new Date().toISOString(),
        });
      }
    });

    /**
     * Either party ends an active call.
     * Event: "end-call"
     * Data: { channel, otherUserId }
     */
    socket.on('end-call', (payload) => {
      const { channel, otherUserId } = payload || {};

      console.log(`[Call] User ${userId} ended call on channel ${channel}`);

      if (otherUserId) {
        const otherSocketData = onlineUsers.get(otherUserId);
        if (otherSocketData) {
          io.to(otherSocketData.socketId).emit('call-ended', {
            channel,
            endedBy: userId,
            endedAt: new Date().toISOString(),
          });
        }
      }
    });

    /* ────────────────────────────────────────────────────────────── */
    /* SESSION LIFECYCLE EVENTS                                        */
    /* ────────────────────────────────────────────────────────────── */

    const Booking = require('./models/Booking');

    /**
     * User joins a booked session.
     * Event: "session-join"
     * Data: { bookingId }
     *
     * When both participants have joined, emits "session-started" to both.
     */
    socket.on('session-join', async (payload) => {
      const { bookingId } = payload || {};
      if (!bookingId) {
        socket.emit('session-error', { message: 'bookingId is required.' });
        return;
      }

      try {
        const booking = await Booking.findById(bookingId);
        if (!booking) {
          socket.emit('session-error', { message: 'Session not found.' });
          return;
        }

        const isStudent = String(booking.studentId) === userId;
        const isTeacher = String(booking.teacherId) === userId;
        if (!isStudent && !isTeacher) {
          socket.emit('session-error', { message: 'You are not a participant.' });
          return;
        }

        if (!['accepted', 'ongoing'].includes(booking.status)) {
          socket.emit('session-error', { message: `Cannot join session with status "${booking.status}".` });
          return;
        }

        // Mark joined
        if (isStudent) booking.studentJoined = true;
        if (isTeacher) booking.teacherJoined = true;

        // Notify the other participant that this user joined
        const otherParticipantId = isStudent ? String(booking.teacherId) : String(booking.studentId);
        const otherSocket = onlineUsers.get(otherParticipantId);
        if (otherSocket) {
          io.to(otherSocket.socketId).emit('session-user-joined', {
            bookingId,
            userId,
            role: isStudent ? 'student' : 'teacher',
          });
        }

        // If both joined and session hasn't started yet → start
        if (booking.studentJoined && booking.teacherJoined && !booking.startTime) {
          booking.startTime = new Date();
          booking.status = 'ongoing';
          await booking.save();

          const startPayload = {
            bookingId,
            startTime: booking.startTime.toISOString(),
            channelName: booking.channelName,
          };

          // Emit to both participants
          socket.emit('session-started', startPayload);
          if (otherSocket) {
            io.to(otherSocket.socketId).emit('session-started', startPayload);
          }

          console.log(`[Session] Session ${bookingId} started — both participants joined.`);
        } else {
          await booking.save();
          socket.emit('session-waiting', {
            bookingId,
            waitingFor: isStudent ? 'teacher' : 'student',
            studentJoined: booking.studentJoined,
            teacherJoined: booking.teacherJoined,
          });
        }
      } catch (err) {
        console.error('[Session] Join error:', err);
        socket.emit('session-error', { message: 'Failed to join session.' });
      }
    });

    /**
     * Either party ends a session.
     * Event: "session-end"
     * Data: { bookingId }
     *
     * Calculates actual duration, transfers credits, emits "session-completed" to both.
     */
    socket.on('session-end', async (payload) => {
      const { bookingId } = payload || {};
      if (!bookingId) {
        socket.emit('session-error', { message: 'bookingId is required.' });
        return;
      }

      try {
        const booking = await Booking.findById(bookingId);
        if (!booking) {
          socket.emit('session-error', { message: 'Session not found.' });
          return;
        }

        const isStudent = String(booking.studentId) === userId;
        const isTeacher = String(booking.teacherId) === userId;
        if (!isStudent && !isTeacher) {
          socket.emit('session-error', { message: 'You are not a participant.' });
          return;
        }

        if (booking.status === 'completed') {
          console.log(`[Session] Session ${bookingId} was already completed; ignoring duplicate end request.`);
          return;
        }

        const now = new Date();
        booking.endTime = now;
        booking.status = 'completed';

        let creditsUsed = 0;
        let actualDurationMinutes = 0;

        if (booking.startTime) {
          const teacher = await User.findById(booking.teacherId).select('teacherProfile.creditRate').lean();
          const creditCalculation = calculateSessionCredits({
            startTime: booking.startTime,
            endTime: now,
            creditRate: teacher?.teacherProfile?.creditRate || 30,
          });

          actualDurationMinutes = creditCalculation.actualDurationMinutes;
          booking.actualDuration = creditCalculation.roundedDurationMinutes;
          creditsUsed = creditCalculation.creditsUsed;
          booking.creditsUsed = creditsUsed;

          // Atomic credit transfer
          const studentUpdate = await User.findOneAndUpdate(
            { _id: booking.studentId, learningCredits: { $gte: creditsUsed } },
            { $inc: { learningCredits: -creditsUsed } },
            { new: true },
          );

          if (studentUpdate) {
            await User.findByIdAndUpdate(booking.teacherId, { $inc: { learningCredits: creditsUsed } });
          } else {
            const student = await User.findById(booking.studentId);
            if (student && student.learningCredits > 0) {
              creditsUsed = student.learningCredits;
              booking.creditsUsed = creditsUsed;
              await User.findByIdAndUpdate(booking.studentId, { learningCredits: 0 });
              await User.findByIdAndUpdate(booking.teacherId, { $inc: { learningCredits: creditsUsed } });
            } else {
              creditsUsed = 0;
              booking.creditsUsed = 0;
            }
          }

          await User.findByIdAndUpdate(booking.teacherId, { $inc: { 'teacherProfile.successfulSessionCount': 1 } });
        } else {
          booking.actualDuration = 0;
          booking.creditsUsed = 0;
        }

        await booking.save();

        const [studentFinal, teacherFinal] = await Promise.all([
          User.findById(booking.studentId, 'learningCredits').lean(),
          User.findById(booking.teacherId, 'learningCredits').lean(),
        ]);
        const teacherAfterStats = await User.findById(booking.teacherId, 'teacherProfile.successfulSessionCount').lean();
        const successfulSessions = Number(teacherAfterStats?.teacherProfile?.successfulSessionCount) || 0;

        const completedPayload = {
          bookingId,
          creditsUsed,
          actualDurationMinutes: Math.round(actualDurationMinutes),
          studentCreditsRemaining: studentFinal?.learningCredits ?? 0,
          teacherCreditsTotal: teacherFinal?.learningCredits ?? 0,
          teacherSessionStats: {
            successfulSessions,
            tier: successfulSessions >= 30 ? 'Diamond' : successfulSessions >= 10 ? 'Gold' : 'Bronze',
          },
          endedBy: userId,
        };

        // Emit to both participants
        socket.emit('session-completed', completedPayload);
        const otherParticipantId = isStudent ? String(booking.teacherId) : String(booking.studentId);
        const otherSocket = onlineUsers.get(otherParticipantId);
        if (otherSocket) {
          io.to(otherSocket.socketId).emit('session-completed', completedPayload);
        }

        console.log(`[Session] Session ${bookingId} completed. ${creditsUsed} credits transferred.`);
      } catch (err) {
        console.error('[Session] End error:', err);
        socket.emit('session-error', { message: 'Failed to end session.' });
      }
    });

    /* ────────────────────────────────────────────────────────────── */
    /* DISCONNECT EVENT */
    /* ────────────────────────────────────────────────────────────── */

    socket.on('disconnect', () => {
      console.log(`[Socket] User ${userId} disconnected: ${socket.id}`);

      onlineUsers.delete(userId);

      User.updateOne(
        { _id: userId },
        {
          onlineStatus: 'offline',
          lastSeen: new Date(),
        },
      ).catch(console.error);

      io.emit('user-offline', { userId, timestamp: new Date(), activeMode });
    });
  });
}

/**
 * Get list of online users
 */
function getOnlineUsers() {
  return Array.from(onlineUsers.entries()).map(([userId, data]) => ({
    userId,
    ...data,
  }));
}

/**
 * Get typing users in a conversation
 */
function getTypingUsers(conversationId) {
  return Array.from(typingUsers.get(conversationId) || []);
}

module.exports = setupSocketHandlers;
