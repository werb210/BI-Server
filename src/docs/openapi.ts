export const openApiSpec = {
  openapi: "3.0.0",
  info: {
    title: "BI Server API",
    version: "1.0.0",
    description: "Boreal Insurance backend API"
  },
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        responses: {
          200: {
            description: "Server healthy"
          }
        }
      }
    }
  }
};
