(function () {
  "use strict";

  class ChibatoruWebSocketClient {
    constructor(url, handlers = {}) {
      this.url = url;
      this.handlers = handlers;
      this.socket = null;
      this.joinPayload = null;
      this.isOpen = false;
    }

    get open() {
      return this.isOpen;
    }

    connect(joinPayload) {
      this.joinPayload = { ...joinPayload };
      this.close();
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener("open", () => {
        this.isOpen = true;
        this.handlers.onOpen?.();
        this.send({
          type: "joinRoom",
          ...this.joinPayload
        });
      });
      this.socket.addEventListener("message", (event) => {
        let message = null;
        try {
          message = JSON.parse(event.data);
        } catch {
          this.handlers.onError?.(new Error("WebSocket message was not valid JSON."));
          return;
        }
        this.handlers.onMessage?.(message);
      });
      this.socket.addEventListener("close", (event) => {
        this.isOpen = false;
        this.handlers.onClose?.(event);
      });
      this.socket.addEventListener("error", (event) => {
        this.handlers.onError?.(event);
      });
    }

    send(message) {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
      this.socket.send(JSON.stringify(message));
      return true;
    }

    close() {
      if (!this.socket) return;
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
      this.isOpen = false;
    }
  }

  window.ChibatoruWebSocketClient = ChibatoruWebSocketClient;
})();
