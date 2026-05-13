const WebSocket = require('ws');
const http = require('http');
const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    if (req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            robotConnected: robotSocket !== null && robotSocket.readyState === WebSocket.OPEN,
            meseros: meseroSockets.size,
            cocinas: cocinaSockets.size
        }));
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Restaurant Robot Relay running');
});

const wss = new WebSocket.Server({ server });

let robotSocket = null;
const meseroSockets = new Set();
const cocinaSockets = new Set();

function sendToRobot(data) {
    if (robotSocket && robotSocket.readyState === WebSocket.OPEN) {
        robotSocket.send(typeof data === 'string' ? data : JSON.stringify(data));
        return true;
    }
    return false;
}

function sendToAllMeseros(data) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    meseroSockets.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
}

function sendToAllCocinas(data) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    cocinaSockets.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
}

function broadcastAll(data) {
    sendToAllMeseros(data);
    sendToAllCocinas(data);
}

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const type = url.searchParams.get('type');
    const secret = url.searchParams.get('secret');

    if (secret !== process.env.SECRET || !secret) {
        console.log('Conexión rechazada: secret inválido');
        ws.close(1008, 'Unauthorized');
        return;
    }

    // ── ROBOT ──────────────────────────────────────────────
    if (type === 'robot') {
        robotSocket = ws;
        console.log('✅ Robot conectado');
        broadcastAll({ type: 'robot_status', connected: true });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.action === 'llegueAMesa') {
                    sendToAllMeseros({ type: 'robot_en_mesa', mesa: msg.mesa });
                }
                if (msg.action === 'nuevoPedido') {
                    sendToAllCocinas({ type: 'nuevo_pedido', mesa: msg.mesa, items: msg.items, hora: new Date().toLocaleTimeString() });
                    sendToAllMeseros({ type: 'pedido_recibido', mesa: msg.mesa });
                }
                if (msg.action === 'entregaCompletada') {
                    sendToAllMeseros({ type: 'entrega_completada', mesa: msg.mesa });
                }
                if (msg.action === 'estadoRobot') {
                    broadcastAll({ type: 'estado_robot', bateria: msg.bateria, ubicacion: msg.ubicacion });
                }
            } catch (e) {
                console.error('Error robot:', e.message);
            }
        });

        ws.on('close', () => {
            console.log('❌ Robot desconectado');
            robotSocket = null;
            broadcastAll({ type: 'robot_status', connected: false });
        });

        ws.on('error', (err) => console.error('Robot error:', err.message));

    // ── MESERO ─────────────────────────────────────────────
    } else if (type === 'mesero') {
        meseroSockets.add(ws);
        console.log(`👨‍🍳 Mesero conectado (total: ${meseroSockets.size})`);
        ws.send(JSON.stringify({
            type: 'robot_status',
            connected: robotSocket !== null && robotSocket.readyState === WebSocket.OPEN
        }));

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.action === 'irAMesa') {
                    if (!sendToRobot({ action: 'irAMesa', mesa: msg.mesa })) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Robot no conectado' }));
                    } else {
                        broadcastAll({ type: 'robot_navegando', mesa: msg.mesa });
                    }
                }
                if (msg.action === 'irACocina') {
                    sendToRobot({ action: 'irACocina' });
                    broadcastAll({ type: 'robot_navegando', destino: 'cocina' });
                }
                if (msg.action === 'irARecepcion') {
                    sendToRobot({ action: 'irARecepcion' });
                    broadcastAll({ type: 'robot_navegando', destino: 'recepcion' });
                }
            } catch (e) {
                console.error('Error mesero:', e.message);
            }
        });

        ws.on('close', () => {
            meseroSockets.delete(ws);
            console.log(`👨‍🍳 Mesero desconectado (total: ${meseroSockets.size})`);
        });

        ws.on('error', (err) => console.error('Mesero error:', err.message));

    // ── COCINA ─────────────────────────────────────────────
    } else if (type === 'cocina') {
        cocinaSockets.add(ws);
        console.log(`🍳 Cocina conectada (total: ${cocinaSockets.size})`);
        ws.send(JSON.stringify({
            type: 'robot_status',
            connected: robotSocket !== null && robotSocket.readyState === WebSocket.OPEN
        }));

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.action === 'pedidoListo') {
                    sendToRobot({ action: 'irACocina', mesa: msg.mesa });
                    sendToAllMeseros({ type: 'pedido_listo', mesa: msg.mesa });
                    broadcastAll({ type: 'robot_navegando', destino: 'cocina', mesa: msg.mesa });
                }
            } catch (e) {
                console.error('Error cocina:', e.message);
            }
        });

        ws.on('close', () => {
            cocinaSockets.delete(ws);
            console.log(`🍳 Cocina desconectada (total: ${cocinaSockets.size})`);
        });

        ws.on('error', (err) => console.error('Cocina error:', err.message));

    } else {
        ws.close(1008, 'type inválido — usa ?type=robot, ?type=mesero o ?type=cocina');
    }
});

server.listen(PORT, () => {
    console.log(`🚀 Restaurant Robot Relay corriendo en puerto ${PORT}`);
});
