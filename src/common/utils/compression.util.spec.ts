import * as express from "express";
import * as request from "supertest";
import { createCompressionMiddleware } from "./compression.util";

function buildApp() {
  const app = express();
  app.use(createCompressionMiddleware());

  app.get("/large", (req, res) => {
    res.json({ data: "x".repeat(10000) });
  });

  app.get("/sse", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write("data: hello\n\n");
    res.end();
  });

  return app;
}

describe("createCompressionMiddleware", () => {
  it("compresses a large JSON response", async () => {
    const app = buildApp();
    const res = await request(app).get("/large").set("Accept-Encoding", "gzip");

    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(JSON.parse(res.text).data.length).toBe(10000);
  });

  it("does not compress Server-Sent Events responses", async () => {
    const app = buildApp();
    const res = await request(app).get("/sse").set("Accept-Encoding", "gzip");

    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.text).toContain("data: hello");
  });
});
