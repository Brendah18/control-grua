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

    // 4.3: Administración, RBAC y Auditoría
    AUTH_LOGIN: "/api/auth/login",
    ADMIN_DASHBOARD: "/api/admin/dashboard",
    ADMIN_MODELOS: "/api/admin/modelos",
    ADMIN_UNIDADES: "/api/admin/unidades",
    ADMIN_USUARIOS: "/api/admin/usuarios",
    ADMIN_ASIGNAR: "/api/admin/asignaciones",
    ADMIN_AUDITORIA: "/api/admin/auditoria",
    DEMO_EDITOR_GUARDAR: "/api/demos/editor/guardar",
    INVITADO_SOLICITAR_PRUEBA: "/api/invitado/solicitar-prueba"
  },

  // Catálogo oficial de 11 comandos operativos (Excavadora NO.555-104)
  CATALOGO_11_COMANDOS: [
    { id_comando: 1, codigo: 1, nombre: "AVANZAR", etiqueta: "AVANZAR (Forward)" },
    { id_comando: 2, codigo: 2, nombre: "RETROCEDER", etiqueta: "RETROCEDER (Backward)" },
    { id_comando: 10, codigo: 10, nombre: "IZQUIERDA", etiqueta: "IZQUIERDA (Oruga Izq.)" },
    { id_comando: 11, codigo: 11, nombre: "DERECHA", etiqueta: "DERECHA (Oruga Der.)" },
    { id_comando: 9, codigo: 9, nombre: "DETENER", etiqueta: "DETENER (Paro Total)" },
    { id_comando: 12, codigo: 12, nombre: "CABINA_IZQ", etiqueta: "CABINA_IZQ (Torreta Izq.)" },
    { id_comando: 13, codigo: 13, nombre: "CABINA_DER", etiqueta: "CABINA_DER (Torreta Der.)" },
    { id_comando: 14, codigo: 14, nombre: "EXCAVAR", etiqueta: "EXCAVAR (Brazo/Pala)" },
    { id_comando: 15, codigo: 15, nombre: "LUZ", etiqueta: "LUZ (Light ON/OFF)" },
    { id_comando: 16, codigo: 16, nombre: "SONIDO", etiqueta: "SONIDO (Music ON/OFF)" },
    { id_comando: 17, codigo: 17, nombre: "VELOCIDAD", etiqueta: "VELOCIDAD (Speed)" }
  ],

  // Mapeo por defecto de comandos (11 operativos + alias históricos 3..8 intactos)
  DEFAULT_COMMAND_MAP: {
    AVANZAR: { id_comando: 1, codigo: 1, nombre: "AVANZAR" },
    RETROCEDER: { id_comando: 2, codigo: 2, nombre: "RETROCEDER" },
    IZQUIERDA: { id_comando: 10, codigo: 10, nombre: "IZQUIERDA" },
    DERECHA: { id_comando: 11, codigo: 11, nombre: "DERECHA" },
    DETENER: { id_comando: 9, codigo: 9, nombre: "DETENER" },
    CABINA_IZQ: { id_comando: 12, codigo: 12, nombre: "CABINA_IZQ" },
    CABINA_DER: { id_comando: 13, codigo: 13, nombre: "CABINA_DER" },
    EXCAVAR: { id_comando: 14, codigo: 14, nombre: "EXCAVAR" },
    LUZ: { id_comando: 15, codigo: 15, nombre: "LUZ" },
    SONIDO: { id_comando: 16, codigo: 16, nombre: "SONIDO" },
    VELOCIDAD: { id_comando: 17, codigo: 17, nombre: "VELOCIDAD" },
    // Alias históricos (IDs 3..8 preservados)
    GIRAR_IZQUIERDA: { id_comando: 3, codigo: 3, nombre: "GIRAR_IZQUIERDA" },
    GIRAR_DERECHA: { id_comando: 4, codigo: 4, nombre: "GIRAR_DERECHA" },
    SUBIR_BRAZO: { id_comando: 5, codigo: 5, nombre: "SUBIR_BRAZO" },
    BAJAR_BRAZO: { id_comando: 6, codigo: 6, nombre: "BAJAR_BRAZO" },
    ABRIR_PALA: { id_comando: 7, codigo: 7, nombre: "ABRIR_PALA" },
    CERRAR_PALA: { id_comando: 8, codigo: 8, nombre: "CERRAR_PALA" }
  }
});
