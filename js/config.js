/**
 * Módulo de Configuración Centralizada (ES6 Module)
 * Conexión Estricta hacia AWS EC2 en la Nube (Sin localhost ni 127.0.0.1)
 */

export const CONFIG = Object.freeze({
  // Servidor Backend en AWS EC2
  API_BASE_URL: "https://52.4.170.82:8000",

  // Canales WebSocket Seguro (Principal con ID y Fallback base)
  WS_URL: "wss://52.4.170.82:8000/ws/1",
  WS_FALLBACK_URL: "wss://52.4.170.82:8000/ws",

  // Identificador de vehículo por defecto (Amazon RDS)
  VEHICULO_ID: 1,

  // Límite estricto de historial para Monitoreo 4.2
  HISTORIAL_LIMIT: 10,

  // Origen para auditoría y trazabilidad
  ORIGEN_CONTROL: "PLATAFORMA-IOT-4.3",

  // Tiempos de ciclo y reconexión
  HEALTH_POLL_INTERVAL_MS: 10000,
  FETCH_TIMEOUT_MS: 9000,
  WS_RECONNECT_DELAY_MS: 3000,

  // Endpoints REST de la API
  ENDPOINTS: {
    // 4.1 y 4.2: Control y Monitoreo
    VEHICULOS: "/api/vehiculos",
    COMANDOS: "/api/comandos",
    COMANDOS_VEHICULO: (id) => `/api/vehiculos/${id}/comandos`,
    DEMOS: "/api/demos",
    DEMOS_VEHICULO: (id) => `/api/vehiculos/${id}/demos`,
    ESTADO_VEHICULO: (id) => `/api/vehiculos/${id}/estado`,
    ESTADO_QUERY: (id) => `/api/estado?id_vehiculo=${id}`,
    HISTORIAL_VEHICULO: (id) => `/api/vehiculos/${id}/historial`,
    HISTORIAL_QUERY: (id) => `/api/historial?id_vehiculo=${id}`,
    MOVIMIENTOS: "/api/movimientos",
    CONTROL_MOVIMIENTO: "/api/control/movimiento",
    DEMO_INICIAR: "/api/demos/iniciar",
    CONTROL_DEMO_EJECUTAR: (idDemo) => `/api/control/demos/${idDemo}/ejecutar`,
    DEMO_CANCELAR: "/api/demos/cancelar",
    HEALTH_DB: "/api/health/db",
    CONTROL_CLAXON: "/api/control/claxon",
    CONTROL_VOLUMEN: "/api/control/volumen",
    CONTROL_VELOCIDAD: "/api/control/velocidad",

    // 4.3: Autenticación Real, Administración, RBAC y Auditoría
    AUTH_LOGIN: "/api/auth/login",
    AUTH_LOGOUT: "/api/auth/logout",
    AUTH_ME: "/api/auth/me",
    ADMIN_DASHBOARD: "/api/admin/dashboard",
    ADMIN_MODELOS: "/api/admin/modelos",
    ADMIN_UNIDADES: "/api/admin/unidades",
    ADMIN_USUARIOS: "/api/admin/usuarios",
    ADMIN_ASIGNAR: "/api/admin/asignaciones",
    ADMIN_AUDITORIA: "/api/admin/auditoria",
    DEMO_EDITOR_GUARDAR: "/api/demos/editor/guardar",
    INVITADO_SOLICITAR_PRUEBA: "/api/invitado/solicitar-prueba"
  },

  // Catálogo oficial de los 12 Movimientos del Profesor (+ 13 DETENER)
  CATALOGO_12_MOVIMIENTOS: [
    { id_comando: 1,  codigo: 1,  nombre: "ADELANTE",          etiqueta: "01 · ADELANTE" },
    { id_comando: 2,  codigo: 2,  nombre: "ATRAS",             etiqueta: "02 · ATRÁS" },
    { id_comando: 3,  codigo: 3,  nombre: "GIRAR_IZQUIERDA",   etiqueta: "03 · GIRAR IZQUIERDA" },
    { id_comando: 4,  codigo: 4,  nombre: "GIRAR_DERECHA",     etiqueta: "04 · GIRAR DERECHA" },
    { id_comando: 5,  codigo: 5,  nombre: "MOVER_IZQUIERDA",   etiqueta: "05 · MOVER IZQUIERDA" },
    { id_comando: 6,  codigo: 6,  nombre: "MOVER_DERECHA",     etiqueta: "06 · MOVER DERECHA" },
    { id_comando: 7,  codigo: 7,  nombre: "SUBIR_BRAZO",       etiqueta: "07 · SUBIR BRAZO" },
    { id_comando: 8,  codigo: 8,  nombre: "BAJAR_BRAZO",       etiqueta: "08 · BAJAR BRAZO" },
    { id_comando: 9,  codigo: 9,  nombre: "LUZ_LED",           etiqueta: "09 · LUZ / LED" },
    { id_comando: 10, codigo: 10, nombre: "ACTIVAR_SONIDO",    etiqueta: "10 · ACTIVAR SONIDO" },
    { id_comando: 11, codigo: 11, nombre: "DESACTIVAR_SONIDO", etiqueta: "11 · DESACTIVAR SONIDO" },
    { id_comando: 12, codigo: 12, nombre: "CONTROL_REMOTO",    etiqueta: "12 · CONTROL REMOTO" },
    { id_comando: 13, codigo: 13, nombre: "DETENER",           etiqueta: "13 · DETENER (Paro Total)" }
  ],

  // Mapeo por defecto de los 12 movimientos + DETENER y alias para el Joystick
  DEFAULT_COMMAND_MAP: {
    ADELANTE:          { id_comando: 1,  codigo: 1,  nombre: "ADELANTE" },
    ATRAS:             { id_comando: 2,  codigo: 2,  nombre: "ATRAS" },
    GIRAR_IZQUIERDA:   { id_comando: 3,  codigo: 3,  nombre: "GIRAR_IZQUIERDA" },
    GIRAR_DERECHA:     { id_comando: 4,  codigo: 4,  nombre: "GIRAR_DERECHA" },
    MOVER_IZQUIERDA:   { id_comando: 5,  codigo: 5,  nombre: "MOVER_IZQUIERDA" },
    MOVER_DERECHA:     { id_comando: 6,  codigo: 6,  nombre: "MOVER_DERECHA" },
    SUBIR_BRAZO:       { id_comando: 7,  codigo: 7,  nombre: "SUBIR_BRAZO" },
    BAJAR_BRAZO:       { id_comando: 8,  codigo: 8,  nombre: "BAJAR_BRAZO" },
    LUZ_LED:           { id_comando: 9,  codigo: 9,  nombre: "LUZ_LED" },
    ACTIVAR_SONIDO:    { id_comando: 10, codigo: 10, nombre: "ACTIVAR_SONIDO" },
    DESACTIVAR_SONIDO: { id_comando: 11, codigo: 11, nombre: "DESACTIVAR_SONIDO" },
    CONTROL_REMOTO:    { id_comando: 12, codigo: 12, nombre: "CONTROL_REMOTO" },
    DETENER:           { id_comando: 13, codigo: 13, nombre: "DETENER" },

    // Alias de Joystick y nombres alternativos
    AVANZAR:           { id_comando: 1,  codigo: 1,  nombre: "ADELANTE" },
    RETROCEDER:        { id_comando: 2,  codigo: 2,  nombre: "ATRAS" },
    IZQUIERDA:         { id_comando: 3,  codigo: 3,  nombre: "GIRAR_IZQUIERDA" },
    DERECHA:           { id_comando: 4,  codigo: 4,  nombre: "GIRAR_DERECHA" },
    LUZ:               { id_comando: 9,  codigo: 9,  nombre: "LUZ_LED" },
    SONIDO:            { id_comando: 10, codigo: 10, nombre: "ACTIVAR_SONIDO" }
  }
});
