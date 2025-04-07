export const testCallToNode = () => {
  fetch("http://127.0.0.1:3000", { mode: "no-cors" })
    .then(() => console.info("success"))
    .catch((e) => console.error(e));
};
