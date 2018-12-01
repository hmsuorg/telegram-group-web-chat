const telegraf = require("telegraf");
const log = msg => { msg = `[${new Date().toISOString()}] ${msg}`; console.log(msg); };
const express = require("express");
const app = express();
const path = require("path");
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 3000;
const groupId = Number(process.env.GROUP_ID);

// chat history
let chatHistory = [];
const chatHistoryLimit = 50;
const addChatHistory = (username, message) => {
	chatHistory.push({
		timestamp: new Date().getTime(),
		username: username,
		message: message
	});
	if(chatHistory.length > 50) chatHistory.shift();
};

// telegram bot
const memberToString = member => member.username || `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.id;
const handleMessage = ctx => {
	if(ctx.update.message.chat.id === groupId) {
		io.sockets.emit("new message", {
			username: memberToString(ctx.update.message.from),
			message: ctx.update.message.text
		});
		addChatHistory(memberToString(ctx.update.message.from), ctx.update.message.text);
		log(`${memberToString(ctx.update.message.from)}: ${ctx.update.message.text}`);
	} else {
		log(`Message outside scope >> (id: ${ctx.update.message.chat.id}, username: ${ctx.update.message.from.username}, type: ${ctx.update.message.chat.type}) >> ${memberToString(ctx.update.message.from)}: ${ctx.update.message.text}`);
	}
}
const bot = new telegraf(process.env.BOT_TOKEN);
bot.on("text", ctx => handleMessage(ctx));
bot.startPolling();

// socket.io server
server.listen(port, () => {
	log(`Server listening at port ${port}`);
});

// routing
app.use(express.static(path.join(__dirname, "public")));

// chatroom
let numUsers = 0;

io.on("connection", (socket) => {
	let addedUser = false;

	// when the client emits "new message", this listens and executes
	socket.on("new message", (data) => {
		// we tell the client to execute "new message"
		socket.broadcast.emit("new message", {
			username: socket.username,
			message: data
		});
		bot.telegram.sendMessage(groupId, `${socket.username}: ${data}`);
		log(`${socket.username}: ${data}`);
		addChatHistory(socket.username, data);
	});

	// when the client emits "add user", this listens and executes
	socket.on("add user", (username) => {
		if (addedUser) return;

		// we store the username in the socket session for this client
		socket.username = username;
		++numUsers;
		addedUser = true;
		socket.emit("login", {
			numUsers: numUsers,
			history: chatHistory
		});
		// echo globally (all clients) that a person has connected
		socket.broadcast.emit("user joined", {
			username: socket.username,
			numUsers: numUsers
		});
		log(`${socket.username} joined`);
	});

	// when the client emits "typing", we broadcast it to others
	socket.on("typing", () => {
		socket.broadcast.emit("typing", {
			username: socket.username
		});
	});

	// when the client emits "stop typing", we broadcast it to others
	socket.on("stop typing", () => {
		socket.broadcast.emit("stop typing", {
			username: socket.username
		});
	});

	// when the user disconnects.. perform this
	socket.on("disconnect", () => {
		if(addedUser) {
			--numUsers;

			// echo globally that this client has left
			socket.broadcast.emit("user left", {
				username: socket.username,
				numUsers: numUsers
			});
		}
		if(socket.username) {
			log(`${socket.username} left`);
		}
	});
});
