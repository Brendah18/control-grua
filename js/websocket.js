/**
 * Gestor de Conexión WebSocket Seguro WSS hacia AWS EC2 (ES6 Module)
 * - Conexión estricta a wss://52.4.170.82:8000/ws/1 con fallback inteligente a wss://52.4.170.82:8000/ws
 * - Reconexión automática indestructible y feedback visual inmediato.
 */

import { CONFIG } from "./config.js";
import {
  actualizarUltimoMovimiento,
  recargarTablaHistorial
} from "./monitoreo.js";

/**
 * Aplica un destello visual temporal en el botón o elemento direccional
 * correspondiente para confirmar en pantalla que la acción se ejecutó.
 */
export function destelloVisualControl(rawCommandName) {
  if (!rawCommandName) return;

  const cmd = String(rawCommandName)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

  const elementsToFlash = [];

  // D-Pad y mandos direccionales
  if (cmd.includes("AVANZAR")) {
    document.querySelectorAll(".joy-up, .joy-btn-up, #btn-joy-up, [data-dir='AVANZAR']").forEach((el) => {
      elementsToFlash.push(el);
    });
  } else if (cmd.includes("RETROCEDER")) {
    document.querySelectorAll(".joy-down, .joy-btn-down, #btn-joy-down, [data-dir='RETROCEDER']").forEach((el) => {
      elementsToFlash.push(el);
    });
  } else if (cmd.includes("IZQUIERDA") || cmd === "IZQ") {
    document.querySelectorAll(".joy-left, .joy-btn-left, #btn-joy-left, [data-dir='IZQUIERDA'], [data-dir='GIRAR_IZQUIERDA']").forEach((el) => {
      elementsToFlash.push(el);
    });
  } else if (cmd.includes("DERECHA") || cmd === "DER") {
    document.querySelectorAll(".joy-right, .joy-btn-right, #btn-joy-right, [data-dir='DERECHA'], [data-dir='GIRAR_DERECHA']").forEach((el) => {
      elementsToFlash.push(el);
    });
  }

  // STOP prioritario
  if (cmd.includes("DETENER") || cmd.includes("STOP")) {
    document.querySelectorAll("#btn-stop-priority, .joy-btn-stop, #btn-joy-stop, [data-dir='DETENER']").forEach((el) => {
      elementsToFlash.push(el);
    });
  }

  // Maniobras secundarias
  document.querySelectorAll(".cmd-sec-btn").forEach((btn) => {
    const attrName = String(btn.getAttribute("data-cmd-name") || "").toUpperCase();
    const textName = String(btn.textContent || "").trim().toUpperCase().replace(/\s+/g, "_");

    if (
      attrName === cmd ||
      textName === cmd ||
      (cmd === "GIRAR_IZQUIERDA" && attrName === "GIRO_90_IZQ") ||
      (cmd === "GIRAR_DERECHA" && attrName === "GIRO_90_DER")
    ) {
      elementsToFlash.push(btn);
    }
  });

  // Palanca analógica
  const thumb = document.getElementById("joystick-thumb");
  if (thumb && !cmd.includes("DETENER")) {
    elementsToFlash.push(thumb);
  }

  elementsToFlash.forEach((el) => {
    if (!el) return;
    el.classList.remove("cmd-flash-active");
    void el.offsetWidth;
    el.classList.add("cmd-flash-active");

    if (el._flashTimer) {
      clearTimeout(el._flashTimer);
    }
    el._flashTimer = setTimeout(() => {
      el.classList.remove("cmd-flash-active");
    }, 650);
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
    return this.useFallbackUrl ? CONFIG.WS_FALLBACK_URL : CONFIG.WS_URL;
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
        this.onMessage(parsed);

        const evento = String(parsed.evento || "").toUpperCase();
        const estadoObj = parsed.estado || parsed.estado_final || null;
        const nombreComando =
          (estadoObj && (estadoObj.comando || estadoObj.nombre)) ||
          parsed.comando ||
          null;

        const esEventoMovimiento =
          evento === "MOVIMIENTO_INDIVIDUAL" ||
          evento === "ESTADO_ACTUALIZADO" ||
          evento === "CONEXION_ESTABLECIDA" ||
          evento === "DEMO_PASO" ||
          evento === "DEMO_PAUSA" ||
          evento === "DEMO_FINALIZADA" ||
          Boolean(estadoObj) ||
          Boolean(nombreComando);

        if (esEventoMovimiento) {
          if (nombreComando && evento !== "CONEXION_ESTABLECIDA") {
            destelloVisualControl(nombreComando);
          }

          await actualizarUltimoMovimiento(estadoObj || parsed);

          const guardaHistorial =
            evento === "MOVIMIENTO_INDIVIDUAL" ||
            evento === "ESTADO_ACTUALIZADO" ||
            parsed.guardado_en_historial === true;

          if (guardaHistorial) {
            await recargarTablaHistorial();
          }
        }
      } catch {
        this.onMessage({ raw: event.data });
      }
    };

    this.socket.onerror = () => {
      // onerror precede inmediatamente a onclose
    };

    this.socket.onclose = () => {
      this.onStatusChange("disconnected");
      if (!this.manualClose) {
        // Si nunca conectó a /ws/1, intenta alternar a /ws
        if (!this.hasConnectedOnce) {
          this.useFallbackUrl = !this.useFallbackUrl;
        }
        this.scheduleReconnect(CONFIG.WS_RECONNECT_DELAY_MS);
      }
    };
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
