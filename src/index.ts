import app, { bootstrap } from "./server";

console.log("🔥 BI PROCESS START");
console.log("⏳ BI INIT START");

bootstrap().catch((err) => {
  console.error("❌ BI DB failed (non-blocking)", err);
});

const port = process.env.PORT || 8080;

app.listen(port, () => {
  console.log(`🚀 BI SERVER RUNNING ON ${port}`);
  console.log("✅ BI SERVER READY");
});
