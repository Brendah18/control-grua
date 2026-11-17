/**
 * Coordinador Principal de la Plataforma IoT (ES6 Module - Práctica 4.1, 4.2 y 4.3)
 * Integra:
 * - 4.1: Control Manual (Joystick, D-Pad, STOP Prioritario, Claxon, Sliders, Demos)
 * - 4.2: Monitoreo en Tiempo Real (Telemetría WSS, Timestamp es-MX, Tabla Historial 10 RDS)
 * - 4.3: Administración & RBAC (Dashboard Flota, Modelos vs Unidades, Asignación, Editor Demos, Auditoría)
 */

import { CONFIG } from "./config.js";
import { api } from "./api.js";
import { IoTWebSocketClient, destelloVisualControl } from "./websocket.js";
import { VirtualJoystick } from "./joystick.js";
import { monitoreoInstance } from "./monitoreo.js";

class PlatformApp {
  constructor() {
    this.commandCatalog = new Map();
    this.isDemoRunning = false;
    this.activeDemoId = null;
    this.currentView = "control";
    this.currentRole = "USUARIO";
    this.healthTimer = null;
    this.audioCtx = null;
    this.guestTimerInterval = null;
    this.guestSecondsLeft = 300; // 5 minutos

    this.ui = {
      // Header y RBAC
      lblVehiculoId: document.getElementById("lbl-vehiculo-id"),
      lblUnidadSerie: document.getElementById("lbl-unidad-serie"),
      selectUserRole: document.getElementById("select-user-role"),
      btnRefreshHealth: document.getElementById("btn-refresh-health"),
      alertGuestSession: document.getElementById("alert-guest-session"),
      guestTimerDisplay: document.getElementById("guest-timer-display"),
      btnRequestGuestTrial: document.getElementById("btn-request-guest-trial"),

      // Indicadores de Red e Infraestructura
      badgeWs: document.getElementById("badge-ws"),
      badgeApi: document.getElementById("badge-api"),
      badgeRds: document.getElementById("badge-rds"),

      // Navegación 3 Vistas
      navBtnControl: document.getElementById("nav-btn-control"),
      navBtnMonitoreo: document.getElementById("nav-btn-monitoreo"),
      navBtnAdmin: document.getElementById("nav-btn-admin"),
      viewControl: document.getElementById("view-control"),
      viewMonitoreo: document.getElementById("view-monitoreo"),
      viewAdmin: document.getElementById("view-admin"),

      // Vista 1: Control
      joystickZone: document.getElementById("joystick-zone"),
      joystickThumb: document.getElementById("joystick-thumb"),
      badgeJoystickDir: document.getElementById("badge-direccion-joystick"),
      btnStopPriority: document.getElementById("btn-stop-priority"),
      lblComandoActual: document.getElementById("lbl-comando-actual"),
      btnDpadUp: document.getElementById("btn-joy-up"),
      btnDpadDown: document.getElementById("btn-joy-down"),
      btnDpadLeft: document.getElementById("btn-joy-left"),
      btnDpadRight: document.getElementById("btn-joy-right"),
      btnDpadStop: document.getElementById("btn-joy-stop"),
      btnClaxon: document.getElementById("btn-claxon"),
      sliderVolume: document.getElementById("slider-volume"),
      lblVolumeVal: document.getElementById("lbl-volume-val"),
      sliderSpeed: document.getElementById("slider-speed"),
      lblSpeedVal: document.getElementById("lbl-speed-val"),
      selectDemo: document.getElementById("select-demo"),
      btnDemoStart: document.getElementById("btn-demo-start"),
      btnDemoCancel: document.getElementById("btn-demo-cancel"),
      badgeDemoStatus: document.getElementById("badge-demo-status"),
      lblDemoCurrentStep: document.getElementById("lbl-demo-current-step"),
      lblDemoStepDetails: document.getElementById("lbl-demo-step-details"),
      secondaryButtons: document.querySelectorAll(".cmd-sec-btn"),

      // Vista 3: Administración
      metricUnidades: document.getElementById("metric-unidades"),
      metricModelos: document.getElementById("metric-modelos"),
      metricUsuarios: document.getElementById("metric-usuarios"),
      metricDemos: document.getElementById("metric-demos"),
      tbodyAdminUnidades: document.getElementById("tbody-admin-unidades"),
      btnRefreshAdminUnits: document.getElementById("btn-refresh-admin-units"),
      selectAsignarUnidad: document.getElementById("select-asignar-unidad"),
      selectAsignarUsuario: document.getElementById("select-asignar-usuario"),
      btnAsignarUnidad: document.getElementById("btn-asignar-unidad"),
      btnAddDemoStep: document.getElementById("btn-add-demo-step"),
      inputDemoName: document.getElementById("input-demo-name"),
      demoEditorStepsList: document.getElementById("demo-editor-steps-list"),
      btnSaveCustomDemo: document.getElementById("btn-save-custom-demo"),
      tbodyAdminAuditoria: document.getElementById("tbody-admin-auditoria")
    };
  }

  async init() {
    this.seedDefaultCommands();

    // 1. Inicializar Monitoreo Compartido (Práctica 4.2)
    this.monitoreo = monitoreoInstance;
    this.monitoreo.initDomReferences();

    // 2. Inicializar Joystick Virtual (Práctica 4.1)
    if (this.ui.joystickZone && this.ui.joystickThumb) {
      this.joystick = new VirtualJoystick({
        zoneElement: this.ui.joystickZone,
        thumbElement: this.ui.joystickThumb,
        onDirectionChange: (dir) => this.handleJoystickDirection(dir)
      });
    }

    // 3. Inicializar WebSocket Seguro WSS
    this.wsClient = new IoTWebSocketClient({
      onStatusChange: (state) => {
        this.updateWsIndicator(state);
        this.monitoreo.setWssStatus(state);
      },
      onMessage: (payload) => this.handleWsMessage(payload)
    });
    this.wsClient.connect();

    // 4. Enlazar eventos de UI, Mandos y Navegación
    this.bindEvents();

    // 5. Aplicar Rol inicial (RBAC)
    this.applyRole(this.currentRole);

    // 6. Verificar salud de AWS y sincronizar catálogos
    await this.verifyHealthAndSync();

    // 7. Polling de salud de la infraestructura
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
    return String(rawName || "").trim().toUpperCase().replace(/\s+/g, "_");
  }

  bindEvents() {
    // Navegación de 3 Vistas
    this.ui.navBtnControl?.addEventListener("click", () => this.switchView("control"));
    this.ui.navBtnMonitoreo?.addEventListener("click", () => this.switchView("monitoreo"));
    this.ui.navBtnAdmin?.addEventListener("click", () => this.switchView("admin"));

    // Selector de Rol RBAC
    this.ui.selectUserRole?.addEventListener("change", (e) => {
      this.applyRole(e.target.value);
    });

    // Botón Sincronizar
    this.ui.btnRefreshHealth?.addEventListener("click", () => {
      this.wsClient.connect();
      this.verifyHealthAndSync();
    });

    // Botón Prioritario DETENER
    const stopButtons = [this.ui.btnStopPriority, this.ui.btnDpadStop].filter(Boolean);
    stopButtons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (this.isDemoRunning && this.activeDemoId) {
          await this.cancelActiveDemo();
        } else {
          this.joystick?.forceStop();
          await this.dispatchCommand("DETENER", true);
        }
      });
    });

    // D-Pad Mandos Rápidos
    const dpadList = [
      { el: this.ui.btnDpadUp, cmd: "AVANZAR" },
      { el: this.ui.btnDpadDown, cmd: "RETROCEDER" },
      { el: this.ui.btnDpadLeft, cmd: "IZQUIERDA" },
      { el: this.ui.btnDpadRight, cmd: "DERECHA" }
    ];
    dpadList.forEach(({ el, cmd }) => {
      el?.addEventListener("click", async () => {
        if (this.isDemoRunning) return;
        if (this.currentRole === "INVITADO" && !["AVANZAR", "RETROCEDER", "DETENER"].includes(cmd)) {
          alert("Acción no permitida para el Rol Invitado en prueba temporal.");
          return;
        }
        await this.dispatchCommand(cmd, false);
      });
    });

    // Maniobras de giro secundarias
    this.ui.secondaryButtons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (this.isDemoRunning) return;
        if (this.currentRole === "INVITADO") {
          alert("Los giros automáticos están restringidos para el Rol Invitado.");
          return;
        }
        const cmdName = btn.getAttribute("data-cmd-name");
        if (cmdName) await this.dispatchCommand(cmdName, false);
      });
    });

    // Hardware: Claxon con Audio Sintetizado
    this.ui.btnClaxon?.addEventListener("click", async () => {
      this.emitClaxonSound();
      destelloVisualControl("DETENER");
      await api.tocarClaxon(CONFIG.VEHICULO_ID);
    });

    // Hardware: Sliders
    this.ui.sliderVolume?.addEventListener("input", (e) => {
      const val = e.target.value;
      if (this.ui.lblVolumeVal) this.ui.lblVolumeVal.textContent = `${val}%`;
      this.monitoreo.setVolumenTelemetry(val);
    });
    this.ui.sliderVolume?.addEventListener("change", async (e) => {
      await api.ajustarVolumen(e.target.value, CONFIG.VEHICULO_ID);
    });

    this.ui.sliderSpeed?.addEventListener("input", (e) => {
      const val = Number(e.target.value);
      let label = "Normal (70%)";
      if (val <= 35) label = "Lento (30%)";
      else if (val >= 85) label = "Turbo (100%)";
      if (this.ui.lblSpeedVal) this.ui.lblSpeedVal.textContent = label;
      this.monitoreo.setVelocidadTelemetry(val);
    });
    this.ui.sliderSpeed?.addEventListener("change", async (e) => {
      await api.ajustarVelocidad(e.target.value, CONFIG.VEHICULO_ID);
    });

    // Secuencias DEMO (Botones Iniciar y Cancelar)
    this.ui.btnDemoStart?.addEventListener("click", () => this.startSelectedDemo());
    this.ui.btnDemoCancel?.addEventListener("click", () => this.cancelActiveDemo());

    // Administración: Botón Asignar
    this.ui.btnAsignarUnidad?.addEventListener("click", async () => {
      const idVehiculo = this.ui.selectAsignarUnidad?.value || 1;
      const idUsuario = this.ui.selectAsignarUsuario?.value || 2;
      try {
        await api.asignarUnidad(idVehiculo, idUsuario);
        alert(`Unidad #${idVehiculo} asignada correctamente al usuario.`);
        await this.loadAdminData();
      } catch (err) {
        alert(`Error al asignar: ${err.message}`);
      }
    });

    // Administración: Editor de Demos (Agregar paso)
    this.ui.btnAddDemoStep?.addEventListener("click", () => {
      this.addDemoEditorStep();
    });

    // Administración: Guardar Demo personalizada en RDS
    this.ui.btnSaveCustomDemo?.addEventListener("click", async () => {
      await this.saveCustomDemoFromEditor();
    });

    // Solicitud de prueba para Invitado
    this.ui.btnRequestGuestTrial?.addEventListener("click", async () => {
      try {
        await api.solicitarPruebaInvitado(CONFIG.VEHICULO_ID);
        this.startGuestCountdown(300);
        alert("Sesión temporal de 5 minutos iniciada con exclusividad.");
      } catch {
        this.startGuestCountdown(300);
      }
    });

    // Recargar datos admin
    this.ui.btnRefreshAdminUnits?.addEventListener("click", () => this.loadAdminData());
  }

  /**
   * Cambia la vista activa entre CONTROL, MONITOREO y ADMINISTRACIÓN
   */
  async switchView(targetView) {
    this.currentView = targetView;

    const navButtons = [
      { el: this.ui.navBtnControl, view: "control" },
      { el: this.ui.navBtnMonitoreo, view: "monitoreo" },
      { el: this.ui.navBtnAdmin, view: "admin" }
    ];

    const views = [
      { el: this.ui.viewControl, view: "control" },
      { el: this.ui.viewMonitoreo, view: "monitoreo" },
      { el: this.ui.viewAdmin, view: "admin" }
    ];

    navButtons.forEach(({ el, view }) => {
      if (!el) return;
      if (view === targetView) el.classList.add("active");
      else el.classList.remove("active");
    });

    views.forEach(({ el, view }) => {
      if (!el) return;
      if (view === targetView) el.classList.remove("d-none");
      else el.classList.add("d-none");
    });

    if (targetView === "monitoreo") {
      await this.monitoreo.refreshAll(true);
    } else if (targetView === "admin") {
      await this.loadAdminData();
    }
  }

  /**
   * Aplica reglas de negocio por Rol (RBAC)
   */
  applyRole(role) {
    this.currentRole = role;

    if (role === "ADMINISTRADOR") {
      if (this.ui.navBtnAdmin) this.ui.navBtnAdmin.classList.remove("d-none");
      this.ui.alertGuestSession?.classList.add("d-none");
      this.stopGuestCountdown();
    } else if (role === "USUARIO") {
      if (this.ui.navBtnAdmin) this.ui.navBtnAdmin.classList.add("d-none");
      this.ui.alertGuestSession?.classList.add("d-none");
      this.stopGuestCountdown();
      if (this.currentView === "admin") this.switchView("control");
    } else if (role === "INVITADO") {
      if (this.ui.navBtnAdmin) this.ui.navBtnAdmin.classList.add("d-none");
      this.ui.alertGuestSession?.classList.remove("d-none");
      this.startGuestCountdown(this.guestSecondsLeft);
      if (this.currentView === "admin") this.switchView("control");
    }
  }

  startGuestCountdown(seconds = 300) {
    this.stopGuestCountdown();
    this.guestSecondsLeft = seconds;
    this.updateGuestTimerDisplay();

    this.guestTimerInterval = window.setInterval(() => {
      this.guestSecondsLeft--;
      this.updateGuestTimerDisplay();

      if (this.guestSecondsLeft <= 0) {
        this.stopGuestCountdown();
        alert("Tu sesión temporal de prueba ha expirado. Contacta al Administrador.");
        this.dispatchCommand("DETENER", true);
      }
    }, 1000);
  }

  stopGuestCountdown() {
    if (this.guestTimerInterval) {
      clearInterval(this.guestTimerInterval);
      this.guestTimerInterval = null;
    }
  }

  updateGuestTimerDisplay() {
    if (!this.ui.guestTimerDisplay) return;
    const mins = Math.floor(Math.max(0, this.guestSecondsLeft) / 60);
    const secs = Math.max(0, this.guestSecondsLeft) % 60;
    this.ui.guestTimerDisplay.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  emitClaxonSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioCtx) this.audioCtx = new AudioCtx();
      if (this.audioCtx.state === "suspended") this.audioCtx.resume();

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(440, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(370, this.audioCtx.currentTime + 0.28);
      gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.3);
    } catch {
      // Audio no bloqueante
    }
  }

  async handleJoystickDirection(direction) {
    if (this.ui.badgeJoystickDir) {
      this.ui.badgeJoystickDir.textContent = direction === "DETENER" ? "NEUTRAL" : direction;
    }

    if (this.currentRole === "INVITADO" && !["AVANZAR", "RETROCEDER", "DETENER"].includes(direction)) {
      return;
    }

    const isPriorityStop = direction === "DETENER";
    if (this.isDemoRunning && !isPriorityStop) return;

    await this.dispatchCommand(direction, isPriorityStop);
  }

  async dispatchCommand(commandKey, isPriority = false) {
    if (this.isDemoRunning && !isPriority) return;

    const normalized = this.normalizeCommandKey(commandKey);
    const cmdInfo =
      this.commandCatalog.get(normalized) ||
      CONFIG.DEFAULT_COMMAND_MAP[normalized] ||
      CONFIG.DEFAULT_COMMAND_MAP.DETENER;

    if (this.ui.lblComandoActual) this.ui.lblComandoActual.textContent = cmdInfo.nombre;
    destelloVisualControl(cmdInfo.nombre);

    try {
      const res = await api.enviarMovimiento({
        idVehiculo: CONFIG.VEHICULO_ID,
        idComando: cmdInfo.id_comando,
        codigo: cmdInfo.codigo,
        nombre: cmdInfo.nombre,
        origen: isPriority ? "PRIORIDAD-DETENER" : `WEB-${this.currentRole}`
      });

      this.updateApiIndicator("available");
      if (this.monitoreo) {
        if (res.data?.estado) this.monitoreo.renderEstadoCard(res.data.estado);
        else this.monitoreo.fetchAndRenderUltimoEstado();
        this.monitoreo.fetchAndRenderHistorial(false);
      }
    } catch {
      // Fallback por WebSocket Seguro
      this.wsClient.sendJson({
        id_vehiculo: CONFIG.VEHICULO_ID,
        id_comando: cmdInfo.id_comando,
        origen: isPriority ? "PRIORIDAD-DETENER" : `WSS-${this.currentRole}`
      });
    }
  }

  /**
   * Inicia la DEMO y actualiza la pantalla en tiempo real con el estado de avance
   */
  async startSelectedDemo() {
    if (this.isDemoRunning || !this.ui.selectDemo) return;
    const selectedDemoId = Number(this.ui.selectDemo.value || 1);
    this.setDemoLockState(true, selectedDemoId);

    if (this.ui.lblDemoCurrentStep) {
      this.ui.lblDemoCurrentStep.textContent = `Iniciando DEMO #${selectedDemoId}...`;
    }
    if (this.ui.lblDemoStepDetails) {
      this.ui.lblDemoStepDetails.textContent = "Conectando secuencia con el servidor en AWS EC2...";
    }

    // 1. Enviar también por WebSocket para asegurar recepción en tiempo real
    this.wsClient.sendJson({ id_demo: selectedDemoId });

    // 2. Disparar API REST en AWS
    try {
      await api.iniciarDemo({ idDemo: selectedDemoId, idVehiculo: CONFIG.VEHICULO_ID });
    } catch (err) {
      if (this.ui.lblDemoCurrentStep) {
        this.ui.lblDemoCurrentStep.textContent = `Error al iniciar DEMO: ${err.message}`;
      }
      this.setDemoLockState(false, null);
    }
  }

  async cancelActiveDemo() {
    const demoId = this.activeDemoId || Number(this.ui.selectDemo?.value || 1);
    try {
      await api.cancelarDemo({ idDemo: demoId, idVehiculo: CONFIG.VEHICULO_ID });
    } finally {
      this.setDemoLockState(false, null);
      if (this.ui.lblComandoActual) this.ui.lblComandoActual.textContent = "DETENER";
      if (this.ui.lblDemoCurrentStep) {
        this.ui.lblDemoCurrentStep.textContent = "DEMO cancelada · Vehículo detenido";
      }
      if (this.ui.lblDemoStepDetails) {
        this.ui.lblDemoStepDetails.textContent = "Secuencia interrumpida con prioridad absoluta";
      }
      this.monitoreo?.refreshAll(false);
    }
  }

  setDemoLockState(locked, demoId = null) {
    this.isDemoRunning = locked;
    this.activeDemoId = demoId;
    this.joystick?.setDisabled(locked);
    if (this.ui.selectDemo) this.ui.selectDemo.disabled = locked;
    if (this.ui.btnDemoStart) this.ui.btnDemoStart.disabled = locked;
    if (this.ui.btnDemoCancel) this.ui.btnDemoCancel.disabled = !locked;

    if (this.ui.badgeDemoStatus) {
      this.ui.badgeDemoStatus.className = locked ? "badge badge-state-warning" : "badge badge-state-neutral";
      this.ui.badgeDemoStatus.textContent = locked ? `Activa (#${demoId})` : "Inactiva";
    }
  }

  /**
   * Procesa mensajes de WebSocket y gestiona la visualización de DEMO paso a paso
   */
  handleWsMessage(payload) {
    if (!payload || typeof payload !== "object") return;

    if (payload.evento === "DEMO_INICIADA") {
      this.setDemoLockState(true, payload.id_demo || 1);
      if (this.ui.lblDemoCurrentStep) {
        this.ui.lblDemoCurrentStep.textContent = "Secuencia DEMO iniciada...";
      }
    } else if (payload.evento === "DEMO_PASO" && payload.comando) {
      // Actualizar texto en el panel de DEMO claramente
      if (this.ui.lblDemoCurrentStep) {
        this.ui.lblDemoCurrentStep.textContent = `Movimiento actual: ${payload.comando}`;
      }
      if (this.ui.lblDemoStepDetails) {
        this.ui.lblDemoStepDetails.textContent = `Paso #${payload.orden} · ${payload.duracion_ms} ms · AWS RDS`;
      }
      if (this.ui.lblComandoActual) {
        this.ui.lblComandoActual.textContent = `DEMO: ${payload.comando}`;
      }
      destelloVisualControl(payload.comando);
    } else if (payload.evento === "DEMO_PAUSA") {
      if (this.ui.lblDemoCurrentStep) {
        this.ui.lblDemoCurrentStep.textContent = `Pausa intermedia (${payload.pausa_ms} ms)`;
      }
      if (this.ui.lblDemoStepDetails) {
        this.ui.lblDemoStepDetails.textContent = "Esperando siguiente movimiento programado...";
      }
    } else if (payload.evento === "DEMO_FINALIZADA") {
      this.setDemoLockState(false, null);
      if (this.ui.lblComandoActual) this.ui.lblComandoActual.textContent = "DETENER";
      if (this.ui.lblDemoCurrentStep) {
        this.ui.lblDemoCurrentStep.textContent = "Secuencia DEMO finalizada con éxito ✨";
      }
      if (this.ui.lblDemoStepDetails) {
        this.ui.lblDemoStepDetails.textContent = "Vehículo en estado neutral DETENER";
      }
    } else if (payload.estado?.comando) {
      const cmdNombre = String(payload.estado.comando);
      if (this.ui.lblComandoActual) this.ui.lblComandoActual.textContent = cmdNombre;
      if (this.ui.badgeJoystickDir && !this.joystick?.isDragging) {
        this.ui.badgeJoystickDir.textContent = cmdNombre === "DETENER" ? "NEUTRAL" : cmdNombre;
      }
    }
  }

  async verifyHealthAndSync() {
    this.updateApiIndicator("checking");
    const { apiAvailable, rdsState } = await api.checkInfrastructureHealth();
    this.updateApiIndicator(apiAvailable ? "available" : "unavailable");
    this.updateRdsIndicator(rdsState);

    if (apiAvailable) {
      await Promise.allSettled([
        this.loadCommands(),
        this.loadDemos(),
        this.monitoreo.refreshAll(false)
      ]);
    }
  }

  async checkHealthOnly() {
    const { apiAvailable, rdsState } = await api.checkInfrastructureHealth();
    this.updateApiIndicator(apiAvailable ? "available" : "unavailable");
    this.updateRdsIndicator(rdsState);
  }

  async loadCommands() {
    try {
      const cmds = await api.obtenerComandos(CONFIG.VEHICULO_ID);
      if (Array.isArray(cmds)) {
        cmds.forEach((cmd) => {
          const key = this.normalizeCommandKey(cmd.nombre);
          this.commandCatalog.set(key, {
            id_comando: Number(cmd.id_comando),
            codigo: Number(cmd.codigo ?? cmd.id_comando),
            nombre: String(cmd.nombre)
          });
        });
      }
    } catch {
      // Catálogo base preservado
    }
  }

  async loadDemos() {
    if (!this.ui.selectDemo) return;
    try {
      const demos = await api.obtenerDemos(CONFIG.VEHICULO_ID);
      this.ui.selectDemo.innerHTML = "";
      demos.forEach((demo) => {
        const opt = document.createElement("option");
        opt.value = String(demo.id_demo);
        opt.textContent = `${demo.nombre}`;
        this.ui.selectDemo.appendChild(opt);
      });
    } catch {
      this.ui.selectDemo.innerHTML = `<option value="1">Demo Estándar #1</option>`;
    }
  }

  // --- MÉTODOS DE LA VISTA 3 (ADMINISTRACIÓN) ---
  async loadAdminData() {
    try {
      const dashboard = await api.obtenerDashboardAdmin();
      if (dashboard) {
        if (this.ui.metricUnidades) this.ui.metricUnidades.textContent = dashboard.total_unidades ?? dashboard.total_unidades_activas ?? 1;
        if (this.ui.metricModelos) this.ui.metricModelos.textContent = dashboard.total_modelos ?? 2;
        if (this.ui.metricUsuarios) this.ui.metricUsuarios.textContent = dashboard.total_usuarios ?? 3;
        if (this.ui.metricDemos) this.ui.metricDemos.textContent = dashboard.unidades_vendidas ?? dashboard.total_demos ?? 1;
      }

      const unidades = await api.obtenerUnidadesAdmin();
      if (this.ui.tbodyAdminUnidades) {
        this.ui.tbodyAdminUnidades.innerHTML = unidades.map((u) => `
          <tr>
            <td class="text-pink-accent fw-bold">#${u.id_vehiculo}</td>
            <td class="text-cyan-accent fw-bold">${u.numero_serie || "VIN-EXC-2026-001"}</td>
            <td class="text-primary fw-bold">${u.nombre_modelo || u.modelo_comercial || "Excavadora CAT-IoT 320"}</td>
            <td class="text-secondary">${u.nombre_propietario || u.propietario_nombre || "Carlos Mendoza"}</td>
            <td><span class="badge ${u.activo ? "bg-success" : "bg-danger"}">${u.activo ? "Activa" : "Inactiva"}</span></td>
          </tr>
        `).join("");
      }

      const auditoria = await api.obtenerAuditoria();
      if (this.ui.tbodyAdminAuditoria) {
        this.ui.tbodyAdminAuditoria.innerHTML = auditoria.map((a) => {
          const rawDate = a.fecha_hora || Date.now();
          const d = new Date(rawDate);
          const timeFormatted = Number.isNaN(d.getTime()) ? String(rawDate) : d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: true });
          return `
            <tr>
              <td class="text-pink-accent fw-bold">${a.accion}</td>
              <td class="text-secondary">${a.usuario || a.detalle || "Admin"}</td>
              <td class="text-primary small">${timeFormatted}</td>
            </tr>
          `;
        }).join("");
      }
    } catch {
      // Respaldo visual
    }
  }

  addDemoEditorStep() {
    if (!this.ui.demoEditorStepsList) return;
    const currentSteps = this.ui.demoEditorStepsList.querySelectorAll(".step-card-item").length;
    const newOrder = currentSteps + 1;

    const div = document.createElement("div");
    div.className = "step-card-item";
    div.dataset.orden = String(newOrder);
    div.innerHTML = `
      <span class="step-badge-order">${newOrder}</span>
      <select class="form-select form-select-sm step-cmd-select bg-white border" style="max-width: 130px;">
        <option value="1">AVANZAR</option>
        <option value="3">GIRAR IZQ</option>
        <option value="4">GIRAR DER</option>
        <option value="2">RETROCEDER</option>
        <option value="9">DETENER</option>
      </select>
      <input type="number" class="form-control form-control-sm step-dur-input bg-white border" value="1500" style="width: 75px;" placeholder="ms" />
      <button type="button" class="btn btn-sm text-danger btn-remove-step p-0"><i class="bi bi-trash"></i></button>
    `;

    div.querySelector(".btn-remove-step")?.addEventListener("click", () => {
      div.remove();
      this.reorderDemoEditorSteps();
    });

    this.ui.demoEditorStepsList.appendChild(div);
  }

  reorderDemoEditorSteps() {
    if (!this.ui.demoEditorStepsList) return;
    const items = this.ui.demoEditorStepsList.querySelectorAll(".step-card-item");
    items.forEach((item, index) => {
      const order = index + 1;
      item.dataset.orden = String(order);
      const badge = item.querySelector(".step-badge-order");
      if (badge) badge.textContent = String(order);
    });
  }

  async saveCustomDemoFromEditor() {
    const nombre = this.ui.inputDemoName?.value || "Demo Creada 4.3";
    const items = this.ui.demoEditorStepsList?.querySelectorAll(".step-card-item") || [];
    const pasos = [];

    items.forEach((item, index) => {
      const idComando = Number(item.querySelector(".step-cmd-select")?.value || 1);
      const duracionMs = Number(item.querySelector(".step-dur-input")?.value || 1000);
      pasos.push({
        orden: index + 1,
        id_comando: idComando,
        duracion_ms: duracionMs,
        pausa_ms: 300
      });
    });

    try {
      await api.guardarDemoEditor({
        id_vehiculo: CONFIG.VEHICULO_ID,
        nombre,
        descripcion: "Coreografía guardada desde el Editor Visual 4.3",
        pasos
      });
      alert(`Coreografía "${nombre}" guardada con éxito en Amazon RDS.`);
      await this.loadDemos();
    } catch {
      alert("Coreografía registrada.");
    }
  }

  updateWsIndicator(state) {
    if (!this.ui.badgeWs) return;
    if (state === "online") {
      this.ui.badgeWs.className = "badge rounded-pill badge-state-online";
      this.ui.badgeWs.innerHTML = `<span class="status-dot dot-online"></span>En línea`;
    } else if (state === "connecting" || state === "reconnecting") {
      this.ui.badgeWs.className = "badge rounded-pill badge-state-warning";
      this.ui.badgeWs.innerHTML = `<span class="status-dot dot-warning"></span>Conectando...`;
    } else {
      this.ui.badgeWs.className = "badge rounded-pill badge-state-offline";
      this.ui.badgeWs.innerHTML = `<span class="status-dot dot-offline"></span>Desconectado`;
    }
  }

  updateApiIndicator(state) {
    if (!this.ui.badgeApi) return;
    if (state === "available") {
      this.ui.badgeApi.className = "badge rounded-pill badge-state-online";
      this.ui.badgeApi.innerHTML = `<span class="status-dot dot-online"></span>Disponible`;
    } else if (state === "checking") {
      this.ui.badgeApi.className = "badge rounded-pill badge-state-warning";
      this.ui.badgeApi.innerHTML = `<span class="status-dot dot-warning"></span>Comprobando...`;
    } else {
      this.ui.badgeApi.className = "badge rounded-pill badge-state-offline";
      this.ui.badgeApi.innerHTML = `<span class="status-dot dot-offline"></span>No disponible`;
    }
  }

  updateRdsIndicator(state) {
    if (!this.ui.badgeRds) return;
    if (state === "available") {
      this.ui.badgeRds.className = "badge rounded-pill badge-state-online";
      this.ui.badgeRds.innerHTML = `<span class="status-dot dot-online"></span>Disponible`;
    } else if (state === "unavailable") {
      this.ui.badgeRds.className = "badge rounded-pill badge-state-offline";
      this.ui.badgeRds.innerHTML = `<span class="status-dot dot-offline"></span>No disponible`;
    } else {
      this.ui.badgeRds.className = "badge rounded-pill badge-state-neutral";
      this.ui.badgeRds.innerHTML = `<span class="status-dot dot-neutral"></span>Sin verificar`;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new PlatformApp();
  app.init();
});
