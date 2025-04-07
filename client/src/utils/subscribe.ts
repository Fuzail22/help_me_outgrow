const publicVapidKey =
  "BOKIabU0vv_RbAztMB_2l6Bc-O4NvsXwTvHfnIbasRMTiVIm1pKLzsyUyVgXlOVqu2KbqdbtmAwrwodkpsKdcmA";

const createSubscription = async () => {
  const registration = await navigator.serviceWorker.ready;
  const pushAPISubscription = await registration.pushManager.subscribe({
    userVisibleOnly: true, //check its need,
    applicationServerKey: urlBase64ToUint8Array(publicVapidKey),
  });
  console.log(JSON.stringify(pushAPISubscription));
};

const urlBase64ToUint8Array = (base64String: String) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((char) => char.charCodeAt(0)));
};

export { urlBase64ToUint8Array, createSubscription };
