import core from "./index.js";

export default {
  async fetch(request, env, ctx) {
    return core.fetch(request, env, ctx);
  },
};
