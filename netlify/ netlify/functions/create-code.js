
exports.handler = async () => ({
  statusCode: 410,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  },
  body: JSON.stringify({
    ok: false,
    error: "This endpoint is retired. Use the protected admin panel."
  })
});
