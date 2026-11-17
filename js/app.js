/**
 * Coordinador Principal de la Excavadora IoT (ES6 Module)
 * Arquitectura de Dos Secciones Estrictas:
 * - Sección 1 (Controles - Solo Interactivo): Joystick D-pad compacto (▲, ▼, ◀, ▶, STOP central),
 *   botón de Claxon, sliders de Volumen y Velocidad, maniobras y DEMO.
 * - Sección 2 (Monitoreo - Solo Lectura): Conexión WSS, Último Comando, Timestamp,
 *   Velocidad Actual, Nivel de Volumen y Tabla de Historial (10 registros).
 */

import { CONFIG } from "./config.js";
import { api } from "./api.js";
import { IoTWebSocketClient, destelloVisualControl } from "./websocket.js";
import { VirtualJoystick } from "./joystick.js";
import { monitoreoInstance } from "./monitoreo.js";

class ExcavadoraApp {
  constructor() {
    this.commandCatalog = new Map();
    this.isDemoRunning = false;
    this.activeDemoId = null;
    this.healthTimer = null;
    this.currentView = "control";
    this.audioCtx = null;

    this.ui = {
      vehiculoId: document.getElementById("lbl-vehiculo-id"),
      badgeWs: document.getElementById("badge-ws"),
      badgeApi: document.getElementById("badge-api"),
      badgeRds: document.getElementById("badge-rds"),
      btnRefreshHealth: document.getElementById("btn-refresh-health"),
      tabBtnControl: document.getElementById("tab-btn-control"),
      tabBtnMonitoreo: document.getElementById("tab-btn-monitoreo"),
      viewSectionControl: document.getElementById("section-controles"),
      viewSectionMonitoreo: document.getElementById("section-monitoreo"),
      lblComandoActual: document.getElementById("lbl-comando-actual"),
      lblUltimaRespuesta: document.getElementById("lbl-ultima-respuesta"),
      badgeJoystickDir: document.getElementById("badge-direccion-joystick"),
      joystickZone: document.getElementById("joystick-zone"),
      joystickThumb: document.getElementById("joystick-thumb"),
      btnStopPriority: document.getElementById("btn-stop-priority"),
      btnDpadStop: document.getElementById("btn-joy-stop"),
      btnDpadUp: document.getElementById("btn-joy-up"),
      btnDpadDown: document.getElementById("btn-joy-down"),
      btnDpadLeft: document.getElementById("btn-joy-left"),
      btnDpadRight: document.getElementById("btn-joy-right"),
      btnClaxon: document.getElementById("btn-claxon"),
      sliderVolume: document.getElementById("slider-volume"),
      lblVolumeVal: document.getElementById("lbl-volume-val"),
      sliderSpeed: document.getElementById("slider-speed"),
      lblSpeedVal: document.getElementById("lbl-speed-val"),
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

    // 1. Inicializar controlador de Monitoreo (Sección 2 Solo Lectura)
    this.monitoreo = monitoreoInstance;
    this.monitoreo.initDomReferences();

    // 2. Inicializar Joystick Virtual Circular si existe en el DOM
    if (this.ui.joystickZone && this.ui.joystickThumb) {
      this.joystick = new VirtualJoystick({
        zoneElement: this.ui.joystickZone,
        thumbElement: this.ui.joystickThumb,
        onDirectionChange: (direction) => this.handleJoystickDirection(direction)
      });
    }

    // 3. Inicializar cliente WebSocket WSS
    this.wsClient = new IoTWebSocketClient({
      onStatusChange: (state) => {
        this.updateWsIndicator(state);
        this.monitoreo.setWssStatus(state);
      },
      onMessage: (payload) => this.handleWsMessage(payload)
    });
    this.wsClient.connect();

    // 4. Enlazar eventos de hardware y navegación
    this.bindUiEvents();

    // 5. Sincronizar catálogos y salud de AWS / RDS
    await this.verifyHealthAndSyncCatalogs();

    // 6. Sondeo periódico de infraestructura
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
    // Pestañas de navegación
    if (this.ui.tabBtnControl) {
      this.ui.tabBtnControl.addEventListener("click", () => {
        this.switchView("control");
      });
    }

    if (this.ui.tabBtnMonitoreo) {
      this.ui.tabBtnMonitoreo.addEventListener("click", () => {
        this.switchView("monitoreo");
      });
    }

    // Botón superior de sincronización manual
    if (this.ui.btnRefreshHealth) {
      this.ui.btnRefreshHealth.addEventListener("click", () => {
        this.wsClient.connect();
        this.verifyHealthAndSyncCatalogs();
      });
    }

    // Botones del D-pad compacto / Joystick Grid
    const dpadButtons = [
      { el: this.ui.btnDpadUp, cmd: "AVANZAR" },
      { el: this.ui.btnDpadDown, cmd: "RETROCEDER" },
      { el: this.ui.btnDpadLeft, cmd: "IZQUIERDA" },
      { el: this.ui.btnDpadRight, cmd: "DERECHA" }
    ];

    dpadButtons.forEach(({ el, cmd }) => {
      if (!el) return;
      el.addEventListener("click", async () => {
        if (this.isDemoRunning) return;
        await this.dispatchCommandByName(cmd, false);
      });
    });

    // Botones de Paro Prioritario (STOP central rojo + STOP principal)
    const stopButtons = [this.ui.btnStopPriority, this.ui.btnDpadStop].filter(Boolean);
    stopButtons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (this.isDemoRunning && this.activeDemoId) {
          await this.cancelActiveDemo();
        } else {
          if (this.joystick) this.joystick.forceStop();
          await this.dispatchCommandByName("DETENER", true);
        }
      });
    });

    // Control de Claxon con sonido sintetizado Web Audio
    if (this.ui.btnClaxon) {
      this.ui.btnClaxon.addEventListener("click", async () => {
        this.emitClaxonSound();
        destelloVisualControl("DETENER");
        this.ui.lblUltimaRespuesta.textContent = "Claxon activado 📢";
        try {
          await api.tocarClaxon(CONFIG.VEHICULO_ID);
        } catch {
          // Ya logueado internamente
        }
      });
    }

    // Slider de Volumen
    if (this.ui.sliderVolume) {
      this.ui.sliderVolume.addEventListener("input", (e) => {
        const val = e.target.value;
        if (this.ui.lblVolumeVal) {
          this.ui.lblVolumeVal.textContent = `${val}%`;
        }
        this.monitoreo.setVolumenTelemetry(val);
      });

      this.ui.sliderVolume.addEventListener("change", async (e) => {
        const val = e.target.value;
        await api.ajustarVolumen(val, CONFIG.VEHICULO_ID);
      });
    }

    // Slider de Velocidad
    if (this.ui.sliderSpeed) {
      this.ui.sliderSpeed.addEventListener("input", (e) => {
        const val = e.target.value;
        let speedLabel = "Normal (70%)";
        if (val <= 35) speedLabel = "Lento (30%)";
        else if (val >= 85) speedLabel = "Turbo (100%)";

        if (this.ui.lblSpeedVal) {
          this.ui.lblSpeedVal.textContent = speedLabel;
        }
        this.monitoreo.setVelocidadTelemetry(val);
      });

      this.ui.sliderSpeed.addEventListener("change", async (e) => {
        const val = e.target.value;
        await api.ajustarVelocidad(val, CONFIG.VEHICULO_ID);
      });
    }

    // Botones secundarios de maniobras (90°, 360°)
    this.ui.secondaryButtons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (this.isDemoRunning) return;
        const cmdName = btn.getAttribute("data-cmd-name");
        if (cmdName) {
          await this.dispatchCommandByName(cmdName, false);
        }
      });
    });

    // Botones de Secuencias DEMO
    if (this.ui.btnDemoStart) {
      this.ui.btnDemoStart.addEventListener("click", async () => {
        await this.startSelectedDemo();
      });
    }

    if (this.ui.btnDemoCancel) {
      this.ui.btnDemoCancel.addEventListener("click", async () => {
        await this.cancelActiveDemo();
      });
    }
  }

  /**
   * Genera un sonido de claxon/bocina de vehículo usando Web Audio API.
   */
  emitClaxonSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === "suspended") {
        this.audioCtx.resume();
      }

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(420, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(380, this.audioCtx.currentTime + 0.25);

      gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.3);
    } catch {
      // Audio en silencio si no está permitido
    }
  }

  /**
   * Cambia de vista entre Control y Monitoreo sin romper el estado ni la responsividad.
   */
  async switchView(targetView) {
    this.currentView = targetView === "monitoreo" ? "monitoreo" : "control";

    if (this.ui.tabBtnControl && this.ui.tabBtnMonitoreo) {
      if (this.currentView === "monitoreo") {
        this.ui.tabBtnControl.classList.remove("active");
        this.ui.tabBtnMonitoreo.classList.add("active");
      } else {
        this.ui.tabBtnMonitoreo.classList.remove("active");
        this.ui.tabBtnControl.classList.add("active");
      }
    }

    if (this.ui.viewSectionControl && this.ui.viewSectionMonitoreo) {
      if (this.currentView === "monitoreo") {
        this.ui.viewSectionControl.classList.add("view-hidden-mobile");
        this.ui.viewSectionMonitoreo.classList.remove("view-hidden-mobile");
        if (this.monitoreo) {
          await this.monitoreo.refreshAll(true);
        }
      } else {
        this.ui.viewSectionMonitoreo.classList.add("view-hidden-mobile");
        this.ui.viewSectionControl.classList.remove("view-hidden-mobile");
      }
    }
  }

  async verifyHealthAndSyncCatalogs() {
    this.updateApiIndicator("checking");
    const { apiAvailable, rdsState } = await api.checkInfrastructureHealth();

    this.updateApiIndicator(apiAvailable ? "available" : "unavailable");
    this.updateRdsIndicator(rdsState);

    if (apiAvailable) {
      const tasks = [this.loadCommandsCatalog(), this.loadDemosCatalog()];
      if (this.monitoreo) {
        tasks.push(this.monitoreo.refreshAll(false));
      }
      await Promise.allSettled(tasks);
    } else {
      this.loadFallbackDemosOption();
      if (this.ui.lblUltimaRespuesta) {
        this.ui.lblUltimaRespuesta.innerHTML =
          `Servidor AWS: <a href="https://52.4.170.82:8000/docs" target="_blank" class="fw-bold text-pink-accent">52.4.170.82:8000</a>`;
      }
    }
  }

  async checkHealthOnly() {
    const { apiAvailable, rdsState } = await api.checkInfrastructureHealth();
    this.updateApiIndicator(apiAvailable ? "available" : "unavailable");
    this.updateRdsIndicator(rdsState);
  }

  loadFallbackDemosOption() {
    if (this.ui.selectDemo && this.ui.selectDemo.options.length <= 1) {
      this.ui.selectDemo.innerHTML = `<option value="1">Demo #1 - Secuencia automática estándar</option>`;
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

      if (this.ui.dynamicCatalogContainer) {
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
              <span class="btn-deco-corner">✦</span>
              <i class="bi bi-gear-wide-connected d-block fs-5 icon-pastel"></i>
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
      }
    } catch {
      // Conserva catálogo base
    }
  }

  async loadDemosCatalog() {
    if (!this.ui.selectDemo) return;
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
        opt.textContent = `${demo.nombre}${desc}`;
        this.ui.selectDemo.appendChild(opt);
      });
    } catch {
      this.loadFallbackDemosOption();
    }
  }

  async handleJoystickDirection(direction) {
    if (this.ui.badgeJoystickDir) {
      this.ui.badgeJoystickDir.textContent =
        direction === "DETENER" ? "NEUTRAL" : direction;
    }

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

    if (this.ui.lblComandoActual) {
      this.ui.lblComandoActual.textContent = cmdInfo.nombre;
    }
    if (this.ui.lblUltimaRespuesta) {
      this.ui.lblUltimaRespuesta.textContent = `Enviando ${cmdInfo.nombre}...`;
    }

    // Feedback visual inmediato en el botón correspondiente
    destelloVisualControl(cmdInfo.nombre);

    try {
      const res = await api.enviarMovimiento({
        idVehiculo: CONFIG.VEHICULO_ID,
        idComando: cmdInfo.id_comando,
        codigo: cmdInfo.codigo,
        nombre: cmdInfo.nombre,
        origen: isPriority ? "PRIORIDAD-DETENER" : CONFIG.ORIGEN_CONTROL
      });

      const hora = new Date().toLocaleTimeString("es-MX", { hour12: true });
      if (this.ui.lblUltimaRespuesta) {
        this.ui.lblUltimaRespuesta.textContent = `${cmdInfo.nombre} confirmado (${hora})`;
      }
      this.updateApiIndicator("available");

      if (this.monitoreo) {
        if (res.data && res.data.estado) {
          this.monitoreo.renderEstadoCard(res.data.estado);
        } else {
          this.monitoreo.fetchAndRenderUltimoEstado();
        }
        this.monitoreo.fetchAndRenderHistorial(false);
      }
    } catch (err) {
      // Fallback directo por WebSocket seguro
      const sentByWs = this.wsClient.sendJson({
        id_vehiculo: CONFIG.VEHICULO_ID,
        id_comando: cmdInfo.id_comando,
        origen: isPriority ? "PRIORIDAD-DETENER" : CONFIG.ORIGEN_CONTROL
      });

      if (sentByWs) {
        const hora = new Date().toLocaleTimeString("es-MX", { hour12: true });
        if (this.ui.lblUltimaRespuesta) {
          this.ui.lblUltimaRespuesta.textContent = `${cmdInfo.nombre} enviado vía WSS (${hora})`;
        }
      } else {
        if (this.ui.lblUltimaRespuesta) {
          this.ui.lblUltimaRespuesta.textContent = `Error al enviar ${cmdInfo.nombre}: ${err.message}`;
        }
        this.updateApiIndicator("unavailable");
      }
    }
  }

  async startSelectedDemo() {
    if (this.isDemoRunning || !this.ui.selectDemo) return;

    const selectedDemoId = Number(this.ui.selectDemo.value || 1);
    this.setDemoLockState(true, selectedDemoId);
    if (this.ui.lblComandoActual) {
      this.ui.lblComandoActual.textContent = `DEMO #${selectedDemoId} EN EJECUCIÓN`;
    }
    if (this.ui.lblUltimaRespuesta) {
      this.ui.lblUltimaRespuesta.textContent = "Ejecutando secuencia en AWS...";
    }

    try {
      await api.iniciarDemo({
        idDemo: selectedDemoId,
        idVehiculo: CONFIG.VEHICULO_ID
      });

      if (this.isDemoRunning) {
        this.setDemoLockState(false, null);
        if (this.ui.lblComandoActual) this.ui.lblComandoActual.textContent = "DETENER";
        if (this.ui.lblUltimaRespuesta) {
          this.ui.lblUltimaRespuesta.textContent = `DEMO #${selectedDemoId} completada`;
        }
        if (this.monitoreo) {
          this.monitoreo.fetchAndRenderUltimoEstado();
        }
      }
    } catch (err) {
      this.setDemoLockState(false, null);
      if (this.ui.lblUltimaRespuesta) {
        this.ui.lblUltimaRespuesta.textContent = `Error en DEMO: ${err.message}`;
      }
    }
  }

  async cancelActiveDemo() {
    const demoIdToCancel =
      this.activeDemoId || Number((this.ui.selectDemo && this.ui.selectDemo.value) || 1);
    if (this.ui.lblUltimaRespuesta) {
      this.ui.lblUltimaRespuesta.textContent = `Cancelando DEMO #${demoIdToCancel}...`;
    }

    try {
      await api.cancelarDemo({
        idDemo: demoIdToCancel,
        idVehiculo: CONFIG.VEHICULO_ID
      });
    } finally {
      this.setDemoLockState(false, null);
      if (this.ui.lblComandoActual) this.ui.lblComandoActual.textContent = "DETENER";
      if (this.ui.lblUltimaRespuesta) {
        this.ui.lblUltimaRespuesta.textContent = "DEMO cancelada · Vehículo detenido";
      }
      if (this.monitoreo) {
        this.monitoreo.refreshAll(false);
      }
    }
  }

  setDemoLockState(locked, demoId = null) {
    this.isDemoRunning = locked;
    this.activeDemoId = demoId;

    if (this.joystick) this.joystick.setDisabled(locked);
    if (this.ui.selectDemo) this.ui.selectDemo.disabled = locked;
    if (this.ui.btnDemoStart) this.ui.btnDemoStart.disabled = locked;
    if (this.ui.btnDemoCancel) this.ui.btnDemoCancel.disabled = !locked;

    if (this.ui.btnDpadUp) this.ui.btnDpadUp.disabled = locked;
    if (this.ui.btnDpadDown) this.ui.btnDpadDown.disabled = locked;
    if (this.ui.btnDpadLeft) this.ui.btnDpadLeft.disabled = locked;
    if (this.ui.btnDpadRight) this.ui.btnDpadRight.disabled = locked;

    this.ui.secondaryButtons.forEach((btn) => {
      btn.disabled = locked;
    });
    document.querySelectorAll(".dynamic-cmd-btn").forEach((btn) => {
      btn.disabled = locked;
    });

    if (this.ui.badgeDemoStatus) {
      if (locked) {
        this.ui.badgeDemoStatus.className = "badge rounded-pill badge-pastel-warning";
        this.ui.badgeDemoStatus.textContent = `Activa (ID ${demoId})`;
      } else {
        this.ui.badgeDemoStatus.className = "badge rounded-pill badge-pastel-neutral";
        this.ui.badgeDemoStatus.textContent = "Inactiva";
      }
    }
  }

  /**
   * Procesa mensajes de WebSocket y gestiona la visualización de DEMO en vivo
   */
  handleWsMessage(payload) {
    if (!payload || typeof payload !== "object") return;

    if (payload.evento === "DEMO_INICIADA") {
      this.setDemoLockState(true, payload.id_demo || 1);
    } else if (payload.evento === "DEMO_PASO" && payload.comando) {
      if (this.ui.lblComandoActual) {
        this.ui.lblComandoActual.textContent = `DEMO: ${payload.comando}`;
      }
      if (this.ui.lblUltimaRespuesta) {
        this.ui.lblUltimaRespuesta.textContent = `Paso #${payload.orden} (${payload.duracion_ms} ms)`;
      }
      destelloVisualControl(payload.comando);
    } else if (payload.evento === "DEMO_FINALIZADA") {
      this.setDemoLockState(false, null);
      if (this.ui.lblComandoActual) this.ui.lblComandoActual.textContent = "DETENER";
      if (this.ui.lblUltimaRespuesta) {
        this.ui.lblUltimaRespuesta.textContent = "DEMO finalizada";
      }
    } else if (payload.estado && payload.estado.comando) {
      const cmdNombre = String(payload.estado.comando);
      if (this.ui.lblComandoActual) {
        this.ui.lblComandoActual.textContent = cmdNombre;
      }

      if (payload.evento === "MOVIMIENTO_INDIVIDUAL" || payload.evento === "ESTADO_ACTUALIZADO") {
        const hora = new Date().toLocaleTimeString("es-MX", { hour12: true });
        if (this.ui.lblUltimaRespuesta) {
          this.ui.lblUltimaRespuesta.textContent = `Sincronizado: ${cmdNombre} (${hora})`;
        }
      }

      if (this.ui.badgeJoystickDir && (!this.joystick || !this.joystick.isDragging)) {
        this.ui.badgeJoystickDir.textContent =
          cmdNombre.toUpperCase() === "DETENER"
            ? "NEUTRAL"
            : cmdNombre.toUpperCase();
      }
    }
  }

  updateWsIndicator(state) {
    const el = this.ui.badgeWs;
    if (!el) return;

    if (state === "online") {
      el.className = "badge rounded-pill badge-pastel-online";
      el.innerHTML = `<span class="status-dot dot-online"></span>En línea`;
    } else if (state === "connecting" || state === "reconnecting") {
      el.className = "badge rounded-pill badge-pastel-warning";
      el.innerHTML = `<span class="status-dot dot-warning"></span>Conectando...`;
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
      el.innerHTML = `<span class="status-dot dot-online"></span>Disponible`;
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
      el.innerHTML = `<span class="status-dot dot-online"></span>Disponible`;
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
  const app = new ExcavadoraApp();
  app.init();
});
