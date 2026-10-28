export const renderConnectPage = ({
  adminKey,
  applicationId,
  environment,
}: {
  adminKey: string;
  applicationId: string;
  environment: string;
}) => `<!doctype html>
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
    <h1>Connect a bank</h1>
    <p>Log in to your bank through Teller. The access token is stored by the budget worker.</p>
    <button id="connect">Connect</button>
    <p id="status" role="status"></p>
    <script src="https://cdn.teller.io/connect/connect.js"></script>
    <script>
      const status = document.getElementById("status");
      const connect = TellerConnect.setup({
        applicationId: ${JSON.stringify(applicationId)},
        environment: ${JSON.stringify(environment)},
        products: ["transactions", "balance"],
        onSuccess: async (enrollment) => {
          status.textContent = "Saving…";
          const response = await fetch("/enrollments?key=" + encodeURIComponent(${JSON.stringify(adminKey)}), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken: enrollment.accessToken,
              enrollmentId: enrollment.enrollment.id,
              institution: enrollment.enrollment.institution.name,
            }),
          });
          status.textContent = response.ok
            ? "Connected " + enrollment.enrollment.institution.name + "."
            : "Saving failed: " + (await response.text());
        },
        onExit: () => { if (!status.textContent) status.textContent = "Closed without connecting."; },
      });
      document.getElementById("connect").addEventListener("click", () => connect.open());
    </script>
  </body>
</html>`;
