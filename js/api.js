/**
 * Cliente Fetch async/await centralizado
 * Conecta con AWS EC2 (https://52.4.170.82:8000) y soporta fallback automático
 * sin bloquearse aunque se abra desde file:/// o desde GitHub Pages.
 */
(function (global) {
  const CONFIG = global.IOT_CONFIG;

  class ApiClient {
    constructor() {
      this.baseUrl = CONFIG.API_BASE_URL.replace(/\/+$/, "");
      this.candidateBases = [
        CONFIG.API_BASE_URL.replace(/\/+$/, ""),
        CONFIG.API_FALLBACK_HTTP_URL.replace(/\/+$/, ""),
        CONFIG.API_LOCAL_URL.replace(/\/+$/, "")
      ];
      this.vehiculoId = CONFIG.VEHICULO_ID;
    }

    async _fetchWithUrl(base, path, options, timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const url = `${base}${path}`;
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
     * Intenta en el baseUrl activo; si falla por red/SSL, prueba los candidatos (AWS HTTPS -> AWS HTTP -> Local)
     */
    async request(path, options = {}, timeoutMs = CONFIG.FETCH_TIMEOUT_MS) {
      try {
        return await this._fetchWithUrl(this.baseUrl, path, options, timeoutMs);
      } catch (primaryErr) {
        if (primaryErr && primaryErr.status) {
          throw primaryErr;
        }
        for (const candidate of this.candidateBases) {
          if (candidate === this.baseUrl) continue;
          // En GitHub Pages (https:) el navegador solo permite candidatos https:// o localhost
          if (
            window.location.protocol === "https:" &&
            candidate.startsWith("http://") &&
            !candidate.includes("127.0.0.1")
          ) {
            continue;
          }
          try {
            const res = await this._fetchWithUrl(candidate, path, options, timeoutMs);
            this.baseUrl = candidate;
            return res;
          } catch {
            // Probar siguiente candidato
          }
        }
        throw primaryErr;
      }
    }

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

        // Si GET /api/vehiculos devuelve un arreglo con registros reales desde sp_obtener_vehiculos(),
        // significa que FastAPI consultó exitosamente a Amazon RDS MySQL.
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

      return { apiAvailable, rdsState, activeBaseUrl: this.baseUrl };
    }

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

  global.iotApi = new ApiClient();
})(window);
