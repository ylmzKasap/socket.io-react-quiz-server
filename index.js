require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const crypto = require("crypto");
const { createClient } = require('redis');

async function main() {
  // Redis connection
  const client = createClient({url:
    process.env.NODE_ENV === 'production' 
      ? process.env.REDIS_PASSWORD 
      : undefined});
  client.on('error', err => console.log('Redis Client Error', err));
  await client.connect();

  const App = async () => {
    const app = express();
    const server = http.createServer(app);
  
    app.use(cors());
    app.use('/media', express.static(path.join(__dirname, 'public/images')));
  
    return server;
  }
  
  const server = await App();
  
  const io = new Server(server, {
    cors: {
      origin: process.env.NODE_ENV === 'development' 
        ? 'http://localhost:3003' 
        : 'https://react-live-quiz.vercel.app',
      methods: ['GET', 'POST']
    }
  })
  
  const randomId = () => crypto.randomBytes(8).toString("hex");
  
  function generateRandomSixDigitNumber() {
    const min = 100000;
    const max = 999999;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  
  async function getRoomUsers(roomID) {
    const roomUsers = [];
    const allUsers = await sessionStore.findAllSessions()
    for (let user of allUsers) {
      if (user.joined_room_id === roomID) {
        roomUsers.push({
          userID: user.userID,
          username: user.username || '',
          connected: user.connected === 'true'
        })
      }
    }
    return roomUsers;
  }

  async function registerUser(socket) {
    const sessionID = socket.handshake.auth.sessionID;
    const sockets = await io.fetchSockets();
    if (sockets.some(s => s.sessionID === sessionID)) {
      throw new Error('Already connected');
    }
    if (sessionID) {
      const session = await sessionStore.findSession(sessionID)
      if (session) {
        // User found, set online
        socket.sessionID = sessionID;
        socket.userID = session.userID;
        socket.username = session.username;
        
        await sessionStore.setConnected(sessionID, 'true');
        return;
      }
    }
  
    // Create a new user
    socket.sessionID = randomId();
    socket.userID = randomId();
    await sessionStore.saveSession(socket.sessionID, socket.userID)
    socket.emit("session", {
      sessionID: socket.sessionID,
      userID: socket.userID
    });
  }

  const { RedisSessionStore } = require("./session_store");
  const sessionStore = new RedisSessionStore(client);
  
  const { RedisRoomStore } = require("./room_store");
  const roomStore = new RedisRoomStore(client);
  
  io.use(async (socket, next) => {
    try {
      await registerUser(socket);
    } catch (err) {
      next(new Error(err))
    }

    next();
  });
  
  io.on('connection', async socket => {
    const hostedRoom = await roomStore.findRoom(socket.userID);
    const user = await sessionStore.findSession(socket.sessionID)
    let joinedRoom;

    if (!user) {
      return socket.emit('room error', 'Session expired, refresh the page');
    }
  
    if (user.joined_room_id) {
      const room = await roomStore.findRoom(user.joined_room_id);
      if (room) {
        joinedRoom = room;
      } else {
        await sessionStore.setJoinedRoomID(socket.sessionID, '');
      }
    }
  
    // emit session details
    socket.emit("session", {
      sessionID: socket.sessionID,
      userID: socket.userID,
      username: socket.username,
      hostedRoom: hostedRoom,
      joinedRoomID: joinedRoom ? user.joined_room_id : undefined
    });
  
    if (user.joined_room_id) {
      if (joinedRoom) {
        socket.join(user.joined_room_id);
        socket.broadcast.to(user.joined_room_id).emit('user connected',
          {userID: socket.userID, username: socket.username, connected: true}
        );
        const roomUsers = await getRoomUsers(user.joined_room_id);
        socket.emit("users", roomUsers);
        socket.emit("room details", joinedRoom);
      }
    }
  
    socket.on('create room', async (words) => {
      const user = await sessionStore.findSession(socket.sessionID)

      if (!user || !user.userID) {
        return socket.emit('room error', 'Session expired, refresh the page');
      }

      const roomPin = generateRandomSixDigitNumber();
  
      await roomStore.saveRoom(socket.userID, roomPin, [...words]);
      socket.join(socket.userID);
  
      await sessionStore.setJoinedRoomAndUsername(socket.sessionID, socket.userID, '');
      socket.emit('room created', roomPin);
    });
  
    socket.on('delete room', async () => {
      await roomStore.deleteRoom(socket.userID);
      socket.leave(socket.userID);
      socket.broadcast.to(socket.userID).emit('room error', 'Room was closed');
      io.socketsLeave(socket.userID);
      const users = await sessionStore.findAllSessions()
      for (const {sessionID, joined_room_id} of users) {
        if (joined_room_id === socket.userID) {
          await sessionStore.setJoinedRoomAndUsername(sessionID, '', '');
        }
      }
    });
  
    socket.on('leave room', async () => {
      const user = await sessionStore.findSession(socket.sessionID);
      if (user) {
        socket.broadcast.to(user.joined_room_id).emit("user disconnected", socket.userID);
        socket.leave(user.joined_room_id);
      }
      await sessionStore.setJoinedRoomAndUsername(socket.sessionID, '', '');
    })
  
    socket.on('restart round', async () => {
      const room = await roomStore.findRoom(socket.userID);
      if (!room) {
        return socket.emit('room error', 'Room expired');
      }
      await roomStore.restartRound(socket.userID);
      socket.broadcast.to(socket.userID).emit('restart round');
    });
  
    socket.on('join room', async (roomPin) => {
      const room = await roomStore.findRoomByPin(roomPin);
      const user = await sessionStore.findSession(socket.sessionID);

      if (!room) {
        return socket.emit('join room', 'Invalid room');
      }

      if (!user) {
        return socket.emit('join room', 'Session expired, refresh the page');
      }
  
      socket.join(room.room_id);
      await sessionStore.setJoinedRoomID(socket.sessionID, room.room_id);
  
      // fetch existing users
      const roomUsers = await getRoomUsers(room.room_id);
      socket.emit("users", roomUsers, room);
      socket.emit('join room', room);
      socket.broadcast.to(room.room_id).emit('user connected', {userID: socket.userID, connected: true});
    });
  
    socket.on('create username', async (username) => {
      const user = await sessionStore.findSession(socket.sessionID);
      if (!user) {
        return socket.emit('room error', 'Session expired, refresh the page');
      }

      if (user) {
        const allUsers = await sessionStore.findAllSessions()
        const roomUsers = allUsers.filter(u => 
        u.joined_room_id === user.joined_room_id && u.userID !== socket.userID);

        if (roomUsers.some(user => user.username 
            ? user.username.trim() === username.trim()
            : false)) {
          return socket.emit('room error', 'Username taken');
        }
    
        await sessionStore.setUsername(socket.sessionID, username);
        socket.username = username;
        socket.emit('create username', 'created');
        io.to(user.joined_room_id).emit('update username', {userID: socket.userID, username: username});
      }
    })
  
    socket.on('round started', async () => {
      const room = await roomStore.findRoom(socket.userID);
      if (room) {
        await roomStore.setRoundStarted(socket.userID, true);
        io.to(user.userID).emit('round started');
      } else {
        return socket.emit('room error', 'Room expired');
      }
    });
  
    socket.on('round ended', async () => {
      const room = await roomStore.findRoom(socket.userID);
      if (room) {
        await roomStore.setRoundEnded(socket.userID, true);
        io.to(user.userID).emit('round ended');
      } else {
        return socket.emit('room error', 'Room expired');
      }
    });
  
    socket.on('answer', async (question_id, is_correct) => {
      const user = await sessionStore.findSession(socket.sessionID);
      if (user) {
        const answer = {
          is_correct: is_correct,
          question_id: question_id,
          username: socket.username,
          userID: socket.userID
        };
        await roomStore.addAnswer(user.joined_room_id, answer);
        io.to(user.joined_room_id).emit("answer", answer);
      }
    })
  
    // notify users upon disconnection
    socket.on("disconnect", async () => {
      const user = await sessionStore.findSession(socket.sessionID);
        if (user) {
          await sessionStore.setConnected(socket.sessionID, 'false');
          if (user.joined_room_id) {
            socket.broadcast.to(user.joined_room_id).emit("user disconnected", 
              socket.userID);
          }
        }
    });
  })
  
  server.listen(3002, () => (
    console.log('Listening on port 3002')
  ))
}

main();
