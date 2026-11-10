/**
 * Gestor de Conexión WebSocket Seguro WSS hacia AWS EC2
 * Conecta a wss://52.4.170.82:8000/ws/1 y wss://52.4.170.82:8000/ws
 * con cambio rápido de ruta si una no existe en el servidor.
 */
(function (global) {
  const CONFIG = global.IOT_CONFIG;

  class IoTWebSocketClient {
    constructor({ onStatusChange, onMessage } = {}) {
      this.onStatusChange = onStatusChange || (() => {});
      this.onMessage = onMessage || (() => {});
      this.socket = null;
      this.reconnectTimer = null;
      this.hasConnectedOnce = false;
      this.attemptIndex = 0;
      this.manualClose = false;
      this.lastSuccessUrl = null;
    }

    getCandidateUrls() {
      const wssBase = CONFIG.WS_BASE_URL.replace(/\/+$/, "");
      // Si ya funcionó una URL antes, usarla siempre primero
      if (this.lastSuccessUrl) {
        return [this.lastSuccessUrl];
      }
      // Probamos únicamente las 2 rutas WSS reales de tu servidor AWS EC2 (52.4.170.82:8000)
      return [
        `${wssBase}/${CONFIG.VEHICULO_ID}`,
        `${wssBase}`,
        `${wssBase}/vehiculo/${CONFIG.VEHICULO_ID}`
      ];
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

      const candidates = this.getCandidateUrls();
      const wsUrl = candidates[this.attemptIndex % candidates.length];

      try {
        this.socket = new WebSocket(wsUrl);
      } catch {
        this.attemptIndex += 1;
        this.onStatusChange("disconnected");
        this.scheduleReconnect(1200);
        return;
      }

      this.socket.addEventListener("open", () => {
        this.hasConnectedOnce = true;
        this.lastSuccessUrl = wsUrl;
        this.onStatusChange("online");
      });

      this.socket.addEventListener("message", (event) => {
        try {
          const parsed = JSON.parse(event.data);
          this.onMessage(parsed);
        } catch {
          this.onMessage({ raw: event.data });
        }
      });

      this.socket.addEventListener("error", () => {});

      this.socket.addEventListener("close", () => {
        this.onStatusChange("disconnected");
        if (!this.manualClose) {
          if (!this.hasConnectedOnce) {
            this.attemptIndex += 1;
            // Si aún no ha conectado, probar la siguiente ruta candidata rápido (900 ms)
            this.scheduleReconnect(900);
          } else {
            this.scheduleReconnect(CONFIG.WS_RECONNECT_DELAY_MS);
          }
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

  global.IoTWebSocketClient = IoTWebSocketClient;
})(window);
