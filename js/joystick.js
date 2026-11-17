/**
 * Módulo de Joystick Virtual Circular (ES6 Module)
 * - Soporte nativo para Touch Events en móviles (touchstart, touchmove, touchend con e.touches[0] y e.preventDefault()).
 * - Soporte para Mouse en escritorio (mousedown, mousemove, mouseup).
 * - Mapeo directo a comandos reales: AVANZAR, RETROCEDER, IZQUIERDA, DERECHA y DETENER.
 * - Retorno automático al centro y envío prioritario de DETENER al soltar.
 */

export class VirtualJoystick {
  constructor({ zoneElement, thumbElement, onDirectionChange }) {
    this.zone = zoneElement;
    this.thumb = thumbElement;
    this.onDirectionChange = onDirectionChange || (() => {});

    this.isDragging = false;
    this.currentDirection = "DETENER";
    this.disabled = false;
    this.deadzoneRatio = 0.25;

    this.bindEvents();
  }

  bindEvents() {
    if (!this.zone) return;

    // 1. Eventos Táctiles para Celular (passive: false es crítico para que e.preventDefault() bloquee el scroll)
    this.zone.addEventListener(
      "touchstart",
      (e) => this.handleTouchStart(e),
      { passive: false }
    );
    window.addEventListener(
      "touchmove",
      (e) => this.handleTouchMove(e),
      { passive: false }
    );
    window.addEventListener(
      "touchend",
      (e) => this.handleTouchEnd(e),
      { passive: false }
    );
    window.addEventListener(
      "touchcancel",
      (e) => this.handleTouchEnd(e),
      { passive: false }
    );

    // 2. Eventos de Mouse para PC / Escritorio
    this.zone.addEventListener("mousedown", (e) => this.handleMouseDown(e));
    window.addEventListener("mousemove", (e) => this.handleMouseMove(e));
    window.addEventListener("mouseup", () => this.handleMouseUp());

    // Seguridad al perder foco o cambiar de pestaña en el celular
    window.addEventListener("blur", () => this.forceStop());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.forceStop();
      }
    });
  }

  setDisabled(isDisabled) {
    this.disabled = Boolean(isDisabled);
    if (this.disabled) {
      this.zone.classList.add("joystick-disabled");
      this.forceStop();
    } else {
      this.zone.classList.remove("joystick-disabled");
    }
  }

  /**
   * Inicio de toque en pantalla móvil (touchstart)
   */
  handleTouchStart(e) {
    if (this.disabled) return;
    if (e.cancelable) {
      e.preventDefault();
    }

    const touch = e.touches && e.touches[0];
    if (!touch) return;

    this.isDragging = true;
    this.thumb.classList.add("dragging");
    this.updateFromClientCoords(touch.clientX, touch.clientY);
  }

  /**
   * Arrastre del dedo en pantalla móvil (touchmove)
   * Usa e.touches[0].clientX y e.touches[0].clientY y evita el scroll con e.preventDefault()
   */
  handleTouchMove(e) {
    if (!this.isDragging || this.disabled) return;
    if (e.cancelable) {
      e.preventDefault();
    }

    const touch = e.touches && e.touches[0];
    if (!touch) return;

    this.updateFromClientCoords(touch.clientX, touch.clientY);
  }

  /**
   * Fin de toque en pantalla móvil (touchend / touchcancel)
   */
  handleTouchEnd(e) {
    if (!this.isDragging) return;
    if (e && e.touches && e.touches.length > 0) {
      return;
    }
    this.resetToCenterAndStop();
  }

  /**
   * Soporte Mouse en escritorio
   */
  handleMouseDown(e) {
    if (this.disabled || e.button !== 0) return;
    e.preventDefault();

    this.isDragging = true;
    this.thumb.classList.add("dragging");
    this.updateFromClientCoords(e.clientX, e.clientY);
  }

  handleMouseMove(e) {
    if (!this.isDragging || this.disabled) return;
    this.updateFromClientCoords(e.clientX, e.clientY);
  }

  handleMouseUp() {
    if (!this.isDragging) return;
    this.resetToCenterAndStop();
  }

  updateFromClientCoords(clientX, clientY) {
    const rect = this.zone.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const maxRadius = (rect.width - this.thumb.offsetWidth) / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const distance = Math.hypot(dx, dy);

    let clampedX = dx;
    let clampedY = dy;

    if (distance > maxRadius && maxRadius > 0) {
      const ratio = maxRadius / distance;
      clampedX = dx * ratio;
      clampedY = dy * ratio;
    }

    this.thumb.style.transform = `translate3d(${clampedX.toFixed(1)}px, ${clampedY.toFixed(1)}px, 0px)`;

    const normalizedDistance = maxRadius > 0 ? Math.min(distance / maxRadius, 1) : 0;
    if (normalizedDistance < this.deadzoneRatio) {
      this.emitIfDirectionChanged("DETENER");
      return;
    }

    const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
    const positiveAngle = Math.round((angleDeg + 360) % 360);
    const powerPct = Math.round(normalizedDistance * 100);

    const lblAngle = document.getElementById("lbl-joy-angle");
    const lblPower = document.getElementById("lbl-joy-power");
    if (lblAngle) lblAngle.textContent = `${positiveAngle}°`;
    if (lblPower) lblPower.textContent = `${powerPct}%`;

    let nextDirection = "DETENER";

    if (angleDeg >= -135 && angleDeg < -45) {
      nextDirection = "AVANZAR";
    } else if (angleDeg >= -45 && angleDeg < 45) {
      nextDirection = "DERECHA";
    } else if (angleDeg >= 45 && angleDeg < 135) {
      nextDirection = "RETROCEDER";
    } else {
      nextDirection = "IZQUIERDA";
    }

    const lblJoyDir = document.getElementById("lbl-joy-dir");
    if (lblJoyDir) {
      lblJoyDir.textContent = nextDirection === "DETENER" ? "En espera" : nextDirection;
    }

    this.emitIfDirectionChanged(nextDirection);
  }

  emitIfDirectionChanged(nextDirection) {
    if (nextDirection === this.currentDirection) {
      return;
    }
    this.currentDirection = nextDirection;
    this.onDirectionChange(nextDirection);
  }

  resetToCenterAndStop() {
    this.isDragging = false;
    this.thumb.classList.remove("dragging");
    this.thumb.style.transform = "translate3d(0px, 0px, 0px)";

    const lblAngle = document.getElementById("lbl-joy-angle");
    const lblPower = document.getElementById("lbl-joy-power");
    const lblJoyDir = document.getElementById("lbl-joy-dir");
    if (lblAngle) lblAngle.textContent = "0°";
    if (lblPower) lblPower.textContent = "0%";
    if (lblJoyDir) lblJoyDir.textContent = "En espera";

    if (this.currentDirection !== "DETENER") {
      this.currentDirection = "DETENER";
      this.onDirectionChange("DETENER");
    }
  }

  forceStop() {
    this.isDragging = false;
    this.thumb.classList.remove("dragging");
    this.thumb.style.transform = "translate3d(0px, 0px, 0px)";

    const lblAngle = document.getElementById("lbl-joy-angle");
    const lblPower = document.getElementById("lbl-joy-power");
    const lblJoyDir = document.getElementById("lbl-joy-dir");
    if (lblAngle) lblAngle.textContent = "0°";
    if (lblPower) lblPower.textContent = "0%";
    if (lblJoyDir) lblJoyDir.textContent = "En espera";

    this.currentDirection = "DETENER";
    this.onDirectionChange("DETENER");
  }
}
