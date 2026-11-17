/**
 * Módulo de Monitoreo en Tiempo Real (ES6 Module - Actividad 4.2)
 * Sección 2: SOLO LECTURA (telemetría compacta sin controles colados)
 * - Conexión WSS (con punto visual verde/rojo)
 * - Último Comando
 * - Última Actividad (Timestamp con new Date(fechaString) y formato local 'es-MX')
 * - Velocidad Actual
 * - Nivel de Volumen
 * - Tabla de Historial (10 registros desde Amazon RDS)
 */

import { CONFIG } from "./config.js";
import { api } from "./api.js";

export class MonitoreoController {
  constructor() {
    this.vehiculoId = CONFIG.VEHICULO_ID;
    this.isFetchingHistory = false;
    this.ui = {};
  }

  initDomReferences() {
    this.ui = {
      // Telemetría de Solo Lectura
      wssStatusDot: document.getElementById("mon-wss-dot"),
      wssStatusText: document.getElementById("mon-wss-text"),
      iconUltimoMov: document.getElementById("mon-last-icon"),
      nombreUltimoMov: document.getElementById("mon-last-command"),
      timestampUltimoMov: document.getElementById("mon-last-timestamp"),
      fechaUltimoMov: document.getElementById("mon-last-date"),
      horaUltimoMov: document.getElementById("mon-last-time"),
      valVelocidad: document.getElementById("mon-speed-val"),
      valVolumen: document.getElementById("mon-volume-val"),
      badgeConexionVehiculo: document.getElementById("mon-vehicle-online-badge"),
      tbodyHistorial: document.getElementById("mon-history-tbody"),
      lblTotalMostrados: document.getElementById("mon-history-count"),
      btnRefreshMonitoreo: document.getElementById("btn-refresh-monitoreo")
    };

    if (this.ui.btnRefreshMonitoreo && !this.ui.btnRefreshMonitoreo.dataset.bound) {
      this.ui.btnRefreshMonitoreo.dataset.bound = "true";
      this.ui.btnRefreshMonitoreo.addEventListener("click", () => {
        this.refreshAll(true);
      });
    }
  }

  ensureUi() {
    if (!this.ui.nombreUltimoMov || !this.ui.tbodyHistorial) {
      this.initDomReferences();
    }
  }

  /**
   * Actualiza el indicador visual de conexión WSS en la sección de monitoreo.
   */
  setWssStatus(status) {
    this.ensureUi();
    const isOnline = status === "online";
    if (this.ui.wssStatusDot) {
      this.ui.wssStatusDot.className = `status-dot ${isOnline ? "dot-online" : "dot-offline"}`;
    }
    if (this.ui.wssStatusText) {
      this.ui.wssStatusText.textContent = isOnline
        ? "Conectado WSS (En línea)"
        : status === "connecting" || status === "reconnecting"
        ? "Reconectando..."
        : "Desconectado WSS";
      this.ui.wssStatusText.className = `fw-bold ${isOnline ? "text-success-pastel" : "text-danger-pastel"}`;
    }
  }

  /**
   * Actualiza el nivel de volumen mostrado en la telemetría.
   */
  setVolumenTelemetry(val) {
    this.ensureUi();
    if (this.ui.valVolumen) {
      this.ui.valVolumen.textContent = `${val}%`;
    }
  }

  /**
   * Actualiza el nivel de velocidad mostrado en la telemetría.
   */
  setVelocidadTelemetry(val) {
    this.ensureUi();
    if (this.ui.valVelocidad) {
      const num = Number(val);
      let label = `${num}%`;
      if (num <= 35) label = `${num}% (Lento)`;
      else if (num <= 75) label = `${num}% (Normal)`;
      else label = `${num}% (Turbo)`;
      this.ui.valVelocidad.textContent = label;
    }
  }

  /**
   * Carga tanto el Último Movimiento como la Tabla de Historial (10 registros).
   */
  async refreshAll(showLoading = false) {
    this.ensureUi();
    if (showLoading) {
      this.setLoadingState();
    }
    await Promise.allSettled([
      this.fetchAndRenderUltimoEstado(),
      this.fetchAndRenderHistorial(showLoading)
    ]);
  }

  setLoadingState() {
    this.ensureUi();
    if (this.ui.nombreUltimoMov) {
      this.ui.nombreUltimoMov.textContent = "Cargando...";
    }
    if (this.ui.tbodyHistorial) {
      this.ui.tbodyHistorial.innerHTML = `
        <tr>
          <td colspan="4" class="text-center py-3 text-soft-lilac fw-bold">
            <div class="spinner-border spinner-border-sm text-pink-accent me-2" role="status"></div>
            Cargando últimos 10 movimientos desde RDS...
          </td>
        </tr>
      `;
    }
  }

  /**
   * Consulta GET /api/vehiculos/{id}/estado y actualiza la tarjeta de "Último Movimiento".
   */
  async fetchAndRenderUltimoEstado() {
    this.ensureUi();
    try {
      const estado = await api.obtenerEstadoVehiculo(this.vehiculoId);
      if (!estado) {
        this.renderEmptyEstado("Sin movimientos");
        return;
      }
      this.renderEstadoCard(estado);
    } catch {
      this.renderEmptyEstado("En espera de datos");
    }
  }

  /**
   * Consulta GET /api/vehiculos/{id}/historial y pinta los últimos 10 registros reales.
   */
  async fetchAndRenderHistorial(showSpinner = false) {
    this.ensureUi();
    if (this.isFetchingHistory) return;
    this.isFetchingHistory = true;

    if (showSpinner && this.ui.tbodyHistorial) {
      this.ui.tbodyHistorial.innerHTML = `
        <tr>
          <td colspan="4" class="text-center py-3 text-soft-lilac fw-bold">
            <div class="spinner-border spinner-border-sm text-pink-accent me-2" role="status"></div>
            Consultando Amazon RDS...
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
              Error al consultar historial (${err.message || "Sin conexión"}).
            </td>
          </tr>
        `;
      }
    } finally {
      this.isFetchingHistory = false;
    }
  }

  /**
   * Pinta los datos de Último Movimiento / Actividad con formato de fecha seguro.
   */
  renderEstadoCard(estado) {
    this.ensureUi();
    const comandoNombre = String(
      estado.comando || estado.nombre || "DETENER"
    ).toUpperCase();

    const rawTimestamp =
      estado.fecha_actualizacion || estado.fecha_hora || estado.timestamp || null;
    const { fechaStr, horaStr, fullStr } = this.formatBackendTimestamp(rawTimestamp);

    if (this.ui.nombreUltimoMov) {
      this.ui.nombreUltimoMov.textContent = comandoNombre.replace(/_/g, " ");
    }
    if (this.ui.iconUltimoMov) {
      this.ui.iconUltimoMov.className = `bi ${this.getIconForCommand(comandoNombre)} mon-hero-icon`;
    }
    if (this.ui.timestampUltimoMov) {
      this.ui.timestampUltimoMov.textContent = fullStr;
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
        ? `<span class="status-dot dot-online"></span>Activo en RDS`
        : `<span class="status-dot dot-neutral"></span>En espera`;
    }
  }

  renderEmptyEstado(mensaje) {
    this.ensureUi();
    if (this.ui.nombreUltimoMov) {
      this.ui.nombreUltimoMov.textContent = mensaje;
    }
    if (this.ui.iconUltimoMov) {
      this.ui.iconUltimoMov.className = "bi bi-slash-circle mon-hero-icon";
    }
    if (this.ui.timestampUltimoMov) {
      this.ui.timestampUltimoMov.textContent = "—";
    }
    if (this.ui.fechaUltimoMov) {
      this.ui.fechaUltimoMov.textContent = "—";
    }
    if (this.ui.horaUltimoMov) {
      this.ui.horaUltimoMov.textContent = "—";
    }
  }

  /**
   * Pinta la tabla responsiva con las 4 columnas: #, Movimiento, Fecha, Hora.
   */
  renderHistorialTable(registros) {
    this.ensureUi();
    if (!this.ui.tbodyHistorial) return;

    if (!Array.isArray(registros) || registros.length === 0) {
      if (this.ui.lblTotalMostrados) {
        this.ui.lblTotalMostrados.textContent = "0 registros";
      }
      this.ui.tbodyHistorial.innerHTML = `
        <tr>
          <td colspan="4" class="text-center py-3 text-soft-lilac fw-bold">
            Sin movimientos registrados en el historial de Amazon RDS.
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
          item.fecha_hora || item.fecha_actualizacion || item.timestamp
        );

        return `
          <tr class="mon-table-row">
            <td class="fw-extrabold text-pink-accent text-center">${numeroFila}</td>
            <td>
              <div class="d-inline-flex align-items-center gap-2 fw-bold text-light">
                <span class="mon-row-icon-badge">
                  <i class="bi ${iconClass}"></i>
                </span>
                <span>${nombreMov.replace(/_/g, " ")}</span>
              </div>
            </td>
            <td class="text-light fw-semibold">${fechaStr}</td>
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
   * Extrae y procesa la fecha correctamente usando new Date(fechaString)
   * Formatea la salida a huso horario local (toLocaleString('es-MX', { hour12: true }))
   * evitando valores "undefined" o desfasados.
   */
  formatBackendTimestamp(rawTimestamp) {
    if (!rawTimestamp) {
      return { fechaStr: "—", horaStr: "—", fullStr: "Sin actividad registrada" };
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
        horaStr: parts[1] || "—",
        fullStr: rawStr
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

    const fullStr = parsedDate.toLocaleString("es-MX", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });

    return { fechaStr, horaStr, fullStr };
  }
}

// Instancia compartida y funciones exportadas
export const monitoreoInstance = new MonitoreoController();

/**
 * Actualiza inmediatamente la tarjeta de "Último Movimiento" cuando llega un evento por WebSocket.
 */
export async function actualizarUltimoMovimiento(estadoPayload) {
  if (
    estadoPayload &&
    typeof estadoPayload === "object" &&
    (estadoPayload.comando || estadoPayload.nombre) &&
    (estadoPayload.fecha_actualizacion || estadoPayload.fecha_hora || estadoPayload.timestamp)
  ) {
    monitoreoInstance.renderEstadoCard(estadoPayload);
  } else {
    await monitoreoInstance.fetchAndRenderUltimoEstado();
  }
}

/**
 * Recarga inmediatamente la "Tabla de Historial (10 registros)" desde la API en AWS.
 */
export async function recargarTablaHistorial() {
  await monitoreoInstance.fetchAndRenderHistorial(false);
}
