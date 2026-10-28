export const renderLinkPage = ({ adminKey, itemId }: { adminKey: string; itemId: string | null }) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connect a bank</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 480px; margin: 64px auto; padding: 0 16px; }
      button { font-size: 16px; padding: 10px 16px; cursor: pointer; }
    </style>
  </head>
  <body>
    <h1>${itemId ? 'Reconnect a bank' : 'Connect a bank'}</h1>
    <p>Log in to your bank through Plaid. The connection is stored by the budget worker.</p>
    <button id="connect">Connect</button>
    <p id="status" role="status"></p>
    <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
    <script>
      const key = encodeURIComponent(${JSON.stringify(adminKey)});
      const itemId = ${JSON.stringify(itemId)};
      const status = document.getElementById("status");

      document.getElementById("connect").addEventListener("click", async () => {
        status.textContent = "Starting…";
        const tokenUrl = "/link-token?key=" + key + (itemId ? "&item=" + encodeURIComponent(itemId) : "");
        const tokenResponse = await fetch(tokenUrl, { method: "POST" });
        if (!tokenResponse.ok) {
          status.textContent = "Could not start Plaid: " + (await tokenResponse.text());
          return;
        }
        const { linkToken } = await tokenResponse.json();
        status.textContent = "";

        Plaid.create({
          token: linkToken,
          onSuccess: async (publicToken, metadata) => {
            if (itemId) {
              status.textContent = "Reconnected " + metadata.institution.name + ".";
              return;
            }
            status.textContent = "Saving…";
            const response = await fetch("/items?key=" + key, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ institution: metadata.institution.name, publicToken }),
            });
            status.textContent = response.ok
              ? "Connected " + metadata.institution.name + "."
              : "Saving failed: " + (await response.text());
          },
          onExit: (error) => {
            if (error) status.textContent = "Plaid error: " + error.error_code + " " + (error.display_message || error.error_message);
          },
        }).open();
      });
    </script>
  </body>
</html>`;
