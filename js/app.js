/**
 * Coordinador Global de la Aplicación de Control IoT
 * Compatible tanto con GitHub Pages (HTTPS/WSS) como al abrir index.html directamente en Windows (file:///).
 */
(function (global) {
  const CONFIG = global.IOT_CONFIG;
  const api = global.iotApi;
  const IoTWebSocketClient = global.IoTWebSocketClient;
  const VirtualJoystick = global.VirtualJoystick;

  class ControlApp {
    constructor() {
      this.commandCatalog = new Map();
      this.isDemoRunning = false;
      this.activeDemoId = null;
      this.healthTimer = null;

      this.ui = {
        vehiculoId: document.getElementById("lbl-vehiculo-id"),
        badgeWs: document.getElementById("badge-ws"),
        badgeApi: document.getElementById("badge-api"),
        badgeRds: document.getElementById("badge-rds"),
        btnRefreshHealth: document.getElementById("btn-refresh-health"),
        lblComandoActual: document.getElementById("lbl-comando-actual"),
        lblUltimaRespuesta: document.getElementById("lbl-ultima-respuesta"),
        badgeJoystickDir: document.getElementById("badge-direccion-joystick"),
        joystickZone: document.getElementById("joystick-zone"),
        joystickThumb: document.getElementById("joystick-thumb"),
        btnStopPriority: document.getElementById("btn-stop-priority"),
        secondaryButtons: document.querySelectorAll(".cmd-sec-btn"),
        dynamicCatalogContainer: document.getElementById("dynamic-catalog-commands"),
        selectDemo: document.getElementById("select-demo"),
        btnDemoStart: document.getElementById("btn-demo-start"),
        btnDemoCancel: document.getElementById("btn-demo-cancel"),
        badgeDemoStatus: document.getElementById("badge-demo-status")
      };
    }

    async init() {
      if (this.ui.vehiculoId) {
        this.ui.vehiculoId.textContent = String(CONFIG.VEHICULO_ID);
      }

      this.seedDefaultCommands();

      this.joystick = new VirtualJoystick({
        zoneElement: this.ui.joystickZone,
        thumbElement: this.ui.joystickThumb,
        onDirectionChange: (direction) => this.handleJoystickDirection(direction)
      });

      this.wsClient = new IoTWebSocketClient({
        onStatusChange: (state) => this.updateWsIndicator(state),
        onMessage: (payload) => this.handleWsMessage(payload)
      });
      this.wsClient.connect();

      this.bindUiEvents();

      await this.verifyHealthAndSyncCatalogs();

      this.healthTimer = window.setInterval(
        () => this.checkHealthOnly(),
        CONFIG.HEALTH_POLL_INTERVAL_MS
      );
    }

    seedDefaultCommands() {
      Object.entries(CONFIG.DEFAULT_COMMAND_MAP).forEach(([key, cmd]) => {
        this.commandCatalog.set(key.toUpperCase(), { ...cmd });
      });
    }

    normalizeCommandKey(rawName) {
      return String(rawName || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "_");
    }

    bindUiEvents() {
      this.ui.btnRefreshHealth.addEventListener("click", () => {
        this.wsClient.connect();
        this.verifyHealthAndSyncCatalogs();
      });

      this.ui.btnStopPriority.addEventListener("click", async () => {
        if (this.isDemoRunning && this.activeDemoId) {
          await this.cancelActiveDemo();
        } else {
          this.joystick.forceStop();
          await this.dispatchCommandByName("DETENER", true);
        }
      });

      this.ui.secondaryButtons.forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (this.isDemoRunning) return;
          const cmdName = btn.getAttribute("data-cmd-name");
          if (cmdName) {
            await this.dispatchCommandByName(cmdName, false);
          }
        });
      });

      this.ui.btnDemoStart.addEventListener("click", async () => {
        await this.startSelectedDemo();
      });

      this.ui.btnDemoCancel.addEventListener("click", async () => {
        await this.cancelActiveDemo();
      });
    }

    async verifyHealthAndSyncCatalogs() {
      this.updateApiIndicator("checking");
      const { apiAvailable, rdsState } = await api.checkInfrastructureHealth();

      this.updateApiIndicator(apiAvailable ? "available" : "unavailable");
      this.updateRdsIndicator(rdsState);

      if (apiAvailable) {
        await Promise.allSettled([this.loadCommandsCatalog(), this.loadDemosCatalog()]);
      } else {
        this.loadFallbackDemosOption();
        this.ui.lblUltimaRespuesta.innerHTML =
          `Acepta el certificado en <a href="https://52.4.170.82:8000/docs" target="_blank" class="fw-bold text-pink-accent">52.4.170.82:8000/docs</a> y pulsa Sincronizar ✨`;
      }
    }

    async checkHealthOnly() {
      const { apiAvailable, rdsState } = await api.checkInfrastructureHealth();
      this.updateApiIndicator(apiAvailable ? "available" : "unavailable");
      this.updateRdsIndicator(rdsState);
    }

    loadFallbackDemosOption() {
      if (this.ui.selectDemo && this.ui.selectDemo.options.length <= 1) {
        this.ui.selectDemo.innerHTML = `<option value="1">🌸 Demo #1 - Demo principal (Secuencia automática)</option>`;
      }
    }

    async loadCommandsCatalog() {
      try {
        const comandos = await api.obtenerComandos(CONFIG.VEHICULO_ID);
        if (!Array.isArray(comandos) || comandos.length === 0) return;

        const coreDirections = new Set([
          "AVANZAR",
          "RETROCEDER",
          "IZQUIERDA",
          "GIRAR_IZQUIERDA",
          "DERECHA",
          "GIRAR_DERECHA",
          "DETENER"
        ]);

        this.ui.dynamicCatalogContainer.innerHTML = "";

        comandos.forEach((cmd) => {
          const key = this.normalizeCommandKey(cmd.nombre);
          const entry = {
            id_comando: Number(cmd.id_comando),
            codigo: Number(cmd.codigo ?? cmd.id_comando),
            nombre: String(cmd.nombre),
            descripcion: cmd.descripcion || ""
          };
          this.commandCatalog.set(key, entry);

          if (key === "GIRAR_IZQUIERDA") {
            this.commandCatalog.set("IZQUIERDA", entry);
          } else if (key === "GIRAR_DERECHA") {
            this.commandCatalog.set("DERECHA", entry);
          }

          if (!coreDirections.has(key)) {
            const col = document.createElement("div");
            col.className = "col-6 col-sm-3";
            const button = document.createElement("button");
            button.type = "button";
            button.className = "btn w-100 py-2 cmd-sec-btn dynamic-cmd-btn";
            button.disabled = this.isDemoRunning;
            button.innerHTML = `
              <span class="btn-deco-corner">✨</span>
              <i class="bi bi-stars d-block fs-5 icon-pastel"></i>
              <span class="small fw-bold">${entry.nombre.replace(/_/g, " ")}</span>
            `;
            button.addEventListener("click", async () => {
              if (!this.isDemoRunning) {
                await this.dispatchCommandByName(key, false);
              }
            });
            col.appendChild(button);
            this.ui.dynamicCatalogContainer.appendChild(col);
          }
        });
      } catch {
        // Conserva catálogo por defecto
      }
    }

    async loadDemosCatalog() {
      try {
        const demos = await api.obtenerDemos(CONFIG.VEHICULO_ID);
        this.ui.selectDemo.innerHTML = "";

        if (!Array.isArray(demos) || demos.length === 0) {
          this.loadFallbackDemosOption();
          return;
        }

        demos.forEach((demo) => {
          const opt = document.createElement("option");
          opt.value = String(demo.id_demo);
          const desc = demo.descripcion ? ` — ${demo.descripcion}` : "";
          opt.textContent = `🌸 ${demo.nombre}${desc}`;
          this.ui.selectDemo.appendChild(opt);
        });
      } catch {
        this.loadFallbackDemosOption();
      }
    }

    async handleJoystickDirection(direction) {
      this.ui.badgeJoystickDir.textContent =
        direction === "DETENER" ? "✿ NEUTRAL (CENTRO)" : `✨ ${direction}`;

      const isPriorityStop = direction === "DETENER";
      if (this.isDemoRunning && !isPriorityStop) {
        return;
      }

      await this.dispatchCommandByName(direction, isPriorityStop);
    }

    async dispatchCommandByName(commandKey, isPriority = false) {
      if (this.isDemoRunning && !isPriority) {
        return;
      }

      const normalized = this.normalizeCommandKey(commandKey);
      const cmdInfo =
        this.commandCatalog.get(normalized) ||
        CONFIG.DEFAULT_COMMAND_MAP[normalized] ||
        CONFIG.DEFAULT_COMMAND_MAP.DETENER;

      this.ui.lblComandoActual.textContent = cmdInfo.nombre;
      this.ui.lblUltimaRespuesta.textContent = `Enviando ${cmdInfo.nombre}... ✨`;

      try {
        await api.enviarMovimiento({
          idVehiculo: CONFIG.VEHICULO_ID,
          idComando: cmdInfo.id_comando,
          codigo: cmdInfo.codigo,
          nombre: cmdInfo.nombre,
          origen: isPriority ? "PRIORIDAD-DETENER" : CONFIG.ORIGEN_CONTROL
        });

        const hora = new Date().toLocaleTimeString();
        this.ui.lblUltimaRespuesta.textContent = `${cmdInfo.nombre} confirmado (${hora}) 🌸`;
        this.updateApiIndicator("available");
      } catch (err) {
        this.ui.lblUltimaRespuesta.textContent = `Error al enviar ${cmdInfo.nombre}: ${err.message}`;
        this.updateApiIndicator("unavailable");
      }
    }

    async startSelectedDemo() {
      if (this.isDemoRunning) return;

      const selectedDemoId = Number(this.ui.selectDemo.value || 1);
      this.setDemoLockState(true, selectedDemoId);
      this.ui.lblComandoActual.textContent = `✨ DEMO #${selectedDemoId} EN EJECUCIÓN`;
      this.ui.lblUltimaRespuesta.textContent = "Ejecutando secuencia en AWS (sin historial individual)... 🌸";

      try {
        await api.iniciarDemo({
          idDemo: selectedDemoId,
          idVehiculo: CONFIG.VEHICULO_ID
        });

        if (this.isDemoRunning) {
          this.setDemoLockState(false, null);
          this.ui.lblComandoActual.textContent = "DETENER";
          this.ui.lblUltimaRespuesta.textContent = `DEMO #${selectedDemoId} finalizada con éxito ✨`;
        }
      } catch (err) {
        this.setDemoLockState(false, null);
        this.ui.lblUltimaRespuesta.textContent = `Error en DEMO: ${err.message}`;
      }
    }

    async cancelActiveDemo() {
      const demoIdToCancel = this.activeDemoId || Number(this.ui.selectDemo.value || 1);
      this.ui.lblUltimaRespuesta.textContent = `Cancelando DEMO #${demoIdToCancel} con prioridad...`;

      try {
        await api.cancelarDemo({
          idDemo: demoIdToCancel,
          idVehiculo: CONFIG.VEHICULO_ID
        });
      } finally {
        this.setDemoLockState(false, null);
        this.ui.lblComandoActual.textContent = "DETENER";
        this.ui.lblUltimaRespuesta.textContent = "DEMO cancelada · Vehículo detenido 🌸";
      }
    }

    setDemoLockState(locked, demoId = null) {
      this.isDemoRunning = locked;
      this.activeDemoId = demoId;

      this.joystick.setDisabled(locked);
      this.ui.selectDemo.disabled = locked;
      this.ui.btnDemoStart.disabled = locked;
      this.ui.btnDemoCancel.disabled = !locked;

      this.ui.secondaryButtons.forEach((btn) => {
        btn.disabled = locked;
      });
      document.querySelectorAll(".dynamic-cmd-btn").forEach((btn) => {
        btn.disabled = locked;
      });

      if (locked) {
        this.ui.badgeDemoStatus.className = "badge rounded-pill badge-pastel-warning";
        this.ui.badgeDemoStatus.textContent = `✨ Activa (ID ${demoId})`;
      } else {
        this.ui.badgeDemoStatus.className = "badge rounded-pill badge-pastel-neutral";
        this.ui.badgeDemoStatus.textContent = "✿ Inactiva";
      }
    }

    handleWsMessage(payload) {
      if (!payload || typeof payload !== "object") return;

      if (payload.evento === "DEMO_INICIADA") {
        this.setDemoLockState(true, payload.id_demo || 1);
      } else if (payload.evento === "DEMO_PASO" && payload.comando) {
        this.ui.lblComandoActual.textContent = `DEMO: ${payload.comando}`;
        this.ui.lblUltimaRespuesta.textContent = `Paso #${payload.orden} (${payload.duracion_ms} ms) ✨`;
      } else if (payload.evento === "DEMO_FINALIZADA") {
        this.setDemoLockState(false, null);
        this.ui.lblComandoActual.textContent = "DETENER";
        this.ui.lblUltimaRespuesta.textContent = "DEMO finalizada por el servidor 🌸";
      } else if (payload.estado && payload.estado.comando) {
        this.ui.lblComandoActual.textContent = String(payload.estado.comando);
      }
    }

    updateWsIndicator(state) {
      const el = this.ui.badgeWs;
      if (!el) return;

      if (state === "online") {
        el.className = "badge rounded-pill badge-pastel-online";
        el.innerHTML = `<span class="status-dot dot-online"></span>En línea ✨`;
      } else if (state === "connecting") {
        el.className = "badge rounded-pill badge-pastel-warning";
        el.innerHTML = `<span class="status-dot dot-warning"></span>Conectando...`;
      } else if (state === "reconnecting") {
        el.className = "badge rounded-pill badge-pastel-warning";
        el.innerHTML = `<span class="status-dot dot-warning"></span>Reconectando...`;
      } else {
        el.className = "badge rounded-pill badge-pastel-offline";
        el.innerHTML = `<span class="status-dot dot-offline"></span>Desconectado`;
      }
    }

    updateApiIndicator(state) {
      const el = this.ui.badgeApi;
      if (!el) return;

      if (state === "available") {
        el.className = "badge rounded-pill badge-pastel-online";
        el.innerHTML = `<span class="status-dot dot-online"></span>Disponible ✨`;
      } else if (state === "checking") {
        el.className = "badge rounded-pill badge-pastel-warning";
        el.innerHTML = `<span class="status-dot dot-warning"></span>Comprobando...`;
      } else {
        el.className = "badge rounded-pill badge-pastel-offline";
        el.innerHTML = `<span class="status-dot dot-offline"></span>No disponible`;
      }
    }

    updateRdsIndicator(state) {
      const el = this.ui.badgeRds;
      if (!el) return;

      if (state === "available") {
        el.className = "badge rounded-pill badge-pastel-online";
        el.innerHTML = `<span class="status-dot dot-online"></span>Disponible ✨`;
      } else if (state === "unavailable") {
        el.className = "badge rounded-pill badge-pastel-offline";
        el.innerHTML = `<span class="status-dot dot-offline"></span>No disponible`;
      } else {
        el.className = "badge rounded-pill badge-pastel-neutral";
        el.innerHTML = `<span class="status-dot dot-neutral"></span>Sin verificar`;
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const app = new ControlApp();
    app.init();
  });
})(window);
