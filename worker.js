addEventListener("fetch", function(event) {
  event.respondWith(handleRequest(event.request));
});

// Only allow requests from duee.online
const ALLOWED_ORIGINS = ['https://duee.online', 'https://www.duee.online'];

// Only allow fetching from known calendar providers
const ALLOWED_HOSTNAMES = [
  'blackboard.com',
  'canvas.instructure.com',
  'calendar.google.com',
  'outlook.live.com',
  'outlook.office365.com',
  'outlook.office.com',
  'p.caldav.icloud.com',
  'caldav.icloud.com',
];

// Block private/internal IP ranges
function isPrivateOrInternal(hostname) {
  // Reject localhost and loopback
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  // Reject cloud metadata endpoints
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') return true;
  // Reject private IPv4 ranges (10.x, 172.16-31.x, 192.168.x)
  const privateIPv4 = /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)$/;
  if (privateIPv4.test(hostname)) return true;
  return false;
}

async function handleRequest(request) {
  const origin = request.headers.get('Origin') || '';
  const cors = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

  // Enforce origin restriction
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return new Response("Forbidden", { status: 403, headers: cors });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return new Response("Invalid JSON", { status: 400, headers: cors });
  }

  const url = (body.url || '').trim();

  if (!url) {
    return new Response("No URL provided", { status: 400, headers: cors });
  }

  // Parse and validate the URL
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return new Response("Invalid URL", { status: 400, headers: cors });
  }

  // Only allow https
  if (parsed.protocol !== 'https:') {
    return new Response("Only HTTPS URLs are allowed", { status: 400, headers: cors });
  }

  // Block private/internal addresses
  if (isPrivateOrInternal(parsed.hostname)) {
    return new Response("URL not allowed", { status: 403, headers: cors });
  }

  // Whitelist check — hostname must end with an allowed domain
  const hostnameAllowed = ALLOWED_HOSTNAMES.some(allowed => {
    return parsed.hostname === allowed || parsed.hostname.endsWith('.' + allowed);
  });

  if (!hostnameAllowed) {
    return new Response("URL not allowed", { status: 403, headers: cors });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": "duee-calendar-proxy/1.0",
        "Accept": "text/calendar, text/plain"
      },
      redirect: "follow",
      // Prevent the worker from being used as an infinite redirect chain
      cf: { maxRedirects: 3 }
    });

    const text = await upstream.text();

    // Verify the response looks like a calendar before returning it
    if (!text.includes('BEGIN:VCALENDAR')) {
      return new Response("Response is not a valid calendar feed", { status: 422, headers: cors });
    }

    return new Response(text, {
      headers: {
        ...cors,
        "Content-Type": "text/calendar; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      }
    });

  } catch (err) {
    return new Response("Failed to fetch calendar", { status: 502, headers: cors });
  }
}
