/**
 * Gestor de Conexión WebSocket Seguro WSS hacia AWS EC2 (ES6 Module)
 * - Conexión estricta a wss://52.4.170.82:8000/ws/1 con fallback inteligente a wss://52.4.170.82:8000/ws
 * - Garantiza exclusión mutua visual: NUNCA se iluminan dos movimientos distintos al mismo tiempo.
 */

import { CONFIG } from "./config.js";

/**
 * Apaga inmediatamente cualquier destello activo en toda la interfaz
 * para garantizar que jamás queden dos botones encendidos simultáneamente.
 */
export function limpiarDestellosVisuales() {
  document.querySelectorAll(".cmd-flash-active").forEach((el) => {
    if (el._flashTimer) {
      clearTimeout(el._flashTimer);
      el._flashTimer = null;
    }
    el.classList.remove("cmd-flash-active");
  });
}

/**
 * Aplica un destello visual exclusivo en el botón correspondiente al comando actual,
 * limpiando primero cualquier otro botón previamente encendido.
 */
export function destelloVisualControl(rawCommandName, duracionMs = 900) {
  // 1. SIEMPRE apagar todos los botones anteriores primero
  limpiarDestellosVisuales();

  if (!rawCommandName) return;

  const cmd = String(rawCommandName)
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");

  const elementsToFlash = [];

  // 2. Cruceta D-Pad direccional (solo para los 4 comandos de dirección o STOP)
  if (cmd === "ADELANTE" || cmd === "AVANZAR") {
    document.querySelectorAll("#btn-joy-up, .joy-up").forEach((el) => elementsToFlash.push(el));
  } else if (cmd === "ATRAS" || cmd === "RETROCEDER") {
    document.querySelectorAll("#btn-joy-down, .joy-down").forEach((el) => elementsToFlash.push(el));
  } else if (cmd === "GIRAR_IZQUIERDA" || cmd === "IZQUIERDA") {
    document.querySelectorAll("#btn-joy-left, .joy-left").forEach((el) => elementsToFlash.push(el));
  } else if (cmd === "GIRAR_DERECHA" || cmd === "DERECHA") {
    document.querySelectorAll("#btn-joy-right, .joy-right").forEach((el) => elementsToFlash.push(el));
  } else if (cmd === "DETENER" || cmd === "STOP") {
    document.querySelectorAll("#btn-stop-priority, #btn-joy-stop").forEach((el) => elementsToFlash.push(el));
  }

  // 3. Catálogo de los 12 botones (01..12): Coincidencia EXACTA por data-cmd-name (1 solo botón)
  document.querySelectorAll(".cmd-sec-btn").forEach((btn) => {
    const attrName = String(btn.getAttribute("data-cmd-name") || "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "_");

    if (attrName === cmd) {
      elementsToFlash.push(btn);
    }
  });

  // 4. Encender únicamente los elementos del comando actual durante el tiempo indicado
  const tiempoEncendido = Math.max(450, duracionMs - 100);

  elementsToFlash.forEach((el) => {
    if (!el) return;
    void el.offsetWidth;
    el.classList.add("cmd-flash-active");

    el._flashTimer = setTimeout(() => {
      el.classList.remove("cmd-flash-active");
      el._flashTimer = null;
    }, tiempoEncendido);
  });
}

export class IoTWebSocketClient {
  constructor({ onStatusChange, onMessage } = {}) {
    this.onStatusChange = onStatusChange || (() => {});
    this.onMessage = onMessage || (() => {});
    this.socket = null;
    this.reconnectTimer = null;
    this.hasConnectedOnce = false;
    this.useFallbackUrl = false;
    this.manualClose = false;
  }

  getCurrentUrl() {
    const base = this.useFallbackUrl ? CONFIG.WS_FALLBACK_URL : CONFIG.WS_URL;
    try {
      const token = window.sessionStorage.getItem("iot_auth_token") || "";
      if (token) {
        const sep = base.includes("?") ? "&" : "?";
        return `${base}${sep}token=${encodeURIComponent(token)}`;
      }
    } catch {
      // continuar con URL base
    }
    return base;
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

    const targetUrl = this.getCurrentUrl();
    try {
      this.socket = new WebSocket(targetUrl);
    } catch {
      this.onStatusChange("disconnected");
      this.scheduleReconnect(CONFIG.WS_RECONNECT_DELAY_MS);
      return;
    }

    this.socket.onopen = () => {
      this.hasConnectedOnce = true;
      this.onStatusChange("online");
    };

    this.socket.onmessage = async (event) => {
      try {
        const parsed = JSON.parse(event.data);
        // Delegar todo el control visual y de estado a PlatformApp.handleWsMessage
        this.onMessage(parsed);
      } catch {
        this.onMessage({ raw: event.data });
      }
    };

    this.socket.onerror = () => {
      // onerror precede a onclose
    };

    this.socket.onclose = () => {
      this.socket = null;
      if (this.manualClose) {
        this.onStatusChange("disconnected");
        return;
      }

      if (!this.hasConnectedOnce && !this.useFallbackUrl) {
        this.useFallbackUrl = true;
        this.scheduleReconnect(600);
        return;
      }

      this.onStatusChange("reconnecting");
      this.scheduleReconnect(CONFIG.WS_RECONNECT_DELAY_MS);
    };
  }

  sendJson(payload) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  scheduleReconnect(delayMs) {
    this.clearReconnectTimer();
    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
    }, delayMs);
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  disconnect() {
    this.manualClose = true;
    this.clearReconnectTimer();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // cierre limpio
      }
      this.socket = null;
    }
    this.onStatusChange("disconnected");
  }
}
