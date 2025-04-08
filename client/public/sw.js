self.addEventListener("install", (event) => {
  console.log("Service Worker installing.");
  self.skipWaiting(); // Activate the Service Worker immediately
});

self.addEventListener("activate", (event) => {
  console.log("Service Worker activating.");
});
self.addEventListener("message", (e) => {
  console.log("message event received");
  if (e.data && e.data.type == show_notifications) {
    const { title, body } = e.data;
    // setTimeout(
    //   () =>
    self.registration.showNotification(title, {
      body,
      icon: "vite.svg",
      image: "vite.svg",
    });
    // ,
    //   10000
    // );
  }
});

self.addEventListener("push", (event) => {
  console.log("pushed");
  const data = event.data.json();
  console.log({ data });
  self.registration.showNotification(data.title, {
    body: data.body,
    icon: "vite.svg",
    image: "vite.svg",
  });
});
