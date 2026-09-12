"""Track dashboard tabs so a hidden local server can stop when no UI remains."""
import threading
import time


class DashboardLifetime:
    def __init__(self, auto_stop=False, clock=time.monotonic):
        self.auto_stop, self.clock = auto_stop, clock
        self.started = self.last_seen = clock()
        self.seen = False
        self.clients = {}
        self.lock = threading.Lock()

    def update(self, client, closing=False):
        if not isinstance(client, str) or not 8 <= len(client) <= 100:
            raise ValueError('Identificativo dashboard non valido')
        with self.lock:
            now = self.clock()
            self.last_seen, self.seen = now, True
            if closing:
                self.clients.pop(client, None)
            else:
                self.clients[client] = now

    def should_stop(self):
        if not self.auto_stop:
            return False
        with self.lock:
            now = self.clock()
            if not self.seen:
                return now - self.started > 120
            # Background tabs can throttle timers to once per minute.
            self.clients = {key: value for key, value in self.clients.items() if now - value < 180}
            return not self.clients and now - self.last_seen > 45
