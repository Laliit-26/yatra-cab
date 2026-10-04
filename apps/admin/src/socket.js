import { io } from 'socket.io-client';
import { api } from './api.js';

// The ops dashboard reads live driver positions from server-app's socket, not
// server-admin — that is where drivers are connected. Both services sign JWTs
// with the same secret, so the admin token authenticates there too.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5050';

let socket = null;

export function getSocket() {
  const token = api.getToken();
  if (!token) return null;
  if (socket && socket.connected) return socket;
  if (socket) socket.disconnect();
  socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
