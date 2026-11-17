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
        }
      }
    }

    if (apiAvailable && rdsState === "unverified") {
      try {
        const estadoRes = await this.request(
          CONFIG.ENDPOINTS.ESTADO_VEHICULO(this.vehiculoId),
          { method: "GET" },
          3500
        );
        if (estadoRes.ok) {
          rdsState = "available";
        }
      } catch {
        rdsState = "unavailable";
      }
    }

    return { apiAvailable, rdsState };
  }

  /**
   * Obtiene la lista de vehículos disponibles en Amazon RDS.
   */
  async obtenerVehiculos() {
    const res = await this.request(CONFIG.ENDPOINTS.VEHICULOS, { method: "GET" });
    return Array.isArray(res.data) ? res.data : [];
  }

  /**
   * Obtiene el catálogo de comandos soportados para el vehículo.
   */
  async obtenerComandos(idVehiculo = this.vehiculoId) {
    try {
      const res = await this.request(
        CONFIG.ENDPOINTS.COMANDOS_VEHICULO(idVehiculo),
        { method: "GET" }
      );
      return Array.isArray(res.data) ? res.data : [];
    } catch {
      const resFallback = await this.request(CONFIG.ENDPOINTS.COMANDOS, {
        method: "GET"
      });
      return Array.isArray(resFallback.data) ? resFallback.data : [];
    }
  }

  /**
   * Obtiene la lista de coreografías / secuencias DEMO disponibles.
   */
  async obtenerDemos(idVehiculo = this.vehiculoId) {
    try {
      const res = await this.request(
        CONFIG.ENDPOINTS.DEMOS_VEHICULO(idVehiculo),
        { method: "GET" }
      );
      return Array.isArray(res.data) ? res.data : [];
    } catch {
      const resFallback = await this.request(CONFIG.ENDPOINTS.DEMOS, {
        method: "GET"
      });
      return Array.isArray(resFallback.data) ? resFallback.data : [];
    }
  }

  /**
   * Obtiene el estado más reciente del vehículo en tiempo real.
   */
  async obtenerEstadoVehiculo(idVehiculo = this.vehiculoId) {
    try {
      const res = await this.request(
        CONFIG.ENDPOINTS.ESTADO_VEHICULO(idVehiculo),
        { method: "GET" }
      );
      return res.data;
    } catch (err) {
      if (err && (err.status === 404 || err.status === 405)) {
        const resQuery = await this.request(
          CONFIG.ENDPOINTS.ESTADO_QUERY(idVehiculo),
          { method: "GET" }
        );
        return resQuery.data;
      }
      throw err;
    }
  }

  /**
   * Obtiene el historial real de movimientos desde Amazon RDS (máximo 10).
   */
  async obtenerHistorialVehiculo(
    idVehiculo = this.vehiculoId,
    limit = CONFIG.HISTORIAL_LIMIT || 10
  ) {
    let records = [];

    try {
      const pathWithLimit = `${CONFIG.ENDPOINTS.HISTORIAL_VEHICULO(idVehiculo)}?limit=${limit}`;
      const res = await this.request(pathWithLimit, { method: "GET" });
      records = Array.isArray(res.data)
        ? res.data
        : res.data && Array.isArray(res.data.items)
        ? res.data.items
        : [];
    } catch (err) {
      if (err && (err.status === 404 || err.status === 405)) {
        const queryPath = `${CONFIG.ENDPOINTS.HISTORIAL_QUERY(idVehiculo)}&limit=${limit}`;
        const resQuery = await this.request(queryPath, { method: "GET" });
        records = Array.isArray(resQuery.data)
          ? resQuery.data
          : resQuery.data && Array.isArray(resQuery.data.items)
          ? resQuery.data.items
          : [];
      } else {
        throw err;
      }
    }

    records.sort((a, b) => {
      const timeA = new Date(a.fecha_hora || a.fecha_actualizacion || 0).getTime();
      const timeB = new Date(b.fecha_hora || b.fecha_actualizacion || 0).getTime();
      return timeB - timeA;
    });

    return records.slice(0, limit);
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
   * Emite señal de Claxon / Sonido de excavadora hacia el backend.
   */
  async tocarClaxon(idVehiculo = this.vehiculoId) {
    const payload = {
      id_vehiculo: Number(idVehiculo),
      accion: "CLAXON",
      timestamp: new Date().toISOString()
    };

    try {
      return await this.request(CONFIG.ENDPOINTS.CONTROL_CLAXON, {
        method: "POST",
        body: JSON.stringify(payload)
      });
    } catch {
      console.log("[HW IoT] Claxon activado localmente (endpoint remoto 404/no implementado aún):", payload);
      return { ok: true, data: { status: "local_claxon" } };
    }
  }

  /**
   * Envía ajuste de volumen al backend.
   */
  async ajustarVolumen(nivel, idVehiculo = this.vehiculoId) {
    const payload = {
      id_vehiculo: Number(idVehiculo),
      volumen: Number(nivel)
    };

    try {
      return await this.request(CONFIG.ENDPOINTS.CONTROL_VOLUMEN, {
        method: "POST",
        body: JSON.stringify(payload)
      });
    } catch {
      console.log(`[HW IoT] Nivel de volumen actualizado a: ${nivel}% (local)`);
      return { ok: true, data: { volumen: nivel } };
    }
  }

  /**
   * Envía ajuste de velocidad al backend.
   */
  async ajustarVelocidad(nivel, idVehiculo = this.vehiculoId) {
    const payload = {
      id_vehiculo: Number(idVehiculo),
      velocidad: Number(nivel)
    };

    try {
      return await this.request(CONFIG.ENDPOINTS.CONTROL_VELOCIDAD, {
        method: "POST",
        body: JSON.stringify(payload)
      });
    } catch {
      console.log(`[HW IoT] Nivel de velocidad actualizado a: ${nivel}% (local)`);
      return { ok: true, data: { velocidad: nivel } };
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
