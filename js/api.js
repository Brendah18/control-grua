/**
 * Cliente Fetch async/await centralizado (ES6 Module)
 * Conecta estrictamente con AWS EC2 (https://52.4.170.82:8000) y provee métodos
 * para el módulo de CONTROL (4.1) y el módulo de MONITOREO (4.2) con datos 100% reales.
 */

import { CONFIG } from "./config.js";

class ApiClient {
  constructor() {
    this.baseUrl = CONFIG.API_BASE_URL.replace(/\/+$/, "");
    this.vehiculoId = CONFIG.VEHICULO_ID;
  }

  /**
   * Ejecuta una petición HTTPS hacia el servidor AWS EC2 con control de timeout.
   */
  async request(path, options = {}, timeoutMs = CONFIG.FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const url = `${this.baseUrl}${path}`;
    const headers = {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        mode: "cors",
        signal: controller.signal
      });

      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        const errorMsg =
          typeof data === "object" && data !== null && data.detail
            ? data.detail
            : `HTTP ${response.status}`;
        const err = new Error(errorMsg);
        err.status = response.status;
        err.data = data;
        throw err;
      }

      return { ok: true, status: response.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Verifica la disponibilidad real de la API AWS (21 servicios) y de Amazon RDS.
   */
  async checkInfrastructureHealth() {
    let apiAvailable = false;
    let rdsState = "unverified";

    try {
      const res = await this.request(
        CONFIG.ENDPOINTS.VEHICULOS,
        { method: "GET" },
        5500
      );
      apiAvailable = res.ok;

      if (
        Array.isArray(res.data) &&
        res.data.length > 0 &&
        res.data[0].id_vehiculo !== undefined &&
        res.data[0].fecha_registro !== undefined
      ) {
        rdsState = "available";
      } else if (res.data && typeof res.data === "object" && "rds_status" in res.data) {
        rdsState = res.data.rds_status === "online" ? "available" : "unavailable";
      }
    } catch {
      apiAvailable = false;
      rdsState = "unavailable";
    }

    if (apiAvailable && rdsState === "unverified") {
      try {
        const dbRes = await this.request(
          CONFIG.ENDPOINTS.HEALTH_DB,
          { method: "GET" },
          3500
        );
        if (dbRes.ok && dbRes.data) {
          rdsState = "available";
        }
      } catch (err) {
        if (err && err.status && err.status !== 404) {
          rdsState = "unavailable";
        } else {
          rdsState = "unverified";
        }
      }
    }

    return { apiAvailable, rdsState };
  }

  /**
   * Obtiene el catálogo de comandos del vehículo desde AWS EC2 / RDS.
   */
  async obtenerComandos(idVehiculo = this.vehiculoId) {
    try {
      const res = await this.request(
        CONFIG.ENDPOINTS.COMANDOS_VEHICULO(idVehiculo),
        { method: "GET" }
      );
      if (Array.isArray(res.data)) {
        return res.data;
      }
    } catch {
      // Fallback a GET /api/comandos?id_vehiculo=1
    }

    try {
      const res2 = await this.request(
        `${CONFIG.ENDPOINTS.COMANDOS}?id_vehiculo=${idVehiculo}`,
        { method: "GET" }
      );
      if (Array.isArray(res2.data)) {
        return res2.data;
      }
      if (res2.data && Array.isArray(res2.data.comandos)) {
        return res2.data.comandos;
      }
    } catch {
      // Sin comandos remotos
    }
    return [];
  }

  /**
   * Obtiene el catálogo de secuencias DEMO desde AWS EC2 / RDS.
   */
  async obtenerDemos(idVehiculo = this.vehiculoId) {
    try {
      const res = await this.request(
        CONFIG.ENDPOINTS.DEMOS_VEHICULO(idVehiculo),
        { method: "GET" }
      );
      if (Array.isArray(res.data)) {
        return res.data;
      }
    } catch {
      // Fallback a GET /api/demos?id_vehiculo=1
    }

    try {
      const res2 = await this.request(
        `${CONFIG.ENDPOINTS.DEMOS}?id_vehiculo=${idVehiculo}`,
        { method: "GET" }
      );
      if (Array.isArray(res2.data)) {
        return res2.data;
      }
      if (res2.data && Array.isArray(res2.data.demos)) {
        return res2.data.demos;
      }
    } catch {
      // Sin demos remotas
    }
    return [];
  }

  /**
   * Obtiene el último estado real del vehículo desde Amazon RDS
   * (GET /api/vehiculos/{id}/estado -> CALL sp_obtener_estado).
   */
  async obtenerEstadoVehiculo(idVehiculo = this.vehiculoId) {
    try {
      const res = await this.request(
        CONFIG.ENDPOINTS.ESTADO_VEHICULO(idVehiculo),
        { method: "GET" }
      );
      if (Array.isArray(res.data)) {
        return res.data[0] || null;
      }
      if (res.data && typeof res.data === "object") {
        return res.data.estado || res.data;
      }
    } catch {
      const fallback = await this.request(
        CONFIG.ENDPOINTS.ESTADO_QUERY(idVehiculo),
        { method: "GET" }
      );
      if (Array.isArray(fallback.data)) {
        return fallback.data[0] || null;
      }
      return fallback.data || null;
    }
    return null;
  }

  /**
   * Obtiene el historial real de movimientos desde Amazon RDS
   * (GET /api/vehiculos/{id}/historial -> CALL sp_obtener_historial),
   * ordenado del más reciente al más antiguo y limitado a los últimos 10 registros.
   */
  async obtenerHistorialVehiculo(
    idVehiculo = this.vehiculoId,
    limit = CONFIG.HISTORIAL_LIMIT || 10
  ) {
    let rawList = [];

    try {
      const res = await this.request(
        CONFIG.ENDPOINTS.HISTORIAL_VEHICULO(idVehiculo),
        { method: "GET" }
      );
      if (Array.isArray(res.data)) {
        rawList = res.data;
      } else if (res.data && Array.isArray(res.data.historial)) {
        rawList = res.data.historial;
      }
    } catch {
      const fallback = await this.request(
        CONFIG.ENDPOINTS.HISTORIAL_QUERY(idVehiculo),
        { method: "GET" }
      );
      if (Array.isArray(fallback.data)) {
        rawList = fallback.data;
      } else if (fallback.data && Array.isArray(fallback.data.historial)) {
        rawList = fallback.data.historial;
      }
    }

    const sorted = [...rawList].sort((a, b) => {
      const dateA = a.fecha_hora ? new Date(a.fecha_hora).getTime() : 0;
      const dateB = b.fecha_hora ? new Date(b.fecha_hora).getTime() : 0;
      if (dateB !== dateA) {
        return dateB - dateA;
      }
      return Number(b.id_historial || 0) - Number(a.id_historial || 0);
    });

    return sorted.slice(0, limit);
  }

  /**
   * Envía un movimiento individual a AWS EC2.
   */
  async enviarMovimiento({
    idVehiculo = this.vehiculoId,
    idComando,
    codigo,
    nombre,
    origen = CONFIG.ORIGEN_CONTROL
  }) {
    const payload = {
      id_vehiculo: Number(idVehiculo),
      id_comando: Number(idComando),
      codigo: Number(codigo ?? idComando),
      comando: String(nombre || ""),
      origen
    };

    try {
      return await this.request(CONFIG.ENDPOINTS.CONTROL_MOVIMIENTO, {
        method: "POST",
        body: JSON.stringify(payload)
      });
    } catch (err) {
      if (err && (err.status === 404 || err.status === 405)) {
        return await this.request(CONFIG.ENDPOINTS.MOVIMIENTOS, {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }
      throw err;
    }
  }

  /**
   * Inicia una secuencia DEMO en AWS EC2.
   */
  async iniciarDemo({ idDemo, idVehiculo = this.vehiculoId }) {
    const payload = {
      id_demo: Number(idDemo),
      id_vehiculo: Number(idVehiculo)
    };

    try {
      return await this.request(
        CONFIG.ENDPOINTS.CONTROL_DEMO_EJECUTAR(idDemo),
        {
          method: "POST",
          body: JSON.stringify(payload)
        },
        25000
      );
    } catch (err) {
      if (err && (err.status === 404 || err.status === 405)) {
        return await this.request(
          CONFIG.ENDPOINTS.DEMO_INICIAR,
          {
            method: "POST",
            body: JSON.stringify(payload)
          },
          25000
        );
      }
      throw err;
    }
  }

  /**
   * Cancela una secuencia DEMO en curso y envía DETENER con prioridad.
   */
  async cancelarDemo({ idDemo, idVehiculo = this.vehiculoId }) {
    const payload = {
      id_demo: Number(idDemo),
      id_vehiculo: Number(idVehiculo)
    };

    try {
      return await this.request(CONFIG.ENDPOINTS.DEMO_CANCELAR, {
        method: "POST",
        body: JSON.stringify(payload)
      });
    } catch {
      return await this.enviarMovimiento({
        idVehiculo,
        idComando: CONFIG.DEFAULT_COMMAND_MAP.DETENER.id_comando,
        codigo: CONFIG.DEFAULT_COMMAND_MAP.DETENER.codigo,
        nombre: "DETENER",
        origen: "CANCELAR-DEMO"
      });
    }
  }
}

export const api = new ApiClient();
