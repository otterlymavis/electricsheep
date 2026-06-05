const SERVER = "http://localhost:33099";

async function sendToSheep(data) {
  const res = await fetch(`${SERVER}/capture`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "SEND_TO_SHEEP") {
    sendToSheep(msg.data)
      .then(result => reply({ ok: true,  result }))
      .catch(err   => reply({ ok: false, error: err.message }));
    return true; // keep channel open for async reply
  }
});
