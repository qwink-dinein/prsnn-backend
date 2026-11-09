
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import Booking from "../models/Booking.js";
import Message from "../models/Message.js";
import { maskPhoneNumber } from "../utils/maskPhoneNumber.js";

const MAX_MESSAGE_LENGTH = 1000;


const initializeSocket = (server) => {
  const allowedOrigins = process.env.FRONTEND_URL 
    ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
    : ["http://localhost:3000"];

  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      credentials: true
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Authentication error: No token provided"));
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Map userId from token to id if present, to standardize
      if (decoded.userId && !decoded.id) {
          decoded.id = decoded.userId;
      }
      socket.user = decoded;
      next();
    } catch (err) {
      return next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}, User ID: ${socket.user.id}`);

    socket.on("join_room", async ({ bookingId }) => {
      try {
        const booking = await Booking.findById(bookingId);

        if (!booking) {
          socket.emit("error", "Booking not found");
          return;
        }

        // Check if the user is part of the booking
        const isParticipant =
          booking.requesterId.toString() === socket.user.id ||
          booking.companionId.toString() === socket.user.id;

        if (!isParticipant) {
          socket.emit("error", "Unauthorized access to booking chat");
          return;
        }

        if (!["accepted", "completed", "cancelled"].includes(booking.status)) {
          socket.emit("error", "Chat is not available for this booking status");
          return;
        }

        // The paywall was previously enforced only by the /session page, so a
        // requester could open a socket straight to an unpaid booking and chat
        // for free. The companion is exempt: they are owed the money, not paying it.
        const isCompanion = booking.companionId.toString() === socket.user.id;
        if (!isCompanion && booking.paymentStatus !== 'paid') {
          socket.emit("error", "Payment is required before entering this session.");
          return;
        }

        socket.join(bookingId);
        console.log(`User ${socket.user.id} joined room ${bookingId}`);

        // Load previous messages
        const messages = await Message.find({ bookingId }).sort({ createdAt: 1 });
        
        // Mask messages where the current user is the receiver
        const processedMessages = messages.map(msg => {
            const messageObj = msg.toObject ? msg.toObject() : msg;
            if (messageObj.senderId.toString() !== socket.user.id.toString()) {
                messageObj.content = maskPhoneNumber(messageObj.content);
            }
            return messageObj;
        });

        socket.emit("previous_messages", processedMessages);

        if (booking.status === 'cancelled' || booking.status === 'completed') {
            socket.emit("session_cancelled");
        }

      } catch (error) {
        console.error("Error joining room:", error);
        socket.emit("error", "Server error while joining room");
      }
    });

    socket.on("send_message", async ({ bookingId, message }) => {
      try {
        if (typeof message !== 'string' || !message.trim()) return;

        if (message.length > MAX_MESSAGE_LENGTH) {
          socket.emit("error", `Message exceeds ${MAX_MESSAGE_LENGTH} character limit.`);
          return;
        }

        const isParticipant =
          socket.rooms.has(bookingId);
        if (!isParticipant) {
          socket.emit("error", "You must join the room before sending messages.");
          return;
        }

        const booking = await Booking.findById(bookingId).select('status requesterId companionId');
        if (!booking || booking.status !== 'accepted') {
             socket.emit("error", "Cannot send message. Booking is not active.");
             return;
        }

        const newMessage = new Message({
          bookingId,
          senderId: socket.user.id,
          content: message.trim(),
        });

        await newMessage.save();

        // Echo the original unmasked message back to the sender
        socket.emit("receive_message", newMessage);

        // Apply masking for the receiver
        const maskedMessageObj = {
            ...(newMessage.toObject ? newMessage.toObject() : newMessage),
            content: maskPhoneNumber(newMessage.content)
        };

        // Send the masked message to everyone else in the room (the receiver)
        socket.to(bookingId).emit("receive_message", maskedMessageObj);
      } catch (error) {
        console.error("Error sending message:", error);
        socket.emit("error", "Server error while sending message");
      }
    });

    socket.on("cancel_session", ({ bookingId }) => {
      // Broadcast to all users in the room
      io.to(bookingId).emit("session_cancelled");
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  return io;
};

export default initializeSocket;
