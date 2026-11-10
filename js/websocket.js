/**
 * Gestor de Conexión WebSocket Seguro WSS hacia AWS EC2 (ES6 Module)
 * Conecta estrictamente a CONFIG.WS_URL ("wss://52.4.170.82:8000/ws/1")
 * y emite eventos en tiempo real para sincronizar tanto Control como Monitoreo.
 */

import { CONFIG } from "./config.js";

export class IoTWebSocketClient {
  constructor({ onStatusChange, onMessage } = {}) {
    this.onStatusChange = onStatusChange || (() => {});
    this.onMessage = onMessage || (() => {});
    this.socket = null;
    this.reconnectTimer = null;
    this.hasConnectedOnce = false;
    this.manualClose = false;
  }

  connect() {
    this.manualClose = false;
    this.clearReconnectTimer();

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.onStatusChange(this.hasConnectedOnce ? "reconnecting" : "connecting");

    try {
      this.socket = new WebSocket(CONFIG.WS_URL);
    } catch {
      this.onStatusChange("disconnected");
      this.scheduleReconnect(CONFIG.WS_RECONNECT_DELAY_MS);
      return;
    }

    this.socket.addEventListener("open", () => {
      this.hasConnectedOnce = true;
      this.onStatusChange("online");
    });

    this.socket.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(event.data);
        this.onMessage(parsed);
        // Emitir evento global del DOM para actualizar Monitoreo en tiempo real
        window.dispatchEvent(
          new CustomEvent("iot:ws-message", { detail: parsed })
        );
      } catch {
        const fallbackPayload = { raw: event.data };
        this.onMessage(fallbackPayload);
      }
    });

    this.socket.addEventListener("error", () => {});

    this.socket.addEventListener("close", () => {
      this.onStatusChange("disconnected");
      if (!this.manualClose) {
        this.scheduleReconnect(CONFIG.WS_RECONNECT_DELAY_MS);
      }
    });
  }

  scheduleReconnect(delayMs = CONFIG.WS_RECONNECT_DELAY_MS) {
    this.clearReconnectTimer();
    this.reconnectTimer = window.setTimeout(() => {
      this.onStatusChange("reconnecting");
      this.connect();
    }, delayMs);
  }

  clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  sendJson(payload) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  disconnect() {
    this.manualClose = true;
    this.clearReconnectTimer();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.onStatusChange("disconnected");
  }
}
