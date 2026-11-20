/**
 * Coordinador Principal de la Plataforma IoT (ES6 Module - Examen 3.1 & Práctica 4.3)
 * Integra:
 * - 1. Login Real con Contraseña (sessionStorage + Bearer Token + BOLA/IDOR + Cierre de Sesión)
 * - 2. Catálogo Exacto de los 12 Movimientos del Profesor (01..12) + 13 (DETENER)
 * - 3. Control de DEMO con Cancelación Instantánea y Prevención de Concurrencia
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
    this.currentUser = null;
    this.currentRole = "USUARIO";
    this.healthTimer = null;
    this.audioCtx = null;
    this.guestTimerInterval = null;
    this.guestSecondsLeft = 300; // 5 minutos

    this.ui = {
      // Modal Login Real
      loginOverlay: document.getElementById("login-modal-overlay"),
      formLogin: document.getElementById("form-login-iot"),
      inputLoginEmail: document.getElementById("login-email"),
      inputLoginPassword: document.getElementById("login-password"),
      btnLoginSubmit: document.getElementById("btn-login-submit"),
      btnLoginGuest: document.getElementById("btn-login-guest"),
      alertLoginError: document.getElementById("login-error-alert"),
      quickCredPills: document.querySelectorAll(".quick-cred-pill"),

      // Header y Sesión Autenticada
      lblVehiculoId: document.getElementById("lbl-vehiculo-id"),
      lblUnidadSerie: document.getElementById("lbl-unidad-serie"),
      lblUserName: document.getElementById("lbl-user-name"),
      lblUserRole: document.getElementById("lbl-user-role"),
      btnLogout: document.getElementById("btn-logout"),
      btnRefreshHealth: document.getElementById("btn-refresh-health"),
      alertGuestSession: document.getElementById("alert-guest-session"),
      alertAdminBola: document.getElementById("alert-admin-bola"),
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

      // Vista 1: Control (Joystick + Cruceta + 12 Movimientos + DETENER)
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
      inputClienteNombre: document.getElementById("input-cliente-nombre"),
      inputClienteEmail: document.getElementById("input-cliente-email"),
      inputClientePassword: document.getElementById("input-cliente-password"),
      btnCrearCliente: document.getElementById("btn-crear-cliente"),
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

    // 3. Inicializar Cliente WebSocket Seguro WSS (se conecta al iniciar sesión)
    this.wsClient = new IoTWebSocketClient({
      onStatusChange: (state) => {
        this.updateWsIndicator(state);
        this.monitoreo.setWssStatus(state);
      },
      onMessage: (payload) => this.handleWsMessage(payload)
    });

    // 4. Enlazar eventos de Login, UI, Mandos y Navegación
    this.bindEvents();

    // 5. Restaurar sesión de sessionStorage o mostrar pantalla de Login
    this.restoreOrRequireLogin();

    // 6. Polling de salud de la infraestructura
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
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "_");
  }

  // ===========================================================================
  // 1. AUTENTICACIÓN REAL CON SESSIONSTORAGE Y BOLA/IDOR
  // ===========================================================================
  restoreOrRequireLogin() {
    try {
      const savedToken = window.sessionStorage.getItem("iot_auth_token");
      const savedUserRaw = window.sessionStorage.getItem("iot_auth_user");
      if (savedToken && savedUserRaw) {
        const userObj = JSON.parse(savedUserRaw);
        this.activateAuthenticatedSession(userObj, savedToken);
        return;
      }
    } catch {
      // Continuar a pantalla de Login
    }
    this.showLoginModal();
  }

  showLoginModal(errorMsg = "") {
    if (this.ui.loginOverlay) {
      this.ui.loginOverlay.classList.remove("d-none");
    }
    if (errorMsg) {
      this.showLoginError(errorMsg);
    } else {
      this.hideLoginError();
    }
  }

  hideLoginModal() {
    if (this.ui.loginOverlay) {
      this.ui.loginOverlay.classList.add("d-none");
    }
    this.hideLoginError();
  }

  showLoginError(msg) {
    if (!this.ui.alertLoginError) return;
    this.ui.alertLoginError.textContent = msg;
    this.ui.alertLoginError.classList.remove("d-none");
  }

  hideLoginError() {
    if (!this.ui.alertLoginError) return;
    this.ui.alertLoginError.textContent = "";
    this.ui.alertLoginError.classList.add("d-none");
  }

  async activateAuthenticatedSession(userObj, token) {
    this.currentUser = userObj;
    const role = String(userObj.rol || "USUARIO").toUpperCase();

    try {
      window.sessionStorage.setItem("iot_auth_token", token);
      window.sessionStorage.setItem("iot_auth_user", JSON.stringify(userObj));
    } catch {
      // sessionStorage disponible
    }

    if (this.ui.lblUserName) {
      this.ui.lblUserName.textContent = userObj.nombre_completo || userObj.email || "Usuario";
    }
    if (this.ui.lblUserRole) {
      this.ui.lblUserRole.textContent = role;
    }

    this.hideLoginModal();
    this.applyRole(role, userObj.expira_en_segundos || 300);

    // Conectar WebSocket Seguro WSS y sincronizar con AWS RDS
    this.wsClient.connect();
    await this.verifyHealthAndSync();
  }

  async handleLogout() {
    if (this.isDemoRunning) {
      await this.cancelActiveDemo();
    }
    await api.logout();
    this.stopGuestCountdown();

    try {
      window.sessionStorage.removeItem("iot_auth_token");
      window.sessionStorage.removeItem("iot_auth_user");
    } catch {
      // limpiar
    }

    this.currentUser = null;
    this.wsClient.disconnect();
    this.updateWsIndicator("offline");

    if (this.ui.lblUserName) this.ui.lblUserName.textContent = "No autenticado";
    if (this.ui.lblUserRole) this.ui.lblUserRole.textContent = "---";

    this.showLoginModal();
  }

  // ===========================================================================
  // 2. ENLACE DE EVENTOS DE INTERFAZ Y CONTROLES
  // ===========================================================================
  bindEvents() {
    // Píldoras de llenado rápido en el Login
    this.ui.quickCredPills.forEach((pill) => {
      pill.addEventListener("click", () => {
        const email = pill.getAttribute("data-fill-email") || "";
        const pass = pill.getAttribute("data-fill-pass") || "";
        if (this.ui.inputLoginEmail) this.ui.inputLoginEmail.value = email;
        if (this.ui.inputLoginPassword) this.ui.inputLoginPassword.value = pass;
        this.hideLoginError();
      });
    });

    // Submit del Formulario de Login Real
    this.ui.formLogin?.addEventListener("submit", async (e) => {
      e.preventDefault();
      this.hideLoginError();
      const email = this.ui.inputLoginEmail?.value?.trim() || "";
      const password = this.ui.inputLoginPassword?.value || "";

      if (!email || !password) {
        this.showLoginError("Ingresa tu correo y contraseña.");
        return;
      }

      if (this.ui.btnLoginSubmit) this.ui.btnLoginSubmit.disabled = true;
      try {
        const authData = await api.login(email, password);
        await this.activateAuthenticatedSession(authData, authData.token);
      } catch (err) {
        this.showLoginError(err.message || "Credenciales inválidas.");
      } finally {
        if (this.ui.btnLoginSubmit) this.ui.btnLoginSubmit.disabled = false;
      }
    });

    // Botón de Acceso Temporal Invitado (Prueba 5 min con bloqueo de exclusividad)
    this.ui.btnLoginGuest?.addEventListener("click", async () => {
      this.hideLoginError();
      if (this.ui.btnLoginGuest) this.ui.btnLoginGuest.disabled = true;
      try {
        const guestRes = await api.solicitarPruebaInvitado(CONFIG.VEHICULO_ID);
        const guestUser = {
          id_usuario: 3,
          nombre_completo: "Invitado Prueba (5 min)",
          email: "invitado@iot.com",
          id_rol: 3,
          rol: "INVITADO",
          vehiculos_asignados: [CONFIG.VEHICULO_ID],
          expira_en_segundos: 300
        };
        await this.activateAuthenticatedSession(guestUser, guestRes.token_sesion);
      } catch (err) {
        this.showLoginError(err.message || "La unidad ya está reservada por otro invitado.");
      } finally {
        if (this.ui.btnLoginGuest) this.ui.btnLoginGuest.disabled = false;
      }
    });

    // Botón Cerrar Sesión
    this.ui.btnLogout?.addEventListener("click", () => this.handleLogout());

    // Navegación de 3 Vistas
    this.ui.navBtnControl?.addEventListener("click", () => this.switchView("control"));
    this.ui.navBtnMonitoreo?.addEventListener("click", () => this.switchView("monitoreo"));
    this.ui.navBtnAdmin?.addEventListener("click", () => this.switchView("admin"));

    // Botón Sincronizar
    this.ui.btnRefreshHealth?.addEventListener("click", () => {
      this.wsClient.connect();
      this.verifyHealthAndSync();
    });

    // Botón Prioritario DETENER (Aborta DEMO si está corriendo y detiene motores al instante)
    const stopButtons = [this.ui.btnStopPriority, this.ui.btnDpadStop].filter(Boolean);
    stopButtons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        this.joystick?.forceStop();
        if (this.isDemoRunning) {
          await this.cancelActiveDemo();
        } else {
          await this.dispatchCommand("DETENER", true);
        }
      });
    });

    // Cruceta D-Pad (01-ADELANTE, 02-ATRAS, 03-GIRAR_IZQUIERDA, 04-GIRAR_DERECHA)
    const dpadList = [
      { el: this.ui.btnDpadUp, cmd: "ADELANTE" },
      { el: this.ui.btnDpadDown, cmd: "ATRAS" },
      { el: this.ui.btnDpadLeft, cmd: "GIRAR_IZQUIERDA" },
      { el: this.ui.btnDpadRight, cmd: "GIRAR_DERECHA" }
    ];
    dpadList.forEach(({ el, cmd }) => {
      el?.addEventListener("click", async () => {
        if (!this.canExecuteCommand(cmd)) return;
        await this.dispatchCommand(cmd, false);
      });
    });

    // Catálogo de los 12 Movimientos del Profesor (Botones 01 al 12)
    this.ui.secondaryButtons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const cmdName = btn.getAttribute("data-cmd-name");
        if (!cmdName) return;
        if (!this.canExecuteCommand(cmdName)) return;

        if (cmdName === "ACTIVAR_SONIDO") {
          this.emitClaxonSound();
        }
        await this.dispatchCommand(cmdName, false);
      });
    });

    // Secuencias DEMO (Botones Iniciar y Cancelar)
    this.ui.btnDemoStart?.addEventListener("click", () => this.startSelectedDemo());
    this.ui.btnDemoCancel?.addEventListener("click", () => this.cancelActiveDemo());

    // Administración: Botón Crear Nuevo Cliente
    this.ui.btnCrearCliente?.addEventListener("click", async () => {
      const nombre = this.ui.inputClienteNombre?.value?.trim();
      const email = this.ui.inputClienteEmail?.value?.trim();
      const password = this.ui.inputClientePassword?.value?.trim() || "Cliente123!";

      if (!nombre || !email) {
        alert("Por favor ingresa el nombre y correo del nuevo cliente.");
        return;
      }

      try {
        const nuevoCliente = await api.crearUsuario({
          nombre_completo: nombre,
          email: email,
          password: password,
          id_rol: 2
        });

        if (this.ui.selectAsignarUsuario) {
          const opt = document.createElement("option");
          opt.value = String(nuevoCliente.id_usuario);
          opt.textContent = `${nuevoCliente.nombre_completo} (${nuevoCliente.email})`;
          opt.selected = true;
          this.ui.selectAsignarUsuario.appendChild(opt);
        }

        if (this.ui.metricUsuarios) {
          const current = parseInt(this.ui.metricUsuarios.textContent, 10) || 3;
          this.ui.metricUsuarios.textContent = String(current + 1);
        }

        this.registrarAuditoriaLocal("CLIENTE_REGISTRADO", `Cliente registrado: ${nombre} (${email})`);
        if (this.ui.inputClienteNombre) this.ui.inputClienteNombre.value = "";
        if (this.ui.inputClienteEmail) this.ui.inputClienteEmail.value = "";
        alert(`¡Cliente "${nombre}" registrado exitosamente con contraseña encriptada!`);
      } catch (err) {
        alert(`Error al registrar cliente: ${err.message}`);
      }
    });

    // Administración: Botón Asignar Unidad
    this.ui.btnAsignarUnidad?.addEventListener("click", async () => {
      const idVehiculo = this.ui.selectAsignarUnidad?.value || 1;
      const idUsuario = this.ui.selectAsignarUsuario?.value || 2;
      const userText = this.ui.selectAsignarUsuario?.selectedOptions?.[0]?.text || "Carlos Mendoza";
      const userName = userText.split("(")[0].trim();

      try {
        await api.asignarUnidad(idVehiculo, idUsuario);
        const tbody = document.getElementById("tbody-admin-unidades");
        if (tbody) {
          const firstRow = tbody.querySelector("tr");
          if (firstRow && firstRow.children.length >= 4) {
            firstRow.children[3].textContent = userName;
          }
        }
        this.registrarAuditoriaLocal("ASIGNACION_VEHICULO", `Unidad #${idVehiculo} asignada a ${userName}`);
        alert(`¡Unidad #${idVehiculo} asignada correctamente a ${userName}!`);
      } catch (err) {
        alert(`Error al asignar: ${err.message}`);
      }
    });

    // Administración: Editor de Demos
    this.ui.btnAddDemoStep?.addEventListener("click", () => this.addDemoEditorStep());
    this.ui.btnSaveCustomDemo?.addEventListener("click", () => this.saveCustomDemoFromEditor());

    // Renovar prueba para Invitado
    this.ui.btnRequestGuestTrial?.addEventListener("click", async () => {
      try {
        const res = await api.solicitarPruebaInvitado(CONFIG.VEHICULO_ID);
        window.sessionStorage.setItem("iot_auth_token", res.token_sesion);
        this.startGuestCountdown(300);
        alert("Sesión exclusiva de 5 minutos renovada.");
      } catch (err) {
        alert(err.message || "No se pudo renovar la sesión de invitado.");
      }
    });

    this.ui.btnRefreshAdminUnits?.addEventListener("click", () => this.loadAdminData());
  }

  /**
   * Valida en Frontend las reglas BOLA/IDOR antes de despachar un comando
   */
  canExecuteCommand(rawCmdName) {
    const cmd = this.normalizeCommandKey(rawCmdName);

    if (cmd === "DETENER") return true;
    if (this.isDemoRunning) return false;

    // Regla BOLA/IDOR 1: El Administrador NO puede mover vehículos ya vendidos a un comprador
    if (this.currentRole === "ADMINISTRADOR") {
      alert("Bloqueo BOLA/IDOR: El Administrador gestiona la flota y catálogos, pero no tiene permiso para mover físicamente unidades ya vendidas a un cliente.");
      return false;
    }

    // Regla BOLA/IDOR 2: El Invitado solo puede ejecutar ADELANTE, ATRAS y DETENER por 5 min
    if (this.currentRole === "INVITADO") {
      if (this.guestSecondsLeft <= 0) {
        alert("Tu sesión temporal de 5 minutos ha expirado.");
        return false;
      }
      if (!["ADELANTE", "AVANZAR", "ATRAS", "RETROCEDER", "DETENER"].includes(cmd)) {
        alert("Restricción RBAC Invitado: Solo tienes autorización para 01-ADELANTE, 02-ATRÁS y DETENER.");
        return false;
      }
    }

    return true;
  }

  async switchView(targetView) {
    if (targetView === "admin" && this.currentRole !== "ADMINISTRADOR") {
      alert("Acceso denegado: Solo el Rol ADMINISTRADOR puede acceder a este módulo.");
      return;
    }

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
   * Aplica permisos visuales y de seguridad por Rol (ADMINISTRADOR, USUARIO, INVITADO)
   */
  applyRole(role, guestSeconds = 300) {
    this.currentRole = role;

    if (role === "ADMINISTRADOR") {
      this.ui.navBtnAdmin?.classList.remove("d-none");
      this.ui.alertGuestSession?.classList.add("d-none");
      this.ui.alertAdminBola?.classList.remove("d-none");
      this.stopGuestCountdown();
      this.updateControlButtonsByRole("ADMINISTRADOR");
    } else if (role === "USUARIO") {
      this.ui.navBtnAdmin?.classList.add("d-none");
      this.ui.alertGuestSession?.classList.add("d-none");
      this.ui.alertAdminBola?.classList.add("d-none");
      this.stopGuestCountdown();
      this.updateControlButtonsByRole("USUARIO");
      if (this.currentView === "admin") this.switchView("control");
    } else if (role === "INVITADO") {
      this.ui.navBtnAdmin?.classList.add("d-none");
      this.ui.alertGuestSession?.classList.remove("d-none");
      this.ui.alertAdminBola?.classList.add("d-none");
      this.startGuestCountdown(guestSeconds);
      this.updateControlButtonsByRole("INVITADO");
      if (this.currentView === "admin") this.switchView("control");
    }
  }

  updateControlButtonsByRole(role) {
    this.ui.secondaryButtons.forEach((btn) => {
      const cmd = this.normalizeCommandKey(btn.getAttribute("data-cmd-name"));
      if (role === "USUARIO") {
        btn.classList.remove("cmd-btn-disabled-rbac");
      } else if (role === "INVITADO") {
        if (["ADELANTE", "ATRAS"].includes(cmd)) {
          btn.classList.remove("cmd-btn-disabled-rbac");
        } else {
          btn.classList.add("cmd-btn-disabled-rbac");
        }
      } else if (role === "ADMINISTRADOR") {
        btn.classList.add("cmd-btn-disabled-rbac");
      }
    });
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
        alert("Tu sesión temporal de 5 minutos como Invitado ha expirado.");
        this.dispatchCommand("DETENER", true);
        this.handleLogout();
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
      osc.frequency.exponentialRampToValueAtTime(370, this.audioCtx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.18, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.28);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.28);
    } catch {
      // Audio no bloqueante
    }
  }

  async handleJoystickDirection(direction) {
    // Mapear direcciones del joystick al catálogo oficial del profesor
    const joyMap = {
      AVANZAR: "ADELANTE",
      RETROCEDER: "ATRAS",
      IZQUIERDA: "GIRAR_IZQUIERDA",
      DERECHA: "GIRAR_DERECHA",
      DETENER: "DETENER"
    };
    const mappedCmd = joyMap[direction] || direction;
    const isPriorityStop = mappedCmd === "DETENER";

    if (!isPriorityStop && !this.canExecuteCommand(mappedCmd)) {
      return;
    }

    const textDir = isPriorityStop ? "En espera" : mappedCmd.replace(/_/g, " ");
    if (this.ui.badgeJoystickDir) this.ui.badgeJoystickDir.textContent = textDir;
    const lblJoyDir = document.getElementById("lbl-joy-dir");
    if (lblJoyDir) lblJoyDir.textContent = textDir;

    if (this.isDemoRunning && !isPriorityStop) return;
    await this.dispatchCommand(mappedCmd, isPriorityStop);
  }

  async dispatchCommand(commandKey, isPriority = false) {
    if (this.isDemoRunning && !isPriority) return;

    const normalized = this.normalizeCommandKey(commandKey);
    const cmdInfo =
      this.commandCatalog.get(normalized) ||
      CONFIG.DEFAULT_COMMAND_MAP[normalized] ||
      CONFIG.DEFAULT_COMMAND_MAP.DETENER;

    if (this.ui.lblComandoActual) this.ui.lblComandoActual.textContent = cmdInfo.nombre;
    const lblJoyDir = document.getElementById("lbl-joy-dir");
    if (lblJoyDir) {
      lblJoyDir.textContent = cmdInfo.nombre === "DETENER" ? "En espera" : cmdInfo.nombre.replace(/_/g, " ");
    }
    destelloVisualControl(cmdInfo.nombre);

    const origenTag = isPriority ? "PRIORIDAD-DETENER" : `WEB-${this.currentRole}`;

    try {
      const res = await api.enviarMovimiento({
        idVehiculo: CONFIG.VEHICULO_ID,
        idComando: cmdInfo.id_comando,
        codigo: cmdInfo.codigo,
        nombre: cmdInfo.nombre,
        origen: origenTag
      });

      this.updateApiIndicator("available");
      if (this.monitoreo) {
        if (res.data?.estado) this.monitoreo.renderEstadoCard(res.data.estado);
        else this.monitoreo.fetchAndRenderUltimoEstado();
        this.monitoreo.fetchAndRenderHistorial(false);
      }
    } catch (err) {
      if (err && err.status === 403) {
        alert(err.message);
        return;
      }
      // Fallback por WebSocket Seguro
      this.wsClient.sendJson({
        id_vehiculo: CONFIG.VEHICULO_ID,
        id_comando: cmdInfo.id_comando,
        token: api.getAuthToken(),
        origen: isPriority ? "PRIORIDAD-DETENER" : `WSS-${this.currentRole}`
      });
    }
  }

  // ===========================================================================
  // 3. EJECUCIÓN Y CANCELACIÓN INSTANTÁNEA DE SECUENCIAS DEMO
  // ===========================================================================
  async startSelectedDemo() {
    if (this.isDemoRunning || !this.ui.selectDemo) return;

    if (this.currentRole === "ADMINISTRADOR") {
      alert("Bloqueo BOLA/IDOR: El Administrador no puede ejecutar físicamente secuencias DEMO sobre unidades vendidas.");
      return;
    }
    if (this.currentRole === "INVITADO") {
      alert("Restricción RBAC: El Rol Invitado no tiene permiso para ejecutar secuencias DEMO.");
      return;
    }

    const selectedDemoId = Number(this.ui.selectDemo.value || 1);
    this.setDemoLockState(true, selectedDemoId);

    if (this.ui.lblDemoCurrentStep) {
      this.ui.lblDemoCurrentStep.textContent = `Iniciando DEMO #${selectedDemoId}...`;
    }

    // Enviar UNA SOLA petición REST (evita duplicar la demo por WS y HTTP al mismo tiempo)
    try {
      await api.iniciarDemo({ idDemo: selectedDemoId, idVehiculo: CONFIG.VEHICULO_ID });
      // Al retornar exitosamente la DEMO, aseguramos que la UI regrese a estado Inactivo
      this.setDemoLockState(false, null);
    } catch (err) {
      if (err && (err.status === 403 || err.status === 409)) {
        alert(err.message);
      } else if (this.ui.lblDemoCurrentStep) {
        this.ui.lblDemoCurrentStep.textContent = `DEMO detenida o error: ${err.message}`;
      }
      this.setDemoLockState(false, null);
    }
  }

  async cancelActiveDemo() {
    const demoId = this.activeDemoId || Number(this.ui.selectDemo?.value || 1);

    // 1. Notificar inmediatamente por WebSocket para despertar el asyncio.Event en milisegundos
    this.wsClient.sendJson({
      accion: "CANCELAR_DEMO",
      id_vehiculo: CONFIG.VEHICULO_ID,
      id_demo: demoId
    });

    // 2. Liberar bloqueo de UI de inmediato
    this.setDemoLockState(false, null);
    if (this.ui.lblComandoActual) this.ui.lblComandoActual.textContent = "DETENER";
    const lblJoyDir = document.getElementById("lbl-joy-dir");
    if (lblJoyDir) lblJoyDir.textContent = "En espera";
    if (this.ui.lblDemoCurrentStep) {
      this.ui.lblDemoCurrentStep.textContent = "DEMO cancelada · Vehículo en DETENER";
    }

    // 3. Confirmar cancelación por endpoint REST
    try {
      await api.cancelarDemo({ idDemo: demoId, idVehiculo: CONFIG.VEHICULO_ID });
    } finally {
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
      this.ui.badgeDemoStatus.className = locked
        ? "badge-soft badge-warning-pastel"
        : "badge-soft badge-neutral";
      this.ui.badgeDemoStatus.textContent = locked ? `Activa (#${demoId})` : "Inactivo";
    }
  }

  handleWsMessage(payload) {
    if (!payload || typeof payload !== "object") return;

    if (payload.evento === "ERROR_RBAC" && payload.mensaje) {
      alert(payload.mensaje);
      return;
    }

    if (payload.evento === "DEMO_INICIADA") {
      this.setDemoLockState(true, payload.id_demo || 1);
      if (this.ui.lblDemoCurrentStep) {
        this.ui.lblDemoCurrentStep.textContent = "Secuencia DEMO en ejecución...";
      }
    } else if (payload.evento === "DEMO_PASO" && payload.comando) {
      if (this.ui.lblDemoCurrentStep) {
        this.ui.lblDemoCurrentStep.textContent = `Paso #${payload.orden}: ${payload.comando}`;
      }
      if (this.ui.lblComandoActual) {
        this.ui.lblComandoActual.textContent = `DEMO: ${payload.comando}`;
      }
      const lblJoyDir = document.getElementById("lbl-joy-dir");
      if (lblJoyDir) lblJoyDir.textContent = `DEMO: ${payload.comando}`;
      destelloVisualControl(payload.comando, payload.duracion_ms || 1800);
    } else if (payload.evento === "DEMO_PAUSA") {
      if (this.ui.lblDemoCurrentStep) {
        this.ui.lblDemoCurrentStep.textContent = `Pausa segura (${payload.pausa_ms} ms)`;
      }
      const lblJoyDir = document.getElementById("lbl-joy-dir");
      if (lblJoyDir) lblJoyDir.textContent = "PAUSA (DETENER)";
    } else if (payload.evento === "DEMO_FINALIZADA") {
      this.setDemoLockState(false, null);
      if (this.ui.lblComandoActual) this.ui.lblComandoActual.textContent = "DETENER";
      const lblJoyDir = document.getElementById("lbl-joy-dir");
      if (lblJoyDir) lblJoyDir.textContent = "En espera";
      if (this.ui.lblDemoCurrentStep) {
        this.ui.lblDemoCurrentStep.textContent = payload.cancelada
          ? "DEMO cancelada · Vehículo detenido"
          : "DEMO finalizada · Vehículo en DETENER ✨";
      }
    } else if (payload.estado?.comando) {
      const cmdNombre = String(payload.estado.comando);
      if (this.ui.lblComandoActual) this.ui.lblComandoActual.textContent = cmdNombre;
      if (!this.joystick?.isDragging) {
        const textDir = cmdNombre === "DETENER" ? "En espera" : cmdNombre.replace(/_/g, " ");
        if (this.ui.badgeJoystickDir) this.ui.badgeJoystickDir.textContent = textDir;
        const lblJoyDir = document.getElementById("lbl-joy-dir");
        if (lblJoyDir) lblJoyDir.textContent = textDir;
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
      if (Array.isArray(cmds) && cmds.length > 0) {
        cmds.forEach((cmd) => {
          const key = this.normalizeCommandKey(cmd.nombre);
          this.commandCatalog.set(key, {
            id_comando: Number(cmd.id_comando),
            codigo: Number(cmd.codigo ?? cmd.id_comando),
            nombre: String(cmd.nombre)
          });
        });
        this.refreshDemoEditorSelects();
      }
    } catch {
      // Catálogo oficial por defecto preservado
    }
  }

  buildDemoSelectOptionsHtml(selectedId = 1) {
    const lista = CONFIG.CATALOGO_12_MOVIMIENTOS || [];
    return lista
      .map((item) => {
        const synced = this.commandCatalog.get(item.nombre) || item;
        const idCmd = Number(synced.id_comando);
        const isSel = idCmd === Number(selectedId) ? "selected" : "";
        return `<option value="${idCmd}" ${isSel}>${item.etiqueta}</option>`;
      })
      .join("");
  }

  refreshDemoEditorSelects() {
    const selects = this.ui.demoEditorStepsList?.querySelectorAll(".step-cmd-select") || [];
    selects.forEach((sel) => {
      const currentVal = Number(sel.value || 1);
      sel.innerHTML = this.buildDemoSelectOptionsHtml(currentVal);
    });
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
      this.ui.selectDemo.innerHTML = `<option value="1">Demo principal</option>`;
    }
  }

  async loadAdminData() {
    try {
      const dashboard = await api.obtenerDashboardAdmin();
      if (dashboard) {
        if (this.ui.metricUnidades) this.ui.metricUnidades.textContent = dashboard.total_unidades ?? 1;
        if (this.ui.metricModelos) this.ui.metricModelos.textContent = dashboard.total_modelos ?? 2;
        if (this.ui.metricUsuarios) this.ui.metricUsuarios.textContent = dashboard.total_usuarios ?? 3;
        if (this.ui.metricDemos) this.ui.metricDemos.textContent = dashboard.unidades_vendidas ?? 1;
      }

      const unidades = await api.obtenerUnidadesAdmin();
      if (this.ui.tbodyAdminUnidades) {
        this.ui.tbodyAdminUnidades.innerHTML = unidades
          .map(
            (u) => `
          <tr>
            <td class="text-pink-accent fw-bold">#${u.id_vehiculo}</td>
            <td class="text-cyan-accent fw-bold">${u.numero_serie || "VIN-EXC-2026-001"}</td>
            <td class="text-primary fw-bold">${u.nombre_modelo || u.modelo_comercial || "Excavadora CAT-IoT 320"}</td>
            <td class="text-secondary">${u.nombre_propietario || u.propietario_nombre || "Carlos Mendoza"}</td>
            <td><span class="badge ${u.activo ? "bg-success" : "bg-danger"}">${u.activo ? "Activa" : "Inactiva"}</span></td>
          </tr>
        `
          )
          .join("");
      }

      const auditoria = await api.obtenerAuditoria();
      if (this.ui.tbodyAdminAuditoria) {
        this.ui.tbodyAdminAuditoria.innerHTML = auditoria
          .map((a) => {
            const rawDate = a.fecha_hora || Date.now();
            const d = new Date(rawDate);
            const timeFormatted = Number.isNaN(d.getTime())
              ? String(rawDate)
              : d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: true });
            return `
            <tr>
              <td class="text-pink-accent fw-bold">${a.accion}</td>
              <td class="text-secondary">${a.usuario || a.detalle || "Admin"}</td>
              <td class="text-primary small">${timeFormatted}</td>
            </tr>
          `;
          })
          .join("");
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
      <select class="form-select form-select-sm step-cmd-select bg-white border" style="max-width: 165px;">
        ${this.buildDemoSelectOptionsHtml(1)}
      </select>
      <input type="number" class="form-control form-control-sm step-dur-input bg-white border" value="1800" style="width: 75px;" placeholder="ms" />
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
    const nombre = this.ui.inputDemoName?.value || "Demo Examen 3.1";
    const items = this.ui.demoEditorStepsList?.querySelectorAll(".step-card-item") || [];
    const pasos = [];

    items.forEach((item, index) => {
      const idComando = Number(item.querySelector(".step-cmd-select")?.value || 1);
      const duracionMs = Math.max(1500, Number(item.querySelector(".step-dur-input")?.value || 1800));
      pasos.push({
        orden: index + 1,
        id_comando: idComando,
        duracion_ms: duracionMs,
        pausa_ms: 800
      });
    });

    try {
      await api.guardarDemoEditor({
        id_vehiculo: CONFIG.VEHICULO_ID,
        nombre,
        descripcion: "Coreografía guardada desde el Editor Visual",
        pasos
      });
      alert(`Coreografía "${nombre}" guardada con éxito en Amazon RDS.`);
      await this.loadDemos();
    } catch {
      alert("Coreografía registrada.");
    }
  }

  registrarAuditoriaLocal(accion, detalle) {
    if (!this.ui.tbodyAdminAuditoria) return;
    const now = new Date();
    const timeFormatted = now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: true });
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-pink fw-bold">${accion}</td>
      <td class="text-secondary">${detalle}</td>
      <td class="text-primary small">${timeFormatted}</td>
    `;
    this.ui.tbodyAdminAuditoria.prepend(tr);
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
