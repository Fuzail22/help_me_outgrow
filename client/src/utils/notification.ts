import { Motifications } from "../types";

function snedMSGToServiceWorker(title: string, body: string) {
  const controller = navigator.serviceWorker.controller;
  if (controller) {
    controller.postMessage({
      type: Motifications.SHOW_NOTIFICATIONS,
      title,
      body,
    });
  }
}
export function showNotification() {
  Notification.requestPermission().then((result) => {
    if (result === "granted") {
      snedMSGToServiceWorker("hello", "sample notification");
      //   navigator.serviceWorker.ready.then((registration) => {
      //     registration.showNotification("Vibration Sample", {
      //       body: "Buzz! Buzz!",
      //       icon: "../images/touch/chrome-touch-icon-192x192.png", // Update the path to your icon
      //       vibrate: [200, 100, 200, 100, 200, 100, 200],
      //       tag: "vibration-sample",
      //     });
      //   });
    }
  });
}
