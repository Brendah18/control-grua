/**
 * Gestor de Conexión WebSocket Seguro WSS hacia AWS EC2 (ES6 Module)
 * - Conecta a CONFIG.WS_URL ("wss://52.4.170.82:8000/ws/1").
 * - En socket.onmessage intercepta los eventos de movimiento y DEMO e invoca inmediatamente
 *   las funciones de js/monitoreo.js (actualizarUltimoMovimiento y recargarTablaHistorial).
 * - Aplica un destello visual temporal (clase CSS .cmd-flash-active) en el botón o dirección
 *   del control correspondiente (Avanzar, Izquierda, Derecha, Retroceder, Giros, Detener, etc.).
 */

import { CONFIG } from "./config.js";
import {
  actualizarUltimoMovimiento,
  recargarTablaHistorial
} from "./monitoreo.js";

/**
 * Aplica un destello visual temporal en el botón o etiqueta direccional correspondiente
 * para confirmar en pantalla que el movimiento se ejecutó (tanto manual como en DEMO).
 */
export function destelloVisualControl(rawCommandName) {
  if (!rawCommandName) return;

  const cmd = String(rawCommandName)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

  const elementsToFlash = [];

  // 1. Botones del D-pad compacto / Joystick Grid y etiquetas cardinales
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

  // 2. Botón prioritario DETENER / STOP central rojo
  if (cmd.includes("DETENER") || cmd.includes("STOP")) {
    document.querySelectorAll("#btn-stop-priority, .joy-btn-stop, #btn-joy-stop, [data-dir='DETENER']").forEach((el) => {
      elementsToFlash.push(el);
    });
  }

  // 3. Botones secundarios de maniobras y catálogo dinámico
  document.querySelectorAll(".cmd-sec-btn").forEach((btn) => {
    const attrName = String(btn.getAttribute("data-cmd-name") || "")
      .trim()
      .toUpperCase();
    const textName = String(btn.textContent || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_");

    if (
      attrName === cmd ||
      textName === cmd ||
      (cmd === "GIRAR_IZQUIERDA" && attrName === "GIRO_90_IZQ") ||
      (cmd === "GIRAR_DERECHA" && attrName === "GIRO_90_DER")
    ) {
      elementsToFlash.push(btn);
    }
  });

  // 4. Palanca central del joystick
  const thumb = document.getElementById("joystick-thumb");
  if (thumb && !cmd.includes("DETENER")) {
    elementsToFlash.push(thumb);
  }

  elementsToFlash.forEach((el) => {
    el.classList.remove("cmd-flash-active");
    // Forzar reflow para reiniciar la animación
    void el.offsetWidth;
    el.classList.add("cmd-flash-active");

    if (el._flashTimer) {
      clearTimeout(el._flashTimer);
    }
    el._flashTimer = setTimeout(() => {
      el.classList.remove("cmd-flash-active");
    }, 700);
  });
}

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

    this.socket.onopen = () => {
      this.hasConnectedOnce = true;
      this.onStatusChange("online");
    };

    /**
     * Reactividad UI por WebSocket:
     * Intercepta el mensaje entrante, actualiza la sección de Monitoreo
     * en js/monitoreo.js y activa el destello visual en el control correspondiente.
     */
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
          // 1. Destello visual en el botón / dirección del control (Feedback Visual DEMO / Manual)
          if (nombreComando && evento !== "CONEXION_ESTABLECIDA") {
            destelloVisualControl(nombreComando);
          }

          // 2. Actualizar inmediatamente los datos de monitoreo
          await actualizarUltimoMovimiento(estadoObj || parsed);

          // 3. Recargar tabla de historial si es movimiento persistido en Amazon RDS
          const guardaHistorial =
            evento === "MOVIMIENTO_INDIVIDUAL" ||
            evento === "ESTADO_ACTUALIZADO" ||
            parsed.guardado_en_historial === true;

          if (guardaHistorial) {
            await recargarTablaHistorial();
          }
        }
      } catch {
        const fallbackPayload = { raw: event.data };
        this.onMessage(fallbackPayload);
      }
    };

    this.socket.onerror = () => {};

    this.socket.onclose = () => {
      this.onStatusChange("disconnected");
      if (!this.manualClose) {
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
