addEventListener("fetch", function(event) {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  var cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  try {
    var body = await request.json();
    var url = body.url;

    if (!url) {
      return new Response("No URL provided", { status: 400, headers: cors });
    }

    var upstream = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/calendar"
      }
    });

    var text = await upstream.text();

    return new Response(text, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/calendar"
      }
    });

  } catch (err) {
    return new Response(err.message, { status: 500, headers: cors });
  }
}
