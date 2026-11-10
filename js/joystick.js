/**
 * Módulo de Joystick Virtual Circular
 * - Operable por Mouse y Pointer/Touch Events.
 * - Mapeo directo a comandos reales: AVANZAR, RETROCEDER, IZQUIERDA, DERECHA y DETENER.
 * - Control de ráfagas (debouncing por cambio de estado).
 * - Retorno automático al centro y envío prioritario de DETENER al soltar.
 */
(function (global) {
  class VirtualJoystick {
    constructor({ zoneElement, thumbElement, onDirectionChange }) {
      this.zone = zoneElement;
      this.thumb = thumbElement;
      this.onDirectionChange = onDirectionChange || (() => {});

      this.isDragging = false;
      this.activePointerId = null;
      this.currentDirection = "DETENER";
      this.disabled = false;
      this.deadzoneRatio = 0.28;

      this.bindEvents();
    }

    bindEvents() {
      this.zone.addEventListener("pointerdown", (e) => this.handlePointerDown(e));
      window.addEventListener("pointermove", (e) => this.handlePointerMove(e));
      window.addEventListener("pointerup", (e) => this.handlePointerUp(e));
      window.addEventListener("pointercancel", (e) => this.handlePointerUp(e));

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

    handlePointerDown(event) {
      if (this.disabled) return;
      event.preventDefault();

      this.isDragging = true;
      this.activePointerId = event.pointerId;
      this.thumb.classList.add("dragging");

      try {
        this.zone.setPointerCapture(event.pointerId);
      } catch {
        // Ignorar si no aplica
      }

      this.updateFromClientCoords(event.clientX, event.clientY);
    }

    handlePointerMove(event) {
      if (!this.isDragging || this.disabled) return;
      if (this.activePointerId !== null && event.pointerId !== this.activePointerId) {
        return;
      }

      this.updateFromClientCoords(event.clientX, event.clientY);
    }

    handlePointerUp(event) {
      if (!this.isDragging) return;
      if (
        event &&
        this.activePointerId !== null &&
        event.pointerId !== undefined &&
        event.pointerId !== this.activePointerId
      ) {
        return;
      }

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
      this.activePointerId = null;
      this.thumb.classList.remove("dragging");
      this.thumb.style.transform = "translate3d(0px, 0px, 0px)";

      if (this.currentDirection !== "DETENER") {
        this.currentDirection = "DETENER";
        this.onDirectionChange("DETENER");
      }
    }

    forceStop() {
      this.isDragging = false;
      this.activePointerId = null;
      this.thumb.classList.remove("dragging");
      this.thumb.style.transform = "translate3d(0px, 0px, 0px)";
      this.currentDirection = "DETENER";
      this.onDirectionChange("DETENER");
    }
  }

  global.VirtualJoystick = VirtualJoystick;
})(window);
