require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const crypto = require("crypto");

const App = () => {
  const app = express();
  const server = http.createServer(app);
  app.use(cors());
  app.use('/media', express.static(path.join(__dirname, 'public/images')));
  app.use('/media', express.static(path.join(__dirname, 'public/sounds')));

  return server;
}

const server = App();

const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'development' 
      ? 'http://localhost:3003' 
      : 'https://socket-io-react-quiz-client.vercel.app',
    methods: ['GET', 'POST']
  }
})

const randomId = () => crypto.randomBytes(8).toString("hex");

function generateRandomSixDigitNumber() {
  const min = 100000;
  const max = 999999;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRoomUsers(roomID) {
  const roomUsers = [];
  const allUsers = userStore.findAllUserValues();
  for (let user of allUsers) {
    if (user.joined_room_id === roomID) {
      roomUsers.push({
        userID: user.userID,
        username: user.username,
        connected: user.connected
      })
    }
  }
  return roomUsers;
}

const { InMemoryUserStore } = require("./user_store");
const userStore = new InMemoryUserStore();

const { InMemoryRoomStore } = require("./room_store");
const roomStore = new InMemoryRoomStore();

io.use(async (socket, next) => {
  const sessionID = socket.handshake.auth.sessionID;
  const sockets = await io.fetchSockets();
  if (sockets.some(s => s.sessionID === sessionID)) {
    return next(new Error('Already connected'));
  }
  if (sessionID) {
    const session = userStore.findUser(sessionID);
    if (session) {
      // User found, set online
      socket.sessionID = sessionID;
      socket.userID = session.userID;
      socket.username = session.username;
      
      userStore.saveUser(socket.sessionID, {
        ...session,
        connected: true
      })
      return next();
    }
  }

  // Create a new user
  socket.sessionID = randomId();
  socket.userID = randomId();
  userStore.saveUser(socket.sessionID, {
    userID: socket.userID,
    connected: true
  })
  next();
});

io.on('connection', async socket => {
  const hostedRoom = roomStore.findRoom(socket.userID);
  const user = userStore.findUser(socket.sessionID);
  let joinedRoom;

  if (user.joined_room_id) {
    const room = roomStore.findRoom(user.joined_room_id);
    if (room) {
      joinedRoom = room;
    } else {
      userStore.saveUser(socket.sessionID, {
        ...user,
        joined_room_id: undefined
      });
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
      const roomUsers = getRoomUsers(user.joined_room_id);
      socket.emit("users", roomUsers);
      socket.emit("room details", joinedRoom);
    }
  }

  socket.on('create room', (words) => {
    const roomPin = generateRandomSixDigitNumber();

    roomStore.saveRoom(socket.userID, {
      room_pin: roomPin,
      questions: [...words],
      answers: []
    });
    socket.join(socket.userID);
    const user = userStore.findUser(socket.sessionID);

    userStore.saveUser(socket.sessionID, {
      ...user,
      username: '',
      joined_room_id: socket.userID
    });

    socket.emit('room created', roomPin);
  });

  socket.on('delete room', () => {
    roomStore.deleteRoom(socket.userID);
    socket.leave(socket.userID);
    socket.broadcast.to(socket.userID).emit('room error', 'Room was closed');
    io.socketsLeave(socket.userID);
    const users = userStore.findAllUsers();
    for (const [sessionID, user] of users) {
      if (user.joined_room_id === socket.userID) {
        userStore.saveUser(sessionID, {
          ...user,
          joined_room_id: undefined,
          username: ''
        });
      }
    }
  });

  socket.on('leave room', () => {
    const user = userStore.findUser(socket.sessionID);
    socket.broadcast.to(user.joined_room_id).emit("user disconnected", socket.userID);
    socket.leave(user.joined_room_id);
    userStore.saveUser(socket.sessionID, {
      ...user,
      username: '',
      joined_room_id: undefined
    });
  })

  socket.on('restart round', () => {
    const room = roomStore.findRoom(socket.userID);
    roomStore.saveRoom(socket.userID, {
      ...room,
      answers: [],
      roundStarted: false,
      roundEnded: false
    });
    socket.broadcast.to(socket.userID).emit('restart round');
  });

  socket.on('join room', async (roomPin) => {
    const room = roomStore.findRoomByPin(roomPin);
    if (!room) {
      return socket.emit('join room', 'Invalid room');
    }

    socket.join(room.room_id);
    const user = userStore.findUser(socket.sessionID);
    userStore.saveUser(socket.sessionID, {
      ...user,
      joined_room_id: room.room_id
    });

    // fetch existing users
    const roomUsers = getRoomUsers(room.room_id);
    socket.emit("users", roomUsers, room);
    socket.emit('join room', room);
    socket.broadcast.to(room.room_id).emit('user connected', {userID: socket.userID, connected: true});
  });

  socket.on('create username', (username) => {
    const user = userStore.findUser(socket.sessionID);
    const allUsers = userStore.findAllUserValues();
    const roomUsers = allUsers.filter(u => 
      u.joined_room_id === user.joined_room_id && u.userID !== socket.userID);
    if (roomUsers.some(user => user.username 
        ? user.username.trim() === username.trim()
        : false)) {
      return socket.emit('room error', 'Username taken');
    }

    if (user) {
      userStore.saveUser(socket.sessionID, {
        ...user,
        username: username
      })
    }
    socket.username = username;
    socket.emit('create username', 'created');
    io.to(user.joined_room_id).emit('update username', {userID: socket.userID, username: username});
  })

  socket.on('round started', () => {
    const room = roomStore.findRoom(socket.userID);
    if (room) {
      roomStore.saveRoom(socket.userID, {
        ...room,
        roundStarted: true
      });
    }
    io.to(user.userID).emit('round started');
  });

  socket.on('round ended', () => {
    const room = roomStore.findRoom(socket.userID);
    if (room) {
      roomStore.saveRoom(socket.userID, {
        ...room,
        roundEnded: true
      });
    }
    io.to(user.userID).emit('round ended');
  });

  socket.on('answer', (question_id, is_correct) => {
    const user = userStore.findUser(socket.sessionID);
    const answer = {
      is_correct: is_correct,
      question_id: question_id,
      userID: socket.userID
    };
    roomStore.addAnswer(user.joined_room_id, answer);
    io.to(user.joined_room_id).emit("answer", answer);
  })

  // notify users upon disconnection
  socket.on("disconnect", async () => {
    const user = userStore.findUser(socket.sessionID);
      userStore.saveUser(socket.sessionID, {
        ...user,
        connected: false
      })
      if (user.joined_room_id) {
        socket.broadcast.to(user.joined_room_id).emit("user disconnected", 
          socket.userID);
      }
  });
})

server.listen(3002, () => (
  console.log('Listening on port 3002')
))