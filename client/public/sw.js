self.addEventListener("install", (event) => {
  console.log("Service Worker installing.");
  self.skipWaiting(); // Activate the Service Worker immediately
});

self.addEventListener("activate", (event) => {
  console.log("Service Worker activating.");
});
self.addEventListener("message", (e) => {
  console.log("message event received");
  if (e.data && e.data.type == "show_notifications") {
    const { title, body } = e.data;
    self.registration.showNotification(title, {
      body,
      icon: "vite.svg",
      image: "vite.svg",
    });
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "open_url") {
    clients.openWindow(event.notification.data.url);
  }
});

self.addEventListener("push", (event) => {
  console.log("pushed");
  const data = event.data.json();
  const { title, ...rest } = data;
  console.log({ data });
  self.registration.showNotification(title, {
    ...rest,
    icon: "vite.svg",
    image: "vite.svg",
  });
});
