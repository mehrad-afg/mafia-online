const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

// -------------------------
// وضعیت بازی
// -------------------------

const lobbies = new Map();
let nextLobbyId = 1;

// -------------------------
// HTTP Server
// -------------------------

const server = http.createServer((req, res) => {

    let filePath;

    if (req.url === "/") {
        filePath = path.join(__dirname, "index.html");
    } else {
        filePath = path.join(
            __dirname,
            "public",
            req.url
        );
    }

    fs.readFile(filePath, (err, data) => {

        if (err) {
            res.writeHead(404);
            res.end("Not Found");
            return;
        }

        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        res.end(data);
    });
});

// -------------------------
// WebSocket
// -------------------------

const wss = new WebSocket.Server({ server });

function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcastLobby(lobby) {

    const players = lobby.players.map(player => ({
        name: player.name
    }));

    lobby.players.forEach(player => {

        send(player.ws, {
            type: "LOBBY_UPDATE",
            lobbyId: lobby.id,
            players: players,
            maxPlayers: 2
        });

    });
}

function startGame(lobby) {

    if (lobby.started) {
        return;
    }

    lobby.started = true;

    lobby.players.forEach(player => {

        send(player.ws, {
            type: "GAME_STARTED",
            message: "🎭 بازی شروع شد!"
        });

    });

    console.log(
        `Lobby ${lobby.id} started with ${lobby.players.length} players.`
    );
}

wss.on("connection", (ws) => {

    console.log("Player connected.");

    let currentPlayer = null;
    let currentLobby = null;

    send(ws, {
        type: "CONNECTED",
        message: "به سرور مافیا وصل شدی!"
    });

    ws.on("message", (rawMessage) => {

        let message;

        try {
            message = JSON.parse(rawMessage.toString());
        } catch (error) {

            send(ws, {
                type: "ERROR",
                message: "پیام نامعتبر است."
            });

            return;
        }

        // -------------------------
        // ثبت نام
        // -------------------------

        if (message.type === "REGISTER") {

            const name = String(message.name || "").trim();

            if (!name) {

                send(ws, {
                    type: "ERROR",
                    message: "نام بازیکن را وارد کن."
                });

                return;
            }

            currentPlayer = {
                ws: ws,
                name: name
            };

            send(ws, {
                type: "REGISTERED",
                name: name,
                message: `✅ ${name} ثبت شد.`
            });

            return;
        }

        // -------------------------
        // ساخت لابی
        // -------------------------

        if (message.type === "CREATE_LOBBY") {

            if (!currentPlayer) {

                send(ws, {
                    type: "ERROR",
                    message: "اول نامت را ثبت کن."
                });

                return;
            }

            if (currentLobby) {

                send(ws, {
                    type: "ERROR",
                    message: "تو قبلاً داخل یک لابی هستی."
                });

                return;
            }

            const lobbyId = String(nextLobbyId++);

            const lobby = {
                id: lobbyId,
                players: [],
                started: false
            };

            lobby.players.push(currentPlayer);

            lobbies.set(lobbyId, lobby);

            currentLobby = lobby;

            send(ws, {
                type: "LOBBY_CREATED",
                lobbyId: lobbyId,
                message: `🎮 لابی ${lobbyId} ساخته شد.`
            });

            broadcastLobby(lobby);

            console.log(
                `Lobby ${lobbyId} created by ${currentPlayer.name}`
            );

            return;
        }

        // -------------------------
        // دریافت لیست لابی‌ها
        // -------------------------

        if (message.type === "GET_LOBBIES") {

            const availableLobbies = [];

            lobbies.forEach(lobby => {

                if (!lobby.started && lobby.players.length < 2) {

                    availableLobbies.push({
                        id: lobby.id,
                        players: lobby.players.map(player => player.name),
                        count: lobby.players.length,
                        maxPlayers: 2
                    });

                }

            });

            send(ws, {
                type: "LOBBIES",
                lobbies: availableLobbies
            });

            return;
        }

        // -------------------------
        // ورود به لابی
        // -------------------------

        if (message.type === "JOIN_LOBBY") {

            if (!currentPlayer) {

                send(ws, {
                    type: "ERROR",
                    message: "اول نامت را ثبت کن."
                });

                return;
            }

            if (currentLobby) {

                send(ws, {
                    type: "ERROR",
                    message: "تو قبلاً داخل یک لابی هستی."
                });

                return;
            }

            const lobby = lobbies.get(String(message.lobbyId));

            if (!lobby) {

                send(ws, {
                    type: "ERROR",
                    message: "این لابی وجود ندارد."
                });

                return;
            }

            if (lobby.started) {

                send(ws, {
                    type: "ERROR",
                    message: "این بازی قبلاً شروع شده."
                });

                return;
            }

            if (lobby.players.length >= 2) {

                send(ws, {
                    type: "ERROR",
                    message: "این لابی پر است."
                });

                return;
            }

            lobby.players.push(currentPlayer);

            currentLobby = lobby;

            send(ws, {
                type: "JOINED_LOBBY",
                lobbyId: lobby.id,
                message: `✅ وارد لابی ${lobby.id} شدی.`
            });

            broadcastLobby(lobby);

            console.log(
                `${currentPlayer.name} joined lobby ${lobby.id}`
            );

            // شروع خودکار با رسیدن به ۲ نفر
            if (lobby.players.length === 2) {
                startGame(lobby);
            }

            return;
        }

        // -------------------------
        // پیام ناشناخته
        // -------------------------

        send(ws, {
            type: "ERROR",
            message: "دستور ناشناخته است."
        });

    });

    // -------------------------
    // قطع اتصال
    // -------------------------

    ws.on("close", () => {

        console.log("Player disconnected.");

        if (currentLobby && currentPlayer) {

            currentLobby.players =
                currentLobby.players.filter(
                    player => player.ws !== ws
                );

            if (currentLobby.players.length === 0) {

                lobbies.delete(currentLobby.id);

                console.log(
                    `Lobby ${currentLobby.id} deleted.`
                );

            } else {

                broadcastLobby(currentLobby);

            }

        }

    });

});

// -------------------------
// شروع سرور
// -------------------------

server.listen(PORT, "0.0.0.0", () => {

    console.log(
        `Mafia server running on port ${PORT}`
    );

});
