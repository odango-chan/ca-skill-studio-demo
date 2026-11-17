import { handleGatewayRequest } from "./handler.mjs";

export default {
  fetch(request, env) {
    return handleGatewayRequest(request, env, {
      fetchImpl: fetch,
      clientIp: request.headers.get("CF-Connecting-IP"),
      rateLimit: (key) => env.AI_GATEWAY_RATE_LIMITER.limit({ key }),
    });
  },
};
