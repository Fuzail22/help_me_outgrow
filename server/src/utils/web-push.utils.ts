import webpush from "web-push";

const setVapidDetails = (
  mailto: String,
  publickey: String,
  privateKey: String
) => {
  webpush.setVapidDetails(`mailto:${mailto}`, publickey, privateKey);
};

const sendNotification = (
  subscription: { endpoint: String; keys: { auth: String; p256dh: String } },
  payload
) => {
  console.log({ subscription, payload });
  webpush
    .sendNotification(subscription, payload)
    .then((data) => console.log("data", data))
    .catch((err) => console.error("Erron sending notification", err));
};

const generateVapid = () => {
  return webpush.generateVAPIDKeys();
};

export { setVapidDetails, sendNotification, generateVapid };
