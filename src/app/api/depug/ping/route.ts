export async function GET() {
  return Response.json({
    ok: true,
    worker: "tayba-pos",
    timestamp: new Date().toISOString(),
  })
}