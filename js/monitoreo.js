/**
 * Módulo de Monitoreo en Tiempo Real (ES6 Module - Actividad 4.2)
 * - Consulta únicamente datos reales de Amazon RDS a través de la API en AWS EC2 y del WebSocket WSS.
 * - Actualiza la tarjeta de "Último Movimiento" (nombre del comando, icono representativo, Fecha y Hora del backend).
 * - Pinta la Tabla de Historial de los últimos 10 movimientos (#, Movimiento, Fecha y Hora) ordenada del más reciente al más antiguo.
 * - Resincroniza automáticamente la tabla cuando llega un evento de movimiento validado por WebSocket.
 */

import { CONFIG } from "./config.js";
import { api } from "./api.js";

export class MonitoreoController {
  constructor() {
    this.vehiculoId = CONFIG.VEHICULO_ID;
    this.isFetchingHistory = false;

    this.ui = {
      iconUltimoMov: document.getElementById("mon-last-icon"),
      nombreUltimoMov: document.getElementById("mon-last-command"),
      fechaUltimoMov: document.getElementById("mon-last-date"),
      horaUltimoMov: document.getElementById("mon-last-time"),
      badgeConexionVehiculo: document.getElementById("mon-vehicle-online-badge"),
      btnRefreshMonitoreo: document.getElementById("btn-refresh-monitoreo"),
      tbodyHistorial: document.getElementById("mon-history-tbody"),
      lblTotalMostrados: document.getElementById("mon-history-count")
    };

    this.bindEvents();
  }

  bindEvents() {
    if (this.ui.btnRefreshMonitoreo) {
      this.ui.btnRefreshMonitoreo.addEventListener("click", () => {
        this.refreshAll(true);
      });
    }

    // Escuchar eventos en vivo provenientes de websocket.js
    window.addEventListener("iot:ws-message", (event) => {
      if (event && event.detail) {
        this.onWebSocketEvent(event.detail);
      }
    });
  }

  /**
   * Carga tanto el Último Movimiento como la Tabla de Historial (10 registros).
   */
  async refreshAll(showLoading = false) {
    if (showLoading) {
      this.setLoadingState();
    }
    await Promise.allSettled([
      this.fetchAndRenderUltimoEstado(),
      this.fetchAndRenderHistorial(showLoading)
    ]);
  }

  setLoadingState() {
    if (this.ui.nombreUltimoMov) {
      this.ui.nombreUltimoMov.textContent = "Cargando...";
    }
    if (this.ui.tbodyHistorial) {
      this.ui.tbodyHistorial.innerHTML = `
        <tr>
          <td colspan="4" class="text-center py-3 text-soft-lilac fw-bold">
            <div class="spinner-border spinner-border-sm text-pink-accent me-2" role="status"></div>
            Cargando últimos 10 movimientos desde RDS... ✨
          </td>
        </tr>
      `;
    }
  }

  /**
   * Consulta GET /api/vehiculos/{id}/estado y actualiza la tarjeta de "Último Movimiento".
   */
  async fetchAndRenderUltimoEstado() {
    try {
      const estado = await api.obtenerEstadoVehiculo(this.vehiculoId);
      if (!estado) {
        this.renderEmptyEstado("Sin movimientos");
        return;
      }
      this.renderEstadoCard(estado);
    } catch {
      this.renderEmptyEstado("Error al consultar estado");
    }
  }

  /**
   * Consulta GET /api/vehiculos/{id}/historial y pinta los últimos 10 registros reales.
   */
  async fetchAndRenderHistorial(showSpinner = false) {
    if (this.isFetchingHistory) return;
    this.isFetchingHistory = true;

    if (showSpinner && this.ui.tbodyHistorial) {
      this.ui.tbodyHistorial.innerHTML = `
        <tr>
          <td colspan="4" class="text-center py-3 text-soft-lilac fw-bold">
            <div class="spinner-border spinner-border-sm text-pink-accent me-2" role="status"></div>
            Cargando historial desde Amazon RDS... ✨
          </td>
        </tr>
      `;
    }

    try {
      const registros = await api.obtenerHistorialVehiculo(
        this.vehiculoId,
        CONFIG.HISTORIAL_LIMIT || 10
      );
      this.renderHistorialTable(registros);
    } catch (err) {
      if (this.ui.tbodyHistorial) {
        this.ui.tbodyHistorial.innerHTML = `
          <tr>
            <td colspan="4" class="text-center py-3 text-danger fw-bold">
              <i class="bi bi-exclamation-triangle-fill me-1"></i>
              Error al obtener el historial (${err.message || "Error de red"}).
            </td>
          </tr>
        `;
      }
    } finally {
      this.isFetchingHistory = false;
    }
  }

  /**
   * Procesa en tiempo real los mensajes que llegan desde websocket.js:
   * - Actualiza el panel de "Último Movimiento" en vivo.
   * - Si el movimiento persiste en RDS (no es paso interno de DEMO), actualiza la tabla de 10 registros.
   */
  async onWebSocketEvent(payload) {
    if (!payload || typeof payload !== "object") return;

    const evento = String(payload.evento || "").toUpperCase();

    if (payload.estado && typeof payload.estado === "object") {
      this.renderEstadoCard(payload.estado);
    } else if (payload.comando) {
      await this.fetchAndRenderUltimoEstado();
    }

    const esEventoDemoSinHistorial =
      evento === "DEMO_INICIADA" ||
      evento === "DEMO_PASO" ||
      evento === "DEMO_PAUSA" ||
      evento === "DEMO_FINALIZADA" ||
      payload.guardado_en_historial === false;

    if (
      !esEventoDemoSinHistorial &&
      (evento === "MOVIMIENTO_INDIVIDUAL" ||
        evento === "ESTADO_ACTUALIZADO" ||
        payload.guardado_en_historial === true)
    ) {
      await this.fetchAndRenderHistorial(false);
    }
  }

  /**
   * Pinta la tarjeta de "Último Movimiento" con los datos reales del backend.
   */
  renderEstadoCard(estado) {
    const comandoNombre = String(
      estado.comando || estado.nombre || "SIN MOVIMIENTOS"
    ).toUpperCase();

    const rawTimestamp =
      estado.fecha_actualizacion || estado.fecha_hora || null;
    const { fechaStr, horaStr } = this.formatBackendTimestamp(rawTimestamp);

    if (this.ui.nombreUltimoMov) {
      this.ui.nombreUltimoMov.textContent = comandoNombre.replace(/_/g, " ");
    }
    if (this.ui.iconUltimoMov) {
      this.ui.iconUltimoMov.className = `bi ${this.getIconForCommand(
        comandoNombre
      )} mon-hero-icon`;
    }
    if (this.ui.fechaUltimoMov) {
      this.ui.fechaUltimoMov.textContent = fechaStr;
    }
    if (this.ui.horaUltimoMov) {
      this.ui.horaUltimoMov.textContent = horaStr;
    }

    if (this.ui.badgeConexionVehiculo) {
      const isOnline = Boolean(Number(estado.conectado ?? 1));
      this.ui.badgeConexionVehiculo.className = isOnline
        ? "badge rounded-pill badge-pastel-online"
        : "badge rounded-pill badge-pastel-neutral";
      this.ui.badgeConexionVehiculo.innerHTML = isOnline
        ? `<span class="status-dot dot-online"></span>Activo en RDS ✨`
        : `<span class="status-dot dot-neutral"></span>En espera`;
    }
  }

  renderEmptyEstado(mensaje) {
    if (this.ui.nombreUltimoMov) {
      this.ui.nombreUltimoMov.textContent = mensaje;
    }
    if (this.ui.iconUltimoMov) {
      this.ui.iconUltimoMov.className = "bi bi-slash-circle mon-hero-icon";
    }
    if (this.ui.fechaUltimoMov) {
      this.ui.fechaUltimoMov.textContent = "—";
    }
    if (this.ui.horaUltimoMov) {
      this.ui.horaUltimoMov.textContent = "—";
    }
  }

  /**
   * Pinta la tabla responsiva con las 4 columnas requeridas: #, Movimiento, Fecha, Hora.
   */
  renderHistorialTable(registros) {
    if (!this.ui.tbodyHistorial) return;

    if (!Array.isArray(registros) || registros.length === 0) {
      if (this.ui.lblTotalMostrados) {
        this.ui.lblTotalMostrados.textContent = "0 registros";
      }
      this.ui.tbodyHistorial.innerHTML = `
        <tr>
          <td colspan="4" class="text-center py-3 text-soft-lilac fw-bold">
            🌸 Sin movimientos registrados en el historial de Amazon RDS.
          </td>
        </tr>
      `;
      return;
    }

    if (this.ui.lblTotalMostrados) {
      this.ui.lblTotalMostrados.textContent = `Últimos ${registros.length} registros`;
    }

    const rowsHtml = registros
      .map((item, idx) => {
        const numeroFila = idx + 1;
        const nombreMov = String(
          item.comando || item.nombre || `Comando #${item.id_comando ?? ""}`
        ).toUpperCase();
        const iconClass = this.getIconForCommand(nombreMov);
        const { fechaStr, horaStr } = this.formatBackendTimestamp(
          item.fecha_hora || item.fecha_actualizacion
        );

        return `
          <tr class="mon-table-row">
            <td class="fw-extrabold text-pink-accent text-center">${numeroFila}</td>
            <td>
              <div class="d-inline-flex align-items-center gap-2 fw-bold text-plum">
                <span class="mon-row-icon-badge">
                  <i class="bi ${iconClass}"></i>
                </span>
                <span>${nombreMov.replace(/_/g, " ")}</span>
              </div>
            </td>
            <td class="text-plum fw-semibold">${fechaStr}</td>
            <td class="text-soft-lilac fw-bold">${horaStr}</td>
          </tr>
        `;
      })
      .join("");

    this.ui.tbodyHistorial.innerHTML = rowsHtml;
  }

  getIconForCommand(commandName) {
    const key = String(commandName || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_");

    if (key.includes("AVANZAR")) return "bi-arrow-up-circle-fill";
    if (key.includes("RETROCEDER")) return "bi-arrow-down-circle-fill";
    if (key.includes("360") && key.includes("IZQ")) return "bi-arrow-repeat";
    if (key.includes("360") && key.includes("DER")) return "bi-bootstrap-reboot";
    if (key.includes("IZQ")) return "bi-arrow-counterclockwise";
    if (key.includes("DER")) return "bi-arrow-clockwise";
    if (key.includes("SUBIR_BRAZO")) return "bi-box-arrow-in-up";
    if (key.includes("BAJAR_BRAZO")) return "bi-box-arrow-in-down";
    if (key.includes("ABRIR_PALA")) return "bi-arrows-angle-expand";
    if (key.includes("CERRAR_PALA")) return "bi-arrows-angle-contract";
    if (key.includes("DETENER")) return "bi-octagon-fill";
    return "bi-cpu-fill";
  }

  /**
   * Extrae la Fecha y Hora exactas devueltas por el backend en RDS sin inventar marcas temporales.
   */
  formatBackendTimestamp(rawTimestamp) {
    if (!rawTimestamp) {
      return { fechaStr: "Sin fecha", horaStr: "Sin hora" };
    }

    const rawStr = String(rawTimestamp).trim();
    const normalizedIso =
      rawStr.includes("T") || rawStr.endsWith("Z")
        ? rawStr
        : rawStr.replace(" ", "T");

    const parsedDate = new Date(normalizedIso);
    if (Number.isNaN(parsedDate.getTime())) {
      const parts = rawStr.split(/[T ]/);
      return {
        fechaStr: parts[0] || rawStr,
        horaStr: parts[1] || "—"
      };
    }

    const fechaStr = parsedDate.toLocaleDateString("es-MX", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });

    const horaStr = parsedDate.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });

    return { fechaStr, horaStr };
  }
}
