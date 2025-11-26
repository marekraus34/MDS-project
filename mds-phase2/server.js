const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

// statické soubory (public/)
app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join", (room) => {
    console.log(`Socket ${socket.id} join room ${room}`);
    socket.join(room);
    socket.data.room = room;
  });

  // přeposílání WebRTC signalizace (simple-peer)
  socket.on("signal", ({ room, data }) => {
    socket.to(room).emit("signal", data);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server běží na http://localhost:${PORT}`);
  console.log(`Sender:  http://localhost:${PORT}/sender.html`);
  console.log(`Viewer:  http://localhost:${PORT}/viewer.html`);
});
