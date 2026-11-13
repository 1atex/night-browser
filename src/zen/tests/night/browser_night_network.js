add_task(async function intercept_and_replay_inside_selected_tab() {
  const { HttpServer } = ChromeUtils.importESModule(
    "resource://testing-common/httpd.sys.mjs",
  );
  const { NightNetwork } = ChromeUtils.importESModule(
    "resource:///modules/night/NightNetwork.sys.mjs",
  );
  const { NetUtil } = ChromeUtils.importESModule(
    "resource://gre/modules/NetUtil.sys.mjs",
  );
  const server = new HttpServer();
  server.registerPathHandler("/", (_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.write("<!doctype html><title>Night test</title>");
  });
  server.registerPathHandler("/echo", (request, response) => {
    response.setHeader("Content-Type", "application/json");
    const stream = request.bodyInputStream;
    const body = NetUtil.readInputStreamToString(stream, stream.available());
    response.write(JSON.stringify({ method: request.method, body }));
  });
  server.start(-1);
  const url = `http://localhost:${server.identity.primaryPort}`;
  let service;
  try {
    await BrowserTestUtils.withNewTab(`${url}/`, async (browser) => {
      service = new NightNetwork(window, () => {});
      service.start(gBrowser.getTabForBrowser(browser), true);
      const resultPromise = SpecialPowers.spawn(
        browser,
        [`${url}/echo`],
        async (target) => {
          const response = await content.fetch(target, {
            method: "POST",
            body: "original",
          });
          return response.json();
        },
      );
      await TestUtils.waitForCondition(
        () => service.pending.length === 1,
        "Request stops before reaching server",
      );
      const request = service.pending[0];
      service.forward(request.id, {
        method: "POST",
        url: request.url,
        headers: "Content-Type: text/plain",
        body: "edited",
      });
      const result = await resultPromise;
      is(result.body, "edited", "Server received the edited body");
      is(result.method, "POST", "Method is preserved");
      const replay = await service.replay(
        {
          method: "POST",
          url: `${url}/echo`,
          headers: "Content-Type: text/plain",
          body: "replayed",
        },
        request.url,
      );
      is(
        JSON.parse(replay.body).body,
        "replayed",
        "Repeater received the new response",
      );
      is(service.pending.length, 0, "No paused requests remain");
      service.destroy();
    });
  } finally {
    service?.destroy();
    await new Promise((resolve) => server.stop(resolve));
  }
});
